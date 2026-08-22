# MKH Property — Sistem Keuangan

Aplikasi keuangan internal **PT. Maha Karya Haluoleo**: buku besar, pengajuan &
verifikasi pengeluaran, aset/unit properti, utang bank, gaji tukang borongan,
dan laporan keuangan berbasis **SAK EMKM**.

Dibangun dengan **Next.js 15 (App Router) + TypeScript + Tailwind CSS**, memanggil
**Supabase** (PostgREST, Auth, dan dua Edge Function) langsung dari browser.

> Versi sebelumnya berupa 10 halaman HTML statis; arsipnya ada di
> `docs/legacy-html/` beserta peta halaman lama → route baru.

## Menjalankan secara lokal

```bash
npm install
cp .env.example .env.local   # opsional, ada nilai bawaan
npm run dev                  # http://localhost:3000
```

Perintah lain:

```bash
npm run build      # build produksi
npm run start      # jalankan hasil build
npm run lint       # ESLint (eslint-config-next)
npm run typecheck  # tsc --noEmit
```

## Struktur

```
src/
  app/
    (app)/            # semua halaman yang butuh login (sidebar + filter periode)
    login/            # halaman masuk
    no-access/        # akses ditolak
    lapor-*/          # tiga form lapor lapangan (tanpa login)
  components/
    shell/            # sidebar, topbar, provider periode/data/sesi
    ui/               # ikon, kartu, form, tabel, toast
    laporan/          # lembar laporan SAK EMKM & kwitansi (siap cetak)
    lapor/            # form lapor lapangan bersama
  lib/
    supabase.ts       # wrapper PostgREST
    auth.ts           # guard + resolusi peran (cfo / admin-proyek / verifikator)
    master.ts         # COA, daftar proyek, cabang, pemetaan rekening
    periode.ts        # pemilihan periode (rentang bulan & setahun penuh)
    transaksi.ts      # aturan penulisan jurnal
    akuntansi/        # mesin saldo + penyusun laporan SAK EMKM
supabase/
  migrations/         # SQL, diterapkan manual via Supabase CLI
  functions/          # Edge Function (Deno)
docs/project-memory/  # dokumentasi arsitektur & operasional
docs/legacy-html/     # arsip versi HTML lama
```

## Peran pengguna

| Peran | Ditentukan oleh | Halaman utama |
|---|---|---|
| CFO / Owner | terdaftar di tabel `cfo_users` | `/` |
| Admin proyek | `users_proyek.proyek_id` = kode proyek | `/admin-proyek` |
| Verifikator / Manager | `users_proyek.proyek_id` = `MANAGER` atau `VERIFIKATOR_*` | `/verifikasi` |

Pengguna yang tidak masuk kategori mana pun diarahkan ke `/no-access`.

## Laporan SAK EMKM

SAK EMKM mewajibkan **tiga** laporan: Posisi Keuangan, Laba Rugi, dan Catatan
atas Laporan Keuangan. Ketiganya selalu tersedia. Laporan **Perubahan Ekuitas**
dan **Arus Kas** disediakan sebagai tambahan opsional (keduanya syarat SAK ETAP,
bukan SAK EMKM) dan ditandai jelas di antarmuka.

Periode bisa dipilih sebagai **rentang bulan bebas** (mis. Maret 2026 s.d.
Agustus 2026) atau **satu tahun penuh**. Laba rugi memakai mutasi dalam periode;
neraca memakai saldo kumulatif sejak awal berdiri sampai akhir periode.

## Basis data

Skema Supabase **tidak diubah** oleh migrasi ini — aplikasi baru membaca dan
menulis tabel yang sama persis (`jurnal`, `pengajuan`, `aset`, `utang_bank`,
`tukang_borongan`, `bayar_tukang`, `users_proyek`, `cfo_users`,
`crm_payment_receipts`, `karyawan`, `slip_gaji`) dengan nama kolom yang sama.

Migrasi SQL di `supabase/migrations/` **tidak berjalan otomatis** saat deploy —
harus di-push manual dengan Supabase CLI. Baca `docs/project-memory/DEPLOYMENT.md`
sebelum menerapkan apa pun ke produksi.
