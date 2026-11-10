-- Uji migrasi 0069 (Tahap 2a: buku besar berdimensi, peran, kunci periode, laporan beku). Setelah cfo_uji_pdf.sql.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

-- Data: transaksi LL seimbang Sep 2026, LC timpang Agu 2026, satu transaksi tanpa pemetaan.
insert into public.jurnal (tgl, no, akun, nama, proyek, d, k) values
  ('2026-09-10', 'BB-1', '1-1004', 'Bank', 'LL', 500000, 0), ('2026-09-10', 'BB-1', '4-1001', 'Penjualan', 'LL', 0, 500000),
  ('2026-08-05', 'BB-2', '5-1001', 'Material', 'LC', 300000, 0), ('2026-08-05', 'BB-2', '1-1004', 'Bank', 'LC', 0, 200000),
  ('2026-09-11', 'BB-3', '1-1001', 'Kas', 'XYZ', 1000, 0), ('2026-09-11', 'BB-3', '4-1003', 'Lain', 'XYZ', 0, 1000);

select pg_temp.cek('COA lama disalin lengkap (36 akun) + akun baru', (select count(*) from fin_akun where asal = 'coa_lama') = 36 and (select count(*) from fin_akun where asal = 'baru') >= 20);
select pg_temp.cek('nama akun lama sama persis', (select nama from fin_akun where kode = '1-1004') = 'Bank Loonars Living' and (select nama_laporan from fin_akun where kode = '3-1001') = 'Modal Disetor');
select pg_temp.cek('pemetaan: LL -> L1 (D-1), LC -> LC, tanpa pemetaan ditandai',
  (select properti_kode from fin_v_jurnal where no = 'BB-1' limit 1) = 'L1'
  and (select properti_kode from fin_v_jurnal where no = 'BB-2' limit 1) = 'LC'
  and (select dasar_dimensi from fin_v_jurnal where no = 'BB-3' limit 1) = 'belum_dipetakan');
select pg_temp.cek('view membawa info akun & lini', (select baris_laporan = 'pendapatan_penjualan_unit' and lini = 'L1' from fin_v_jurnal where no = 'BB-1' and akun = '4-1001'));
insert into fin_jurnal_dimensi (no, properti_kode, alasan, dibuat_oleh) values ('BB-1', 'L2', 'uji pengecualian', 'uji');
select pg_temp.cek('pengecualian per transaksi mengalahkan pemetaan proyek', (select properti_kode = 'L2' and dasar_dimensi = 'pengecualian' from fin_v_jurnal where no = 'BB-1' limit 1));
delete from fin_jurnal_dimensi where no = 'BB-1';

-- Peran
select set_config('uji.cfo', '', false), set_config('uji.email', 'staf@contoh.test', false);
select pg_temp.cek('bukan CFO & tanpa peran: tidak boleh apa pun', public.fin_peran_saya() is null and not public.fin_boleh('baca_laporan'));
insert into fin_peran (email, peran, dibuat_oleh) values ('staf@contoh.test', 'auditor', 'uji'), ('ir@contoh.test', 'investor_relations', 'uji');
select pg_temp.cek('auditor: baca buku besar & laporan, tidak menutup periode',
  public.fin_boleh('baca_buku_besar') and public.fin_boleh('baca_laporan') and not public.fin_boleh('tutup_periode') and not public.fin_boleh('kelola'));
select set_config('uji.email', 'ir@contoh.test', false);
select pg_temp.cek('investor relations: hanya laporan', public.fin_boleh('baca_laporan') and not public.fin_boleh('baca_buku_besar'));
do $$ begin
  perform public.fin_tutup_periode('2026-09-01');
  raise exception 'GAGAL: non-CFO bisa menutup periode';
exception when sqlstate '42501' then null; end $$;
select set_config('uji.cfo', 'ya', false), set_config('uji.email', 'owner@contoh.test', false);
select pg_temp.cek('pengguna CFO = owner', public.fin_peran_saya() = 'owner' and public.fin_boleh('kelola'));

-- Kunci periode
select pg_temp.cek('sebelum ada bulan ditutup: jurnal lama tetap bisa ditambah', (select count(*) from (select 1) x) = 1);
insert into public.jurnal (tgl, no, akun, nama, proyek, d, k) values ('2026-09-12', 'BB-4', '1-1001', 'Kas', 'LL', 10, 0), ('2026-09-12', 'BB-4', '4-1003', 'Lain', 'LL', 0, 10);
do $$ begin
  perform public.fin_tutup_periode('2026-08-01');
  raise exception 'GAGAL: periode timpang bisa ditutup';
exception when sqlstate '22023' then
  if sqlerrm not like '%LC (selisih 100000%' then raise exception 'GAGAL: pesan timpang tidak menyebut proyek: %', sqlerrm; end if;
end $$;
do $$ begin
  perform public.fin_tutup_periode(date_trunc('month', now())::date);
  raise exception 'GAGAL: bulan berjalan bisa ditutup';
exception when sqlstate '22023' then null; end $$;
select pg_temp.cek('periode seimbang ditutup', (public.fin_tutup_periode('2026-09-15', 'uji tutup') ->> 'status') = 'ditutup');
select pg_temp.cek('... status tersimpan', (select status from fin_periode where periode = '2026-09-01') = 'ditutup');
select pg_temp.cek('tutup tercatat di audit log', exists (select 1 from cfo_audit_log where aksi = 'fin_tutup_periode'));
do $$ begin
  insert into public.jurnal (tgl, no, akun, nama, proyek, d, k) values ('2026-09-30', 'BB-5', '1-1001', 'Kas', 'LL', 1, 0);
  raise exception 'GAGAL: jurnal baru di periode tertutup lolos';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  update public.jurnal set d = 999 where no = 'BB-4' and d = 10;
  raise exception 'GAGAL: ubah jurnal di periode tertutup lolos';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  delete from public.jurnal where no = 'BB-4';
  raise exception 'GAGAL: hapus jurnal di periode tertutup lolos';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  update public.jurnal set tgl = '2026-09-20' where no = 'BB-2';
  raise exception 'GAGAL: memindahkan jurnal ke periode tertutup lolos';
exception when sqlstate '42501' then null; end $$;
insert into public.jurnal (tgl, no, akun, nama, proyek, d, k) values ('2026-10-02', 'BB-6', '1-1001', 'Kas', 'LL', 5, 0), ('2026-10-02', 'BB-6', '4-1003', 'Lain', 'LL', 0, 5);
select pg_temp.cek('jurnal penyesuaian di periode buka tetap boleh', exists (select 1 from jurnal where no = 'BB-6'));
select pg_temp.cek('view menandai periode tertutup', (select status_periode = 'ditutup' from fin_v_jurnal where no = 'BB-4' limit 1));
do $$ begin
  perform public.fin_buka_periode('2026-09-01', 'pendek');
  raise exception 'GAGAL: buka periode tanpa alasan cukup lolos';
exception when sqlstate '22023' then null; end $$;
select pg_temp.cek('owner membuka kembali dengan alasan; jurnal bisa ditambah lagi',
  (public.fin_buka_periode('2026-09-01', 'koreksi nota yang terlewat dari rekening koran') ->> 'status') = 'dibuka');
insert into public.jurnal (tgl, no, akun, nama, proyek, d, k) values ('2026-09-30', 'BB-7', '1-1001', 'Kas', 'LL', 1, 0), ('2026-09-30', 'BB-7', '4-1003', 'Lain', 'LL', 0, 1);
select public.fin_tutup_periode('2026-09-01') ->> 'status';

-- Laporan beku
select pg_temp.cek('laporan dibekukan dengan hash', (public.fin_bekukan_laporan('laba_rugi', '2026-09-01', '{"laba": 100}', 'v1') ->> 'status') = 'dibekukan');
select pg_temp.cek('isi sama: tidak dobel', (public.fin_bekukan_laporan('laba_rugi', '2026-09-01', '{"laba": 100}', 'v1') ->> 'status') = 'sama_dengan_sebelumnya');
select pg_temp.cek('... tetap satu baris', (select count(*) from fin_laporan_beku) = 1);
do $$ begin
  update public.fin_laporan_beku set isi = '{"laba": 1}';
  raise exception 'GAGAL: laporan beku bisa diubah';
exception when sqlstate '42501' then null; end $$;
do $$ begin
  delete from public.fin_laporan_beku;
  raise exception 'GAGAL: laporan beku bisa dihapus';
exception when sqlstate '42501' then null; end $$;

-- Data AI CFO memuat status periode
select pg_temp.cek('cfo_ambil_data memuat fin_periode', (select (public.cfo_ambil_data(null) -> 'fin_periode') @> '[{"periode":"2026-09","status":"ditutup"}]'::jsonb));

select set_config('uji.cfo', '', false), set_config('uji.email', '', false);
select 'SEMUA UJI BUKU BESAR LULUS';
