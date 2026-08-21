# FEATURES

Tags: DONE (working code path exists and appears complete) / PARTIAL (exists but incomplete or with known caveats) / IN_PROGRESS / PLANNED / UNKNOWN.

## Authentication
- **Login/Signup/Password recovery (Supabase Auth)** — DONE. `login.html` calls `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`.
- **CFO/owner allowlist gate** — DONE. `cfo_users` table + `index.html` authGuard (migration `0026`, commit `69a2822`).
- **Project-scoped admin access** — DONE. `users_proyek` lookup in `admin-proyek.html`/`login.html`.
- **Separate loonars-sales login (`loonars_login` RPC)** — exists in migrations (`0010_loonars_auth_hardening.sql`) but belongs to the *external* loonars-sales app, not this repo's UI. UNKNOWN whether any page in this repo calls it.

## Expense submission & approval
- **Admin expense input (`pengeluaran.html`)** — DONE. Inserts into `pengajuan`.
- **No-login field-staff expense reporting (`lapor-pengeluaran.html`, `lapor-biaya-lain.html`, `lapor-biaya-lain-makassar.html`)** — DONE, restricted to named individuals/branch per commit `9d7e75f` ("Restrict pengawas expense form to Loonars Living only"), `f6e6895` ("Lock Syafiq's Makassar report link to his name only"), `00903f7` ("Lock Jogja report links to Rebecca and Endy respectively").
- **Auto-formatted currency input (Rp x.xxx.xxx)** — DONE, commit `603c9a8`.
- **Approval/verification queue (`verifikasi.html`)** — DONE, role-gated (manager/verifikator/owner).
- **WhatsApp notification to Kepala Cabang on submission** — PARTIAL from this repo's perspective: the trigger/event exists (`trg_pengajuan_expense_submitted_sync`), but actual WhatsApp delivery happens in the external MK Connect system, not in this repo. Commit `3cee636` ("Notify Kepala Cabang on submission, before manager approval") and `0fd8ada` ("Remove Telegram from the bahan/tukang expense approval flow") confirm WhatsApp replaced an earlier Telegram-based flow.
- **Transfer-proof-confirms-jurnal flow (tukang/bahan)** — DONE per migration `0018` and commit `044faa3` ("Jurnal for gaji tukang/pembelian bahan now posts on transfer confirmation").
- **WhatsApp nota-photo → AI-read → expense submission (material_expense_receipt_submitted)** — PARTIAL/DONE-on-this-side-only: the inbound handler exists in `sync-inbound` (migrations `0027`–`0029`), itemized (`0028`) with a source label reflecting real origin (`0029`, latest commit). The photo-reading AI itself lives in MK Connect (external, not in this repo) — see AI_AND_AGENTS.md.

## Cross-system sync (MK Connect integration)
- **Outbound sync (this app → MK Connect)**: expense-approval alerts, branch cash balance sync, loonars fee/closing sync — DONE, multiple migrations (`0006`, `0009`–`0016`, `0019`–`0021`) and commits (`45c4fa6`, `b76cc08`).
- **Inbound sync (MK Connect → this app)**: `crm_payment_approved`, `sales_commission_approved`, `payroll_salary_generated`, `bonus_approved`, `reimbursement_approved`, `hr_expense_approved`, `payroll_run_approved`, `material_expense_receipt_submitted` — DONE, implemented in `supabase/functions/sync-inbound/index.ts` and the `sync_inbound` SQL function, with idempotency-key deduplication.
- **loonars-sales fee/closing verification flow** — DONE per migrations `0009`–`0016`, commit `b50250a` ("remove hardcoded service_role key" — notable security fix), `03a4964`, `b36eb0e` ("Move loonars fee-claim approval fully to CFO, drop owner step"), `dfd09ce` ("Add loonars_fee_wa_decision: temporary WhatsApp-reply fee approval" — explicitly called *temporary* in its own commit message, so flag as PARTIAL/interim).

## Dashboards / reporting
- **CFO dashboard (`index.html`)** — DONE: cash, journal (jurnal), assets (aset), bank debt (utang_bank), user management.
- **Branch-based Finance Dashboard with drill-down** — DONE, commit `cea592e`/`3555b91` ("Redesign Finance Dashboard: branch-based view with drill-down").
- **`laporan-keuangan.html` financial report page** — DONE (exists, 754 lines, wired to jurnal/branch data). Full feature completeness of every report view UNKNOWN — NEEDS CONFIRMATION without deeper line-by-line review.
- **Dashboard stat-card color tinting** — DONE, cosmetic, commit `6260ade`.

## Admin/User management
- **Create admin user via Edge Function (cfo_users-gated)** — DONE, `admin-create-user` Edge Function + fix commit `c4f64a7` (previously any authenticated user could call it).

## Project/branch onboarding
- **Green Cibarusah Residence (GCR) onboarded under Jabodetabek branch** — DONE, commits `125c333`/`4f9f242`.
- **Syafiq's Makassar operational report link, routed to Vando for approval** — DONE, commits `84ae680`/`aa88267`/`f6e6895`.

## Security hardening (recent, 2026-08-20/21)
- **Stored XSS fix (escape DB/user-controlled text before innerHTML)** — DONE, commit `349bce5`.
- **RLS tightening migration for financial tables** — written but explicitly **NOT applied to production** per its own header comment and commit `c81ff34`'s message ("not applied live"). Status: PARTIAL / PLANNED — migration exists in repo, live database state UNKNOWN — NEEDS CONFIRMATION (requires checking the actual Supabase project, not just the repo).
- **CFO dashboard access-control fix** — DONE, commit `69a2822`.
- **admin-create-user privilege-escalation fix** — DONE, commit `c4f64a7`.

## Not found in this repo (do not assume they exist)
- No automated test suite of any kind (no test files, no test runner config).
- No CI/CD pipeline (no `.github/workflows`).
- No mobile app / Capacitor config — see MOBILE_BUILD.md.
- No `vercel.json` — see DEPLOYMENT.md for what can and cannot be confirmed about hosting.
- No AI/LLM code — see AI_AND_AGENTS.md.
