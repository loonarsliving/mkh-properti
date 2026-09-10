-- ============================================================================
-- MKH Property — 0032: Pendapatan Villa (Loonars Villa rental income report)
--
-- Context: the "Loonars Villa" rental operation (unit bookings, investor
-- revenue share) lives entirely in a SEPARATE Supabase project
-- (svcmybsziaelwwdrnzcv, repo "villa"/"loonars-private-living") from this
-- app's own project (gluoioiimapyhchdasfl). It is a different business line
-- from "Loonars Living" (COA project LL / loonars-sales unit closings,
-- which already syncs into this project's own `jurnal`/`loonars_fee`).
--
-- There is currently no data pipeline between the two projects for villa
-- rental income. This migration adds a dedicated table so that income can:
--   1. be entered manually for now (a new "Pendapatan Villa" report page), and
--   2. later be filled automatically by a sync job from the villa side,
--      without a schema change — `sumber`/`idempotency_key` below exist for
--      that purpose from day one, matching this project's existing
--      sync-inbound pattern (see sync_log, crm_payment_receipts).
--
-- Deliberately NOT posted into `jurnal`: villa rental income is not one of
-- this app's own PROYEK (AFP/IH/LL/GCI/GCR/HO) and folding it into the
-- double-entry ledger would require picking a COA account/proyek for a
-- business line that isn't part of this app's chart of accounts — that is
-- an accounting decision for the owner/CFO to make explicitly, not to be
-- invented here. This table is read by its own report page only.
-- ============================================================================

create table public.pendapatan_villa (
  id bigint generated always as identity primary key,
  -- Bulan pendapatan, selalu tanggal 1 (mis. '2026-09-01' untuk September 2026).
  periode date not null,
  kategori text not null check (kategori in ('rental', 'cafe', 'spa', 'lainnya')),
  jumlah numeric(14, 2) not null default 0 check (jumlah >= 0),
  keterangan text,
  -- 'manual' = diinput staf lewat halaman Pendapatan Villa.
  -- 'villa_api' = disediakan untuk sinkronisasi otomatis di masa depan dari
  -- sistem villa (villa-api / project svcmybsziaelwwdrnzcv) — belum dipakai.
  sumber text not null default 'manual' check (sumber in ('manual', 'villa_api')),
  -- Hanya diisi untuk baris hasil sinkronisasi otomatis nanti, supaya
  -- pengiriman ulang event yang sama tidak membuat baris duplikat —
  -- pola sama dengan sync_log.idempotency_key / jurnal.idempotency_key.
  idempotency_key text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index pendapatan_villa_idempotency_key_uidx
  on public.pendapatan_villa (idempotency_key)
  where idempotency_key is not null;

create index pendapatan_villa_periode_idx on public.pendapatan_villa (periode);

comment on table public.pendapatan_villa is
  'Pendapatan Loonars Villa (rental/cafe/spa), dicatat terpisah dari jurnal karena sumber datanya (sistem villa, project Supabase svcmybsziaelwwdrnzcv) belum tersambung otomatis ke project ini. Diisi manual untuk saat ini; kolom sumber/idempotency_key disiapkan untuk sinkronisasi otomatis di masa depan.';
comment on column public.pendapatan_villa.periode is
  'Selalu tanggal 1 pada bulannya (satu baris per bulan per kategori dari input manual; sinkronisasi otomatis nanti boleh menulis lebih dari satu baris per bulan asal idempotency_key berbeda).';
comment on column public.pendapatan_villa.sumber is
  'manual = input staf. villa_api = disiapkan untuk sinkronisasi otomatis dari sistem villa, belum diaktifkan.';

alter table public.pendapatan_villa enable row level security;

-- Sama dengan pola akses tabel keuangan lain di project ini (jurnal, aset,
-- pengajuan, crm_payment_receipts, dst): frontend memakai anon key, bukan
-- access token user, jadi kebijakan RLS-nya permisif dan enforcement
-- sesungguhnya ada di authGuard (lihat src/lib/auth.ts). Tabel baru ini
-- sengaja mengikuti pola yang sama persis, bukan pola lebih ketat, supaya
-- tidak menjadi satu-satunya tabel yang tidak bisa diakses frontend saat ini
-- — lihat catatan migrasi 0025 soal kenapa pengetatan RLS ditunda sampai ada
-- perubahan frontend yang menyertainya.
create policy anon_all_pendapatan_villa on public.pendapatan_villa for all
  to anon, authenticated using (true) with check (true);
