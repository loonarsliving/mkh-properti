# Laporan Investor — Spesifikasi sisi Villa (repo `villa`)

_Status: spesifikasi saja. Tidak dikerjakan dari repo mkh-properti._
_Dokumen ini sengaja tanpa angka keuangan (repo publik)._

## Tujuan

Sistem villa mendorong **KPI operasi per bulan** ke mkh-properti lewat RPC
`ir_metrik_terima` (migrasi mkh-properti `0040`). mkh-properti tidak membaca
database villa secara langsung. Modulnya **realtime**: kiriman ulang untuk
bulan yang sama menimpa angka sebelumnya, dan versi lamanya otomatis
tersimpan di `ir_metrik_log` (laporan menandai bulan yang pernah direvisi).

## Pemanggilan

```
POST https://<proyek-mkh>.supabase.co/rest/v1/rpc/ir_metrik_terima
apikey: <anon key mkh-properti>          (sama seperti villa_income_sync)
Authorization: Bearer <anon key mkh-properti>
x-villa-sync-secret: <rahasia yang SUDAH dipakai villa_income_sync (integration_settings.mkh_finance_bridge.secret)>
Content-Type: application/json

{
  "p_unit_kode": "loonars-1",          // = finance_property_config.property_code
  "p_periode": "2026-10",
  "p_sumber": "villa-api",
  "p_versi_definisi": "v1",
  "p_status": "sementara" | "final",
  "p_dihitung_pada": "<ISO timestamp>",
  "p_metrik": { ...kunci kontrak v1... }
}
```

- Kunci di luar kontrak **ditolak** oleh database (perlindungan data pribadi).
- Jadwal yang disarankan: **harian** untuk bulan berjalan (`sementara`) dan
  sekali setelah tutup bulan (`final`). Kiriman ulang aman (upsert).
- Tidak ada rahasia/konfigurasi baru: pakai jembatan `mkh_finance_bridge`
  yang sudah ada (base URL diganti ke `rpc/ir_metrik_terima`). Database hanya
  menerima sumber berawalan `villa` dari rahasia ini (migrasi 0041).

## Tidak menyentuh fitur investor villa

Pekerjaan ini **hanya menambah** satu pemanggilan keluar. Halaman investor,
perhitungan dividen (`computeReport`, rumus beku PHASE0-BASELINE §2), cron
daftar dividen, dan `villa_income_sync` tidak diubah. Fungsi yang dipakai
hanya dipanggil (dibaca), tidak dimodifikasi.

## Pemetaan kunci → fungsi villa-api yang SUDAH ADA (jangan implementasi ulang)

| Kunci kontrak | Sumber di villa-api (terverifikasi dari kode ter-deploy) |
|---|---|
| `pendapatan_kotor`, `pendapatan_bersih`, `malam_terjual`, `booking_diakui` | `computeNetRevenueForRange(awal, akhir)` → `gross_revenue`, `net_revenue`, `room_nights`, `booking_count` (pengakuan per `tgl_checkin`, status `STATUS_PEMASUKAN_DIAKUI`, sama dengan `isPemasukanDiakui`) |
| `pendapatan_basis_investor`, `kewajiban_investor_jaminan` | `computeReport(undefined, periode)` → `gross_revenue`, `jaminan_topup` (× unit sesuai rumus beku PHASE0-BASELINE §2 — **tidak diubah**) |
| `pendapatan_walkin` | `computeWalkinIncome(periode).total` |
| `malam_tersedia_total`, `okupansi_unit_total_pct` | `computeOccupiedRoomNights(awal, akhir)` → `availableRoomNights`, `occupiedRoomNights` |
| `adr_kotor/bersih`, `revpar_kotor/bersih` | dibagi dari angka di atas (definisi di kontrak) |
| `channel`, `porsi_ota_pct`, `porsi_langsung_pct` | rekap `bookings.sumber` dengan `normalizedChannel()` (diakui saja) |
| `booking_batal` | `bookings.status = 'batal'` per bulan `tgl_checkin` |
| `booking_pra_buka` | booking diakui dengan `tgl_checkin` < tanggal buka resmi (23 Sep 2026) |
| `kewajiban_investor_tetap` | jumlah `villa_investor_terms.pemasukan_tetap` yang aktif pada bulan itu |
| `unit_total` | jumlah `units` |
| `unit_dijual`, `malam_tersedia_dijual`, `okupansi_unit_dijual_pct` | **perlu data baru** (lihat bawah) |
| `hari_operasi` | hari dalam bulan sejak tanggal buka |

Aturan yang wajib dihormati:
- Tamu dihitung dari `bookings`, **bukan** dari `guests` (duplikat).
- Tidak ada metrik retensi dari nomor HP (Booking.com/Traveloka tidak mengirim).
- Tiga basis pendapatan (kotor / basis investor / bersih) dikirim terpisah,
  tidak pernah dicampur.

## Data baru yang dibutuhkan: status unit dijual per hari

`villa_daily_inventory_snapshot` saat ini selalu mencatat semua unit dan tidak
menyimpan unit yang **ditutup di Cloudbeds** (room block) atau maintenance.
Tanpa itu okupansi atas unit dijual tidak bisa dihitung, termasuk mundur.

Usulan (opsional; perubahan skema villa — butuh persetujuan owner dan tidak
boleh mengganggu fitur investor): tambah kolom
`dijual boolean` (atau `ditutup_alasan text`) ke snapshot harian, diisi dari
`unitMaintenanceBentrok()` / room block Cloudbeds yang sudah dibaca villa-api
saat snapshot dibuat. `unit_dijual` bulanan = rata-rata unit dijual per hari;
`malam_tersedia_dijual` = jumlah baris `dijual = true`.

## Koreksi September 2026

Angka rental September yang sudah tersinkron (via `villa_income_sync`) memakai
harga kotor, karena `villa_commit_checkin` baru memakai `cloudbeds_subtotal`
mulai 5 Okt 2026. Saat kiriman pertama `ir_metrik_terima` untuk 2026-09:
- kirim `pendapatan_basis_investor` sesuai yang benar-benar dipakai untuk
  dividen bulan itu, dan
- jelaskan perbedaan definisi di `catatan_sumber`.
Laporan akan menampilkan perbedaan antara kedua kiriman apa adanya.
