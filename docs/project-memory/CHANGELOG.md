# CHANGELOG

Built directly from `git log` on `main` (55 commits, oldest first). No entries are fabricated — this mirrors actual commit history. Earliest commits (bulk file uploads, no granular history) are summarized as a block; later commits are listed individually as they became feature-scoped.

## 2026-10-28 — Loonars 2: upah tukang bernominal dihitung dari plafon borongan (migrasi 0057)
- Kejadian: pengajuan mingguan Vando "tukang minggu ini 25 jt" (tanpa unit) + pasir + reimburse ditolak setelah YA dengan pesan "unit belum disebut … belum ada unit yang ditandai sedang dibangun", padahal AVARA-01..06 sudah ditandai. Penyebab: baris tukang BERNOMINAL tanpa unit tidak punya jalur (hanya biaya lain-lain yang otomatis dibagi), dan upah tukang bernominal tidak pernah dicatat ke borongan sehingga tidak memotong plafon.
- Keputusan owner: dibagi rata, patokan tetap plafon borongan (Borongan tukang AVARA-01..06 = 6 × (35 jt − retensi 9 jt) = Rp 156 jt). Kini tukang bernominal tanpa unit → borongan aktif (nama mandor / satu-satunya), dibagi rata ke unit borongannya; dengan unit di satu borongan → dibagi ke unit itu; keduanya dicatat `borongan_id` + `minggu_ke` berikutnya dan ditolak bila melebihi sisa plafon (pesan menyebut plafon, sudah diajukan, sisa). Upah otomatis "L2 tukang minggu ini" dipotong ke sisa plafon. Unit di luar borongan: jalur lama.
- Fungsi baru `_loonars2_sisa_upah_borongan`, `_loonars2_upah_borongan`; `_loonars2_ajukan_mingguan` diganti per potongan (pola 0056). Tanpa tabel/kolom baru; data lama tidak diubah. Uji: `supabase/tests/loonars2_uji_upah_borongan.sql`.
- Belum: pengajuan satu baris "L2 unit 1-6 tukang … 20.000.000" (aksi `ajukan`) masih lewat jalur lama: hanya unit pertama yang tercatat dan tidak memotong plafon (contoh nyata: pengajuan 20 jt yang sudah dibayar tercatat seluruhnya di unit 1, tanpa borongan).

## 2026-10-21 — Laporan keuangan villa (kiriman harian) + rekap pajak hotel (migrasi 0054)
- Lihat CURRENT_STATE.md 2026-10-21. Tabel `laporan_villa_bulanan`, `pajak_hotel_villa`, RPC `villa_laporan_terima` / `villa_laporan_ringkasan_wa`, halaman `/laporan-keuangan-villa` dan `/pajak-hotel`, endpoint `/api/laporan-villa/ringkasan-wa`. Migrasi sudah diterapkan ke produksi.

## 2026-10-21 — Loonars 2: bukti cicilan lama dibedakan lewat tanggal + jam (migrasi 0055)
- Penjaga bukti kembar (0052) hanya melihat nominal + penerima, sehingga beberapa transfer lama Rp 10 jt ke penerima yang sama (3 dan 10 Okt) dikira kembar. Kini identitas bukti = nominal + penerima + tanggal + jam (+ referensi bila terbaca; pembaca bukti MK Connect kini membaca `waktu` & `referensi`). Jam tak terbaca & tanggal sama → tanya, owner menegaskan dengan kata "transfer beda". Pembayaran dicatat pada TANGGAL TRANSFER di foto (laporan utang menampilkan tanggal yang benar).
- Data: M-43/M-44 dilengkapi tanggal-jam; M-44 dipindah ke 3 Okt; bukti 10 Okt 18:11 (Rp 10 jt) dicatat sebagai M-45. Nomor migrasi 0055 karena 0054 dipakai laporan villa.

## 2026-10-19 — Loonars 2: laporan pembayaran utang toko sebagai PDF lewat WA (migrasi 0053)
- Owner minta lewat WA bot ("kirim laporan utang loonars 2 pdf", "laporan pembayaran utang", "L2 laporan utang") → MK Connect meminta tautan ke MKH Property (aksi `laporan_utang`, khusus owner) lalu mengirim PDF sebagai dokumen WA.
- Tautan berumur 15 menit, bertanda tangan HMAC-SHA256 dengan rahasia sync yang sudah ada (Vault `mk_sync_shared_secret`); PDF dibuat saat diunduh dari data terbaru (`GET /api/loonars2/laporan-utang/<token>/<nama>`), tidak disimpan. Isi: ringkasan total utang/dibayar/sisa, per toko daftar pembayaran (tanggal, kode, nominal, penerima, ada bukti) dan daftar utang per kode.
- Data yang dilaporkan = tabel yang sudah ada (utang, cicilan, pembayaran); tanpa tabel baru.

## 2026-10-19 — Loonars 2: bukti transfer pembayaran utang toko dibaca otomatis (migrasi 0052)
- Owner mengirim foto bukti + keterangan "pembayaran utang toko ..." tanpa ada pengajuan cicilan: sebelumnya dijawab "tidak ada pengajuan" dan tidak dicatat. Kini `_loonars2_bukti_cicilan` menentukan toko (nama di keterangan → toko yang pernah dibayar ke penerima sama → satu-satunya toko yang sisa utangnya cukup), mencatat cicilan disetujui + dibayar dari C (dana talangan bila kurang) dengan bukti, meneruskan bukti ke pelaksana. Toko tak bisa ditentukan / nominal > sisa utang: tidak dicatat, dijelaskan. Bukti kembar tidak dicatat dua kali. Adapter MK Connect mengirim keterangan foto.
- Pembayaran 9.173.000 (19 Okt 2026) dicatat manual sebagai M-43 ke Sedia Nurut.

## 2026-10-19 — Loonars 2: utang toko langsung sah, penjaga nota double (migrasi 0051)
- Permintaan owner: utang yang diinput pelaksana dari nota tidak perlu persetujuan; yang dijaga sistem adalah nota double.
- Utang U-n baru langsung `disetujui` (diputuskan_oleh `sistem:otomatis (nota pelaksana)`); owner masih bisa `tolak U-n <alasan>` sesudahnya.
- `_loonars2_cek_utang_double`: toko + total sama dengan utang yang ada (bukan ditolak) → tidak dicatat, pelaksana diberi tahu kode yang mirip; nota yang memang lain: tambahkan "nota beda" (data `paksa`).
- Nama toko dicocokkan lewat `_loonars2_kunci_toko` (membuang kata umum: toko, besi, kaca, tb, ud, cv, bahan bangunan, dan, &). Toko ganda digabung (BJ Basuki Jaya ×2, Sedia Nurut ×2); 90 utang yang menunggu disetujui otomatis. Dua baris toko kosong sisa penggabungan (id 3 dan 5) tidak bisa dihapus lewat MCP dan disembunyikan di dashboard (`tokoAda`).
- Uji SQL diperbarui (220 lulus); runner mencakup 0050 dan 0051.

## 2026-10-19 — CI + tes mesin akuntansi
- `.github/workflows/ci.yml`: typecheck, lint, `npm test`, build di setiap PR dan push ke `main` (tanpa rahasia, tanpa deploy).
- `vitest` + `src/lib/akuntansi/sak-emkm.test.ts` (9 tes): neraca seimbang per tahun, saldo laba awal vs periode berjalan, akun di luar COA tetap terhitung, beban pajak manual, klasifikasi arus kas, neraca saldo D = K.

## 2026-10-18 — Ringkasan keuangan JSON untuk asisten WA owner
- `POST /api/laporan-investor/ringkasan-wa` + `susunModelServer` (server.ts) + `susunRingkasan` (ringkasan.ts). Hanya baca, tanpa migrasi.

## 2026-10-15 — Loonars 2: bukti transfer ikut diteruskan ke pelaksana (migrasi 0050)
- `_loonars2_bayar_kelompok`: pemberitahuan "tercatat dibayar" ke pelaksana kini membawa foto bukti (sebelumnya hanya teks). Bukti M-9 (13 jt ke SARNO, 15 Okt 2026) dilampirkan ke catatan pembayaran dan dikirim ke Vando.

## 2026-10-15 — Loonars 2: foto bukti transfer dibaca otomatis + dana talangan (migrasi 0049)
- Insiden nyata: owner membayar upah borongan Rp 13 jt dan mengirim foto tanpa keterangan; foto itu tidak sampai ke Loonars 2 (hanya foto berketerangan "L2 ..." yang diproses) dan saldo C Rp 0 menolak pencatatan.
- Foto tanpa keterangan dari nomor terdaftar: database dicek dulu (ada yang menunggu?), AI hanya membaca nominal (`recognizeTransferProof`), database mencocokkan persis & unik ke satu kode M-n / L2-n / transfer A→B/C/D menunggu. Bukti owner = menyetujui + mencatat dibayar; bukti pelaksana hanya mencatat yang sudah disetujui; ambigu → diminta "L2 bayar <kode>".
- Bukti owner boleh mendahului saldo C: `loonars2_disbursements.talangan = true` (saldo C minus = dana talangan, tampil di Ringkasan). Jalur "L2 bayar ..." tetap menolak bila saldo kurang.

## 2026-10-14 — Loonars 2: borongan otomatis, biaya lain tanpa unit, cicilan "lunas" (migrasi 0048)
- Pelaksana cukup mengajukan; owner tidak menyiapkan data: "tukang minggu ini" membuat borongan otomatis (ketentuan standar di `loonars2_settings`: 35 jt/unit, retensi 9 jt, 12 minggu) untuk unit sedang dibangun yang belum punya borongan; beberapa borongan aktif diajukan sekaligus; owner diberi tahu.
- "lain ..." tanpa unit dibagi rata ke unit sedang dibangun; "cicilan <toko> lunas" / tanpa nominal memakai sisa utang dari tabel utang.

## 2026-10-14 — Loonars 2: borongan tukang, bahan kolektif, unit sedang dibangun (migrasi 0047 BELUM diterapkan)
- Upah tukang = borongan per paket: jumlah_unit × (nilai − retensi) ÷ jumlah_minggu (6 unit × (35 jt − 9 jt) ÷ 12 = 13 jt/minggu; selisih bulat di minggu terakhir). Vando cukup "L2 tukang minggu ini"; retensi per unit diajukan setelah unit selesai/serah terima dan disetujui owner.
- Bahan dipesan kolektif (tanpa unit), dibagi ke unit sedang dibangun (bagi rata; item bisa ditujukan ke unit tertentu dari catatan Vando/AI), hasilnya RAB pemakaian per unit; bisa dikoreksi ("L2 koreksi M-7 semen unit 1,2,3").
- "Unit sedang dibangun" = acuan: Vando ditanya tiap pesan yang unitnya tidak disebut (YA / "L2 unit 1-7"); syarat DP dicabut untuk unit tersebut.
- Tabel baru `loonars2_borongan`, `loonars2_borongan_unit`, `loonars2_pesanan_bahan`, `loonars2_bahan_unit`; kolom baru pada tabel loonars2_ sendiri; view `loonars2_v_borongan`, `loonars2_v_rab_bahan`. Dashboard: tab Borongan & RAB (owner + pelaksana). Uji SQL 183 skenario lulus.

## 2026-10-13 — Loonars 2: akses web baca-saja untuk pelaksana (migrasi 0045 LIVE: 0045a, 0045b)
- Migrasi `0046` LIVE (0046a–c): tabel `loonars2_akses_web` (email unik, RLS, audit) untuk izin tambahan, karena `users_proyek.email` UNIK. `loonars2_boleh_lihat()` memeriksa CFO, users_proyek 'LOONARS2', atau loonars2_akses_web. Vando (verifikator) diberi akses lewat tabel ini.
- Akses Loonars 2 bersifat tambahan: baris users_proyek 'LOONARS2' tidak menggantikan peran lain (mis. verifikator); `cariPenugasanUser` membaca semua baris, `Sesi.aksesLoonars2`.
- Migrasi `0045`: `loonars2_boleh_lihat()` + RPC `loonars2_web_lihat()` (tanpa tabel baru). Izin = baris `users_proyek` dengan `proyek_id = 'LOONARS2'`.
- Peran baru `pelaksana` di frontend: hanya `/loonars2` (tampilan baca-saja: proyeksi tanah, budget unit, utang toko, pengajuan, panduan WA). Tanpa saldo rekening, pembeli, harga, audit.
- Ringkasan owner: panel Utang toko bangunan.

## 2026-10-11 — Loonars 2: utang toko + pengajuan mingguan (LIVE)
- Migrasi `0044`: utang per toko, cicilan mingguan, pengajuan mingguan multi-baris (kode M-n), pengingat mingguan ke pelaksana.
- Dashboard: tab Utang Toko, setujui/bayar per kode.

## 2026-10-11 — Modul Keuangan Loonars 2 (branch `claude/loonars2-finance-module-9ejyyz`, belum di-merge)
- Migrasi `0043` (belum diterapkan): sistem 4 rekening A/B/C/D, alokasi C → B → D, pengajuan material, pengingat & laporan WA, audit log.
- Halaman `/loonars2`, route `/api/loonars2/wa`, uji SQL `supabase/tests/`.

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

## 2026-08-22 — Migrasi ke Next.js + laporan SAK EMKM

Perubahan terbesar sejak proyek dibuat. Frontend berpindah dari 10 halaman HTML
statis ke satu aplikasi **Next.js 15 (App Router) + TypeScript + Tailwind**.

- **Tidak ada perubahan basis data.** Nama tabel, nama kolom, dan pemetaan akun
  COA tetap sama persis; aplikasi baru membaca/menulis data yang sudah ada.
- Seluruh 10 halaman lama dimigrasi penuh menjadi 21 route. Arsip HTML lama
  dipindahkan ke `docs/legacy-html/` (tidak lagi disajikan). URL lama
  berakhiran `.html` tetap hidup lewat redirect 308 di `next.config.mjs`.
- Tampilan baru: sidebar gelap berkelompok, topbar dengan filter periode global,
  kartu KPI bergradasi, dan kartu posisi keuangan ringkas.
- **Filter periode baru**: rentang bulan bebas (mis. Mar 2026 s.d. Agu 2026)
  atau setahun penuh. Berlaku untuk seluruh menu transaksi & laporan, tersimpan
  di sessionStorage, dan bisa dibagikan lewat query `?periode=`.
- **Modul laporan keuangan disusun ulang mengikuti SAK EMKM**: tiga laporan
  wajib (Posisi Keuangan, Laba Rugi, CALK) plus Perubahan Ekuitas & Arus Kas
  sebagai tambahan opsional yang ditandai bukan syarat SAK EMKM.
- Duplikasi kode hilang: `sbGet/sbInsert/sbUpdate/sbDelete`, auth guard, COA,
  dan helper format kini satu implementasi bersama (dulu di-copy-paste per
  halaman).

### Perbaikan yang ikut terbawa

- **Neraca sebelumnya tidak pernah benar.** `laporan-keuangan.html` menjumlah
  mutasi satu tahun saja untuk pos neraca, padahal neraca harus kumulatif sejak
  awal berdiri. Sekarang neraca kumulatif s.d. akhir periode, saldo laba dipecah
  menjadi saldo awal + laba periode berjalan, dan Aset = Liabilitas + Ekuitas
  selalu seimbang selama setiap entri jurnal seimbang.
- **Angka negatif tampil sebagai positif.** Fungsi `fmt()` lama memakai
  `Math.abs()`, sehingga rugi bersih dan saldo minus muncul tanpa tanda. `fmt()`
  kini mempertahankan tanda; nilai absolut dipisah ke `fmtAbs()`, dan laporan
  memakai konvensi kurung.
- **Arus kas tidak lagi menebak.** Dulu ditaksir dari total debet/kredit; kini
  metode langsung dengan klasifikasi per nomor transaksi berdasarkan akun lawan.
- **Jalur XSS hilang.** Kwitansi dan slip gaji dulu disusun sebagai string HTML
  lalu `document.write` ke jendela baru; keduanya kini komponen React biasa yang
  hanya tampil saat mencetak.
- **Fitur Telegram dihapus total** atas keputusan owner (sudah tidak dipakai).
  Bot token yang di-hardcode di `verifikasi.html`/`admin-proyek.html` tidak
  pernah disalin ke kode baru, dan sekarang tidak ada kode Telegram sama sekali.
  Notifikasi keluar sepenuhnya lewat WhatsApp yang dipicu trigger database.
  **Token lama tetap harus dicabut di @BotFather** — masih ada di riwayat git.
- **Akun di luar COA tidak lagi hilang diam-diam.** `sync_inbound` mengizinkan
  mkhsistem menentukan sendiri kode akun debet/kredit (migrasi 0021). Dulu akun
  yang tidak ada di COA aplikasi diberi kategori kosong sehingga tidak ikut
  total laba rugi maupun neraca. Kini dikelompokkan dari digit pertama kode
  akun dan ditampilkan sebagai peringatan di halaman Laporan Keuangan.

## 2026-09-10
- Added `pendapatan_villa` table (migration `0032`) and a new "Pendapatan Villa"
  report page (`/pendapatan-villa`, CFO-only) for Loonars Villa rental income
  (rental/cafe/spa/lainnya). Manual entry for now — the villa rental system
  ("villa" repo, Supabase project `svcmybsziaelwwdrnzcv`) runs on a completely
  separate Supabase project from this app (`gluoioiimapyhchdasfl`), so there is
  no existing data pipeline for this income. Deliberately not posted into
  `jurnal` — villa income isn't part of this app's existing chart of
  accounts/PROYEK list, and picking one would be an accounting decision, not
  something to invent unasked. `sumber`/`idempotency_key` columns are already
  in place so a future automatic sync from the villa side can fill this table
  without another schema change.

## 2026-09-10 (later same day)
- Added `villa_income_sync` RPC (migration `0033`) — automatic monthly sync
  target for Loonars Villa rental/cafe/spa/lainnya income into
  `pendapatan_villa`, called by villa-api's own new cron. Deliberately a
  separate, narrowly-scoped function (own Vault secret, anon-key RPC path)
  rather than extending `sync_inbound` or sharing this project's service_role
  key with the villa system — see INTEGRATIONS.md for the reasoning. Applied
  directly to production and tested.

## 2026-09-10 (later same day) — Laporan Laba-Rugi Villa
- Owner clarified the manual-entry question and asked for a proper income
  statement for the villa business line, including expenses (not just
  income).
- Added `beban_villa` table (migration `0034`), a symmetric pair to
  `pendapatan_villa` (0032). Categories (`opex`, `marketing`, `lainnya`) were
  taken directly from reading villa's own `src/app/investor/opex/page.tsx` —
  villa's real model computes opex/marketing as flat percentages of gross
  revenue per the ownership agreement ("akad"), not itemized actuals, so this
  table mirrors that rather than inventing a fictitious itemized-expense
  system villa itself doesn't use.
- New `/beban-villa` page (input, mirrors `/pendapatan-villa` exactly) and
  new `/laporan-villa` page — a printable Laba Rugi Villa sheet (reuses the
  existing `laporan-paper`/`.lt`/`.sec-title` print CSS from the SAK EMKM
  report), driven by the same global period filter as the rest of the app.
  Shows Pendapatan (per kategori + total), Beban (per kategori + total), and
  Laba/Rugi Bersih.
- Sidebar reorganized: new "Loonars Villa" group (Pendapatan Villa, Beban
  Villa, Laporan Laba-Rugi Villa) replacing the single item that used to sit
  under "Laporan SAK EMKM".
- Applied `0034` to production Supabase directly (continuing the owner's
  standing "bawa ke production" instruction from earlier the same session).
  Verified via `tsc --noEmit` and `next build`.

## 2026-10-10
- Tutup akses publik ke data keuangan, tahap 1: migrasi 0036 (live) + frontend
  token login (PR #13). Tahap 2 (0037) menunggu frontend live.
- Loonars Coffee mendapat kode proyek LC; cegah jurnal ganda biaya
  konstruksi (0038, live). Penghapusan duplikat historis (0039) menunggu
  persetujuan owner.
- Modul Laporan Investor (0040 live; halaman, PDF, endpoint WA di PR #13).
  Dependensi baru: `@react-pdf/renderer` 4.9.0.
- Daftar proyek frontend kini memuat KDI dan LC.
- Tahap 2 penutupan akses publik (0037) diterapkan; duplikat historis
  Loonars Coffee dihapus (0039, disetujui owner).
