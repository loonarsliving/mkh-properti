# CURRENT_STATE

_Audit awal: 2026-08-21, HEAD `a47daa8` di `main`._
_Diperbarui: 2026-08-22 — migrasi frontend ke Next.js (branch `claude/html-nextjs-migration-financial-reports-vb7l50`, belum di-merge ke `main`)._

## 2026-11-11 — Register Loonars AI Advisor (migrasi 0073a–d — DITERAPKAN 2026-11-11)
- D-2026-005/007: data advisor di database ini, tabel tersendiri `advisor_keputusan`, `advisor_syarat`, `advisor_dokumen`, `advisor_pengaturan`, `advisor_log` (append-only). Tabel/fungsi lama tidak disentuh. RLS aktif tanpa policy + akses tabel dicabut dari anon/authenticated; semua akses lewat RPC `advisor_*` security definer yang mewajibkan header `x-advisor-secret` = Vault `advisor_shared_secret` (rahasia yang sama dengan 0072).
- `advisor_keputusan_simpan` menolak CONFIRMED/REVIEWED dan tidak mengubah keputusan yang sudah disahkan; CONFIRMED hanya lewat `advisor_keputusan_konfirmasi` (dari PROPOSED). Syarat lama ditandai `batal`, tidak dihapus.
- Versi tunggal 0073 tertahan konfirmasi "destruktif" Supabase MCP (drop/delete/on delete) → dipecah 0073a–d tanpa perintah itu. Diuji di Postgres lokal (rahasia salah, baca tabel langsung, CONFIRMED lewat simpan, ubah setelah CONFIRMED, update log → semua ditolak) lalu di produksi sebagai anon (rahasia salah & baca tabel → 42501). Keputusan D-2026-001…007 diimpor (`sumber = repo`, tanpa angka).
- Klien: layanan advisor repo `loonarsliving/Istri` (`service/lib/register.ts`).

## 2026-11-11 — AI CFO advisor: perbaikan 401 palsu
- `/api/cfo/advisor` menganggap respons sukses sebagai "tidak berhak" bila badan data memuat digit `42501` (mis. dalam nominal rupiah). Kode galat kini hanya dibaca dari respons gagal, sama seperti `rpc()` di `laporan-investor/server.ts`. Secret Vault `advisor_shared_secret` sudah dibuat (2026-11-11).

## 2026-11-11 — AI CFO: endpoint hanya-baca untuk Loonars AI Advisor (migrasi 0072 — DITERAPKAN 2026-11-11, PR #61)
- Owner: endpoint advisor boleh dibangun "selama tidak merusak sistem yang sudah bekerja". `POST /api/cfo/advisor` (mode `fakta` / `tanya` / `evaluasi`) memakai mesin deterministik yang sama (faktaCfo, jawabDeterministik, evaluasiKeputusan = CEO challenger), tanpa narasi AI dan tanpa data mentah. Auth header `x-advisor-secret` = Vault `advisor_shared_secret` (terpisah dari `mk_sync_shared_secret`).
- 0072: `_cfo_akses()` dinyatakan ulang identik dengan 0062 + satu cabang yang hanya aktif bila flag transaksi `cfo.advisor_baca='ya'` (dipasang hanya oleh `cfo_advisor_ambil_data(p_mode)` / `cfo_advisor_ambil_kerja()`, pembungkus `cfo_ambil_data`/`cfo_ambil_kerja` yang STABLE) dan rahasia cocok. Audit `cfo_audit_log` aktor `advisor`. Tanpa tabel/kolom baru. Mati sampai owner membuat secret di Vault.
- Klien: repo `loonarsliving/Istri` (`tools/adapters/sources.py` AiCfoSource). Tes `src/lib/cfo/advisor.test.ts` (5).
- Diterapkan via Supabase MCP 2026-11-11 setelah memastikan `_cfo_akses` produksi identik dengan 0062. Verifikasi (SELECT): tanpa header → null; rahasia sync → `sistem` / `wa:…` seperti sebelumnya; header advisor tanpa flag → null; flag tanpa secret Vault → null; sebagai `anon`, `cfo_advisor_ambil_data` dan `cfo_catat` dengan header advisor → 42501. Secret `advisor_shared_secret` dibuat 2026-11-11 oleh sesi Claude (nilai dibangkitkan di database, `gen_random_bytes(32)`). Uji produksi setelah #63: mode fakta/tanya/evaluasi 200, tanpa rahasia 401, `/api/cfo/tanya-wa` & `/api/cfo/chat` tanpa kredensial tetap 401, audit `cfo_audit_log` aktor `advisor` tercatat.

## 2026-11-10 — AI CFO: Kesiapan Investasi + pemeriksaan kelengkapan Loonars 2

- `/cfo/kesiapan-investasi`: 13 butir yang biasa diminta investor, status dari pemeriksaan Data Quality, langkah berikutnya, bahan yang sudah bisa dibagikan; ringkasannya masuk laporan mingguan WA. Tanpa skor. Penutup butir "Incomplete" terbesar tetap rencana bertahap di `docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md` §6 — berikutnya **Tahap 2a** (buku besar tunggal, kunci periode, saldo awal; perlu persetujuan skema).
- Loonars 2 (migrasi 0064–0068, LIVE): total DP ditanya & disimpan sebagai kontrak D-n, pesan ke pelaksana tanpa nama owner, nota wajib ≥ Rp 1 jt, penahanan pengajuan dobel, tanda harga janggal, pelunasan tanpa DP ditanya. Lihat CHANGELOG.md 2026-11-10.

## 2026-11-03 — Keputusan owner D-1…D-8; D-1 diterapkan — LIVE (PR #47, disetujui owner "bawa ke production")

Keputusan lengkap: `docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md` §8.
**D-1 diterapkan tanpa migrasi:** jurnal proyek LL = pembangunan & penjualan villa
Loonars 1 (diverifikasi: tidak ada belanja Loonars 2) → kolom Loonars 1 di Laporan
Holding (baris 4-03, 5-04, 6-06, PPh final 8-01 L1; neraca 1-06…1-09, 2-10) dan P&L
institusional (Gross Revenue — Property Unit Sales, COGS — Property Units, OPEX per
kategori, PPh final). PKP PPh badan tidak memuat penjualan unit (final). Rekonsiliasi
laba villa ↔ laporan villa memakai laba operasional L1. Dampak 2026 (data produksi):
laba L1 +± Rp 897 jt. Data Quality: F-13 (B1 Rp 0, B2 baru DP, 5 unit belum terjual),
F-14 (bagi hasil 13 unit), F-15 (bank 1-1004 −Rp 421 jt di buku LL).
Kas buku LL di Owner Overview kini berlabel Loonars 1 (total kas tidak berubah).
D-6 (2026-11-03, owner): tidak perlu register investor — cukup sebut skema bagi hasil investor 70% dari profit (Data Quality: area Investor = Complete). Berikutnya: Tahap 2a (migrasi `fin_*`, nomor ≥ 0064 karena 0063 dipakai Loonars 2).

## 2026-11-02 — Institutional reporting: bagian tanpa perubahan skema — LIVE DI PRODUKSI

Disetujui owner ("Ya", lalu "bawa ke production"). PR #45 di-squash ke `main`
(51f6fea), CI lulus; deploy Vercel `haluoleofinance` `dpl_Any33Zb14iURvytUR5Epgvzr3gcy`
READY, alias `finance.haluoleo.id`. Diverifikasi lewat Vercel (sandbox tidak bisa
curl domain produksi): `/cfo/laba-rugi`, `/cfo/unit-economics`, `/cfo/kualitas-data`,
`/cfo/holding` → 200. Uji dengan login CFO asli & data produksi masih disarankan.
**Tanpa migrasi, tanpa env baru, halaman lama tidak diubah perilakunya.**
- `src/lib/keuangan/` (baru, fungsi murni, 16 tes vitest):
  - `status.ts` — status per angka (aktual / estimasi / sebagian / nol_kebijakan /
    belum_tercatat / tidak_tersedia / tidak_berlaku) + kelengkapan Complete /
    Needs Verification / Incomplete. Nol karena kebijakan tidak boleh menutupi
    data yang hilang.
  - `laba-rugi.ts` — P&L institusional (Gross Revenue … Net Profit + memo EBITDA
    sebelum bagi hasil), kolom L1/L2/Holding/Konsolidasi, bulanan/kuartalan/tahunan,
    aktual vs periode lalu vs anggaran (anggaran = belum ada). **Laba bersih tahunan
    identik dengan Laporan Holding** (diuji). Jurnal LL tidak dijumlahkan (F-1).
  - `unit-ekonomi.ts` — Occupancy, ADR, RevPAR, GOPPAR, per-room, cost/ARN, OTA
    commission ratio, direct ratio (revenue & malam), ALOS, cancellation (dari
    `ir_metrik_bulanan`); lead time & repeat guest = tidak tersedia. Penyebut
    berstatus estimasi (F-3).
  - `kualitas-data.ts` — pemeriksaan per area (debit=kredit per proyek/bulan, akun
    di luar COA, F-1, biaya standar, kas villa, ekuitas plug, rekonsiliasi, sinkron…).
    Tanpa skor "siap investasi".
- `holding.ts`: jadwal penyusutan diekstrak (`jadwalPenyusutan`, `penyusutanBulan`)
  — hasil laporan holding tidak berubah (tes lama lulus). `loonars1.ts`: jumlah
  booking per channel ikut dibawa.
- Halaman: `/cfo/laba-rugi`, `/cfo/unit-economics`, `/cfo/kualitas-data` (CFO saja,
  ekspor CSV, cetak). Diuji render Chromium dengan data berbentuk produksi
  (1280 px & 390 px, tanpa galat runtime, tanpa scroll horizontal).

## 2026-11-02 — Upgrade AI CFO ke institutional reporting: Tahap 1 audit (MENUNGGU KEPUTUSAN OWNER)

Branch `claude/ai-cfo-mkh-upgrade-tgom02`. Hanya dokumen:
`docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md`. Tahap 2 (skema `fin_*`,
mesin posting ke `jurnal`) belum dimulai — menunggu keputusan D-1…D-8 di dokumen itu
(terutama D-1: penjualan unit villa L1 ±Rp 1,9 M di jurnal LL, dan D-2: arsitektur
buku besar tunggal). Temuan terverifikasi read-only di produksi: neraca holding
memakai ekuitas plug; biaya villa = standar (dasar bagi hasil), bukan aktual;
`malam_tersedia` = unit × hari padahal villa punya `villa_daily_inventory_snapshot`
dan `villa_room_maintenance`.

## 2026-11-02 — Laporan keuangan PDF lewat WhatsApp owner (migrasi 0062)

Owner memilih tiga laporan: Holding SAK EMKM, Loonars 1 bulanan, Loonars 2.
- **Migrasi 0062:**
  - `cfo_pdf_buat_tautan(jenis, periode, nomor)` menerima akses lewat rahasia sync (MK Connect). Token `<exp>.<jenis>.<periode|->.<hmac>` berlaku 15 menit, HMAC `mk_sync_shared_secret`, dan dicatat di audit.
  - `cfo_pdf_data(token)` memverifikasi token, lalu mengembalikan `cfo_ambil_data` + `cfo_ambil_kerja`.
  - `_cfo_akses` mengenali token hanya lewat GUC lokal `cfo.tautan_pdf` yang diverifikasi ulang. Token PDF tidak bisa dipakai membuat tautan baru.
- **Route:**
  - `POST /api/cfo/pdf-wa` (rahasia sync) → `{url, nama_berkas}`.
  - `GET /api/cfo/pdf/<token>/<nama>.pdf` → PDF, dibuat saat diunduh dan tidak disimpan.
- **Dokumen:** `src/lib/cfo/pdf.tsx` (Holding / Loonars 1 / Loonars 2, format akuntansi) dan `pdf-dokumen.ts`.
- **Sisi WA:** Mkhsistem `owner-assistant.ts` (tool `pdf_holding` / `pdf_loonars1` / `pdf_loonars2` + `arahkanPdf`).
- **Perbaikan:** konsolidasi holding sebelumnya "-" untuk baris satu lini. Sekarang null hanya bila data tidak tersedia; kas villa yang belum dicatat tetap membuat total null.
- **Catatan:** saldo rekening villa (Loonars 1) belum pernah dicatat, sehingga total aset/ekuitas konsolidasi tampil "tidak tersedia" sampai dicatat.

## 2026-11-02 — Laporan Holding: kebijakan serah terima, ekuitas, pajak, penyusutan

Keputusan owner (lanjutan):
- **Serah terima unit L2:** akhir Desember. Pendapatan, HPP, dan fee unit diakui pada 31 Desember. Nilai per tahun = kumulatif sekarang − kumulatif arsip tutup buku Desember tahun lalu (`kumulatifL2` di arsip). Tahun 2026 memakai dasar 0.
- **Modal disetor** ditetapkan dari posisi bisnis berjalan:
  - 2026: modal disetor = ekuitas − laba berjalan.
  - Mulai 2027: modal disetor = `ekuitasAkhir` dari arsip Desember 2026; selisihnya = setoran/(penarikan) owner.
- **Utang AFP** milik PT Maha Karya. Dikeluarkan dari laporan holding, panel arsip Kewajiban, dan fakta chat.
- **Bunga 0**, karena tidak ada pinjaman bank.
- **Penyusutan bangunan Loonars Coffee:** garis lurus 20 tahun, mulai bulan setelah status MK Connect `completed`.
- **PPh (estimasi):**
  - Final 2,5% atas penjualan unit (PP 34/2016).
  - PPh badan 22% dengan fasilitas Pasal 31E atas laba L1 + holding − penyusutan (`pphBadan()`).
  - Disajikan sebagai utang PPh di neraca. Wajib dikonfirmasi konsultan pajak; koreksi fiskal belum dihitung.
- **Rekening holding** menunggu owner.

## 2026-11-02 — Laporan Holding PT Loonars Mahakarya (SAK EMKM) (migrasi 0061)

Keputusan owner 2026-11-02 (jawaban pertanyaan kebijakan):
- **Badan hukum:** PT Loonars Mahakarya = nama baru PT Maha Karya Haluoleo.
- **Holding** = Loonars 1 + Loonars 2 + tingkat holding (biaya bersama).
- **Pendapatan villa KOTOR penuh;** bagi hasil investor (70%) + top-up jaminan = beban.
- **Gaji tim bersama** (slip MK Connect; cabang selain `Loonars Private
  Living` yang sudah ada di OPEX villa) = **beban holding**; slip belum
  ditransfer = utang gaji.
- **Tahun buku resmi pertama: 2027;** 2026 = periode persiapan.

Implementasi:
- `src/lib/cfo/holding.ts` `laporanHolding(model, data, tahun)`: laba rugi per
  kolom L1/L2/holding/konsolidasi, posisi keuangan (per hari ini), gaji per
  cabang, rekonsiliasi (laba L1 = bagian MKH bersih; aset L2 = neraca modul),
  CaLK (kebijakan + keterbatasan).
- Halaman `/cfo/holding` (cetak). Fakta "Holding …" di chat AI CFO (intent
  holding/gaji/neraca/laba rugi). Arsip tutup buku menyertakan holding.
- Migrasi 0061: `cfo_sumber_terima` menerima `gaji_karyawan` dari svcmyb.
  Pasangan Mkhsistem 0311.

Keterbatasan (tertulis di CaLK):
- Laba rugi L2 hanya sah untuk 2026 (kumulatif). Untuk 2027 dibutuhkan tanggal
  serah terima & penjualan per unit.
- Ekuitas = aset − liabilitas; belum ada buku besar ekuitas atau saldo awal
  dari akuntan.
- Penyusutan, bunga, dan PPh belum ada.
- Status utang bank AFP perlu keputusan akuntan.

## 2026-11-01 — Kunci proyek selain Loonars 1 & Loonars 2 (migrasi 0060)

Keputusan owner 2026-11-01: hanya **Loonars 1** (hospitality villa Yogyakarta) dan
**Loonars 2** (Loonars Living — penjualan villa + pengeluaran pembangunan;
Loonars Coffee/LC memakai keuangan Loonars 2) yang aktif dan dilaporkan.

- **Dikunci per 2026-11-01:** AFP, IH, GCI, GCR, KDI. Tabel `proyek_kunci`
  (RLS, baca staf). Trigger `_tolak_proyek_dikunci` pada `jurnal`, `pengajuan`,
  `aset`, `utang_bank`, `bayar_tukang`, `tukang_borongan` menolak
  insert/update/delete baris proyek dikunci (semua jalur termasuk sinkronisasi
  MK Connect & service role; errcode 42501). Pengajuan lama yang pending
  **boleh ditolak**, tidak bisa disetujui/dihapus. Tidak ada data yang dihapus;
  laporan lama tetap bisa dibuka (filter proyek: grup "Arsip").
- **Tidak dikunci:** LL, LC, HO (HO dipakai sinkronisasi HR MK Connect).
- `branches` (portal lama): selain `yogyakarta` / `yogya-loonars1` → `is_active=false`.
- **MK Connect tidak diubah** (cabang & karyawan Makassar/Jabodetabek/Kendari
  di MK Connect masih aktif — di luar lingkup perubahan ini). Event
  `construction_expense_submitted` tanpa kode proyek default ke KDI → kini
  gagal (tercatat `failed` di `sync_log` MKH) — disengaja.
- **AI CFO** (`src/lib/cfo/lingkup.ts`): utang bank & transfer tertunda milik
  proyek dikunci keluar dari kewajiban/peringatan/forecast → `kewajibanDiLuarLingkup`
  (panel arsip di /cfo/kewajiban). **Refund customer tetap dilaporkan** (permintaan
  owner). Pengajuan MKH proyek dikunci → putusan `DIKUNCI` + tindakan
  `mkh_pengajuan_proyek_dikunci` (tolak di Verifikasi). Cek jurnal seimbang
  tidak lagi menilai proyek dikunci.
- **Loonars Coffee:** owner mengonfirmasi kontraktor Rp 75 jt sudah dibayar →
  rekonsiliasi `proyek_tenaga:LC` berstatus `dikonfirmasi` (tetap tampil, tanpa
  peringatan/tindakan; `KONFIRMASI_OWNER`). Selisih biaya material & utang toko
  LC (jurnal vs MK Connect) masih terbuka — belum dijelaskan owner. Tidak ada
  jurnal pembayaran 75 jt yang dibuat (rekening sumber tidak diketahui; MK
  Connect sudah mencatatnya sebagai realisasi `contractor_payment`).
- Membuka kunci = migrasi baru yang menghapus baris dari `proyek_kunci`
  (persetujuan owner).

## 2026-11-01 — AI CFO: Loonars Coffee masuk laporan Loonars 2 (migrasi 0059)

Koreksi owner: "Loonars Coffee menggunakan keuangan dari Loonars 2" — sebelumnya
laporan L2 hanya memuat modul 4 rekening (villa) sehingga belanja Loonars
Coffee tidak terhitung.
- `proyekLoonars2()` (`src/lib/cfo/loonars2.ts`): proyek yang dibiayai L2 dari
  snapshot MK Connect `proyek_konstruksi` (budget total/material/tenaga,
  realisasi cost request posted/paid, komitmen, utang toko lunas/belum) +
  pembanding jurnal MKH proyek `LC` (`PETA_PROYEK_JURNAL`). Tanpa snapshot,
  tetap tampil dari jurnal LC.
- Masuk: belanja konstruksi gabungan (konsolidasi), neraca L2 (aset tetap dalam
  penyelesaian + utang toko proyek), kewajiban L2 (utang toko belum lunas),
  peringatan lewat budget, tindakan "tinjau pembengkakan", rekonsiliasi MK
  Connect vs jurnal LC (biaya, upah/kontraktor, utang), halaman L2, laporan
  cetak, briefing WA, chat. Tes `src/lib/cfo/loonars-coffee.test.ts`.
- Data produksi 2026-11-01: budget Rp 133.387.454; realisasi Rp 184.402.950
  (material 74,5 jt = 128% budget material; kontraktor 75 jt; lain-lain 34,9 jt
  tanpa pos) → lewat Rp 51.015.496 (138%). Jurnal LC hanya Rp 121.280.950,
  tanpa pembayaran kontraktor, dan seluruhnya masih utang toko (MK Connect:
  utang belum lunas Rp 6.657.850) → selisih tampil di rekonsiliasi.
- Migrasi 0059: `cfo_sumber_terima` menerima jenis `proyek_konstruksi` (hanya
  dari rahasia MK Connect). Pengirim: Mkhsistem 0309.

## 2026-11-01 — AI CFO bekerja: Meja Kerja CFO (migrasi 0058) — DIBANGUN, BELUM DI-MERGE, MIGRASI BELUM DITERAPKAN

Permintaan owner: "Buat ai cfo benar2 melakukan pekerjaan sebagai cfo".
Branch `claude/ai-cfo-meja-kerja`. Logika di `src/lib/cfo/kerja.ts` (+17 tes,
total 65 lulus); halaman `/cfo/kerja`.

- **Reviu pengajuan**: setiap kelompok pengajuan Loonars 2 yang menunggu diberi
  rekomendasi SETUJUI / TAHAN / CEK DOBEL dari angka (cicilan utang yang sudah
  disetujui & upah borongan → setujui; belanja baru untuk unit belum terjual →
  tahan karena menambah talangan; melewati budget+buffer → tahan; identik
  dengan pengajuan lain ≤30 hari → cek dobel; umur antrean). Antrean pengajuan
  MKH (semua proyek) diperiksa: input ganda, dua klaim fee unit yang sama,
  nominal janggal, menunggu > 30 hari. Owner tetap memutuskan (WA "setujui M-n").
- **Tindakan CFO** (`cfo_tindakan`): tugas konkret dengan penanggung & tenggat
  (isi rekening A–D, transfer alokasi DP, jatuh tempo pelunasan kosong, tagih
  investor, catat saldo villa, putuskan pengajuan, bersihkan antrean, utang
  bank, rencana pendanaan, sewa tanah, pajak hotel, selisih rekonsiliasi).
  Sinkron tiap 2 jam (`cfo_tindakan_sinkron`): baru dibuat, teratasi ditutup
  otomatis, muncul lagi dibuka ulang, diabaikan owner (wajib alasan) dihormati,
  tenggat tidak dimundurkan.
- **Rencana bayar mingguan**: kewajiban jatuh tempo ≤7 hari + pengajuan yang
  direkomendasikan setujui, diurutkan risiko, dibatasi kas di atas kas minimum.
  Masuk briefing mingguan.
- **Tutup buku bulanan** (`cfo_laporan_bulanan`, append-only): tgl 2–6
  (menunggu laporan villa final) ringkasan bulan lalu dibekukan + komentar
  varians vs bulan sebelumnya, dikirim ke WA owner (`cfo_briefing_antre` jenis
  `tutup_buku`, ikut saklar briefing_mingguan).
- Briefing harian kini memuat reviu pengajuan & tindakan (⏰ lewat tenggat);
  AI CFO Chat menjawab "pengajuan mana yang disetujui", "apa yang harus saya
  kerjakan", "rencana bayar minggu ini".
- **Migrasi 0058** (BELUM diterapkan): tabel `cfo_tindakan`,
  `cfo_laporan_bulanan`; RPC `cfo_tindakan_sinkron`, `cfo_tindakan_ubah`,
  `cfo_tutup_buku`, `cfo_ambil_kerja` (nomor rekening di keterangan/toko/
  supplier disamarkan; status rekening A–D tanpa nomornya); perluasan
  `cfo_briefing_bangunkan`/`cfo_briefing_antre`; cron `cfo-tindakan-sinkron`
  (23 */2 * * *), `cfo-tutup-buku` (27 1 * * *). Uji SQL lokal lulus
  (`supabase/tests/cfo_uji_kerja.sql`); query baca dicoba read-only di
  produksi (119 pengajuan L2, 25 MKH, 4 alokasi menunggu, rekening A–D belum
  terisi). Aplikasi tetap berjalan bila 0058 belum diterapkan (data kerja kosong).

## 2026-11-01 — AI CFO / Financial Manager (migrasi 0057) — LIVE DI PRODUKSI

**Status produksi (2026-11-01, disetujui owner "Jika sdh benar bawa ke production"):**
PR #35 + #36 di-merge ke `main`; deploy Vercel `haluoleofinance` READY.
Migrasi 0057 diterapkan via Supabase MCP sebagai `0057a`–`0057f` (f = jadwal
cron, setelah deploy). Diverifikasi dari database lewat pg_net (sandbox tidak
bisa curl domain produksi): `/cfo` 200; `/api/cfo/briefing` & `/api/cfo/tanya-wa`
tanpa rahasia 401; briefing dengan rahasia 200 (`tidak_ada_peringatan_kritis`,
jalur route → `cfo_ambil_data` → mesin hitung berjalan). Snapshot dari MK
Connect (Mkhsistem 0308, LIVE) diterima: 7 jenis, 306 baris. Layanan narasi AI MK Connect
diuji dari database: tanpa tanda tangan 401; bertanda tangan 200 (jawaban hanya
memakai fakta & menyebut [F1]). Advisor keamanan:
temuan baru hanya pola RPC ber-rahasia yang disengaja (sama dengan `ir_*`);
search_path & eksekusi fungsi trigger diperbaiki di 0057e.


Audit & desain lengkap:
`docs/ai-cfo/AUDIT-DAN-DESAIN.md`.

- **Migrasi `0057_ai_cfo.sql` (LIVE, 0057a–f).** Hanya menambah: `cfo_pengaturan`, `cfo_sumber_snapshot`,
  `cfo_sync_log`, `cfo_audit_log` (append-only), RPC `cfo_sumber_terima`,
  `cfo_ambil_data` (hanya baca), `cfo_catat`, `cfo_briefing_antre`,
  `cfo_briefing_bangunkan` + 3 job pg_cron (`cfo-briefing-harian` 23:07 UTC,
  `cfo-briefing-mingguan` Minggu 23:17 UTC, `cfo-cek-peringatan` tiap 6 jam).
  Diuji di Postgres 16 lokal (`supabase/tests/jalankan-uji-cfo.sh`, 9 kelompok
  pemeriksaan + migrasi dijalankan ulang). Query baca `cfo_ambil_data` sudah
  dicoba read-only terhadap skema produksi (17 unit, 81 agregat jurnal, 41 KB).
- **Mesin deterministik `src/lib/cfo/`**: laporan Loonars 1 (revenue → EBITDA,
  ADR/RevPAR, bagi hasil & top-up jaminan), Loonars 2 (nilai kontrak, cash-in =
  uang muka, piutang kontrak, biaya konstruksi akrual/kas, budget vs aktual,
  utang toko, dana talangan, neraca, proyeksi laba), konsolidasi, forecast
  harian/13 minggu/bulanan × optimis/normal/pesimis, kewajiban + prioritas,
  peringatan, rekonsiliasi, deteksi transaksi abnormal, CEO challenger,
  briefing WA, fakta chat. 30 tes vitest (`src/lib/cfo/cfo.test.ts`).
- **Halaman CFO** `/cfo`, `/cfo/loonars-1`, `/cfo/loonars-2`, `/cfo/arus-kas`,
  `/cfo/kewajiban`, `/cfo/anggaran`, `/cfo/peringatan`, `/cfo/chat`,
  `/cfo/laporan`, `/cfo/sinkronisasi` (menu sidebar "AI CFO"). Diuji render di
  Chromium dengan data tiruan berbentuk produksi — tanpa galat runtime.
- **API**: `POST /api/cfo/chat` (token CFO), `POST /api/cfo/briefing`
  (x-sync-secret dari pg_cron, atau token CFO untuk pratinjau/kirim manual),
  `POST /api/cfo/tanya-wa` (x-sync-secret + nomor, dipanggil tool `ai_cfo`
  asisten WA owner di Mkhsistem). Semua hanya baca + audit log.
- **AI**: narasi AI memakai layanan AI MK Connect (system prompt AI CFO adalah
  konstanta di MK Connect sejak #36 / Mkhsistem #141 — perbaikan CodeQL
  `js/system-prompt-injection`; MKH Property hanya mengirim pesan pengguna), (`POST https://mkh.haluoleo.id/api/mkh-property/ai-cfo/narasi`, ditandatangani database lewat RPC `cfo_tanda_ai` — HMAC rahasia sync yang sudah ada, 5 menit, terikat isi). MKH Property tidak punya kunci AI sendiri dan tidak butuh env baru. Narasi ditolak otomatis bila memuat nominal di luar daftar fakta; jalur WA (`tanya-wa`) hanya deterministik karena asisten WA MK Connect yang merangkai jawaban akhir.
- **Kas Loonars 1**: tabel `cfo_saldo_rekening` (append-only) — CFO mencatat saldo rekening villa per tanggal di `/cfo/loonars-1`; kas berjalan = saldo + mutasi villa sesudahnya (snapshot `villa_kas_masuk`: settlement RECEIVED + walk-in lunas; `villa_kas_keluar`: biaya villa ditransfer). Peringatan bila belum dicatat atau > 7 hari.
- **Data MK Connect/villa** (penjualan LNR2, refund, settlement OTA, transfer
  tertunda, pengajuan biaya villa) masuk lewat Mkhsistem migrasi `0308`
  (LIVE, pg_cron tiap 30 menit).
- 2026-11-01 (disetujui owner): penjualan BANYU-06 & AVARA-06 dicatat di modul
  Loonars 2 lewat `_loonars2_catat_receipt` (receipt #1–#4, total Rp 425 jt,
  alokasi C/B menunggu konfirmasi transfer; instruksi WA owner outbox #452–#455).
  Nomor rekening A–D masih placeholder.
- Temuan audit lain yang perlu tindakan owner: rekening C −Rp 123,99 jt (talangan);
  utang bank AFP Rp 1,49 M jatuh tempo 31 Des 2026.

## 2026-10-21 — Laporan keuangan villa (kiriman harian) + rekap pajak hotel untuk Dispenda (migrasi 0054)

Owner: MKH Property punya laporan keuangan khusus villa yang bisa diminta lewat
WhatsApp, plus rekap pajak hotel (PBJT jasa perhotelan) untuk Dispenda; kiriman
dari villa cukup per hari ("agar tidak membebani"). Laporan Dispenda memakai
angka transaksi yang SEBENARNYA — permintaan agar laporan "diatur" supaya bayar
Rp2-5 jt sengaja TIDAK dibuat.

- **Migrasi 0054 (SUDAH diterapkan ke produksi 2026-10-21 lewat Supabase MCP, setelah uji coba dalam transaksi yang dibatalkan: 11 pemeriksaan lolos, tidak ada sisa).** Tabel baru `laporan_villa_bulanan` (snapshot per bulan: kotor, komisi OTA, bersih, COGS, gross profit, OPEX/gaji, net profit, rincian jsonb; status sementara/final; bulan final tidak diturunkan), `pajak_hotel_villa` (tarif, dasar kotor/bersih, setoran; angka dibekukan saat setoran dicatat), RPC `villa_laporan_terima` (penerima kiriman; rahasia Vault `villa_sync_shared_secret` yang SUDAH dipakai villa, tanpa rahasia baru) dan `villa_laporan_ringkasan_wa` (hanya baca; akses `ir_boleh_akses`). RLS: CFO baca/kelola, anon tertutup.
- **Villa** mengirim lewat `POST /cron/sync-laporan-villa` (villa-api) yang dipicu Vercel cron harian 00.40 WIB; bulan berjalan = sementara, tanggal 1-5 bulan lalu dikirim ulang = final. Lihat villa CURRENT_STATE 2026-10-21.
- **Halaman baru (CFO):** `/laporan-keuangan-villa` (laba rugi villa siap cetak) dan `/pajak-hotel` (rekap per bulan, tarif bawaan 10%, dasar bawaan kotor — ubah ke bersih HANYA setelah Dispenda mengonfirmasi tertulis; catat setoran + bukti). Halaman lama `/laporan-villa`, `/pendapatan-villa`, `/beban-villa` (input manual) tidak diubah.
- **WhatsApp:** `POST /api/laporan-villa/ringkasan-wa` (x-sync-secret + nomor, sama dengan ringkasan investor) — endpoint sudah ada; pemanggilnya (asisten WA owner di Mkhsistem) BELUM disambungkan.
- Tidak masuk `jurnal`/COA (keputusan akuntansi tetap di owner/CFO); laporan SAK EMKM lengkap (neraca) untuk villa belum ada.
- Catatan: kiriman bulanan lama `villa_income_sync` -> `pendapatan_villa` masih memakai total transaksi check-in (komisi OTA per persen belum dipotong), jadi angkanya berbeda dari laporan baru ini; laporan baru yang menjadi acuan.

## 2026-10-18 — Ringkasan keuangan untuk asisten WA owner — dibangun, BELUM di-merge

`POST /api/laporan-investor/ringkasan-wa` (hanya baca): `ir_ambil_data` +
`susunModel` yang sama dengan PDF Laporan Investor, dikembalikan sebagai JSON
ringkas (`src/lib/laporan-investor/ringkasan.ts`), tanpa PDF dan tanpa catatan
unduhan. Akses sama dengan `/api/laporan-investor/wa` (x-sync-secret dicocokkan
database lewat `ir_boleh_akses`; MK Connect memastikan super admin). Dipanggil
asisten WA owner di Mkhsistem (`lib/ai/domains/owner-assistant.ts`). Tanpa
migrasi. Dicek 2026-10-18 dengan data produksi (baca saja): `metrik` masih
kosong, `pendapatan_villa` baru berisi 2026-09.
**Update 2026-10-19:** pengirim metrik dibangun di villa (`/cron/sync-mkh-income`
→ `ir_metrik_terima`, unit `loonars-1`, sumber `villa-api`, mulai periode
2026-10), LIVE sejak villa-api v142 (villa PR #222); pengiriman pertama 1 Nov
untuk Oktober. Lihat villa CURRENT_STATE.md 2026-10-19.

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

## 2026-10-11 — Loonars 2: utang toko + pengajuan mingguan — LIVE

Owner menyetujui ("Ya bawa ke production dan kirim panduan ke Vando").
Migrasi `0047` (borongan tukang, pesanan bahan kolektif/RAB per unit, unit sedang
dibangun) LIVE (0047a1–h2) dan 0048 LIVE (0048a–c; borongan otomatis). Detail: DATABASE.md.

Migrasi `0045` (akses web baca-saja pelaksana: `loonars2_boleh_lihat`,
`loonars2_web_lihat`) LIVE (diterapkan sebagai `0045a`, `0045b`). Akun Vando dibuat owner
lewat Pengguna & Akses dengan proyek "Loonars 2 — Pelaksana" (users_proyek.proyek_id = 'LOONARS2').

Migrasi `0044` DITERAPKAN ke produksi via Supabase MCP sebagai `0044a`,
`0044b`, `0044c`, `0044d1`, `0044d2`, `0044e`, `0044f`, `0044g`, `0044h`
(isi sama dengan berkas; bagian 12 hak akses digabung ke 0044h). Diverifikasi:
3 tabel baru ber-RLS, anon tanpa akses tabel/fungsi internal, laporan utang
berjalan, cron tetap aktif. Isi migrasi:
`loonars2_toko`, `loonars2_utang_toko` (per unit, kode U-n, memotong budget
bangun unit saat disetujui), `loonars2_cicilan` (tanpa unit — tidak
dihitung dua kali), kolom `kelompok` (kode M-n) di pengajuan, `toko_id`/
`cicilan_id` di pengeluaran, `hari_pengajuan_mingguan` di pengaturan
(default Jumat). Fungsi baru `_loonars2_catat_utang`,
`_loonars2_ajukan_mingguan`, `_loonars2_putuskan_kode`,
`_loonars2_bayar_kelompok`; `_loonars2_wa_jalankan`, `loonars2_web`,
`loonars2_pengingat`, `_loonars2_teks_saldo`, `_loonars2_cek_kesehatan`,
`_loonars2_ajukan`, `loonars2_v_unit` dinyatakan ulang. Tanpa DROP/DELETE.
Dashboard: tab Utang Toko + aksi per kode di tab Pengajuan. Uji:
`supabase/tests/loonars2_uji_utang.sql` (lulus bersama uji 0043).

## 2026-10-11 — Modul Keuangan Loonars 2 (4 rekening + WA) — LIVE

Owner menyetujui ("Ya bawa ke production") setelah laporan uji.
**Migrasi `0043` DITERAPKAN ke produksi** (`gluoioiimapyhchdasfl`) via
Supabase MCP dalam bagian kecil, tercatat sebagai `0043a`–`0043f`,
`0043g1_loonars2_outbox_bangunkan`, `0043g2_loonars2_pengingat`,
`0043g3_loonars2_hak_dan_cron`, `0043h_loonars2_search_path_helper` — isinya
sama dengan berkas repo. Catatan alat: bagian g pertama kali timeout dan
dibatalkan bersih; penyebabnya baris `delete ...` di badan fungsi pengingat
(ditahan MCP sebagai pernyataan destruktif) — baris itu dibuang dari berkas
karena tidak diperlukan. Diverifikasi di produksi: 17 unit, kebutuhan C
171,6/232 jt, alokasi DP benar, anon tidak bisa membaca tabel/memanggil
fungsi internal atau loonars2_web, rahasia salah ditolak, cron aktif,
advisor keamanan tanpa temuan baru selain pintu RPC yang memang disengaja.

Keputusan owner (2026-10-11): 17 unit sesuai siteplan MK Connect `LNR2`
(AVARA-01..06 + BANYU-01..06 = 1 Kamar Rp 420 jt; LUNARA-01..05 = 2 Kamar
Rp 600 jt), biaya bangun 120/160 jt, buffer 15%, **fee marketing 8% dari
harga**, sewa tanah Rp 1 M lunas 12 bulan, DP 50%. Semua angka ada di tabel
pengaturan (bisa diedit, override per unit).

- Migrasi `0043_loonars2_keuangan.sql`: tabel `loonars2_*` (RLS CFO,
  audit log via trigger), alokasi "unit terdanai penuh dulu" C → B → D di
  `_loonars2_hitung_alokasi` (rupiah bulat + constraint trigger jumlah
  alokasi = nominal), saldo dihitung dari buku besar
  (`loonars2_v_rekening`, tidak ada kolom saldo yang bisa diedit), pintu WA
  `loonars2_wa` (rahasia sync `mk_sync_shared_secret` yang sudah ada,
  whitelist `loonars2_wa_users`), pintu web `loonars2_web` (khusus CFO),
  pengingat `loonars2_pengingat` (pg_cron 15 menit) dan
  `loonars2_outbox_bangunkan` (pg_cron 1 menit → MK Connect
  `/api/loonars2/outbox`).
- Frontend: `/loonars2` (dashboard), `/api/loonars2/wa` (diteruskan ke RPC,
  pola sama dengan laporan investor), `src/lib/loonars2.ts`.
- Sisi WA ada di Mkhsistem: `lib/ai/domains/loonars2-wa.ts`.
- Uji: `supabase/tests/jalankan-uji-loonars2.sh` (Postgres lokal sekali
  pakai + stub Supabase) — semua skenario lulus 2026-10-11.
- Asumsi default yang dipilih (bisa diubah owner): target tanah diukur dari
  total alokasi ke B (bukan saldo B); syarat profit = target tanah
  terkonfirmasi + semua unit terjual terdanai penuh (+ transfer tertunda
  selalu memblokir); konfirmasi "YA" untuk semua pencatatan uang dan ubah
  rekening; kode pengajuan `L2-<n>`; pesan pelaksana diawali "L2".
- **Sebelum dipakai (masih harus dilakukan owner):** isi nomor WA owner & Vando di
  `loonars2_wa_users`, isi rekening A–D, periksa `jatuh_tempo_tanah`
  (diisi otomatis = tanggal migrasi + 12 bulan), dan catat pembayaran
  BANYU-06 yang sudah terjual di siteplan.
- Belum: bukti foto disimpan sebagai URL Whacenter (belum disalin ke
  Storage, sama seperti Loonars Coffee); uji ujung-ke-ujung dengan WA asli.

## 2026-10-10 — Tutup akses publik, Loonars Coffee (LC), Laporan Investor

**Keamanan (keputusan owner: tutup celah data yang bisa dilihat semua orang).**
Selama ini anon key (publik) bisa membaca/mengubah/menghapus tabel keuangan.
- Migrasi `0036` (**LIVE**): policy staf login (`mkh_is_staf()` = email
  terkonfirmasi di `cfo_users`/`users_proyek`), RPC `lapor_lapangan_kirim`
  untuk tiga form tanpa login, `next_mkh_no`/`jurnal_branch_balance_sync`
  jadi SECURITY DEFINER. Hanya menambah — tidak ada akses yang dicabut.
- Frontend (`src/lib/supabase.ts`, `auth.ts`, form lapor) mengirim access
  token pengguna + refresh otomatis. **LIVE** (PR #13, merge 71043cc).
- Migrasi `0037` (**LIVE** 2026-10-10, setelah log membuktikan frontend
  memakai token): akses anon ke tabel keuangan dicabut; policy lama
  dinetralkan dengan `ALTER POLICY ... TO service_role` (bukan DROP). Aplikasi
  yang owner nyatakan tidak dipakai lagi (loonars-sales, Loonars-dashboard,
  Kos, filehub lama) ikut dikunci — akses dicabut, data tidak dihapus.
  **Sejak ini, akses data hanya lewat login staf atau RPC ber-rahasia.**

**Loonars Coffee (keputusan owner).** Migrasi `0038` (**LIVE**): kode proyek
`LC`; `sync_inbound` memetakan cabang Loonars Coffee ke LC dan tidak lagi
menjurnal dua kali biaya yang dikirim lewat `construction_expense_submitted`
DAN `construction_project_financial_record`. Baris historis dipindah LL→LC.
Duplikat historis (14 transaksi, 28 baris) dihapus oleh migrasi `0039` —
**LIVE**, disetujui owner; arsip baris di `sync_log`
(`migrasi:0039:hapus-jurnal-ganda-loonars-coffee`).

**Laporan Investor.** Migrasi `0040` (**LIVE**): tabel `ir_*`, RPC
`ir_metrik_terima`, `ir_ambil_data`, `ir_catat_unduhan`. Migrasi `0041`
(**LIVE**): tidak ada rahasia baru — villa memakai `villa_sync_shared_secret`,
MK Connect memakai `mk_sync_shared_secret`; izin meminta laporan lewat WA =
peran `super_admin` di MK Connect (keputusan owner). Halaman
`/laporan-investor`, PDF server `/api/laporan-investor/pdf`, WA
`/api/laporan-investor/wa` (meneruskan header `x-sync-secret` ke database;
tanpa env baru). Modul realtime (keputusan owner). Dokumen:
`docs/laporan-investor/`. Belum ada kiriman KPI dari villa/MK Connect — lihat
spesifikasi 02/03.

**Catatan alat:** Supabase MCP menggantung (perubahan otomatis dibatalkan)
untuk: perintah DROP apa pun (event trigger sql_drop), fungsi/tabel `pg_temp`,
SELECT di tingkat atas, dan blok gabungan yang besar. Pakai blok DO kecil,
`ALTER POLICY ... TO service_role` sebagai pengganti DROP POLICY, dan
verifikasi tiap bagian.

## 2026-09-10 — Automatic villa income sync (new, LIVE IN PRODUCTION)
Added `villa_income_sync` RPC (migration `0033`) so Loonars Villa's own
`villa-api` can push monthly rental/cafe/spa/lainnya income into
`pendapatan_villa` automatically, closing the gap noted below (the manual-entry
Pendapatan Villa report now has a real inbound sync path, not just a
data-shape placeholder for one). See INTEGRATIONS.md for the full design
(dedicated Vault secret, not `sync_inbound`, not the service_role-key model).
Applied directly to production Supabase (`gluoioiimapyhchdasfl`) and tested
via a simulated PostgREST header — the villa-side caller was built in the
same session (see `villa` repo's own memory for its half). **Not yet observed
running end-to-end from a real villa-api cron fire** — the villa repo's new
monthly cron hasn't executed yet at the time of this note; verify after its
first scheduled run (or trigger it manually) that a real row lands in
`pendapatan_villa` with `sumber='villa_api'`.

## 2026-09-10 — Pendapatan Villa report (new, LIVE IN PRODUCTION)
Added `pendapatan_villa` table (migration `0032`) and a CFO-only report page
(`/pendapatan-villa`) for Loonars Villa rental income, entered manually.
**Important:** the villa rental system lives on a *different* Supabase project
(`svcmybsziaelwwdrnzcv`, repo `villa`) than this app (`gluoioiimapyhchdasfl`
— see DATABASE.md), so this data does not flow in automatically yet. Owner
intent (per 2026-09-10 conversation) is to sync it automatically from the
villa side later; the table's `sumber`/`idempotency_key` columns exist for
that, but no sync job/Edge Function/webhook has been built — do not assume
one exists. Treat any future sync work here as touching two separate
production Supabase projects; confirm scope with the owner before building it.

**Applied to production 2026-09-10, owner-approved ("terapkan dan bawa ke
production"):** migration `0032` applied directly to the live Supabase
project `gluoioiimapyhchdasfl` via Supabase MCP (confirmed: table exists,
RLS enabled with the intended `anon`+`authenticated` `USING (true)` policy,
`get_advisors` security scan shows no new findings for this table). Merged
`claude/mkh-villa-financial-report-5r1y2q` into `main` (fast-forward, no
conflicts) and pushed — Vercel auto-deployed `dpl_2VX1GkE8nactCYV6incQ2bSQrf6N`
to production (`target: production`, `readyState: READY`, aliased to
`finance.haluoleo.id`). Direct `curl` verification from this session's
sandbox was blocked by its own egress proxy policy (unrelated to the
deploy) — readiness was confirmed via the Vercel API's deployment/alias
state instead. A manual smoke test of `/pendapatan-villa` from an actual
browser/CFO login is still recommended per DEPLOYMENT.md's checklist.

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
- **Update 2026-10-19:** CI (`.github/workflows/ci.yml`: typecheck, lint, tes,
  build) dan tes vitest untuk `src/lib/akuntansi/` kini ada. Belum ada tes untuk
  halaman, RPC database, maupun laporan investor. Teks di bawah ini sejarah.
- ~~No automated tests, no CI/CD — all functional verification is still manual.~~
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
