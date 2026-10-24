-- Uji migrasi 0047 (borongan tukang, bahan kolektif, unit sedang dibangun).
-- Dijalankan SETELAH loonars2_uji.sql, loonars2_uji_utang.sql, loonars2_uji_pelaksana.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, case when a in ('ajukan', 'ajukan_mingguan', 'bahan') and not (d ? 'uji_rekening') then d || '{"tanpa_rekening":true}'::jsonb else d end) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
-- nomor uji: 6281100000001 = owner, 6281100000002 = pelaksana
create function pg_temp.u(nomor int) returns smallint language sql as $$ select id from loonars2_units where loonars2_units.nomor = $1 $$;

-- 1. Borongan: hanya owner, wajib YA --------------------------------------------------
select pg_temp.cek('pelaksana tidak bisa membuat borongan',
  (pg_temp.wa('6281100000002', 'borongan', '{"nama":"Pak Anang","unit":["2","3","4","5","6","7"],"nilai":35000000,"retensi":9000000,"minggu":12}') ->> 'status') = 'tidak_berhak');
select pg_temp.cek('borongan tanpa data lengkap diminta formatnya',
  (pg_temp.wa('6281100000001', 'borongan', '{"nama":"Pak Anang"}') ->> 'status') = 'perlu_info');
select pg_temp.cek('borongan menunggu YA, belum tercatat',
  (pg_temp.wa('6281100000001', 'borongan', '{"nama":"Pak Anang","unit":["2","3","4","5","6","7"],"nilai":35000000,"retensi":9000000,"minggu":12}') ->> 'status') = 'menunggu_ya'
  and not exists (select 1 from loonars2_borongan));
select pg_temp.wa('6281100000001', 'ya') ->> 'balasan';
select pg_temp.cek('borongan tercatat: 6 unit, mingguan 156 jt, 13 jt/minggu',
  (select jumlah_unit = 6 and total_mingguan = 156000000 and total_retensi = 54000000 from loonars2_v_borongan)
  and public._loonars2_nominal_minggu((select id from loonars2_borongan), 1) = 13000000);
select pg_temp.cek('jumlah 12 minggu = total persis',
  (select sum(public._loonars2_nominal_minggu((select id from loonars2_borongan), m)) from generate_series(1, 12) m) = 156000000);
insert into loonars2_borongan (nama, nilai_per_unit, retensi_per_unit, jumlah_minggu, dibuat_oleh, status) values ('Uji Bulat', 1000003, 0, 7, 'uji', 'batal');
insert into loonars2_borongan_unit (borongan_id, unit_id) values ((select id from loonars2_borongan where nama = 'Uji Bulat'), pg_temp.u(15));
select pg_temp.cek('pembulatan: selisih masuk minggu terakhir, jumlah 7 minggu tetap persis 1.000.003',
  (select true)
  and (select sum(x) from (select public._loonars2_nominal_minggu(b.id, m) x from loonars2_borongan b, generate_series(1, 7) m where b.nama = 'Uji Bulat') z) = 1000003
  and (select public._loonars2_nominal_minggu(b.id, 7) from loonars2_borongan b where b.nama = 'Uji Bulat') = 142861);
select pg_temp.cek('unit borongan otomatis ditandai sedang dibangun & proses',
  (select count(*) from loonars2_units where sedang_dibangun and status_bangun = 'proses') = 6);
select pg_temp.cek('borongan dicatat di audit log', exists (select 1 from loonars2_audit_log where tabel = 'loonars2_borongan' and aksi = 'INSERT'));
select pg_temp.cek('unit yang sama tidak bisa masuk dua borongan aktif',
  (pg_temp.wa('6281100000001', 'borongan', '{"nama":"Lain","unit":["3"],"nilai":35000000,"retensi":9000000,"minggu":12}') ->> 'status') = 'menunggu_ya'
  and (pg_temp.wa('6281100000001', 'ya') ->> 'balasan') like '%Sudah masuk borongan aktif lain%'
  and (select count(*) from loonars2_borongan where status = 'aktif') = 1);

-- 2. "tukang minggu ini": ditanya unit dulu, nominal dihitung sistem --------------------
select pg_temp.cek('tukang minggu ini: pelaksana ditanya unit yang dibangun, belum ada yang dicatat',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status') = 'menunggu_unit'
  and not exists (select 1 from loonars2_material_requests where borongan_id is not null));
select pg_temp.cek('pertanyaan menyebut 6 unit yang dibangun',
  (select (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'balasan') like '%2 %AVARA-02%7 %BANYU-01%'));
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('minggu ke-1: 6 baris per unit, total persis 13 jt, minggu_ke=1',
  (select count(*) = 6 and sum(nominal) = 13000000 and bool_and(minggu_ke = 1 and kategori = 'tukang' and not retensi) from loonars2_material_requests where borongan_id is not null));
select pg_temp.cek('owner dikirimi ringkasan upah borongan minggu 1',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Upah borongan Pak Anang minggu ke-1/12%'));
select pg_temp.cek('minggu 2 ditolak selama minggu 1 menunggu (cegah ganda)',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini","unit":["2"]}]}') ->> 'status') = 'menunggu_unit'
  and (pg_temp.wa('6281100000002', 'ya') ->> 'balasan') like '%masih menunggu persetujuan%'
  and (select count(distinct minggu_ke) from loonars2_material_requests where borongan_id is not null) = 1);
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_material_requests where borongan_id is not null limit 1), 'setuju', true)) ->> 'balasan';
select pg_temp.cek('minggu 1 disetujui', not exists (select 1 from loonars2_material_requests where borongan_id is not null and status <> 'disetujui'));
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('minggu 2 diajukan setelah minggu 1 diputuskan; total mingguan tetap 13 jt',
  (select count(distinct minggu_ke) = 2 and sum(nominal) = 26000000 from loonars2_material_requests where borongan_id is not null and not retensi));
select pg_temp.cek('minggu yang sama tidak bisa diajukan dua kali untuk unit yang sama (indeks unik)',
  (select count(*) from loonars2_material_requests where borongan_id is not null and not retensi and status <> 'ditolak' and minggu_ke = 2) = 6);
update loonars2_material_requests set status = 'disetujui' where borongan_id is not null and status = 'menunggu';
update loonars2_borongan set jumlah_minggu = 2 where status = 'aktif';
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","deskripsi":"tukang minggu ini"}]}') ->> 'status';
select pg_temp.cek('melebihi jumlah minggu ditolak',
  (pg_temp.wa('6281100000002', 'ya') ->> 'balasan') like '%sudah diajukan lengkap%');
update loonars2_borongan set jumlah_minggu = 12 where status = 'aktif';

-- 3. Retensi: hanya setelah unit selesai ---------------------------------------------
select pg_temp.cek('retensi ditolak selama unit belum selesai',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"retensi","unit":["2"],"deskripsi":"retensi unit 2"}]}') ->> 'balasan') like '%belum selesai%');
update loonars2_units set status_bangun = 'selesai' where nomor = 2;
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"retensi","unit":["2"],"deskripsi":"retensi unit 2"}]}') ->> 'balasan';
select pg_temp.cek('retensi unit 2 = 9 jt, menunggu persetujuan owner',
  (select count(*) = 1 and sum(nominal) = 9000000 and bool_and(retensi and status = 'menunggu' and kategori = 'tukang') from loonars2_material_requests where retensi));
select pg_temp.cek('retensi tidak bisa diajukan dua kali',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"retensi","unit":["2"],"deskripsi":"retensi unit 2"}]}') ->> 'balasan') like '%sudah pernah diajukan%');
select pg_temp.cek('retensi unit di luar borongan ditolak',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"retensi","unit":["9"],"deskripsi":"retensi unit 9"}]}') ->> 'balasan') like '%tidak ada di borongan%');
select pg_temp.cek('daftar borongan menampilkan progres & retensi',
  (pg_temp.wa('6281100000001', 'daftar_borongan') ->> 'balasan') like '%Pak Anang%Diajukan 2/12%Retensi ditahan%');

-- 4. Bahan kolektif: tanpa unit, dibagi ke unit sedang dibangun ------------------------
select pg_temp.cek('owner tidak bisa memesan bahan',
  (pg_temp.wa('6281100000001', 'bahan', '{"toko":"TB Maju","nominal":1000000}') ->> 'status') = 'tidak_berhak');
select pg_temp.cek('pesan bahan tanpa unit: ditanya dulu',
  (pg_temp.wa('6281100000002', 'bahan', '{"toko":"TB Maju","deskripsi":"semen 100 sak, pasir 12 rit","nominal":8500000,"items":[{"nama":"semen","qty":100,"satuan":"sak"},{"nama":"pasir","qty":12,"satuan":"rit"}]}') ->> 'status') = 'menunggu_unit');
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
create temp table p1 as select * from loonars2_pesanan_bahan order by id desc limit 1;
select pg_temp.cek('pesanan tercatat: total 8,5 jt, kode M',
  (select nominal = 8500000 and kelompok like 'M-%' and jenis = 'tunai' from p1));
select pg_temp.cek('biaya per unit: 6 baris, jumlah persis 8,5 jt, terhubung ke pesanan',
  (select count(*) = 6 and sum(nominal) = 8500000 from loonars2_material_requests where pesanan_id = (select id from p1)));
select pg_temp.cek('RAB: jumlah qty semen seluruh unit = 100, pasir = 12 (persis)',
  (select sum(qty) filter (where item = 'semen') = 100 and sum(qty) filter (where item = 'pasir') = 12 from loonars2_v_rab_bahan));
select pg_temp.cek('RAB: nominal pesanan ini di seluruh unit = 8,5 jt',
  (select sum(nominal) = 8500000 from loonars2_bahan_unit where pesanan_id = (select id from p1) and aktif));
select pg_temp.cek('tiap unit mendapat porsi semen & pasir',
  (select count(distinct unit_id) = 6 from loonars2_bahan_unit where item = 'semen') and (select count(distinct unit_id) = 6 from loonars2_bahan_unit where item = 'pasir'));
select pg_temp.cek('balasan pelaksana menyebut pembagian per unit & perkiraan',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Pembagian bahan%semen%'));
select pg_temp.cek('budget unit terpotong komitmen sesuai bagian (menunggu belum dihitung, disetujui dihitung)',
  (select sum(nominal) from loonars2_material_requests where pesanan_id = (select id from p1) and status = 'menunggu') = 8500000);

-- item dengan tujuan unit tertentu (hasil bacaan AI dari catatan Vando)
select pg_temp.wa('6281100000002', 'bahan', '{"toko":"TB Sinar","deskripsi":"besi dan keramik","nominal":5000000,"items":[{"nama":"besi","qty":60,"satuan":"batang","nilai":3000000,"untuk_unit":["2","3","4"]},{"nama":"keramik","qty":30,"satuan":"dus","nilai":2000000,"untuk_unit":["5","6"]}]}') ->> 'status';
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
create temp table p2 as select * from loonars2_pesanan_bahan order by id desc limit 1;
select pg_temp.cek('besi hanya ke unit 2,3,4 (1 jt per unit), keramik hanya ke unit 5,6',
  (select count(*) = 3 and bool_and(nominal = 1000000) from loonars2_bahan_unit where pesanan_id = (select id from p2) and item = 'besi')
  and (select count(*) = 2 and bool_and(nominal = 1000000) from loonars2_bahan_unit where pesanan_id = (select id from p2) and item = 'keramik'));
select pg_temp.cek('unit 7 tidak kebagian dari pesanan ini; biaya per unit hanya untuk 5 unit',
  not exists (select 1 from loonars2_material_requests where pesanan_id = (select id from p2) and unit_id = pg_temp.u(7))
  and (select count(*) = 5 and sum(nominal) = 5000000 from loonars2_material_requests where pesanan_id = (select id from p2)));
select pg_temp.cek('rincian harga lengkap tidak ditandai perkiraan',
  not exists (select 1 from loonars2_outbox where jenis = 'pengajuan_mingguan' and pesan like '%Pembagian bahan%TB Sinar%perkiraan%'));

-- 5. Koreksi pembagian ----------------------------------------------------------------
select pg_temp.cek('koreksi tanpa unit ditolak',
  (pg_temp.wa('6281100000002', 'koreksi_bahan', jsonb_build_object('kode', (select kelompok from p2), 'item', 'besi')) ->> 'balasan') like '%unit tujuannya%');
select pg_temp.wa('6281100000002', 'koreksi_bahan', jsonb_build_object('kode', (select kelompok from p2), 'item', 'besi', 'unit', '["3","4"]'::jsonb)) ->> 'balasan';
select pg_temp.cek('besi pindah ke unit 3,4 (1,5 jt per unit); total tetap 3 jt',
  (select count(*) = 2 and bool_and(nominal = 1500000) from loonars2_bahan_unit where pesanan_id = (select id from p2) and item = 'besi' and aktif)
  and (select sum(nominal) = 3000000 from loonars2_bahan_unit where pesanan_id = (select id from p2) and item = 'besi' and aktif));
select pg_temp.cek('baris biaya unit 2 untuk pesanan itu ditolak (dikoreksi); total biaya tetap 5 jt',
  (select status = 'ditolak' from loonars2_material_requests where pesanan_id = (select id from p2) and unit_id = pg_temp.u(2) order by id desc limit 1)
  and (select sum(nominal) = 5000000 from loonars2_material_requests where pesanan_id = (select id from p2) and status <> 'ditolak'));
select pg_temp.cek('RAB tidak lagi memuat besi untuk unit 2',
  not exists (select 1 from loonars2_v_rab_bahan where unit_id = pg_temp.u(2) and item = 'besi'));
select pg_temp.cek('owner diberi tahu koreksi', exists (select 1 from loonars2_outbox where jenis = 'koreksi_bahan'));
select pg_temp.cek('koreksi bahan yang tidak ada ditolak',
  (pg_temp.wa('6281100000002', 'koreksi_bahan', jsonb_build_object('kode', (select kelompok from p2), 'item', 'granit', 'unit', '["3"]'::jsonb)) ->> 'balasan') like '%Tidak ada bahan yang cocok%');
update loonars2_material_requests set status = 'dibayar' where pesanan_id = (select id from p1) and unit_id = pg_temp.u(2);
select pg_temp.cek('pesanan yang sudah dibayar tidak bisa dikoreksi',
  (pg_temp.wa('6281100000002', 'koreksi_bahan', jsonb_build_object('kode', (select kelompok from p1), 'unit', '["3"]'::jsonb)) ->> 'balasan') like '%sudah dibayar%');

-- 6. Utang bahan kolektif ----------------------------------------------------------------
select pg_temp.cek('utang tanpa unit: ditanya dulu',
  (pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Maju","deskripsi":"cat tembok","nominal":3000000,"unit":[]}') ->> 'status') = 'menunggu_unit');
select pg_temp.wa('6281100000002', 'ya') ->> 'balasan';
select pg_temp.cek('utang kolektif dibagi ke 6 unit sedang dibangun, jumlah persis 3 jt, kode U',
  (select count(*) = 6 and sum(nominal) = 3000000 and bool_and(kelompok like 'U-%') from loonars2_utang_toko where pesanan_id = (select max(id) from loonars2_pesanan_bahan)));
select pg_temp.cek('utang kolektif langsung sah (tanpa persetujuan owner) dan masuk sisa utang toko',
  (select bool_and(status = 'disetujui') from loonars2_utang_toko where pesanan_id = (select max(id) from loonars2_pesanan_bahan))
  and (select sisa_utang >= 3000000 from loonars2_v_toko where nama = 'TB Maju'));

-- 7. Daftar unit sedang dibangun = acuan ---------------------------------------------------
select pg_temp.cek('legacy: unit belum dibangun/belum DP ditolak dan menyarankan daftar unit',
  (pg_temp.wa('6281100000002', 'ajukan', '{"unit":"9","kategori":"material","deskripsi":"semen","nominal":1000000}') ->> 'balasan') like '%tidak ditandai sedang dibangun%');
select pg_temp.wa('6281100000002', 'bahan', '{"toko":"TB Maju","deskripsi":"kayu","nominal":7000000}') ->> 'status';
select pg_temp.cek('jawaban daftar unit menjawab dengan daftar terbaru & hasil pesanan',
  (pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["2","3","4","5","6","7","8"]}') ->> 'balasan') like '%Unit sedang dibangun%Pesanan bahan%');
select pg_temp.cek('pesanan tertunda dilanjutkan dengan 7 unit: jumlah persis 7 jt',
  (select count(*) = 7 and sum(nominal) = 7000000 from loonars2_material_requests where pesanan_id = (select max(id) from loonars2_pesanan_bahan)));
select pg_temp.cek('unit 8 sekarang sedang dibangun & status bangun proses; unit lama tetap selesai (tidak diturunkan)',
  (select sedang_dibangun and status_bangun = 'proses' from loonars2_units where nomor = 8)
  and (select status_bangun = 'selesai' from loonars2_units where nomor = 2));
select pg_temp.cek('daftar unit tanpa pesanan tertunda hanya memperbarui',
  (pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["3","4","5"]}') ->> 'balasan') like '%Unit sedang dibangun%');
select pg_temp.cek('hanya 3 unit yang ditandai sedang dibangun setelah jawaban itu', (select count(*) = 3 from loonars2_units where sedang_dibangun));
select pg_temp.cek('unit tak dikenal ditolak', (pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["99"]}') ->> 'status') = 'perlu_info');
select pg_temp.wa('6281100000002', 'unit_dibangun', '{"unit":["2","3","4","5","6","7","8"]}') ->> 'status';

-- 8. RAB per unit ----------------------------------------------------------------------------
select pg_temp.cek('RAB ringkas semua unit', (pg_temp.wa('6281100000001', 'rab') ->> 'balasan') like '%RAB BAHAN PER UNIT%Total%');
select pg_temp.cek('RAB rinci unit 3 memuat semen, pasir, besi',
  (pg_temp.wa('6281100000002', 'rab', '{"unit":"3"}') ->> 'balasan') ~ 'semen.*sak' and (pg_temp.wa('6281100000002', 'rab', '{"unit":"3"}') ->> 'balasan') like '%pasir%' and (pg_temp.wa('6281100000002', 'rab', '{"unit":"3"}') ->> 'balasan') like '%besi%');

-- 9. Pelaksana: data baca-saja ikut borongan & RAB, tabel mentah tetap tertutup ---------------
select set_config('uji.email', 'vando@contoh.id', false), set_config('uji.cfo', 'tidak', false);
create temp table hasil2 as select public.loonars2_web_lihat() as j;
select pg_temp.cek('web_lihat memuat borongan, RAB, dan penanda sedang dibangun',
  (select jsonb_array_length(j -> 'borongan') = 1 and jsonb_array_length(j -> 'rab') > 0 and (j -> 'unit' -> 1) ? 'sedang_dibangun' from hasil2));
select pg_temp.cek('web_lihat tidak membawa tautan nota',
  not (select (j -> 'pengajuan' -> 0) ? 'nota_url' from hasil2));
set role authenticated;
select pg_temp.cek('pelaksana tidak bisa SELECT langsung tabel/view baru',
  (select count(*) from public.loonars2_borongan) = 0 and (select count(*) from public.loonars2_v_rab_bahan) = 0
  and (select count(*) from public.loonars2_pesanan_bahan) = 0);
reset role;
select pg_temp.cek('anon & authenticated tidak punya EXECUTE fungsi internal baru',
  not has_function_privilege('anon', 'public._loonars2_pesan_bahan(text,text,text,jsonb,numeric,smallint[],text,date,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public._loonars2_koreksi_bahan(text,text,smallint[],text)', 'execute'));
select pg_temp.cek('integritas: jumlah baris RAB aktif = jumlah biaya per unit dari pesanan (tidak ditolak)',
  (select coalesce(sum(nominal), 0) from loonars2_bahan_unit where aktif) =
  (select coalesce(sum(nominal), 0) from loonars2_material_requests where pesanan_id is not null and status <> 'ditolak')
  + (select coalesce(sum(nominal), 0) from loonars2_utang_toko where pesanan_id is not null and status <> 'ditolak'));
