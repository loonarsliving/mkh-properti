# CURRENT_STATE

_Audit awal: 2026-08-21, HEAD `a47daa8` di `main`._
_Diperbarui: 2026-08-22 — migrasi frontend ke Next.js (branch `claude/html-nextjs-migration-financial-reports-vb7l50`, belum di-merge ke `main`)._

## PERUBAHAN BESAR TERAKHIR — migrasi ke Next.js (2026-08-22)

Frontend berpindah dari 10 halaman HTML statis ke satu aplikasi **Next.js 15
(App Router) + TypeScript + Tailwind**. **Skema dan isi database tidak diubah
sama sekali** — nama tabel, nama kolom, dan kode akun COA tetap sama persis.

Yang perlu diketahui siapa pun yang melanjutkan:

1. **Deployment berubah bentuk.** Repo ini sekarang punya `package.json` dan
   butuh langkah build (`next build`). Jika host masih disetel sebagai situs
   statis tanpa build, deploy akan gagal — setelan host HARUS diperiksa dan
   diubah ke preset Next.js sebelum merge ke `main`. Lihat DEPLOYMENT.md.
2. **Halaman HTML lama sudah dipensiunkan** ke `docs/legacy-html/` dan tidak
   lagi disajikan. URL lama berakhiran `.html` tetap hidup lewat redirect 308
   di `next.config.mjs` — jangan hapus blok `redirects()` itu, tautan
   WhatsApp/bookmark staf lapangan bergantung padanya.
3. **Fitur Telegram dihapus total** atas keputusan owner (sudah tidak dipakai).
   Tidak ada lagi kode Telegram di aplikasi. Notifikasi keluar kini **hanya
   lewat WhatsApp**, dan itu dipicu dari sisi database (trigger →
   `sync_log` → MK Connect), bukan dari browser — jadi penghapusan ini tidak
   memutus notifikasi apa pun yang masih dipakai.
   **Sisa pekerjaan:** bot token lama masih ada di riwayat git dan di
   `docs/legacy-html/verifikasi.html`, jadi **harus dicabut di @BotFather**.
4. **Laporan keuangan sekarang berbasis SAK EMKM** dengan pemilihan periode
   (rentang bulan bebas atau setahun penuh). Perhitungan neraca diperbaiki
   menjadi kumulatif — lihat CHANGELOG untuk daftar perbaikan hitungan.
5. **Jembatan ke MK Connect / mkhsistem / loonars-sales tidak tersentuh.**
   Tidak ada berkas di `supabase/` yang diubah. Kontrak data yang ditulis
   frontend (kunci `pengajuan.data`, format `created_by`, dan tautan
   `/verifikasi.html`) sudah diperiksa satu per satu dan cocok — lihat
   INTEGRATIONS.md bagian "Verifikasi jembatan sinkronisasi" untuk daftar
   lengkapnya beserta hal yang tidak boleh diubah sembarangan.
6. **Akun di luar COA kini aman.** Kode akun yang dikirim mkhsistem lewat
   `sync_inbound` tidak dijamin terdaftar di COA aplikasi. Dulu akun semacam
   itu hilang diam-diam dari total laporan; sekarang dikelompokkan dari digit
   pertama kodenya dan ditampilkan sebagai peringatan di Laporan Keuangan.
7. **PRODUKSI SUDAH HIDUP DAN TERVERIFIKASI** (2026-08-22, deploy
   `dpl_GDhL1FbQnpwJgbsKu9cm9DPkGuKL`, commit `10d5b1d`). Diuji langsung
   terhadap `finance.haluoleo.id`:
   - `/login` -> 200
   - `/lapor-pengeluaran.html` -> 200, `x-matched-path: /lapor-pengeluaran`,
     form tampil dengan nama Endy terkunci
   - `/verifikasi.html` (tautan WhatsApp Vando) -> 200,
     `x-matched-path: /verifikasi`
   Deploy pertama sempat 404 di semua URL karena framework preset Vercel masih
   "Other"; diperbaiki lewat `vercel.json`. **Jangan hapus `vercel.json`.**
8. **Belum diuji dengan data produksi asli.** Verifikasi dilakukan dengan data
   contoh yang di-mock di browser (termasuk simulasi transaksi mkhsistem
   dengan kode akun asing): build bersih, tidak ada error runtime, neraca
   seimbang, seluruh 10 redirect URL lama berfungsi. Uji end-to-end terhadap
   Supabase asli belum dilakukan.

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
- No automated tests, no CI/CD — all functional verification is still manual.
  (`npm run lint` dan `npm run typecheck` kini tersedia dan bersih, tapi belum
  ada test suite maupun workflow CI yang menjalankannya otomatis.)
- ~~Duplicated JS logic copy-pasted across every `.html` page~~ — **selesai**
  pada migrasi Next.js 2026-08-22: helper Supabase, auth guard, COA, dan
  formatter kini satu implementasi bersama di `src/lib/`.
- Core business tables lack in-repo migration history (schema drift risk — the only way to know the true live schema is to query the live Supabase project directly).
- Config comment in `supabase/config.toml` itself flags the no-local-dev-workflow situation as a known characteristic, not accidental — but it does mean there's no fast local iteration loop for schema/RPC changes; every migration test happens against the live-linked project unless a Supabase branch is manually created.

## Blocked work
None explicitly recorded. The RLS migration (`0025`) is the closest thing to "blocked" — blocked on a frontend change that (per this repo's contents) has not yet been made.

## Important warnings for anyone working on this repo
1. **Do not apply migration `0025` without first updating the frontend to send user session tokens instead of the anon key on financial-table calls** — its own header comment states this will break the app for every user otherwise.
2. **`cfo_users` starts empty when the migration was first applied** — if the live table is ever still empty, nobody (including the real owner) can access `index.html`; this must be populated manually, not via a migration.
3. Treat every `sync_inbound` change as **production-critical and shared infrastructure** — it's the single choke point for MK Connect, loonars-sales, and now WhatsApp-receipt events; a bad edit here has broken multiple downstream flows before (see `268d5d0`).

## Production status
UNKNOWN — NEEDS CONFIRMATION. Tidak ada bukti di repo ini yang memastikan situs
sedang live, di URL apa, atau apakah commit terakhir sudah ter-deploy. Lihat
DEPLOYMENT.md.

**Tambahan penting setelah migrasi Next.js:** apa pun host-nya, setelan proyek
harus diubah dari "situs statis tanpa build" menjadi preset **Next.js** sebelum
branch migrasi di-merge ke `main`. Selama itu belum dilakukan, jangan merge —
deploy akan gagal atau menyajikan repo mentah.

## Mobile status
NOT IMPLEMENTED — no mobile app exists. See MOBILE_BUILD.md.

## Database status
Live schema/RLS state cannot be fully confirmed from this repo alone (see DATABASE.md and the RLS warning above). Migration files up to `0029` are present in the repo; whether all of them (especially `0025`) have actually been pushed to the live Supabase project is UNKNOWN — NEEDS CONFIRMATION directly against the Supabase project.
