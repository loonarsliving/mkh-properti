# DEPLOYMENT

> **DIPERBARUI 2026-08-22 — BACA INI DULU.**
>
> Repo ini **tidak lagi berupa situs statis**. Sejak migrasi ke Next.js, ada
> `package.json` dan langkah build wajib. Bagian "Build command / Install
> command / Output directory" di bawah (yang menyatakan "tidak ada build")
> **sudah usang** dan digantikan bagian ini.
>
> **Setelan build sudah dikunci lewat `vercel.json` di root repo:**
>
> ```json
> { "framework": "nextjs", "installCommand": "npm install", "buildCommand": "npm run build" }
> ```
>
> Nilai di `vercel.json` **menimpa** setelan di dashboard Vercel, jadi framework
> preset proyek boleh tetap "Other" tanpa masalah. **Jangan hapus berkas ini** —
> tanpa itu Vercel kembali memperlakukan repo sebagai situs statis dan seluruh
> URL akan 404 (ini yang benar-benar terjadi pada deploy 2026-08-22 pertama).
>
> Environment variable: semuanya opsional, ada nilai bawaan (lihat
> `.env.example`). Tidak ada env yang wajib diisi agar aplikasi berjalan.
>
> **Yang TIDAK berubah:** migrasi SQL dan Edge Function tetap **tidak** ikut
> ter-deploy saat push. Keduanya masih perlu `supabase db push` /
> `supabase functions deploy` manual. Migrasi ini tidak menambah atau mengubah
> satu pun berkas migrasi.

## Verifikasi setelah deploy (khusus rilis migrasi ini)

Selain checklist umum di bawah, periksa juga:

- [ ] `/login` terbuka, dan login dengan akun asli mengarah ke halaman yang benar
      per peran (CFO → `/`, admin proyek → `/admin-proyek`, verifikator → `/verifikasi`).
- [ ] URL lama masih hidup: buka `/lapor-pengeluaran.html` dan pastikan
      dialihkan ke `/lapor-pengeluaran`. Ulangi untuk `/verifikasi.html`.
- [ ] Dashboard menampilkan angka yang **sama** dengan versi lama untuk periode
      yang sama (bandingkan total kas dan pendapatan).
- [ ] Di `/posisi-keuangan`, indikator "Neraca seimbang" berwarna hijau. Kalau
      merah, itu menandakan ada entri jurnal yang debet ≠ kredit di data asli —
      bukan bug aplikasi, tapi perlu ditelusuri.
- [ ] Kirim satu pengajuan uji dari `/pengeluaran`, pastikan muncul di
      `/verifikasi` dan notifikasi WhatsApp ke Kepala Cabang tetap terkirim
      (jalur WhatsApp lewat trigger database, tidak tersentuh migrasi ini).
- [ ] Cetak satu kwitansi dari `/admin-proyek` → tab Kas Masuk, pastikan logo
      dan terbilang tampil benar.


## Production URL
**`https://finance.haluoleo.id`** — dikonfirmasi 2026-08-22. URL ini di-hardcode
sebagai `verification_link` di lima migrasi (`0008`, `0017`, `0022`, `0023`,
`0030`) dan dikirim ke WhatsApp Kepala Cabang sebagai tautan verifikasi. Jadi
domain produksinya bukan lagi dugaan.

Konsekuensi penting: `https://finance.haluoleo.id/verifikasi.html` **harus tetap
bisa dibuka**. Setelah halaman `.html` dipensiunkan, tautan itu bergantung pada
blok `redirects()` di `next.config.mjs` (sudah diuji: 308 → `/verifikasi`).
Lihat INTEGRATIONS.md bagian "Verifikasi jembatan sinkronisasi".

## Hosting
**Vercel — dikonfirmasi 2026-08-22** (sebelumnya hanya dugaan).

- Team: `haluoleo's projects` (`team_yws9SgBiAksOCZWo9Sli4oqn`), paket Hobby.
- Proyek produksi: **`haluoleofinance`** (`prj_8f4yCKmCmbUxwPxcVmO5v5rghFL8`),
  domain `finance.haluoleo.id`. **Inilah yang dipakai pengguna.**
- Ada proyek KEDUA yang menunjuk repo yang sama: `mkh-properti`
  (`prj_VM1uLi2VkEzKx6HeTTBNCIBxHx4l`, domain `mkh-properti.vercel.app` dan
  `haluoleo.vercel.app`). Setiap push memicu **dua** deploy sekaligus. Ini
  kemungkinan sisa dari penyiapan awal — konfirmasikan apakah masih dipakai;
  kalau tidak, hapus salah satunya agar tidak membingungkan.
- Node.js: 24.x pada kedua proyek.
- Framework preset di dashboard: `null` (alias "Other") pada kedua proyek —
  sengaja dibiarkan, karena `vercel.json` sudah menimpanya.

Bukti tidak langsung yang dulu dipakai untuk menduga Vercel:
- `.gitignore` includes `.vercel` (Vercel CLI's local project-link folder) and `.env.production` (Vercel's convention for production env files).
- The app is static HTML with zero build requirements, which is trivial to deploy on Vercel with zero configuration (no `vercel.json` needed for a static site).
No `vercel.json`, no Vercel project ID/org ID is present in-repo (these would only appear in `.vercel/project.json`, which is git-ignored, so it cannot be read from this repository).
**Status: UNKNOWN — NEEDS CONFIRMATION.** Do not state as fact in any external-facing document that Vercel is definitely the host; state it as the best inference from `.gitignore` evidence.

## GitHub repository
`loonarsliving/mkh-properti` (confirmed — this is the repo being audited).

## Production branch
`main` — confirmed as the repository's default branch via `git remote show origin`. UNKNOWN — NEEDS CONFIRMATION whether Vercel (or any host) is actually configured to auto-deploy from `main`; no in-repo config confirms this, it is inferred only from `main` being the default branch.

## Preview branch / preview deployments
UNKNOWN — NEEDS CONFIRMATION. If Vercel's GitHub integration is in fact configured, its default behavior is to create preview deployments per-branch/PR automatically — but this cannot be confirmed from repo contents alone since there is no `vercel.json` or workflow file to inspect.

## Build command / Install command / Output directory
Not applicable / UNKNOWN. There is no `package.json`, so there is nothing to `npm install`, and no build tool, so there is no build command. If a host requires these fields, the correct values (if Vercel's zero-config static-site detection is in play) would be:
- Install command: none required
- Build command: none required
- Output directory: repository root (the `.html` files serve directly)
This is an inference based on the repo shape, not a value read from any deployment config file — **confirm directly in the hosting provider's dashboard before relying on it.**

## Required environment variable names
See ENVIRONMENT.md for the full audit. Summary: the frontend does **not** use environment variables at all (Supabase URL and anon key are hardcoded directly in each `.html` file — there is no `process.env`/`import.meta.env` usage anywhere in the client code). Only the two Supabase **Edge Functions** use environment variables, and those are Supabase-managed/auto-injected (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), not something a Vercel deployment would need to supply.

## Supabase production
- Project ref (from hardcoded frontend URL / `supabase/config.toml`): `gluoioiimapyhchdasfl`.
- `supabase/config.toml`'s own comment confirms this config exists specifically to let `supabase link --project-ref gluoioiimapyhchdasfl` and `supabase db push`/`functions deploy` target this **live** project — there is no separate local/staging Supabase project referenced anywhere in-repo.
- **This implies migrations and Edge Function deploys go straight to the production Supabase project** — there is no evidence of a staging Supabase branch/project being used as an intermediate step. Treat every `supabase db push` and `supabase functions deploy` as a production-impacting action.

## Domain / redirect URLs
UNKNOWN — NEEDS CONFIRMATION. Not present in this repository.

## Deployment workflow (as far as can be reconstructed)
Because there is no CI/CD (`.github/workflows` absent) and no build step, the most consistent picture from available evidence is:
1. Code is pushed/merged to `main` on GitHub.
2. If a Vercel Git integration exists (unconfirmed but suggested by `.gitignore`), Vercel auto-builds (trivially, as a static site) and deploys.
3. Separately, and **not automated** — no workflow file triggers it — Supabase migrations (`supabase/migrations/*.sql`) and Edge Functions (`supabase/functions/*`) must be pushed/deployed **manually** via the Supabase CLI (`supabase db push`, `supabase functions deploy <name>`) by a developer, since no CI step does this automatically.

This two-track split (frontend auto-deploys via Vercel; database/functions require a manual CLI step) is an important operational fact: **pushing to `main` alone does NOT apply pending SQL migrations or redeploy Edge Functions.** Evidence for this: migration `0025`'s own comment shows a migration was deliberately written into the repo without being applied live, which would be nonsensical if migrations auto-applied on push.

### PRODUCTION DEPLOYMENT CHECKLIST
Given the above (no CI/CD, no automated tests, manual DB/function deploy step, and at least one prior lesson in the repo about applying migrations without a matching frontend change), a safe production deployment sequence is:

1. **Check current branch** — confirm you are on `main` (or the intended feature branch merged into `main`), not on an unrelated Claude/feature branch.
2. **Check git status** — ensure no unrelated/uncommitted changes are about to be swept into the deploy.
3. **Read the diff being deployed** — for each changed `.html` file, check whether it touches Supabase calls (URL, key, table/column names) that must match the live schema.
4. **Check for pending, unapplied migrations** in `supabase/migrations/` — compare against what's actually applied to the live project (`supabase migration list` / `list_migrations` against the linked project) before assuming they've taken effect. Never assume a migration in the repo is live.
5. **If a migration must be applied**: re-read its full header comment first (this repo's migrations frequently document required manual follow-up steps or explicit "do not apply until X" warnings — see `0025`, `0026`) and follow them exactly, in order, before/after applying.
6. **If an Edge Function changed**: `supabase functions deploy <name>` explicitly — pushing to `main` does not deploy it.
7. **No lint/typecheck/test/build commands exist for this project** — skip those steps as not applicable rather than inventing tooling that isn't there.
8. **Commit, then push to `main`** (or open/merge the PR per whatever branch workflow is in use — see GIT_WORKFLOW.md).
9. **Wait for the hosting provider's deploy to complete** (if Vercel, monitor its dashboard/build logs — not available from this repo).
10. **Verify production**: manually load the production URL (once confirmed) and check at minimum: login works, the CFO dashboard renders for an allowlisted account, and a basic expense-submission round trip succeeds against the live Supabase project.
11. **Check Supabase logs** for the affected Edge Function(s) and any new errors after the deploy.
12. **Never apply a migration that changes RLS/access policies (like `0025`) to production without first confirming the corresponding frontend change is also live** — this repo has an explicit, documented precedent for why that would break the app for every user.

No credentials of any kind are included in this checklist or should ever be added to it.
