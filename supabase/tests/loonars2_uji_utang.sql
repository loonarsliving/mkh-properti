-- Uji migrasi 0044 (utang toko + pengajuan mingguan). Dijalankan SETELAH
-- loonars2_uji.sql pada database yang sama (memakai unit terjual & saldo C
-- dari skenario itu). Lihat jalankan-uji-loonars2.sh.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, d) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.saldo(k text) returns numeric language sql as $$ select saldo from loonars2_v_rekening where kode = k $$;
create function pg_temp.terpakai(k text) returns numeric language sql as $$ select terpakai_konstruksi from loonars2_v_unit where kode = k $$;

-- Saldo C cukup untuk uji pembayaran: konfirmasi semua transfer tertunda dulu.
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', jsonb_build_object('ref', 'T' || id)) ->> 'status'
  from loonars2_allocations where status = 'menunggu' order by id;

-- 1. Input utang ---------------------------------------------------------------
select pg_temp.cek('owner tidak bisa input utang', (pg_temp.wa('6281100000001', 'utang', '{"toko":"TB Maju","unit":["13"],"nominal":1000000}') ->> 'status') = 'tidak_berhak');
select pg_temp.cek('utang untuk unit belum terjual ditolak', (pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Maju","unit":["3"],"nominal":1000000}') ->> 'status') = 'ditolak');
select pg_temp.cek('utang tanpa toko ditolak', (pg_temp.wa('6281100000002', 'utang', '{"unit":["13"],"nominal":1000000}') ->> 'status') = 'ditolak');
select pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Maju","unit":["13"],"deskripsi":"semen 50 sak","nominal":6500000,"nota_url":"https://contoh/nota-utang.jpg"}') ->> 'balasan';
select pg_temp.cek('utang tercatat menunggu persetujuan, toko dibuat otomatis',
  exists (select 1 from loonars2_utang_toko ut join loonars2_toko t on t.id = ut.toko_id where t.nama = 'TB Maju' and ut.status = 'menunggu' and ut.nominal = 6500000));
select pg_temp.cek('owner menerima pesan utang beserta foto nota', exists (select 1 from loonars2_outbox where jenis = 'utang' and gambar_url = 'https://contoh/nota-utang.jpg'));
select pg_temp.cek('utang menunggu belum memotong budget', pg_temp.terpakai('LUNARA-01') = 0);
select pg_temp.cek('nama toko tidak peka huruf besar/kecil',
  (pg_temp.wa('6281100000002', 'utang', '{"toko":"tb maju","unit":["13","14"],"deskripsi":"besi","nominal":10000001}') ->> 'status') = 'diajukan'
  and (select count(*) from loonars2_toko) = 1);
select pg_temp.cek('utang 2 unit dibagi rata, jumlah persis (5.000.001 + 5.000.000)',
  (select array_agg(nominal order by id) = array[5000001, 5000000]::numeric[] from loonars2_utang_toko where kelompok = (select max(kelompok) from loonars2_utang_toko)));

-- 2. Persetujuan utang -----------------------------------------------------------
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select min(kelompok) from loonars2_utang_toko), 'setuju', true)) ->> 'balasan';
select pg_temp.cek('utang disetujui memotong budget bangun unit', pg_temp.terpakai('LUNARA-01') = 6500000);
select pg_temp.cek('pelaksana diberi tahu keputusan utang', exists (select 1 from loonars2_outbox where nomor = '6281100000002' and pesan like '%Utang U-%DISETUJUI%'));
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select max(kelompok) from loonars2_utang_toko), 'setuju', true)) ->> 'status';
select pg_temp.cek('sisa utang TB Maju = 16.500.001', (select sisa_utang from loonars2_v_toko where nama = 'TB Maju') = 16500001);
-- BANYU-06: terpakai 100 jt + komitmen 30 jt (dari uji sebelumnya) = 130 jt; utang 20 jt → 150 jt > 138 jt
select pg_temp.wa('6281100000002', 'utang', '{"toko":"TB Sinar","unit":["BANYU-06"],"deskripsi":"keramik","nominal":20000000}') ->> 'status';
select pg_temp.cek('utang melewati buffer butuh persetujuan khusus',
  (pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_utang_toko order by id desc limit 1), 'setuju', true)) ->> 'balasan') like '%buffer%'
  and (select status from loonars2_utang_toko order by id desc limit 1) = 'menunggu');
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_utang_toko order by id desc limit 1), 'setuju', false, 'alasan', 'cek ulang harga')) ->> 'status';
select pg_temp.cek('utang ditolak tidak memotong budget', (select status from loonars2_utang_toko order by id desc limit 1) = 'ditolak');

-- 3. Pengajuan mingguan ----------------------------------------------------------
select pg_temp.cek('owner tidak bisa mengajukan mingguan', (pg_temp.wa('6281100000001', 'ajukan_mingguan', '{"baris":[]}') ->> 'status') = 'tidak_berhak');
select pg_temp.cek('cicilan ke toko tanpa utang ditolak, tidak ada yang dicatat',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":["13"],"deskripsi":"upah","nominal":1000000},{"jenis":"cicilan","toko":"TB Entah","nominal":1000000}]}') ->> 'status') = 'ditolak'
  and not exists (select 1 from loonars2_material_requests where deskripsi = 'upah'));
select pg_temp.cek('baris tanpa nominal ditolak dengan nomor barisnya',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","nominal":1000000},{"jenis":"material","unit":["1"],"deskripsi":"pasir"}]}') ->> 'balasan') like '%Baris 2:%');
select pg_temp.cek('baris untuk unit belum terjual ditolak',
  (pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"tukang","unit":["3"],"deskripsi":"upah","nominal":1000000}]}') ->> 'status') = 'ditolak');
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[
  {"jenis":"cicilan","toko":"TB Maju","nominal":3000000},
  {"jenis":"tukang","unit":["13","14"],"deskripsi":"kontraktor Pak Anang minggu 1","toko":"Pak Anang","nominal":15000001},
  {"jenis":"material","unit":["1"],"deskripsi":"pasir 2 rit","toko":"TB Sinar","nominal":1600000}]}') ->> 'balasan';
select pg_temp.cek('pengajuan mingguan: 1 cicilan + kontraktor dibagi 2 unit + 1 material, satu kode M',
  (select count(*) from loonars2_cicilan where kelompok like 'M-%') = 1
  and (select count(*) from loonars2_material_requests where kelompok like 'M-%') = 3
  and (select sum(nominal) from loonars2_material_requests where kelompok like 'M-%' and kategori = 'tukang') = 15000001);
select pg_temp.cek('owner menerima satu pesan ringkasan mingguan',
  (select count(*) from loonars2_outbox where jenis = 'pengajuan_mingguan') = 1
  and (select pesan from loonars2_outbox where jenis = 'pengajuan_mingguan') like '%Cicilan utang TB Maju%Kontraktor/tukang%Material%Balas "setujui M-%');

-- 4. Setujui & bayar satu kode ---------------------------------------------------
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select kelompok from loonars2_cicilan limit 1), 'setuju', true)) ->> 'balasan';
select pg_temp.cek('semua baris M disetujui', not exists (select 1 from loonars2_material_requests where kelompok like 'M-%' and status <> 'disetujui')
  and (select status from loonars2_cicilan limit 1) = 'disetujui');
create temp table sebelum as select pg_temp.saldo('C') as c, pg_temp.terpakai('LUNARA-01') as l1, (select sisa_utang from loonars2_v_toko where nama = 'TB Maju') as utang;
select pg_temp.wa('6281100000002', 'bayar_kelompok', jsonb_build_object('kode', (select kelompok from loonars2_cicilan limit 1), 'bukti_url', 'https://contoh/tf-mingguan.jpg')) ->> 'balasan';
select pg_temp.cek('bayar M: saldo C turun sebesar total (3.000.000 + 15.000.001 + 1.600.000)', pg_temp.saldo('C') = (select c from sebelum) - 19600001);
select pg_temp.cek('bayar M: sisa utang toko turun 3 jt', (select sisa_utang from loonars2_v_toko where nama = 'TB Maju') = (select utang from sebelum) - 3000000);
select pg_temp.cek('bayar M: cicilan TIDAK memotong budget unit lagi; kontraktor memotong', pg_temp.terpakai('LUNARA-01') = (select l1 from sebelum) + 7500001 - 0);
select pg_temp.cek('semua baris M dibayar dengan bukti', not exists (select 1 from loonars2_material_requests where kelompok like 'M-%' and status <> 'dibayar')
  and (select count(*) from loonars2_disbursements where bukti_url = 'https://contoh/tf-mingguan.jpg') = 4);
select pg_temp.cek('bayar ulang kode yang sama tidak dobel', (pg_temp.wa('6281100000002', 'bayar_kelompok', jsonb_build_object('kode', (select kelompok from loonars2_cicilan limit 1))) ->> 'balasan') like 'Tidak ada baris%');

-- 5. Tolak per baris -------------------------------------------------------------
select pg_temp.wa('6281100000002', 'ajukan_mingguan', '{"baris":[{"jenis":"cicilan","toko":"TB Maju","nominal":2000000},{"jenis":"material","unit":["13"],"deskripsi":"cat","nominal":500000}]}') ->> 'status';
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', 'C-' || (select max(id) from loonars2_cicilan), 'setuju', false, 'alasan', 'minggu depan saja')) ->> 'status';
select pg_temp.wa('6281100000001', 'putuskan_kode', jsonb_build_object('kode', (select max(kelompok) from loonars2_material_requests), 'setuju', true)) ->> 'status';
select pg_temp.cek('cicilan ditolak per baris, material tetap bisa disetujui lewat kode M',
  (select status from loonars2_cicilan order by id desc limit 1) = 'ditolak'
  and (select status from loonars2_material_requests order by id desc limit 1) = 'disetujui');

-- 6. Laporan ---------------------------------------------------------------------
select pg_temp.wa('6281100000002', 'daftar_utang') ->> 'balasan';
select pg_temp.cek('daftar utang menampilkan sisa per toko', (pg_temp.wa('6281100000002', 'daftar_utang') ->> 'balasan') like '%TB Maju: sisa Rp 13.500.001%');
select pg_temp.cek('saldo owner menampilkan utang toko', (pg_temp.wa('6281100000001', 'saldo') ->> 'balasan') like '%Utang toko (dibayar dari C): Rp 13.500.001%');
update loonars2_settings set hari_pengajuan_mingguan = extract(isodow from (now() at time zone 'Asia/Jakarta')::date)::smallint;
select public.loonars2_pengingat();
select pg_temp.cek('pengingat pengajuan mingguan terkirim ke pelaksana', exists (select 1 from loonars2_outbox where jenis = 'pengingat_mingguan' and nomor = '6281100000002'));

-- 7. Integritas ----------------------------------------------------------------
do $$ begin
  begin
    insert into loonars2_disbursements (dari_rekening, kategori, nominal, sumber, dicatat_oleh, cicilan_id)
    values ('B', 'tanah', 1, 'web', 'uji', (select min(id) from loonars2_cicilan));
    raise exception 'GAGAL: cicilan dari B harus ditolak';
  exception when check_violation or unique_violation then null;
  end;
end $$;
select 'LULUS: pembayaran cicilan hanya boleh dari C';
select pg_temp.cek('audit mencatat utang & cicilan', exists (select 1 from loonars2_audit_log where tabel = 'loonars2_utang_toko' and aktor like 'wa:Vando Uji%')
  and exists (select 1 from loonars2_audit_log where tabel = 'loonars2_cicilan'));
select pg_temp.cek('semua receipt aktif: jumlah alokasi tetap = nominal',
  not exists (select 1 from loonars2_receipts re where re.status = 'aktif'
               and re.nominal <> (select coalesce(sum(nominal), 0) from loonars2_allocations where receipt_id = re.id and status <> 'batal')));
select pg_temp.cek('saldo tidak ada yang negatif', not exists (select 1 from loonars2_v_rekening where saldo < 0));

select 'SEMUA UJI UTANG & MINGGUAN LULUS';
