-- Uji migrasi 0049 (foto bukti transfer dicocokkan otomatis + dana talangan).
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, case when a in ('ajukan', 'ajukan_mingguan', 'bahan') and not (d ? 'uji_rekening') then d || '{"tanpa_rekening":true}'::jsonb else d end) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.saldo(k text) returns numeric language sql as $$ select saldo from loonars2_v_rekening where kode = k $$;

-- Keadaan nyata: tidak ada penjualan, saldo C = 0, pelaksana mengajukan upah borongan unit baru.
-- Kosongkan dulu semua yang menunggu dari uji sebelumnya supaya skenario bersih.
update loonars2_material_requests set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_cicilan set status = 'ditolak', alasan_tolak = 'uji' where status in ('menunggu', 'disetujui');
update loonars2_borongan set status = 'batal';
update loonars2_units set sedang_dibangun = false;
update loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 hour';
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["14","15","16","17"]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
create temp table m as select kelompok, sum(nominal) total, count(*) n from loonars2_material_requests where borongan_id is not null and status = 'menunggu' group by kelompok;
select pg_temp.cek('pengajuan upah borongan 4 unit menunggu persetujuan', (select count(*) = 1 from m));
-- Keadaan nyata: saldo C hampir nol (pembangunan berjalan sebelum ada penjualan).
insert into loonars2_disbursements (dari_rekening, kategori, nominal, tanggal, keterangan, sumber, dicatat_oleh)
select 'C', 'lain_konstruksi', saldo - 1000, public._loonars2_hari_ini(), 'uji: kosongkan saldo C', 'web', 'uji' from loonars2_v_rekening where kode = 'C';
select pg_temp.cek('saldo C tinggal Rp 1.000 (lebih kecil dari upah 6,5 jt)', pg_temp.saldo('C') = 1000);
create temp table sebelum as select pg_temp.saldo('C') as c;

-- 1. Kandidat: ada yang menunggu pembayaran
select pg_temp.cek('bukti_kandidat melaporkan ada pengajuan menunggu', (pg_temp.wa('6281100000001', 'bukti_kandidat') ->> 'jumlah')::int > 0);
select pg_temp.cek('nomor asing tidak mendapat apa-apa', (pg_temp.wa('6289999999999', 'bukti_transfer', '{"nominal":1000}') ->> 'status') = 'abaikan');

-- 2. Nominal tidak cocok -> dilewatkan ke alur lain
select pg_temp.cek('nominal tak cocok: tidak_cocok (alur lain yang menangani)',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":537000,"penerima":"Tukang Gorden"}') ->> 'status') = 'tidak_cocok');

-- 3. Pelaksana mengirim bukti padahal belum disetujui owner: tidak ada yang berubah
select pg_temp.cek('bukti dari pelaksana sebelum disetujui: ditahan, tidak dicatat',
  (pg_temp.wa('6281100000002', 'bukti_transfer', jsonb_build_object('nominal', (select total from m))) ->> 'balasan') like '%belum disetujui owner%'
  and (select count(*) = 0 from loonars2_disbursements where talangan));

-- 4. Owner: foto 13 jt tanpa keterangan -> menyetujui + membayar sebagai talangan
select pg_temp.wa('6281100000001', 'bukti_transfer', jsonb_build_object('nominal', (select total from m), 'penerima', 'SARNO', 'bukti_url', 'https://contoh/bukti13jt.jpg')) ->> 'balasan';
select pg_temp.cek('semua baris upah borongan dibayar & bukti terlampir',
  (select count(*) = (select n from m) and bool_and(status = 'dibayar') from loonars2_material_requests where kelompok = (select kelompok from m)));
select pg_temp.cek('pengeluaran tercatat dari C, kategori tukang, total persis, ditandai talangan',
  (select count(*) = (select n from m) and sum(nominal) = (select total from m) and bool_and(talangan and dari_rekening = 'C' and kategori = 'tukang' and bukti_url = 'https://contoh/bukti13jt.jpg') from loonars2_disbursements where keterangan like (select kelompok from m) || '%'));
select pg_temp.cek('saldo C turun persis sebesar pembayaran (minus = dana talangan)', pg_temp.saldo('C') = (select c from sebelum) - (select total from m));
select pg_temp.cek('pelaksana diberi tahu keputusan & pembayaran',
  exists (select 1 from loonars2_outbox where nomor = '6281100000002' and pesan like '%' || (select kelompok from m) || '%DISETUJUI%')
  and exists (select 1 from loonars2_outbox where nomor = '6281100000002' and pesan like '%' || (select kelompok from m) || ' tercatat dibayar%'));
select pg_temp.cek('audit mencatat aktor owner pada pembayaran talangan',
  exists (select 1 from loonars2_audit_log where tabel = 'loonars2_disbursements' and nilai_baru ->> 'talangan' = 'true' and aktor like 'wa:%'));
select pg_temp.cek('bukti yang sama dikirim lagi tidak membayar dobel',
  (pg_temp.wa('6281100000001', 'bukti_transfer', jsonb_build_object('nominal', (select total from m))) ->> 'status') = 'tidak_cocok'
  and (select count(*) = (select n from m) from loonars2_disbursements where talangan));

-- 5. Jalur manual tetap menolak saat saldo C kurang (aturan lama tidak melonggar)
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","deskripsi":"listrik","nominal":300000}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'status';
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_material_requests where deskripsi like 'listrik%' order by id desc limit 1), 'setuju', true, 'buffer', true)) ->> 'status';
select pg_temp.cek('L2 bayar <kode> tetap ditolak bila saldo C kurang',
  (pg_temp.wa('6281100000002', 'bayar_kelompok', jsonb_build_object('kode', (select kelompok from loonars2_material_requests where deskripsi like 'listrik%' order by id desc limit 1))) ->> 'balasan') like '%Saldo C%tidak cukup%');

-- 6. Pembayaran ganda nominal sama: minta kode eksplisit
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["14"],"deskripsi":"bensin","nominal":700000}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["15"],"deskripsi":"solar","nominal":700000}]}') ->> 'status';
select pg_temp.cek('dua pengajuan bernominal sama: ambigu, tidak ada yang dibayar',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":700000}') ->> 'status') = 'ambigu'
  and (select count(*) = 0 from loonars2_material_requests where deskripsi in ('bensin', 'solar') and status = 'dibayar'));
select pg_temp.cek('pesan ambigu menyebut dua kode dan meminta "L2 bayar <kode>"',
  (pg_temp.wa('6281100000001', 'bukti_transfer', '{"nominal":700000}') ->> 'balasan') like '%L2 bayar%');

-- 7. Transfer A->B/C/D yang menunggu dikonfirmasi dari fotonya (hanya owner)
select pg_temp.cek('hanya struktur: kolom talangan ada dan default false', (select column_default = 'false' from information_schema.columns where table_name = 'loonars2_disbursements' and column_name = 'talangan'));
