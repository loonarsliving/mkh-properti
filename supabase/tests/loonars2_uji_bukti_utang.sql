-- Uji migrasi 0052 (foto bukti transfer pembayaran utang toko). Dijalankan SETELAH loonars2_uji_bukti.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.sisa(t text) returns numeric language sql as $$ select sisa_utang from loonars2_v_toko where nama = t $$;

-- Bersihkan pengajuan yang masih menunggu dari uji sebelumnya.
update loonars2_material_requests set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_cicilan set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
-- Dua toko dengan utang sah (utang pelaksana langsung sah).
select pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Besi Uji","unit":["14"],"deskripsi":"besi","nominal":20000000}') ->> 'status';
select pg_temp.wa('6281100000002', 'utang', '{"toko":"UD Semen Uji","unit":["14"],"deskripsi":"semen","nominal":2000000}') ->> 'status';
select pg_temp.cek('dua toko berutang', pg_temp.sisa('TB Besi Uji') = 20000000 and pg_temp.sisa('UD Semen Uji') = 2000000);

-- 1. Pembaca keterangan
select pg_temp.cek('keterangan utang toko dikenali',
  public._loonars2_ket_utang_toko('Pembayaran utang toko bangunan loonars 2')
  and public._loonars2_ket_utang_toko('Ini adalah pembayaran utang toko bangunan toko besi')
  and public._loonars2_ket_utang_toko('cicilan TB Maju'));
select pg_temp.cek('keterangan proyek lain / kode KK tidak diambil',
  not public._loonars2_ket_utang_toko('KK-413 gorden toko') and not public._loonars2_ket_utang_toko('utang toko Loonars Living')
  and not public._loonars2_ket_utang_toko('gaji tukang minggu 1') and not public._loonars2_ket_utang_toko(null));
select pg_temp.cek('bukti_kandidat melapor ada bila keterangan menyebut utang toko',
  (pg_temp.wa('6281100000001', 'bukti_kandidat', '{"keterangan":"Pembayaran utang toko bangunan"}') ->> 'jumlah')::int
  > (pg_temp.wa('6281100000001', 'bukti_kandidat', '{"keterangan":"gaji tukang"}') ->> 'jumlah')::int);

-- 2. Nominal lebih besar dari sisa utang mana pun: tidak dicatat
select pg_temp.cek('nominal melebihi semua sisa utang: tidak dicatat, jelaskan sisa per toko',
  (select (h ->> 'status') = 'perlu_info' and (h ->> 'balasan') like '%TB Besi Uji: sisa%'
     from (select pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":99000000,"penerima":"X","keterangan":"Pembayaran utang toko bangunan"}') h) s));

-- 3. Toko tidak disebut, hanya satu toko yang sisa utangnya cukup (9.173.000) -> otomatis
create temp table sebelum as select (select saldo from loonars2_v_rekening where kode = 'C') as c;
select pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":17173000,"penerima":"PAPANG WIDIYANTO DANAMON 9036 9271 0811","tanggal":"19 Oktober 2026","keterangan":"Pembayaran utang toko bangunan loonars 2","bukti_url":"https://contoh/tf-utang.jpg"}') ->> 'balasan';
select pg_temp.cek('bukti ke toko satu-satunya yang cukup: cicilan dibayar, sisa utang turun jadi 2.827.000', pg_temp.sisa('TB Besi Uji') = 2827000
  and exists (select 1 from loonars2_cicilan where nominal = 17173000 and status = 'dibayar' and catatan like '%PAPANG WIDIYANTO%'));
select pg_temp.cek('saldo C turun (dana talangan bila kurang)', (select saldo from loonars2_v_rekening where kode = 'C') = (select c from sebelum) - 17173000);
select pg_temp.cek('bukti tersimpan di pembayaran', exists (select 1 from loonars2_disbursements where bukti_url = 'https://contoh/tf-utang.jpg'));
select pg_temp.cek('pelaksana menerima foto bukti', exists (select 1 from loonars2_outbox where nomor = '6281100000002' and gambar_url = 'https://contoh/tf-utang.jpg'));

-- 4. Bukti yang sama tidak dicatat dua kali
select pg_temp.cek('bukti kembar (nominal + penerima sama) ditolak',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":17173000,"penerima":"PAPANG WIDIYANTO DANAMON 9036 9271 0811","keterangan":"pembayaran utang toko","bukti_url":"https://contoh/tf-utang2.jpg"}') ->> 'balasan') like '%sudah dicatat%'
  and (select count(*) from loonars2_cicilan where nominal = 17173000 and status = 'dibayar') = 1);

-- 5. Nama toko di keterangan menentukan toko (meski ada toko lain yang cukup)
select pg_temp.wa('6281100000002', 'utang', '{"toko":"UD Semen Uji","unit":["15"],"deskripsi":"pasir","nominal":1500000}') ->> 'status';
select pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":1000000,"penerima":"UD SEMEN","keterangan":"bayar utang UD Semen Uji","bukti_url":"https://contoh/tf-semen.jpg"}') ->> 'balasan';
select pg_temp.cek('toko disebut di keterangan: UD Semen Uji berkurang 1 jt', pg_temp.sisa('UD Semen Uji') = 2500000);

-- 6. Dua toko sama-sama cukup dan tidak disebut: tanya, jangan menebak
select pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Besi Uji","unit":["14"],"deskripsi":"besi lagi","nominal":2000000}') ->> 'status';
select pg_temp.cek('dua toko cukup, toko tak disebut: tidak dicatat, minta nama toko',
  (select (h ->> 'status') = 'perlu_info' and (h ->> 'balasan') like '%beberapa toko%'
     from (select pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":500000,"penerima":"Y","keterangan":"pembayaran utang toko","bukti_url":"https://contoh/tf-x.jpg"}') h) s)
  and pg_temp.sisa('TB Besi Uji') = 4827000 and pg_temp.sisa('UD Semen Uji') = 2500000);

-- 7. Pelaksana tidak bisa memakai jalur ini
select pg_temp.cek('bukti dari pelaksana tidak mencatat cicilan',
  (pg_temp.wa('6281100000002', 'bukti_transfer', '{"nominal":500000,"penerima":"Y","keterangan":"pembayaran utang toko TB Besi Uji","bukti_url":"https://contoh/tf-y.jpg"}') ->> 'status') = 'tidak_cocok');
select pg_temp.cek('saldo C tidak ada yang hilang di luar uji ini', (select count(*) from loonars2_cicilan where status = 'dibayar' and catatan like 'Bukti transfer ke%') = 2);

select 'SEMUA UJI BUKTI UTANG TOKO LULUS';
