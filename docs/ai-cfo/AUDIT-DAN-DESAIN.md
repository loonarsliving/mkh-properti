# AI CFO — Audit Supabase & Desain Integrasi (2026-11-01)

Dokumen ini adalah **DATABASE AUDIT OUTPUT** sebelum implementasi AI CFO,
disusun dari pemeriksaan langsung lewat Supabase MCP (hanya baca) dan dari
repositori `mkh-properti`, `Mkhsistem`, `villa`. Tidak ada credential yang
dicatat di sini.

## 1. Akses & autentikasi yang dipakai

| Jalur | Mekanisme | Status |
|---|---|---|
| Audit & migrasi (oleh Claude) | Supabase MCP resmi (organisasi `oldhfniywabyoczbqmhq`) | Tersedia, dipakai untuk audit read-only |
| Browser CFO → MKH Property | Supabase Auth access token; RLS + `mkh_is_cfo()` | Sudah ada |
| MK Connect → MKH Property | Header `x-sync-secret` = Vault `mk_sync_shared_secret` (ada di kedua database) | Sudah ada (sync_inbound, loonars2_wa, laporan investor) |
| villa-api → MKH Property | Header `x-villa-sync-secret`/`x-sync-secret` = Vault `villa_sync_shared_secret` | Sudah ada (laporan villa, metrik) |
| pg_cron MKH Property → app/MK Connect | `net.http_post` + `mk_sync_shared_secret` | Sudah ada (loonars2 outbox) |

**Tidak ada rahasia baru, tidak ada service_role di frontend/repo.** AI CFO
memakai jalur di atas apa adanya. Env opsional: `GEMINI_API_KEY` (narasi AI
di server Vercel; tanpa itu AI CFO tetap menjawab secara deterministik).

## 2. Project Supabase per repo

| Repo | Project | Catatan |
|---|---|---|
| `mkh-properti` (MKH Property) | `gluoioiimapyhchdasfl` | Buku besar MKH (`jurnal`), modul Loonars 2 (`loonars2_*`), laporan villa (`laporan_villa_bulanan`), laporan investor (`ir_*`) |
| `Mkhsistem` (MK Connect) | `svcmybsziaelwwdrnzcv` | **Dipakai bersama** dengan villa. CRM, siteplan & penjualan unit, refund, konstruksi, chat, WA, FRIDAY |
| `villa` (Loonars 1) | `svcmybsziaelwwdrnzcv` | Booking, transaksi, settlement OTA, pengajuan biaya villa; backend `villa-api` (Edge Function) |

## 3. Sumber transaksi aktual per lini

### Loonars 1 — Hospitality (sumber: villa)
- `laporan_villa_bulanan` (MKH Property) — dikirim villa-api tiap malam: omzet
  kotor, komisi OTA, bersih, COGS standar, OPEX (gaji), laba, per channel, bagi
  hasil investor 70/30 + top-up jaminan. **Acuan Loonars 1** (rumus = halaman
  Finance villa).
- `ir_metrik_bulanan` (unit `loonars-1`) — KPI okupansi/ADR/RevPAR bulanan.
- `pajak_hotel_villa` — PBJT terutang & setoran.
- Di svcmyb: `finance_settlements` (piutang OTA), `villa_pengajuan_biaya`
  (biaya villa belum ditransfer) → disalin sebagai snapshot (lihat §6).
- **Belum ada:** saldo/mutasi rekening villa → kas Loonars 1 "tidak tersedia".

### Loonars 2 — Developer & Konstruksi (sumber: Mkhsistem + modul 4 rekening)
- `loonars2_units` / `loonars2_v_unit` (17 unit, harga, biaya bangun, buffer,
  fee, terpakai konstruksi, sisa tagihan) — modul keuangan di MKH Property.
- `loonars2_receipts` (cash-in investor → rekening A), `loonars2_allocations`,
  `loonars2_disbursements` (C: material/tukang/lain_konstruksi/fee, B: tanah,
  D: profit; `talangan` = dana owner), `loonars2_v_rekening` (saldo dari buku
  besar), `loonars2_utang_toko`, `loonars2_cicilan`, `loonars2_v_toko`.
- Di svcmyb: `loonars_unit_purchases` (siteplan; LNR2) → snapshot
  `investor_penjualan` untuk rekonsiliasi.
- `jurnal` proyek `LL` (Loonars Living) — buku besar MKH; ditampilkan terpisah
  dari modul 4 rekening karena hubungannya belum dipastikan (cegah hitung ganda).

### Grup MKH (di luar Loonars, ikut Debt Center)
- `utang_bank` (Kredit Konstruksi BTN proyek AFP), `pengajuan` pending.
- Di svcmyb: `mkc_refund_customers` + `mkc_refund_installments`,
  `finance_pending_transfers` → snapshot.

## 4. Temuan audit (data produksi, 2026-11-01, baca saja)

1. **Penjualan Loonars 2 belum tersinkron.** Siteplan MK Connect: 2 unit LNR2
   terverifikasi terjual (BANYU-06, AVARA-06; total harga Rp 840 jt; BF + DP
   Rp 425 jt). Modul Loonars 2 di MKH Property: 0 unit terjual, 0 penerimaan.
   → rekonsiliasi `l2_unit_terjual`, `l2_nilai_kontrak`, `l2_cash_in` akan
   menampilkan selisih begitu snapshot aktif.
2. **Rekening C (konstruksi) saldo −Rp 123.992.000** — seluruhnya pengeluaran
   bertanda talangan (dana owner). Disajikan sebagai utang proyek ke owner.
3. **7 unit dibangun tanpa pembeli tercatat** (AVARA-01..06 + BANYU-01),
   ± Rp 220 jt terpakai (termasuk utang toko). AVARA-06 sebenarnya sudah
   terjual di siteplan — bagian dari temuan #1.
4. Utang toko bangunan disetujui ± Rp 143,6 jt; cicilan dibayar Rp 44,2 jt.
5. Villa November (berjalan): top-up jaminan investor > bagian pengelola →
   bagian MKH negatif (sementara).
6. Utang bank AFP Rp 1,49 M jatuh tempo 2026-12-31, terbayar 0 (grup MKH).
7. Refund customer: 20 customer, ±131 termin belum dibayar (Rp ±3,5 M s.d. 2029).
8. Sewa tanah Loonars 2 Rp 1 M jatuh tempo 2027-10-11, belum ada pembayaran
   kategori tanah.

## 5. RLS & keamanan

- Semua tabel keuangan MKH Property RLS aktif; anon dicabut sejak 0037.
- Tabel baru 0057 (`cfo_*`): RLS aktif, SELECT hanya CFO, tulis hanya lewat RPC
  security definer; `cfo_audit_log` append-only (trigger menolak UPDATE/DELETE).
- `cfo_ambil_data` tidak mengembalikan nomor rekening, NIK, telepon, alamat.
- Sender di svcmyb (Mkhsistem 0308) tidak mengirim NIK/telepon/alamat pembeli,
  nomor rekening refund, atau rekening tujuan transfer.
- AI CFO tidak memiliki RPC apa pun yang menulis ke jurnal/loonars2/pengajuan:
  **tidak bisa memindahkan uang atau mengubah transaksi**.

## 6. Integrasi lintas project yang dibangun

```
svcmyb (MK Connect + villa)                         gluoioiimapyhchdasfl (MKH Property)
pg_cron 11,41 * * * *                                
cfo_kirim_snapshot_mkh()  ── net.http_post ──────▶  RPC cfo_sumber_terima(p_jenis, p_baris, p_lengkap)
  (x-sync-secret = mk_sync_shared_secret,            → cfo_sumber_snapshot (source_id + hash, aktif)
   URL & anon key dari sync_config)                  → cfo_sync_log
villa-api (sudah ada) ─ harian ─────────────────▶  laporan_villa_bulanan, ir_metrik_bulanan

pg_cron MKH Property (harian/mingguan/6 jam)
cfo_briefing_bangunkan() ── POST /api/cfo/briefing ─▶ src/lib/cfo (deterministik) → teks
                                                     → RPC cfo_briefing_antre → loonars2_outbox
MK Connect /api/loonars2/outbox (sudah ada) ◀── pg_cron loonars2-outbox ── kirim via Whacenter

Owner WA → MK Connect owner-assistant (tool ai_cfo) ─▶ POST /api/cfo/tanya-wa (x-sync-secret)
Owner web → /cfo/chat ─▶ POST /api/cfo/chat (token CFO)
```

- **Incremental sync & dedup:** kunci (sumber, jenis, source_id); isi di-hash;
  hanya baris berubah yang diperbarui; `p_lengkap` menandai baris hilang
  sebagai nonaktif (tidak dihapus); setiap kiriman tercatat di `cfo_sync_log`.
- **Pengirim ditentukan rahasia**, bukan klaim: rahasia MK Connect → sumber
  `svcmyb`; rahasia villa → `villa_api` (hanya jenis villa).

## 7. Prinsip perhitungan

- Semua angka di `src/lib/cfo/` (fungsi murni, diuji vitest 30 kasus):
  laporan L1/L2, konsolidasi, forecast harian/13 minggu/bulanan × 3 skenario,
  kewajiban & prioritas, peringatan, rekonsiliasi, CEO challenger.
- AI (Gemini, opsional) hanya menarasikan **daftar fakta bernomor**; setiap
  nominal rupiah di jawaban AI divalidasi terhadap fakta — bila ada angka di
  luar fakta, jawaban AI ditolak dan jawaban deterministik yang ditampilkan.
- Cash-in investor = uang muka (liabilitas kontrak) sampai serah terima;
  tidak pernah dicampur dengan pendapatan operasional hospitality.
- Hospitality Loonars 2 belum beroperasi → tidak ada pendapatan sewa L2.

## 8. Yang masih butuh keputusan/aksi owner

1. Persetujuan menerapkan migrasi **mkh-properti 0057** dan **Mkhsistem 0308**
   ke produksi (skema baru; sesuai CLAUDE.md wajib persetujuan owner).
2. Mencatat penjualan BANYU-06 & AVARA-06 (pembeli, harga, BF, DP) di modul
   Loonars 2 — AI CFO tidak mengubah data sumber.
3. Opsional: isi `GEMINI_API_KEY` di proyek Vercel `haluoleofinance` agar
   jawaban chat dinarasikan AI (tanpa itu tetap berfungsi deterministik).
4. Menyambungkan saldo rekening villa (Loonars 1) bila kas L1 ingin dihitung.
5. Memastikan hubungan rekening fisik A–D (modul Loonars 2) dengan akun bank
   jurnal proyek LL (saat ini diasumsikan berbeda).
