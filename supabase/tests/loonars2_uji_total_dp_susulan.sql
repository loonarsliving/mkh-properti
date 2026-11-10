-- Uji migrasi 0066 (tanyakan total DP untuk pengajuan yang sudah terkirim). Setelah loonars2_uji_kontrak_dp.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';

-- Pengajuan lama tanpa total (seperti M-100/M-101 sebelum 0064): langsung lewat fungsi pengajuan.
create temp table lama as
select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"material","unit":["14","15"],"deskripsi":"DP genteng | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":3000000},
    {"jenis":"material","unit":["14","15"],"deskripsi":"DP rangka baja | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":3000000}]'::jsonb,
  'Vando Uji', '6281100000002', 'wa') h) s;
create temp table kode as select kodes ->> 0 a, kodes ->> 1 b from lama;

create temp table h1 as select public.loonars2_minta_total_dp(array[(select a from kode), (select b from kode)]) h;
select pg_temp.cek('minta total: status ditanyakan, pending 24 jam lengkapi_dp',
  (select h ->> 'status' = 'ditanyakan' from h1)
  and exists (select 1 from loonars2_wa_pending where nomor = '6281100000002' and aksi = 'lengkapi_dp' and kedaluwarsa_pada > now() + interval '23 hours'));
select pg_temp.cek('WA ke pelaksana berisi kedua kode dan nominal',
  exists (select 1 from loonars2_outbox where nomor = '6281100000002' and jenis = 'minta_total_dp'
           and pesan like '%Saya memeriksa ulang pengajuan DP%1. ' || (select a from kode) || ' DP genteng — Rp 3.000.000%2. ' || (select b from kode) || ' DP rangka baja%'));

select pg_temp.cek('balasan total untuk baris 1: tersimpan, baris 2 masih ditanya',
  (pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"no":1,"total":9000000}]}') ->> 'status') = 'menunggu_total_dp'
  and not exists (select 1 from loonars2_kontrak_dp where item = 'DP genteng'));
select pg_temp.cek('total kurang dari DP ditolak',
  (pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":1000000}]}') ->> 'balasan') like '%harus lebih besar%');
select pg_temp.wa('6281100000002', 'total_dp', '{"daftar":[{"total":15000000}]}') ->> 'status';
select pg_temp.cek('semua dijawab: dua kontrak dibuat dengan total yang benar',
  (select total = 9000000 from loonars2_kontrak_dp where item = 'DP genteng')
  and (select total = 15000000 from loonars2_kontrak_dp where item = 'DP rangka baja'));
select pg_temp.cek('kedua baris unit tertaut; sisa = total − DP',
  (select count(*) from loonars2_material_requests where kelompok = (select a from kode) and kontrak_dp_id is not null) = 2
  and (select sisa = 6000000 from loonars2_v_kontrak_dp where item = 'DP genteng')
  and (select sisa = 12000000 from loonars2_v_kontrak_dp where item = 'DP rangka baja'));
select pg_temp.cek('rincian lama diberi keterangan total, rekening tetap',
  exists (select 1 from loonars2_material_requests where kelompok = (select a from kode)
           and deskripsi like 'DP genteng (DP dari total Rp 9.000.000, sisa Rp 6.000.000) | rek: BCA 7855066190%'));
select pg_temp.cek('owner dikabari',
  exists (select 1 from loonars2_outbox where jenis = 'total_dp_susulan' and pesan like '%melengkapi total DP%DP genteng → kontrak D-%total Rp 9.000.000, DP Rp 3.000.000, sisa Rp 6.000.000%'));
select pg_temp.cek('pending selesai', not exists (select 1 from loonars2_wa_pending where nomor = '6281100000002' and kedaluwarsa_pada > now()));
select pg_temp.cek('pelunasan genteng berikutnya ditautkan ke kontrak itu',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"pelunasan genteng","nominal":6000000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'diajukan');
select pg_temp.cek('... sisa genteng 0', (select sisa = 0 from loonars2_v_kontrak_dp where item = 'DP genteng'));
select pg_temp.cek('minta ulang kode yang sudah punya kontrak: tidak ada',
  (public.loonars2_minta_total_dp(array[(select a from kode)]) ->> 'status') = 'tidak_ada');

select 'SEMUA UJI TOTAL DP SUSULAN LULUS';

-- 0067: pesan ke pelaksana tidak menyebut owner
select pg_temp.cek('tidak ada fungsi loonars2 yang menyebut Pak Avi / persetujuan owner',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like '%loonars2%' and pg_get_functiondef(p.oid) ~ '(Pak Avi|PERSETUJUAN OWNER|persetujuan owner)'));
select pg_temp.cek('pertanyaan total DP bersuara sistem sendiri',
  public._loonars2_teks_minta_total_dp('[{"no":1,"nama":"DP x","nominal":1000}]') like '%Saya perlu totalnya untuk mencatat sisa pembayaran%');
select pg_temp.cek('ringkasan pengajuan baru tanpa nama owner',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["14"],"deskripsi":"Bensin genset","nominal":150000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'balasan') like '%MENUNGGU PERSETUJUAN. Tiap baris diproses%');
select 'SEMUA UJI SUARA CFO LULUS';
