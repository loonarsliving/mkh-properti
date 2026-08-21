# PROJECT_CONTEXT

## Project name
MKH Property (repository: `mkh-properti`). Application title shown in-app: **"PT. Maha Karya Haluoleo — Sistem Keuangan"** (Finance System).

## Purpose
An internal financial-operations web app for **PT. Maha Karya Haluoleo (MKH)**, a property/construction developer with multiple projects/branches. It handles:
- General ledger / journal entries (`jurnal`)
- Expense submission and approval workflow (`pengajuan`) for materials, contractor ("tukang") payments, salaries, bonuses, reimbursements, HR expenses, sales commission
- Assets and bank debt tracking (`aset`, `utang_bank`)
- Branch/project cash balances
- User-to-project assignment and a CFO/owner allowlist for company-wide access
- Cross-system synchronization with sibling systems (see below)

Evidence: page titles in `*.html`, table names referenced via `sbGet/sbInsert` calls in `index.html`, `admin-proyek.html`, `verifikasi.html`, `pengeluaran.html`, and the `supabase/migrations/*.sql` comments.

## Users
Based on role checks found in code (`login.html`, `index.html`, `verifikasi.html`, `admin-proyek.html`):
- **CFO / Owner** — full company-wide dashboard access (`index.html`), gated by the `cfo_users` allowlist table (migration `0026_cfo_users_allowlist.sql`).
- **Project/branch admin** — scoped to their assigned project via `users_proyek` (`admin-proyek.html`).
- **Kepala Cabang (Branch Head)** — verifies expense submissions via WhatsApp notification (per code comments) and/or `verifikasi.html`.
- **Verifikator / Manager** — role-checked in `verifikasi.html` ("hanya manager/verifikator/owner yang boleh akses").
- **Super Admin** — performs fund transfers after approval (referenced throughout `verifikasi.html` comments).
- **Field staff without login** — e.g. "Endy" and "Rebecca" (named explicitly in `lapor-pengeluaran.html` / `lapor-biaya-lain.html` copy) use no-login public report forms.
- Named individuals appear directly in code/comments (e.g. "Syafiq", "Vando", "Endy", "Rebecca") — this is a small, real organization, not a generic multi-tenant SaaS.

## Main functions (evidenced in code)
1. Login / signup (`login.html`) against Supabase Auth.
2. CFO dashboard: cash, journal, assets, debts, users management (`index.html`).
3. Per-project admin dashboard (`admin-proyek.html`).
4. Expense input by admins (`pengeluaran.html`) and by non-logged-in field staff (`lapor-pengeluaran.html`, `lapor-biaya-lain.html`, `lapor-biaya-lain-makassar.html`).
5. Approval/verification queue (`verifikasi.html`) for `pengajuan` (submissions) of various types (bahan/material, tukang/contractor, gaji/salary, bonus, komisi/commission, reimbursement, hr_lain).
6. Financial reporting (`laporan-keuangan.html`).
7. Inbound sync receiver from an external system, "MK Connect" (`supabase/functions/sync-inbound`).
8. Admin user creation via a privileged Edge Function (`supabase/functions/admin-create-user`).

## Relation to other systems
The codebase and migration comments make clear this Supabase project is **shared** with, or synchronized with, several sibling applications that live in **separate repositories** (not in this repo):
- **MK Connect** — CRM/HR/Ops system; sends inbound sync events (payments, payroll, commissions, HR expenses, WhatsApp-read receipt photos) to this app's `sync-inbound` Edge Function, and is described as reading WhatsApp nota (receipt) photos with AI on its own side (see `0027_material_expense_receipt_wa_ai_submission.sql` comment).
- **loonars-sales** ("PT. Loonars Living" villa siteplan app) — writes directly to this project's `jurnal` table for cash-in on unit closings, and to a `loonars_fee` table for marketing commission; migrations `0009`–`0016` wire the commission/closing verification flow between the two apps.
- **mkhsistem** (referenced in commit `a39106d`, "Use mkhsistem-supplied account codes for construction expense sync") — another related system supplying construction expense data.

These are **external systems not present in this repository** — UNKNOWN — NEEDS CONFIRMATION for their internal implementation; only the sync contract visible from this repo's migrations/Edge Functions is documented here.

## Status
Actively developed — most recent commit at audit time is `a47daa8` (2026-08-21). Commit history shows continuous feature work and, notably, a recent (2026-08-20/21) security-hardening pass (RLS, XSS fix, access-control fix — see CURRENT_STATE.md).

## Key principles observed in the codebase
- No build tooling: plain static HTML/CSS/JS files served directly, talking to Supabase via REST (`fetch` to PostgREST endpoints) and Supabase Auth — no framework, no bundler, no `package.json`.
- Security fixes are heavily commented in-line (migrations 0025/0026, commit `349bce5` XSS fix, commit `69a2822` access-control fix, commit `c4f64a7` Edge Function fix) — the team values traceable, explained changes over silent ones.
- Migration `0025` is explicitly **not yet applied to production** per its own comment ("Do NOT apply this against production until…") — see DATABASE.md and CURRENT_STATE.md.
- Indonesian-language UI and code comments throughout (this is an Indonesian company).
