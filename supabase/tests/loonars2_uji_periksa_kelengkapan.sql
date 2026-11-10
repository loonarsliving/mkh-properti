-- Uji migrasi 0068 (CFO memeriksa kelengkapan: nota, dobel, harga janggal, pelunasan tanpa DP). Paling akhir.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
update loonars2_settings set nota_wajib_minimal = 1000000;
create temp table rek as select 'BCA 7855066190 a.n. Naimuddin Irfan'::text r;

select pg_temp.cek('helper qty/satuan & kunci barang',
  (select qty = 2 and satuan = 'dump' from public._loonars2_qty_satuan('material pasir 2 dump'))
  and public._loonars2_kunci_barang('Belanja pasir 2 dump [x] | rek: BCA 1') = 'pasir'
  and (select qty is null from public._loonars2_qty_satuan('cat tembok')));

-- 1. NOTA
create temp table n0 as select count(*) m from loonars2_material_requests;
select pg_temp.cek('belanja ≥ 1 jt tanpa nota: ditahan dan ditanya; < 1 jt & DP tidak',
  (select (h ->> 'status') = 'menunggu_nota' and (h ->> 'balasan') like '%Nota/kwitansi belum ada untuk:%1. keramik lantai — Rp 2.500.000%'
          and (h ->> 'balasan') not like '%paku%' and (h ->> 'balasan') not like '%Pak Avi%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
       jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','keramik lantai','nominal',2500000,'rekening',(select r from rek)),
       jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','paku','nominal',300000,'rekening',(select r from rek)),
       jsonb_build_object('jenis','tukang','unit',jsonb_build_array('14'),'deskripsi','tukang las','nominal',2000000,'rekening',(select r from rek))))) h) s)
  and (select count(*) from loonars2_material_requests) = (select m from n0));
select pg_temp.cek('tanpa alasan ditolak', (pg_temp.wa('6281100000002', 'tanpa_nota', '{}') ->> 'balasan') like '%Tulis alasannya%');
select pg_temp.cek('foto "L2 nota": nota tersimpan, pengajuan dibuat',
  (pg_temp.wa('6281100000002', 'nota', '{"nota_url":"https://contoh.test/nota-keramik.jpg"}') ->> 'status') = 'diajukan');
select pg_temp.cek('nota_url tersimpan di pengajuan',
  exists (select 1 from loonars2_material_requests where deskripsi like 'keramik lantai%' and nota_url = 'https://contoh.test/nota-keramik.jpg'));
select pg_temp.wa('6281100000002', 'ajukan', jsonb_build_object('unit','14','kategori','material','deskripsi','pasir urug','nominal',1800000,'rekening',(select r from rek))) ->> 'status';
select pg_temp.cek('"L2 tanpa nota <alasan>": lanjut, rincian & pesan owner memuat alasannya',
  (pg_temp.wa('6281100000002', 'tanpa_nota', '{"alasan":"beli di pasar"}') ->> 'status') = 'diajukan'
);
select pg_temp.cek('... alasan tanpa nota tampil di pesan owner',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan' and pesan like '%pasir urug [tanpa nota: beli di pasar]%'));

-- 2. DOBEL
update loonars2_settings set nota_wajib_minimal = 0;
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','semen tiga roda','nominal',1300000,'rekening',(select r from rek))))) ->> 'status';
create temp table d0 as select count(*) m from loonars2_material_requests;
select pg_temp.cek('item + nilai sama dalam 14 hari: ditahan, menyebut kode yang mirip',
  (select (h ->> 'status') = 'menunggu_konfirmasi' and (h ->> 'balasan') like '%sama dengan yang sudah masuk%mirip M-%semen tiga roda%Rp 1.300.000%balas YA%BATAL%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
       jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','Semen tiga roda','nominal',1300000,'rekening',(select r from rek))))) h) s)
  and (select count(*) from loonars2_material_requests) = (select m from d0));
select pg_temp.cek('BATAL: tidak ada yang dicatat',
  (pg_temp.wa('6281100000002', 'batal') ->> 'status') = 'ok' and (select count(*) from loonars2_material_requests) = (select m from d0));
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','semen tiga roda','nominal',1300000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.cek('YA: dicatat dengan tanda dikonfirmasi bukan dobel',
  (pg_temp.wa('6281100000002', 'ya') ->> 'status') = 'diajukan');
select pg_temp.cek('... tanda tersimpan',
  exists (select 1 from loonars2_material_requests where deskripsi like 'semen tiga roda [dikonfirmasi bukan dobel dari M-%'));
select pg_temp.cek('nilai berbeda: tidak dianggap dobel',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
     jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','semen tiga roda','nominal',1400000,'rekening',(select r from rek))))) ->> 'status') = 'diajukan');

-- 3. HARGA JANGGAL
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','batu kali 2 rit','nominal',1000000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','batu kali 3 rit','nominal',1560000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','batu kali 2 rit','nominal',1400000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.cek('harga per rit > 20% di atas median: ditandai di rincian & pesan owner (tidak ditahan)',
  exists (select 1 from loonars2_material_requests where deskripsi like 'batu kali 2 rit [⚠️ harga Rp 700.000/rit, 37% di atas rata-rata Rp 510.000 dari 2 pembelian]%')
  and exists (select 1 from loonars2_outbox where pesan like '%batu kali 2 rit [⚠️ harga Rp 700.000/rit%'));
select pg_temp.cek('harga wajar tidak ditandai',
  not exists (select 1 from loonars2_material_requests where deskripsi like 'batu kali 3 rit [⚠️%'));

-- 4. PELUNASAN TANPA DP TERCATAT
select pg_temp.cek('pelunasan tanpa kontrak: ditanya total & sudah dibayar',
  (select (h ->> 'status') = 'menunggu_total_dp' and (h ->> 'balasan') like '%belum punya catatan DP/kontrak%sudah dibayar berapa%pelunasan lemari dapur%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
       jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','pelunasan lemari dapur','nominal',6000000,'rekening',(select r from rek))))) h) s));
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":10000000,"sudah":4000000}]}') ->> 'status';
select pg_temp.cek('kontrak dibuat: total 10 jt, dibayar sebelum tercatat 4 jt, sisa 0',
  (select total = 10000000 and dibayar_luar = 4000000 and sisa = 0 and dibayar = 4000000 from loonars2_v_kontrak_dp where item = 'pelunasan lemari dapur'));
select pg_temp.cek('pesan owner menyebut pembayaran sebelum tercatat',
  exists (select 1 from loonars2_outbox where pesan like '%pelunasan lemari dapur [pelunasan: total Rp 10.000.000, sudah dibayar sebelumnya Rp 4.000.000]%Kontrak D-%termasuk Rp 4.000.000 sebelum tercatat%Sisa setelah ini: Rp 0%'));
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','pelunasan pagar teralis','nominal',5000000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":8000000}]}') ->> 'status';
select pg_temp.cek('tanpa "sudah": dianggap pelunasan penuh (sudah = total − pembayaran ini)',
  (select dibayar_luar = 3000000 and sisa = 0 from loonars2_v_kontrak_dp where item = 'pelunasan pagar teralis'));
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(
  jsonb_build_object('jenis','material','unit',jsonb_build_array('14'),'deskripsi','pelunasan atap spandek','nominal',5000000,'rekening',(select r from rek))))) ->> 'status';
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":8000000,"sudah":4000000}]}') ->> 'status';
select pg_temp.cek('sudah + pembayaran > total: owner diberi 🔴',
  (select status = 'melebihi' from loonars2_v_kontrak_dp where item = 'pelunasan atap spandek')
  and exists (select 1 from loonars2_outbox where pesan like '%pelunasan atap spandek%MELEBIHI TOTAL%Melebihi total kontrak Rp 1.000.000%'));

select pg_temp.cek('tidak ada pesan ke pelaksana yang menyebut Pak Avi',
  not exists (select 1 from loonars2_outbox where nomor = '6281100000002' and pesan like '%Pak Avi%'));
update loonars2_settings set nota_wajib_minimal = 1000000;
select 'SEMUA UJI PERIKSA KELENGKAPAN LULUS';
