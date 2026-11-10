-- ============================================================================
-- 0068 — Loonars 2: CFO memeriksa kelengkapan pengajuan sendiri
--        (nota, pengajuan dobel, harga janggal, pelunasan tanpa DP tercatat)
-- ============================================================================
-- Permintaan owner (10 Nov 2026): sistem adalah CFO sendiri, harus lebih teliti
-- ketika pengajuan tidak lengkap. Owner memilih keempat pemeriksaan ini dan
-- meminta dibawa ke production. Semua pesan bersuara sistem (aturan 0067).
--
-- Urutan pemeriksaan di pintu WA pelaksana (ajukan_mingguan / ajukan / bahan
-- tunai): rekening (0056) → total DP & pelunasan (0064/0065, diperluas di sini)
-- → NOTA → unit dibangun (0047) → DOBEL + HARGA. Setiap penahanan memakai
-- loonars2_wa_pending seperti sebelumnya; belum ada yang dicatat sampai lolos.
--
--  1. Nota wajib: baris material/lain ≥ loonars2_settings.nota_wajib_minimal
--     (kolom baru, bawaan Rp 1.000.000; 0 = nonaktif) tanpa nota_url, bukan DP/
--     pelunasan kontrak → ditahan. Balasan: foto berketerangan "L2 nota"
--     (aksi `nota`, {no?, nota_url}) atau "L2 tanpa nota <alasan>" (aksi
--     `tanpa_nota`) → rincian diberi "[tanpa nota: alasan]" dan owner melihatnya.
--  2. Dobel: item (kunci barang) + nilai sama dari pelaksana yang sama dalam 14
--     hari (bukan ditolak) → ditahan; YA = lanjut (ditandai "[dikonfirmasi bukan
--     dobel dari M-n]"), BATAL = tidak dicatat.
--  3. Harga janggal: rincian dengan jumlah + satuan ("pasir 2 dump") dibanding
--     median harga per satuan pembelian item yang sama (≥ 2 pembelian, 180 hari);
--     > 20% lebih mahal → ditandai "[⚠️ harga …]" (tidak menahan).
--  4. Pelunasan/termin/sisa tanpa kontrak DP → ditanya "total harga & sudah
--     dibayar berapa" (balasan "total 10 juta sudah 3 juta"; tanpa "sudah" =
--     pembayaran ini melunasi). Kontrak dibuat dengan kolom baru
--     loonars2_kontrak_dp.dibayar_luar (dibayar sebelum tercatat di sistem).
--
-- Tidak mengubah nominal, budget, saldo, alokasi, atau keputusan owner.
-- ============================================================================

alter table public.loonars2_settings
  add column nota_wajib_minimal numeric not null default 1000000 check (nota_wajib_minimal >= 0);
alter table public.loonars2_kontrak_dp
  add column dibayar_luar numeric not null default 0 check (dibayar_luar >= 0 and dibayar_luar = round(dibayar_luar));

create or replace view public.loonars2_v_kontrak_dp with (security_invoker = true) as
select
  k.id, k.kode, k.item, k.penerima, k.total, k.kelompok_awal, k.diajukan_oleh, k.dibuat_pada,
  k.dibayar_luar + coalesce(sum(m.nominal) filter (where m.status = 'dibayar'), 0) as dibayar,
  coalesce(sum(m.nominal) filter (where m.status = 'disetujui'), 0) as disetujui,
  coalesce(sum(m.nominal) filter (where m.status = 'menunggu'), 0) as menunggu,
  k.total - k.dibayar_luar - coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) as sisa,
  case
    when coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) = 0 then 'batal'
    when k.total - k.dibayar_luar - coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) < 0 then 'melebihi'
    when k.dibayar_luar + coalesce(sum(m.nominal) filter (where m.status = 'dibayar'), 0) >= k.total then 'lunas'
    else 'berjalan'
  end as status,
  k.dibayar_luar
from public.loonars2_kontrak_dp k
left join public.loonars2_material_requests m on m.kontrak_dp_id = k.id
group by k.id;

-- ---------------------------------------------------------------------------
-- Helper umum
-- ---------------------------------------------------------------------------
create or replace function public._loonars2_tempel_ket(p_dsk text, p_ket text)
returns text
language plpgsql
immutable
as $$
declare
  v_dsk text := coalesce(p_dsk, '');
  v_pos integer := position(' | rek:' in v_dsk);
begin
  if p_ket is null or p_ket = '' then return v_dsk; end if;
  if v_pos = 0 then return btrim(v_dsk) || ' ' || p_ket; end if;
  return btrim(substring(v_dsk from 1 for v_pos - 1)) || ' ' || p_ket || substring(v_dsk from v_pos);
end;
$$;

-- Jumlah + satuan pertama di rincian: "pasir 2 dump" -> (2, 'dump').
create or replace function public._loonars2_qty_satuan(p_teks text, out qty numeric, out satuan text)
language plpgsql
immutable
as $$
declare
  m text[];
begin
  m := regexp_match(lower(regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', '')),
    '(\d+(?:[.,]\d+)?)\s*(sak|zak|rit|dump|truk|truck|m3|kubik|kibik|batang|btg|lembar|lbr|kg|buah|bh|roll|dus|pcs|liter|ltr|meter|mtr|set|titik)\M');
  if m is null then return; end if;
  qty := replace(m[1], ',', '.')::numeric;
  if qty <= 0 or qty > 100000 then qty := null; return; end if;
  satuan := case m[2] when 'zak' then 'sak' when 'truck' then 'truk' when 'kubik' then 'm3' when 'kibik' then 'm3'
                      when 'btg' then 'batang' when 'lbr' then 'lembar' when 'bh' then 'buah' when 'ltr' then 'liter'
                      when 'mtr' then 'meter' else m[2] end;
end;
$$;

-- Kunci barang untuk dobel & harga: "Belanja pasir 2 dump [..] | rek: .." -> "pasir".
create or replace function public._loonars2_kunci_barang(p_teks text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(
           regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', '')),
           '\([^)]*\)|\[[^\]]*\]|\s+—\s+bahan kolektif.*$', ' ', 'g'),
           '\d+(?:[.,]\d+)?\s*(sak|zak|rit|dump|truk|truck|m3|kubik|kibik|batang|btg|lembar|lbr|kg|buah|bh|roll|dus|pcs|liter|ltr|meter|mtr|set|titik)\M', ' ', 'g'),
           '\m(belanja|beli|pembelian|bayar|pembayaran|material|matrial|bahan|untuk|unit|blok|rp|juta|jt|ribu|rb|total|harga|ke|dan|minggu|ini|l2)\M', ' ', 'g'),
           '[0-9.,/()&:;\-%]', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- 1. Nota wajib
-- ---------------------------------------------------------------------------
create or replace function public._loonars2_perlu_nota(p_baris jsonb, p_aksi text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_min numeric := coalesce((select nota_wajib_minimal from public.loonars2_settings limit 1), 0);
  v_dsk text := public._loonars2_hapus_rekening(coalesce(p_baris ->> 'deskripsi', ''));
  v_jenis text := coalesce(p_baris ->> 'jenis', p_baris ->> 'kategori', 'material');
begin
  return v_min > 0
     and coalesce(nullif(p_baris ->> 'nominal', '')::numeric, 0) >= v_min
     and nullif(p_baris ->> 'nota_url', '') is null
     and v_jenis in ('material', 'lain')
     and position('[tanpa nota' in v_dsk) = 0
     and position('[lanjutan D-' in v_dsk) = 0
     and position('[pelunasan: total' in v_dsk) = 0
     and not public._loonars2_kata_dp(v_dsk)
     and (p_aksi <> 'bahan' or coalesce(p_baris ->> 'utang', 'false') <> 'true');
end;
$$;

create or replace function public._loonars2_cek_nota(p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_kurang jsonb := '[]'::jsonb;
  b jsonb;
  v_no integer := 0;
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(p_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      if public._loonars2_perlu_nota(b, p_aksi) then
        v_kurang := v_kurang || jsonb_build_object('no', v_no, 'nama', left(public._loonars2_hapus_rekening(b ->> 'deskripsi'), 80), 'nominal', (b ->> 'nominal')::numeric);
      end if;
    end loop;
  elsif public._loonars2_perlu_nota(p_data, p_aksi) then
    v_kurang := jsonb_build_array(jsonb_build_object('no', 1, 'nama', left(public._loonars2_hapus_rekening(p_data ->> 'deskripsi'), 80), 'nominal', (p_data ->> 'nominal')::numeric));
  end if;
  return v_kurang;
end;
$$;

create or replace function public._loonars2_teks_minta_nota(p_kurang jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  k jsonb;
  v_teks text := '';
begin
  for k in select * from jsonb_array_elements(p_kurang) loop
    v_teks := v_teks || E'\n' || (k ->> 'no') || '. ' || coalesce(nullif(k ->> 'nama', ''), '(tanpa rincian)') || ' — ' || public.loonars2_rp((k ->> 'nominal')::numeric);
  end loop;
  return '📎 Nota/kwitansi belum ada untuk:' || v_teks
    || E'\n\nKirim foto notanya dengan keterangan "L2 nota"'
    || case when jsonb_array_length(p_kurang) > 1 then ' + nomornya, mis. "L2 nota 2" (satu foto per pesan)' else '' end
    || E'.\nTidak ada nota? Balas "L2 tanpa nota <alasan>", mis. "L2 tanpa nota beli di pasar".'
    || E'\n\nSaya perlu nota untuk belanja ' || public.loonars2_rp((select nota_wajib_minimal from public.loonars2_settings limit 1))
    || ' ke atas supaya pengeluaran bisa dicocokkan dan diaudit.';
end;
$$;

create or replace function public._loonars2_wa_nota(p_user public.loonars2_wa_users, p_data jsonb, p_tanpa boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend public.loonars2_wa_pending;
  v_kurang jsonb;
  v_data jsonb;
  v_no integer;
  v_alasan text := nullif(btrim(coalesce(p_data ->> 'alasan', '')), '');
  v_url text := nullif(btrim(coalesce(p_data ->> 'nota_url', '')), '');
  k jsonb;
  v_jalur text[];
begin
  if p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  select * into v_pend from public.loonars2_wa_pending
   where nomor = p_user.nomor and kedaluwarsa_pada > now() and data ? '_perlu_nota';
  if not found then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  v_data := v_pend.data;
  v_kurang := v_data -> '_perlu_nota';

  if p_tanpa then
    if v_alasan is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Tulis alasannya, mis. "L2 tanpa nota beli di pasar" atau "L2 tanpa nota tukang tidak memberi kwitansi".');
    end if;
    for k in select * from jsonb_array_elements(v_kurang) loop
      v_no := (k ->> 'no')::integer;
      v_jalur := case when v_pend.aksi = 'ajukan_mingguan' then array['baris', (v_no - 1)::text, 'deskripsi'] else array['deskripsi'] end;
      v_data := jsonb_set(v_data, v_jalur, to_jsonb(public._loonars2_tempel_ket(v_data #>> v_jalur, '[tanpa nota: ' || left(v_alasan, 120) || ']')));
    end loop;
    v_kurang := '[]'::jsonb;
  else
    if v_url is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Fotonya belum terbaca. Kirim ulang foto nota dengan keterangan "L2 nota".');
    end if;
    v_no := coalesce(nullif(p_data ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
    if not exists (select 1 from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no) then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Nomor ' || v_no || ' tidak sedang ditanya notanya.' || E'\n\n' || public._loonars2_teks_minta_nota(v_kurang));
    end if;
    if v_pend.aksi = 'ajukan_mingguan' then
      v_data := jsonb_set(v_data, array['baris', (v_no - 1)::text, 'nota_url'], to_jsonb(v_url));
    else
      v_data := v_data || jsonb_build_object('nota_url', v_url);
    end if;
    v_kurang := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer <> v_no), '[]'::jsonb);
  end if;

  if jsonb_array_length(v_kurang) > 0 then
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_nota', v_kurang),
           kedaluwarsa_pada = greatest(kedaluwarsa_pada, now() + interval '30 minutes')
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_nota', 'balasan', '✅ Nota diterima.' || E'\n\n' || public._loonars2_teks_minta_nota(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_nota', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 & 3. Dobel dan harga janggal
-- ---------------------------------------------------------------------------
create or replace function public._loonars2_cari_dobel(p_nomor text, p_dsk text, p_nominal numeric)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(g.kelompok, 'L2-' || g.id_awal) || ' (' || left(g.rincian, 60) || ', ' || public.loonars2_rp(g.total)
         || ', ' || to_char(g.tanggal at time zone 'Asia/Makassar', 'DD Mon') || ')'
    from (
      select m.kelompok, min(m.id) as id_awal, sum(m.nominal) as total, min(m.dibuat_pada) as tanggal,
             regexp_replace(public._loonars2_hapus_rekening(min(m.deskripsi)), '\s+—\s+bahan kolektif.*$', '') as rincian
        from public.loonars2_material_requests m
       where m.diajukan_oleh_nomor = p_nomor and m.status <> 'ditolak' and m.dibuat_pada > now() - interval '14 days'
       group by coalesce(m.kelompok, 'id' || m.id), m.kelompok
    ) g
   where g.total = p_nominal
     and public._loonars2_kunci_barang(p_dsk) <> ''
     and public._loonars2_kunci_barang(g.rincian) = public._loonars2_kunci_barang(p_dsk)
   order by g.id_awal desc
   limit 1;
$$;

create or replace function public._loonars2_ket_harga(p_dsk text, p_nominal numeric)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q record;
  v_kunci text := public._loonars2_kunci_barang(p_dsk);
  v_harga numeric;
  v_median numeric;
  v_n integer;
begin
  if p_nominal is null or v_kunci = '' or position('[⚠️ harga' in coalesce(p_dsk, '')) > 0 then return null; end if;
  select * into q from public._loonars2_qty_satuan(public._loonars2_hapus_rekening(p_dsk));
  if q.qty is null then return null; end if;
  v_harga := round(p_nominal / q.qty);
  select percentile_cont(0.5) within group (order by g.harga), count(*) into v_median, v_n
    from (
      select sum(m.nominal) / (public._loonars2_qty_satuan(public._loonars2_hapus_rekening(min(m.deskripsi)))).qty as harga,
             (public._loonars2_qty_satuan(public._loonars2_hapus_rekening(min(m.deskripsi)))).satuan as satuan,
             public._loonars2_kunci_barang(min(m.deskripsi)) as kunci
        from public.loonars2_material_requests m
       where m.status <> 'ditolak' and m.dibuat_pada > now() - interval '180 days'
       group by coalesce(m.kelompok, 'id' || m.id)
    ) g
   where g.kunci = v_kunci and g.satuan = q.satuan and g.harga is not null;
  if v_n < 2 or v_median is null or v_median <= 0 or v_harga <= v_median * 1.2 then return null; end if;
  return '[⚠️ harga ' || public.loonars2_rp(v_harga) || '/' || q.satuan || ', '
         || round((v_harga / v_median - 1) * 100) || '% di atas rata-rata ' || public.loonars2_rp(round(v_median))
         || ' dari ' || v_n || ' pembelian]';
end;
$$;

-- Tandai harga janggal (tidak menahan) lalu cari dobel (menahan). {data, dobel: [..]}
create or replace function public._loonars2_cek_dobel_harga(p_nomor text, p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb := p_data;
  v_dobel jsonb := '[]'::jsonb;
  b jsonb;
  v_out jsonb := '[]'::jsonb;
  v_no integer := 0;
  v_ket text;
  v_mirip text;
  v_lewat boolean := coalesce(p_data ->> '_dobel_dikonfirmasi', 'false') = 'true';
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(v_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      if coalesce(b ->> 'jenis', 'material') in ('material', 'lain') and nullif(b ->> 'nominal', '') is not null then
        v_ket := public._loonars2_ket_harga(b ->> 'deskripsi', (b ->> 'nominal')::numeric);
        if v_ket is not null then b := b || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(b ->> 'deskripsi', v_ket)); end if;
        v_mirip := public._loonars2_cari_dobel(p_nomor, b ->> 'deskripsi', (b ->> 'nominal')::numeric);
        if v_mirip is not null then
          if v_lewat then
            if position('[dikonfirmasi bukan dobel' in b ->> 'deskripsi') = 0 then
              b := b || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(b ->> 'deskripsi', '[dikonfirmasi bukan dobel dari ' || split_part(v_mirip, ' ', 1) || ']'));
            end if;
          else
            v_dobel := v_dobel || jsonb_build_object('no', v_no, 'nama', left(public._loonars2_hapus_rekening(b ->> 'deskripsi'), 80), 'nominal', (b ->> 'nominal')::numeric, 'mirip', v_mirip);
          end if;
        end if;
      end if;
      v_out := v_out || b;
    end loop;
    v_data := jsonb_set(v_data, '{baris}', v_out);
  elsif nullif(v_data ->> 'nominal', '') is not null then
    v_ket := public._loonars2_ket_harga(v_data ->> 'deskripsi', (v_data ->> 'nominal')::numeric);
    if v_ket is not null then v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(v_data ->> 'deskripsi', v_ket)); end if;
    v_mirip := public._loonars2_cari_dobel(p_nomor, v_data ->> 'deskripsi', (v_data ->> 'nominal')::numeric);
    if v_mirip is not null then
      if v_lewat then
        if position('[dikonfirmasi bukan dobel' in v_data ->> 'deskripsi') = 0 then
          v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(v_data ->> 'deskripsi', '[dikonfirmasi bukan dobel dari ' || split_part(v_mirip, ' ', 1) || ']'));
        end if;
      else
        v_dobel := jsonb_build_array(jsonb_build_object('no', 1, 'nama', left(public._loonars2_hapus_rekening(v_data ->> 'deskripsi'), 80), 'nominal', (v_data ->> 'nominal')::numeric, 'mirip', v_mirip));
      end if;
    end if;
  end if;
  return jsonb_build_object('data', v_data - '_dobel_dikonfirmasi', 'dobel', v_dobel);
end;
$$;

create or replace function public._loonars2_teks_dobel(p_dobel jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  k jsonb;
  v_teks text := '';
begin
  for k in select * from jsonb_array_elements(p_dobel) loop
    v_teks := v_teks || E'\n' || (k ->> 'no') || '. ' || coalesce(nullif(k ->> 'nama', ''), '(tanpa rincian)') || ' — ' || public.loonars2_rp((k ->> 'nominal')::numeric)
              || E'\n   mirip ' || (k ->> 'mirip');
  end loop;
  return '🔁 Pengajuan ini sama dengan yang sudah masuk dalam 14 hari terakhir:' || v_teks
    || E'\n\nKalau memang pembayaran yang berbeda, balas YA. Kalau terkirim dua kali, balas BATAL (tidak ada yang dicatat).';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Pelunasan tanpa DP tercatat (perluasan pemeriksaan 0065)
-- ---------------------------------------------------------------------------
create or replace function public._loonars2_cek_satu_dp(p_baris jsonb, p_tanpa boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b jsonb := p_baris;
  v_dsk text := coalesce(p_baris ->> 'deskripsi', '');
  v_bersih text := public._loonars2_hapus_rekening(coalesce(p_baris ->> 'deskripsi', ''));
  v_nominal numeric := nullif(p_baris ->> 'nominal', '')::numeric;
  v_total numeric := nullif(p_baris ->> 'total_dp', '')::numeric;
  v_sudah numeric := nullif(p_baris ->> 'sudah_dibayar', '')::numeric;
  v_kontrak integer;
begin
  if v_nominal is null or position('(DP dari total' in v_dsk) > 0 or position('total nilai belum disebut' in v_dsk) > 0
     or position('[lanjutan D-' in v_dsk) > 0 or position('[pelunasan: total' in v_dsk) > 0 or position('[total belum disebut]' in v_dsk) > 0 then
    return jsonb_build_object('baris', b);
  end if;
  if (public._loonars2_kata_dp(v_bersih) and v_total is null) or public._loonars2_kata_lanjutan(v_bersih)
     or v_bersih ~* '\mD-\d+\M' then
    v_kontrak := public._loonars2_cari_kontrak_dp(v_bersih);
    if v_kontrak is not null then
      return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_lanjutan_dp(v_dsk, v_kontrak, v_nominal)));
    end if;
  end if;
  -- Pelunasan / termin / sisa tanpa kontrak: tanya total & yang sudah dibayar.
  if public._loonars2_kata_lanjutan(v_bersih) and not public._loonars2_kata_dp(v_bersih) then
    if v_total is not null and v_total >= v_nominal then
      v_sudah := coalesce(v_sudah, v_total - v_nominal);
      return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(v_dsk,
        '[pelunasan: total ' || public.loonars2_rp(v_total) || ', sudah dibayar sebelumnya ' || public.loonars2_rp(v_sudah)
        || case when v_sudah + v_nominal > v_total then ' ⚠️ MELEBIHI TOTAL' else '' end || ']')));
    elsif p_tanpa then
      return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_ket(v_dsk, '[total belum disebut]')));
    end if;
    return jsonb_build_object('baris', b, 'kurang', jsonb_build_object('nama', left(v_bersih, 80), 'nominal', v_nominal, 'jenis', 'pelunasan'));
  end if;
  if not public._loonars2_kata_dp(v_bersih) then
    return jsonb_build_object('baris', b);
  end if;
  if v_total is not null and v_total > v_nominal then
    return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, v_total)));
  elsif p_tanpa then
    return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, null)));
  end if;
  return jsonb_build_object('baris', b, 'kurang', jsonb_build_object('nama', left(v_bersih, 80), 'nominal', v_nominal));
end;
$$;

create or replace function public._loonars2_teks_minta_total_dp(p_kurang jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  k jsonb;
  v_teks text := '';
  v_lunas boolean := false;
  v_dp boolean := false;
begin
  for k in select * from jsonb_array_elements(p_kurang) loop
    v_lunas := v_lunas or k ->> 'jenis' = 'pelunasan';
    v_dp := v_dp or coalesce(k ->> 'jenis', '') <> 'pelunasan';
    v_teks := v_teks || E'\n' || (k ->> 'no') || '. ' || coalesce(nullif(k ->> 'nama', ''), '(tanpa rincian)')
              || coalesce(' — ' || public.loonars2_rp((k ->> 'nominal')::numeric), '');
  end loop;
  return case when v_lunas and not v_dp then '🧮 Pembayaran ini belum punya catatan DP/kontrak. Total harganya berapa, dan sudah dibayar berapa sebelum ini?'
              when v_lunas then '🧮 Total harganya berapa? (Untuk pelunasan, sebutkan juga yang sudah dibayar sebelumnya.)'
              else '🧮 DP ini dari total nilai berapa?' end
    || v_teks
    || E'\n\nBalas dengan total harganya, mis. '
    || case when jsonb_array_length(p_kurang) > 1 then E'\n1. total 10 juta\n2. total 8.500.000' || case when v_lunas then ' sudah 3 juta' else '' end
            when v_lunas then '"total 10 juta sudah 3 juta" (tanpa "sudah" = pembayaran ini melunasi)'
            else '"total 10 juta"' end
    || E'\n\nSaya perlu totalnya untuk mencatat sisa pembayaran, supaya tidak terjadi salah bayar. Belum tahu totalnya? Balas "L2 tanpa total".';
end;
$$;

create or replace function public._loonars2_wa_total_dp(p_user public.loonars2_wa_users, p_data jsonb, p_tanpa boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend public.loonars2_wa_pending;
  v_kurang jsonb;
  v_awal integer;
  v_data jsonb;
  it jsonb;
  v_no integer;
  v_total numeric;
  v_sudah numeric;
  v_nominal numeric;
  v_kelompok text;
  v_jenis text;
  v_kecil text := '';
  v_hasil text;
begin
  if p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  select * into v_pend from public.loonars2_wa_pending
   where nomor = p_user.nomor and kedaluwarsa_pada > now() and data ? '_perlu_total_dp';
  if not found then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  v_data := v_pend.data;
  v_kurang := v_pend.data -> '_perlu_total_dp';
  v_awal := jsonb_array_length(v_kurang);

  if p_tanpa then
    update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
    if v_pend.aksi = 'lengkapi_dp' then
      v_hasil := public._loonars2_lengkapi_dp(coalesce(v_data -> '_isi', '[]'::jsonb), p_user.nama);
      return jsonb_build_object('status', 'ok', 'balasan', '👍 Baik, sisanya tanpa total.' || coalesce(E'\nYang sudah dicatat:' || nullif(v_hasil, ''), ''));
    end if;
    return public._loonars2_wa_jalankan(p_user, v_pend.aksi, (v_data - '_perlu_total_dp') || '{"tanpa_total_dp":true}'::jsonb, false);
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_data -> 'daftar', '[]'::jsonb)) loop
    v_total := nullif(it ->> 'total', '')::numeric;
    v_sudah := nullif(it ->> 'sudah', '')::numeric;
    continue when v_total is null or v_total <= 0;
    v_no := coalesce(nullif(it ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
    select (x ->> 'nominal')::numeric, x ->> 'kelompok', coalesce(x ->> 'jenis', 'dp') into v_nominal, v_kelompok, v_jenis
      from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no;
    continue when not found;
    if (v_jenis = 'pelunasan' and v_total < v_nominal) or (v_jenis <> 'pelunasan' and v_total <= v_nominal) then
      v_kecil := v_kecil || E'\n• ' || v_no || ': total ' || public.loonars2_rp(v_total) || ' lebih kecil dari pembayaran ' || public.loonars2_rp(v_nominal);
      continue;
    end if;
    if v_pend.aksi = 'lengkapi_dp' then
      v_data := jsonb_set(v_data, '{_isi}', coalesce(v_data -> '_isi', '[]'::jsonb) || jsonb_build_object('kelompok', v_kelompok, 'total', v_total));
    elsif v_pend.aksi = 'ajukan_mingguan' then
      v_data := jsonb_set(v_data, array['baris', (v_no - 1)::text, 'total_dp'], to_jsonb(v_total));
      if v_sudah is not null then v_data := jsonb_set(v_data, array['baris', (v_no - 1)::text, 'sudah_dibayar'], to_jsonb(v_sudah)); end if;
    else
      v_data := v_data || jsonb_build_object('total_dp', v_total) || case when v_sudah is not null then jsonb_build_object('sudah_dibayar', v_sudah) else '{}'::jsonb end;
    end if;
    v_kurang := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer <> v_no), '[]'::jsonb);
  end loop;

  if jsonb_array_length(v_kurang) = v_awal then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      case when v_kecil <> '' then '⚠️ Total harus lebih besar dari nilai pembayarannya:' || v_kecil
           else '🧮 Total belum terbaca. Tulis total harganya, mis. "total 10 juta".' end
      || E'\n\n' || public._loonars2_teks_minta_total_dp(v_kurang));
  end if;
  if jsonb_array_length(v_kurang) > 0 then
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_total_dp', v_kurang),
           kedaluwarsa_pada = greatest(kedaluwarsa_pada, now() + interval '30 minutes')
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_total_dp', 'balasan', '✅ Total dicatat.' || E'\n\n' || public._loonars2_teks_minta_total_dp(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  if v_pend.aksi = 'lengkapi_dp' then
    v_hasil := public._loonars2_lengkapi_dp(coalesce(v_data -> '_isi', '[]'::jsonb), p_user.nama);
    return jsonb_build_object('status', 'ok', 'balasan', '✅ Terima kasih, total DP dicatat:' || coalesce(v_hasil, ''));
  end if;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_total_dp', false);
end;
$$;

-- Trigger 0065 diperluas: penanda "[pelunasan: total …, sudah dibayar sebelumnya …]" membuat kontrak.
create or replace function public.loonars2_tautkan_kontrak_dp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text;
  v_total numeric;
  v_luar numeric := 0;
  v_item text;
  v_id integer;
  m text[];
begin
  if new.kontrak_dp_id is not null then return new; end if;
  v_kode := substring(new.deskripsi from '\[lanjutan (D-\d+)');
  if v_kode is not null then
    select id into new.kontrak_dp_id from public.loonars2_kontrak_dp where kode = v_kode;
    return new;
  end if;
  m := regexp_match(new.deskripsi, '\[pelunasan: total Rp ([0-9.]+), sudah dibayar sebelumnya Rp ([0-9.]+)');
  if m is not null then
    v_total := replace(m[1], '.', '')::numeric;
    v_luar := replace(m[2], '.', '')::numeric;
  else
    v_total := replace(substring(new.deskripsi from '\(DP dari total Rp ([0-9.]+)'), '.', '')::numeric;
  end if;
  if v_total is null then return new; end if;
  if new.kelompok is not null then
    select id into v_id from public.loonars2_kontrak_dp where kelompok_awal = new.kelompok order by id limit 1;
  end if;
  if v_id is null then
    v_item := btrim(regexp_replace(regexp_replace(public._loonars2_hapus_rekening(new.deskripsi), '\s*\(DP dari total[^)]*\)|\s*\[[^\]]*\]', '', 'g'),
                    '\s+—\s+bahan kolektif, bagian unit ini.*$', ''));
    insert into public.loonars2_kontrak_dp (item, penerima, total, kelompok_awal, diajukan_oleh, dibayar_luar)
    values (left(coalesce(nullif(v_item, ''), 'DP'), 300),
            coalesce(public._loonars2_ekstrak_rekening(new.deskripsi), new.toko),
            v_total, new.kelompok, new.diajukan_oleh, v_luar)
    returning id into v_id;
  end if;
  new.kontrak_dp_id := v_id;
  return new;
end;
$$;

-- Baris kontrak di pesan owner: tampilkan juga yang dibayar sebelum tercatat.
create or replace function public._loonars2_teks_kontrak_dp(p_kelompok text, p_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k record;
  v_ini numeric;
  v_teks text := '';
begin
  for k in
    select distinct v.* from public.loonars2_v_kontrak_dp v
      join public.loonars2_material_requests m on m.kontrak_dp_id = v.id
     where (p_kelompok is not null and m.kelompok = p_kelompok) or (p_id is not null and m.id = p_id)
     order by v.id
  loop
    select coalesce(sum(nominal), 0) into v_ini from public.loonars2_material_requests
     where kontrak_dp_id = k.id and ((p_kelompok is not null and kelompok = p_kelompok) or (p_id is not null and id = p_id));
    v_teks := v_teks || E'\n📑 Kontrak ' || k.kode || ' (' || left(k.item, 60) || '): total ' || public.loonars2_rp(k.total)
      || E'\n   Sudah dibayar ' || public.loonars2_rp(k.dibayar)
      || case when k.dibayar_luar > 0 then ' (termasuk ' || public.loonars2_rp(k.dibayar_luar) || ' sebelum tercatat, menurut pelaksana)' else '' end
      || case when k.disetujui > 0 then ' · disetujui ' || public.loonars2_rp(k.disetujui) else '' end
      || ' · pengajuan ini ' || public.loonars2_rp(v_ini)
      || case when k.menunggu - v_ini > 0 then ' · menunggu lain ' || public.loonars2_rp(k.menunggu - v_ini) else '' end
      || E'\n   Sisa setelah ini: ' || public.loonars2_rp(k.sisa)
      || case when k.sisa < 0 then E'\n🔴 Melebihi total kontrak ' || public.loonars2_rp(-k.sisa) || ' — periksa sebelum transfer.' else '' end;
  end loop;
  return nullif(v_teks, '');
end;
$$;

revoke execute on function public._loonars2_tempel_ket(text, text) from public, anon, authenticated;
revoke execute on function public._loonars2_qty_satuan(text) from public, anon, authenticated;
revoke execute on function public._loonars2_kunci_barang(text) from public, anon, authenticated;
revoke execute on function public._loonars2_perlu_nota(jsonb, text) from public, anon, authenticated;
revoke execute on function public._loonars2_cek_nota(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_minta_nota(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_nota(public.loonars2_wa_users, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._loonars2_cari_dobel(text, text, numeric) from public, anon, authenticated;
revoke execute on function public._loonars2_ket_harga(text, numeric) from public, anon, authenticated;
revoke execute on function public._loonars2_cek_dobel_harga(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_dobel(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_cek_satu_dp(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_minta_total_dp(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_total_dp(public.loonars2_wa_users, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.loonars2_tautkan_kontrak_dp() from public, anon, authenticated;
revoke execute on function public._loonars2_teks_kontrak_dp(text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sambungan di pintu WA
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, E'declare\n  v_rekcek jsonb;\n  v_dpcek jsonb;\n', E'declare\n  v_rekcek jsonb;\n  v_dpcek jsonb;\n  v_notacek jsonb;\n  v_dobelcek jsonb;\n');
  -- NOTA: setelah total DP, sebelum pertanyaan unit
  v_new := replace(v_new,
    E'  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.\n',
    $q$  -- Pelaksana: belanja di atas batas wajib bernota (atau alasan tanpa nota).
  if p_user.peran = 'pelaksana'
     and (p_aksi in ('ajukan_mingguan', 'ajukan') or (p_aksi = 'bahan' and coalesce(p_data ->> 'utang', 'false') <> 'true')) then
    v_notacek := public._loonars2_cek_nota(p_aksi, p_data - '_perlu_nota');
    if jsonb_array_length(v_notacek) > 0 then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, (p_data - '_perlu_nota') || jsonb_build_object('_perlu_nota', v_notacek))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_nota', 'balasan', public._loonars2_teks_minta_nota(v_notacek));
    end if;
    p_data := p_data - '_perlu_nota';
  end if;

  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.
$q$);
  -- DOBEL + HARGA: setelah pertanyaan unit
  v_new := replace(v_new, E'  if p_aksi = \'saldo\' then\n',
    $q$  -- Pelaksana: tandai harga janggal, tahan pengajuan yang sama dengan yang sudah masuk (YA = lanjut, BATAL = tidak dicatat).
  if p_user.peran = 'pelaksana'
     and (p_aksi in ('ajukan_mingguan', 'ajukan') or (p_aksi = 'bahan' and coalesce(p_data ->> 'utang', 'false') <> 'true')) then
    v_dobelcek := public._loonars2_cek_dobel_harga(p_user.nomor, p_aksi, p_data);
    p_data := v_dobelcek -> 'data';
    if jsonb_array_length(v_dobelcek -> 'dobel') > 0 then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, p_data || '{"_dobel_dikonfirmasi":true}'::jsonb)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_konfirmasi', 'balasan', public._loonars2_teks_dobel(v_dobelcek -> 'dobel'));
    end if;
  end if;

  if p_aksi = 'saldo' then
$q$);
  v_new := replace(v_new, E'  elsif p_aksi = \'daftar_borongan\' then\n',
    E'  elsif p_aksi = \'nota\' then\n    return public._loonars2_wa_nota(p_user, p_data, false);\n\n  elsif p_aksi = \'tanpa_nota\' then\n    return public._loonars2_wa_nota(p_user, p_data, true);\n\n  elsif p_aksi = \'daftar_borongan\' then\n');
  if v_new = v_def or position('v_notacek jsonb' in v_new) = 0 or position('_loonars2_cek_nota(' in v_new) = 0
     or position('_loonars2_cek_dobel_harga(' in v_new) = 0 or position('_loonars2_wa_nota(p_user, p_data, true)' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal (0068)';
  end if;
  execute v_new;
end;
$$;
