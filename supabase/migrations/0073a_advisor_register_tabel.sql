-- ============================================================================
-- 0073a — Loonars AI Advisor: register keputusan, syarat, dokumen, log
-- ============================================================================
--
-- Owner D-2026-005 (data advisor di database MKH Property, tabel advisor_*
-- tersendiri) & D-2026-007 (semua fitur advisor lewat layanan advisor/WA).
--
-- Desain:
--   * Tabel baru saja; tidak ada tabel/fungsi lama yang diubah.
--   * RLS aktif TANPA policy → anon/authenticated tidak bisa membaca/menulis
--     langsung. Semua akses lewat RPC security definer di bawah, yang hanya
--     berjalan bila header x-advisor-secret = Vault advisor_shared_secret
--     (rahasia yang sama dengan endpoint /api/cfo/advisor, 0072).
--   * Status CONFIRMED hanya bisa dipasang lewat advisor_keputusan_konfirmasi
--     (dari PROPOSED), sesuai aturan "CONFIRMED hanya setelah founder
--     mengonfirmasi". advisor_keputusan_simpan menolak status CONFIRMED/REVIEWED
--     dan tidak bisa mengubah keputusan yang sudah CONFIRMED/REVIEWED.
--     Keputusan lama dari repo Istri diimpor sekali oleh operator (bukan lewat RPC).
--   * advisor_log append-only (trigger menolak perubahan baris), pola cfo_audit_log.
-- ============================================================================

create table if not exists public.advisor_keputusan (
  id text primary key check (id ~ '^D-[0-9]{4}-[0-9]{3}$'),
  judul text not null check (length(judul) between 3 and 300),
  tanggal date not null default (now() at time zone 'Asia/Jakarta')::date,
  status text not null default 'PROPOSED'
    check (status in ('DRAFT', 'PROPOSED', 'CONFIRMED', 'REVIEWED', 'REJECTED', 'SUPERSEDED', 'IMPORTED')),
  isi jsonb not null default '{}'::jsonb,
  review_on date,
  confirmed_at timestamptz,
  confirmed_by text,
  sumber text not null default 'wa' check (sumber in ('wa', 'repo')),
  dibuat timestamptz not null default now(),
  diubah timestamptz not null default now()
);

create table if not exists public.advisor_syarat (
  id bigserial primary key,
  keputusan_id text references public.advisor_keputusan(id),
  teks text not null check (length(teks) between 3 and 500),
  tenggat date,
  status text not null default 'terbuka' check (status in ('terbuka', 'selesai', 'batal')),
  dibuat timestamptz not null default now()
);
create index if not exists advisor_syarat_tenggat_idx on public.advisor_syarat (status, tenggat);

create table if not exists public.advisor_dokumen (
  id bigserial primary key,
  jenis text not null check (jenis in ('board', 'mentor', 'riset', 'evaluasi', 'lain')),
  judul text not null check (length(judul) between 3 and 300),
  isi text not null check (octet_length(isi) <= 400000),
  keputusan_id text references public.advisor_keputusan(id),
  dibuat timestamptz not null default now()
);

create table if not exists public.advisor_pengaturan (
  kunci text primary key check (kunci ~ '^[a-z_]{1,40}$'),
  nilai text not null,
  diubah timestamptz not null default now()
);

create table if not exists public.advisor_log (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  aksi text not null check (length(aksi) between 1 and 60),
  ringkas jsonb not null default '{}'::jsonb
);

alter table public.advisor_keputusan enable row level security;
alter table public.advisor_syarat enable row level security;
alter table public.advisor_dokumen enable row level security;
alter table public.advisor_pengaturan enable row level security;
alter table public.advisor_log enable row level security;
revoke all on public.advisor_keputusan, public.advisor_syarat, public.advisor_dokumen,
              public.advisor_pengaturan, public.advisor_log from anon, authenticated;

