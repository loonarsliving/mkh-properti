# Arsip halaman HTML lama

Folder ini menyimpan **versi lama** aplikasi MKH Property: 10 halaman HTML statis
yang berdiri sendiri, masing-masing dengan `<style>` dan `<script>` inline dan
memanggil Supabase langsung dari browser.

Seluruh fungsinya sudah dipindahkan ke aplikasi Next.js di `/src`. Berkas di sini
**tidak lagi disajikan ke pengguna** — folder `docs/` bukan direktori publik
Next.js — dan hanya disimpan sebagai rujukan sejarah saat menelusuri perilaku
lama sebuah fitur.

## Peta halaman lama → route baru

| Halaman lama | Route Next.js |
|---|---|
| `index.html` | `/` (dashboard) + `/kas-masuk`, `/kas-keluar`, `/aset`, `/pinjam-antar-proyek`, `/utang-bank`, `/gaji-tukang`, `/jurnal`, `/neraca-saldo`, `/laba-rugi`, `/posisi-keuangan`, `/coa`, `/users` |
| `login.html` | `/login` |
| `no-access.html` | `/no-access` |
| `admin-proyek.html` | `/admin-proyek` |
| `pengeluaran.html` | `/pengeluaran` |
| `verifikasi.html` | `/verifikasi` |
| `laporan-keuangan.html` | `/laporan-keuangan` |
| `lapor-pengeluaran.html` | `/lapor-pengeluaran` |
| `lapor-biaya-lain.html` | `/lapor-biaya-lain` |
| `lapor-biaya-lain-makassar.html` | `/lapor-biaya-lain-makassar` |

URL lama berakhiran `.html` tetap hidup: `next.config.mjs` mengarahkannya
(HTTP 308) ke route baru, sehingga tautan yang sudah dibagikan lewat WhatsApp
atau di-bookmark staf lapangan tidak mati.

`IMG_0966.png` dan `IMG_1739.png` adalah logo yang dipakai kwitansi versi lama;
salinannya kini ada di `public/logo-mkh.png` dan `public/logo-loonars.png`.

## PERINGATAN KEAMANAN

`verifikasi.html` dan `admin-proyek.html` di folder ini memuat **bot token
Telegram yang di-hardcode**. Token itu sengaja TIDAK disalin ke kode Next.js
(lihat `src/lib/notifikasi.ts`). Karena token tersebut sudah pernah ter-commit
dan terkirim ke setiap browser yang membuka halaman lama, **token itu harus
dianggap bocor dan wajib dirotasi lewat @BotFather.**
