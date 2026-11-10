# AI CFO → Institutional Financial Reporting — Audit & Rencana Implementasi

_Tahap 1 (audit). Disusun 2026-11-02 dari repositori `mkh-properti`, `villa`,
`Mkhsistem` dan pemeriksaan **read-only** database produksi lewat Supabase MCP
(`gluoioiimapyhchdasfl` = MKH Property, `svcmybsziaelwwdrnzcv` = MK Connect +
villa). Tidak ada perubahan database, kode aplikasi, atau konfigurasi produksi
yang dilakukan pada tahap ini. Tidak ada credential di dokumen ini._

Dokumen ini melanjutkan `docs/ai-cfo/AUDIT-DAN-DESAIN.md` (audit AI CFO
2026-11-01) — bukan menggantikannya.

---

## 1. Ringkasan eksekutif

1. **Sistem sudah punya fondasi yang benar untuk dikembangkan, bukan diganti.**
   Mesin AI CFO (`src/lib/cfo/`) deterministik, teruji (vitest), memakai satu
   model (`susunModelCfo`) untuk dashboard, WA, chat, dan PDF; sudah ada audit
   log append-only, arsip tutup buku ber-hash, RLS, dan aturan "null = tidak
   tersedia, bukan nol".
2. **Tetapi belum ada satu buku besar yang menjadi single source of truth.**
   Laporan holding saat ini dirakit dari 4 sumber berbeda (laporan villa
   bulanan, modul 4 rekening Loonars 2, snapshot MK Connect, jurnal MKH). Akibat
   langsungnya: **neraca holding tidak bisa benar-benar seimbang secara
   independen** — ekuitas dihitung sebagai `aset − liabilitas` (plug), sehingga
   persamaan A = L + E selalu "lolos" tanpa membuktikan apa pun.
3. **Ada satu risiko salah saji material yang harus diputuskan owner sebelum
   laporan apa pun disajikan ke investor** (temuan F-1): jurnal proyek `LL`
   memuat ±Rp 1,9 M penjualan unit **Loonars Villa (Loonars 1)** sebagai
   pendapatan 2026, sementara laporan holding menyatakan villa Loonars 1 "milik
   investor, bukan aset PT" dan tidak memasukkan jurnal LL ke laba rugi.
4. **Biaya villa adalah biaya STANDAR, bukan aktual** (COGS per malam & gaji
   per headcount). Formula ini juga dasar bagi hasil investor (rumus beku di
   villa). P&L institusional harus memisahkan "biaya standar (dasar bagi
   hasil)" dari "biaya aktual (akuntansi)" — dan tidak boleh mengubah rumus bagi
   hasil.
5. **Inventaris kamar per tanggal SUDAH ADA di villa**
   (`villa_daily_inventory_snapshot`, `villa_room_maintenance`) tetapi belum
   dipakai: `malam_tersedia` saat ini = jumlah unit × hari (403 = 13 × 31),
   sehingga kamar yang ditutup untuk maintenance ikut dihitung tersedia.

Rekomendasi arsitektur (perlu persetujuan owner — perubahan arsitektur &
skema): **jadikan tabel `jurnal` yang sudah ada sebagai buku besar tunggal**
dengan dimensi entitas legal + properti, dan bangun **mesin posting idempoten**
yang menjurnal data villa / Loonars 2 / MK Connect ke sana. Semua laporan
(P&L, neraca, arus kas, konsolidasi, PE dashboard, ekspor) lalu diturunkan
dari buku besar itu + tabel pendukung baru. Detail di §5.

---

## 2. Arsitektur yang ada (terverifikasi)

| Lapisan | Isi | Bukti |
|---|---|---|
| Frontend | Next.js 15 App Router + TS + Tailwind, `@react-pdf/renderer` | `package.json`, `src/app/(app)/*` |
| Data access | Supabase PostgREST + Auth, token pengguna, RPC security definer | `src/lib/supabase.ts`, migrasi 0036–0037 |
| RBAC | `cfo_users` (allowlist owner/CFO), `users_proyek` (admin proyek / pelaksana / verifikator); `mkh_is_cfo()`, `mkh_is_staf()` di RLS | migrasi 0026, 0036; `src/lib/navigasi.ts` |
| AI CFO | Mesin murni `src/lib/cfo/*` ← RPC `cfo_ambil_data` / `cfo_ambil_kerja`; AI hanya menarasikan fakta bernomor (layanan AI MK Connect, HMAC) | migrasi 0057–0062 |
| Akuntansi umum | `jurnal` (double-entry, per `no`, per `proyek`) + COA statis di `src/lib/master.ts`; SAK EMKM (`src/lib/akuntansi/sak-emkm.ts`) | `/laporan-keuangan`, `/posisi-keuangan` |
| Migrasi | 0001–0062 di repo; **semua s.d. 0062c sudah diterapkan di produksi** (dicek `list_migrations` 2026-11-02) | — |
| Deploy | Vercel `haluoleofinance` dari `main` (auto); migrasi SQL manual | DEPLOYMENT.md |
| Test | vitest (`src/lib/akuntansi`, `src/lib/cfo`, villa-laporan), uji SQL lokal `supabase/tests/*` | CI `.github/workflows/ci.yml` |

Lini usaha aktif (keputusan owner 2026-11-01): **Loonars 1** (hospitality villa
Yogyakarta, 13 kamar, buka 23 Sep 2026) dan **Loonars 2** (pengembang Loonars
Living 17 unit + Loonars Coffee). Proyek lain (AFP, IH, GCI, GCR, KDI) dikunci.
Entitas legal: **PT Loonars Mahakarya** (nama baru PT Maha Karya Haluoleo).

---

## 3. Sumber data per pos yang diminta

Status: ✅ ada & aktual · 🟡 ada tapi estimasi/standar/parsial · ⛔ belum tercatat di sistem mana pun.

### 3.1 Pendapatan & biaya

| Pos | Sumber saat ini | Status | Catatan |
|---|---|---|---|
| Gross revenue L1 | `laporan_villa_bulanan.omzet_kotor` (villa-api, harian) | ✅ | Diakui per bulan **check-in** (seluruh malam di bulan check-in), bukan per malam menginap — perlu kebijakan pengakuan untuk laporan institusional |
| Discount | — | ⛔ | Grand total Cloudbeds sudah net diskon; voucher/KOL ada di `bookings` tapi nilai diskon tidak dikirim |
| OTA commission | `laporan_villa_bulanan.komisi_ota` + per channel | ✅ | — |
| Net revenue | `pendapatan_bersih` | ✅ | — |
| Penjualan unit L2 | modul `loonars2_*` (uang muka → diakui 31 Des) | ✅ | 2 unit terjual (BANYU-06, AVARA-06) |
| **Penjualan unit villa L1 (A2, A4, A5, B1, B3, C2, C3, DP B2)** | `jurnal` proyek LL akun 4-1001/4-1002 | 🟡 | **Lihat temuan F-1** |
| COGS L1 | `cogs` = standar per malam (listrik kamar, laundry, amenities + alokasi internet/listrik resepsionis/Cloudbeds) | 🟡 | Bukan mutasi aktual |
| Payroll L1 | `opex` = headcount × gaji standar (7 orang × 1,5 jt) | 🟡 | Slip aktual MK Connect cabang "Loonars Private Living" sengaja dikecualikan agar tidak ganda |
| Payroll holding | snapshot `gaji_karyawan` (slip MK Connect) | ✅ | — |
| Electricity & water | standar di COGS; jurnal 6-1003 (LL, Rp 1 jt) | 🟡 | Tagihan PLN/PDAM aktual villa tidak tercatat |
| Laundry | standar di COGS; aktual `villa_pengajuan_biaya` laundry ditransfer Rp 5,17 jt | 🟡 | **Risiko ganda** bila aktual ditambahkan di atas standar (F-4) |
| Maintenance | — | ⛔ | — |
| Marketing & advertising | jurnal 6-1006 (proyek lama) | ⛔ untuk L1/L2 | — |
| Software & technology | Cloudbeds di standar COGS; Netflix dibatalkan | 🟡 | — |
| Administration | — | ⛔ | — |
| Other OPEX | jurnal LL 6-1007 Rp 175,7 jt | 🟡 | Belum dipilah per kategori |
| D&A | `holding.ts` (bangunan LC, 20 th garis lurus) | 🟡 | Hanya LC; tidak ada register aset tetap |
| Interest | ditetapkan 0 (keputusan owner) | ✅ | — |
| Corporate income tax | estimasi `pphBadan()` + PPh final 2,5% | 🟡 | Wajib konfirmasi konsultan pajak |
| Budget | — | ⛔ | `/cfo/anggaran` hanya budget konstruksi L2, bukan budget P&L |

### 3.2 Neraca & arus kas

| Pos | Sumber | Status |
|---|---|---|
| Cash & bank L1 | `cfo_saldo_rekening` (0 baris di produksi) + mutasi villa | ⛔ saldo awal belum pernah dicatat |
| Cash & bank L2 | `loonars2_v_rekening` (A–D) + jurnal LL akun kas | 🟡 hubungan rekening fisik A–D vs akun 1-1004 belum dipastikan |
| OTA receivables | snapshot `ota_settlement` (91 aktif) | ✅ |
| Accounts receivable | sisa tagihan unit L2 (`loonars2_v_unit`) | ✅ |
| Inventory (persediaan barang) | — | ⛔ |
| Prepaid | — | ⛔ |
| Fixed assets / renovation | bangunan LC (snapshot MK Connect); unit L2 dalam pembangunan | 🟡 tidak ada register aset |
| Accumulated depreciation | dihitung `holding.ts` | 🟡 |
| AP | utang toko (`loonars2_v_toko`, snapshot proyek) | ✅ |
| Investor payables | bagi hasil bulan berjalan (laporan villa) | 🟡 tidak ada buku distribusi / pembayaran |
| Bank loans | `utang_bank` (AFP, di luar lingkup) | ✅ (0 untuk Loonars) |
| Other loans | dana talangan owner (rekening C negatif) | ✅ |
| Accrued / tax payables | utang gaji, PBJT, estimasi PPh | 🟡 |
| Paid-in capital | **plug**: ekuitas − laba berjalan | ⛔ tidak ada catatan setoran modal |
| Retained earnings | — | ⛔ |
| Arus kas metode indirect | — | ⛔ (yang ada: forecast kas langsung & arus kas SAK EMKM metode langsung dari jurnal) |

### 3.3 Hospitality KPI

| KPI | Bisa dihitung sekarang? | Sumber |
|---|---|---|
| Occupancy, ADR, RevPAR | Ya, tetapi penyebut salah (F-3) | laporan villa / `ir_metrik_bulanan` |
| GOPPAR | Ya (GOP berbasis biaya standar) | — |
| Revenue per channel, OTA commission ratio, direct ratio | Ya | `rincian.channel` |
| ALOS, lead time, cancellation, repeat guest | **Data ada di villa** (`bookings`: `tgl_checkin`, `created_at`, `durasi_malam`, `status='batal'`, `guest_id`) tetapi **belum dikirim** ke MKH Property | perlu snapshot baru |
| Available room nights per tanggal | **Data ada** (`villa_daily_inventory_snapshot` Sep–Nov 2026, `villa_room_maintenance`) tetapi belum dikirim | perlu snapshot baru |

### 3.4 Investor

| Kelompok yang diminta | Kondisi data |
|---|---|
| Pemegang saham perusahaan | ⛔ tidak ada cap table |
| Kontrak bagi hasil properti (L1: 13 pemilik unit, pool 70% + jaminan) | 🟡 rumus di villa-api (beku); pemilik di `units.owner_*` (svcmyb); tidak ada register kontrak & riwayat pembayaran di MKH Property |
| Pembeli unit L2 (uang muka) | ✅ modul L2 — **ini kontrak penjualan, bukan investor ekuitas** |
| Pemberi pinjaman | Owner (talangan) ✅; lainnya ⛔ |
| Convertible | ⛔ |

---

## 4. Temuan audit

| # | Temuan | Dampak | Usulan |
|---|---|---|---|
| **F-1** | Jurnal proyek **LL** (918 baris, 29 Mei–29 Okt 2026) berisi penjualan unit Loonars **Villa** (A2, A4, A5, B1, B3, C2, C3: 4-1001 total Rp 1,763 M; DP B2 4-1002 Rp 145 jt), HPP konstruksi (5-* Rp 816,7 jt), dan beban 6-* Rp 146,3 jt. _(Koreksi 2026-11-03: versi awal menulis ±Rp 907 jt / Rp 175,7 jt karena query ikut menjumlahkan proyek LC.)_ Laporan holding **tidak** memasukkan P&L jurnal LL, dan menyatakan villa L1 milik investor. | Pendapatan & HPP ±Rp 1,9 M / ±Rp 0,9 M bisa hilang dari laporan konsolidasi — atau, jika dimasukkan naif, tercampur dengan modul Loonars 2 (jurnal LL juga dipakai belanja L2 s.d. Okt). | **Keputusan owner**: apakah penjualan unit villa L1 ke investor = pendapatan PT (developer) yang diakui? Lalu pisahkan jurnal LL menjadi dimensi properti (Loonars 1 development vs Loonars 2) lewat pemetaan, tanpa mengubah baris historis. |
| F-2 | Neraca holding: ekuitas = aset − liabilitas; modal disetor = plug. | Persamaan neraca tidak bisa membuktikan kelengkapan. Tidak layak due diligence. | Buku besar tunggal + saldo awal yang disetujui akuntan (§5). Sampai itu ada, neraca diberi status **Incomplete**. |
| F-3 | `malam_tersedia` = unit × hari, termasuk kamar ditutup maintenance. Okupansi/ADR/RevPAR historis akan ikut berubah bila jumlah unit berubah (dihitung ulang dari `count(units)` saat dikirim ulang). | KPI tidak sesuai definisi yang diminta; periode final bisa berubah. | Snapshot `villa_inventaris_harian` → tabel inventaris historis di MKH Property; bulan final dibekukan. |
| F-4 | COGS & payroll villa = standar; aktual laundry/listrik ada sebagian di pengajuan biaya villa. | Menambahkan aktual di atas standar = **double counting**. | P&L institusional memakai **aktual**; biaya standar tetap disajikan sebagai "dasar bagi hasil investor" (rekonsiliasi standar vs aktual). Rumus bagi hasil **tidak diubah**. |
| F-5 | Tiga jalur pendapatan villa berbeda: `laporan_villa_bulanan` (acuan), `pendapatan_villa` (lama, kotor tanpa potong komisi), `ir_metrik_bulanan`. | Konsolidasi naif = double count. | Tetapkan `laporan_villa_bulanan` sebagai satu-satunya sumber pendapatan L1 (sudah praktik AI CFO); jalur lain hanya pembanding di panel rekonsiliasi. |
| F-6 | Penjurnalan biaya LC: jurnal LC Rp 121,3 jt vs MK Connect Rp 184,4 jt (sudah tercatat di rekonsiliasi AI CFO, belum dijelaskan owner). | Aset tetap LC tidak pasti. | Tetap tampil di Data Quality Warnings sampai dikonfirmasi. |
| F-7 | Jurnal LL: dua nomor B1 (`LL-B1-84135`, `LL-B1-86206`) dan dua closing C3 (`LN-002`, `LN-005`) — baris kredit 4-1001 bernilai 0 pada salah satunya. | Perlu dicek apakah ada entri ganda di sisi debit/akun lain. | Masuk daftar verifikasi; tidak diubah otomatis. |
| F-8 | Angka hardcoded: kas minimum default 50 jt; parameter skenario forecast (`SKENARIO`); kebijakan pajak (`KEBIJAKAN`); `CABANG_GAJI_VILLA`; `TAHUN_AWAL_L2`; COA statis di kode. | Asumsi tidak bisa diedit pengguna; COA tidak bisa ditambah tanpa deploy. | Pindahkan ke tabel pengaturan ber-audit (nilai default sama persis → tidak ada perubahan angka). |
| F-9 | Pengakuan pendapatan villa per bulan check-in. | Booking lintas bulan menggeser pendapatan; tidak sesuai akrual per malam. | Keputusan kebijakan; jika diubah, hanya di laporan institusional — laporan villa & bagi hasil tetap. |
| F-10 | `master.ts` (repo publik) memuat nomor rekening bank proyek. | Paparan data sensitif (sudah ada sebelum audit ini). | Usulkan pindah ke database (CFO-only) — terpisah dari pekerjaan ini, butuh persetujuan. |
| F-11 | RBAC hanya dua tingkat (CFO allowlist vs staf proyek). Tidak ada peran "viewer laporan", "auditor", atau pemisahan akses data investor. | Tidak bisa memberi akses data room terbatas. | Tabel peran keuangan + RLS (§5). |
| F-12 | Tidak ada kunci periode (period close) pada `jurnal`: transaksi bertanggal lampau bisa ditambah setelah laporan dikirim. Arsip `cfo_laporan_bulanan` membekukan ringkasan, bukan buku besar. | Laporan tidak reproducible. | Kunci periode + snapshot laporan ber-hash. |

Yang **sudah benar** dan harus dipertahankan: jurnal seimbang per nomor
(0 nomor tidak seimbang di semua proyek), dedup snapshot (source_id + hash),
`null` untuk data tidak tersedia, audit log append-only, AI tidak menghitung angka.

---

## 5. Desain target

### 5.1 Prinsip

1. **Satu buku besar** (`jurnal`) untuk seluruh angka akuntansi. Modul operasional
   (villa, Loonars 2, MK Connect) tetap menjadi sistem asal; MKH Property
   **menjurnalnya** lewat mesin posting idempoten (`source_system`,
   `source_ref`, `idempotency_key` — kolomnya sudah ada).
2. **Tidak mengubah transaksi historis.** Koreksi = jurnal penyesuaian baru
   dengan alasan + persetujuan. Baris lama tidak di-UPDATE/DELETE.
3. **Dimensi, bukan tabel terpisah**: setiap baris jurnal punya entitas legal
   dan properti (lewat pemetaan untuk data lama, kolom baru nullable untuk data baru).
4. **Status kelengkapan per angka**: `lengkap` / `tidak_lengkap` / `perlu_verifikasi`
   + daftar sumber. Kosong ≠ nol.
5. **Laporan dibekukan per periode** (hash isi + versi data) agar dapat
   direproduksi.
6. **Rumus bagi hasil investor villa tidak disentuh** (aturan "touches money"
   di repo villa). MKH Property hanya mencatat hasil dan pembayarannya.

### 5.2 Skema baru yang diusulkan (semua ADITIF — tidak ada DROP/UPDATE data)

Prefix `fin_` (belum dipakai di project `gluoioiimapyhchdasfl`). Semua RLS aktif,
tulis hanya lewat RPC security definer, audit trigger ke log append-only.

| Tabel | Fungsi |
|---|---|
| `fin_entitas` | Entitas legal (PT Loonars Mahakarya; entitas lain bila ada) |
| `fin_properti` | Master properti: Loonars 1, Loonars 2, Loonars Coffee, berikutnya; entitas, tanggal buka, status (`konstruksi`/`pre_opening`/`operasi`/`tutup`) |
| `fin_akun` | COA di database (kode lama 1-1001…6-1010 disalin **persis**, label sama) + akun baru: piutang OTA, persediaan, biaya dibayar dimuka, akumulasi penyusutan, utang investor, beban akrual, utang pajak, pinjaman lain, OPEX hospitality per kategori (listrik & air, laundry, maintenance, marketing, software, administrasi), D&A, bunga, PPh. Pemetaan akun → baris P&L / neraca / arus kas |
| `fin_jurnal_dimensi` | Pemetaan `jurnal.no` (historis) → entitas, properti, flag antar-entitas — tanpa mengubah tabel `jurnal` |
| *(opsional, butuh persetujuan khusus)* kolom nullable `jurnal.entitas_id`, `jurnal.properti_id` | Untuk transaksi baru; alternatif: tetap lewat `fin_jurnal_dimensi` |
| `fin_posting_log` | Jejak mesin posting: sumber → no jurnal, hash sumber, versi aturan |
| `fin_periode` | Status periode per entitas (`buka`/`ditutup`), ditutup oleh/kapan; trigger menolak jurnal baru bertanggal di periode tertutup (kecuali jurnal penyesuaian ber-approval) |
| `fin_laporan_beku` | Laporan final per periode (jsonb + hash + versi mesin) — reproducibility |
| `fin_inventaris_kamar` | Inventaris historis per properti per tanggal: kamar siap jual, ditutup maintenance, belum buka (dari snapshot villa) |
| `fin_anggaran` (+ versi) | Budget per entitas/properti/akun/bulan |
| `fin_aset_tetap` | Register aset tetap & renovasi: biaya, tanggal siap pakai, umur, metode |
| `fin_investor`, `fin_instrumen`, `fin_kepemilikan`, `fin_distribusi`, `fin_mutasi_modal` | Investor register dipisah per jenis instrumen: `saham`, `bagi_hasil_properti`, `pinjaman`, `convertible`; kontrak (referensi dokumen, ketentuan jsonb), distribusi terhitung vs dibayar, outstanding |
| `fin_penyesuaian_ebitda` | Normalized EBITDA: kategori, nominal, bukti (no jurnal/berkas), alasan, diajukan/disetujui oleh, status — append-only; tidak mengubah reported EBITDA |
| `fin_asumsi_forecast` | Asumsi 3 skenario × 12/24/36 bulan, ber-versi, dapat diedit |
| `fin_peran` | Peran keuangan per email: `owner`, `cfo`, `finance_staff`, `viewer_laporan`, `investor_relations`, `auditor`; fungsi `fin_boleh(aksi)` dipakai RLS dan `src/lib/auth.ts` (CFO allowlist lama tetap berlaku sebagai `owner`) |

Snapshot baru dari svcmyb (Mkhsistem/villa, pola `cfo_sumber_terima` yang sama):
`villa_inventaris_harian`, `villa_booking_kpi` (agregat tanpa data pribadi:
lead time, ALOS, batal, tamu berulang via hash guest_id), `villa_biaya_aktual`
(pengajuan biaya villa ditransfer per kategori), `villa_pemilik_unit` (tanpa
nomor rekening).

### 5.3 Lapisan aplikasi

`src/lib/keuangan/` (baru, fungsi murni, diuji vitest) — memakai ulang
`src/lib/cfo/util.ts` dan pola `BarisLr` (null = tidak tersedia):

- `laba-rugi.ts` — struktur P&L yang diminta; kolom aktual / bulan lalu / budget;
  per properti & konsolidasi; tiap baris membawa `status` + `sumber[]`.
- `neraca.ts` — dari saldo kumulatif jurnal per akun; cek A = L + E **independen**
  (ekuitas dari akun ekuitas, bukan plug); status Incomplete bila ada pos ⛔.
- `arus-kas-indirect.ts` — laba bersih + D&A ± perubahan modal kerja (dari
  neraca dua tanggal) + investasi + pendanaan; rekonsiliasi kas akhir vs saldo
  akun kas.
- `unit-economics.ts` — KPI hospitality dengan penyebut dari `fin_inventaris_kamar`.
- `properti.ts`, `konsolidasi.ts` (eliminasi antar-entitas/antar-properti dari
  flag `fin_jurnal_dimensi`), `investor.ts`, `ebitda-normal.ts`,
  `proyeksi.ts` (12/24/36 bln × 3 skenario, break-even, kebutuhan dana),
  `kesiapan-pe.ts` (indikator kelengkapan — **tanpa skor "siap investasi"**).
- `posting/` — aturan posting per sumber (versi), idempoten.
- Ekspor: PDF (`@react-pdf/renderer`, pola `src/lib/cfo/pdf.tsx`) dan Excel
  (**butuh dependensi baru**, mis. `exceljs` — perlu persetujuan; alternatif
  tanpa dependensi: CSV per laporan, `src/lib/ekspor.ts` sudah ada).

Halaman baru di grup sidebar "AI CFO" → sub-bagian "Laporan Institusional":
`/cfo/keuangan/laba-rugi`, `/neraca`, `/arus-kas`, `/unit-economics`,
`/properti`, `/investor`, `/ebitda`, `/konsolidasi`, `/proyeksi`, `/kesiapan-pe`,
`/data-room`. Filter bersama: rentang tanggal, properti, entitas legal,
bulanan/kuartalan/tahunan, aktual/budget/forecast. Komponen `src/components/cfo/Ui.tsx`
dipakai ulang agar desain konsisten. **Halaman lama tidak dihapus atau diubah
perilakunya.**

---

## 6. Rencana bertahap

Setiap tahap: migrasi (bila perlu) + backend + frontend + validasi + tes
(vitest + uji SQL lokal Postgres 16 seperti `supabase/tests/`) + dokumentasi
(CURRENT_STATE, CHANGELOG, DATABASE). Satu PR per tahap. Migrasi diterapkan ke
produksi **hanya setelah persetujuan owner**, dalam bagian kecil, diverifikasi.

| Tahap | Isi | Migrasi | Ketergantungan |
|---|---|---|---|
| 1 | Audit (dokumen ini) | — | — |
| 2a | Struktur data: `fin_entitas`, `fin_properti`, `fin_akun` (COA lama disalin + akun baru), `fin_jurnal_dimensi` + pemetaan historis (draft, CFO menyetujui per baris), `fin_peran`, `fin_periode`, `fin_laporan_beku` | 0063 | Keputusan D-1…D-4 |
| 2b | Mesin posting (villa bulanan, L2 module, gaji, settlement OTA) ke `jurnal` dengan `source_system` baru; mode **pratinjau** dulu (tidak menulis) sampai owner setuju | 0064 | 2a, D-1, D-5 |
| 2c | Snapshot baru dari villa (inventaris, KPI booking, biaya aktual) | 0065 + Mkhsistem | koordinasi svcmyb |
| 3 | P&L, Neraca, Arus Kas (indirect) + budget | 0066 (`fin_anggaran`, `fin_aset_tetap`) | 2a–2b |
| 4 | Unit economics + inventaris historis | — | 2c |
| 5 | Investor reporting: skema 70% dari profit + distribusi bulanan terhitung (D-6, tanpa register investor) | — | D-6 ✅ |
| 6 | Konsolidasi + eliminasi + EBITDA normalisasi | 0068 | 3, 5 |
| 7 | Proyeksi 12/24/36 + PE readiness | 0069 | 3–6 |
| 8 | Ekspor PDF/Excel/data room | — | 3–7, D-7 |

**Tahap 2a disiapkan 2026-11-10** sebagai migrasi `0069_fin_buku_besar_tahap_2a.sql` (nomor 0063–0068 terpakai modul Loonars 2): tanpa `fin_saldo_awal` — saldo awal per tanggal penetapan (D-4) dan posting (2b) menyusul. Lihat CHANGELOG.

**Sudah dibangun 2026-11-02 (tanpa perubahan skema):** `/cfo/laba-rugi`,
`/cfo/unit-economics`, `/cfo/kualitas-data` — lihat CURRENT_STATE.md. Ruang lingkupnya: kerangka P&L institusional per baris dengan status
"belum tercatat" eksplisit dari sumber yang sudah ada, KPI channel/OTA ratio,
dan panel Data Quality Warnings yang memuat F-1…F-12.

---

## 7. Keputusan yang dibutuhkan dari owner (memblokir Tahap 2)

- **D-1 (F-1).** Penjualan unit Loonars Villa (L1) ke investor yang ada di jurnal LL
  (±Rp 1,9 M): pendapatan PT (developer) yang diakui di laporan, atau dana
  investor/titipan? Dan sejak kapan jurnal LL berisi belanja Loonars 2?
- **D-2.** Setujui arsitektur "satu buku besar `jurnal` + mesin posting" (perubahan
  arsitektur & skema). Tambah kolom nullable ke `jurnal`, atau cukup tabel
  pemetaan `fin_jurnal_dimensi`?
- **D-3.** Daftar entitas legal: hanya PT Loonars Mahakarya, atau ada entitas lain
  (mis. badan terpisah untuk Loonars 2 / pemilik unit)?
- **D-4.** Saldo awal neraca (modal disetor, saldo laba, rekening bank per tanggal)
  — dari akuntan, atau ditetapkan owner per tanggal tertentu?
- **D-5.** Biaya villa di laporan institusional: aktual (butuh pencatatan tagihan
  listrik/air/laundry/maintenance riil) dengan standar hanya sebagai dasar bagi
  hasil — setuju?
- **D-6.** Siapa saja investor per jenis (saham / bagi hasil properti / pinjaman /
  convertible) dan dokumen perjanjiannya — data ini belum ada di sistem mana pun.
- **D-7.** Boleh menambah dependensi Excel (`exceljs`) atau cukup CSV?
- **D-8.** Kebijakan pengakuan pendapatan kamar untuk laporan institusional: per
  malam menginap (akrual) atau tetap per bulan check-in seperti laporan villa?

---

## 8. Keputusan owner (2026-11-03)

| # | Keputusan | Akibat |
|---|---|---|
| D-1 | Penjualan unit villa Loonars 1 ke investor = **pendapatan PT** | Jurnal proyek LL (pembangunan & penjualan villa L1, Mei–Okt 2026 — diverifikasi tidak memuat belanja Loonars 2) dipetakan ke kolom Loonars 1 di Laporan Holding & P&L institusional: penjualan Rp 1,908 M, HPP Rp 816,7 jt, beban proyek Rp 146,3 jt, PPh final 2,5% Rp 47,7 jt (2026). Neraca: kas/piutang/utang buku besar LL di kolom L1. `src/lib/cfo/pengembangan-l1.ts`. |
| D-2 | Buku besar tunggal, dimensi lewat **tabel pemetaan** (tabel `jurnal` tidak diubah) | Tahap 2a. |
| D-3 | **Satu badan hukum** (PT Loonars Mahakarya); L1, L2, LC = properti/lini | Konsolidasi = gabungan properti; eliminasi hanya antarproperti. |
| D-4 | Saldo awal = **saldo yang ada di data per tanggal penetapan** | Pos yang belum pernah dicatat (mis. saldo rekening villa) tetap "tidak tersedia", tidak diisi nol. |
| D-5 | Laporan tetap memakai **biaya standar** villa | Ditandai estimasi; Data Quality mengingatkan sebelum due diligence PE. |
| D-6 | **Tidak perlu register investor.** Investor reporting cukup menyebut skema: investor menerima **70% dari profit** | Modul Investor Reporting disederhanakan: skema 70% + distribusi bulanan terhitung (laporan villa). Tanpa tabel investor/kontrak/riwayat pembayaran; pemisahan 4 jenis investor tidak dibangun. |
| D-7 | Boleh tambah **exceljs** | Tahap 8. |
| D-8 | Pendapatan kamar diakui **per malam menginap** (laporan institusional saja) | Butuh kiriman pendapatan per malam dari villa (Tahap 2c, lewat snapshot MK Connect); laporan villa & bagi hasil tidak berubah. |

Temuan baru dari pemeriksaan D-1 (data produksi, read-only):
- **F-13** Sistem villa: 8 unit lunas (A2, A4, A5, B1, B2, B3, C2, C3), 5 belum terjual (A1, A3, B4, C1, C4). Jurnal LL: B1 terjual dengan nilai Rp 0; B2 baru DP Rp 145 jt.
- **F-14** Bagi hasil villa dihitung untuk 13 unit; bila 5 unit belum terjual milik PT, beban bagi hasil di laporan lebih besar dari yang dibayar ke investor. Rumus villa tidak diubah.
- **F-15** Buku besar LL: akun bank 1-1004 bersaldo −Rp 421,4 jt (tidak mungkin untuk rekening nyata); total kas buku LL Rp 805,3 jt perlu dicocokkan dengan rekening koran. Piutang antar proyek Rp 124,4 jt ke proyek arsip.
