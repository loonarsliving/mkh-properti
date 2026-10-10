# Laporan Investor — Spesifikasi sisi MK Connect (repo `Mkhsistem`)

_Status: spesifikasi saja. Tidak dikerjakan dari repo mkh-properti._
_Branch produksi Mkhsistem: `claude/mk-connect-app-o9zw2p` (bukan `main`)._
_Dokumen ini sengaja tanpa angka keuangan atau data pribadi (repo publik)._

Ada empat bagian. Semua kiriman ke mkh-properti memakai RPC
`ir_metrik_terima` (migrasi mkh-properti `0040`/`0041`) dengan header
**`x-sync-secret` yang sudah dipakai `sync_inbound`** — tidak ada rahasia
baru. Database hanya menerima sumber berawalan `mk-connect` dari rahasia ini.

## A. Headcount bulanan (event baru)

Tidak ada event setara yang sudah ada. Usulan: job bulanan (dan harian untuk
bulan berjalan) per cabang yang dipetakan ke unit bisnis.

```json
{
  "p_unit_kode": "loonars-1",
  "p_periode": "2026-10",
  "p_sumber": "mk-connect-hr",
  "p_versi_definisi": "v1",
  "p_status": "sementara",
  "p_metrik": {
    "headcount": { "Front Office": 0, "Security": 0, "Manajemen": 0 },
    "headcount_total": 0,
    "fungsi_outsourcing": ["Housekeeping"]
  }
}
```

- Hanya agregat: **tanpa nama, ID, nomor HP, rekening, atau gaji per orang.**
- Dihitung dari `employees`: `branch_id` = cabang unit, `is_active = true`,
  `approval_status = 'approved'`, `deleted_at is null`, dikelompokkan per
  `division_id`. Status `pending` tidak dihitung.
- Pemetaan cabang → unit bisnis disimpan di MK Connect (mis. kolom
  `branches.ir_unit_kode`), bukan di-hardcode.
- Housekeeping villa dikerjakan pihak luar (keputusan owner 2026-10-10) →
  dikirim di `fungsi_outsourcing`, bukan headcount.
- Perapian data yang perlu dilakukan dulu di MK Connect: divisi
  Manajemen villa masih 0 orang; `join_date` karyawan cabang villa tampaknya
  tanggal pendaftaran akun, bukan tanggal mulai kerja; `position_id` kosong.

## B. Agregat gaji per cabang (owner: "kepala cabang menginput, sistem harus menyimpan")

Gaji saat ini diinput Kepala Cabang lewat `employee_salary_submissions`
(migrasi 0189) dan **tidak tersinkron** ke mkh-properti; jalur
`payroll_runs`/`payroll_items` (0056) tidak dipakai. Owner memilih perbaikan
bertahap:

1. **Tahap sekarang** — kirim agregat bulanan per unit bisnis:
   ```json
   { "p_sumber": "mk-connect-gaji",
     "p_metrik": { "total_gaji": 0, "jumlah_penerima_gaji": 0 } }
   ```
   Laporan memberi label "di luar buku besar" dan tidak akan menjumlahkannya
   dengan jurnal gaji bila nanti ada.
2. **Tahap berikut** (butuh keputusan akun dari owner, menyentuh uang) — saat
   Super Admin menandai gaji `transferred`, kirim event ke `sync-inbound`
   agar dibukukan ke akun `6-1001 Gaji Staf` per proyek. Setelah itu buku
   besar menjadi sumber utama dan kiriman tahap 1 otomatis tidak dipakai.

## C. Anggaran & realisasi proyek pembangunan

Untuk `construction_projects` yang dipetakan ke unit bisnis (mis. Kendari →
`kdi`, Loonars Coffee → `lc`):

```json
{ "p_sumber": "mk-connect-konstruksi",
  "p_metrik": { "anggaran_total": 0, "realisasi_biaya": 0, "progres_fisik_pct": null } }
```

`realisasi_biaya` = total `construction_expenses` s.d. akhir bulan; laporan
membandingkannya dengan HPP buku besar dan menandai selisih.
`progres_fisik_pct` hanya dikirim bila ada penilaian lapangan
(`construction_progress_assessments`); jangan dikirim 0 bila belum dinilai.

Catatan: sejak migrasi mkh-properti `0038`, biaya Loonars Coffee otomatis
dibukukan ke proyek `LC`, dan event `construction_project_financial_record`
tidak lagi membuat jurnal ganda untuk biaya yang sudah dijurnal oleh
`construction_expense_submitted`. Tidak ada perubahan wajib di MK Connect
untuk itu; bila ingin rapi, kirim `mkh_project_code = 'LC'` untuk cabang
Loonars Coffee.

## D. Permintaan laporan lewat WhatsApp

Alur (owner: "saya sebagai super admin bisa WA ke nomor sistem, kemudian
sistem mengirimkan laporannya"):

1. Super admin mengirim pesan ke nomor WhatsApp sistem (Meta Cloud API,
   webhook `app/api/integrations/whatsapp/webhook`), misalnya:
   - `LAPORAN INVESTOR` → sejak data pertama s.d. bulan ini
   - `LAPORAN INVESTOR 2026-09` → satu bulan
   - `LAPORAN INVESTOR 2026-09 2026-12` → rentang
2. Handler pesan mengenali perintah itu **hanya** bila nomor pengirim milik
   karyawan dengan peran `super_admin` di MK Connect (fitur peran yang sudah
   ada). Pengirim lain mendapat balasan biasa / diabaikan; tidak ada daftar
   nomor terpisah di mkh-properti.
3. MK Connect memanggil server mkh-properti dengan rahasia sync yang sama
   seperti `sync_inbound`:
   ```
   POST https://finance.haluoleo.id/api/laporan-investor/wa
   x-sync-secret: <mk_sync_shared_secret yang sudah ada>
   Content-Type: application/json
   { "nomor": "62812…", "dari": "2026-09", "sampai": "2026-12" }
   ```
   Respons sukses: `200 application/pdf` (header `Content-Disposition` berisi
   nama berkas). `401` = rahasia salah.
4. MK Connect mengunggah PDF ke Meta (`POST /{phone-number-id}/media`) lalu
   mengirim pesan `type: document` dengan media id itu ke pengirim. Karena
   super admin yang memulai percakapan, balasan ada di dalam jendela 24 jam.
   **PDF tidak disimpan** di MK Connect (tidak di storage, tidak di log).
5. Bila gagal, balas teks singkat (mis. "Nomor Anda belum terdaftar sebagai
   penerima laporan" / "Laporan sedang tidak bisa dibuat, coba lagi").
6. Batasi frekuensi (mis. 5 permintaan / jam / nomor).

mkh-properti mencatat setiap kiriman di `ir_unduhan_log` (kanal `whatsapp`,
nomor peminta, parameter, hash SHA-256 PDF).
