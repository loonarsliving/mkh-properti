-- ============================================================================
-- 0051 — Loonars 2: utang toko dari pelaksana langsung sah; yang dijaga = nota double
-- ============================================================================
-- Permintaan owner (19 Okt 2026): utang yang diinput Vando berasal dari nota
-- yang diunggah, jadi tidak perlu menunggu persetujuan owner. Yang dijaga
-- sistem adalah supaya tidak ada nota yang tercatat dua kali.
--
--  1. Utang baru (U-n) langsung 'disetujui' (diputuskan oleh sistem). Owner
--     tetap bisa menolak sesudahnya ("tolak U-n <alasan>") bila ternyata salah.
--  2. Penjaga nota double: utang dari WA dengan toko + total yang sama dengan
--     utang yang sudah ada (bukan ditolak) tidak dicatat; pelaksana diberi tahu
--     kode utang yang mirip dan cara melanjutkan bila memang nota berbeda
--     (tambahkan kata "nota beda" / "bukan double").
--  3. Nama toko dicocokkan lewat "kunci" yang membuang kata umum (toko, besi,
--     bahan bangunan, kaca, tb, ud, cv, "&", "dan"...), sehingga "Sedia Nurut" =
--     "Toko Besi & Kaca SEDIA NURUT" dan tidak lagi terpecah jadi dua toko.
--     Toko ganda yang sudah ada digabung ke yang paling awal.
--  4. Utang yang sudah tercatat tetapi masih 'menunggu' disetujui otomatis
--     mengikuti aturan baru.
-- Tidak ada tabel/kolom baru.
-- ============================================================================

-- 1. Kunci nama toko + pencarian toko memakai kunci -------------------------
create or replace function public._loonars2_kunci_toko(p_nama text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(p_nama, '')), '[&.,()/-]', ' ', 'g'),
             '\m(toko|tb|ud|cv|pt|besi|dan|kaca|bahan|bangunan|material|matrial)\M', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function public._loonars2_cari_toko(p_nama text, p_buat boolean)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text := regexp_replace(trim(coalesce(p_nama, '')), '\s+', ' ', 'g');
  v_kunci text;
  v_id smallint;
begin
  if length(v_nama) < 2 then return null; end if;
  -- kunci dulu (toko paling awal menang, sehingga sisa baris ganda tidak pernah terpilih), lalu nama persis
  v_kunci := public._loonars2_kunci_toko(v_nama);
  if v_kunci <> '' then
    select id into v_id from public.loonars2_toko where public._loonars2_kunci_toko(nama) = v_kunci order by id limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.loonars2_toko where lower(trim(nama)) = lower(v_nama) order by id limit 1;
  end if;
  if v_id is null and p_buat then
    insert into public.loonars2_toko (nama) values (v_nama) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- 2. Penjaga nota double -----------------------------------------------------
create or replace function public._loonars2_cek_utang_double(p_toko text, p_nominal numeric)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_toko smallint := public._loonars2_cari_toko(p_toko, false);
  r record;
begin
  if v_toko is null or p_nominal is null then return null; end if;
  select ut.kelompok, min(ut.tanggal) as tanggal, min(ut.diajukan_oleh) as oleh, sum(ut.nominal) as total, min(ut.status) as status
    into r
    from public.loonars2_utang_toko ut
   where ut.toko_id = v_toko and ut.status <> 'ditolak'
   group by ut.kelompok
  having sum(ut.nominal) = p_nominal
   order by min(ut.id) desc
   limit 1;
  if not found then return null; end if;
  return '⚠️ Utang TIDAK dicatat dulu: sudah ada ' || r.kelompok || ' untuk ' || (select nama from public.loonars2_toko where id = v_toko)
    || ' dengan total sama (' || public.loonars2_rp(p_nominal) || ', tanggal ' || to_char(r.tanggal, 'DD-MM-YYYY') || ', dari ' || r.oleh || ').'
    || E'\nKemungkinan nota yang sama terkirim dua kali. Kalau ini nota BERBEDA, kirim lagi dengan tambahan kata "nota beda" di keterangan.';
end;
$$;

-- 3. Utang baru langsung sah (dua jalur pencatatan) --------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_pesan_bahan(text,text,text,jsonb,numeric,smallint[],text,date,text,text,text,text)'::regprocedure);
  v_new := replace(v_def, 'unit_belum_terdanai, pesanan_id)', 'unit_belum_terdanai, pesanan_id, status, diputuskan_oleh, diputuskan_pada)');
  v_new := replace(v_new, 'not u.terdanai_penuh and not u.is_unit_contoh, v_pid);',
                   'not u.terdanai_penuh and not u.is_unit_contoh, v_pid, ''disetujui'', ''sistem:otomatis (nota pelaksana)'', now());');
  if v_new = v_def then raise exception 'penggantian _loonars2_pesan_bahan gagal'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public._loonars2_catat_utang(smallint[],text,text,jsonb,numeric,text,date,text,text,text)'::regprocedure);
  v_new := replace(v_def, 'pakai_buffer, melewati_buffer, unit_belum_terdanai)', 'pakai_buffer, melewati_buffer, unit_belum_terdanai, status, diputuskan_oleh, diputuskan_pada)');
  v_new := replace(v_new, 'not u.terdanai_penuh and not u.is_unit_contoh);',
                   'not u.terdanai_penuh and not u.is_unit_contoh, ''disetujui'', ''sistem:otomatis (nota pelaksana)'', now());');
  v_new := replace(v_new, E'Status: MENUNGGU PERSETUJUAN OWNER. Setelah disetujui, nilainya langsung memotong budget bangun unit.',
                          E'Status: SUDAH SAH, tidak perlu persetujuan owner. Nilainya langsung memotong budget bangun unit.');
  if v_new = v_def then raise exception 'penggantian _loonars2_catat_utang gagal'; end if;
  execute v_new;
end;
$$;

-- 4. Teks WA + penjaga double di jalur WA -------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  -- balasan ke pelaksana: utang sudah sah
  v_def := pg_get_functiondef('public._loonars2_pesan_bahan_wa(loonars2_wa_users,text,jsonb)'::regprocedure);
  v_new := replace(v_def, $q$Status: MENUNGGU PERSETUJUAN OWNER.'$q$,
    $q$Status: ' || case p_jenis when 'utang' then 'SUDAH SAH, tidak perlu persetujuan owner. Nilainya langsung memotong budget bangun unit.' else 'MENUNGGU PERSETUJUAN OWNER.' end || ''$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_pesan_bahan_wa gagal'; end if;
  execute v_new;

  -- penjaga nota double sebelum utang dicatat
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, E'elsif p_aksi = \'utang\' then\n',
    E'elsif p_aksi = \'utang\' then\n' ||
    $q$    if coalesce(p_data ->> 'paksa', 'false') <> 'true'
       and public._loonars2_cek_utang_double(p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric) is not null then
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        public._loonars2_cek_utang_double(p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric));
    end if;
$q$);
  v_new := replace(v_new, E'elsif p_aksi = \'bahan\' then\n',
    E'elsif p_aksi = \'bahan\' then\n' ||
    $q$    if coalesce(p_data ->> 'utang', 'false') = 'true' and coalesce(p_data ->> 'paksa', 'false') <> 'true'
       and public._loonars2_cek_utang_double(p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric) is not null then
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        public._loonars2_cek_utang_double(p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric));
    end if;
$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_wa_jalankan gagal'; end if;
  execute v_new;

  -- pesan ke owner: sudah sah otomatis, bisa ditolak bila salah
  v_def := pg_get_functiondef('public._loonars2_teks_utang_kelompok(text)'::regprocedure);
  v_new := replace(v_def, E'  return v_teks;\nend;',
    $q$  if v_status = 'disetujui' and exists (select 1 from public.loonars2_utang_toko where kelompok = p_kelompok and diputuskan_oleh like 'sistem:otomatis%') then
    v_teks := v_teks || E'\n\nℹ️ Sudah sah otomatis (nota dari pelaksana), tidak perlu disetujui. Kalau salah/double, balas "tolak ' || p_kelompok || ' <alasan>".';
  end if;
  return v_teks;
end;$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_teks_utang_kelompok gagal'; end if;
  execute v_new;

  -- owner masih bisa menolak utang yang sudah sah (mis. ternyata double)
  v_def := pg_get_functiondef('public._loonars2_putuskan_kode(text,boolean,text,boolean,text,text)'::regprocedure);
  v_new := replace(v_def,
    $q$where kelompok = v_kode and status = 'menunggu';
    get diagnostics v_n = row_count;
    if v_n = 0 then return 'Utang '$q$,
    $q$where kelompok = v_kode and (status = 'menunggu' or (not p_setuju and status = 'disetujui'));
    get diagnostics v_n = row_count;
    if v_n = 0 then return 'Utang '$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_putuskan_kode gagal'; end if;
  execute v_new;
end;
$$;

-- 5. Gabungkan toko ganda (nama beda, kunci sama) ke yang paling awal ----------
do $$
declare
  r record;
begin
  perform public._loonars2_set_aktor('sistem:migrasi 0051', 'sistem');
  for r in
    select t.id as lama, (select min(t2.id) from public.loonars2_toko t2
                           where public._loonars2_kunci_toko(t2.nama) = public._loonars2_kunci_toko(t.nama)) as baru
      from public.loonars2_toko t
     where public._loonars2_kunci_toko(t.nama) <> ''
  loop
    continue when r.baru is null or r.baru = r.lama;
    update public.loonars2_utang_toko set toko_id = r.baru where toko_id = r.lama;
    update public.loonars2_cicilan set toko_id = r.baru where toko_id = r.lama;
    update public.loonars2_disbursements set toko_id = r.baru where toko_id = r.lama;
    delete from public.loonars2_toko where id = r.lama;
  end loop;
end;
$$;

-- 6. Utang yang masih 'menunggu' mengikuti aturan baru -------------------------
select public._loonars2_set_aktor('sistem:migrasi 0051', 'sistem');
update public.loonars2_utang_toko
   set status = 'disetujui', diputuskan_oleh = 'sistem:otomatis (aturan owner 19 Okt 2026)', diputuskan_pada = now()
 where status = 'menunggu';
