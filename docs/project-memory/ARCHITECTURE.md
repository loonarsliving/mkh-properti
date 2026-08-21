# ARCHITECTURE

## High-level shape
A **static, framework-free multi-page HTML application** (no `package.json`, no bundler, no SPA router) that talks **directly to Supabase** from the browser via `fetch()` calls to the PostgREST REST API and the Supabase Auth API, plus two custom Supabase **Edge Functions** for privileged server-side operations. There is no separate backend server/API layer beyond Supabase itself.

Evidence: repo root contains only `.html` files, `.png` images, and a `supabase/` directory — no `src/`, no `node_modules` reference besides `.gitignore`, no server framework files.

## Frontend
- 10 standalone HTML pages, each with inline `<script>`/`<style>` (no shared JS module files, no component framework):
  - `index.html` — CFO/owner dashboard (cash, journal, assets, debts, user management).
  - `admin-proyek.html` — per-project admin dashboard.
  - `login.html` — Supabase Auth login/signup/password-recovery.
  - `pengeluaran.html` — logged-in expense input.
  - `lapor-pengeluaran.html`, `lapor-biaya-lain.html`, `lapor-biaya-lain-makassar.html` — no-login public expense-report forms for named field staff (Endy, Rebecca, Syafiq/Makassar variant).
  - `verifikasi.html` — approval/verification queue for `pengajuan`.
  - `laporan-keuangan.html` — financial reports.
  - `no-access.html` — access-denied landing page (added alongside the `cfo_users` allowlist fix).
- Each page hardcodes `SB_URL` (`https://gluoioiimapyhchdasfl.supabase.co`) and the Supabase **anon** publishable key, then builds REST calls with `apikey`/`Authorization: Bearer <anon key>` headers via small helper functions (`sbGet`, `sbInsert`, `sbUpdate`, `sbDelete` in `index.html`).
- Session/role state is kept in browser storage (e.g. `sessionStorage "sb_access_token"`, per migration `0025`'s comments) and re-checked against `users_proyek` / `cfo_users` on each protected page load ("authGuard" pattern in `index.html`/`admin-proyek.html`/`verifikasi.html`).

## Backend
There is no custom backend server. "Backend" logic lives in two places:
1. **Supabase Postgres** — SQL functions/triggers implementing business logic (see DATABASE.md), invoked either directly via PostgREST RPC (e.g. `next_mkh_no`, `get_sync_secret`) or fired by table triggers on INSERT/UPDATE.
2. **Supabase Edge Functions** (Deno, TypeScript) — for the two operations that must not run with client-exposed credentials:
   - `supabase/functions/admin-create-user/index.ts` — creates new Supabase Auth users; requires the caller to be in `cfo_users`; uses the service_role key server-side.
   - `supabase/functions/sync-inbound/index.ts` — receives inbound events from the external "MK Connect" system, authenticated by a shared secret (`X-Sync-Secret` header, verified via `get_sync_secret()` RPC pulling from Supabase Vault) plus idempotency keys; writes to `sync_log`, `jurnal`, `pengajuan`, `crm_payment_receipts`.

## Database
Supabase Postgres (project ref `gluoioiimapyhchdasfl`, per `supabase/config.toml` comment and hardcoded frontend URL). See DATABASE.md for full table/RPC/trigger inventory. Only a subset of tables are defined by migrations in this repo (`sync_log`, `sync_config`, `cfo_users`, `crm_payment_receipts`); core business tables (`jurnal`, `pengajuan`, `aset`, `utang_bank`, `tukang_borongan`, `bayar_tukang`, `users_proyek`, `mkh_projects`, `loonars_fee`) are referenced extensively by the frontend and by migrations (`alter table`, RPCs referencing them) but their `create table` statements are **not present in this repo's migration history** — they predate migration `0001` or were created outside the migration system. UNKNOWN — NEEDS CONFIRMATION whether a schema dump/other source of truth exists outside this repo.

## Auth
- **Supabase Auth** (email/password) via direct `fetch` calls to `${SB_URL}/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/user` (see `login.html`).
- No SSR/session cookies — token(s) held client-side (sessionStorage), re-validated per page.
- A second, separate credential system exists in the database for the "loonars" sibling app: RPCs `loonars_login` and `loonars_users_hash_password` (migration `0010_loonars_auth_hardening.sql`) — this is for the **loonars-sales** external app sharing this Supabase project, not this app's own users.

## Authorization (authz)
- **`users_proyek`** table maps a user email to a `proyek_id` (project) — used to scope project-admin access (`admin-proyek.html`).
- **`cfo_users`** table (migration `0026`) is a hard allowlist gating the full company-wide `index.html` CFO dashboard — added specifically to fix a broken-access-control bug (commit `69a2822`, "Fix broken access control: gate CFO dashboard behind cfo_users allowlist") where any self-registered account previously got full access.
- Role checks (manager/verifikator/owner) are performed **client-side** in `verifikasi.html` before rendering data — see DATABASE.md/CURRENT_STATE.md for the RLS caveat: as of migration `0025`'s own comments, the app was, at time of that migration being written, still sending the **anon** key (not the user's session token) for these table calls, meaning true enforcement depended on RLS policies rather than the client-side checks alone. Migration `0025` (RLS tightening) was written explicitly "not applied live" per commit `c81ff34`'s message — see DATABASE.md.

## API
No custom REST/GraphQL API layer — the "API" is Supabase's auto-generated PostgREST REST interface (`/rest/v1/<table>`) called directly from the browser, plus the two Edge Functions listed above (`/functions/v1/admin-create-user`, `/functions/v1/sync-inbound`).

## Repositories / Services pattern
No repository/service/DTO layering exists in code — each HTML page's inline JS calls PostgREST directly via the small `sbGet/sbInsert/sbUpdate/sbDelete` fetch wrappers. This is a **direct-to-database frontend** pattern, not a layered application architecture. Do not assume a repository or service abstraction exists anywhere in this codebase.

## Workers / background jobs
- `public.sync_dispatch_pending()` and `public.sync_collect_responses()` (migration `0001_sync_foundation.sql`) are SQL functions intended to run on a schedule (comment in `0009` says "sync_dispatch_pending() cron already scheduled every minute") — this implies a **pg_cron** job or external scheduler calling these RPCs periodically. The actual cron/schedule configuration is **not present in this repo** (no `pg_cron` migration statement found) — UNKNOWN — NEEDS CONFIRMATION where/how the schedule is configured (likely set directly in the Supabase dashboard, outside version control).

## AI integration
No AI/LLM code exists in this repository. Migration `0027`'s comment states MK Connect (the external CRM system) uses AI to read WhatsApp receipt photos and forwards the extracted data via the `sync-inbound` Edge Function — the AI itself is **not part of this repo**. See AI_AND_AGENTS.md.

## Data flow (expense approval, as reconstructed from code + migrations)
1. Expense entered — either by a logged-in admin (`pengeluaran.html`), a no-login field-staff form (`lapor-pengeluaran.html`/`lapor-biaya-lain*.html`), or inbound from MK Connect (WA receipt photo read by MK Connect's AI → `sync-inbound` → `material_expense_receipt_submitted` event) → inserted into `pengajuan` (status `pending`).
2. A trigger (`trg_pengajuan_expense_submitted_sync`, migration `0006`/`0008`) notifies the branch's Kepala Cabang via WhatsApp (through the sync/MK Connect pipeline — actual WhatsApp sending happens outside this repo).
3. Kepala Cabang / manager / verifikator reviews in `verifikasi.html` and approves/rejects.
4. On approval, depending on type: some post directly to `jurnal` (e.g. income); others (bahan/tukang) wait for Super Admin to transfer funds and send a WhatsApp transfer-proof photo, which — per migration `0018_transfer_proof_confirms_jurnal.sql` and commit `044faa3` — is what actually books the `jurnal` entry.
5. `trg_jurnal_branch_balance_sync` (migration `0006`) keeps branch cash balances in sync as `jurnal` rows are written.

## Special architecture patterns
No "FRIDAY", "Holding", or similarly named special architecture pattern was found anywhere in code, migrations, comments, or commit history. Do not document one.
