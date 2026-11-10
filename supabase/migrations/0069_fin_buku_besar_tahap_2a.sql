-- ============================================================================
-- 0069 — Tahap 2a institutional reporting: struktur buku besar tunggal,
--        dimensi properti, COA di database, peran keuangan, kunci periode,
--        laporan beku
-- ============================================================================
-- Rencana: docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md §5.2 & §6
-- (Tahap 2a), keputusan owner D-2 (buku besar tunggal, dimensi lewat TABEL
-- PEMETAAN — tabel `jurnal` tidak diubah), D-3 (satu badan hukum, L1/L2/LC =
-- properti), D-1 (jurnal proyek LL = pengembangan & penjualan villa Loonars 1).
-- Owner menyetujui "mulai menyiapkan Tahap 2a" (2026-11-10) setelah halaman
-- Kesiapan Investasi menunjukkan buku besar & kunci periode sebagai penghambat.
--
-- SEMUA ADITIF. Tidak ada DROP, tidak ada UPDATE/DELETE data lama, kolom tabel
-- `jurnal` tidak diubah.
--
--  1. fin_entitas — satu badan hukum (D-3).
--  2. fin_properti — L1, L2, LC (bagian keuangan L2), HO, dan proyek arsip yang
--     dikunci 0060 (AFP, IH, GCI, GCR, KDI).
--  3. fin_akun — COA lama (36 akun, kode & nama PERSIS sama dengan
--     src/lib/master.ts) + akun baru untuk laporan institusional, masing-masing
--     dipetakan ke laporan (neraca/laba rugi), baris laporan, dan kelompok arus
--     kas. Akun baru belum dipakai jurnal mana pun (posting = Tahap 2b).
--  4. fin_pemetaan_proyek (proyek jurnal → properti, berdasar keputusan owner
--     yang sudah ada) + fin_jurnal_dimensi (pengecualian per no transaksi) +
--     view fin_v_jurnal (jurnal + properti + entitas + info akun + status
--     periode). Jurnal baru otomatis ikut pemetaan proyeknya.
--  5. fin_peran + fin_peran_saya() + fin_boleh(aksi): owner, cfo, finance_staff,
--     viewer_laporan, investor_relations, auditor. Pengguna cfo_users = owner.
--     Tidak ada email yang ditulis di migrasi (repo publik).
--  6. fin_periode + trigger pada `jurnal`: transaksi bertanggal di bulan yang
--     DITUTUP ditolak (tambah/ubah/hapus); koreksi = jurnal penyesuaian di
--     periode yang masih buka. Saat migrasi ini diterapkan BELUM ADA bulan yang
--     ditutup, jadi perilaku jurnal tidak berubah sampai owner/CFO menutup
--     bulan lewat fin_tutup_periode (syarat: debit = kredit di bulan itu).
--     Membuka kembali (fin_buka_periode) hanya owner, wajib alasan, tercatat.
--  7. fin_laporan_beku — laporan final per periode (isi jsonb + SHA-256 + versi
--     mesin), append-only.
--  8. cfo_ambil_data menambah 'fin_periode' (status kunci per bulan) untuk Data
--     Quality & Kesiapan Investasi.
--
-- Setiap aksi tulis tercatat di cfo_audit_log (append-only).
--
-- Rollback (bila owner meminta): drop trigger trg_jurnal_periode_tertutup on
-- public.jurnal; lalu drop view/fungsi/tabel fin_* (tidak ada data lama yang
-- bergantung padanya).
-- ============================================================================

-- 1. Entitas --------------------------------------------------------------------
create table public.fin_entitas (
  id smallint primary key,
  kode text not null unique check (kode ~ '^[A-Z0-9]{2,10}$'),
  nama text not null,
  catatan text,
  dibuat_pada timestamptz not null default now()
);
insert into public.fin_entitas (id, kode, nama, catatan) values
  (1, 'PTLM', 'PT Loonars Mahakarya', 'Satu badan hukum (keputusan owner D-3, 2026-11-03); sebelumnya PT Maha Karya Haluoleo.');

-- 2. Properti / lini ------------------------------------------------------------
create table public.fin_properti (
  kode text primary key check (kode ~ '^[A-Z0-9]{2,10}$'),
  nama text not null,
  entitas_id smallint not null references public.fin_entitas(id),
  lini text not null check (lini in ('L1', 'L2', 'HOLDING', 'ARSIP')),
  status text not null check (status in ('konstruksi', 'pre_opening', 'operasi', 'tutup', 'arsip')),
  induk text references public.fin_properti(kode),
  catatan text,
  dibuat_pada timestamptz not null default now()
);
insert into public.fin_properti (kode, nama, entitas_id, lini, status, induk, catatan) values
  ('L1', 'Loonars 1 — villa Yogyakarta (pengembangan & hospitality)', 1, 'L1', 'operasi', null, 'Jurnal proyek LL = pembangunan & penjualan villa L1 (D-1). Operasional hotel dari sistem villa.'),
  ('L2', 'Loonars 2 — Loonars Living (developer & konstruksi)', 1, 'L2', 'konstruksi', null, 'Keuangan modul Loonars 2 (rekening A–D).'),
  ('LC', 'Loonars Coffee', 1, 'L2', 'operasi', 'L2', 'Memakai keuangan Loonars 2 (koreksi owner, migrasi 0059).'),
  ('HO', 'Holding / overhead', 1, 'HOLDING', 'operasi', null, 'Biaya bersama tingkat holding (gaji tim, dll.).'),
  ('AFP', 'Proyek arsip AFP', 1, 'ARSIP', 'arsip', null, 'Dikunci 2026-11-01 (migrasi 0060).'),
  ('IH', 'Proyek arsip IH', 1, 'ARSIP', 'arsip', null, 'Dikunci 2026-11-01 (migrasi 0060).'),
  ('GCI', 'Proyek arsip GCI', 1, 'ARSIP', 'arsip', null, 'Dikunci 2026-11-01 (migrasi 0060).'),
  ('GCR', 'Proyek arsip GCR', 1, 'ARSIP', 'arsip', null, 'Dikunci 2026-11-01 (migrasi 0060).'),
  ('KDI', 'Proyek arsip KDI', 1, 'ARSIP', 'arsip', null, 'Dikunci 2026-11-01 (migrasi 0060).');

-- 3. Bagan akun -----------------------------------------------------------------
create table public.fin_akun (
  kode text primary key check (kode ~ '^[1-9]-[0-9]{4}$'),
  nama text not null,
  nama_laporan text not null,
  kategori text not null,
  saldo_normal char(1) not null check (saldo_normal in ('D', 'K')),
  laporan text not null check (laporan in ('neraca', 'laba_rugi')),
  baris_laporan text not null,
  arus_kas text check (arus_kas in ('kas', 'operasi', 'investasi', 'pendanaan')),
  asal text not null check (asal in ('coa_lama', 'baru')),
  aktif boolean not null default true,
  catatan text
);
insert into public.fin_akun (kode, nama, nama_laporan, kategori, saldo_normal, laporan, baris_laporan, arus_kas, asal) values
  -- COA lama (src/lib/master.ts) — kode & nama TIDAK diubah
  ('1-1001', 'Kas Tunai', 'Kas dan Setara Kas', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1002', 'Bank Al Fath Puuwatu', 'Bank Al Fath Puuwatu', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1003', 'Bank Introvert House', 'Bank Introvert House', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1004', 'Bank Loonars Living', 'Bank Loonars Living', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1005', 'Bank Griya Cariu Indah', 'Bank Griya Cariu Indah', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1008', 'Bank Green Cibarusah Residence', 'Bank Green Cibarusah Residence', 'Aset Lancar', 'D', 'neraca', 'kas_setara_kas', 'kas', 'coa_lama'),
  ('1-1006', 'Piutang Antar Proyek', 'Piutang Antar Proyek', 'Aset Lancar', 'D', 'neraca', 'piutang_antar_properti', 'operasi', 'coa_lama'),
  ('1-1007', 'Piutang Pembeli', 'Piutang Usaha', 'Aset Lancar', 'D', 'neraca', 'piutang_usaha', 'operasi', 'coa_lama'),
  ('1-2001', 'Tanah', 'Tanah', 'Aset Tetap', 'D', 'neraca', 'aset_tetap', 'investasi', 'coa_lama'),
  ('1-2002', 'Bangunan / Konstruksi', 'Bangunan dan Konstruksi', 'Aset Tetap', 'D', 'neraca', 'aset_tetap', 'investasi', 'coa_lama'),
  ('1-2003', 'Peralatan', 'Peralatan', 'Aset Tetap', 'D', 'neraca', 'aset_tetap', 'investasi', 'coa_lama'),
  ('2-1001', 'Utang Usaha Distributor', 'Utang Usaha', 'Liabilitas Lancar', 'K', 'neraca', 'utang_usaha', 'operasi', 'coa_lama'),
  ('2-1002', 'Utang Antar Proyek', 'Utang Antar Proyek', 'Liabilitas Lancar', 'K', 'neraca', 'utang_antar_properti', 'operasi', 'coa_lama'),
  ('2-1003', 'Uang Muka Pembeli', 'Uang Muka Pelanggan', 'Liabilitas Lancar', 'K', 'neraca', 'uang_muka_pelanggan', 'operasi', 'coa_lama'),
  ('2-1004', 'Utang Bank', 'Utang Bank Jangka Pendek', 'Liabilitas Lancar', 'K', 'neraca', 'utang_bank_pendek', 'pendanaan', 'coa_lama'),
  ('2-2001', 'KPR / Utang Jk Panjang', 'Utang Bank Jangka Panjang', 'Liabilitas Panjang', 'K', 'neraca', 'utang_bank_panjang', 'pendanaan', 'coa_lama'),
  ('3-1001', 'Modal Pemilik', 'Modal Disetor', 'Ekuitas', 'K', 'neraca', 'modal_disetor', 'pendanaan', 'coa_lama'),
  ('3-1002', 'Laba Ditahan', 'Saldo Laba (Rugi) Ditahan', 'Ekuitas', 'K', 'neraca', 'saldo_laba', null, 'coa_lama'),
  ('4-1001', 'Penjualan Rumah', 'Pendapatan Penjualan Rumah', 'Pendapatan', 'K', 'laba_rugi', 'pendapatan_penjualan_unit', 'operasi', 'coa_lama'),
  ('4-1002', 'Uang Muka Penjualan', 'Pendapatan Uang Muka', 'Pendapatan', 'K', 'laba_rugi', 'pendapatan_penjualan_unit', 'operasi', 'coa_lama'),
  ('4-1003', 'Pendapatan Lain', 'Pendapatan Lain-lain', 'Pendapatan', 'K', 'laba_rugi', 'pendapatan_lain', 'operasi', 'coa_lama'),
  ('5-1001', 'Pembelian Material', 'Beban Pembelian Material', 'HPP', 'D', 'laba_rugi', 'hpp_properti', 'operasi', 'coa_lama'),
  ('5-1002', 'Bayar Distributor', 'Beban Pembayaran Distributor', 'HPP', 'D', 'laba_rugi', 'hpp_properti', 'operasi', 'coa_lama'),
  ('5-1003', 'Biaya Upah Tukang', 'Beban Upah Tenaga Kerja', 'HPP', 'D', 'laba_rugi', 'hpp_properti', 'operasi', 'coa_lama'),
  ('5-1004', 'Biaya Subkontraktor', 'Beban Subkontraktor', 'HPP', 'D', 'laba_rugi', 'hpp_properti', 'operasi', 'coa_lama'),
  ('5-1005', 'Biaya Overhead Proyek', 'Beban Overhead Proyek', 'HPP', 'D', 'laba_rugi', 'hpp_properti', 'operasi', 'coa_lama'),
  ('6-1001', 'Gaji Staf', 'Beban Gaji dan Tunjangan', 'Beban Operasional', 'D', 'laba_rugi', 'opex_gaji', 'operasi', 'coa_lama'),
  ('6-1002', 'Sewa Kantor', 'Beban Sewa', 'Beban Operasional', 'D', 'laba_rugi', 'opex_sewa', 'operasi', 'coa_lama'),
  ('6-1003', 'Listrik & Air', 'Beban Utilitas', 'Beban Operasional', 'D', 'laba_rugi', 'opex_listrik_air', 'operasi', 'coa_lama'),
  ('6-1004', 'Transportasi', 'Beban Transportasi', 'Beban Operasional', 'D', 'laba_rugi', 'opex_administrasi', 'operasi', 'coa_lama'),
  ('6-1005', 'Perizinan & Notaris', 'Beban Perizinan dan Notaris', 'Beban Operasional', 'D', 'laba_rugi', 'opex_administrasi', 'operasi', 'coa_lama'),
  ('6-1006', 'Biaya Pemasaran', 'Beban Pemasaran', 'Beban Operasional', 'D', 'laba_rugi', 'opex_pemasaran', 'operasi', 'coa_lama'),
  ('6-1007', 'Beban Lain-lain', 'Beban Lain-lain', 'Beban Operasional', 'D', 'laba_rugi', 'opex_lain', 'operasi', 'coa_lama'),
  ('6-1008', 'Komisi Sales', 'Beban Komisi Sales', 'Beban Operasional', 'D', 'laba_rugi', 'opex_pemasaran', 'operasi', 'coa_lama'),
  ('6-1009', 'Bonus Karyawan', 'Beban Bonus Karyawan', 'Beban Operasional', 'D', 'laba_rugi', 'opex_gaji', 'operasi', 'coa_lama'),
  ('6-1010', 'Reimbursement Karyawan', 'Beban Reimbursement Karyawan', 'Beban Operasional', 'D', 'laba_rugi', 'opex_lain', 'operasi', 'coa_lama'),
  -- Akun baru untuk laporan institusional (belum dipakai jurnal; posting = Tahap 2b)
  ('1-1101', 'Piutang OTA', 'Piutang Usaha — OTA', 'Aset Lancar', 'D', 'neraca', 'piutang_usaha', 'operasi', 'baru'),
  ('1-1201', 'Persediaan', 'Persediaan', 'Aset Lancar', 'D', 'neraca', 'persediaan', 'operasi', 'baru'),
  ('1-1202', 'Persediaan Unit Properti', 'Persediaan Unit Properti (belum terjual)', 'Aset Lancar', 'D', 'neraca', 'persediaan', 'operasi', 'baru'),
  ('1-1301', 'Biaya Dibayar Dimuka', 'Biaya Dibayar di Muka', 'Aset Lancar', 'D', 'neraca', 'biaya_dibayar_dimuka', 'operasi', 'baru'),
  ('1-2901', 'Akumulasi Penyusutan', 'Akumulasi Penyusutan', 'Aset Tetap', 'K', 'neraca', 'aset_tetap', null, 'baru'),
  ('2-1101', 'Beban Akrual', 'Beban Masih Harus Dibayar', 'Liabilitas Lancar', 'K', 'neraca', 'beban_akrual', 'operasi', 'baru'),
  ('2-1201', 'Utang Pajak', 'Utang Pajak', 'Liabilitas Lancar', 'K', 'neraca', 'utang_pajak', 'operasi', 'baru'),
  ('2-1301', 'Utang Bagi Hasil Investor', 'Utang Bagi Hasil Investor', 'Liabilitas Lancar', 'K', 'neraca', 'utang_investor', 'operasi', 'baru'),
  ('2-1401', 'Dana Talangan Owner', 'Utang kepada Pemilik (Dana Talangan)', 'Liabilitas Lancar', 'K', 'neraca', 'utang_pemilik', 'pendanaan', 'baru'),
  ('2-2101', 'Pinjaman Lain', 'Pinjaman Lain', 'Liabilitas Panjang', 'K', 'neraca', 'pinjaman_lain', 'pendanaan', 'baru'),
  ('4-2001', 'Pendapatan Kamar', 'Pendapatan Kamar', 'Pendapatan', 'K', 'laba_rugi', 'pendapatan_kamar', 'operasi', 'baru'),
  ('4-2002', 'Diskon & Komisi OTA', 'Potongan Pendapatan — Komisi OTA', 'Pendapatan', 'D', 'laba_rugi', 'potongan_pendapatan', 'operasi', 'baru'),
  ('4-2003', 'Pendapatan F&B', 'Pendapatan Makanan & Minuman', 'Pendapatan', 'K', 'laba_rugi', 'pendapatan_fnb', 'operasi', 'baru'),
  ('5-2001', 'Biaya Langsung Kamar', 'Beban Pokok Kamar', 'HPP', 'D', 'laba_rugi', 'hpp_hospitality', 'operasi', 'baru'),
  ('5-2002', 'HPP F&B', 'Beban Pokok Makanan & Minuman', 'HPP', 'D', 'laba_rugi', 'hpp_hospitality', 'operasi', 'baru'),
  ('6-2001', 'Laundry', 'Beban Laundry', 'Beban Operasional', 'D', 'laba_rugi', 'opex_laundry', 'operasi', 'baru'),
  ('6-2002', 'Maintenance & Perbaikan', 'Beban Pemeliharaan dan Perbaikan', 'Beban Operasional', 'D', 'laba_rugi', 'opex_maintenance', 'operasi', 'baru'),
  ('6-2003', 'Software & Langganan', 'Beban Software dan Langganan', 'Beban Operasional', 'D', 'laba_rugi', 'opex_software', 'operasi', 'baru'),
  ('6-2004', 'Administrasi & Umum', 'Beban Administrasi dan Umum', 'Beban Operasional', 'D', 'laba_rugi', 'opex_administrasi', 'operasi', 'baru'),
  ('6-2005', 'Bagi Hasil Investor', 'Beban Bagi Hasil Investor Properti', 'Beban Operasional', 'D', 'laba_rugi', 'bagi_hasil_investor', 'operasi', 'baru'),
  ('6-3001', 'Penyusutan & Amortisasi', 'Beban Penyusutan dan Amortisasi', 'Beban Operasional', 'D', 'laba_rugi', 'penyusutan', null, 'baru'),
  ('7-1001', 'Beban Bunga', 'Beban Bunga', 'Beban Lain', 'D', 'laba_rugi', 'beban_bunga', 'pendanaan', 'baru'),
  ('7-2001', 'PPh Final', 'Beban PPh Final', 'Pajak', 'D', 'laba_rugi', 'pajak_penghasilan', 'operasi', 'baru'),
  ('7-2002', 'PPh Badan', 'Beban PPh Badan', 'Pajak', 'D', 'laba_rugi', 'pajak_penghasilan', 'operasi', 'baru');

-- 4. Dimensi properti untuk jurnal ---------------------------------------------
create table public.fin_pemetaan_proyek (
  proyek text primary key check (proyek = upper(trim(proyek))),
  properti_kode text not null references public.fin_properti(kode),
  dasar text not null,
  disetujui_oleh text,
  disetujui_pada timestamptz
);
insert into public.fin_pemetaan_proyek (proyek, properti_kode, dasar, disetujui_oleh, disetujui_pada) values
  ('LL', 'L1', 'Keputusan owner D-1 (2026-11-03): jurnal proyek LL = pembangunan & penjualan villa Loonars 1; diverifikasi tidak memuat belanja Loonars 2.', 'owner (D-1)', '2026-11-03'),
  ('LC', 'LC', 'Koreksi owner 2026-11-01 (migrasi 0059): Loonars Coffee memakai keuangan Loonars 2.', 'owner (0059)', '2026-11-01'),
  ('HO', 'HO', 'Overhead holding.', 'owner (0060)', '2026-11-01'),
  ('AFP', 'AFP', 'Proyek arsip, dikunci (migrasi 0060).', 'owner (0060)', '2026-11-01'),
  ('IH', 'IH', 'Proyek arsip, dikunci (migrasi 0060).', 'owner (0060)', '2026-11-01'),
  ('GCI', 'GCI', 'Proyek arsip, dikunci (migrasi 0060).', 'owner (0060)', '2026-11-01'),
  ('GCR', 'GCR', 'Proyek arsip, dikunci (migrasi 0060).', 'owner (0060)', '2026-11-01'),
  ('KDI', 'KDI', 'Proyek arsip, dikunci (migrasi 0060).', 'owner (0060)', '2026-11-01');

-- Pengecualian per transaksi (mis. satu transaksi LL yang ternyata milik L2); kosong saat dibuat.
create table public.fin_jurnal_dimensi (
  no text primary key,
  properti_kode text not null references public.fin_properti(kode),
  antar_properti boolean not null default false,
  alasan text not null check (length(alasan) between 5 and 500),
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now()
);

-- 5. Peran keuangan ---------------------------------------------------------------
create table public.fin_peran (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  peran text not null check (peran in ('owner', 'cfo', 'finance_staff', 'viewer_laporan', 'investor_relations', 'auditor')),
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now()
);

create or replace function public.fin_peran_saya()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.mkh_is_cfo() then 'owner'
              else (select p.peran from public.fin_peran p where p.email = public.mkh_email_login()) end;
$$;

-- aksi: 'kelola' (peran, periode, pemetaan), 'tutup_periode', 'posting', 'baca_buku_besar', 'baca_laporan'
create or replace function public.fin_boleh(p_aksi text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case public.fin_peran_saya()
    when 'owner' then true
    when 'cfo' then p_aksi in ('tutup_periode', 'posting', 'baca_buku_besar', 'baca_laporan')
    when 'finance_staff' then p_aksi in ('posting', 'baca_buku_besar', 'baca_laporan')
    when 'auditor' then p_aksi in ('baca_buku_besar', 'baca_laporan')
    when 'viewer_laporan' then p_aksi = 'baca_laporan'
    when 'investor_relations' then p_aksi = 'baca_laporan'
    else false end, false);
$$;

-- 6. Periode & kunci ----------------------------------------------------------------
create table public.fin_periode (
  periode date primary key check (periode = date_trunc('month', periode)::date),
  entitas_id smallint not null default 1 references public.fin_entitas(id),
  status text not null check (status in ('buka', 'ditutup')),
  ditutup_oleh text,
  ditutup_pada timestamptz,
  catatan text,
  diubah_pada timestamptz not null default now()
);

create or replace function public._fin_tolak_periode_tertutup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tgl date;
begin
  foreach v_tgl in array array[case when tg_op in ('INSERT', 'UPDATE') then new.tgl end, case when tg_op in ('UPDATE', 'DELETE') then old.tgl end] loop
    continue when v_tgl is null;
    if exists (select 1 from public.fin_periode p where p.periode = date_trunc('month', v_tgl)::date and p.status = 'ditutup') then
      raise exception 'Periode % sudah ditutup. Koreksi dicatat sebagai jurnal penyesuaian bertanggal di periode yang masih buka.', to_char(v_tgl, 'YYYY-MM')
        using errcode = '42501';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger trg_jurnal_periode_tertutup before insert or update or delete on public.jurnal
  for each row execute function public._fin_tolak_periode_tertutup();

create or replace function public._fin_aktor()
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce('web:' || public.mkh_email_login(), 'sistem') $$;

create or replace function public.fin_tutup_periode(p_periode date, p_catatan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p date := date_trunc('month', p_periode)::date;
  v_timpang text;
begin
  if not public.fin_boleh('tutup_periode') then
    raise exception 'Tidak berhak menutup periode' using errcode = '42501';
  end if;
  if v_p >= date_trunc('month', (now() at time zone 'Asia/Makassar'))::date then
    raise exception 'Bulan berjalan belum bisa ditutup' using errcode = '22023';
  end if;
  if exists (select 1 from public.fin_periode where periode = v_p and status = 'ditutup') then
    return jsonb_build_object('status', 'sudah_ditutup', 'periode', v_p);
  end if;
  select string_agg(coalesce(j.proyek, '-') || ' (selisih ' || (j.d - j.k)::text || ')', ', ') into v_timpang
    from (select proyek, sum(coalesce(d, 0)) d, sum(coalesce(k, 0)) k from public.jurnal
           where tgl >= v_p and tgl < (v_p + interval '1 month') group by proyek) j
   where abs(j.d - j.k) > 1;
  if v_timpang is not null then
    raise exception 'Periode % belum seimbang (debit ≠ kredit): %', to_char(v_p, 'YYYY-MM'), v_timpang using errcode = '22023';
  end if;
  insert into public.fin_periode (periode, status, ditutup_oleh, ditutup_pada, catatan, diubah_pada)
  values (v_p, 'ditutup', public._fin_aktor(), now(), nullif(btrim(coalesce(p_catatan, '')), ''), now())
  on conflict (periode) do update set status = 'ditutup', ditutup_oleh = excluded.ditutup_oleh, ditutup_pada = now(),
    catatan = coalesce(excluded.catatan, public.fin_periode.catatan), diubah_pada = now();
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (public._fin_aktor(), 'web', 'fin_tutup_periode', jsonb_build_object('periode', v_p, 'catatan', p_catatan));
  return jsonb_build_object('status', 'ditutup', 'periode', v_p);
end;
$$;

create or replace function public.fin_buka_periode(p_periode date, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p date := date_trunc('month', p_periode)::date;
begin
  if not public.fin_boleh('kelola') then
    raise exception 'Hanya owner yang boleh membuka kembali periode' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_alasan, ''))) < 10 then
    raise exception 'Tulis alasan membuka kembali periode (minimal 10 karakter)' using errcode = '22023';
  end if;
  update public.fin_periode set status = 'buka', catatan = 'Dibuka kembali: ' || btrim(p_alasan), diubah_pada = now()
   where periode = v_p and status = 'ditutup';
  if not found then
    return jsonb_build_object('status', 'tidak_ditutup', 'periode', v_p);
  end if;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (public._fin_aktor(), 'web', 'fin_buka_periode', jsonb_build_object('periode', v_p, 'alasan', p_alasan));
  return jsonb_build_object('status', 'dibuka', 'periode', v_p);
end;
$$;

-- 7. Laporan beku -----------------------------------------------------------------
create table public.fin_laporan_beku (
  id bigserial primary key,
  jenis text not null check (jenis ~ '^[a-z_]{3,40}$'),
  periode date not null,
  versi_mesin text not null check (length(versi_mesin) between 1 and 40),
  isi jsonb not null,
  hash text not null,
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now(),
  unique (jenis, periode, hash)
);
create or replace function public._fin_tolak_ubah_laporan_beku()
returns trigger
language plpgsql
as $$
begin
  raise exception 'fin_laporan_beku hanya boleh ditambah (append-only)' using errcode = '42501';
end;
$$;
create trigger fin_laporan_beku_append_only before update or delete on public.fin_laporan_beku
  for each row execute function public._fin_tolak_ubah_laporan_beku();

create or replace function public.fin_bekukan_laporan(p_jenis text, p_periode date, p_isi jsonb, p_versi_mesin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_id bigint;
begin
  if not public.fin_boleh('tutup_periode') then
    raise exception 'Tidak berhak membekukan laporan' using errcode = '42501';
  end if;
  if p_isi is null or octet_length(p_isi::text) > 2000000 then
    raise exception 'Isi laporan kosong atau terlalu besar' using errcode = '22023';
  end if;
  v_hash := encode(sha256(convert_to(p_isi::text, 'UTF8')), 'hex');
  insert into public.fin_laporan_beku (jenis, periode, versi_mesin, isi, hash, dibuat_oleh)
  values (p_jenis, date_trunc('month', p_periode)::date, p_versi_mesin, p_isi, v_hash, public._fin_aktor())
  on conflict (jenis, periode, hash) do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
    values (public._fin_aktor(), 'web', 'fin_bekukan_laporan', jsonb_build_object('jenis', p_jenis, 'periode', p_periode, 'hash', v_hash, 'id', v_id));
  end if;
  return jsonb_build_object('status', case when v_id is null then 'sama_dengan_sebelumnya' else 'dibekukan' end, 'hash', v_hash, 'id', v_id);
end;
$$;

-- View jurnal berdimensi ----------------------------------------------------------
create view public.fin_v_jurnal with (security_invoker = true) as
select
  j.id, j.tgl, j.no, j.ket, j.akun, j.nama, j.proyek, j.d, j.k, j.source_system, j.source_ref,
  coalesce(x.properti_kode, mp.properti_kode) as properti_kode,
  case when x.no is not null then 'pengecualian' when mp.proyek is not null then 'pemetaan_proyek' else 'belum_dipetakan' end as dasar_dimensi,
  coalesce(x.antar_properti, false) as antar_properti,
  p.entitas_id, p.lini,
  a.laporan, a.baris_laporan, a.arus_kas,
  coalesce(pr.status, 'buka') as status_periode
from public.jurnal j
left join public.fin_jurnal_dimensi x on x.no = j.no
left join public.fin_pemetaan_proyek mp on mp.proyek = upper(trim(j.proyek))
left join public.fin_properti p on p.kode = coalesce(x.properti_kode, mp.properti_kode)
left join public.fin_akun a on a.kode = j.akun
left join public.fin_periode pr on pr.periode = date_trunc('month', j.tgl)::date;

-- RLS & hak ------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_entitas', 'fin_properti', 'fin_akun', 'fin_pemetaan_proyek', 'fin_jurnal_dimensi', 'fin_periode', 'fin_laporan_beku', 'fin_peran'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy fin_baca on public.fin_entitas for select to authenticated using ((select public.fin_boleh('baca_laporan')));
create policy fin_baca on public.fin_properti for select to authenticated using ((select public.fin_boleh('baca_laporan')));
create policy fin_baca on public.fin_akun for select to authenticated using ((select public.fin_boleh('baca_laporan')));
create policy fin_baca on public.fin_pemetaan_proyek for select to authenticated using ((select public.fin_boleh('baca_buku_besar')));
create policy fin_baca on public.fin_jurnal_dimensi for select to authenticated using ((select public.fin_boleh('baca_buku_besar')));
create policy fin_baca on public.fin_periode for select to authenticated using ((select public.mkh_is_staf()) or (select public.fin_boleh('baca_laporan')));
create policy fin_baca on public.fin_laporan_beku for select to authenticated using ((select public.fin_boleh('baca_laporan')));
create policy fin_baca on public.fin_peran for select to authenticated using ((select public.fin_boleh('kelola')) or email = (select public.mkh_email_login()));
revoke all on public.fin_v_jurnal from public, anon;
grant select on public.fin_v_jurnal to authenticated;

revoke execute on function public.fin_peran_saya() from public, anon;
grant execute on function public.fin_peran_saya() to authenticated;
revoke execute on function public.fin_boleh(text) from public, anon;
grant execute on function public.fin_boleh(text) to authenticated;
revoke execute on function public._fin_tolak_periode_tertutup() from public, anon, authenticated;
revoke execute on function public._fin_aktor() from public, anon, authenticated;
revoke execute on function public._fin_tolak_ubah_laporan_beku() from public, anon, authenticated;
revoke execute on function public.fin_tutup_periode(date, text) from public, anon;
grant execute on function public.fin_tutup_periode(date, text) to authenticated;
revoke execute on function public.fin_buka_periode(date, text) from public, anon;
grant execute on function public.fin_buka_periode(date, text) to authenticated;
revoke execute on function public.fin_bekukan_laporan(text, date, jsonb, text) from public, anon;
grant execute on function public.fin_bekukan_laporan(text, date, jsonb, text) to authenticated;

-- 8. Status kunci periode ikut data AI CFO ------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.cfo_ambil_data(text)'::regprocedure);
  v_new := replace(v_def, $q$    'pengajuan_menunggu', coalesce(($q$,
    $q$    'fin_periode', coalesce((
      select jsonb_agg(jsonb_build_object('periode', to_char(f.periode, 'YYYY-MM'), 'status', f.status, 'ditutup_pada', f.ditutup_pada) order by f.periode)
      from public.fin_periode f), '[]'::jsonb),
    'pengajuan_menunggu', coalesce(($q$);
  if v_new = v_def or position('''fin_periode''' in v_new) = 0 then
    raise exception 'penggantian cfo_ambil_data gagal (0069)';
  end if;
  execute v_new;
end;
$$;
