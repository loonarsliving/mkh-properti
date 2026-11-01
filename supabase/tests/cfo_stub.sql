-- Stub tambahan untuk menguji migrasi 0057 (AI CFO) di Postgres lokal sekali
-- pakai — dijalankan SETELAH loonars2_stub.sql dan migrasi 0043–0056.
-- Tabel-tabel ini sudah ada di produksi (sebagian dibuat di luar riwayat
-- migrasi repo); di sini hanya kolom yang dibaca cfo_ambil_data.
insert into vault.secrets_stub values ('villa_sync_shared_secret', 'rahasia-villa') on conflict do nothing;

create table if not exists public.jurnal (
  id bigserial primary key, tgl date, no text, ket text, akun text, nama text, proyek text,
  d numeric, k numeric, created_at timestamptz default now(), idempotency_key text, source_system text, source_ref text
);
create table if not exists public.pengajuan (
  id bigserial primary key, proyek text, tipe text, data jsonb, status text, created_at timestamptz default now()
);
create table if not exists public.utang_bank (
  id serial primary key, proyek text, jenis text, bank text, no_akad text, pokok numeric, potongan_per_unit numeric,
  terbayar numeric, tgl_akad date, jt_tempo date, ket text, created_at timestamp default now()
);
create table if not exists public.laporan_villa_bulanan (
  periode date primary key, status text, omzet_kotor numeric, komisi_ota numeric, pendapatan_bersih numeric,
  pendapatan_walkin numeric, malam_terjual int, malam_gratis int, malam_tersedia int, okupansi_pct numeric,
  cogs_per_malam numeric, cogs numeric, gross_profit numeric, opex numeric, net_profit numeric, rincian jsonb,
  diterima_pada timestamptz default now()
);
create table if not exists public.pajak_hotel_villa (
  periode date primary key, tarif_pct numeric, dasar text, dasar_pengenaan numeric, pajak_terutang numeric,
  jumlah_disetor numeric, tgl_setor date
);
create table if not exists public.ir_unit_bisnis (id bigserial primary key, kode text unique);
create table if not exists public.ir_metrik_bulanan (
  id bigserial primary key, unit_id bigint, periode text, status text, metrik jsonb, diterima_pada timestamptz default now()
);
