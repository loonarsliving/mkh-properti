/**
 * Logika khusus dashboard admin proyek — dipisahkan dari komponen supaya
 * aturan akuntansinya mudah dibaca dan tidak tercampur dengan tampilan.
 * Semua pemetaan akun disalin apa adanya dari admin-proyek.html.
 */

import type { Jurnal } from '@/types';
import { REK_COA } from './master';

export const AKUN_PENDAPATAN = ['4-1001', '4-1002', '4-1003'];
export const AKUN_BAHAN = ['5-1001', '5-1002'];
export const AKUN_TUKANG = ['5-1003', '5-1004'];

/** Akun yang tampil di tab "Kas Keluar Umum". */
export const AKUN_KAS_KELUAR_UMUM = [
  '5-1004',
  '5-1005',
  '6-1001',
  '6-1002',
  '6-1003',
  '6-1004',
  '6-1005',
  '6-1006',
  '6-1007',
];

export const JENIS_BAHAN = [
  { akun: '5-1001', nama: 'Pembelian Material' },
  { akun: '5-1002', nama: 'Bayar Distributor' },
];

export const JENIS_KAS_KELUAR_UMUM = [
  { akun: '6-1004', nama: 'Transportasi' },
  { akun: '6-1003', nama: 'Listrik & Air' },
  { akun: '6-1001', nama: 'Gaji Staf' },
  { akun: '6-1002', nama: 'Sewa Kantor' },
  { akun: '6-1005', nama: 'Perizinan & Notaris' },
  { akun: '6-1006', nama: 'Biaya Pemasaran' },
  { akun: '5-1004', nama: 'Biaya Subkontraktor' },
  { akun: '5-1005', nama: 'Biaya Overhead Proyek' },
  { akun: '6-1007', nama: 'Beban Lain-lain' },
];

export const JENIS_PENERIMAAN = [
  'Uang Muka / DP',
  'Cicilan Pembeli',
  'Pelunasan',
  'Pendapatan Lain',
];

export function totalPendapatan(jurnal: Jurnal[]): number {
  return jurnal.filter((j) => AKUN_PENDAPATAN.includes(j.akun)).reduce((s, j) => s + j.K, 0);
}

export function totalBahan(jurnal: Jurnal[]): number {
  return jurnal.filter((j) => AKUN_BAHAN.includes(j.akun)).reduce((s, j) => s + j.D, 0);
}

export function totalTukang(jurnal: Jurnal[]): number {
  return jurnal.filter((j) => AKUN_TUKANG.includes(j.akun)).reduce((s, j) => s + j.D, 0);
}

/** Saldo rekening bank proyek (bukan kas gabungan perusahaan). */
export function saldoKasProyek(jurnal: Jurnal[], proyekId: string): number {
  const rek = REK_COA[proyekId];
  if (!rek) return 0;
  return jurnal.filter((j) => j.akun === rek).reduce((s, j) => s + j.D - j.K, 0);
}

/** Akun pendapatan untuk kas masuk di dashboard proyek. */
export function akunPendapatanProyek(jenis: string): string {
  return jenis === 'Uang Muka / DP' ? '4-1002' : '4-1001';
}
