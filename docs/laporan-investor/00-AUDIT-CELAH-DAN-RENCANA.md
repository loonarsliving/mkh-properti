# Laporan Investor — Tahap 0: Audit, Celah, dan Rencana

_Disusun 2026-10-10. Branch: `claude/laporan-investor-audit-k7m2qa`._
_Status: **menunggu keputusan owner** (lihat bagian 8). Belum ada kode, skema,
atau migrasi yang dibuat atau diterapkan._

Dokumen ini hanya memuat **agregat**. Tidak ada nama karyawan, nama tamu,
nomor HP, rekening, atau KTP yang dikutip.

---

## 1. Ringkasan temuan utama

1. **Gaji tidak pernah masuk buku besar mkh-properti.** Jalur sinkronisasi gaji
   (`payroll_salary_generated`, `bonus_approved`, `reimbursement_approved`,
   `hr_expense_approved`, `payroll_run_approved`) ada di kode kedua sisi,
   tetapi **belum pernah mengirim satu event pun**. Di produksi:
   `payroll_runs` = 0, `payroll_items` = 0; di mkh-properti akun `6-1001 Gaji
   Staf` = 0 baris, `pengajuan` bertipe gaji/bonus/reimbursement/hr_lain = 0.
   Gaji sebenarnya dicatat lewat jalur lain di Mkhsistem
   (`employee_salary_submissions`, migrasi 0189) yang **tidak tersambung ke
   sync** sama sekali. Asumsi brief ("total gaji diambil dari jurnal hasil sync
   Mkhsistem yang sudah berjalan") **tidak terpenuhi oleh data nyata**.
2. **Cabang "Loonars Private Living" belum punya data gaji sama sekali**, dan
   data karyawannya baru terisi 2–10 Okt 2026 (7 baris: 4 aktif-disetujui, 3
   masih `pending`). Divisi Housekeeping tidak ada di master divisi; divisi
   "Head of Loonars Villa" ada tetapi berisi 0 orang.
3. **Pendapatan villa September tidak sebanding dengan Oktober.** Angka rental
   September yang sudah tersinkron ke `pendapatan_villa`
   (Rp21.678.356,95) memakai **harga kotor** (Grand Total Cloudbeds, termasuk
   fee OTA), karena perbaikan `villa_commit_checkin` ke `cloudbeds_subtotal`
   baru berlaku 5 Okt 2026. Dengan definisi Oktober, September menjadi
   Rp20.192.263 (selisih Rp1.486.093,95). Track record harus memuat dua versi
   ini secara terbuka, bukan dihaluskan.
4. **Villa sudah beroperasi sebelum 30 Sep 2026.** Ada 22 booking September
   yang diakui (check-in/check-out) dan 1 booking walk-in Agustus. Snapshot
   inventaris harian ada sejak 4 Sep 2026. Laporan sebaiknya mulai dari data
   pertama yang ada, bukan dari 30 Sep, atau owner menetapkan tanggal mulai
   resmi secara eksplisit (keputusan K1).
5. **Biaya operasional aktual villa tidak tercatat di mana pun.**
   `opex_bulanan` = 0 baris (villa), `beban_villa` = 0 baris (mkh-properti).
   Yang ada hanya asumsi persentase beku (opex 25%, marketing 27,5% dari
   gross) untuk rumus dividen — itu **bukan biaya aktual** dan tidak boleh
   ditampilkan sebagai biaya aktual.
6. **Penyebut okupansi "unit dijual" tidak bisa direkonstruksi untuk masa
   lalu.** Snapshot inventaris harian selalu mencatat 13 unit dan tidak
   menyimpan status "ditutup di Cloudbeds". Okupansi atas unit total bisa
   dihitung; atas unit dijual hanya bisa mulai saat villa menyimpan data itu
   per hari.
7. **Kewajiban investor, kas, dan utang villa belum ada di mkh-properti.** Satu
   kontrak "pemasukan tetap" Rp7,6 jt/bulan (Sep 2026–Sep 2031) dan jaminan
   minimum Rp5 jt/unit hanya ada di sistem villa. Utang bank satu-satunya di
   mkh-properti (kredit konstruksi BTN, proyek AFP) bukan milik operasi villa.
8. **Keamanan tabel keuangan inti masih terbuka.** Migrasi `0025` (RLS) belum
   diterapkan: `jurnal`, `aset`, `utang_bank`, `pendapatan_villa` masih bisa
   dibaca **dan diubah** oleh role `anon` (kunci anon ada di kode klien).
   Modul ini tidak boleh mengikuti pola itu — lihat bagian 6.

---

## 2. Metode dan batasan

- Kode dibaca dari: `mkh-properti` (`main` @ `ab83506`), `Mkhsistem`
  (`claude/mk-connect-app-o9zw2p` @ `1e8356d`, migrasi 0002/0003/0055/0056/0189),
  `villa` (`main` @ `9ccd139`).
- **Perilaku villa-api diverifikasi dari kode yang ter-deploy** (Supabase MCP
  `get_edge_function`, versi 125), bukan dari salinan repo: `computeReport`,
  `computeWalkinIncome`, `isPemasukanDiakui`, `pendapatanKotor/Bersih`,
  `computeNetRevenueForRange`, `computeOccupiedRoomNights`,
  `/cron/sync-mkh-income`. Fungsi DB `villa_commit_checkin` dibaca langsung
  dari `pg_proc`.
- Data nyata dibaca **hanya-baca** (`select`) dari kedua proyek Supabase
  (`gluoioiimapyhchdasfl` dan `svcmybsziaelwwdrnzcv`). Tidak ada penulisan.
- Query hanya mengambil agregat (count/sum/min/max). Tidak ada data pribadi
  yang dikutip di dokumen ini.

---

## 3. Jawaban pertanyaan audit

### a. Apakah `employees` cabang Loonars terisi dan akurat?

**Sebagian, dan belum akurat untuk track record.**

| Divisi | Aktif & disetujui | Pending / nonaktif | `join_date` |
|---|---:|---:|---|
| Front Office | 1 | 2 | 2–9 Okt 2026 |
| Security | 3 | 1 | 2–10 Okt 2026 |
| Housekeeping | — | — | divisi **tidak ada** di master `divisions` |
| Manajemen ("Head of Loonars Villa") | 0 | 0 | — |

- Semua `position_id` kosong.
- Semua `join_date` jatuh di Oktober, padahal villa sudah melayani tamu sejak
  September. Kemungkinan besar `join_date` = tanggal pendaftaran akun, bukan
  tanggal mulai kerja. **Headcount September tidak bisa direkonstruksi** dari
  data ini → harus ditulis "data belum tersedia".
- Pembanding yang tidak konsisten: `finance_property_config` villa
  (`loonars-1`) memakai asumsi **5 karyawan × Rp1.500.000**, sementara
  Mkhsistem mencatat 7 baris karyawan. Asumsi Rp1,5 jt itu juga di bawah UMK
  Sleman 2026. Ini parameter skenario di halaman Finance villa, bukan gaji
  aktual — tetapi menunjukkan sumber yang berbeda memberi angka berbeda.

### b. Apakah `payroll_runs`/`payroll_items` dipakai untuk karyawan Loonars?

**Tidak, untuk cabang mana pun.** `payroll_runs` = 0 dan `payroll_items` = 0
di produksi. Gaji dicatat lewat `employee_salary_submissions` (input Kepala
Cabang, migrasi 0189): 34 baris, periode Agu–Okt 2026, cabang Jogja,
Makassar, dan Management Property — **0 baris untuk Loonars Private Living**.
Jalur 0189 tidak menulis `sync_log`, jadi tidak ada yang sampai ke
mkh-properti.

Total gaji di `employee_salary_submissions` Agu–Okt 2026 ≈ **Rp200,6 juta**
(semua cabang) — dan **tidak ada pasangannya di buku besar** dengan label
gaji. Apakah sebagian dibukukan manual di akun lain (mis. `6-1007 Beban
Lain-lain`) tidak dapat dipastikan dari data: **UNKNOWN**.

Untuk gaji karyawan villa sendiri: **dibayar di luar sistem, atau belum
dicatat** — tidak ada di Mkhsistem, tidak ada di mkh-properti, `villa_staff`
di sistem villa juga 0 baris. Opsi penanganan ada di bagian 8 (K3).

### c. Inkonsistensi gaji dan gaji di bawah UMK Sleman 2026 (Rp2.624.387)

- Untuk cabang Loonars: **tidak bisa diperiksa** — tidak ada data gaji.
- Di cabang lain, 12 dari 34 entri `employee_salary_submissions` bernilai di
  bawah Rp2.624.387. Catatan agar tidak salah tafsir:
  - UMK Sleman hanya berlaku untuk pekerja yang bekerja di Sleman. Cabang Jogja
    dan Makassar tunduk pada UMK wilayah masing-masing; perbandingan di sini
    hanya karena diminta, bukan kesimpulan pelanggaran.
  - Sebagian nominal tampak prorata (bulan tidak penuh), mis. ada entri di
    bawah Rp700 ribu.
  - Status kerja (penuh waktu / paruh waktu / magang) tidak tercatat di entri
    gaji, jadi kepatuhan tidak bisa dinilai dari data ini.
- Inkonsistensi antar tabel: employees ↔ payroll ↔ jurnal tidak bisa
  dibandingkan karena payroll dan jurnal gaji sama-sama kosong. Satu entri
  gaji dicatat atas cabang "Management Property" untuk karyawan yang kini
  terdaftar di cabang Jogja (cabang pada entri = cabang saat diinput, bukan
  cabang karyawan sekarang). Agregasi per cabang harus memilih salah satu
  definisi secara eksplisit.
- Parameter asumsi villa (5 × Rp1,5 jt) berbeda dengan Mkhsistem (7 orang,
  gaji belum ada) — dilaporkan apa adanya.

### d. Event yang sudah ada dan yang perlu ditambah

**Sudah mengalir nyata (dari `sync_log` mkh-properti):**

| Arah (dilihat dari mkh-properti) | Event | Jumlah sukses |
|---|---|---:|
| masuk dari Mkhsistem | `construction_expense_submitted` | 72 |
| masuk | `construction_project_financial_record` | 14 |
| masuk | `construction_fund_transfer_recorded` | 3 |
| masuk | `finance_expense_transfer_confirmed` | 187 |
| masuk | `material_expense_receipt_submitted` | 63 |
| masuk | `tukang_borongan_sisa_upsert` | 5 |
| masuk | `loonars_fee_requested`, `loonars_closing_verified` | 10 |
| masuk dari villa | `villa_income_reported` | **1** (periode 2026-09, 1 Okt) |
| keluar ke Mkhsistem | `finance_expense_submitted/approved/rejected`, `finance_branch_balance_updated`, `loonars_*` | ±1.170 |

**Ada di kode, belum pernah terjadi:** `payroll_salary_generated`,
`payroll_run_approved`, `bonus_approved`, `reimbursement_approved`,
`hr_expense_approved`, `crm_payment_approved`, `sales_commission_approved`.
(`hr_expenses` Mkhsistem: 3 baris, semuanya masih `pending`.)

Catatan privasi: event `payroll_salary_generated` yang ada di kode membawa
**nama, kode karyawan, dan gaji per orang** ke `pengajuan.data`. Kalau suatu
saat jalur itu dipakai, data individu akan tersimpan di mkh-properti — modul
laporan investor tetap hanya boleh membaca agregatnya.

**Perlu ditambah (spesifikasi di Tahap 2, tidak dikerjakan di sesi ini):**

1. **Villa → mkh-properti: `villa_kpi_snapshot` bulanan** — RPC penerima baru
   dengan pola `villa_income_sync` (Vault secret sendiri, header khusus,
   idempotent per properti-periode-versi). Villa menghitungnya dengan fungsi
   villa-api yang sudah ada, tidak diimplementasi ulang.
2. **Villa: simpan status "dijual/ditutup" per unit per hari** di
   `villa_daily_inventory_snapshot` (atau tabel pendamping). Tanpa ini,
   okupansi atas unit dijual tidak pernah bisa dilaporkan mundur.
3. **Mkhsistem → mkh-properti: `hr_headcount_monthly_snapshot`** — agregat
   per cabang × divisi (aktif, masuk, keluar). Tanpa nama, tanpa gaji
   individu. Tidak ada event setara yang sudah ada.
4. **Mkhsistem → mkh-properti: agregat gaji per cabang per bulan** dari
   `employee_salary_submissions` (jumlah penerima, total, status transfer) —
   hanya jika owner memilih opsi K3-A/B.

### e. Data yang sudah ada dan belum ada di mkh-properti

| Data | Status di produksi | Catatan |
|---|---|---|
| `jurnal` | 1.100 baris; proyek AFP, GCI, IH, KDI, LL | Tidak ada jurnal untuk **operasi** villa. "LL" adalah proyek pengembangan/penjualan Loonars Living, bukan operasi sewa. |
| `pendapatan_villa` | 4 baris, hanya 2026-09, `sumber=villa_api` | Sinkron otomatis terbukti jalan (1 Okt). Lihat temuan 3 soal definisi. |
| `beban_villa` | 0 baris | Biaya villa belum diisi. |
| Laba rugi / posisi keuangan | Dihitung di klien dari `jurnal` (`src/lib/akuntansi/sak-emkm.ts`) | Tingkat perusahaan/proyek. Tidak ada segmen "operasi villa". |
| `utang_bank` | 1 baris (AFP, kredit konstruksi) | Bukan milik operasi villa. |
| `aset` | 33 baris (unit/kavling proyek) | Relevan untuk bisnis pengembang, bukan operasi villa. |
| `karyawan`, `slip_gaji` | 0 baris | Tabel lama, tidak dipakai. |
| `mkh_projects` | 0 baris | Daftar proyek di-hardcode di `src/lib/master.ts`. |
| Kas per properti villa | Tidak ada | Kas operasi villa tidak dibukukan di sini. |
| Kewajiban investor unit | Tidak ada | Hanya ada di villa (`villa_investor_terms`, rumus jaminan). |
| Headcount, okupansi, ADR, RevPAR, channel | Tidak ada | Harus didorong sebagai snapshot. |

---

## 4. Inkonsistensi data antar sistem (dilaporkan apa adanya)

| # | Temuan | Dampak ke laporan |
|---|---|---|
| I-1 | Pendapatan rental Sep 2026 = harga kotor (incl. fee OTA); Okt 2026 dan seterusnya = `cloudbeds_subtotal` untuk booking OTA. | Tampilkan September dengan dua angka berlabel, atau koreksi lewat snapshot versi baru dengan catatan perubahan definisi. Tidak boleh menimpa diam-diam. |
| I-2 | `transactions.periode_bulan` (sumber gross investor) = bulan **saat tombol check-in ditekan** (`now()`), sedangkan `isPemasukanDiakui` = berdasarkan `tgl_checkin` + status. | Bisa berbeda di batas bulan (check-in larut malam, check-in terlambat diklik). Snapshot harus mencatat basis mana yang dipakai per metrik. |
| I-3 | Tiga angka pendapatan villa yang sah tapi berbeda: (1) kotor = Grand Total Cloudbeds; (2) basis investor = `transactions` (subtotal sejak 5 Okt); (3) bersih finance = subtotal − komisi per channel (`finance_ota_settlement_config`). | Kontrak KPI menyimpan ketiganya dengan nama berbeda; tidak pernah dicampur. |
| I-4 | Headcount: villa berasumsi 5 orang, Mkhsistem 7 baris (4 aktif-disetujui). | Laporan memakai Mkhsistem dan mencantumkan selisihnya di lampiran. |
| I-5 | Gaji ±Rp200,6 jt (Agu–Okt, cabang lain) ada di Mkhsistem, tidak ada di jurnal. | Rasio gaji/pendapatan untuk properti mana pun tidak bisa dihitung dari buku besar saat ini. |
| I-6 | Drift skema: produksi mkh-properti punya migrasi `construction_project_financial_records` yang tidak ada di folder migrasi repo; `0025` ada di repo tapi tidak di produksi; nomor `0025` dipakai dua berkas. | Migrasi baru modul ini mulai dari `0036`; nama dicek terhadap produksi sebelum dibuat. |
| I-7 | Narasi "asset-light": jurnal LL memuat penjualan unit villa (mis. "Penjualan Villa") dan AFP punya kredit konstruksi Rp1,49 M. MKH juga berbisnis sebagai pengembang. | Laporan perlu menyatakan cakupannya: **segmen operasi properti** saja, atau gabungan perusahaan. Kalau gabungan, bisnis pengembang wajib disebut, tidak disembunyikan (keputusan K2). |

---

## 5. Matriks ketersediaan KPI (per properti-bulan)

Legenda: ✅ ada & bisa dipakai · 🟡 ada sebagian / perlu label · ❌ belum ada.

| Metrik kontrak | Sumber yang direncanakan | Status hari ini |
|---|---|---|
| Pendapatan kotor (Grand Total) | snapshot villa | 🟡 bisa dihitung villa dari `bookings` |
| Pendapatan basis investor | snapshot villa (`computeReport.gross_revenue`) | 🟡 ada untuk Sep (definisi lama) |
| Pendapatan bersih finance | snapshot villa (`pendapatanBersih`) | 🟡 bisa dihitung; komisi per channel sebagian masih 0 = "belum diketahui" |
| Pendapatan walk-in (cafe/spa/lainnya) | `pendapatan_villa` | ✅ Sep |
| Okupansi atas unit total | snapshot villa (`villa_daily_inventory_snapshot`) | ✅ sejak 4 Sep |
| Okupansi atas unit dijual | snapshot villa | ❌ status "ditutup" harian tidak disimpan |
| ADR, RevPAR | snapshot villa | 🟡 bisa dihitung; label kotor/bersih wajib |
| Porsi channel OTA vs langsung | snapshot villa (`bookings.sumber`) | ✅ (Sep: 100% OTA) |
| Jumlah booking (diakui, batal) | snapshot villa | ✅ |
| Headcount per divisi | event Mkhsistem baru | ❌ belum ada event; data sumber baru mulai Okt |
| Total gaji | buku besar / agregat Mkhsistem | ❌ (lihat K3) |
| Gaji % pendapatan, unit per karyawan | dihitung di mkh-properti dari metrik di atas | ❌ menunggu gaji & headcount |
| Biaya operasional aktual | `beban_villa` / jurnal | ❌ belum diisi |
| Kewajiban tetap ke investor unit | snapshot villa (kontrak tetap + jaminan) | ❌ belum didorong |
| Laba operasional | dihitung dari metrik di atas | ❌ menunggu biaya |
| Kas, utang | mkh-properti | 🟡 ada tingkat perusahaan, tidak per properti villa |

---

## 6. Rencana teknis (garis besar — detail di Tahap 1)

### 6.1 Skema (usulan, belum dibuat)

Nama tabel diberi awalan `ir_` (investor report) karena di proyek ini sudah
ada `branches`, `projects`, dan `kos_properties` milik aplikasi lain —
`properties` polos berisiko membingungkan atau bertabrakan.

- `ir_properti` — kolom sesuai brief: nama, kota, tgl_mulai_operasi,
  jumlah_unit_total, jumlah_unit_dijual (default; nilai per bulan tetap dari
  snapshot), model_kepemilikan (`milik_sendiri|sewa|kontrak_manajemen`),
  sumber_data (kode adapter), aktif. Plus `kode` unik (mis. `loonars-1`) agar
  cocok dengan `finance_property_config.property_code` di villa.
- `ir_kpi_snapshot` — property_id, periode (`YYYY-MM`), metrik (jsonb sesuai
  kontrak), versi_definisi, versi (1, 2, …), status (`draft|final`),
  dihitung_pada, sumber, idempotency_key, catatan_koreksi. **Append-only**:
  trigger menolak `update`/`delete`; koreksi = baris versi baru. View
  `ir_kpi_terkini` memilih versi tertinggi per properti-periode-sumber.
- `ir_kpi_snapshot_log` — log setiap penerimaan/penolakan/koreksi.
- `ir_narasi` — narasi manual (strategi, risiko, dll.) berversi, append-only.
- `ir_unduhan_log` — siapa, kapan, properti, rentang, bagian, hash PDF.
  PDF sendiri **tidak disimpan** di mana pun.
- RPC penerima `ir_kpi_snapshot_terima(...)` mengikuti pola
  `villa_income_sync` (Vault secret per sumber, idempotent, tercatat di
  `sync_log`). Tidak menyentuh `sync_inbound` (infrastruktur bersama yang
  rawan).

Gaji & biaya HR **tidak** disimpan di snapshot jika buku besar sudah
memilikinya (aturan "jangan hitung ganda"); laporan membaca jurnal untuk itu.
Karena saat ini jurnal gaji kosong, sumbernya bergantung keputusan K3.

### 6.2 Adapter properti baru

Kode modul hanya mengenal kontrak KPI dan `ir_properti.sumber_data`. Properti
baru = satu baris `ir_properti` + satu sumber yang mendorong snapshot sesuai
kontrak (bisa sistem lain, bisa form input manual CFO dengan status `draft`).
Tidak ada string "Loonars" di kode modul; nama properti berasal dari data.

### 6.3 Keamanan

- Semua tabel `ir_*`: RLS aktif, **tanpa** policy untuk `anon`; akses baca
  hanya `authenticated` yang emailnya (`auth.jwt()->>'email'`) ada di
  `cfo_users`. Tulis hanya lewat RPC `security definer`.
- Konsekuensi: halaman dan pembuat PDF harus mengirim **access token
  pengguna**, bukan anon key (berbeda dari pola halaman lain saat ini). Ini
  hanya untuk modul baru; tabel lama tidak diubah.
- PDF dibuat di **Route Handler Next.js (server)** yang memverifikasi token,
  mengecek `cfo_users`, membaca data dengan token yang sama (tanpa
  service-role key), mencatat unduhan, lalu mengalirkan PDF. Ini **lapisan
  server pertama** di aplikasi yang selama ini murni klien → perlu persetujuan
  (K6).
- Tidak ada kolom data pribadi di skema `ir_*`.

### 6.4 Library PDF (evaluasi awal)

| Opsi | Jalan di Vercel serverless tanpa Chromium | Tata letak & grafik | Catatan |
|---|---|---|---|
| **`@react-pdf/renderer` v4** | Ya (Node runtime) | Komponen React, flexbox, primitif `<Svg>`/`<Path>`/`<Line>` untuk grafik | Cocok dengan stack React 19; satu-satunya dependensi baru. **Usulan.** |
| `pdfkit` | Ya | Imperatif, koordinat manual | Lebih rendah level, kode laporan jauh lebih panjang. |
| `pdf-lib` | Ya | Tanpa mesin tata letak | Cocok untuk mengisi/menggabung PDF, bukan menyusun laporan. |
| Puppeteer + Chromium | Tidak memenuhi syarat | — | Dikecualikan oleh brief. |

Grafik tren digambar sebagai SVG dari angka snapshot di server (tanpa library
grafik tambahan). Font bawaan Helvetica cukup untuk Bahasa Indonesia; jika
ingin font merek, berkas font disertakan di repo (bukan dari CDN saat render).

---

## 7. Rencana tahapan berikutnya

| Tahap | Isi | Menyentuh produksi? |
|---|---|---|
| 1 | Berkas migrasi `0036_…` (tabel `ir_*`, RLS, trigger append-only, RPC penerima) + uji di **Supabase branch** atau transaksi yang di-rollback dengan data contoh. | Tidak. Berkas ditampilkan untuk disetujui; **tidak di-apply**. |
| 2 | Dokumen spesifikasi untuk villa (snapshot KPI + status unit dijual harian) dan Mkhsistem (event headcount bulanan, opsional agregat gaji). | Tidak (dokumen saja). |
| 3 | Halaman `(app)/laporan-investor`: pilih properti/gabungan, rentang, bagian, pratinjau, indikator kelengkapan, narasi berversi. | Tidak sampai migrasi disetujui & di-apply. |
| 4 | Route Handler PDF (`@react-pdf/renderer`), log unduhan. | Sama. |
| 5 | Uji tambah properti ujung-ke-ujung dengan properti uji (di branch DB, bukan produksi). | Tidak. |

---

## 8. Keputusan yang dibutuhkan dari owner

- **K1 — Tanggal mulai track record.** Data booking ada sejak Sep 2026 (1
  booking Agustus). Mulai laporan dari bulan pertama yang ada datanya, atau
  tetap 30 Sep 2026 (September dianggap pra-operasi)?
- **K2 — Cakupan laporan.** Hanya segmen operasi properti (asset-light),
  atau gabungan perusahaan termasuk bisnis pengembang (penjualan unit, kredit
  konstruksi)? Rekomendasi: segmen operasi sebagai isi utama, dengan
  pengungkapan singkat bahwa MKH juga berbisnis sebagai pengembang.
- **K3 — Celah gaji.** Pilih salah satu:
  - **A.** Mkhsistem mengirim agregat gaji bulanan per cabang dari
    `employee_salary_submissions` → disimpan sebagai metrik berlabel "di luar
    buku besar". Paling cepat.
  - **B.** Gaji dibukukan ke jurnal `6-1001` (via sync saat transfer
    ditandai) sehingga buku besar menjadi sumber kebenaran. Paling benar
    secara akuntansi, tetapi **menyentuh uang** dan perlu keputusan akun.
  - **C.** CFO menginput total gaji per properti-bulan secara manual di
    mkh-properti (status `draft` sampai difinalkan).
  - **D.** Biarkan "data belum tersedia" sampai sistem gaji villa berjalan.
  - Rekomendasi: A sekarang, B menyusul.
  - Terpisah dari itu: gaji karyawan villa saat ini dibayar lewat apa? Belum
    tercatat di sistem mana pun.
- **K4 — Koreksi September.** Snapshot September dibuat dua versi (v1 = angka
  yang sudah tersinkron, basis kotor; v2 = basis subtotal seperti Oktober),
  keduanya ditampilkan dengan catatan? Atau hanya v1 dengan catatan kaki?
- **K5 — Penamaan tabel.** Setuju awalan `ir_` (bukan `properties` /
  `kpi_snapshots` polos)?
- **K6 — Arsitektur.** Setuju menambah Route Handler server pertama di
  Next.js (untuk PDF) dan modul baru memakai access token pengguna?
- **K7 — Dependensi baru.** Setuju `@react-pdf/renderer`?
- **K8 — Divisi Housekeeping dan Manajemen.** Housekeeping belum ada di
  master divisi Mkhsistem, dan Manajemen villa 0 orang. Apakah memang belum
  ada staf housekeeping, atau dikerjakan pihak luar/staf lain? Ini harus
  dirapikan di Mkhsistem (di luar sesi ini) sebelum headcount bisa dilaporkan.
- **K9 — Data unit dijual.** Setuju villa mulai menyimpan status unit
  dijual/ditutup per hari (spesifikasi Tahap 2)? Sebelum itu, laporan hanya
  menampilkan okupansi atas unit total, dan kolom "atas unit dijual" ditulis
  "data belum tersedia".
- **(Di luar modul, tapi ditemukan)** Tabel keuangan inti masih bisa diubah
  oleh `anon` karena migrasi `0025` belum diterapkan. Tidak diubah di sini;
  dicatat agar diputuskan terpisah.
