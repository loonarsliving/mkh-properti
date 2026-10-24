-- Uji skenario modul Loonars 2 (migrasi 0043) di Postgres lokal sekali pakai.
-- Jalankan: supabase/tests/jalankan-uji-loonars2.sh
-- Setiap pernyataan berjalan di transaksinya sendiri (autocommit psql), jadi
-- constraint "jumlah alokasi = nominal" benar-benar dicek di tiap langkah.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);

-- Nomor dummy, jam pengingat dibuka 24 jam supaya pengingat bisa diuji kapan saja.
insert into loonars2_wa_users (nomor, nama, peran) values
  ('6281100000001', 'Owner Uji', 'owner'),
  ('6281100000002', 'Vando Uji', 'pelaksana');
update loonars2_settings set jam_mulai_pengingat = 0, jam_selesai_pengingat = 24;
update loonars2_accounts set bank = 'BCA', nomor_rekening = '1234567890', nama_pemilik = 'PT MKH Tanah' where kode = 'B';
update loonars2_accounts set bank = 'Mandiri', nomor_rekening = '0987654321', nama_pemilik = 'PT MKH Konstruksi' where kode = 'C';

create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, case when a in ('ajukan', 'ajukan_mingguan', 'bahan') and not (d ? 'uji_rekening') then d || '{"tanpa_rekening":true}'::jsonb else d end) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.alok(p_unit text) returns text language sql as $$
  select string_agg(al.ke_rekening || '=' || al.nominal, ' ' order by al.urutan)
    from loonars2_allocations al join loonars2_receipts re on re.id = al.receipt_id
   where re.id = (select max(r2.id) from loonars2_receipts r2 join loonars2_units u on u.id = r2.unit_id where u.kode = p_unit) $$;
create function pg_temp.saldo(k text) returns numeric language sql as $$ select saldo from loonars2_v_rekening where kode = k $$;

-- 1. Keamanan pintu WA ------------------------------------------------------
select pg_temp.cek('nomor tak dikenal diabaikan', (pg_temp.wa('6289999999999', 'saldo') ->> 'status') = 'abaikan');
select pg_temp.cek('nomor tak dikenal tercatat di log', exists (select 1 from loonars2_wa_log where nomor = '6289999999999' and hasil like 'diabaikan%'));
select pg_temp.cek('nomor format 08xx dinormalisasi', (pg_temp.wa('081100000001', 'saldo') ->> 'status') = 'ok');
do $$ begin
  perform set_config('request.headers', '{"x-sync-secret":"salah"}', false);
  begin
    perform public.loonars2_wa('6281100000001', 'saldo', '{}');
    raise exception 'GAGAL: rahasia salah harus ditolak';
  exception when sqlstate '28000' then null;
  end;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
end $$;
select 'LULUS: rahasia salah ditolak (28000)';
select pg_temp.cek('pelaksana tidak boleh perintah owner', (pg_temp.wa('6281100000002', 'saldo') ->> 'status') = 'tidak_berhak');

-- 2. DP 1 Kamar (BANYU-06 = unit 12): kebutuhan C = 120 + 18 + 8%×420 = 171,6 jt
select pg_temp.cek('DP minta konfirmasi YA dulu', (pg_temp.wa('6281100000001', 'receipt', '{"unit":"12","jenis":"dp","nominal":210000000,"nama_pembeli":"Budi"}') ->> 'status') = 'menunggu_ya');
select pg_temp.cek('belum ada receipt sebelum YA', not exists (select 1 from loonars2_receipts));
select pg_temp.wa('6281100000001', 'ya') ->> 'balasan';
select pg_temp.cek('DP 1 Kamar: C 171,6 jt, B 38,4 jt', pg_temp.alok('BANYU-06') = 'C=171600000 B=38400000');
select pg_temp.cek('unit 12 status dp + nama pembeli', (select status = 'dp' and nama_pembeli = 'Budi' from loonars2_units where kode = 'BANYU-06'));
select pg_temp.cek('saldo A 210 jt, C/B masih 0 sebelum konfirmasi', pg_temp.saldo('A') = 210000000 and pg_temp.saldo('C') = 0 and pg_temp.saldo('B') = 0);

-- 3. DP 2 Kamar (LUNARA-01 = unit 13): kebutuhan C = 160 + 24 + 48 = 232 jt
select pg_temp.wa('6281100000001', 'receipt', '{"unit":"LUNARA-01","jenis":"dp","nominal":300000000}') ->> 'status';
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
select pg_temp.cek('DP 2 Kamar: C 232 jt, B 68 jt', pg_temp.alok('LUNARA-01') = 'C=232000000 B=68000000');

-- 4. Konfirmasi transfer ----------------------------------------------------
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', '{"ref":"1","bukti_url":"https://contoh/bukti1.jpg"}') ->> 'balasan';
select pg_temp.cek('"sudah 1" = blok 1 perintah terakhir (LUNARA-01 → C)', pg_temp.saldo('C') = 232000000 and pg_temp.saldo('A') = 510000000 - 232000000);
select pg_temp.cek('bukti & jam konfirmasi tersimpan', exists (select 1 from loonars2_allocations where bukti_url = 'https://contoh/bukti1.jpg' and dikonfirmasi_pada is not null));
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', '{"ref":"semua"}') ->> 'status';
select pg_temp.cek('"sudah semua" menyelesaikan LUNARA-01', pg_temp.saldo('B') = 68000000);
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', '{"rekening":"B","nominal":38400000}') ->> 'status';
select pg_temp.cek('"sudah transfer B 38,4 juta" cocok ke alokasi B BANYU-06', pg_temp.saldo('B') = 68000000 + 38400000);
select pg_temp.cek('konfirmasi yang tak cocok ditolak sopan', (pg_temp.wa('6281100000001', 'konfirmasi_transfer', '{"rekening":"D","nominal":1}') ->> 'status') = 'tidak_cocok');
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', jsonb_build_object('ref', 'T' || (select min(id) from loonars2_allocations where status = 'menunggu'))) ->> 'status';
select pg_temp.cek('"sudah T<id>" → tidak ada lagi yang mengendap di A', pg_temp.saldo('A') = 0 and pg_temp.saldo('C') = 232000000 + 171600000);

-- 5. Pelunasan tanpa nominal: sistem tahu sisa tagihannya ------------------
select pg_temp.cek('pelunasan tanpa nominal minta konfirmasi sisa 210 jt',
  (pg_temp.wa('6281100000001', 'receipt', '{"unit":"unit 12","jenis":"pelunasan"}') ->> 'balasan') like '%Rp 210.000.000%');
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
select pg_temp.cek('pelunasan 1 Kamar seluruhnya ke B (target belum penuh)', pg_temp.alok('BANYU-06') = 'B=210000000');
select pg_temp.cek('unit 12 lunas', (select status from loonars2_units where kode = 'BANYU-06') = 'lunas');
select pg_temp.cek('bayar melebihi sisa ditolak', (pg_temp.wa('6281100000001', 'receipt', '{"unit":"12","jenis":"cicilan","nominal":5}') ->> 'status') = 'ditolak');

-- 6. Pembayaran yang melewati target tanah → terpecah B/D -------------------
-- B sudah dialokasikan 38,4 + 68 + 210 = 316,4 jt. Target diturunkan ke 400 jt
-- hanya untuk uji, supaya pelunasan LUNARA-01 (300 jt) terpecah.
update loonars2_settings set target_tanah = 400000000;
select pg_temp.wa('6281100000001', 'receipt', '{"unit":"13","jenis":"pelunasan"}') ->> 'status';
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
select pg_temp.cek('pelunasan 2 Kamar terpecah: B 83,6 jt, D 216,4 jt', pg_temp.alok('LUNARA-01') = 'B=83600000 D=216400000');
update loonars2_settings set target_tanah = 1000000000;

-- 7. Harga & DP hasil negosiasi (AVARA-01: harga 400 jt, DP 30%) ------------
update loonars2_units set harga = 400000000, dp_persen = 30 where kode = 'AVARA-01';
select pg_temp.cek('kebutuhan C ikut harga negosiasi: 120 + 18 + 32 = 170 jt',
  (select kebutuhan_c = 170000000 and dp_target = 120000000 from loonars2_v_unit where kode = 'AVARA-01'));
select pg_temp.wa('6281100000001', 'receipt', '{"unit":"1","jenis":"dp"}') ->> 'balasan';
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
select pg_temp.cek('DP 120 jt < kebutuhan C → semua ke C', pg_temp.alok('AVARA-01') = 'C=120000000');
select pg_temp.cek('unit ditandai belum terdanai penuh', (select status = 'dp' and not terdanai_penuh from loonars2_v_unit where kode = 'AVARA-01'));
select pg_temp.wa('6281100000002', 'ajukan', '{"unit":"1","kategori":"material","deskripsi":"pondasi","nominal":5000000}') ->> 'status';
select pg_temp.cek('pengajuan untuk unit belum terdanai penuh diberi peringatan',
  (select unit_belum_terdanai from loonars2_material_requests order by id desc limit 1)
  and (select pesan from loonars2_outbox where jenis = 'pengajuan' order by id desc limit 1) like '%belum terdanai penuh%');
select pg_temp.wa('6281100000001', 'receipt', '{"unit":"1","jenis":"cicilan","nominal":100000000}') ->> 'status';
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
select pg_temp.cek('kekurangan C diambil dari cicilan berikutnya: C 50 jt, B 50 jt', pg_temp.alok('AVARA-01') = 'C=50000000 B=50000000');

-- 8. Pengajuan material ----------------------------------------------------
select pg_temp.cek('pengajuan untuk unit belum terjual ditolak',
  (pg_temp.wa('6281100000002', 'ajukan', '{"unit":"2","kategori":"material","deskripsi":"semen 10 sak","nominal":1000000}') ->> 'status') = 'ditolak');
select pg_temp.cek('owner tidak bisa mengajukan atas nama pelaksana',
  (pg_temp.wa('6281100000001', 'ajukan', '{"unit":"12","nominal":1000000}') ->> 'status') = 'tidak_berhak');
update loonars2_units set is_unit_contoh = true where kode = 'AVARA-02';
select pg_temp.cek('unit contoh boleh menerima pengajuan walau belum terjual',
  (pg_temp.wa('6281100000002', 'ajukan', '{"unit":"2","kategori":"material","deskripsi":"cat contoh","nominal":1000000}') ->> 'status') = 'diajukan');
select pg_temp.wa('6281100000002', 'ajukan', '{"unit":"12","kategori":"material","deskripsi":"besi & semen","toko":"TB Maju","nominal":100000000,"nota_url":"https://contoh/nota.jpg"}') ->> 'balasan';
select pg_temp.cek('pengajuan diteruskan ke owner beserta foto nota',
  exists (select 1 from loonars2_outbox where jenis = 'pengajuan' and nomor = '6281100000001' and gambar_url = 'https://contoh/nota.jpg'));
select pg_temp.wa('6281100000001', 'putuskan', jsonb_build_object('id', (select max(id) from loonars2_material_requests), 'setuju', true)) ->> 'balasan';
select pg_temp.wa('6281100000002', 'bayar_pengajuan', jsonb_build_object('id', (select max(id) from loonars2_material_requests), 'bukti_url', 'https://contoh/tf.jpg')) ->> 'balasan';
select pg_temp.cek('pembayaran pengajuan mengurangi saldo C dan menambah terpakai unit',
  pg_temp.saldo('C') = 232000000 + 171600000 - 100000000
  and (select terpakai_konstruksi from loonars2_v_unit where kode = 'BANYU-06') = 100000000);
select pg_temp.wa('6281100000002', 'ajukan', '{"unit":"12","kategori":"tukang","deskripsi":"upah minggu 3","nominal":30000000}') ->> 'balasan';
select pg_temp.cek('melewati biaya bangun (130 > 120 jt) → pakai buffer',
  (select pakai_buffer and not melewati_buffer from loonars2_material_requests order by id desc limit 1));
select pg_temp.cek('pakai buffer butuh persetujuan khusus',
  (pg_temp.wa('6281100000001', 'putuskan', jsonb_build_object('id', (select max(id) from loonars2_material_requests), 'setuju', true)) ->> 'balasan') like '%buffer%'
  and (select status from loonars2_material_requests order by id desc limit 1) = 'menunggu');
select pg_temp.wa('6281100000001', 'putuskan', jsonb_build_object('id', (select max(id) from loonars2_material_requests), 'setuju', true, 'buffer', true)) ->> 'status';
select pg_temp.cek('disetujui dengan "setujui L2-n buffer"', (select status from loonars2_material_requests order by id desc limit 1) = 'disetujui');
select pg_temp.wa('6281100000002', 'ajukan', '{"unit":"12","kategori":"material","deskripsi":"keramik","nominal":10000000}') ->> 'status';
select pg_temp.cek('melewati biaya bangun + buffer (140 > 138 jt) → merah',
  (select melewati_buffer from loonars2_material_requests order by id desc limit 1));
select pg_temp.wa('6281100000001', 'putuskan', jsonb_build_object('id', (select max(id) from loonars2_material_requests), 'setuju', false, 'alasan', 'kemahalan')) ->> 'status';
select pg_temp.cek('penolakan dikabarkan ke pelaksana', exists (select 1 from loonars2_outbox where nomor = '6281100000002' and pesan like '%DITOLAK%kemahalan%'));

-- 9. Konsekuensi transfer tertunda -----------------------------------------
select pg_temp.wa('6281100000002', 'ajukan', '{"unit":"1","kategori":"material","deskripsi":"pasir","nominal":2000000}') ->> 'status';
select pg_temp.cek('pengajuan ke owner memuat peringatan uang di A',
  (select pesan from loonars2_outbox where jenis = 'pengajuan' order by id desc limit 1) like '%belum dipindahkan dari A%');
select pg_temp.cek('laporan saldo menaruh transfer tertunda paling atas',
  (pg_temp.wa('6281100000001', 'saldo') ->> 'balasan') like '🔴 TRANSFER TERTUNDA%');
select pg_temp.cek('pencairan profit diblokir selama ada transfer tertunda',
  (pg_temp.wa('6281100000001', 'cairkan_profit', '{"nominal":1000000}') ->> 'balasan') like '%belum dipindahkan dari A%');

-- 10. Pelunasan lewat jatuh tempo + pengingat ------------------------------
update loonars2_units set jatuh_tempo_pelunasan = current_date - 3 where kode = 'AVARA-01';
update loonars2_units set jatuh_tempo_pelunasan = current_date + 7 where kode = 'LUNARA-02';
select pg_temp.wa('6281100000001', 'receipt', '{"unit":"14","jenis":"dp","nominal":300000000,"nama_pembeli":"Sari"}') ->> 'status';
select pg_temp.wa('6281100000001', 'ya') ->> 'status';
update loonars2_receipts set dibuat_pada = now() - interval '25 hours' where id = (select min(re.id) from loonars2_receipts re join loonars2_allocations al on al.receipt_id = re.id where al.status = 'menunggu');
select public.loonars2_pengingat();
select pg_temp.cek('tagihan menandai merah unit lewat jatuh tempo', (pg_temp.wa('6281100000001', 'tagihan') ->> 'balasan') like '%🔴 Unit 1 AVARA-01%LEWAT 3 hari%');
select pg_temp.cek('pengingat pelunasan: lewat jatuh tempo & H-7', exists (select 1 from loonars2_outbox where jenis = 'pelunasan' and pesan like '%LEWAT 3 hari%' and pesan like '%H-7%LUNARA-02%Sari%'));
select pg_temp.cek('rekap pagi transfer tertunda terkirim', exists (select 1 from loonars2_outbox where jenis = 'rekap_pagi'));
select pg_temp.cek('eskalasi merah > 24 jam menyebut total di A', exists (select 1 from loonars2_outbox where jenis = 'eskalasi' and pesan like '%MENGENDAP DI REKENING A%'));
select public.loonars2_pengingat();
select pg_temp.cek('pengingat tidak dobel di jam yang sama', (select count(*) from loonars2_outbox where jenis in ('rekap_pagi', 'eskalasi', 'pelunasan')) = 3);
update loonars2_settings set jam_mulai_pengingat = 23, jam_selesai_pengingat = 23;
delete from loonars2_outbox where jenis = 'rekap_pagi';
select public.loonars2_pengingat();
select pg_temp.cek('tidak ada pesan di luar jam kerja', not exists (select 1 from loonars2_outbox where jenis = 'rekap_pagi')
  or extract(hour from now() at time zone 'Asia/Jakarta') = 23);
update loonars2_settings set jam_mulai_pengingat = 0, jam_selesai_pengingat = 24;

-- 11. Ubah rekening wajib YA -------------------------------------------------
select pg_temp.wa('6281100000001', 'ubah_rekening', '{"rekening":"D","bank":"BRI","nomor":"5555 6666 77","nama":"PT MKH Profit"}') ->> 'status';
select pg_temp.cek('rekening belum berubah sebelum YA', (select nomor_rekening is null from loonars2_accounts where kode = 'D'));
select pg_temp.wa('6281100000001', 'ya') ->> 'balasan';
select pg_temp.cek('rekening D tersimpan setelah YA', (select bank = 'BRI' and nomor_rekening = '5555666677' from loonars2_accounts where kode = 'D'));
select pg_temp.cek('BATAL tanpa pending tidak diproses', (pg_temp.wa('6281100000001', 'batal') ->> 'status') = 'tidak_ada_pending');

-- 12. Profit: setelah semua transfer dikonfirmasi, syarat milestone dicek --
select pg_temp.wa('6281100000001', 'konfirmasi_transfer', jsonb_build_object('ref', 'T' || id)) ->> 'status'
  from loonars2_allocations where status = 'menunggu' order by id;
select pg_temp.cek('profit ditolak: target tanah belum terkonfirmasi',
  (pg_temp.wa('6281100000001', 'cairkan_profit', '{"nominal":100000000}') ->> 'balasan') like '%Dana tanah terkonfirmasi%');
update loonars2_settings set milestone_profit = '{"wajib_target_tanah_terkonfirmasi": false, "wajib_unit_terjual_terdanai_penuh": false, "min_unit_serah_terima": 0}';
select pg_temp.cek('profit melebihi saldo D ditolak', (pg_temp.wa('6281100000001', 'cairkan_profit', '{"nominal":999000000}') ->> 'balasan') like '%Saldo D hanya%');
select pg_temp.wa('6281100000001', 'cairkan_profit', '{"nominal":100000000}') ->> 'status';
select pg_temp.wa('6281100000001', 'ya') ->> 'balasan';
select pg_temp.cek('pencairan profit tercatat dari D', pg_temp.saldo('D') = 216400000 - 100000000);

-- 13. Pintu web --------------------------------------------------------------
do $$ begin
  begin
    perform public.loonars2_web('ringkasan', '{}');
    raise exception 'GAGAL: non-CFO harus ditolak';
  exception when sqlstate '42501' then null;
  end;
end $$;
select 'LULUS: web non-CFO ditolak (42501)';
select set_config('uji.cfo', 'ya', false), set_config('uji.email', 'owner@contoh.id', false);
select public.loonars2_web('catat_receipt', jsonb_build_object('unit_id', (select id from loonars2_units where kode = 'BANYU-01'), 'jenis', 'dp', 'nominal', 210000000)) ->> 'receipt_id';
select pg_temp.cek('receipt dari web mengirim perintah transfer ke owner via WA',
  exists (select 1 from loonars2_outbox where jenis = 'instruksi_transfer' and nomor = '6281100000001' and pesan like '🔴 SEGERA TRANSFER%BANYU-01%'));
select public.loonars2_web('batal_receipt', jsonb_build_object('receipt_id', (select max(id) from loonars2_receipts), 'alasan', 'salah input')) ->> 'status';
select pg_temp.cek('receipt salah input bisa dibatalkan, unit kembali tersedia', (select status from loonars2_units where kode = 'BANYU-01') = 'tersedia');
do $$ begin
  begin
    perform public.loonars2_web('catat_pengeluaran', '{"dari":"B","kategori":"material","nominal":1000}');
    raise exception 'GAGAL: B untuk material harus ditolak';
  exception when check_violation then null;
  end;
end $$;
select 'LULUS: rekening B tidak bisa dipakai untuk material (aturan rekening)';
select public.loonars2_web('catat_pengeluaran', '{"dari":"B","kategori":"tanah","nominal":300000000,"penerima":"Pemilik tanah"}') ->> 'id';
select pg_temp.cek('pembayaran tanah mengurangi B', pg_temp.saldo('B') = 38400000 + 68000000 + 210000000 + 83600000 + 50000000 + 68000000 - 300000000);
select set_config('uji.cfo', '', false), set_config('uji.email', '', false);

-- 14. Antrean keluar ---------------------------------------------------------
select public.loonars2_outbox_bangunkan();
select pg_temp.cek('pg_cron membangunkan MK Connect dengan rahasia sync', exists (select 1 from net.panggilan where url like '%/api/loonars2/outbox' and headers ->> 'x-sync-secret' = 'rahasia-uji'));
select pg_temp.cek('outbox_ambil mengembalikan pesan', jsonb_array_length(pg_temp.wa(null, 'outbox_ambil') -> 'pesan') > 0);
select pg_temp.wa(null, 'outbox_selesai', jsonb_build_object('hasil', (select jsonb_agg(jsonb_build_object('id', id, 'ok', true)) from loonars2_outbox where status = 'proses'))) ->> 'status';
select pg_temp.cek('outbox ditandai terkirim', not exists (select 1 from loonars2_outbox where status = 'proses'));

-- 15. Audit log ----------------------------------------------------------------
select pg_temp.cek('audit mencatat aktor WA', exists (select 1 from loonars2_audit_log where tabel = 'loonars2_receipts' and aktor like 'wa:Owner Uji%' and sumber = 'wa'));
select pg_temp.cek('audit mencatat aktor web', exists (select 1 from loonars2_audit_log where aktor = 'web:owner@contoh.id' and sumber = 'web'));
select pg_temp.cek('audit menyimpan nilai lama & baru rekening', exists (select 1 from loonars2_audit_log where tabel = 'loonars2_accounts' and aksi = 'UPDATE' and nilai_lama ->> 'bank' is null and nilai_baru ->> 'bank' = 'BRI'));

-- 16. Tidak ada selisih pembulatan ------------------------------------------
select pg_temp.cek('semua receipt aktif: jumlah alokasi = nominal persis',
  not exists (select 1 from loonars2_receipts re where re.status = 'aktif'
               and re.nominal <> (select coalesce(sum(nominal), 0) from loonars2_allocations where receipt_id = re.id and status <> 'batal')));
do $$
declare
  i integer;
  v_unit smallint;
  v_nominal numeric;
  v_jumlah numeric;
begin
  for i in 1..5000 loop
    v_unit := 1 + floor(random() * 17)::int;
    v_nominal := 1 + floor(random() * 700000000);
    select coalesce(sum(nominal), 0) into v_jumlah from public._loonars2_hitung_alokasi(v_unit, v_nominal);
    if v_jumlah <> v_nominal then raise exception 'GAGAL: selisih alokasi unit % nominal %: %', v_unit, v_nominal, v_jumlah; end if;
  end loop;
end $$;
select 'LULUS: 5000 nominal acak — jumlah alokasi selalu sama persis';
do $$ begin
  begin
    insert into loonars2_receipts (unit_id, jenis, nominal, sumber, dicatat_oleh) values (5, 'dp', 1000, 'web', 'uji');
    set constraints all immediate;
    raise exception 'GAGAL: receipt tanpa alokasi harus ditolak';
  exception when check_violation then null;
  end;
end $$;
select 'LULUS: constraint menolak receipt yang alokasinya tidak sama dengan nominal';

select 'SEMUA UJI LULUS';
