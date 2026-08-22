# DEVELOPMENT_WORKFLOW

> **DIPERBARUI 2026-08-22.** Bagian "How dev starts", "How builds are done", dan
> "Coding patterns observed" di bawah menggambarkan era HTML statis dan sudah
> tidak berlaku untuk frontend. Yang berlaku sekarang:
>
> ```bash
> npm install
> npm run dev        # http://localhost:3000
> npm run build      # wajib lolos sebelum push
> npm run lint       # ESLint (eslint-config-next)
> npm run typecheck  # tsc --noEmit
> ```
>
> Belum ada test suite maupun CI, jadi `build` + `lint` + `typecheck` adalah
> satu-satunya gerbang otomatis yang ada — jalankan ketiganya sebelum push.
>
> Pola kode frontend yang berlaku sekarang:
> - Bahasa Indonesia untuk nama fungsi/variabel domain dan komentar, mengikuti
>   kebiasaan repo ini.
> - Jangan duplikasi helper. Panggilan Supabase lewat `src/lib/supabase.ts`,
>   COA lewat `src/lib/master.ts`, format angka lewat `src/lib/format.ts`.
> - **Jangan pernah** menyusun HTML sebagai string lalu memasukkannya ke DOM.
>   Untuk halaman cetak, render komponen React dengan `hidden print:block`.
> - Aturan akuntansi tinggal di `src/lib/akuntansi/` dan `src/lib/transaksi.ts`,
>   bukan di dalam komponen.
> - Kode akun COA adalah nilai yang tersimpan di database — **tidak boleh
>   diubah**, hanya labelnya yang boleh.
>
> Bagian tentang migrasi SQL, Edge Function, dan konvensi commit di bawah
> **masih berlaku sepenuhnya**.


Reconstructed from git history (55 commits) and repo structure. No CONTRIBUTING.md, README, or written process doc exists — this is inferred, not asserted, from actual commits.

## How dev starts
There is no dev server, build step, or install command — the app is plain static HTML. Evidence: no `package.json`, no `npm`/`yarn`/`pnpm` lockfile, no `vite.config`/`webpack.config`/similar. Opening the `.html` files directly (or serving the directory statically) is presumably how local development happens. UNKNOWN — NEEDS CONFIRMATION whether any local Supabase stack (`supabase start`) is used given `supabase/config.toml` exists — its own header comment says: *"MKH Property has no local Supabase dev workflow (it is a set of static HTML pages talking directly to PostgREST...). This config exists only so `supabase link`... and `supabase db push`/`supabase functions deploy` work..."* — i.e., the config exists purely to support pushing migrations/functions to the **live** project, not for local development.

## How features are built
- Early history (2026-06-11 through 2026-06-20): repeated "Add files via upload" commits — consistent with development directly through the GitHub web UI file-upload flow, not a local git workflow, in the project's earliest phase.
- From 2026-07-12 onward, commits become descriptive and feature-scoped (e.g. "Add MK Connect sync integration: CRM payments, payroll, commission, HR expenses"), several referencing PR numbers (`(#1)`, `(#2)`, `(#5)`–`(#9)`, `(#11)`) — indicating a PR-based workflow took over from that point.
- Many commits explicitly reference and fix regressions from prior commits (e.g. `268d5d0` "Restore loonars_* sync_inbound branches dropped by construction sync change (#11)") — the team actively monitors for regressions across the shared `sync_inbound` function as it's repeatedly extended.

## Coding patterns observed
- Each new capability in `sync_inbound` is added via `CREATE OR REPLACE FUNCTION` with the **full function body restated** each migration (commented explicitly in `0027`: "Every other branch of sync_inbound is unchanged (CREATE OR REPLACE needs the full body)") — i.e., the whole router function is copy-forward-edited each time, not incrementally patched. Follow this same pattern for any future change to `sync_inbound`.
- Extensive in-line comments explaining *why*, especially for security fixes and migrations that must not be blindly applied (see `0025`, `0026`, `admin-create-user`).
- Frontend: no shared JS file — patterns (like `sbGet/sbInsert/sbUpdate/sbDelete` helpers) are duplicated/redefined per page rather than imported from a common module.

## How DB changes / migrations are made
- Sequential numbered SQL files in `supabase/migrations/`, named `NNNN_description.sql`, applied via `supabase db push` (per `config.toml` comment) against the linked live project (`gluoioiimapyhchdasfl`).
- Some migrations are written but **deliberately not applied immediately** pending a client-code change or manual data entry (see `0025`, `0026` — both require follow-up steps before/after applying). This confirms migrations in this repo are not guaranteed to reflect the live database's current state — always confirm live state via Supabase tooling before assuming a migration took effect.

## How testing is done
No automated tests exist (no test files, no test framework config). UNKNOWN — NEEDS CONFIRMATION whether manual testing happens against a Supabase branch/staging project; `supabase/config.toml`'s existence (enabling `supabase link`) suggests migrations *could* be tested via Supabase branching, but no evidence in-repo confirms this is actually done.

## How builds are done
No build step exists or is needed — static HTML is deployed as-is.

## How bugs are fixed
Recent history shows a clear pattern: security/access-control bugs are fixed with a dedicated commit that (1) explains the vulnerability in a comment, (2) fixes it, and (3) is typically a single, focused commit (e.g. `349bce5` XSS fix, `69a2822` access-control fix, `c4f64a7` Edge Function auth fix). Regressions are fixed by dedicated restore commits (`268d5d0`).

## Commit conventions
- No enforced conventional-commits format (no `feat:`/`fix:` prefixes used consistently).
- Commit messages are descriptive English sentences, often referencing a PR number in parentheses, e.g. `Add MK Connect sync integration (#1)`.
- Some duplicate-looking consecutive commits (e.g. `b5f4e0f` then `9d7d3dd` same day, same topic) suggest a squash-merge or rebase pattern around PRs — treat commit pairs like this as one logical change.

## Branch usage
- `main` is the primary/default branch (confirmed via `git remote show origin`).
- Many long-lived feature branches exist on the remote (`Mkh`, and numerous `claude/...` branches) — see GIT_WORKFLOW.md for the full list and naming convention.
- A `Mkh` branch (capitalized, no `claude/` prefix) also exists — likely an older or manually-created branch; UNKNOWN — NEEDS CONFIRMATION of its purpose/status.

## How deployment happens
No CI/CD config exists in-repo (no `.github/workflows`). Combined with `.gitignore`'s `.vercel`/`.env.production` entries, the most consistent explanation is a **Vercel Git integration** (auto-deploy on push to `main`, configured in the Vercel dashboard rather than in-repo) — see DEPLOYMENT.md. This is an inference, not a confirmed fact from this repo alone.

## How production is verified
No in-repo evidence of a post-deploy verification step (no smoke-test script, no monitoring config). See DEPLOYMENT.md's checklist for a recommended, conservative process given the lack of automation.

## Sprint-like patterns
No sprint/iteration structure evident (no `ROADMAP.md`, no issue templates, no milestone references in commit messages). Do not invent one.
