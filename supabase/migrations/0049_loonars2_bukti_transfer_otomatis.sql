-- ============================================================================
-- 0049 — Loonars 2: foto bukti transfer dibaca otomatis + dana talangan
-- ============================================================================
-- Masalah nyata (15 Okt 2026): owner membayar upah borongan Rp 13.000.000 dan mengirim foto bukti
-- tanpa keterangan. Foto itu tidak pernah sampai ke Loonars 2 (hanya foto berketerangan "L2 ..."
-- yang diproses) sehingga dijawab modul lain "tidak cocok dengan pengajuan manapun". Selain itu
-- pembayaran dari rekening C ditolak bila saldo C kurang, padahal pembangunan berjalan sebelum
-- ada penjualan unit.
--
--  * Foto bukti transfer (tanpa keterangan) dicocokkan dengan nominalnya ke SATU pengajuan yang
--    menunggu: kode M-n (jumlah seluruh baris), L2-n, atau transfer A->B/C/D yang menunggu.
--    Hanya cocok persis & unik yang diproses; selain itu dilewatkan ke alur lain.
--  * Bukti dari OWNER sekaligus menyetujui (pengajuan masih "menunggu") lalu mencatat dibayar.
--    Bukti dari pelaksana hanya mencatat pengajuan yang SUDAH disetujui.
--  * Bukti owner boleh mendahului saldo C: dicatat sebagai DANA TALANGAN (kolom disbursements.talangan),
--    saldo C tampil minus sampai tertutup dari penjualan. Jalur lain (L2 bayar ...) tetap menolak
--    bila saldo kurang.
-- ============================================================================

alter table public.loonars2_disbursements add column talangan boolean not null default false;

create or replace function public._loonars2_catat_pengeluaran(
  p_dari char(1), p_kategori text, p_nominal numeric, p_unit_id smallint, p_request_id integer,
  p_penerima text, p_keterangan text, p_bukti text, p_tanggal date, p_aktor text, p_sumber text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
  v_id integer;
  v_talangan boolean := false;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  perform 1 from public.loonars2_settings where id = 1 for update;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    raise exception 'Nominal harus rupiah bulat lebih dari 0' using errcode = '22023';
  end if;
  select saldo into v_saldo from public.loonars2_v_rekening where kode = p_dari;
  if v_saldo < p_nominal then
    -- Hanya bukti transfer owner (uang benar-benar sudah keluar dari bank) yang boleh mendahului saldo: dicatat sebagai talangan.
    if coalesce(current_setting('loonars2.talangan', true), '') <> 'ya' then
      raise exception 'Saldo % (%) tidak cukup untuk %. Konfirmasi dulu transfer dari A bila sudah dilakukan.',
        p_dari, public.loonars2_rp(v_saldo), public.loonars2_rp(p_nominal) using errcode = '22023';
    end if;
    v_talangan := true;
  end if;
  insert into public.loonars2_disbursements (dari_rekening, kategori, unit_id, material_request_id, nominal, tanggal, penerima, keterangan, bukti_url, sumber, dicatat_oleh, talangan)
  values (p_dari, p_kategori, p_unit_id, p_request_id, p_nominal, coalesce(p_tanggal, public._loonars2_hari_ini()), p_penerima, p_keterangan, p_bukti, p_sumber, p_aktor, v_talangan)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public._loonars2_bayar_kelompok(p_kelompok text, p_bukti text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text := upper(trim(coalesce(p_kelompok, '')));
  v_total numeric;
  v_saldo_c numeric;
  v_n integer := 0;
  v_talangan boolean := false;
  r record;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  perform 1 from public.loonars2_settings where id = 1 for update;
  select coalesce(sum(nominal), 0), count(*) into v_total, v_n from (
    select nominal from public.loonars2_material_requests where kelompok = v_kode and status = 'disetujui'
    union all select nominal from public.loonars2_cicilan where kelompok = v_kode and status = 'disetujui') x;
  if v_n = 0 then
    return 'Tidak ada baris ' || v_kode || ' yang sudah disetujui dan belum dibayar.';
  end if;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  if v_saldo_c < v_total then
    if coalesce(current_setting('loonars2.talangan', true), '') <> 'ya' then
      return '❌ Saldo C (' || public.loonars2_rp(v_saldo_c) || ') tidak cukup untuk ' || v_kode || ' (' || public.loonars2_rp(v_total)
             || '). Konfirmasi dulu transfer dari A bila sudah dilakukan.';
    end if;
    v_talangan := true;
  end if;
  for r in select * from public.loonars2_material_requests where kelompok = v_kode and status = 'disetujui' order by id loop
    perform public._loonars2_catat_pengeluaran('C',
      case r.kategori when 'material' then 'material' when 'tukang' then 'tukang' else 'lain_konstruksi' end,
      r.nominal, r.unit_id, r.id, r.toko, v_kode || ' / L2-' || r.id || ': ' || left(r.deskripsi, 200), p_bukti, null, p_aktor, p_sumber);
    update public.loonars2_material_requests set status = 'dibayar' where id = r.id;
  end loop;
  for r in select c.*, t.nama as nama_toko from public.loonars2_cicilan c join public.loonars2_toko t on t.id = c.toko_id
            where c.kelompok = v_kode and c.status = 'disetujui' order by c.id loop
    insert into public.loonars2_disbursements (dari_rekening, kategori, unit_id, nominal, penerima, keterangan, bukti_url, sumber, dicatat_oleh, toko_id, cicilan_id, talangan)
    values ('C', 'material', null, r.nominal, r.nama_toko, v_kode || ' / C-' || r.id || ': cicilan utang ' || r.nama_toko, p_bukti, p_sumber, p_aktor, r.toko_id, r.id, v_talangan);
    update public.loonars2_cicilan set status = 'dibayar' where id = r.id;
  end loop;
  perform public._loonars2_kirim('owner', '💸 ' || v_kode || ' dibayar ' || public.loonars2_rp(v_total) || ' dari C (' || v_n || ' baris). Dicatat oleh ' || p_aktor || '.',
    'pengajuan_dibayar', 'dibayar:' || v_kode, p_bukti);
  perform public._loonars2_kirim('pelaksana', '💸 ' || v_kode || ' tercatat dibayar ' || public.loonars2_rp(v_total) || '.', 'pengajuan_dibayar', 'dibayar:' || v_kode, null);
  return '✅ ' || v_kode || ' tercatat dibayar ' || public.loonars2_rp(v_total) || ' dari C (' || v_n || ' baris). Budget unit & sisa utang toko sudah diperbarui.'
    || case when v_talangan then E'\n⚠️ Saldo C belum cukup (' || public.loonars2_rp(v_saldo_c) || '): pembayaran ini dicatat sebagai DANA TALANGAN yang menunggu tertutup dari penjualan unit.' else '' end;
end;
$$;

create or replace function public._loonars2_bukti_transfer(p_user public.loonars2_wa_users, p_nominal numeric, p_penerima text, p_bukti text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_kand jsonb := '[]'::jsonb;
  c record;
  k jsonb;
  v_n integer;
  v_teks text := '';
  v_pesan text;
  v_id integer;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');
  if p_nominal is null or p_nominal <= 0 then
    return jsonb_build_object('status', 'tidak_cocok');
  end if;

  -- (a) satu kode M-n: jumlah seluruh baris yang belum dibayar = nominal di foto
  for c in
    select x.kelompok, sum(x.nominal) as total, bool_or(x.status = 'menunggu') as ada_menunggu
      from (
        select kelompok, nominal, status from public.loonars2_material_requests where kelompok like 'M-%' and status in ('menunggu', 'disetujui')
        union all
        select kelompok, nominal, status from public.loonars2_cicilan where status in ('menunggu', 'disetujui')
      ) x
     group by x.kelompok having sum(x.nominal) = p_nominal
  loop
    v_kand := v_kand || jsonb_build_object('tipe', 'M', 'kode', c.kelompok, 'menunggu', c.ada_menunggu);
  end loop;
  -- (b) pengajuan tunggal L2-n
  for c in select id, status from public.loonars2_material_requests
            where kelompok is null and status in ('menunggu', 'disetujui') and nominal = p_nominal order by id loop
    v_kand := v_kand || jsonb_build_object('tipe', 'L2', 'id', c.id, 'kode', 'L2-' || c.id, 'menunggu', c.status = 'menunggu');
  end loop;
  -- (c) transfer A -> B/C/D yang menunggu konfirmasi (hanya owner)
  if p_user.peran = 'owner' then
    for c in select id, ke_rekening from public.loonars2_allocations where status = 'menunggu' and nominal = p_nominal order by id loop
      v_kand := v_kand || jsonb_build_object('tipe', 'T', 'id', c.id, 'kode', 'T' || c.id || ' (ke ' || c.ke_rekening || ')', 'menunggu', false);
    end loop;
  end if;

  v_n := jsonb_array_length(v_kand);
  if v_n = 0 then return jsonb_build_object('status', 'tidak_cocok'); end if;
  if v_n > 1 then
    for k in select * from jsonb_array_elements(v_kand) loop
      v_teks := v_teks || E'\n• ' || (k ->> 'kode');
    end loop;
    return jsonb_build_object('status', 'ambigu', 'balasan',
      '📎 Nominal di foto (' || public.loonars2_rp(p_nominal) || ') cocok dengan beberapa pengajuan:' || v_teks
      || E'\n\nKirim ulang foto dengan keterangan "L2 bayar <kode>" supaya tidak salah tempel.');
  end if;

  k := v_kand -> 0;
  v_pesan := '📎 Bukti transfer ' || public.loonars2_rp(p_nominal) || coalesce(' ke ' || nullif(trim(p_penerima), ''), '') || ' cocok dengan ' || (k ->> 'kode') || '.';

  if k ->> 'tipe' = 'T' then
    return jsonb_build_object('status', 'ok', 'balasan', v_pesan || E'\n' || public._loonars2_konfirmasi(array[(k ->> 'id')::int], p_bukti, v_aktor, 'wa'));
  end if;

  if (k ->> 'menunggu')::boolean then
    if p_user.peran <> 'owner' then
      return jsonb_build_object('status', 'ok', 'balasan', v_pesan || E'\n⏳ Pengajuan ini belum disetujui owner, jadi belum dicatat dibayar.');
    end if;
    -- Owner sudah membayar = menyetujui.
    if k ->> 'tipe' = 'M' then
      v_pesan := v_pesan || E'\n' || public._loonars2_putuskan_kode(k ->> 'kode', true, null, true, v_aktor, 'wa');
    else
      v_pesan := v_pesan || E'\n' || public._loonars2_putuskan((k ->> 'id')::int, true, null, true, v_aktor, 'wa');
    end if;
  end if;

  if p_user.peran = 'owner' then perform set_config('loonars2.talangan', 'ya', true); end if;
  if k ->> 'tipe' = 'M' then
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_kelompok(k ->> 'kode', p_bukti, v_aktor, 'wa');
  else
    v_id := (k ->> 'id')::int;
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_pengajuan(v_id, null, p_bukti, v_aktor, 'wa');
  end if;
  perform set_config('loonars2.talangan', '', true);
  return jsonb_build_object('status', 'ok', 'balasan', v_pesan);
end;
$$;

create or replace function public._loonars2_wa_jalankan(p_user public.loonars2_wa_users, p_aksi text, p_data jsonb, p_sudah_konfirmasi boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_unit_id smallint;
  v_unit record;
  v_nominal numeric;
  v_jenis text;
  v_id integer;
  v_ids integer[];
  v_receipt integer;
  v_teks text;
  r record;
  v_cek jsonb;
  v_ref text;
  v_unit_ids smallint[];
  v_pend public.loonars2_wa_pending;
  v_hasil jsonb;
  v_ilang boolean;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');

  if p_aksi in ('receipt', 'konfirmasi_transfer', 'tagihan', 'saldo', 'ubah_rekening', 'putuskan', 'putuskan_kode', 'cairkan_profit', 'borongan')
     and p_user.peran <> 'owner' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Perintah ini hanya untuk owner.');
  end if;
  if p_aksi in ('ajukan', 'utang', 'ajukan_mingguan', 'bahan') and p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Pengajuan dan input utang dilakukan oleh pelaksana.');
  end if;

  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.
  if p_user.peran = 'pelaksana' and not p_sudah_konfirmasi and p_aksi in ('ajukan_mingguan', 'bahan', 'utang')
     and public._loonars2_butuh_unit(p_aksi, p_data) then
    insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, p_data)
    on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
    return jsonb_build_object('status', 'menunggu_unit', 'balasan',
      case when cardinality(public._loonars2_unit_dibangun()) = 0
        then '📍 Unit mana yang sedang dibangun? Kirim daftarnya, mis. "L2 unit 1-6". Pengajuan Bapak saya proses setelah itu.'
        else '📍 Unit yang sedang dibangun saat ini: ' || public._loonars2_teks_unit_dibangun()
             || E'.\nUpah dan bahan dibagi mengikuti daftar ini.\nBalas YA jika sudah benar, atau kirim daftar terbaru, mis. "L2 unit 1-7".' end);
  end if;

  if p_aksi = 'saldo' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_saldo());
  elsif p_aksi = 'tagihan' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_tagihan());
  elsif p_aksi = 'daftar_utang' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_daftar_utang());

  elsif p_aksi = 'receipt' then
    v_unit_id := public._loonars2_cari_unit(p_data ->> 'unit');
    if v_unit_id is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Sebutkan nomor unit (1–17) atau kodenya, mis. "DP unit 12" / "DP BANYU-06".');
    end if;
    select * into v_unit from public.loonars2_v_unit where id = v_unit_id;
    v_jenis := coalesce(p_data ->> 'jenis', 'cicilan');
    v_nominal := nullif(p_data ->> 'nominal', '')::numeric;
    if v_nominal is null then
      if v_jenis = 'pelunasan' then
        v_nominal := v_unit.sisa_pelunasan;
      elsif v_jenis = 'dp' then
        v_nominal := greatest(v_unit.dp_target - v_unit.total_dibayar, 0);
      end if;
    end if;
    if v_nominal is null or v_nominal <= 0 then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nominalnya, mis. "DP unit ' || v_unit.nomor || ', 210 juta".');
    end if;
    if v_nominal > v_unit.sisa_pelunasan then
      return jsonb_build_object('status', 'ditolak', 'balasan', '❌ ' || public.loonars2_rp(v_nominal) || ' melebihi sisa tagihan '
        || public._loonars2_label_unit(v_unit_id) || ' (' || public.loonars2_rp(v_unit.sisa_pelunasan) || ').');
    end if;
    if not p_sudah_konfirmasi then
      v_teks := 'Konfirmasi: catat ' || upper(v_jenis) || ' ' || public._loonars2_label_unit(v_unit_id)
                || coalesce(' — ' || nullif(trim(coalesce(p_data ->> 'nama_pembeli', v_unit.nama_pembeli)), ''), '')
                || E'\nNominal: ' || public.loonars2_rp(v_nominal)
                || E'\nSisa tagihan setelah ini: ' || public.loonars2_rp(v_unit.sisa_pelunasan - v_nominal)
                || E'\n\nAlokasi:';
      for r in select * from public._loonars2_hitung_alokasi(v_unit_id, v_nominal) loop
        v_teks := v_teks || E'\n→ ' || r.ke_rekening || ' (' || public._loonars2_nama_rekening(r.ke_rekening) || ') ' || public.loonars2_rp(r.nominal);
      end loop;
      insert into public.loonars2_wa_pending (nomor, aksi, data)
      values (p_user.nomor, 'receipt', p_data || jsonb_build_object('nominal', v_nominal, 'jenis', v_jenis))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan', v_teks || E'\n\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    v_receipt := public._loonars2_catat_receipt(v_unit_id, v_jenis, v_nominal, nullif(p_data ->> 'tanggal', '')::date,
                                                p_data ->> 'nama_pembeli', p_data ->> 'bukti_url', v_aktor, 'wa');
    for r in select nomor from public.loonars2_wa_users where peran = 'owner' and aktif and nomor <> p_user.nomor loop
      insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
      values (r.nomor, public._loonars2_teks_instruksi(v_receipt), 'instruksi_transfer', 'instruksi:' || v_receipt || ':' || r.nomor)
      on conflict (kunci) do nothing;
    end loop;
    return jsonb_build_object('status', 'ok', 'receipt_id', v_receipt, 'balasan', public._loonars2_teks_instruksi(v_receipt));

  elsif p_aksi = 'konfirmasi_transfer' then
    v_ref := lower(coalesce(p_data ->> 'ref', ''));
    if v_ref ~ '^t[0-9]+$' then
      v_ids := array[substr(v_ref, 2)::int];
    elsif p_data ? 'rekening' then
      select array[id] into v_ids from public.loonars2_allocations
       where status = 'menunggu' and ke_rekening = upper(p_data ->> 'rekening')
         and (not (p_data ? 'nominal') or nominal = (p_data ->> 'nominal')::numeric)
       order by id limit 1;
    else
      select re.id into v_receipt from public.loonars2_receipts re
       where exists (select 1 from public.loonars2_allocations al where al.receipt_id = re.id and al.status = 'menunggu')
       order by re.id desc limit 1;
      if v_receipt is null then
        return jsonb_build_object('status', 'ok', 'balasan', 'Tidak ada transfer tertunda.');
      end if;
      if v_ref = 'semua' then
        select array_agg(id) into v_ids from public.loonars2_allocations where receipt_id = v_receipt and status = 'menunggu';
      elsif v_ref ~ '^[0-9]$' then
        select array_agg(id) into v_ids from public.loonars2_allocations
         where receipt_id = v_receipt and status = 'menunggu' and urutan = v_ref::int;
      end if;
    end if;
    if v_ids is null or cardinality(v_ids) = 0 then
      return jsonb_build_object('status', 'tidak_cocok', 'balasan',
        'Transfer itu tidak ditemukan di daftar tertunda.' || coalesce(E'\n\n' || public._loonars2_teks_tertunda(), ''));
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_konfirmasi(v_ids, p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'ubah_rekening' then
    if upper(coalesce(p_data ->> 'rekening', '')) not in ('A', 'B', 'C', 'D') or coalesce(p_data ->> 'nomor', '') !~ '[0-9]{4,}' then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Format: ubah rekening C BCA 1234567890 a.n. Nama Pemilik');
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'ubah_rekening', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi ubah rekening ' || upper(p_data ->> 'rekening') || ' (' || public._loonars2_nama_rekening(upper(p_data ->> 'rekening')::char) || ')'
        || E'\nLama: ' || public._loonars2_detail_rekening(upper(p_data ->> 'rekening')::char)
        || E'\nBaru: ' || coalesce(p_data ->> 'bank', '?') || ' ' || (p_data ->> 'nomor') || coalesce(' a.n. ' || (p_data ->> 'nama'), '')
        || E'\n\nBalas YA untuk menyimpan, atau BATAL.');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_ubah_rekening(p_data ->> 'rekening', p_data ->> 'bank', p_data ->> 'nomor', p_data ->> 'nama', v_aktor, 'wa'));

  elsif p_aksi = 'putuskan' then
    v_id := nullif(p_data ->> 'id', '')::int;
    if v_id is null then return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nomor pengajuan, mis. "setujui L2-12".'); end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_putuskan(
      v_id, coalesce((p_data ->> 'setuju')::boolean, false), p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'wa'));

  elsif p_aksi = 'putuskan_kode' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_putuskan_kode(
      p_data ->> 'kode', coalesce((p_data ->> 'setuju')::boolean, false), p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'wa'));

  elsif p_aksi = 'cairkan_profit' then
    v_nominal := nullif(p_data ->> 'nominal', '')::numeric;
    v_cek := public._loonars2_cek_profit(v_nominal);
    if not (v_cek ->> 'boleh')::boolean then
      return jsonb_build_object('status', 'ditolak', 'balasan', '❌ Pencairan profit belum boleh. Syarat yang belum terpenuhi:'
        || E'\n• ' || array_to_string(array(select jsonb_array_elements_text(v_cek -> 'alasan')), E'\n• '));
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'cairkan_profit', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi pencairan profit ' || public.loonars2_rp(v_nominal) || ' dari D (saldo ' || public.loonars2_rp((v_cek ->> 'saldo_d')::numeric) || ').'
        || E'\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_cairkan_profit(v_nominal, p_data ->> 'keterangan', p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'ajukan' then
    return public._loonars2_ajukan(
      public._loonars2_cari_unit(p_data ->> 'unit'), p_data ->> 'kategori', coalesce(nullif(p_data ->> 'deskripsi', ''), '(tanpa rincian)'),
      p_data -> 'items', p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'nota_url',
      p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'utang' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 then
      return public._loonars2_pesan_bahan_wa(p_user, 'utang', p_data);
    end if;
    return public._loonars2_catat_utang(v_unit_ids, p_data ->> 'toko', p_data ->> 'deskripsi', p_data -> 'items',
      nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'nota_url', nullif(p_data ->> 'tanggal', '')::date, p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'bahan' then
    return public._loonars2_pesan_bahan_wa(p_user, case when coalesce(p_data ->> 'utang', 'false') = 'true' then 'utang' else 'tunai' end, p_data);

  elsif p_aksi = 'unit_dibangun' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 or array_position(v_unit_ids, null) is not null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Contoh: "L2 unit 1-6" atau "L2 unit 1,2,3".');
    end if;
    perform public._loonars2_atur_unit_dibangun(v_unit_ids);
    v_teks := '📍 Unit sedang dibangun: ' || public._loonars2_teks_unit_dibangun() || '.';
    select * into v_pend from public.loonars2_wa_pending
     where nomor = p_user.nomor and kedaluwarsa_pada > now() and aksi in ('ajukan_mingguan', 'bahan', 'utang');
    v_ilang := found;
    if v_ilang then
      update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
      v_hasil := public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_pend.data, true);
      return v_hasil || jsonb_build_object('balasan', v_teks || E'\n\n' || coalesce(v_hasil ->> 'balasan', ''));
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', v_teks);

  elsif p_aksi = 'borongan' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    v_nominal := nullif(p_data ->> 'nilai', '')::numeric;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 or array_position(v_unit_ids, null) is not null
       or v_nominal is null or nullif(p_data ->> 'minggu', '') is null or length(trim(coalesce(p_data ->> 'nama', ''))) < 2 then
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        'Format: borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu' || E'\n(nama mandor, unit, nilai per unit, retensi per unit, jumlah minggu)');
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'borongan', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi borongan ' || trim(p_data ->> 'nama') || ': ' || cardinality(v_unit_ids) || ' unit × ' || public.loonars2_rp(v_nominal)
        || ', retensi ' || public.loonars2_rp(coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)) || '/unit, ' || (p_data ->> 'minggu') || ' minggu.'
        || E'\nDibayar mingguan: ' || public.loonars2_rp(cardinality(v_unit_ids) * (v_nominal - coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)))
        || ' ÷ ' || (p_data ->> 'minggu') || ' minggu ≈ ' || public.loonars2_rp(floor(cardinality(v_unit_ids) * (v_nominal - coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)) / (p_data ->> 'minggu')::int)) || '/minggu.'
        || E'\n\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    return public._loonars2_buat_borongan(p_data ->> 'nama', v_unit_ids, v_nominal, coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0),
      (p_data ->> 'minggu')::int, nullif(p_data ->> 'tanggal', '')::date, v_aktor);

  elsif p_aksi = 'bukti_kandidat' then
    -- Ada pengajuan/transfer yang menunggu pembayaran? (dipakai pembaca foto bukti transfer, supaya AI tidak dipanggil percuma)
    return jsonb_build_object('status', 'ok', 'jumlah',
      (select count(*) from public.loonars2_material_requests where status in ('menunggu', 'disetujui'))
      + (select count(*) from public.loonars2_cicilan where status in ('menunggu', 'disetujui'))
      + case when p_user.peran = 'owner' then (select count(*) from public.loonars2_allocations where status = 'menunggu') else 0 end);

  elsif p_aksi = 'bukti_transfer' then
    return public._loonars2_bukti_transfer(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima', p_data ->> 'bukti_url');

  elsif p_aksi = 'daftar_borongan' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_borongan());

  elsif p_aksi = 'koreksi_bahan' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    return public._loonars2_koreksi_bahan(p_data ->> 'kode', p_data ->> 'item', v_unit_ids, v_aktor);

  elsif p_aksi = 'rab' then
    v_unit_id := case when nullif(p_data ->> 'unit', '') is null then null else public._loonars2_cari_unit(p_data ->> 'unit') end;
    if nullif(p_data ->> 'unit', '') is not null and v_unit_id is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Contoh: "rab unit 3".');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_rab(v_unit_id));

  elsif p_aksi = 'ajukan_mingguan' then
    return public._loonars2_ajukan_mingguan(p_data -> 'baris', p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'bayar_pengajuan' then
    v_id := nullif(p_data ->> 'id', '')::int;
    if v_id is null then return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nomor pengajuan, mis. "L2 bayar L2-12".'); end if;
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_bayar_pengajuan(v_id, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'bayar_kelompok' then
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_bayar_kelompok(p_data ->> 'kode', p_data ->> 'bukti_url', v_aktor, 'wa'));
  end if;

  return jsonb_build_object('status', 'tidak_dikenal', 'balasan', 'Perintah Loonars 2 tidak dikenali.');
exception
  when sqlstate '22023' or sqlstate '23514' then
    return jsonb_build_object('status', 'ditolak', 'balasan', '❌ ' || sqlerrm);
end;
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like '\_loonars2\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
