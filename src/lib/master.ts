import type { Akun, Branch, Proyek } from '@/types';

/**
 * Master data yang sebelumnya diduplikasi di index.html, laporan-keuangan.html,
 * admin-proyek.html, dan pengeluaran.html. Sekarang satu sumber kebenaran.
 *
 * PENTING: `kode` akun adalah nilai yang benar-benar tersimpan di kolom
 * `jurnal.akun` di database. Kode TIDAK BOLEH diubah — hanya label tampilan
 * yang boleh berubah. `nama` dipakai di layar operasional (sama seperti
 * index.html lama), `namaLaporan` dipakai di laporan keuangan formal (sama
 * seperti laporan-keuangan.html lama).
 */

export const PROYEK: Proyek[] = [
  { id: 'AFP', nama: 'Al Fath Puuwatu', rek: '1901 8811 4444 1', bank: 'BSI', warna: '#f0a500' },
  { id: 'IH', nama: 'Introvert House', rek: '4420 1881 4099 04', bank: 'BSI', warna: '#00b894' },
  { id: 'LL', nama: 'Loonars Living', rek: '7801 8800 0168 1', bank: 'BSI', warna: '#a78bfa' },
  { id: 'GCI', nama: 'Griya Cariu Indah', rek: '5018 8000 2715', bank: 'BSI', warna: '#38bdf8' },
  { id: 'GCR', nama: 'Green Cibarusah Residence', rek: '7801880001681', bank: 'BTN', warna: '#ec4899' },
  {
    id: 'HO',
    nama: 'Kantor Pusat / Overhead (HR, Komisi, dll)',
    rek: '1-1001',
    bank: 'Kas',
    warna: '#64748b',
  },
];

/** Pengelompokan cabang — murni lapisan presentasi dashboard, bukan aturan akuntansi. */
export const BRANCHES: Branch[] = [
  { id: 'KDI', nama: 'Kendari', warna: '#f0a500', proyekIds: ['AFP'] },
  { id: 'MKS', nama: 'Makassar', warna: '#00b894', proyekIds: ['IH'] },
  { id: 'JOG', nama: 'Jogja', warna: '#a78bfa', proyekIds: ['LL'] },
  { id: 'JBD', nama: 'Jabodetabek', warna: '#38bdf8', proyekIds: ['GCI', 'GCR'] },
];

/** Rekening bank khusus tiap proyek. HO tidak punya bank sendiri (pakai kas tunai). */
export const REK_COA: Record<string, string> = {
  AFP: '1-1002',
  IH: '1-1003',
  LL: '1-1004',
  GCI: '1-1005',
  GCR: '1-1008',
};

export const COA: Akun[] = [
  { kode: '1-1001', nama: 'Kas Tunai', namaLaporan: 'Kas dan Setara Kas', kat: 'Aset Lancar', tipe: 'D' },
  { kode: '1-1002', nama: 'Bank Al Fath Puuwatu', namaLaporan: 'Bank Al Fath Puuwatu', kat: 'Aset Lancar', tipe: 'D', rek: '1901 8811 4444 1' },
  { kode: '1-1003', nama: 'Bank Introvert House', namaLaporan: 'Bank Introvert House', kat: 'Aset Lancar', tipe: 'D', rek: '4420 1881 4099 04' },
  { kode: '1-1004', nama: 'Bank Loonars Living', namaLaporan: 'Bank Loonars Living', kat: 'Aset Lancar', tipe: 'D', rek: '7801 8800 0168 1' },
  { kode: '1-1005', nama: 'Bank Griya Cariu Indah', namaLaporan: 'Bank Griya Cariu Indah', kat: 'Aset Lancar', tipe: 'D', rek: '5018 8000 2715' },
  { kode: '1-1008', nama: 'Bank Green Cibarusah Residence', namaLaporan: 'Bank Green Cibarusah Residence', kat: 'Aset Lancar', tipe: 'D', rek: '7801880001681' },
  { kode: '1-1006', nama: 'Piutang Antar Proyek', namaLaporan: 'Piutang Antar Proyek', kat: 'Aset Lancar', tipe: 'D' },
  { kode: '1-1007', nama: 'Piutang Pembeli', namaLaporan: 'Piutang Usaha', kat: 'Aset Lancar', tipe: 'D' },
  { kode: '1-2001', nama: 'Tanah', namaLaporan: 'Tanah', kat: 'Aset Tetap', tipe: 'D' },
  { kode: '1-2002', nama: 'Bangunan / Konstruksi', namaLaporan: 'Bangunan dan Konstruksi', kat: 'Aset Tetap', tipe: 'D' },
  { kode: '1-2003', nama: 'Peralatan', namaLaporan: 'Peralatan', kat: 'Aset Tetap', tipe: 'D' },
  { kode: '2-1001', nama: 'Utang Usaha Distributor', namaLaporan: 'Utang Usaha', kat: 'Liabilitas Lancar', tipe: 'K' },
  { kode: '2-1002', nama: 'Utang Antar Proyek', namaLaporan: 'Utang Antar Proyek', kat: 'Liabilitas Lancar', tipe: 'K' },
  { kode: '2-1003', nama: 'Uang Muka Pembeli', namaLaporan: 'Uang Muka Pelanggan', kat: 'Liabilitas Lancar', tipe: 'K' },
  { kode: '2-1004', nama: 'Utang Bank', namaLaporan: 'Utang Bank Jangka Pendek', kat: 'Liabilitas Lancar', tipe: 'K' },
  { kode: '2-2001', nama: 'KPR / Utang Jk Panjang', namaLaporan: 'Utang Bank Jangka Panjang', kat: 'Liabilitas Panjang', tipe: 'K' },
  { kode: '3-1001', nama: 'Modal Pemilik', namaLaporan: 'Modal Disetor', kat: 'Ekuitas', tipe: 'K' },
  { kode: '3-1002', nama: 'Laba Ditahan', namaLaporan: 'Saldo Laba (Rugi) Ditahan', kat: 'Ekuitas', tipe: 'K' },
  { kode: '4-1001', nama: 'Penjualan Rumah', namaLaporan: 'Pendapatan Penjualan Rumah', kat: 'Pendapatan', tipe: 'K' },
  { kode: '4-1002', nama: 'Uang Muka Penjualan', namaLaporan: 'Pendapatan Uang Muka', kat: 'Pendapatan', tipe: 'K' },
  { kode: '4-1003', nama: 'Pendapatan Lain', namaLaporan: 'Pendapatan Lain-lain', kat: 'Pendapatan', tipe: 'K' },
  { kode: '5-1001', nama: 'Pembelian Material', namaLaporan: 'Beban Pembelian Material', kat: 'HPP', tipe: 'D' },
  { kode: '5-1002', nama: 'Bayar Distributor', namaLaporan: 'Beban Pembayaran Distributor', kat: 'HPP', tipe: 'D' },
  { kode: '5-1003', nama: 'Biaya Upah Tukang', namaLaporan: 'Beban Upah Tenaga Kerja', kat: 'HPP', tipe: 'D' },
  { kode: '5-1004', nama: 'Biaya Subkontraktor', namaLaporan: 'Beban Subkontraktor', kat: 'HPP', tipe: 'D' },
  { kode: '5-1005', nama: 'Biaya Overhead Proyek', namaLaporan: 'Beban Overhead Proyek', kat: 'HPP', tipe: 'D' },
  { kode: '6-1001', nama: 'Gaji Staf', namaLaporan: 'Beban Gaji dan Tunjangan', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1002', nama: 'Sewa Kantor', namaLaporan: 'Beban Sewa', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1003', nama: 'Listrik & Air', namaLaporan: 'Beban Utilitas', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1004', nama: 'Transportasi', namaLaporan: 'Beban Transportasi', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1005', nama: 'Perizinan & Notaris', namaLaporan: 'Beban Perizinan dan Notaris', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1006', nama: 'Biaya Pemasaran', namaLaporan: 'Beban Pemasaran', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1007', nama: 'Beban Lain-lain', namaLaporan: 'Beban Lain-lain', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1008', nama: 'Komisi Sales', namaLaporan: 'Beban Komisi Sales', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1009', nama: 'Bonus Karyawan', namaLaporan: 'Beban Bonus Karyawan', kat: 'Beban Operasional', tipe: 'D' },
  { kode: '6-1010', nama: 'Reimbursement Karyawan', namaLaporan: 'Beban Reimbursement Karyawan', kat: 'Beban Operasional', tipe: 'D' },
];

const COA_INDEX = new Map(COA.map((a) => [a.kode, a]));

export function getAkun(kode: string): Akun | undefined {
  return COA_INDEX.get(kode);
}

export function getProyek(id: string): Proyek {
  return PROYEK.find((p) => p.id === id) ?? { id: '-', nama: '-', rek: '', bank: '', warna: '#888' };
}

/** Akun kas & bank — dipakai untuk total kas dan laporan arus kas. */
export const AKUN_KAS = ['1-1001', '1-1002', '1-1003', '1-1004', '1-1005', '1-1008'];
