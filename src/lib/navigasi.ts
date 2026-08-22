import type { NamaIkon } from '@/components/ui/Icon';
import type { Peran } from './auth';

export interface ItemNav {
  label: string;
  href: string;
  ikon: NamaIkon;
  /** Peran yang boleh melihat menu ini. */
  peran: Peran[];
}

export interface GrupNav {
  judul: string;
  item: ItemNav[];
}

const CFO: Peran[] = ['cfo'];
const SEMUA: Peran[] = ['cfo', 'admin-proyek', 'verifikator'];

/**
 * Struktur menu sidebar. Mengikuti pengelompokan tampilan referensi
 * (bagian bertajuk huruf kapital kecil), tetapi isinya adalah modul MKH
 * yang benar-benar ada — tidak ada menu yang mengarah ke fitur fiktif.
 */
export const NAVIGASI: GrupNav[] = [
  {
    judul: '',
    item: [{ label: 'Dashboard Utama', href: '/', ikon: 'dashboard', peran: CFO }],
  },
  {
    judul: 'Penjualan & Piutang',
    item: [
      { label: 'Kas Masuk', href: '/kas-masuk', ikon: 'kas-masuk', peran: CFO },
      { label: 'Aset & Unit Properti', href: '/aset', ikon: 'rumah', peran: CFO },
      { label: 'Piutang Antar Proyek', href: '/pinjam-antar-proyek', ikon: 'transfer', peran: CFO },
    ],
  },
  {
    judul: 'Transaksi, Bank & Kas',
    item: [
      { label: 'Kas Keluar', href: '/kas-keluar', ikon: 'kas-keluar', peran: CFO },
      { label: 'Input Pengeluaran', href: '/pengeluaran', ikon: 'dokumen', peran: ['cfo', 'admin-proyek'] },
      { label: 'Verifikasi Pengajuan', href: '/verifikasi', ikon: 'ceklis', peran: ['cfo', 'verifikator'] },
      { label: 'Utang Bank', href: '/utang-bank', ikon: 'bank', peran: CFO },
      { label: 'Jurnal Umum (GL)', href: '/jurnal', ikon: 'buku', peran: CFO },
    ],
  },
  {
    judul: 'Proyek & Tenaga Kerja',
    item: [
      { label: 'Dashboard Proyek', href: '/admin-proyek', ikon: 'grafik', peran: ['cfo', 'admin-proyek'] },
      { label: 'Gaji Tukang Borongan', href: '/gaji-tukang', ikon: 'palu', peran: CFO },
    ],
  },
  {
    judul: 'Laporan SAK EMKM',
    item: [
      { label: 'Laporan Keuangan', href: '/laporan-keuangan', ikon: 'printer', peran: CFO },
      { label: 'Neraca Saldo', href: '/neraca-saldo', ikon: 'coa', peran: CFO },
      { label: 'Laba Rugi', href: '/laba-rugi', ikon: 'grafik', peran: CFO },
      { label: 'Posisi Keuangan', href: '/posisi-keuangan', ikon: 'kotak', peran: CFO },
    ],
  },
  {
    judul: 'Master & Pengaturan',
    item: [
      { label: 'Bagan Akun (COA)', href: '/coa', ikon: 'coa', peran: CFO },
      { label: 'Pengguna & Akses', href: '/users', ikon: 'orang-grup', peran: CFO },
    ],
  },
  {
    judul: 'Form Lapor Lapangan',
    item: [
      { label: 'Lapor Pengeluaran', href: '/lapor-pengeluaran', ikon: 'kirim', peran: SEMUA },
      { label: 'Lapor Biaya Lain', href: '/lapor-biaya-lain', ikon: 'kirim', peran: SEMUA },
      { label: 'Lapor Biaya Makassar', href: '/lapor-biaya-lain-makassar', ikon: 'kirim', peran: SEMUA },
    ],
  },
];

export function navigasiUntuk(peran: Peran): GrupNav[] {
  return NAVIGASI.map((g) => ({ ...g, item: g.item.filter((i) => i.peran.includes(peran)) })).filter(
    (g) => g.item.length > 0,
  );
}
