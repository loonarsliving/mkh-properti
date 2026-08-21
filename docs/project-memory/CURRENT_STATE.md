# CURRENT_STATE

_As of audit date: 2026-08-21, repo HEAD `a47daa8` on `main`._

## Last known completed work
A cluster of security fixes and feature additions landed 2026-08-18 through 2026-08-21:
- `349bce5` — Fixed a stored XSS vulnerability (escape DB/user-controlled text before `innerHTML`).
- `69a2822` — Fixed broken access control by gating the CFO dashboard behind the new `cfo_users` allowlist.
- `c4f64a7` — Fixed the `admin-create-user` Edge Function to require the caller be a `cfo_users` member (previously any authenticated user could mint new admin accounts).
- `c81ff34` — Added an RLS-tightening migration for financial tables (**written but not applied to production** — see below).
- `9260fc6`, `ab0f1b6`, `a47daa8` — Extended the WhatsApp-nota-photo-to-expense sync path (itemization, source labeling).

## Current active work
The most recent 3 commits (`9260fc6`, `ab0f1b6`, `a47daa8`) are all incremental refinements to the same feature: the `material_expense_receipt_submitted` inbound sync event from MK Connect's AI-read WhatsApp receipt photos. This appears to be the most recently active feature area.

## Unfinished / explicitly flagged work
- **Migration `0025` (RLS tightening on financial tables) is written but NOT applied to production**, per its own header comment and the commit message "(not applied live)". Applying it requires a corresponding frontend change (use the user's session token instead of the anon key on financial-table calls) that, per the migration's own comment, had **not yet been made** as of this migration's authoring. **This is a known, real gap between the repo and the live security posture — do not assume production RLS matches what's in the migration file.**
- **`loonars_fee_wa_decision`** (commit `dfd09ce`) is explicitly described in its own commit message as a **"temporary WhatsApp-reply fee approval"** mechanism — treat this as interim, not a finished design.
- `mkh_projects`, `jurnal`, `pengajuan`, and other core tables have no `create table` migration in this repo — their current live schema state (columns, constraints) cannot be fully verified from this repo alone. See DATABASE.md.

## Known bugs
None currently open/tracked in-repo (no issue tracker content available to this audit). Historical bugs were fixed via dedicated commits (see DEVELOPMENT_WORKFLOW.md and CHANGELOG.md) — e.g., a prior regression where a construction-sync change accidentally dropped `loonars_*` sync_inbound branches (fixed in `268d5d0`).

## Technical debt
- No automated tests, no CI/CD, no linting/typechecking — all verification is manual.
- Duplicated JS logic (Supabase fetch helpers, auth guards) copy-pasted across every `.html` page rather than shared via a module — any future bugfix to this logic must be applied to each page individually.
- Core business tables lack in-repo migration history (schema drift risk — the only way to know the true live schema is to query the live Supabase project directly).
- Config comment in `supabase/config.toml` itself flags the no-local-dev-workflow situation as a known characteristic, not accidental — but it does mean there's no fast local iteration loop for schema/RPC changes; every migration test happens against the live-linked project unless a Supabase branch is manually created.

## Blocked work
None explicitly recorded. The RLS migration (`0025`) is the closest thing to "blocked" — blocked on a frontend change that (per this repo's contents) has not yet been made.

## Important warnings for anyone working on this repo
1. **Do not apply migration `0025` without first updating the frontend to send user session tokens instead of the anon key on financial-table calls** — its own header comment states this will break the app for every user otherwise.
2. **`cfo_users` starts empty when the migration was first applied** — if the live table is ever still empty, nobody (including the real owner) can access `index.html`; this must be populated manually, not via a migration.
3. Treat every `sync_inbound` change as **production-critical and shared infrastructure** — it's the single choke point for MK Connect, loonars-sales, and now WhatsApp-receipt events; a bad edit here has broken multiple downstream flows before (see `268d5d0`).

## Production status
UNKNOWN — NEEDS CONFIRMATION. No direct evidence in this repo confirms whether the site is currently live, at what URL, or whether the latest commits have actually been deployed. See DEPLOYMENT.md.

## Mobile status
NOT IMPLEMENTED — no mobile app exists. See MOBILE_BUILD.md.

## Database status
Live schema/RLS state cannot be fully confirmed from this repo alone (see DATABASE.md and the RLS warning above). Migration files up to `0029` are present in the repo; whether all of them (especially `0025`) have actually been pushed to the live Supabase project is UNKNOWN — NEEDS CONFIRMATION directly against the Supabase project.
