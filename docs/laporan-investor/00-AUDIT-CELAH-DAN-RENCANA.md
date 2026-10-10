# Laporan Investor — Tahap 0: Audit dan Rencana (versi repo)

_Diperbarui 2026-10-10._

> **Repo ini publik.** Dokumen di sini sengaja **tidak memuat angka keuangan,
> data gaji, isi kontrak investor, maupun rincian celah keamanan**. Hasil audit
> lengkap (dengan angka) disampaikan langsung ke owner dan tidak boleh
> di-commit ke repo mana pun. Aturan ini berlaku juga untuk semua dokumen
> modul Laporan Investor berikutnya.

## Keputusan owner yang sudah diambil (2026-10-10)

- **Cakupan track record = seluruh perusahaan**: semua proyek pembangunan
  (buku besar mkh-properti dan data konstruksi Mkhsistem) ditambah operasi
  properti (Loonars Villa), bukan hanya villa.
- **Loonars Villa buka resmi 23 Sep 2026.** September adalah bulan parsial dan
  wajib diberi label begitu di laporan.
- **Housekeeping villa dikerjakan pihak luar** → tidak dihitung sebagai
  headcount; biayanya diperlakukan sebagai biaya vendor.
- **Celah akses data yang terbuka untuk umum harus ditutup** (direncanakan
  bertahap agar aplikasi yang sedang dipakai tidak putus).

## Ringkasan temuan (kualitatif)

1. Jalur sinkronisasi gaji Mkhsistem → mkh-properti ada di kode tetapi belum
   pernah mengirim data; gaji dicatat lewat jalur lain di Mkhsistem yang tidak
   tersinkron. Rasio gaji terhadap pendapatan belum bisa dihitung dari buku besar.
2. Data karyawan cabang villa baru terisi Oktober 2026; headcount bulan
   sebelumnya tidak bisa direkonstruksi.
3. Definisi pendapatan villa berubah di awal Oktober 2026 (harga kotor →
   subtotal sebelum fee OTA untuk booking OTA). September dan Oktober tidak
   sebanding tanpa label.
4. Biaya operasional aktual villa belum tercatat di sistem mana pun; yang ada
   hanya persentase asumsi dalam rumus dividen (bukan biaya aktual).
5. Status unit "dijual/ditutup" per hari tidak disimpan, sehingga okupansi atas
   unit dijual tidak bisa dihitung mundur.
6. Buku besar proyek pembangunan sudah memuat sebagian besar data yang
   dibutuhkan, tetapi ada inkonsistensi yang harus dilaporkan apa adanya:
   kas proyek negatif di sebagian proyek, selisih biaya antara Mkhsistem dan
   buku besar untuk satu proyek, dan satu proyek (kafe) yang dibukukan di bawah
   kode proyek lain.
7. Riwayat buku besar dimulai Mei 2026 (beberapa saldo pembukaan Januari 2026).
   Sebelum itu: data belum tersedia.

## Desain yang direncanakan

Satu modul, tiga jenis unit bisnis dengan kontrak KPI masing-masing:

| Jenis | KPI utama | Sumber |
|---|---|---|
| `operasi_properti` | okupansi (atas unit total & unit dijual), ADR, RevPAR, porsi channel, booking, pendapatan kotor / basis investor / bersih, biaya operasi, kewajiban tetap investor, headcount agregat | snapshot bulanan dari sistem operasi + Mkhsistem + buku besar |
| `proyek_pembangunan` | anggaran vs realisasi, HPP per jenis, penjualan & uang muka, unit terjual, kas & utang proyek, progres fisik bila ada | buku besar mkh-properti (+ anggaran dari Mkhsistem) |
| `perusahaan` | laba rugi, posisi keuangan, arus kas (SAK EMKM) | mesin SAK EMKM yang sudah ada |

- Saat sebuah bulan difinalkan, angka dibekukan sebagai snapshot berversi
  (append-only). Koreksi = versi baru + log; laporan menandai angka yang pernah
  dikoreksi.
- Properti/proyek baru = satu baris data + satu sumber yang memenuhi kontrak;
  tidak ada nama properti yang di-hardcode di kode modul.
- Semua tabel modul hanya bisa dibaca CFO/owner yang login (`cfo_users`);
  tanpa policy untuk `anon`. PDF dibuat di server, tidak disimpan; setiap
  unduhan dicatat.
- Tidak ada data pribadi (tamu, nomor HP, rekening, KTP) di tabel modul;
  data karyawan hanya agregat.

## Status (2026-10-10)

- Tahap 1 (skema & penerima): migrasi `0040` diterapkan. RPC penerima
  `ir_metrik_terima` menolak kiriman tanpa rahasia; akses data hanya CFO.
- Tahap 2 (spesifikasi): `02-SPESIFIKASI-VILLA.md`, `03-SPESIFIKASI-MKHSISTEM.md`.
- Tahap 3–4 (UI & PDF): halaman `/laporan-investor`, PDF server
  `@react-pdf/renderer`, permintaan lewat WhatsApp `/api/laporan-investor/wa`.
- Tahap 5 (properti baru): menambah unit = satu baris `ir_unit_bisnis` lewat
  halaman modul; diuji dengan properti & proyek uji pada data contoh (bukan
  produksi) — laporan, kelengkapan, dan temuan tersusun tanpa perubahan kode.
- Modul **realtime** (keputusan owner): laporan selalu dihitung dari data
  terbaru; revisi angka kiriman sistem tersimpan di `ir_metrik_log` dan
  ditandai di laporan.
