# INTEGRATIONS

No secrets, keys, or credential values are recorded in this document — names/purposes/locations only.

## Supabase (core platform)
- **Purpose**: Auth, Postgres database, PostgREST API, Edge Functions — the entire backend of this app.
- **Location in code**: `SB_URL`/`SB_KEY` constants hardcoded in every `.html` page; `supabase/functions/*`; `supabase/migrations/*`; `supabase/config.toml`.
- **Data IN**: all app reads (jurnal, pengajuan, aset, utang_bank, users_proyek, cfo_users, etc.) via PostgREST GET.
- **Data OUT**: all app writes via PostgREST POST/PATCH/DELETE and Edge Function calls.
- **Authentication method**: Supabase Auth (email/password) for users; anon publishable key for most client REST calls (see DATABASE.md RLS caveat); service_role key only inside Edge Functions (server-side, via `Deno.env.get`).
- **Status**: DONE / actively used, this is the entire platform.
- **Dependencies**: none upstream; everything else depends on this.

## MK Connect (external CRM/HR/Ops system)
- **Purpose**: Sibling system (separate repo, not in this codebase) handling CRM, HR, payroll, and WhatsApp messaging/AI receipt-reading. Sends events into this app and (per code comments) sends WhatsApp notifications on this app's behalf.
- **Location in code**: `supabase/functions/sync-inbound/index.ts` (receiving end); outbound triggers/RPCs in migrations `0006`–`0021` that write to `sync_log` for MK Connect to pick up via `sync_dispatch_pending()`.
- **Data IN (to this app)**: `crm_payment_approved`, `sales_commission_approved`, `payroll_salary_generated`, `bonus_approved`, `reimbursement_approved`, `hr_expense_approved`, `payroll_run_approved`, `material_expense_receipt_submitted` event payloads (JSON).
- **Data OUT (from this app)**: expense-approval alerts, branch cash balance updates, loonars fee/closing events, material expense sync events — written to `sync_log` for MK Connect's dispatcher to consume (exact dispatch mechanism/transport is external to this repo — likely pg_net per the Edge Function's own comment "server-to-server call from another Supabase project's Postgres trigger via pg_net").
- **Authentication method**: Shared secret (`X-Sync-Secret` header) validated against `get_sync_secret()` (Supabase Vault) with constant-time comparison; idempotency keys prevent duplicate processing.
- **Status**: DONE, actively used and extended (latest 3 commits in the repo, `0027`–`0029`, all touch this integration).
- **Dependencies**: Supabase Vault (secret storage), `sync_log`/`sync_config` tables.

## loonars-sales / "PT. Loonars Living" (external villa-siteplan app)
- **Purpose**: Sibling sales app for a specific project brand ("Loonars Living"), sharing this Supabase project. Writes cash-in journal entries directly and manages marketing fee/commission claims and unit-closing declarations.
- **Location in code**: migrations `0009`–`0016`, `0019`–`0021`, `0023` (Syafiq/Makassar routing); `loonars_fee`, `loonars_users` tables referenced/altered.
- **Data IN (to this app)**: fee-submission and closing-declared events (via sync pipeline), which create `pengajuan` rows for CFO approval.
- **Data OUT (from this app)**: approval decisions synced back (`loonars_fee_approved_sync`), some via a described-as-**temporary** WhatsApp-reply decision mechanism (`loonars_fee_wa_decision`, commit `dfd09ce`).
- **Authentication method**: Shares the same Supabase project/database; has its own separate login RPC (`loonars_login`) unrelated to this app's Supabase Auth users.
- **Status**: DONE / actively used, though the WA-reply approval path is explicitly marked temporary in its own commit message — treat as PARTIAL for that specific sub-flow.
- **Dependencies**: same Supabase project as this app; `sync_log`/`sync_dispatch_pending()`.

## mkhsistem (external system, referenced once)
- **Purpose**: UNKNOWN — NEEDS CONFIRMATION. Only evidence is commit `a39106d` ("Use mkhsistem-supplied account codes for construction expense sync"), implying it supplies chart-of-accounts codes for construction expense sync.
- **Location in code**: not directly named in current file contents found by search beyond that commit message context (construction sync code in migrations `0019`–`0021`).
- **Status**: UNKNOWN.

## WhatsApp
- **Purpose**: Primary notification/approval channel for Kepala Cabang and Super Admin (submission alerts, transfer-proof confirmation, receipt-photo intake).
- **Location in code**: Referenced extensively in comments and UI copy across `admin-proyek.html`, `lapor-*.html`, `pengeluaran.html`, `verifikasi.html`, and migrations `0006`–`0029`. **No WhatsApp API client/SDK code exists in this repo** — actual message sending/receiving happens in MK Connect (external).
- **Data IN/OUT**: notification text and (per `0027`) receipt photos, both handled externally.
- **Authentication method**: N/A in this repo — external system's responsibility.
- **Status**: PARTIAL from this repo's viewpoint — the trigger/event side is DONE here; the transport (actual WhatsApp API/provider) is entirely external and UNKNOWN — NEEDS CONFIRMATION (provider e.g. WhatsApp Business API/Twilio/Fonnte/etc. is not named anywhere in this repo).
- **Dependencies**: MK Connect.

## Telegram (removed)
- **Purpose**: Was previously used for bahan/tukang expense approval notifications; explicitly removed per commit `0fd8ada` ("Remove Telegram from the bahan/tukang expense approval flow"), replaced by WhatsApp.
- **Status**: REMOVED — historical only, not a current integration. Documented here only because git history shows it existed; no live Telegram code remains.

## Vercel (likely hosting — see DEPLOYMENT.md)
- **Purpose**: Inferred static-site hosting.
- **Evidence**: `.gitignore` contains `.vercel` and `.env.production` entries — the standard artifacts of a Vercel-linked project.
- **Location in code**: no `vercel.json` present, so if used it is a zero-config static deployment.
- **Status**: UNKNOWN — NEEDS CONFIRMATION (no direct proof beyond `.gitignore` entries; see DEPLOYMENT.md).

## Not found in this repo (explicitly absent)
Gemini or any other LLM API, Google Ads/Meta Ads, OTA integrations, payment gateways, dedicated email service, push-notification service. None of these appear anywhere in source, config, or migrations. Do not assume any of them exist.
