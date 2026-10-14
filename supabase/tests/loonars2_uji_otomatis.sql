-- Uji migrasi 0048 (borongan otomatis, biaya lain tanpa unit, cicilan lunas).
-- Dijalankan SETELAH semua uji sebelumnya pada database yang sama.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.u(nomor int) returns smallint language sql as $$ select id from loonars2_units where loonars2_units.nomor = $1 $$;

-- 1. Ketentuan standar tercatat di pengaturan
select pg_temp.cek('ketentuan standar tukang: 35 jt, retensi 9 jt, 12 minggu',
  (select tukang_nilai_per_unit = 35000000 and tukang_retensi_per_unit = 9000000 and tukang_minggu = 12 from loonars2_settings));

-- 2. Gelombang baru: Vando menjawab unit 10,11 saja; owner tidak menyiapkan apa pun
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["10","11"]}') ->> 'status';
select pg_temp.cek('hanya unit 10 dan 11 yang sedang dibangun', (select count(*) = 2 from loonars2_units where sedang_dibangun));
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang Pak Budi minggu ini"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('borongan Pak Budi dibuat otomatis untuk unit 10,11 dengan ketentuan standar',
  (select jumlah_unit = 2 and nilai_per_unit = 35000000 and retensi_per_unit = 9000000 and jumlah_minggu = 12 and total_mingguan = 52000000
     from loonars2_v_borongan where nama = 'Pak Budi'));
select pg_temp.cek('hanya Pak Budi yang diajukan (nama disebut): minggu 1 = 4.333.333 dibagi 2 unit',
  (select count(*) = 2 and sum(nominal) = 4333333 and bool_and(minggu_ke = 1)
     from loonars2_material_requests where borongan_id = (select id from loonars2_borongan where nama = 'Pak Budi')));
select pg_temp.cek('pengajuan Pak Anang tidak ikut terbawa saat nama lain disebut',
  (select count(distinct minggu_ke) = 2 from loonars2_material_requests where borongan_id = (select id from loonars2_borongan where nama = 'Pak Anang') and not retensi));
select pg_temp.cek('owner diberi tahu borongan dibuat otomatis',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Borongan "Pak Budi" dicatat otomatis%'));
select pg_temp.cek('pembulatan 12 minggu Pak Budi = 52 jt persis',
  (select sum(public._loonars2_nominal_minggu(b.id, m)) = 52000000 from loonars2_borongan b, generate_series(1, 12) m where b.nama = 'Pak Budi'));
select pg_temp.cek('pembuatan borongan otomatis dicatat di audit log',
  exists (select 1 from loonars2_audit_log where tabel = 'loonars2_borongan' and nilai_baru ->> 'nama' = 'Pak Budi'));
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_material_requests where borongan_id = (select id from loonars2_borongan where nama = 'Pak Budi') limit 1), 'setuju', true, 'buffer', true)) ->> 'status';

-- 3. Tanpa nama: semua borongan aktif diajukan sekaligus
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('semua borongan aktif diajukan: Pak Anang minggu 3 dan Pak Budi minggu 2 dalam satu kode',
  (select count(distinct borongan_id) = 2 from loonars2_material_requests where kelompok = (select max(kelompok) from loonars2_material_requests where borongan_id is not null and status = 'menunggu') and borongan_id is not null)
  and (select max(minggu_ke) = 3 from loonars2_material_requests where borongan_id = (select id from loonars2_borongan where nama = 'Pak Anang'))
  and (select max(minggu_ke) = 2 from loonars2_material_requests where borongan_id = (select id from loonars2_borongan where nama = 'Pak Budi')));
select pg_temp.cek('borongan yang menunggu persetujuan tidak diajukan dobel (dilewati dengan catatan)',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":[],"deskripsi":"tukang minggu ini"}]}') ->> 'status') = 'menunggu_unit'
  and (pg_temp.wa('6281100000002', 'ya') ->> 'balasan') like '%masih menunggu persetujuan%');

-- 4. Biaya lain tanpa unit -> dibagi rata ke unit sedang dibangun
select pg_temp.cek('biaya lain tanpa unit: ditanya unit dulu',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","deskripsi":"listrik proyek","nominal":600001}]}') ->> 'status') = 'menunggu_unit');
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('biaya lain 600.001 dibagi rata ke unit 10,11 (300.001 + 300.000), kategori lain',
  (select count(*) = 2 and sum(nominal) = 600001 and bool_and(kategori = 'lain') from loonars2_material_requests where deskripsi like 'listrik proyek%'));
select pg_temp.cek('biaya lain dengan unit disebut tidak ditanya lagi',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"lain","unit":["10"],"deskripsi":"bensin","nominal":200000}]}') ->> 'status') = 'diajukan');

-- 5. Cicilan utang toko: lunas / tanpa nominal
select pg_temp.cek('cicilan tanpa nominal ditolak sambil menyebut sisa utang toko',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","deskripsi":"cicilan TB Maju"}]}') ->> 'balasan') like '%Sisa utang TB Maju saat ini Rp%');
create temp table sisa as select sisa_utang as s from loonars2_v_toko where nama = 'TB Maju';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","deskripsi":"cicilan TB Maju lunas"}]}') ->> 'status';
select pg_temp.cek('cicilan "lunas" memakai seluruh sisa utang dari tabel utang',
  (select nominal = (select s from sisa) from loonars2_cicilan order by id desc limit 1));

-- 6. Tanpa daftar unit sama sekali: tetap ditanya, tidak ada yang dicatat
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["10","11"]}') ->> 'status';
select pg_temp.cek('integritas: tidak ada baris upah borongan ganda per (borongan, minggu, unit)',
  not exists (select 1 from loonars2_material_requests where borongan_id is not null and not retensi and status <> 'ditolak'
              group by borongan_id, minggu_ke, unit_id having count(*) > 1));
