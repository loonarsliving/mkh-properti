-- Uji migrasi 0056 (rekening tujuan pada pengajuan pelaksana + pesan owner ala Loonars 1). Setelah loonars2_uji_laporan_utang.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

-- 1. Pembaca rekening
select pg_temp.cek('rekening: nama + Bank + nomor ala chat Vando/owner',
  public._loonars2_ekstrak_rekening('mami ini rekeningku ya REBECCA DINDA PRASAS Bank Mandiri 1640009977150') = 'MANDIRI 1640009977150 a.n. REBECCA DINDA PRASAS');
select pg_temp.cek('rekening: nomor bertanda hubung + a.n.',
  public._loonars2_ekstrak_rekening('BCA 037-301-1441 a.n. Anang Setiyatno untuk tukang') = 'BCA 0373011441 a.n. ANANG SETIYATNO');
select pg_temp.cek('rekening: nominal biasa bukan rekening; nominal setelah rekening tidak ikut',
  public._loonars2_ekstrak_rekening('reimburse mas sarno 972.000') is null
  and public._loonars2_ekstrak_rekening('bca 1234567890 972.000') = 'BCA 1234567890');
select pg_temp.cek('rekening: nomor lalu bank', public._loonars2_ekstrak_rekening('transfer ke 7855066190 BCA a/n Irfan') like 'BCA 7855066190%');
select pg_temp.cek('rentang unit', public._loonars2_rentang_unit(array[1,2,3,4,5,6]) = '1–6' and public._loonars2_rentang_unit(array[1,3,4]) = '1,3,4');

-- Siapkan unit dibangun
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","15"]}') ->> 'status';
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';

-- 2. Baris tanpa rekening: ditanya, belum ada yang dibuat
create temp table n0 as select (select count(*) from loonars2_material_requests) m, (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') o;
select pg_temp.cek('baris tanpa rekening: status menunggu_rekening, belum ada pengajuan, ditanya per baris',
  (select (h ->> 'status') = 'menunggu_rekening' and (h ->> 'balasan') like '%1. Reimburse mas sarno%972.000%' and (h ->> 'balasan') like '%2. UD Pasir Uji%'
     from (select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["14"],"deskripsi":"Reimburse mas sarno","nominal":972000},{"jenis":"material","unit":["14"],"deskripsi":"Pasir","toko":"UD Pasir Uji","nominal":1500000}]}') h) s)
  and (select count(*) from loonars2_material_requests) = (select m from n0));

-- 3. Balasan rekening bernomor
select pg_temp.cek('balasan "2. ..." mengisi baris 2 dan menanyakan sisanya',
  (select (h ->> 'status') = 'menunggu_rekening' and (h ->> 'balasan') like '%1. Reimburse mas sarno%' and (h ->> 'balasan') not like '%2. UD Pasir Uji%'
     from (select pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"no":2,"rekening":"Mandiri 9876543210 a.n. UD Pasir Uji"}]}') h) s));
select pg_temp.cek('balasan tanpa rekening terbaca: diminta ulang',
  (pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"rekening":"ya nanti saya kirim"}]}') ->> 'balasan') like '%belum terbaca%');
select pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"rekening":"BCA 1112223334 a.n. Sarno"}]}') ->> 'status';
select pg_temp.cek('semua rekening lengkap: 2 pengajuan dibuat, 2 pesan owner terpisah',
  (select count(*) from loonars2_material_requests) = (select m from n0) + 2
  and (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') = (select o from n0) + 2);
select pg_temp.cek('pesan owner: item, nilai, rekening (nomor disalin), diinput oleh, cara bayar & tolak',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Item: Biaya: Reimburse mas sarno%Nilai: Rp 972.000%BCA 1112223334 a.n. SARNO%No. rek (salin): 1112223334%Diinput oleh: Vando Uji%kirim foto bukti transfer%TOLAK M-%')
  and exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%MANDIRI 9876543210 a.n. UD PASIR UJI%'));
select pg_temp.cek('rekening tersimpan di rincian pengajuan', exists (select 1 from loonars2_material_requests where deskripsi like 'Reimburse mas sarno | rek: BCA 1112223334 a.n. SARNO'));

-- 4. Rekening diingat untuk pengajuan berikutnya
create temp table n4 as select count(*) o from loonars2_outbox where jenis = 'pengajuan_mingguan';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["14"],"deskripsi":"Reimburse mas sarno","nominal":500000}]}') ->> 'status';
select pg_temp.cek('penerima yang sama minggu depan: rekening terisi otomatis, tidak ditanya',
  (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') = (select o from n4) + 1
  and exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Nilai: Rp 500.000%BCA 1112223334 a.n. SARNO%'));

-- 5. Cicilan toko: rekening toko diingat
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","nominal":1000000,"deskripsi":"cicilan TB Maju","rekening":"BCA 5556667778 a.n. TB Maju"}]}') ->> 'status';
select pg_temp.cek('rekening toko tersimpan di catatan toko', (select catatan like 'rek: BCA 5556667778 a.n. TB MAJU' from loonars2_toko where nama = 'TB Maju'));
select pg_temp.cek('cicilan berikutnya ke toko yang sama tidak ditanya rekening',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","nominal":500000,"deskripsi":"cicilan TB Maju"}]}') ->> 'status') = 'diajukan');

-- 6. Lewati rekening
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["15"],"deskripsi":"Bensin genset","nominal":200000}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'tanpa_rekening') ->> 'status';
select pg_temp.cek('"tanpa rekening" melanjutkan pengajuan; pesan owner menyebut rekening belum dilampirkan',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Bensin genset%belum dilampirkan%'));

-- 7. Pengajuan tunggal & bahan tunai ditanya; utang kredit tidak
select pg_temp.cek('ajukan (belanja kecil satu unit) tanpa rekening: ditanya',
  (pg_temp.wa('6281100000002', 'ajukan', '{"unit":"14","kategori":"material","deskripsi":"cat tembok","toko":"TB Warna","nominal":300000}') ->> 'status') = 'menunggu_rekening');
select pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"rekening":"BRI 123456789012 a.n. TB Warna"}]}') ->> 'status';
select pg_temp.cek('ajukan setelah rekening dibalas: pesan owner L2-n memuat rekening dan format baru',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan' and pesan like '%PENGAJUAN LOONARS 2 — L2-%Nilai: Rp 300.000%BRI 123456789012 a.n. TB WARNA%TOLAK L2-%'));
select pg_temp.cek('utang (kredit) tidak menanyakan rekening',
  (pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Kredit Uji","unit":["14"],"deskripsi":"besi","nominal":700000}') ->> 'status') = 'diajukan');

-- 8. Hanya pelaksana yang punya pending rekening
select pg_temp.cek('owner mengirim rekening: tidak ada pending (bukan urusan modul)',
  (pg_temp.wa('6281100000001', 'rekening', '{"daftar":[{"rekening":"BCA 1234567890 a.n. X"}]}') ->> 'status') = 'tidak_ada_pending');
select pg_temp.cek('pelaksana tanpa pending: tidak_ada_pending',
  (pg_temp.wa('6281100000002', 'rekening', '{"daftar":[{"rekening":"BCA 1234567890 a.n. X"}]}') ->> 'status') = 'tidak_ada_pending');

select pg_temp.cek('RAB per unit bersih: nama item bahan tidak memuat rekening',
  exists (select 1 from loonars2_bahan_unit where item = 'Pasir') and not exists (select 1 from loonars2_bahan_unit where item like '%rek:%'));

select 'SEMUA UJI REKENING LULUS';
