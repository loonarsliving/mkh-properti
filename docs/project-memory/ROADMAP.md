# ROADMAP

No issue tracker, TODO-list file, or explicit roadmap document exists in this repository. This roadmap is built **only** from what is directly evidenced in code comments, migration headers, and commit messages — nothing here is invented.

## COMPLETED (evidenced by merged commits / applied-looking migrations)
- **Migrasi frontend ke Next.js + laporan SAK EMKM** (2026-08-22, branch
  `claude/html-nextjs-migration-financial-reports-vb7l50`, **belum di-merge**) —
  10 halaman HTML statis → aplikasi Next.js 15, filter periode global
  (rentang bulan bebas / setahun penuh), dan penyusunan ulang laporan keuangan
  mengikuti SAK EMKM. Lihat CHANGELOG.
- MK Connect sync integration (CRM payments, payroll, commission, HR expenses) — commits `b5f4e0f`/`9d7d3dd`.
- Branch-based Finance Dashboard redesign with drill-down — commits `cea592e`/`3555b91`.
- loonars-sales fee/closing verification flow — migrations `0009`–`0016`.
- Move loonars fee-claim approval fully to CFO, drop owner step — commit `b36eb0e`.
- Remove Telegram from bahan/tukang approval flow, replace with WhatsApp — commit `0fd8ada`.
- No-login expense report pages for field supervisors, restricted to named individuals/branches — commits `d249bcb`, `9d7e75f`, `f6e6895`, `00903f7`.
- WhatsApp nota-photo (AI-read by MK Connect) → material expense submission, itemized — migrations `0027`–`0029`.
- Security fixes: stored XSS (`349bce5`), CFO dashboard access control (`69a2822`), admin-create-user privilege check (`c4f64a7`), hardcoded service_role key removal (`b50250a`).

## IN PROGRESS (evidenced by explicit "not yet complete" language in the repo)
- **RLS tightening on financial tables** (migration `0025`) — written, but its own comment states it must not be applied until a corresponding frontend auth-token change is made; that frontend change is not evidenced elsewhere in this repo as done. Status: in progress / blocked on a follow-up change.
- **`loonars_fee_wa_decision`** (commit `dfd09ce`) — explicitly labeled "temporary" in its own commit message; implies a more permanent approval mechanism is intended eventually. No evidence of what that permanent mechanism should look like exists in-repo.

## NEXT / PLANNED
UNKNOWN — NEEDS CONFIRMATION. No explicit "next up" list, TODO comments describing future work, or open issues are present in this repository to draw from. Do not infer a product roadmap beyond what's stated above.

## UNKNOWN
- Whether there is a broader roadmap tracked outside this repo (e.g. in a project-management tool, GitHub Issues/Projects — this audit did not have access to check GitHub Issues).
- Whether `mkhsistem` (mentioned once in commit `a39106d`) represents a larger planned integration or is already complete elsewhere.
- The intended replacement for the "temporary" `loonars_fee_wa_decision` mechanism.

## LANGKAH BERIKUTNYA setelah migrasi Next.js (2026-08-22)

Berurutan sesuai prioritas, berdasarkan hal yang benar-benar tertinggal:

1. **Rotasi bot token Telegram.** Token lama sudah ter-commit di
   `docs/legacy-html/verifikasi.html` dan `admin-proyek.html`, jadi harus
   dianggap bocor. Buat token baru lewat @BotFather, isi ke
   `NEXT_PUBLIC_TELEGRAM_BOT_TOKEN`, lalu cabut yang lama.
2. **Pindahkan pengiriman Telegram ke Edge Function.** Selama token ada di
   variabel `NEXT_PUBLIC_*`, token tetap ikut ke bundle browser. Menaruhnya di
   Edge Function (seperti `sync-inbound`) membuatnya benar-benar rahasia.
3. **Terapkan migrasi `0025` (pengetatan RLS).** Prasyaratnya masih sama seperti
   dulu: klien harus mengirim access token user, bukan anon key, pada panggilan
   tabel keuangan. Jalur itu sekarang jauh lebih mudah — tinggal ubah
   `restHeaders()` di `src/lib/supabase.ts` menjadi memakai `authHeaders()`,
   satu tempat saja, bukan sepuluh halaman. Uji di Supabase branch dulu.
4. **Tambahkan CI.** Sudah ada `npm run build`, `lint`, dan `typecheck` yang
   bersih; sebuah workflow GitHub Actions yang menjalankan ketiganya pada tiap
   PR akan menutup celah "tidak ada gerbang otomatis sama sekali".
5. **Test untuk mesin akuntansi.** `src/lib/akuntansi/` kini murni fungsi tanpa
   efek samping, jadi bisa diuji tanpa database. Prioritaskan: neraca harus
   seimbang, pemisahan saldo laba awal vs periode berjalan, dan klasifikasi
   arus kas.
6. **Beban pajak penghasilan belum dijurnal.** Saat ini diisi manual di layar
   laporan dan hanya muncul sebagai utang pajak penyajian. Kalau angkanya mulai
   dipakai serius, buat akun COA-nya dan jurnalkan sungguhan.
