# INTEGRATIONS

No secrets, keys, or credential values are recorded in this document — names/purposes/locations only.

## Supabase (core platform)
- **Purpose**: Auth, Postgres database, PostgREST API, Edge Functions — the entire backend of this app.
- **Location in code**: `SB_URL`/`SB_KEY` constants hardcoded in every `.html` page; `supabase/functions/*`; `supabase/migrations/*`; `supabase/config.toml`.
- **Data IN**: all app reads (jurnal, pengajuan, aset, utang_bank, users_proyek, cfo_users, etc.) via PostgREST GET.
- **Data OUT**: all app writes via PostgREST POST/PATCH/DELETE and Edge Function calls.
- **Authentication method**: Supabase Auth (email/password) for users; anon publishable key for most client REST calls (see DATABASE.md RLS caveat); service_role key only inside Edge Functions (server-side, via `Deno.env.get`).
- **Status**: DONE / actively used, this is the entire platform.
- **Dependencies**: none upstream; everything else depends on this.

## MK Connect (external CRM/HR/Ops system)
- **Purpose**: Sibling system (separate repo, not in this codebase) handling CRM, HR, payroll, and WhatsApp messaging/AI receipt-reading. Sends events into this app and (per code comments) sends WhatsApp notifications on this app's behalf.
- **Location in code**: `supabase/functions/sync-inbound/index.ts` (receiving end); outbound triggers/RPCs in migrations `0006`–`0021` that write to `sync_log` for MK Connect to pick up via `sync_dispatch_pending()`.
- **Data IN (to this app)**: `crm_payment_approved`, `sales_commission_approved`, `payroll_salary_generated`, `bonus_approved`, `reimbursement_approved`, `hr_expense_approved`, `payroll_run_approved`, `material_expense_receipt_submitted` event payloads (JSON).
- **Data OUT (from this app)**: expense-approval alerts, branch cash balance updates, loonars fee/closing events, material expense sync events — written to `sync_log` for MK Connect's dispatcher to consume (exact dispatch mechanism/transport is external to this repo — likely pg_net per the Edge Function's own comment "server-to-server call from another Supabase project's Postgres trigger via pg_net").
- **Authentication method**: Shared secret (`X-Sync-Secret` header) validated against `get_sync_secret()` (Supabase Vault) with constant-time comparison; idempotency keys prevent duplicate processing.
- **Status**: DONE, actively used and extended (latest 3 commits in the repo, `0027`–`0029`, all touch this integration).
- **Dependencies**: Supabase Vault (secret storage), `sync_log`/`sync_config` tables.

## loonars-sales / "PT. Loonars Living" (external villa-siteplan app)
- **Purpose**: Sibling sales app for a specific project brand ("Loonars Living"), sharing this Supabase project. Writes cash-in journal entries directly and manages marketing fee/commission claims and unit-closing declarations.
- **Location in code**: migrations `0009`–`0016`, `0019`–`0021`, `0023` (Syafiq/Makassar routing); `loonars_fee`, `loonars_users` tables referenced/altered.
- **Data IN (to this app)**: fee-submission and closing-declared events (via sync pipeline), which create `pengajuan` rows for CFO approval.
- **Data OUT (from this app)**: approval decisions synced back (`loonars_fee_approved_sync`), some via a described-as-**temporary** WhatsApp-reply decision mechanism (`loonars_fee_wa_decision`, commit `dfd09ce`).
- **Authentication method**: Shares the same Supabase project/database; has its own separate login RPC (`loonars_login`) unrelated to this app's Supabase Auth users.
- **Status**: DONE / actively used, though the WA-reply approval path is explicitly marked temporary in its own commit message — treat as PARTIAL for that specific sub-flow.
- **Dependencies**: same Supabase project as this app; `sync_log`/`sync_dispatch_pending()`.

## mkhsistem (external system, referenced once)
- **Purpose**: UNKNOWN — NEEDS CONFIRMATION. Only evidence is commit `a39106d` ("Use mkhsistem-supplied account codes for construction expense sync"), implying it supplies chart-of-accounts codes for construction expense sync.
- **Location in code**: not directly named in current file contents found by search beyond that commit message context (construction sync code in migrations `0019`–`0021`).
- **Status**: UNKNOWN.

## WhatsApp
- **Purpose**: Primary notification/approval channel for Kepala Cabang and Super Admin (submission alerts, transfer-proof confirmation, receipt-photo intake).
- **Location in code**: Referenced extensively in comments and UI copy across `admin-proyek.html`, `lapor-*.html`, `pengeluaran.html`, `verifikasi.html`, and migrations `0006`–`0029`. **No WhatsApp API client/SDK code exists in this repo** — actual message sending/receiving happens in MK Connect (external).
- **Data IN/OUT**: notification text and (per `0027`) receipt photos, both handled externally.
- **Authentication method**: N/A in this repo — external system's responsibility.
- **Status**: PARTIAL from this repo's viewpoint — the trigger/event side is DONE here; the transport (actual WhatsApp API/provider) is entirely external and UNKNOWN — NEEDS CONFIRMATION (provider e.g. WhatsApp Business API/Twilio/Fonnte/etc. is not named anywhere in this repo).
- **Dependencies**: MK Connect.

## Telegram (dihapus seluruhnya, 2026-08-22)
- **Purpose**: dulu dipakai untuk notifikasi persetujuan pengeluaran.
- **Riwayat**: commit `0fd8ada` mencabut Telegram dari alur bahan/tukang dan
  menggantinya dengan WhatsApp — tetapi **penghapusan itu belum tuntas**.
  `verifikasi.html` masih mengirim Telegram untuk event HR/payroll/bonus/
  reimbursement dari MK Connect, lengkap dengan bot token yang di-hardcode,
  dan `admin-proyek.html` masih mengirimnya untuk kas masuk.
- **Status**: **REMOVED (tuntas)** per 2026-08-22 atas keputusan owner. Tidak
  ada satu pun kode Telegram tersisa di aplikasi. Seluruh notifikasi keluar
  kini lewat WhatsApp yang dipicu dari trigger database.
- **Tindakan yang masih tertinggal**: bot token lama masih terbaca di riwayat
  git dan di `docs/legacy-html/`. **Cabut di @BotFather.**

## Vercel (likely hosting — see DEPLOYMENT.md)
- **Purpose**: Inferred static-site hosting.
- **Evidence**: `.gitignore` contains `.vercel` and `.env.production` entries — the standard artifacts of a Vercel-linked project.
- **Location in code**: no `vercel.json` present, so if used it is a zero-config static deployment.
- **Status**: UNKNOWN — NEEDS CONFIRMATION (no direct proof beyond `.gitignore` entries; see DEPLOYMENT.md).

## Not found in this repo (explicitly absent)
Gemini or any other LLM API, Google Ads/Meta Ads, OTA integrations, payment gateways, dedicated email service, push-notification service. None of these appear anywhere in source, config, or migrations. Do not assume any of them exist.

---

## Verifikasi jembatan sinkronisasi setelah migrasi Next.js (2026-08-22)

Migrasi frontend ke Next.js **tidak menyentuh** satu pun berkas di
`supabase/migrations/` maupun `supabase/functions/`. Seluruh jembatan ke
MK Connect, mkhsistem, dan loonars-sales berjalan di sisi database (trigger →
`sync_log` → dispatcher, dan `sync_inbound` untuk arah masuk), jadi tidak ada
jalur sinkronisasi yang melewati kode frontend.

Yang tetap harus dijaga adalah **kontrak data** yang ditulis frontend dan dibaca
trigger. Berikut hasil pemeriksaan saat migrasi.

### 1. Kunci `pengajuan.data` yang dibaca trigger

Trigger `pengajuan_expense_submitted_sync` (migrasi 0008/0017/0022/0023/0030) dan
`pengajuan_expense_approved_sync` membaca kunci berikut dari kolom jsonb `data`:

```
akunNama  blok_selesai  item  items  jenis  ketJ  keterangan  minggu  no
nominal   proyek_nama   rek   rekNama  sisa_kontrak  supplier  terbayarBaru
tgl       tukang_id     tukang_nama    unitSelesaiBaru  unit_minggu
```

Semua kunci itu **masih ditulis dengan nama yang sama persis** oleh keempat
penulis `pengajuan` di kode baru:

| Penulis | Route | tipe |
|---|---|---|
| `src/app/(app)/pengeluaran/page.tsx` | `/pengeluaran` | `bahan` |
| `src/app/(app)/admin-proyek/page.tsx` (tab Bahan) | `/admin-proyek` | `bahan` |
| `src/app/(app)/admin-proyek/page.tsx` (tab Kas Keluar) | `/admin-proyek` | `bahan` |
| `src/app/(app)/admin-proyek/page.tsx` (tab Tukang) | `/admin-proyek` | `tukang` |
| `src/components/lapor/FormLaporLapangan.tsx` | tiga form lapangan | `bahan` |

**Kalau menambah atau mengubah kunci di `data`, periksa dulu daftar di atas** —
menghapus salah satunya akan membuat pesan WhatsApp ke Kepala Cabang kehilangan
informasi tanpa error apa pun.

### 2. Routing Syafiq (Makassar → KC Jogja)

Migrasi 0023 mencocokkan `new.created_by ilike '%syafiq%'` untuk mengalihkan
persetujuan ke Kepala Cabang Jogja, supaya Syafiq tidak menyetujui pengajuannya
sendiri. Form Makassar di kode baru menulis
`created_by = "Pelapor: Muhammad Syafiq"` — **tetap cocok** dengan pola itu.
Jangan ubah format string `created_by` pada form itu.

### 3. Tautan verifikasi di pesan WhatsApp

Empat migrasi (0008, 0017, 0022, 0023, 0030) menanamkan URL
`https://finance.haluoleo.id/verifikasi.html` di payload outbound — inilah
tautan yang diklik Vando dari WhatsApp. Karena halaman `.html` sudah
dipensiunkan, tautan itu **bergantung penuh pada blok `redirects()` di
`next.config.mjs`**. Sudah diuji: `/verifikasi.html` → 308 → `/verifikasi` → 200.

**Jangan hapus blok `redirects()` itu** kecuali kelima migrasi tersebut ikut
diperbarui (dan itu berarti `CREATE OR REPLACE` seluruh badan fungsi, sesuai
pola repo ini).

### 4. Kode akun dari mkhsistem

`sync_inbound` menulis langsung ke `jurnal`. Untuk event
`construction_expense_submitted`, migrasi 0021 mengizinkan **mkhsistem
menentukan sendiri** akun debet/kredit lewat payload
(`debit_akun`/`debit_nama`/`credit_akun`/`credit_nama`), dengan fallback
`5-1001`/`2-1003` atau `5-1003`/`1-1001`.

Artinya kode akun yang masuk ke `jurnal` **tidak dijamin ada di COA aplikasi**.
Di versi HTML lama, akun semacam itu diberi kategori kosong sehingga **hilang
diam-diam** dari total laba rugi dan neraca. Di kode baru, akun tak dikenal
dikelompokkan dari digit pertama kodenya (1 aset, 2 liabilitas, 3 ekuitas,
4 pendapatan, 5 HPP, 6 beban) — lihat `tebakDariKode()` di
`src/lib/akuntansi/saldo.ts` — sehingga neraca tetap seimbang, dan daftar
akunnya ditampilkan sebagai peringatan di halaman Laporan Keuangan agar bisa
didaftarkan ke `src/lib/master.ts`.

Semua kode akun yang **di-hardcode** di lapisan sinkronisasi sudah ada di COA
aplikasi: `1-1001 1-1002 1-1003 1-1004 1-1005 1-1008 2-1003 3-1001 4-1001
4-1002 5-1001 5-1003 6-1008`.

### 5. BENTURAN LABEL AKUN `2-1003` — perlu keputusan bisnis

Ini **temuan lama, bukan akibat migrasi**, tapi baru terlihat jelas sekarang:

- Di COA MKH Property, `2-1003` bernama **"Uang Muka Pembeli"**.
- Di `sync_inbound` (migrasi 0021), `2-1003` dipakai mkhsistem sebagai
  **"Utang Toko Bangunan"** untuk pembelian material konstruksi kredit.

Keduanya sama-sama liabilitas jangka pendek, jadi **neraca tetap benar dan
seimbang**. Yang salah hanya labelnya: utang ke toko bangunan akan tampil di
laporan sebagai "Uang Muka Pelanggan", dan saldo `2-1003` sebenarnya mencampur
dua hal yang berbeda.

Perbaikannya adalah keputusan bisnis, bukan teknis — pilih salah satu:
1. Beri mkhsistem kode akun sendiri (mis. `2-1006` Utang Toko Bangunan), lalu
   daftarkan di `src/lib/master.ts` **dan** ubah fallback di migrasi 0021; atau
2. Terima percampuran itu dan ganti label `2-1003` menjadi netral.

Jangan diubah sepihak dari sisi frontend saja — kode akun harus disepakati kedua
sistem, kalau tidak data historis jadi tidak konsisten.
