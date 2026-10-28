-- Uji migrasi 0057 (upah tukang bernominal dihitung dari plafon borongan).
-- Dijalankan SETELAH semua uji sebelumnya pada database yang sama.
-- Titik awal: borongan aktif "Borongan tukang" (unit 14,16,17; plafon 3 × 26 jt = 78 jt, sudah diajukan 6,5 jt).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, case when a in ('ajukan', 'ajukan_mingguan', 'bahan') and not (d ? 'uji_rekening') then d || '{"tanpa_rekening":true}'::jsonb else d end) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.bor() returns smallint language sql as $$ select id from loonars2_borongan where nama = 'Borongan tukang' and status = 'aktif' $$;

select pg_temp.cek('titik awal: sisa plafon Borongan tukang 71,5 jt', public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 71500000);
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","16","17"]}') ->> 'status';

-- 1. Kejadian 28 Okt: tukang bernominal tanpa unit + bahan + reimburse, dijawab YA
select pg_temp.cek('pengajuan tiga baris tanpa unit: ditanya unit sedang dibangun',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[
     {"jenis":"tukang","deskripsi":"tukang minggu ini Sarno","nominal":25000000},
     {"jenis":"material","deskripsi":"Pasir","toko":"Nanang","nominal":3500000},
     {"jenis":"lain","deskripsi":"reimburse sarno","nominal":517500}]}') ->> 'status') = 'menunggu_unit');
select pg_temp.cek('YA: diterima, tidak lagi "unit belum disebut"',
  (pg_temp.wa('6281100000002', 'ya') ->> 'status') = 'diajukan');
select pg_temp.cek('upah 25 jt dibagi rata 3 unit borongan, tercatat ke borongan minggu ke-2',
  (select count(*) = 3 and sum(nominal) = 25000000 and bool_and(minggu_ke = 2) and bool_and(not retensi) and bool_and(kategori = 'tukang')
     from loonars2_material_requests where borongan_id = pg_temp.bor() and deskripsi like 'Upah borongan Borongan tukang minggu ke-2: tukang minggu ini Sarno%'));
select pg_temp.cek('sisa plafon berkurang 25 jt menjadi 46,5 jt', public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 46500000);
select pg_temp.cek('pesan owner untuk baris upah dikirim',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%tukang minggu ini Sarno%'));

-- 2. Melebihi plafon ditolak dengan sisa yang jelas
select pg_temp.cek('upah 50 jt melebihi sisa 46,5 jt: ditolak dengan rincian plafon',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang","nominal":50000000}]}') ->> 'balasan')
    like '%melebihi sisa borongan Borongan tukang%Plafon upah Rp 78.000.000%sudah diajukan Rp 31.500.000, sisa Rp 46.500.000%');
select pg_temp.cek('penolakan tidak mencatat apa pun', public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 46500000);

-- 3. Dengan unit di dalam borongan: dibagi ke unit yang disebut, tetap memotong plafon
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":["16","17"],"deskripsi":"tukang unit 16,17","nominal":10000000}]}') ->> 'status';
select pg_temp.cek('upah unit 16,17: 2 baris 5 jt, borongan minggu ke-3',
  (select count(*) = 2 and sum(nominal) = 10000000 and bool_and(minggu_ke = 3) from loonars2_material_requests
    where borongan_id = pg_temp.bor() and deskripsi like '%tukang unit 16,17%'));
select pg_temp.cek('sisa plafon 36,5 jt', public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 36500000);

-- 4. Unit di luar borongan: jalur lama (per unit, tanpa borongan)
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","15","16","17"]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":["15"],"deskripsi":"tukang lepas unit 15","nominal":1000000}]}') ->> 'status';
select pg_temp.cek('unit 15 (tanpa borongan): satu baris tanpa borongan_id',
  (select count(*) = 1 and bool_and(borongan_id is null) from loonars2_material_requests where deskripsi like 'tukang lepas unit 15%'));

-- 5. Unit dari borongan berbeda / sebagian di luar borongan: ditolak
select pg_temp.cek('unit 15 & 16 (campur): ditolak',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":["15","16"],"deskripsi":"tukang","nominal":2000000}]}') ->> 'balasan')
    like '%tidak berada di satu borongan yang sama%');

select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","16","17"]}') ->> 'status';

-- 6. Upah otomatis dipotong ke sisa plafon, lalu berhenti saat habis
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang","nominal":33000000}]}') ->> 'status';
update loonars2_material_requests set status = 'disetujui' where borongan_id = pg_temp.bor() and status = 'menunggu';
select pg_temp.cek('sisa plafon 3,5 jt', public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 3500000);
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'status';
select pg_temp.cek('upah otomatis (biasanya 6,5 jt) dipotong ke sisa 3,5 jt',
  (select sum(nominal) = 3500000 from loonars2_material_requests
    where borongan_id = pg_temp.bor() and status = 'menunggu' and deskripsi like 'Upah borongan Borongan tukang minggu ke-%'));
update loonars2_material_requests set status = 'disetujui' where borongan_id = pg_temp.bor() and status = 'menunggu';
select pg_temp.cek('plafon habis: upah otomatis tidak diajukan lagi',
  pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') is not null
  and (pg_temp.wa('6281100000002', 'ya') ->> 'balasan')
    like '%tidak ada upah borongan yang bisa diajukan sekarang%plafon upahnya sudah habis diajukan%');
select pg_temp.cek('upah bernominal saat plafon habis: ditolak',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang","nominal":1000000}]}') ->> 'balasan')
    like '%melebihi sisa borongan%sisa Rp 0%');
select pg_temp.cek('total upah borongan (di luar retensi) tidak pernah melebihi plafon',
  public._loonars2_sisa_upah_borongan(pg_temp.bor()) = 0);

select 'SEMUA UJI UPAH BORONGAN LULUS';
