-- Uji migrasi 0063 (satu transfer gabungan untuk beberapa pengajuan ke rekening yang sama). Setelah loonars2_uji_rekening.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.status(k text) returns text language sql as
  $$ select string_agg(distinct status, ',') from (select status from loonars2_material_requests where kelompok = k union all select status from loonars2_cicilan where kelompok = k) x $$;

-- Skenario bersih
update loonars2_material_requests set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_cicilan set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","15"]}') ->> 'status';
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';

-- Pengajuan Vando 3 Nov 2026: tiga baris, satu rekening.
create temp table k1 as
select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"material","deskripsi":"pasir | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":5250000},
    {"jenis":"material","deskripsi":"belanja material | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":1340500},
    {"jenis":"lain","deskripsi":"kos | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":1000000}]'::jsonb,
  'Vando Uji', '6281100000002', 'wa') h) s;
create temp table kode as select kodes ->> 0 a, kodes ->> 1 b, kodes ->> 2 c from k1;
-- Pengajuan lain ke rekening berbeda dengan nominal sama, supaya terbukti rekening dipakai.
select public._loonars2_ajukan_mingguan('[{"jenis":"lain","deskripsi":"sewa | rek: Mandiri 1111222233 a.n. Lain","nominal":3795250},
  {"jenis":"lain","deskripsi":"air | rek: Mandiri 1111222233 a.n. Lain","nominal":3795250}]'::jsonb, 'Vando Uji', '6281100000002', 'wa') ->> 'status';

select pg_temp.cek('tiga kode terpisah menunggu', (select pg_temp.status(a) = 'menunggu' and pg_temp.status(b) = 'menunggu' and pg_temp.status(c) = 'menunggu' from kode));

-- Pelaksana mengirim bukti gabungan: belum disetujui -> tidak dicatat
select pg_temp.cek('pelaksana: gabungan dikenali tapi belum dicatat dibayar',
  (pg_temp.wa('6281100000002', 'bukti_transfer', '{"nominal":7590500,"penerima":"NAIMUDDIN IRFAN MIAGURAT BCA 7855 0661 90"}') ->> 'balasan') like '%gabungan%belum disetujui owner%'
  and (select pg_temp.status(a) = 'menunggu' from kode));

-- Nomor rekening di foto beda: tidak dicocokkan ke gabungan Naimuddin
select pg_temp.cek('rekening di foto berbeda: tidak_cocok',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":7590500,"penerima":"BUDI BRI 9999888877"}') ->> 'status') = 'tidak_cocok');

-- Owner: foto transfer Rp 7.590.500 ke BCA 7855066190 -> ketiganya disetujui & dibayar
create temp table h1 as select pg_temp.wa('6281100000001', 'bukti_transfer',
  '{"nominal":7590500,"penerima":"NAIMUDDIN IRFAN MIAGURAT BCA 7855 0661 90","bukti_url":"https://contoh/gabungan.jpg"}') h;
select pg_temp.cek('owner: gabungan 3 kode dibayar sekaligus',
  (select (h ->> 'status') = 'ok' and (h ->> 'balasan') like '%gabungan 3 pengajuan ke rekening yang sama%' from h1)
  and (select pg_temp.status(a) = 'dibayar' and pg_temp.status(b) = 'dibayar' and pg_temp.status(c) = 'dibayar' from kode));
select pg_temp.cek('bukti terlampir di pengeluaran ketiga kode',
  (select count(distinct split_part(keterangan, ' /', 1)) = 3 from loonars2_disbursements where bukti_url = 'https://contoh/gabungan.jpg'));
select pg_temp.cek('rekening lain (Mandiri) tetap menunggu',
  not exists (select 1 from loonars2_material_requests where deskripsi like '%1111222233%' and status <> 'menunggu'));

-- Sebagian gabungan (2 dari 3 kode) yang unik juga cocok
create temp table k2 as select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"lain","deskripsi":"bensin | rek: BCA 5555666677 a.n. Sarno","nominal":200000},
    {"jenis":"lain","deskripsi":"listrik | rek: BCA 5555666677 a.n. Sarno","nominal":650000},
    {"jenis":"lain","deskripsi":"konsumsi | rek: BCA 5555666677 a.n. Sarno","nominal":1300000}]'::jsonb, 'Vando Uji', '6281100000002', 'wa') h) s;
select pg_temp.cek('owner: gabungan sebagian yang unik (bensin+konsumsi) dibayar, listrik tetap menunggu',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":1500000,"penerima":"SARNO BCA 5555666677"}') ->> 'status') = 'ok'
  and (select pg_temp.status(kodes ->> 0) = 'dibayar' and pg_temp.status(kodes ->> 1) = 'menunggu' and pg_temp.status(kodes ->> 2) = 'dibayar' from k2));

-- Dua gabungan berbeda dengan jumlah sama -> ambigu, tidak ada yang dicatat
create temp table k3 as select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"lain","deskripsi":"a | rek: BNI 7777888899 a.n. Toko","nominal":100000},
    {"jenis":"lain","deskripsi":"b | rek: BNI 7777888899 a.n. Toko","nominal":100000},
    {"jenis":"lain","deskripsi":"c | rek: BNI 7777888899 a.n. Toko","nominal":100000}]'::jsonb, 'Vando Uji', '6281100000002', 'wa') h) s;
select pg_temp.cek('gabungan tidak unik: ambigu, tidak ada yang dibayar',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":200000,"penerima":"BNI 7777888899"}') ->> 'status') = 'ambigu'
  and (select pg_temp.status(kodes ->> 0) = 'menunggu' and pg_temp.status(kodes ->> 1) = 'menunggu' and pg_temp.status(kodes ->> 2) = 'menunggu' from k3));

-- Satu kode yang cocok persis tetap lewat langkah lama (a)
select pg_temp.cek('kode tunggal yang cocok tetap dibayar lewat langkah lama',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":650000,"penerima":"BCA 5555666677"}') ->> 'balasan') like '%cocok dengan M-%'
  and (select pg_temp.status(kodes ->> 1) = 'dibayar' from k2));

select 'SEMUA UJI BUKTI GABUNGAN LULUS';
