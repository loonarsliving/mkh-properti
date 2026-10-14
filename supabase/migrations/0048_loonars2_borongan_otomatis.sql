-- ============================================================================
-- 0048 — Loonars 2: borongan otomatis, banyak borongan, biaya lain tanpa unit, cicilan "lunas"
-- ============================================================================
-- Pelaksana cukup mengajukan; owner tidak perlu menyiapkan data lebih dulu:
--  * "tukang minggu ini": unit sedang dibangun yang belum punya borongan otomatis dibuatkan borongan
--    memakai ketentuan standar (settings: 35 jt/unit, retensi 9 jt/unit, 12 minggu). Bila ada beberapa
--    borongan aktif (gelombang unit berbeda) semuanya diajukan sekaligus, kecuali nama mandor disebut.
--  * "lain ..." tanpa unit: biaya lain dibagi rata ke unit sedang dibangun.
--  * "cicilan <toko> lunas" / tanpa nominal: memakai sisa utang toko dari tabel utang.
-- Pembayaran tetap butuh persetujuan owner (setujui M-n); owner diberi tahu bila borongan dibuat otomatis.
-- ============================================================================

alter table public.loonars2_settings add column tukang_nilai_per_unit numeric not null default 35000000
  check (tukang_nilai_per_unit > 0 and tukang_nilai_per_unit = round(tukang_nilai_per_unit));
alter table public.loonars2_settings add column tukang_retensi_per_unit numeric not null default 9000000
  check (tukang_retensi_per_unit >= 0 and tukang_retensi_per_unit = round(tukang_retensi_per_unit));
alter table public.loonars2_settings add column tukang_minggu smallint not null default 12
  check (tukang_minggu between 1 and 104);

create or replace function public._loonars2_siapkan_borongan(p_teks text, p_aktor text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_unit_ids smallint[];
  v_nama text;
  v_hasil jsonb;
begin
  select * into v_set from public.loonars2_settings where id = 1;
  select array_agg(u.id order by u.nomor) into v_unit_ids
    from public.loonars2_units u
   where u.sedang_dibangun and not exists (select 1 from public.loonars2_borongan_unit bu where bu.unit_id = u.id);
  if v_unit_ids is null then return ''; end if;
  v_nama := coalesce(substring(coalesce(p_teks, '') from '(?i)\m((?:pak|bu|bapak|ibu|mas)\s+[A-Za-z]+)'), 'Borongan tukang');
  if exists (select 1 from public.loonars2_borongan where lower(trim(nama)) = lower(trim(v_nama))) then
    v_nama := v_nama || ' ' || to_char(public._loonars2_hari_ini(), 'DD/MM');
  end if;
  v_hasil := public._loonars2_buat_borongan(v_nama, v_unit_ids, v_set.tukang_nilai_per_unit, v_set.tukang_retensi_per_unit, v_set.tukang_minggu, null, p_aktor);
  return E'\nℹ️ Borongan "' || v_nama || '" dicatat otomatis untuk ' || cardinality(v_unit_ids) || ' unit ('
    || (select string_agg(nomor::text, ',' order by nomor) from public.loonars2_units where id = any (v_unit_ids))
    || ') dengan ketentuan standar: ' || public.loonars2_rp(v_set.tukang_nilai_per_unit) || '/unit, retensi ' || public.loonars2_rp(v_set.tukang_retensi_per_unit)
    || '/unit, ' || v_set.tukang_minggu || ' minggu.';
end;
$$;

-- Pesan pelaksana yang bergantung pada daftar unit sedang dibangun (tambahan: biaya lain tanpa unit).
create or replace function public._loonars2_butuh_unit(p_aksi text, p_data jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_baris jsonb;
  v_ada_unit boolean;
begin
  if p_aksi in ('bahan', 'utang') then
    return not (case when jsonb_typeof(p_data -> 'unit') = 'array' then jsonb_array_length(p_data -> 'unit') > 0 else false end);
  end if;
  if p_aksi = 'ajukan_mingguan' and jsonb_typeof(p_data -> 'baris') = 'array' then
    for v_baris in select * from jsonb_array_elements(p_data -> 'baris') loop
      v_ada_unit := case when jsonb_typeof(v_baris -> 'unit') = 'array' then jsonb_array_length(v_baris -> 'unit') > 0 else false end;
      if coalesce(v_baris ->> 'jenis', 'material') in ('material', 'lain') and not v_ada_unit then return true; end if;
      if v_baris ->> 'jenis' = 'tukang' and nullif(v_baris ->> 'nominal', '') is null then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

-- Pengajuan mingguan (isi lengkap): + borongan otomatis/banyak borongan, + biaya lain tanpa unit, + cicilan "lunas"
create or replace function public._loonars2_ajukan_mingguan(p_baris jsonb, p_nama text, p_nomor text, p_sumber text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baris jsonb;
  v_kelompok text;
  v_no integer := 0;
  v_jenis text;
  v_nominal numeric;
  v_unit_ids smallint[];
  v_unit text;
  v_id smallint;
  v_bagian numeric[];
  v_i integer;
  v_toko_id smallint;
  v_alasan text;
  v_total numeric := 0;
  v_b smallint;
  v_bor record;
  v_minggu integer;
  v_bu smallint[];
  v_row integer;
  v_dipakai smallint[] := '{}';
  v_retensi_unit smallint[] := '{}';
  v_bangun text;
  v_ringkas text := '';
  v_hasil jsonb;
  v_alok text := '';
  v_isi_owner text;
  v_targets smallint[];
  v_t smallint;
  v_diproses integer;
  v_catatan text := '';
  v_dibuat text := '';
  v_sisa numeric;
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Pengajuan kosong. Tulis satu baris per pembayaran.');
  end if;
  if jsonb_array_length(p_baris) > 30 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Maksimal 30 baris per pengajuan.');
  end if;

  v_kelompok := public._loonars2_kode_baru('M');
  for v_baris in select * from jsonb_array_elements(p_baris) loop
    v_no := v_no + 1;
    v_jenis := coalesce(v_baris ->> 'jenis', 'material');
    v_nominal := nullif(v_baris ->> 'nominal', '')::numeric;
    v_unit_ids := '{}';
    if jsonb_typeof(v_baris -> 'unit') = 'array' then
      for v_unit in select jsonb_array_elements_text(v_baris -> 'unit') loop
        v_id := public._loonars2_cari_unit(v_unit);
        if v_id is null then
          raise exception 'Baris %: unit "%" tidak dikenali.', v_no, v_unit using errcode = '22023';
        end if;
        if not (v_id = any (v_unit_ids)) then v_unit_ids := v_unit_ids || v_id; end if;
      end loop;
    end if;
    if v_jenis not in ('cicilan', 'tukang', 'material', 'lain', 'retensi') then
      raise exception 'Baris %: jenis tidak dikenal.', v_no using errcode = '22023';
    end if;

    if v_jenis = 'cicilan' then
      v_toko_id := public._loonars2_cari_toko(v_baris ->> 'toko', false);
      if v_toko_id is null then
        raise exception 'Baris %: toko "%" belum punya utang tercatat. Catat dulu utangnya: "L2 utang <toko> <rincian> <nominal>".', v_no, coalesce(v_baris ->> 'toko', '') using errcode = '22023';
      end if;
      select sisa_utang into v_sisa from public.loonars2_v_toko where id = v_toko_id;
      if v_nominal is null and coalesce(v_baris ->> 'deskripsi', '') ~* '\m(lunas|semua|penuh|habis)\M' then
        v_nominal := v_sisa;
      end if;
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal cicilan belum ada. Sisa utang % saat ini %. Tulis nominalnya, mis. "cicilan % 3 juta", atau "cicilan % lunas".',
          v_no, (select nama from public.loonars2_toko where id = v_toko_id), public.loonars2_rp(greatest(coalesce(v_sisa, 0), 0)),
          (select nama from public.loonars2_toko where id = v_toko_id), (select nama from public.loonars2_toko where id = v_toko_id) using errcode = '22023';
      end if;
      insert into public.loonars2_cicilan (kelompok, toko_id, nominal, catatan, diajukan_oleh, diajukan_oleh_nomor, sumber)
      values (v_kelompok, v_toko_id, v_nominal, nullif(trim(v_baris ->> 'deskripsi'), ''), p_nama, p_nomor, p_sumber);
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• Cicilan ' || (select nama from public.loonars2_toko where id = v_toko_id) || ': ' || public.loonars2_rp(v_nominal);

    elsif v_jenis = 'retensi' then
      if cardinality(v_unit_ids) = 0 then
        raise exception 'Baris %: sebut unitnya, mis. "retensi unit 3".', v_no using errcode = '22023';
      end if;
      foreach v_id in array v_unit_ids loop
        select bu.borongan_id into v_b from public.loonars2_borongan_unit bu where bu.unit_id = v_id;
        if v_b is null then
          raise exception 'Baris %: % tidak ada di borongan mana pun.', v_no, public._loonars2_label_unit(v_id) using errcode = '22023';
        end if;
        select * into v_bor from public.loonars2_borongan where id = v_b;
        select status_bangun into v_bangun from public.loonars2_units where id = v_id;
        if v_bangun not in ('selesai', 'serah_terima') then
          raise exception 'Baris %: % belum selesai (status bangun: %). Retensi baru bisa diajukan setelah unit ditandai selesai/serah terima oleh owner.',
            v_no, public._loonars2_label_unit(v_id), v_bangun using errcode = '22023';
        end if;
        if v_bor.retensi_per_unit <= 0 then
          raise exception 'Baris %: borongan % tidak memakai retensi.', v_no, v_bor.nama using errcode = '22023';
        end if;
        if v_id = any (v_retensi_unit)
           or exists (select 1 from public.loonars2_material_requests where borongan_id = v_b and unit_id = v_id and retensi and status <> 'ditolak') then
          raise exception 'Baris %: retensi % sudah pernah diajukan.', v_no, public._loonars2_label_unit(v_id) using errcode = '22023';
        end if;
        v_retensi_unit := v_retensi_unit || v_id;
        v_row := public._loonars2_buat_pengajuan(v_id, 'tukang', 'Retensi borongan ' || v_bor.nama, null, null, v_bor.retensi_per_unit, null, p_nama, p_nomor, p_sumber, v_kelompok);
        update public.loonars2_material_requests set borongan_id = v_b, retensi = true where id = v_row;
        v_total := v_total + v_bor.retensi_per_unit;
        v_ringkas := v_ringkas || E'\n• Retensi ' || v_bor.nama || ' ' || public._loonars2_label_unit(v_id) || ': ' || public.loonars2_rp(v_bor.retensi_per_unit);
      end loop;

    elsif v_jenis = 'tukang' and v_nominal is null then
      -- Unit sedang dibangun yang belum punya borongan: borongan dibuat otomatis dari ketentuan standar.
      v_dibuat := v_dibuat || public._loonars2_siapkan_borongan(coalesce(v_baris ->> 'deskripsi', '') || ' ' || coalesce(v_baris ->> 'toko', ''),
                                                                  p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''));
      -- Nama mandor disebut -> hanya borongan itu; selain itu semua borongan aktif.
      v_targets := array(select id from public.loonars2_borongan
                          where status = 'aktif' and position(lower(trim(nama)) in lower(coalesce(v_baris ->> 'deskripsi', '') || ' ' || coalesce(v_baris ->> 'toko', ''))) > 0
                          order by id);
      if cardinality(v_targets) = 0 then
        v_targets := array(select id from public.loonars2_borongan where status = 'aktif' order by id);
      end if;
      if cardinality(v_targets) = 0 then
        raise exception 'Baris %: belum ada unit yang sedang dibangun. Kirim daftarnya dulu, mis. "L2 unit 1-6".', v_no using errcode = '22023';
      end if;
      v_diproses := 0;
      foreach v_t in array v_targets loop
        select * into v_bor from public.loonars2_borongan where id = v_t;
        if v_t = any (v_dipakai) then continue; end if;
        select max(minggu_ke) into v_minggu from public.loonars2_material_requests
         where borongan_id = v_t and not retensi and status = 'menunggu';
        if v_minggu is not null then
          v_catatan := v_catatan || E'\n⏳ Borongan ' || v_bor.nama || ': minggu ke-' || v_minggu || ' masih menunggu persetujuan owner, minggu berikutnya diajukan setelah itu.';
          continue;
        end if;
        select coalesce(max(minggu_ke), 0) + 1 into v_minggu from public.loonars2_material_requests
         where borongan_id = v_t and not retensi and status <> 'ditolak';
        if v_minggu > v_bor.jumlah_minggu then
          v_catatan := v_catatan || E'\n✅ Borongan ' || v_bor.nama || ' sudah diajukan lengkap (' || v_bor.jumlah_minggu || ' minggu).';
          continue;
        end if;
        v_nominal := public._loonars2_nominal_minggu(v_t, v_minggu);
        v_bu := array(select unit_id from public.loonars2_borongan_unit where borongan_id = v_t order by unit_id);
        v_bagian := public._loonars2_bagi_rata(v_nominal, cardinality(v_bu));
        for v_i in 1..cardinality(v_bu) loop
          v_row := public._loonars2_buat_pengajuan(v_bu[v_i], 'tukang',
            'Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || '/' || v_bor.jumlah_minggu || ' (dibagi rata ' || cardinality(v_bu) || ' unit)',
            null, null, v_bagian[v_i], null, p_nama, p_nomor, p_sumber, v_kelompok);
          update public.loonars2_material_requests set borongan_id = v_t, minggu_ke = v_minggu where id = v_row;
        end loop;
        v_dipakai := v_dipakai || v_t;
        v_diproses := v_diproses + 1;
        v_total := v_total + v_nominal;
        v_ringkas := v_ringkas || E'\n• Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || '/' || v_bor.jumlah_minggu || ': ' || public.loonars2_rp(v_nominal)
                     || ' (' || cardinality(v_bu) || ' unit)';
      end loop;
      if v_diproses = 0 then
        raise exception 'Baris %: tidak ada upah borongan yang bisa diajukan sekarang.%', v_no, v_catatan using errcode = '22023';
      end if;

    elsif v_jenis = 'material' then
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".', v_no using errcode = '22023';
      end if;
      v_hasil := public._loonars2_pesan_bahan('tunai', v_baris ->> 'toko', coalesce(nullif(trim(v_baris ->> 'deskripsi'), ''), '(tanpa rincian)'),
        v_baris -> 'items', v_nominal, v_unit_ids, v_baris ->> 'nota_url', null, p_nama, p_nomor, p_sumber, v_kelompok);
      v_alok := v_alok || E'\n\n' || (v_hasil ->> 'alokasi');
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• Bahan ' || left(coalesce(v_baris ->> 'deskripsi', ''), 60) || ': ' || public.loonars2_rp(v_nominal) || ' (dibagi ke unit sedang dibangun)';

    else
      -- tukang dengan nominal & unit, atau biaya lain: per unit, dibagi rata.
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".', v_no using errcode = '22023';
      end if;
      if cardinality(v_unit_ids) = 0 and v_jenis = 'lain' then
        v_unit_ids := public._loonars2_unit_dibangun();
      end if;
      if cardinality(v_unit_ids) = 0 then
        raise exception 'Baris %: unit belum disebut (mis. "unit 5" atau "unit 5,6"), dan belum ada unit yang ditandai sedang dibangun ("L2 unit 1-6").', v_no using errcode = '22023';
      end if;
      foreach v_id in array v_unit_ids loop
        v_alasan := public._loonars2_cek_unit_boleh(v_id);
        if v_alasan is not null then raise exception 'Baris %: %', v_no, v_alasan using errcode = '22023'; end if;
      end loop;
      v_bagian := public._loonars2_bagi_rata(v_nominal, cardinality(v_unit_ids));
      for v_i in 1..cardinality(v_unit_ids) loop
        perform public._loonars2_buat_pengajuan(v_unit_ids[v_i], v_jenis,
          coalesce(nullif(trim(v_baris ->> 'deskripsi'), ''), '(tanpa rincian)')
            || case when cardinality(v_unit_ids) > 1 then ' (dibagi rata ' || cardinality(v_unit_ids) || ' unit)' else '' end,
          null, v_baris ->> 'toko', v_bagian[v_i], v_baris ->> 'nota_url', p_nama, p_nomor, p_sumber, v_kelompok);
      end loop;
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• ' || case v_jenis when 'tukang' then 'Kontraktor/tukang' else 'Lain-lain' end || ' ' || left(coalesce(v_baris ->> 'deskripsi', ''), 60) || ': ' || public.loonars2_rp(v_nominal);
    end if;
  end loop;

  v_isi_owner := public._loonars2_teks_kelompok(v_kelompok);
  perform public._loonars2_kirim('owner', v_isi_owner || v_alok || coalesce(E'\n\n' || nullif(trim(v_dibuat), ''), ''), 'pengajuan_mingguan', 'mingguan:' || v_kelompok);
  return jsonb_build_object('status', 'diajukan', 'kode', v_kelompok, 'balasan',
    '✅ Pengajuan ' || v_kelompok || ' diterima: ' || jsonb_array_length(p_baris) || ' baris, total ' || public.loonars2_rp(v_total)
    || v_ringkas || v_catatan || coalesce(E'\n\n' || nullif(trim(v_dibuat), ''), '') || v_alok
    || E'\n\nStatus: MENUNGGU PERSETUJUAN OWNER. Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_kelompok || '".'
    || case when v_alok <> '' then E'\nPembagian bahan ke unit salah? Koreksi: "L2 koreksi ' || v_kelompok || ' <bahan> unit 1,2,3".' else '' end);
end;
$$;

revoke execute on function public._loonars2_siapkan_borongan(text, text) from public, anon, authenticated;
revoke execute on function public._loonars2_butuh_unit(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_ajukan_mingguan(jsonb, text, text, text) from public, anon, authenticated;
