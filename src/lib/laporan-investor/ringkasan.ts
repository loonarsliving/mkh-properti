/**
 * Ringkasan ringkas ModelLaporan untuk asisten WhatsApp owner (MK Connect).
 *
 * Murni (tanpa I/O) supaya bisa diuji. Tidak menghitung angka baru: semua
 * nilai diambil apa adanya dari model yang sama dengan PDF Laporan Investor.
 * Metrik yang tidak ada dikirim null — asisten wajib menyebutnya "data belum
 * tersedia", tidak pernah 0 (aturan kejujuran data di kontrak.ts).
 */
import { nilaiMetrik, type ModelLaporan } from './model';

/** Metrik operasi yang relevan untuk pertanyaan owner (okupansi, pendapatan, ADR). */
export const KUNCI_METRIK_RINGKASAN = [
  'okupansi_unit_total_pct',
  'okupansi_unit_dijual_pct',
  'malam_terjual',
  'booking_diakui',
  'pendapatan_kotor',
  'pendapatan_bersih',
  'pendapatan_basis_investor',
  'pendapatan_walkin',
  'adr_kotor',
  'revpar_kotor',
] as const;

export interface RingkasanBulanUnit {
  periode: string;
  status: string;
  buku_besar: { pendapatan: number; beban: number; laba: number; kas: number } | null;
  metrik: Record<string, number | null>;
  /** Pendapatan villa dari tabel lama (sync bulanan villa-api /cron/sync-mkh-income). */
  pendapatan_villa: { rental: number; non_kamar: number; total: number } | null;
}

export interface RingkasanUnit {
  kode: string;
  nama: string;
  jenis: string;
  kota: string | null;
  total: ModelLaporan['unit'][number]['total'];
  utang_bank: ModelLaporan['unit'][number]['utangBank'];
  bulan: RingkasanBulanUnit[];
}

export interface RingkasanKeuangan {
  rentang: string;
  dari: string;
  sampai: string;
  diambil_pada: string;
  gabungan: {
    pendapatan: number;
    beban_pokok: number;
    beban_operasional: number;
    laba_bersih: number;
    total_aset: number;
    total_liabilitas: number;
    total_ekuitas: number;
    kas_akhir: number;
  } | null;
  tren: ModelLaporan['trenBukuBesar'];
  unit: RingkasanUnit[];
  temuan: ModelLaporan['temuan'];
}

export function susunRingkasan(model: ModelLaporan): RingkasanKeuangan {
  const k = model.keuangan;
  return {
    rentang: model.labelRentang,
    dari: model.opsi.dari,
    sampai: model.opsi.sampai,
    diambil_pada: model.dibuatPada,
    gabungan: k
      ? {
          pendapatan: k.labaRugi.pendapatan.total,
          beban_pokok: k.labaRugi.bebanPokok.total,
          beban_operasional: k.labaRugi.bebanOperasional.total,
          laba_bersih: k.labaRugi.labaBersih,
          total_aset: k.posisiKeuangan.totalAset,
          total_liabilitas: k.posisiKeuangan.totalLiabilitas,
          total_ekuitas: k.posisiKeuangan.totalEkuitas,
          kas_akhir: k.arusKas.kasAkhir,
        }
      : null,
    tren: model.trenBukuBesar,
    unit: model.unit.map((u) => ({
      kode: u.unit.kode,
      nama: u.unit.nama,
      jenis: u.unit.jenis,
      kota: u.unit.kota,
      total: u.total,
      utang_bank: u.utangBank,
      bulan: u.bulan.map((b) => ({
        periode: b.periode,
        status: b.status,
        buku_besar: b.bukuBesar
          ? {
              pendapatan: b.bukuBesar.pendapatan,
              beban: b.bukuBesar.hpp + b.bukuBesar.beban,
              laba: b.bukuBesar.laba,
              kas: b.bukuBesar.kas,
            }
          : null,
        metrik: Object.fromEntries(KUNCI_METRIK_RINGKASAN.map((kunci) => [kunci, nilaiMetrik(b, kunci)])),
        pendapatan_villa: b.pendapatanLama
          ? { rental: b.pendapatanLama.rental, non_kamar: b.pendapatanLama.nonKamar, total: b.pendapatanLama.total }
          : null,
      })),
    })),
    temuan: model.temuan,
  };
}
