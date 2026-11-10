-- Uji migrasi 0071 (rincian umum ditanyakan). Paling akhir.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
update loonars2_settings set nota_wajib_minimal = 0;

select pg_temp.cek('rincian umum dikenali',
  public._loonars2_rincian_umum('belanja material | rek: MANDIRI 1850006614645 a.n. SARNO')
  and public._loonars2_rincian_umum('Belanja Bahan bangunan') and public._loonars2_rincian_umum('lain-lain')
  and not public._loonars2_rincian_umum('belanja lampu anyaman 16pcs') and not public._loonars2_rincian_umum('Pasir & matrial')
  and not public._loonars2_rincian_umum('Lain pembayaran air kolam') and not public._loonars2_rincian_umum('kos'));

create temp table n0 as select count(*) m from loonars2_material_requests;
select pg_temp.cek('kasus M-102: "belanja material" ditahan dan ditanya barangnya',
  (select (h ->> 'status') = 'menunggu_rincian' and (h ->> 'balasan') like '%Barang apa saja yang dibeli?%1. belanja material — Rp 225.000%L2 rincian%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"belanja material","nominal":225000,"rekening":"Mandiri 1850 0066 1464 5 a.n. Sarno"}]}') h) s)
  and (select count(*) from loonars2_material_requests) = (select m from n0));
select pg_temp.cek('jawaban masih umum ditanya ulang',
  (pg_temp.wa('6281100000002', 'rincian', '{"isi":"bahan bangunan"}') ->> 'balasan') like '%Sebut nama barangnya%');
select pg_temp.cek('jawaban rincian: pengajuan diteruskan',
  (pg_temp.wa('6281100000002', 'rincian', '{"isi":"semen 2 sak, paku 1 kg, kuas"}') ->> 'status') = 'diajukan');
select pg_temp.cek('rincian baru + tulisan awal tersimpan, rekening utuh; pesan owner memuatnya',
  exists (select 1 from loonars2_material_requests where deskripsi like 'semen 2 sak, paku 1 kg, kuas (awal: belanja material) | rek: MANDIRI 1850006614645%')
  and exists (select 1 from loonars2_outbox where pesan like '%Item: Belanja: semen 2 sak, paku 1 kg, kuas (awal: belanja material)%'));
select pg_temp.cek('rincian jelas tidak ditanya',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"material","unit":["14"],"deskripsi":"lampu anyaman 16pcs","nominal":1600000,"rekening":"BCA 7855066190 a.n. Naimuddin Irfan"}]}') ->> 'status') = 'diajukan');
select pg_temp.cek('tukang tidak ditanya', public._loonars2_cek_rincian('ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang","nominal":1000000}]}') = '[]'::jsonb);

-- Susulan untuk kode yang sudah masuk
create temp table k as select h -> 'kodes' ->> 0 kode from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"material","deskripsi":"Belanja Bahan bangunan | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":298500}]'::jsonb, 'Vando Uji', '6281100000002', 'wa') h) s;
select pg_temp.cek('minta rincian susulan: WA ke pelaksana',
  (public.loonars2_minta_rincian(array[(select kode from k)]) ->> 'status') = 'ditanyakan');
select pg_temp.cek('... pesan terkirim ke pelaksana', exists (select 1 from loonars2_outbox where jenis = 'minta_rincian' and nomor = '6281100000002' and pesan like '%Belanja Bahan bangunan — Rp 298.500%'));
select pg_temp.cek('jawaban susulan memperbarui rincian kode itu',
  (pg_temp.wa('6281100000002', 'rincian', '{"isi":"cat tembok 1 pail, roll cat"}') ->> 'balasan') like '%rincian dicatat%');
select pg_temp.cek('... rincian & pesanan bahan diperbarui, owner dikabari',
  exists (select 1 from loonars2_material_requests where kelompok = (select kode from k) and deskripsi like 'cat tembok 1 pail, roll cat (awal: Belanja Bahan bangunan) | rek:%')
  and exists (select 1 from loonars2_outbox where jenis = 'rincian_susulan' and pesan like '%memperjelas M-%cat tembok%'));

update loonars2_settings set nota_wajib_minimal = 1000000;
select 'SEMUA UJI RINCIAN LULUS';
