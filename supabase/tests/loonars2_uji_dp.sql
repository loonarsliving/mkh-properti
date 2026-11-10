-- Uji migrasi 0064 (pengajuan DP pelaksana ditanya total nilainya). Setelah loonars2_uji_bukti_gabungan.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","15"]}') ->> 'status';
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';

-- 1. Pengenal kata DP
select pg_temp.cek('kata DP dikenali', public._loonars2_kata_dp('DP kaca') and public._loonars2_kata_dp('uang muka kusen') and public._loonars2_kata_dp('Panjar tukang las')
  and not public._loonars2_kata_dp('pasir') and not public._loonars2_kata_dp('DPP pajak') and not public._loonars2_kata_dp('adpter'));
select pg_temp.cek('keterangan total ditempel sebelum rekening',
  public._loonars2_tempel_total_dp('DP kaca | rek: BCA 7855066190 a.n. X', 3000000, 10000000) = 'DP kaca (DP dari total Rp 10.000.000, sisa Rp 7.000.000) | rek: BCA 7855066190 a.n. X');

-- 2. Kasus Vando 10 Nov 2026: DP kaca & DP pipa (rekening ada) tanpa total -> ditahan & ditanya
create temp table n0 as select (select count(*) from loonars2_material_requests) m, (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') o;
select pg_temp.cek('DP tanpa total: menunggu_total_dp, belum ada pengajuan, ditanya per baris; baris bukan DP tidak ditanya',
  (select (h ->> 'status') = 'menunggu_total_dp' and (h ->> 'balasan') like '%dari total nilai berapa%1. DP kaca%3.000.000%2. DP sambungan pipa air panas%'
          and (h ->> 'balasan') not like '%Bensin%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[
       {"jenis":"material","unit":["14","15"],"deskripsi":"DP kaca","nominal":3000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"},
       {"jenis":"material","unit":["14","15"],"deskripsi":"DP sambungan pipa air panas","nominal":3000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"},
       {"jenis":"lain","unit":["14"],"deskripsi":"Bensin genset","nominal":200000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') h) s)
  and (select count(*) from loonars2_material_requests) = (select m from n0));

-- 3. Balasan
select pg_temp.cek('total tidak lebih besar dari DP: ditolak dan ditanya ulang',
  (select (h ->> 'status') = 'perlu_info' and (h ->> 'balasan') like '%harus lebih besar%'
     from (select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"no":1,"total":2000000}]}') h) s));
select pg_temp.cek('balasan "1. total 10 juta" mengisi baris 1, baris 2 masih ditanya',
  (select (h ->> 'status') = 'menunggu_total_dp' and (h ->> 'balasan') like '%2. DP sambungan%' and (h ->> 'balasan') not like '%1. DP kaca%'
     from (select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"no":1,"total":10000000}]}') h) s));
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":8500000}]}') ->> 'status';
select pg_temp.cek('semua total lengkap: 3 pengajuan dibuat, 3 pesan owner',
  (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') = (select o from n0) + 3);
select pg_temp.cek('pesan owner memuat DP dari total & sisa, rekening tetap utuh',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Item: Belanja: DP kaca (DP dari total Rp 10.000.000, sisa Rp 7.000.000)%Nilai: Rp 3.000.000%BCA 7855066190 a.n. NAIMUDDIN IRFAN%')
  and exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%DP sambungan pipa air panas (DP dari total Rp 8.500.000, sisa Rp 5.500.000)%'));
select pg_temp.cek('nominal yang dicatat tetap nilai DP',
  (select sum(nominal) from loonars2_material_requests where deskripsi like 'DP kaca (DP dari total%') = 3000000);

-- 4. Total sudah disebut sejak awal: tidak ditanya
select pg_temp.cek('total_dp dikirim bersama baris: langsung diajukan',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"DP kusen","nominal":2000000,"total_dp":6000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'diajukan');
select pg_temp.cek('rincian DP kusen memuat total & sisa',
  exists (select 1 from loonars2_material_requests where deskripsi like 'DP kusen (DP dari total Rp 6.000.000, sisa Rp 4.000.000) | rek:%'));

-- 5. Tanpa total
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"DP keramik","nominal":1000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'tanpa_total_dp') ->> 'status';
select pg_temp.cek('"tanpa total" melanjutkan; owner melihat total belum disebut',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%DP keramik (DP — total nilai belum disebut)%'));

-- 6. Rekening & DP keduanya kurang: rekening ditanya dulu, lalu total
select pg_temp.cek('ajukan tunggal DP tanpa rekening: ditanya rekening dulu',
  (pg_temp.wa('6281100000002', 'ajukan', '{"unit":"14","kategori":"material","deskripsi":"DP pintu","toko":"UD Pintu Uji","nominal":1500000}') ->> 'status') = 'menunggu_rekening');
select pg_temp.cek('rekening dibalas -> lalu ditanya total DP',
  (pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"rekening":"BRI 223344556677 a.n. UD Pintu Uji"}]}') ->> 'status') = 'menunggu_total_dp');
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":4500000}]}') ->> 'status';
select pg_temp.cek('pengajuan tunggal: pesan owner memuat DP dari total dan rekening',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan' and pesan like '%DP pintu (DP dari total Rp 4.500.000, sisa Rp 3.000.000)%BRI 223344556677%'));

-- 7. Batas
select pg_temp.cek('owner tidak punya pending total DP',
  (pg_temp.wa('6281100000001', 'total_dp', '{"daftar":[{"total":1000000}]}') ->> 'status') = 'tidak_ada_pending');
select pg_temp.cek('pelaksana tanpa pending: tidak_ada_pending',
  (pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":1000000}]}') ->> 'status') = 'tidak_ada_pending');
select pg_temp.cek('utang (kredit) DP tidak ditanya total',
  (pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Kredit DP","unit":["14"],"deskripsi":"DP besi","nominal":700000}') ->> 'status') = 'diajukan');

select 'SEMUA UJI DP LULUS';
