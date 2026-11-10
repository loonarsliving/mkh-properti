-- Uji migrasi 0070 (bukti transfer menyebut kode; pilih kode saat ambigu). Paling akhir.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.status(k text) returns text language sql as
  $$ select string_agg(distinct status, ',') from loonars2_material_requests where kelompok = k $$;

select pg_temp.cek('kode dari teks', public._loonars2_kode_dari_teks('L2 m100') = 'M-100' and public._loonars2_kode_dari_teks('L2 bayar M-101') = 'M-101'
  and public._loonars2_kode_dari_teks('bayar L2-12') = 'L2-12' and public._loonars2_kode_dari_teks('semen 2 m 3') is null and public._loonars2_kode_dari_teks(null) is null);

-- Skenario insiden: dua kode Rp 3 jt ke rekening yang sama, keduanya menunggu.
update loonars2_material_requests set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_cicilan set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
create temp table k as
select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"material","deskripsi":"DP kaca (DP dari total Rp 11.652.000, sisa Rp 8.652.000) | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":3000000},
    {"jenis":"material","deskripsi":"DP pipa air panas (DP dari total Rp 10.670.000, sisa Rp 7.670.000) | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":3000000}]'::jsonb,
  'Vando Uji', '6281100000002', 'wa') h) s;
create temp table kode as select kodes ->> 0 a, kodes ->> 1 b from k;

-- 1. Foto tanpa keterangan: ambigu, owner diberi pilihan balas kode
select pg_temp.cek('ambigu: owner diminta balas kode, foto diingat',
  (select (h ->> 'status') = 'ambigu' and (h ->> 'balasan') like '%cukup balas kodenya%'
     from (select pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":3000000,"penerima":"NAIMUDDIN IRFAN MIAGURAT BCA 7855 0661 90","bukti_url":"https://contoh.test/bukti1.jpg"}') h) s)
);
select pg_temp.cek('pending pilih_bukti tersimpan', exists (select 1 from loonars2_wa_pending where nomor = '6281100000001' and aksi = 'pilih_bukti' and kedaluwarsa_pada > now()));
select pg_temp.cek('balas "M-…" (bayar_kelompok tanpa foto): kode itu disetujui & dibayar dengan foto tadi',
  (pg_temp.wa('6281100000001', 'bayar_kelompok', jsonb_build_object('kode', (select a from kode))) ->> 'balasan') like '%dicatat untuk M-%');
select pg_temp.cek('... status dibayar, bukti tersimpan, kode lain tetap menunggu',
  pg_temp.status((select a from kode)) = 'dibayar' and pg_temp.status((select b from kode)) = 'menunggu'
  and exists (select 1 from loonars2_disbursements where bukti_url = 'https://contoh.test/bukti1.jpg'));
select pg_temp.cek('pending terpakai', not exists (select 1 from loonars2_wa_pending where nomor = '6281100000001' and aksi = 'pilih_bukti' and kedaluwarsa_pada > now()));

-- 2. Foto berketerangan "L2 m<kode>": langsung kode itu (insiden "L2 m100")
select pg_temp.cek('keterangan menyebut kode: langsung dicatat',
  (pg_temp.wa('6281100000001', 'bukti_transfer', jsonb_build_object('nominal', 3000000, 'penerima', 'NAIMUDDIN IRFAN BCA 7855066190',
     'bukti_url', 'https://contoh.test/bukti2.jpg', 'keterangan', 'L2 ' || lower(replace((select b from kode), '-', '')))) ->> 'balasan') like '%dicatat untuk M-%');
select pg_temp.cek('... kode kedua dibayar', pg_temp.status((select b from kode)) = 'dibayar');

-- 3. Nominal tidak sama dengan kode yang disebut: tidak dicatat
create temp table k2 as
select h -> 'kodes' kodes from (select public._loonars2_ajukan_mingguan(
  '[{"jenis":"lain","deskripsi":"sewa scaffolding | rek: BCA 7855066190 a.n. NAIMUDDIN IRFAN","nominal":2500000}]'::jsonb, 'Vando Uji', '6281100000002', 'wa') h) s;
select pg_temp.cek('nominal beda: ditolak, tetap menunggu',
  (pg_temp.wa('6281100000001', 'bayar_kelompok', jsonb_build_object('kode', (select kodes ->> 0 from k2), 'nominal', 2000000, 'bukti_url', 'https://contoh.test/b3.jpg')) ->> 'balasan') like '%tidak sama dengan total%'
);
select pg_temp.cek('... masih menunggu', pg_temp.status((select kodes ->> 0 from k2)) = 'menunggu');
-- 4. Pelaksana tidak bisa menyetujui lewat foto
select pg_temp.cek('pelaksana menyebut kode menunggu: tidak dicatat',
  (pg_temp.wa('6281100000002', 'bayar_kelompok', jsonb_build_object('kode', (select kodes ->> 0 from k2), 'nominal', 2500000, 'bukti_url', 'https://contoh.test/b4.jpg')) ->> 'balasan') like '%masih menunggu persetujuan%');
-- 5. Owner foto + kode + nominal benar
select pg_temp.cek('owner foto + kode + nominal benar: dibayar',
  (pg_temp.wa('6281100000001', 'bayar_kelompok', jsonb_build_object('kode', (select kodes ->> 0 from k2), 'nominal', 2500000, 'bukti_url', 'https://contoh.test/b5.jpg')) ->> 'balasan') like '%dicatat untuk%');
select pg_temp.cek('... dibayar', pg_temp.status((select kodes ->> 0 from k2)) = 'dibayar');
-- 6. Tanpa foto & tanpa pending: perilaku lama
select pg_temp.cek('bayar_kelompok tanpa foto & pending: perilaku lama',
  (pg_temp.wa('6281100000001', 'bayar_kelompok', jsonb_build_object('kode', (select kodes ->> 0 from k2))) ->> 'balasan') like 'Tidak ada baris%');

select 'SEMUA UJI BUKTI KODE LULUS';
