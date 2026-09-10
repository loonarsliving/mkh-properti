-- ============================================================================
-- MKH Property — 0034: Beban Villa (Loonars Villa expense side of the report)
--
-- Follow-up to migration 0032 (pendapatan_villa). Owner asked for a proper
-- laba-rugi (income statement) for the villa business line, not just an
-- income log, so a symmetric expense-side table is needed.
--
-- Categories deliberately match how villa's OWN investor reporting actually
-- works today (confirmed by reading villa's src/app/investor/opex/page.tsx
-- directly, not assumed): villa stopped tracking itemized monthly opex —
-- "Opex properti tidak lagi dihitung dari rincian biaya aktual bulanan,
-- melainkan tetap [opex_pct]% dari omzet kotor ... sesuai akad" (opex is a
-- flat % of gross revenue per the ownership agreement, not itemized actuals).
-- villa-api's computeReport() applies two such flat percentages: opex_pct
-- (default 25%) and marketing_pct (default 27.5%). So 'opex' and 'marketing'
-- are first-class categories here — not invented, mirroring the real model —
-- with 'lainnya' for anything else the owner wants to record for this report
-- (e.g. a one-off cost) that doesn't fit either bucket.
--
-- Same design as pendapatan_villa: manual entry now, sumber/idempotency_key
-- ready for automatic sync later (villa-api's computeReport() already
-- returns opex_per_unit/marketing_amount, so a future sync round could push
-- these alongside the income items with no schema change here).
-- ============================================================================

create table public.beban_villa (
  id bigint generated always as identity primary key,
  periode date not null,
  kategori text not null check (kategori in ('opex', 'marketing', 'lainnya')),
  jumlah numeric(14, 2) not null default 0 check (jumlah >= 0),
  keterangan text,
  sumber text not null default 'manual' check (sumber in ('manual', 'villa_api')),
  idempotency_key text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index beban_villa_idempotency_key_uidx
  on public.beban_villa (idempotency_key)
  where idempotency_key is not null;

create index beban_villa_periode_idx on public.beban_villa (periode);

comment on table public.beban_villa is
  'Beban Loonars Villa (opex flat % + marketing flat % per akad, plus lainnya), pasangan pendapatan_villa (migrasi 0032) untuk menyusun laba-rugi villa di /laporan-villa. Diisi manual untuk saat ini; sumber/idempotency_key disiapkan untuk sinkronisasi otomatis di masa depan.';

alter table public.beban_villa enable row level security;

-- Pola akses sama persis dengan pendapatan_villa (0032) dan tabel keuangan
-- lain di project ini — lihat catatan di 0032 soal kenapa ini permisif,
-- bukan lebih ketat.
create policy anon_all_beban_villa on public.beban_villa for all
  to anon, authenticated using (true) with check (true);
