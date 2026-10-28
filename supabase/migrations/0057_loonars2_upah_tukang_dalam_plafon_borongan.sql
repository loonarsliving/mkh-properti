-- ============================================================================
-- 0057 — Loonars 2: upah tukang bernominal dihitung dari plafon borongan
-- ============================================================================
-- Kejadian 28 Okt 2026: Vando mengirim
--   L2 pengajuan minggu ini
--   • tukang minggu ini 25 jt Mandiri … Sarno
--   • Pasir 3,5 Jt …   • reimburse sarno 517.500 …
-- lalu menjawab YA (unit 1–6 sedang dibangun) dan tetap ditolak:
-- "Baris 1: unit belum disebut …, dan belum ada unit yang ditandai sedang
-- dibangun". Penyebab: baris tukang BERNOMINAL tanpa unit tidak punya jalur —
-- hanya biaya lain-lain yang otomatis dibagi ke unit sedang dibangun, dan upah
-- tukang bernominal (dengan unit) juga tidak tercatat ke borongan sehingga
-- tidak memotong plafon upahnya.
--
-- Keputusan owner (28 Okt 2026): upah dibagi rata, tetapi patokannya tetap
-- plafon borongan — Borongan tukang AVARA-01..06 = 6 × (35 jt − retensi 9 jt)
-- = Rp 156.000.000.
--
--  1. Baris tukang bernominal:
--     - tanpa unit  → borongan aktif (nama mandor disebut → borongan itu; satu
--       borongan aktif → borongan itu), dibagi rata ke semua unit borongannya;
--     - dengan unit → bila semua unit itu di satu borongan aktif, dibagi rata
--       ke unit yang disebut dan dicatat ke borongan itu;
--     - unit di luar borongan mana pun → seperti sebelumnya (per unit, tanpa plafon).
--     Dicatat dengan borongan_id + minggu_ke berikutnya, dan DITOLAK bila
--     total upah borongan (di luar retensi, selain yang ditolak) melebihi plafon.
--  2. Upah mingguan otomatis ("L2 tukang minggu ini" tanpa nominal) dipotong
--     ke sisa plafon, supaya campuran nominal bebas + otomatis tetap ≤ plafon.
-- Tidak ada tabel/kolom baru; data lama tidak diubah.
-- ============================================================================

-- 1. Sisa plafon upah borongan (di luar retensi)
create or replace function public._loonars2_sisa_upah_borongan(p_borongan_id smallint)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.loonars2_borongan_unit where borongan_id = b.id) * (b.nilai_per_unit - b.retensi_per_unit)
       - coalesce((select sum(nominal) from public.loonars2_material_requests
                    where borongan_id = b.id and not retensi and status <> 'ditolak'), 0)
    from public.loonars2_borongan b
   where b.id = p_borongan_id;
$$;

-- 2. Satu baris upah tukang bernominal → borongan. NULL = unit di luar borongan (jalur lama).
create or replace function public._loonars2_upah_borongan(
  p_no integer, p_baris jsonb, p_unit_ids smallint[], p_nominal numeric,
  p_nama text, p_nomor text, p_sumber text, p_kelompok text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teks text := coalesce(p_baris ->> 'deskripsi', '') || ' ' || coalesce(p_baris ->> 'toko', '');
  v_dibuat text := '';
  v_bs smallint[];
  v_b smallint;
  v_bor record;
  v_bu smallint[];
  v_plafon numeric;
  v_sisa numeric;
  v_minggu integer;
  v_bagian numeric[];
  v_row integer;
  v_i integer;
  v_alasan text;
begin
  if cardinality(p_unit_ids) > 0 then
    select array_agg(distinct bu.borongan_id) into v_bs
      from public.loonars2_borongan_unit bu join public.loonars2_borongan b on b.id = bu.borongan_id and b.status = 'aktif'
     where bu.unit_id = any (p_unit_ids);
    if v_bs is null then return null; end if;
    if cardinality(v_bs) > 1 or exists (select 1 from unnest(p_unit_ids) u
                                         where not exists (select 1 from public.loonars2_borongan_unit bu where bu.unit_id = u and bu.borongan_id = v_bs[1])) then
      raise exception 'Baris %: unit yang disebut tidak berada di satu borongan yang sama. Ajukan upah per borongan, mis. "tukang unit 1-6 25 jt".', p_no using errcode = '22023';
    end if;
    v_b := v_bs[1];
    v_bu := array(select u from unnest(p_unit_ids) u order by u);
  else
    v_dibuat := public._loonars2_siapkan_borongan(v_teks, p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''));
    v_b := public._loonars2_cari_borongan(v_teks);
    if v_b is null then
      if not exists (select 1 from public.loonars2_borongan where status = 'aktif') then
        raise exception 'Baris %: belum ada unit yang sedang dibangun. Kirim daftarnya dulu, mis. "L2 unit 1-6".', p_no using errcode = '22023';
      end if;
      raise exception 'Baris %: ada beberapa borongan aktif (%). Sebut nama mandor atau unitnya, mis. "tukang unit 1-6 25 jt".', p_no,
        (select string_agg(nama, ', ' order by id) from public.loonars2_borongan where status = 'aktif') using errcode = '22023';
    end if;
    v_bu := array(select unit_id from public.loonars2_borongan_unit where borongan_id = v_b order by unit_id);
  end if;

  select * into v_bor from public.loonars2_borongan where id = v_b;
  v_plafon := (select count(*) from public.loonars2_borongan_unit where borongan_id = v_b) * (v_bor.nilai_per_unit - v_bor.retensi_per_unit);
  v_sisa := public._loonars2_sisa_upah_borongan(v_b);
  if p_nominal > v_sisa then
    raise exception 'Baris %: upah tukang % melebihi sisa borongan %. Plafon upah % (di luar retensi), sudah diajukan %, sisa %.',
      p_no, public.loonars2_rp(p_nominal), v_bor.nama, public.loonars2_rp(v_plafon), public.loonars2_rp(v_plafon - v_sisa),
      public.loonars2_rp(greatest(v_sisa, 0)) using errcode = '22023';
  end if;
  foreach v_row in array v_bu loop
    v_alasan := public._loonars2_cek_unit_boleh(v_row::smallint);
    if v_alasan is not null then raise exception 'Baris %: %', p_no, v_alasan using errcode = '22023'; end if;
  end loop;

  select coalesce(max(minggu_ke), 0) + 1 into v_minggu from public.loonars2_material_requests
   where borongan_id = v_b and not retensi and status <> 'ditolak';
  v_bagian := public._loonars2_bagi_rata(p_nominal, cardinality(v_bu));
  for v_i in 1..cardinality(v_bu) loop
    v_row := public._loonars2_buat_pengajuan(v_bu[v_i], 'tukang',
      'Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || ': '
        || coalesce(nullif(trim(p_baris ->> 'deskripsi'), ''), '(tanpa rincian)')
        || case when cardinality(v_bu) > 1 then ' (dibagi rata ' || cardinality(v_bu) || ' unit)' else '' end,
      null, p_baris ->> 'toko', v_bagian[v_i], p_baris ->> 'nota_url', p_nama, p_nomor, p_sumber, p_kelompok);
    update public.loonars2_material_requests set borongan_id = v_b, minggu_ke = v_minggu where id = v_row;
  end loop;

  return jsonb_build_object('dibuat', v_dibuat, 'ringkas',
    'Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || ': ' || public.loonars2_rp(p_nominal)
    || ' (' || cardinality(v_bu) || ' unit; sisa plafon ' || public.loonars2_rp(v_sisa - p_nominal) || ' dari ' || public.loonars2_rp(v_plafon) || ')');
end;
$$;

revoke execute on function public._loonars2_sisa_upah_borongan(smallint) from public, anon, authenticated;
revoke execute on function public._loonars2_upah_borongan(integer, jsonb, smallint[], numeric, text, text, text, text) from public, anon, authenticated;

-- 3. Pasang ke _loonars2_ajukan_mingguan (definisi hidup diganti per potongan, pola 0056)
do $$
declare
  v_def text;
  v_new text;
  v_lama text;
begin
  v_def := pg_get_functiondef('public._loonars2_ajukan_mingguan(jsonb,text,text,text)'::regprocedure);

  -- 3a. upah otomatis dipotong ke sisa plafon
  v_lama := E'        v_nominal := public._loonars2_nominal_minggu(v_t, v_minggu);\n';
  if position(v_lama in v_def) = 0 then raise exception 'penggantian _loonars2_ajukan_mingguan gagal: nominal_minggu tidak ditemukan'; end if;
  v_new := replace(v_def, v_lama, $q$        v_nominal := least(public._loonars2_nominal_minggu(v_t, v_minggu), public._loonars2_sisa_upah_borongan(v_t));
        if v_nominal <= 0 then
          v_catatan := v_catatan || E'\n✅ Borongan ' || v_bor.nama || ': plafon upahnya sudah habis diajukan.';
          continue;
        end if;
$q$);

  -- 3b. tukang bernominal → borongan (sebelum jalur per unit lama)
  v_lama := E'      if cardinality(v_unit_ids) = 0 and v_jenis = \'lain\' then\n';
  if position(v_lama in v_new) = 0 then raise exception 'penggantian _loonars2_ajukan_mingguan gagal: cabang lain tidak ditemukan'; end if;
  v_new := replace(v_new, v_lama, $q$      if v_jenis = 'tukang' then
        v_hasil := public._loonars2_upah_borongan(v_no, v_baris, v_unit_ids, v_nominal, p_nama, p_nomor, p_sumber, v_kelompok);
        if v_hasil is not null then
          v_total := v_total + v_nominal;
          v_ringkas := v_ringkas || E'\n• ' || v_kelompok || ': ' || (v_hasil ->> 'ringkas');
          v_dibuat := v_dibuat || coalesce(v_hasil ->> 'dibuat', '');
          continue;
        end if;
      end if;
$q$ || v_lama);

  if position('_loonars2_sisa_upah_borongan(v_t)' in v_new) = 0 or position('_loonars2_upah_borongan(v_no' in v_new) = 0 then
    raise exception 'penggantian _loonars2_ajukan_mingguan gagal';
  end if;
  execute v_new;
end;
$$;
