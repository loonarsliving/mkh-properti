-- SECURITY FIX (audit finding, Medium): the core financial/business tables
-- (jurnal, aset, utang_bank, tukang_borongan, bayar_tukang, pengajuan,
-- users_proyek) technically have Row Level Security "enabled" in the live
-- database, but every one of them also carries a permissive policy that
-- grants the `anon` role unrestricted SELECT/INSERT/UPDATE/DELETE
-- (`USING (true)` / `WITH CHECK (true)`). Since the app ships the public
-- anon key directly in client-side JS, this is equivalent to having NO
-- access control at all: anyone who copies the anon key out of the page
-- source can read or write every row of every financial table directly
-- against the REST API, bypassing the app UI entirely.
--
-- This migration removes the wide-open anon policies and restricts access
-- to the `authenticated` Postgres role only, as a conservative default.
--
-- *** IMPORTANT — READ BEFORE APPLYING THIS MIGRATION ***
-- The current front-end (index.html, admin-proyek.html, pengeluaran.html,
-- verifikasi.html, lapor-*.html, etc.) authenticates every REST call to
-- these tables using the ANON key in the Authorization header — NOT the
-- logged-in user's own session access token. (admin-proyek.html even has
-- an explicit comment reverting a prior attempt to use the user's token:
-- "FIX: gunakan anon key (SB_KEY) bukan user token agar RLS tidak
-- memblokir admin baru".) That means, from PostgREST's point of view,
-- every request the app makes today is an `anon`-role request, regardless
-- of whether a human is logged in.
--
-- Applying this migration WITHOUT ALSO changing the front-end to send
-- `Authorization: Bearer <sb_access_token>` (the user's real session JWT)
-- instead of the anon key on these calls will immediately break the whole
-- app for every user — every sbGet/sbInsert/sbUpdate/sbDelete call will
-- start failing, because the request will still be evaluated as `anon`
-- and `anon` no longer has any access.
--
-- Do NOT apply this against production until:
--   1. The client fetch() calls for these tables are updated to send the
--      user's own access token (sessionStorage "sb_access_token") instead
--      of the anon key, and
--   2. Ideally, per-row scoping is added (e.g. a policy that only allows
--      a user to see/write rows for a `proyek` they're assigned to in
--      users_proyek, or that only CFO/owner accounts see everything) —
--      this migration intentionally does NOT attempt that business-logic
--      scoping because it isn't fully derivable from the code alone, and
--      guessing it wrong risks being either still-too-open or silently
--      hiding legitimate data from legitimate users. A human who knows
--      the intended roles (CFO/owner vs. per-project admin vs. verifikator)
--      should review and tighten these policies further.
--
-- Test in a staging/branch project first.

begin;

-- ── jurnal ──────────────────────────────────────────────────────────────
drop policy if exists anon_delete_jurnal  on public.jurnal;
drop policy if exists anon_insert_jurnal  on public.jurnal;
drop policy if exists anon_read_jurnal    on public.jurnal;
drop policy if exists anon_update_jurnal  on public.jurnal;
drop policy if exists public_jurnal       on public.jurnal;

alter table public.jurnal enable row level security;

create policy authenticated_all_jurnal on public.jurnal
  for all
  to authenticated
  using (true)
  with check (true);

-- ── aset ────────────────────────────────────────────────────────────────
drop policy if exists anon_delete_aset on public.aset;
drop policy if exists anon_insert_aset on public.aset;
drop policy if exists anon_read_aset   on public.aset;
drop policy if exists public_aset      on public.aset;

alter table public.aset enable row level security;

create policy authenticated_all_aset on public.aset
  for all
  to authenticated
  using (true)
  with check (true);

-- ── utang_bank ──────────────────────────────────────────────────────────
drop policy if exists anon_delete_utang on public.utang_bank;
drop policy if exists anon_insert_utang on public.utang_bank;
drop policy if exists anon_read_utang_bank on public.utang_bank;

alter table public.utang_bank enable row level security;

create policy authenticated_all_utang_bank on public.utang_bank
  for all
  to authenticated
  using (true)
  with check (true);

-- ── tukang_borongan ─────────────────────────────────────────────────────
drop policy if exists anon_delete_tukang on public.tukang_borongan;
drop policy if exists anon_insert_tukang on public.tukang_borongan;
drop policy if exists anon_read_tukang_borongan on public.tukang_borongan;
drop policy if exists anon_update_tukang on public.tukang_borongan;

alter table public.tukang_borongan enable row level security;

create policy authenticated_all_tukang_borongan on public.tukang_borongan
  for all
  to authenticated
  using (true)
  with check (true);

-- ── bayar_tukang ────────────────────────────────────────────────────────
drop policy if exists anon_delete_bayar_tukang on public.bayar_tukang;
drop policy if exists anon_insert_bayar_tukang on public.bayar_tukang;
drop policy if exists anon_read_bayar_tukang   on public.bayar_tukang;
drop policy if exists anon_update_bayar_tukang on public.bayar_tukang;

alter table public.bayar_tukang enable row level security;

create policy authenticated_all_bayar_tukang on public.bayar_tukang
  for all
  to authenticated
  using (true)
  with check (true);

-- ── pengajuan ───────────────────────────────────────────────────────────
drop policy if exists anon_all_pengajuan on public.pengajuan;

alter table public.pengajuan enable row level security;

create policy authenticated_all_pengajuan on public.pengajuan
  for all
  to authenticated
  using (true)
  with check (true);
-- Service-role callers (Edge Functions such as sync-inbound) bypass RLS
-- automatically and are unaffected by this policy.

-- ── users_proyek ────────────────────────────────────────────────────────
-- NOTE: users_proyek is used as a pre-login role/scope lookup by
-- login.html, index.html, admin-proyek.html, pengeluaran.html and
-- verifikasi.html — all called with the anon key BEFORE any
-- "authenticated" bearer token would be attached. Locking this one down
-- to `authenticated` only would break login/role-routing entirely.
-- Left as anon-readable (existing behavior) but writes are restricted:
-- inserts should only happen via the admin-create-user flow, which now
-- also requires the caller to already be an admin (see the
-- admin-create-user Edge Function fix).
drop policy if exists "Allow read users_proyek" on public.users_proyek;
drop policy if exists anon_read_users_proyek     on public.users_proyek;

alter table public.users_proyek enable row level security;

create policy anon_read_users_proyek on public.users_proyek
  for select
  to anon, authenticated
  using (true);

create policy authenticated_write_users_proyek on public.users_proyek
  for all
  to authenticated
  using (true)
  with check (true);

commit;
