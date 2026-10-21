/**
 * Laporan keuangan Loonars Villa dan pajak hotel (PBJT jasa perhotelan) —
 * lihat migrasi 0054. Angka datang apa adanya dari villa-api lewat
 * `laporan_villa_bulanan` (kiriman harian); tidak ada penyesuaian di sini.
 * Pajak = dasar pengenaan x tarif. Dasar dan tarif mengikuti aturan Dispenda
 * daerah (bawaan: kotor, 10%) dan bisa diubah per bulan.
 */

export type StatusLaporan = 'sementara' | 'final';
export type DasarPajak = 'kotor' | 'bersih';

export const TARIF_PAJAK_BAWAAN = 10;
export const DASAR_PAJAK_BAWAAN: DasarPajak = 'kotor';

export const LABEL_DASAR: Record<DasarPajak, string> = {
  kotor: 'Kotor (total dibayar tamu)',
  bersih: 'Bersih (diterima setelah komisi OTA)',
};

export interface LaporanVillaBulanan {
  periode: string;
  status: StatusLaporan;
  omzet_kotor: number | string;
  komisi_ota: number | string;
  pendapatan_bersih: number | string;
  pendapatan_walkin: number | string;
  malam_terjual: number;
  malam_gratis: number;
  malam_tersedia: number;
  okupansi_pct: number | string | null;
  cogs_per_malam: number | string;
  cogs: number | string;
  gross_profit: number | string;
  opex: number | string;
  net_profit: number | string;
  rincian: RincianLaporanVilla;
  diterima_pada: string;
}

export interface RincianChannel {
  sumber: string;
  booking: number;
  malam: number;
  kotor: number;
  komisi: number;
  bersih: number;
}

export interface RincianLaporanVilla {
  versi?: string;
  channel?: RincianChannel[];
  opex_rincian?: { peran: string; orang: number; gaji_per_orang: number; per_bulan: number; periode: number }[];
  cogs_standar?: {
    biaya_langsung?: { label: string; nominal: number }[];
    biaya_tetap_bulanan?: { label: string; nominal: number }[];
    biaya_langsung_per_malam?: number;
    alokasi_tetap_per_malam?: number;
    cogs_per_malam?: number;
  };
  bagi_hasil?: { pool_investor: number; pengelola: number; investor_count: number; per_unit: number };
  catatan?: string[];
}

export interface PajakHotelVilla {
  periode: string;
  tarif_pct: number | string;
  dasar: DasarPajak;
  dasar_pengenaan: number | string | null;
  pajak_terutang: number | string | null;
  jumlah_disetor: number | string | null;
  tgl_setor: string | null;
  bukti_ref: string | null;
  catatan: string | null;
  dicatat_oleh: string | null;
  diperbarui_pada: string;
}

const angka = (v: number | string | null | undefined): number => Number(v) || 0;

export function dasarPengenaan(lap: Pick<LaporanVillaBulanan, 'omzet_kotor' | 'pendapatan_bersih'>, dasar: DasarPajak): number {
  return dasar === 'bersih' ? angka(lap.pendapatan_bersih) : angka(lap.omzet_kotor);
}

export function hitungPajak(dasarAngka: number, tarifPct: number): number {
  return Math.round((dasarAngka * tarifPct) / 100);
}

export type StatusSetoran = 'belum' | 'sebagian' | 'lunas' | 'lebih';

export interface BarisPajak {
  periode: string;
  status: StatusLaporan;
  omzetKotor: number;
  pendapatanBersih: number;
  dasar: DasarPajak;
  tarifPct: number;
  dasarPengenaan: number;
  pajakTerutang: number;
  disetor: number;
  kurang: number;
  tglSetor: string | null;
  statusSetoran: StatusSetoran;
  /** true bila angkanya sudah dibekukan saat setoran dicatat. */
  dibekukan: boolean;
  catatan: string | null;
  buktiRef: string | null;
}

/**
 * Satu baris rekap pajak per bulan. Bila setoran sudah dicatat, dasar dan
 * pajak terutang yang DIBEKUKAN saat itu dipakai (laporan sementara bisa
 * berubah setelahnya); bila belum, dihitung dari laporan terbaru.
 */
export function susunBarisPajak(lap: LaporanVillaBulanan, pajak: PajakHotelVilla | null): BarisPajak {
  const dasar = pajak?.dasar ?? DASAR_PAJAK_BAWAAN;
  const tarifPct = pajak ? angka(pajak.tarif_pct) : TARIF_PAJAK_BAWAAN;
  const dibekukan = !!pajak && pajak.dasar_pengenaan != null && pajak.pajak_terutang != null;
  const dasarPengenaanAngka = dibekukan ? angka(pajak!.dasar_pengenaan) : dasarPengenaan(lap, dasar);
  const pajakTerutang = dibekukan ? angka(pajak!.pajak_terutang) : hitungPajak(dasarPengenaanAngka, tarifPct);
  const disetor = angka(pajak?.jumlah_disetor);
  const kurang = Math.max(0, pajakTerutang - disetor);
  let statusSetoran: StatusSetoran = 'belum';
  if (disetor > 0) statusSetoran = disetor > pajakTerutang ? 'lebih' : kurang === 0 ? 'lunas' : 'sebagian';
  return {
    periode: lap.periode,
    status: lap.status,
    omzetKotor: angka(lap.omzet_kotor),
    pendapatanBersih: angka(lap.pendapatan_bersih),
    dasar,
    tarifPct,
    dasarPengenaan: dasarPengenaanAngka,
    pajakTerutang,
    disetor,
    kurang,
    tglSetor: pajak?.tgl_setor ?? null,
    statusSetoran,
    dibekukan,
    catatan: pajak?.catatan ?? null,
    buktiRef: pajak?.bukti_ref ?? null,
  };
}
