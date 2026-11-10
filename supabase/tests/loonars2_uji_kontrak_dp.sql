-- Uji migrasi 0065 (total DP disimpan sebagai kontrak D-n; pembayaran lanjutan ditautkan & dicek sisa). Setelah loonars2_uji_dp.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';

-- 1. Backfill: DP dari uji 0064 sudah menjadi kontrak
select pg_temp.cek('backfill: DP kaca (total 10 jt) jadi satu kontrak, kedua baris unit tertaut',
  (select count(*) from loonars2_kontrak_dp where item = 'DP kaca' and total = 10000000) = 1
  and (select count(*) from loonars2_material_requests m join loonars2_kontrak_dp k on k.id = m.kontrak_dp_id where k.item = 'DP kaca') = 2);
select pg_temp.cek('view: sisa = total − pengajuan tidak ditolak',
  (select sisa = 7000000 and menunggu = 3000000 and status = 'berjalan' from loonars2_v_kontrak_dp where item = 'DP kaca'));
select pg_temp.cek('penerima kontrak = rekening', (select penerima = 'BCA 7855066190 a.n. NAIMUDDIN IRFAN' from loonars2_kontrak_dp where item = 'DP kaca'));
select pg_temp.cek('kunci item', public._loonars2_kunci_dp('pelunasan kaca 7 juta') = 'kaca' and public._loonars2_kunci_dp('DP kaca (DP dari total Rp 10.000.000, sisa Rp 7.000.000) | rek: BCA 1') = 'kaca');

-- 2. DP baru dengan total -> kontrak baru langsung
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14","15"],"deskripsi":"DP plafon gypsum","nominal":4000000,"total_dp":12000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status';
select pg_temp.cek('kontrak baru tersimpan dengan total 12 jt dan kode D-n',
  exists (select 1 from loonars2_kontrak_dp where item = 'DP plafon gypsum' and total = 12000000 and kode like 'D-%'));
select pg_temp.cek('pesan owner memuat baris kontrak dengan sisa',
  exists (select 1 from loonars2_outbox where pesan like '%Item: Belanja: DP plafon gypsum%📑 Kontrak D-%(DP plafon gypsum): total Rp 12.000.000%Sudah dibayar Rp 0%pengajuan ini Rp 4.000.000%Sisa setelah ini: Rp 8.000.000%'));

-- 3. Pelunasan item yang sama: tertaut, tidak ditanya total
select pg_temp.cek('pelunasan plafon: langsung diajukan, tidak ditanya total',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14","15"],"deskripsi":"pelunasan plafon gypsum","nominal":8000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'diajukan');
select pg_temp.cek('pelunasan tertaut ke kontrak yang sama; sisa jadi 0',
  (select sisa = 0 from loonars2_v_kontrak_dp where item = 'DP plafon gypsum')
  and exists (select 1 from loonars2_material_requests where deskripsi like 'pelunasan plafon gypsum [lanjutan D-%, sisa sebelum ini Rp 8.000.000]%'));
select pg_temp.cek('pesan owner pelunasan: sisa setelah ini Rp 0',
  exists (select 1 from loonars2_outbox where pesan like '%pelunasan plafon gypsum%Kontrak D-%total Rp 12.000.000%Sisa setelah ini: Rp 0%'));

-- 4. Pembayaran melebihi sisa: ditandai di pesan owner
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"pelunasan kaca","nominal":9000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status';
select pg_temp.cek('melebihi sisa: rincian bertanda dan owner diberi 🔴',
  exists (select 1 from loonars2_material_requests where deskripsi like 'pelunasan kaca [lanjutan D-%MELEBIHI SISA]%')
  and exists (select 1 from loonars2_outbox where pesan like '%pelunasan kaca%Sisa setelah ini: -Rp 2.000.000%Melebihi total kontrak Rp 2.000.000%')
  and (select status = 'melebihi' from loonars2_v_kontrak_dp where item = 'DP kaca'));

-- 5. Kode D-n eksplisit
create temp table kd as select kode from loonars2_kontrak_dp where item = 'DP kusen';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', jsonb_build_object('baris', jsonb_build_array(jsonb_build_object(
  'jenis','material','unit',jsonb_build_array('14'),'deskripsi','bayar ' || (select kode from kd),'nominal',1000000,'rekening','BCA 7855066190 a.n. Naimuddin Irfan')))) ->> 'status';
select pg_temp.cek('menyebut D-n: tertaut ke kontrak itu',
  (select count(*) from loonars2_material_requests m join loonars2_kontrak_dp k on k.id = m.kontrak_dp_id where k.item = 'DP kusen') = 2);

-- 6. Ditolak: tidak mengurangi sisa
update loonars2_material_requests set status = 'ditolak' where deskripsi like 'pelunasan kaca [lanjutan%';
select pg_temp.cek('pengajuan ditolak tidak dihitung', (select sisa = 7000000 and status = 'berjalan' from loonars2_v_kontrak_dp where item = 'DP kaca'));

-- 7. Item tak dikenal: sejak 0068 pelunasan tanpa kontrak ditanya totalnya; "tanpa total" = lanjut tanpa kontrak
select pg_temp.cek('pelunasan item tanpa kontrak: ditanya total (0068)',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"pelunasan pompa air","nominal":500000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'menunggu_total_dp');
select pg_temp.wa('6281100000002', 'tanpa_total_dp') ->> 'status';
select pg_temp.cek('... "tanpa total": diajukan tanpa tautan kontrak', exists (select 1 from loonars2_material_requests where deskripsi like 'pelunasan pompa air [total belum disebut] | rek:%' and kontrak_dp_id is null));

-- 8. DP kedua item yang sama tanpa total: tertaut, tidak ditanya
select pg_temp.cek('DP kedua plafon (kontrak sudah lunas sisa 0) -> tidak ada kontrak berjalan, ditanya total',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"DP plafon gypsum","nominal":1000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'menunggu_total_dp');
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
select pg_temp.cek('DP kedua kaca (kontrak berjalan) tidak ditanya total',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"DP kedua kaca","nominal":2000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'diajukan');
select pg_temp.cek('... sisa kaca jadi 5 jt', (select sisa = 5000000 from loonars2_v_kontrak_dp where item = 'DP kaca'));

select 'SEMUA UJI KONTRAK DP LULUS';
