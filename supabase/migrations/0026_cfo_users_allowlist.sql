-- SECURITY FIX (audit finding, High): broken access control — any account
-- that self-registers via login.html's "Daftar" (signup) flow and is NOT
-- present in users_proyek was, before this fix, routed straight into the
-- full CFO/owner dashboard (index.html) with read/write access to every
-- project's cash, journal, assets and users. There was no positive
-- allowlist of who is actually allowed to see the CFO dashboard — the app
-- only checked "is the session valid", not "is this a recognized staff
-- member with CFO/owner privileges".
--
-- This migration adds a small allowlist table. index.html's authGuard now
-- requires the logged-in user's email to exist in this table before
-- rendering the CFO dashboard; anyone else is redirected to
-- no-access.html.
--
-- *** MANUAL STEP REQUIRED AFTER APPLYING THIS MIGRATION ***
-- This table starts EMPTY. Until the real owner/CFO email(s) are inserted,
-- NOBODY (including the legitimate owner) will be able to open
-- index.html. Insert the authorized email(s) via the Supabase SQL editor
-- or table editor, e.g.:
--
--   insert into public.cfo_users (email, nama) values
--     ('owner@example.com', 'Nama Owner');
--
-- This is intentional: we cannot safely guess which email(s) should have
-- full company-wide financial access from the code alone, and defaulting
-- to "allow" would reintroduce the exact vulnerability being fixed.

begin;

create table if not exists public.cfo_users (
  email      text primary key,
  nama       text,
  created_at timestamptz not null default now()
);

comment on table public.cfo_users is
  'Allowlist of accounts permitted to access the full CFO/owner dashboard (index.html). Checked by the client authGuard before rendering company-wide financial data. Must be populated manually — see migration 0026 for details.';

alter table public.cfo_users enable row level security;

-- Read-only, anon-allowed lookup by exact email — mirrors the existing
-- users_proyek role-check pattern used throughout the app (login.html,
-- index.html, admin-proyek.html) which runs before any user-scoped bearer
-- token is available. This table only exposes email/name of already
-- vetted CFO accounts, not financial data, so anon SELECT is an
-- acceptable, low-risk trade-off for that existing pattern.
create policy anon_read_cfo_users on public.cfo_users
  for select
  to anon, authenticated
  using (true);

-- No anon or authenticated write policy is created — rows must be
-- inserted/removed manually via the Supabase dashboard/SQL editor (or by
-- a service-role Edge Function in the future), never from the client.

commit;
