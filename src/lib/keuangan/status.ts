/**
 * Status setiap angka laporan institusional.
 *
 * Aturan inti (permintaan owner 2026-11-02): data kosong TIDAK BOLEH dianggap
 * nol. Setiap sel membawa status + sumber, sehingga laporan bisa membedakan
 * "biaya benar-benar nol" dari "biaya belum tercatat".
 */
import type { Sumber } from '@/lib/cfo/tipe';

export type StatusAngka =
  /** dari transaksi aktual yang tercatat */
  | 'aktual'
  /** angka standar / estimasi / sementara — perlu verifikasi sebelum disajikan ke investor */
  | 'estimasi'
  /** sumber ada, tetapi hanya sebagian periode yang tersedia */
  | 'sebagian'
  /** nol yang sah karena kebijakan (mis. tidak ada pinjaman → bunga 0) */
  | 'nol_kebijakan'
  /** tidak ada sistem yang mencatat pos ini → nilai null */
  | 'belum_tercatat'
  /** sumber ada, tetapi tidak ada data untuk periode ini → nilai null */
  | 'tidak_tersedia'
  /** pos tidak berlaku untuk kolom ini → nilai null, tidak ikut kelengkapan */
  | 'tidak_berlaku';

export type Kelengkapan = 'lengkap' | 'perlu_verifikasi' | 'tidak_lengkap';

export interface Sel {
  nilai: number | null;
  status: StatusAngka;
  catatan?: string;
  sumber: Sumber[];
}

export const LABEL_STATUS: Record<StatusAngka, string> = {
  aktual: 'Aktual',
  estimasi: 'Estimasi / standar',
  sebagian: 'Sebagian periode',
  nol_kebijakan: 'Nol (kebijakan)',
  belum_tercatat: 'Belum tercatat',
  tidak_tersedia: 'Tidak tersedia',
  tidak_berlaku: 'Tidak berlaku',
};

export const LABEL_KELENGKAPAN: Record<Kelengkapan, string> = {
  lengkap: 'Complete',
  perlu_verifikasi: 'Needs Verification',
  tidak_lengkap: 'Incomplete',
};

const TANPA_NILAI: StatusAngka[] = ['belum_tercatat', 'tidak_tersedia', 'tidak_berlaku'];

export function sel(nilai: number | null, status: StatusAngka, sumber: Sumber[] = [], catatan?: string): Sel {
  return { nilai: TANPA_NILAI.includes(status) ? null : nilai, status, sumber, catatan };
}

export const tidakBerlaku = (catatan?: string): Sel => sel(null, 'tidak_berlaku', [], catatan);
export const belumTercatat = (catatan: string): Sel => sel(null, 'belum_tercatat', [], catatan);

/** Kelengkapan gabungan dari sejumlah status (tidak_berlaku diabaikan). */
export function kelengkapanDari(status: StatusAngka[]): Kelengkapan {
  const s = status.filter((x) => x !== 'tidak_berlaku');
  if (s.some((x) => x === 'belum_tercatat' || x === 'tidak_tersedia' || x === 'sebagian')) return 'tidak_lengkap';
  if (s.some((x) => x === 'estimasi')) return 'perlu_verifikasi';
  return 'lengkap';
}

/** Status yang mewakili gabungan beberapa sel (untuk subtotal / konsolidasi). */
export function statusGabungan(status: StatusAngka[]): StatusAngka {
  const s = status.filter((x) => x !== 'tidak_berlaku');
  if (!s.length) return 'tidak_berlaku';
  if (s.every((x) => x === 'belum_tercatat')) return 'belum_tercatat';
  if (s.every((x) => x === 'belum_tercatat' || x === 'tidak_tersedia')) return 'tidak_tersedia';
  if (s.some((x) => x === 'belum_tercatat' || x === 'tidak_tersedia' || x === 'sebagian')) return 'sebagian';
  if (s.some((x) => x === 'estimasi')) return 'estimasi';
  if (s.every((x) => x === 'nol_kebijakan')) return 'nol_kebijakan';
  return 'aktual';
}

/**
 * Jumlah sel: menjumlah yang bernilai; null bila tidak ada satu pun yang bernilai.
 *
 * Nol karena kebijakan TIDAK boleh menutupi data yang hilang: bila satu-satunya
 * angka adalah nol-kebijakan sementara ada sel yang belum tercatat / tidak
 * tersedia, hasilnya null (mis. pendapatan konsolidasi bulan tanpa laporan villa
 * bukan "0", melainkan "tidak tersedia").
 */
export function jumlahSel(daftar: Sel[], catatan?: string): Sel {
  const bernilai = daftar.filter((d) => d.nilai !== null);
  const hilang = daftar.filter((d) => d.status === 'belum_tercatat' || d.status === 'tidak_tersedia');
  if (hilang.length && !bernilai.some((d) => d.status !== 'nol_kebijakan')) {
    const status: StatusAngka = hilang.every((d) => d.status === 'belum_tercatat') ? 'belum_tercatat' : 'tidak_tersedia';
    return { nilai: null, status, sumber: hilang.flatMap((d) => d.sumber), catatan };
  }
  const status = statusGabungan(daftar.map((d) => d.status));
  const nilai = bernilai.length ? Math.round(bernilai.reduce((a, d) => a + (d.nilai as number), 0)) : null;
  const sumber = daftar.flatMap((d) => d.sumber).filter((s, i, arr) => arr.findIndex((x) => x.tabel === s.tabel && x.ket === s.ket) === i);
  return { nilai: status === 'tidak_berlaku' || status === 'belum_tercatat' || status === 'tidak_tersedia' ? null : nilai, status, sumber, catatan };
}
