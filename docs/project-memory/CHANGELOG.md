# CHANGELOG

Built directly from `git log` on `main` (55 commits, oldest first). No entries are fabricated — this mirrors actual commit history. Earliest commits (bulk file uploads, no granular history) are summarized as a block; later commits are listed individually as they became feature-scoped.

## 2026-06-11 to 2026-06-20 — Initial upload phase
Six "Add files via upload" commits (`2c222fd`, `1f487a9`, `e55ca2d`, `f77d6fd`, `aac5d5d`, `cbc8089`, `8ae6a01`, `aa1e759`, `d43bbf6`, `2d3a67c`, `7f937d3`, `3615147`) — initial and early-iteration versions of the app uploaded via GitHub's web UI, no individual change descriptions available.

## 2026-07-12
- `b5f4e0f` / `9d7d3dd` (#1) — Add MK Connect sync integration: CRM payments, payroll, commission, HR expenses.
- `cea592e` / `3555b91` (#2) — Redesign Finance Dashboard: branch-based view with drill-down.
- `e5f1935` / `7c44d3e` — Extract `department_name` from inbound HR sync payloads.
- `125c333` / `4f9f242` — Onboard Green Cibarusah Residence (GCR) as a project under the Jabodetabek branch.

## 2026-07-16
- `45c4fa6` — Sync expense-approval WhatsApp alerts and branch cash balance to MK Connect.
- `b76cc08` — Include item/supplier in the expense-approval sync payload.

## 2026-07-18
- `3cee636` — Notify Kepala Cabang on submission, before manager approval.
- `0fd8ada` — Remove Telegram from the bahan/tukang expense approval flow (replaced by WhatsApp).

## 2026-07-23
- `eff86d4` — Add simple expense input page (`pengeluaran.html`).
- `d249bcb` — Add no-login expense report page for field supervisors (pengawas).
- `9d7e75f` — Restrict pengawas expense form to Loonars Living only.

## 2026-07-25 to 2026-07-28
- `b50250a` (#5) — Sync loonars-sales fee/closing into `pengajuan` + target, **remove hardcoded service_role key** (security fix).
- `bf7460c` — Add loonars-sales closing verification flow (outbound + inbound).
- `03a4964` (#6) — Fix loonars closing cash-in to book actual amount received, not full price.
- `b36eb0e` (#7) — Move loonars fee-claim approval fully to CFO, drop owner step.
- `dfd09ce` (#8) — Add `loonars_fee_wa_decision`: temporary WhatsApp-reply fee approval.

## 2026-08-01
- `51dae9b` (#9) — Restrict branch verifikators to bahan/tukang, not komisi/HR sync types.
- `071a52a` — Tambah halaman lapor biaya lain-lain (Loonars Living).

## 2026-08-04
- `9261860` — security: add `.gitignore`.

## 2026-08-07
- `268d5d0` (#11) — Restore `loonars_*` sync_inbound branches dropped by a construction sync change (regression fix).

## 2026-08-16
- `a87005e` — Forward tukang contract balance in `finance_expense_submitted` sync payload.
- `044faa3` — Jurnal for gaji tukang/pembelian bahan now posts on transfer confirmation.
- `15f6727` — Add `tukang_borongan_sisa_upsert` sync_inbound branch.
- `8cb22c4` — Post jurnal entry for HQ→project fund transfers.
- `a39106d` — Use mkhsistem-supplied account codes for construction expense sync.

## 2026-08-18
- `6260ade` — Beri warna tint pada kartu statistik dashboard agar tidak monoton (cosmetic).
- `0d89e30` — Merge branch `claude/sistem-properti-warna-ml1gns` into main.
- `84ae680` — Add Syafiq's Makassar operational-report link, route approval to Vando.
- `aa88267` — Broaden Syafiq-name match for Vando-approval routing.

## 2026-08-19
- `603c9a8` — Format input nilai item jadi Rp x.xxx.xxx otomatis di form pengawas.
- `f6e6895` — Lock Syafiq's Makassar report link to his name only.
- `00903f7` — Lock Jogja report links to Rebecca and Endy respectively.

## 2026-08-20 — Security hardening pass
- `349bce5` — Fix stored XSS: escape DB/user-controlled text before `innerHTML`.
- `69a2822` — Fix broken access control: gate CFO dashboard behind `cfo_users` allowlist.
- `c4f64a7` — Fix `admin-create-user` Edge Function: require caller to be in `cfo_users`.
- `c81ff34` — Add RLS-tightening migration for financial tables (not applied live).

## 2026-08-21
- `9260fc6` — Add `material_expense_receipt_submitted` sync event for WA nota-photo submissions.
- `ab0f1b6` — Itemize `material_expense_receipt_submitted` instead of one combined line.
- `a47daa8` (HEAD at audit time) — Let `material_expense_receipt_submitted`'s sumber label reflect real origin.

---
_This changelog reflects `main` as of commit `a47daa8`. It should be updated (append-only, newest at bottom or top consistently) whenever significant work lands, per the MEMORY UPDATE RULE in `/CLAUDE.md`._
