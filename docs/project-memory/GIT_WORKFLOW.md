# GIT_WORKFLOW

## Default branch
`main` (confirmed via `git remote show origin` → "HEAD branch: main").

## Production branch
`main` — no separate production branch found (no `prod`, `production`, `release`, etc. branch on the remote). UNKNOWN — NEEDS CONFIRMATION whether the hosting provider is actually configured to deploy from `main` specifically (see DEPLOYMENT.md).

## Development branch
No dedicated long-lived `develop`/`dev` branch exists. Work happens on short-lived feature branches merged into `main` (evidenced by PR-referencing commit messages like `(#1)`, `(#2)`, `(#5)`–`(#11)`).

## Feature branch conventions
Remote branches observed at audit time (besides `main`):
- `Mkh` — capitalized, no prefix; purpose/status UNKNOWN — NEEDS CONFIRMATION.
- `claude/expense-input-page-s174lg`
- `claude/fasly-kendari-branch-setup-gcpy4x`
- `claude/halaman-input-biaya-lain-6yjzpa`
- `claude/loonars-dashboard-siteplan-buvysk`
- `claude/loonars-fee-schema-jpi0eb`
- `claude/management-property-branch-bfnkvk`
- `claude/material-price-input-format-5p18im`
- `claude/mk-connect-mkh-property-sync-59t8f2`
- `claude/mkh-properti-whatsapp-alerts-icl6kk`
- `claude/security-3-repos-tj69ek`
- `claude/security-audit-repos-4cs6h7`
- `claude/sistem-properti-warna-ml1gns`
- `claude/sistem-tampilan-kosong-prjei6`
- `claude/sso-loonars-sales-9486zn`
- `claude/system-check-telegram-removal-ta30fm`
- `claude/wa-sisa-gaji-tukang`

All Claude-generated branches follow the pattern `claude/<short-topic-slug>-<random-6-char-suffix>`. This audit's own branch, `claude/project-memory-audit-af4m1t`, follows the same convention. Several of these branches are likely already merged (their content matches commits already on `main`, e.g. `sistem-properti-warna-ml1gns` corresponds to merge commit `0d89e30`) but were not deleted after merge — treat unmerged-looking branch names with caution and check `git log main..<branch>` before assuming a branch has unmerged work.

## Commit convention
No enforced format (no conventional-commits prefixes). Descriptive English sentences; PR-derived commits carry a trailing `(#N)`. Indonesian appears in some commit messages too (e.g. `Tambah halaman lapor biaya lain-lain (Loonars Living)`, `Beri warna tint pada kartu statistik dashboard agar tidak monoton`), matching the Indonesian-language UI/comments throughout the code.

## Merge / PR process
Multiple commits reference PR numbers, and at least one explicit merge commit exists (`0d89e30 Merge branch 'claude/sistem-properti-warna-ml1gns' into main`) — confirming PRs are used and merged into `main`, at least for some changes. Not every commit shows PR evidence, so a mixed direct-push/PR workflow cannot be ruled out. UNKNOWN — NEEDS CONFIRMATION whether branch protection / required review is enabled on `main` (not visible from git history alone).

## When push happens
No fixed cadence evident — commits are irregular (some days have many commits, e.g. 2026-08-16 through 2026-08-21 show near-daily activity; other periods show gaps).

## When production deploy happens
Not automated via any workflow file in this repo. See DEPLOYMENT.md — inferred to happen on push/merge to `main` if a Vercel Git integration is configured, but this is unconfirmed from repo contents alone. Supabase migrations/Edge Function deploys require a separate, manual `supabase` CLI step regardless (not triggered by git push at all).

## Branch state at time of this audit
This audit's branch (`claude/project-memory-audit-af4m1t`) was created fresh from `main` at commit `a47daa8` (2026-08-21, "Let material_expense_receipt_submitted's sumber label reflect real origin"). **No branches were deleted, force-pushed, or altered by this audit** — only new files were added under `/docs/project-memory/` and `/CLAUDE.md`, on this dedicated branch.
