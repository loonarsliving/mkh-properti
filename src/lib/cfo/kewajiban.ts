/**
 * DEBT & LIABILITY MANAGER — daftar kewajiban lintas lini, jatuh tempo, dan
 * urutan bayar yang disarankan berdasarkan RISIKO, KONTRAK, dan KEMAMPUAN KAS.
 *
 * AI CFO hanya MENYARANKAN urutan; tidak ada pembayaran yang dieksekusi dari
 * sini. Bobot risiko tertulis di `BOBOT_RISIKO` agar bisa diperiksa owner.
 */
import type { Sumber } from './tipe';
import { bulat, selisihHari } from './util';

export type JenisKewajiban =
  | 'pajak'
  | 'utang_bank'
  | 'sewa_tanah'
  | 'bagi_hasil_investor'
  | 'refund_customer'
  | 'upah_tukang'
  | 'utang_supplier'
  | 'pengajuan_material'
  | 'fee_marketing'
  | 'transfer_tertunda'
  | 'biaya_operasional'
  | 'utang_owner';

/** 5 = paling berisiko bila telat (denda/legal/berhentinya operasi), 1 = fleksibel. */
export const BOBOT_RISIKO: Record<JenisKewajiban, { bobot: number; alasan: string }> = {
  pajak: { bobot: 5, alasan: 'Denda & sanksi administrasi pajak daerah' },
  utang_bank: { bobot: 5, alasan: 'Denda, kolektibilitas, risiko jaminan disita' },
  sewa_tanah: { bobot: 5, alasan: 'Hak atas lahan proyek bergantung pada pelunasan' },
  bagi_hasil_investor: { bobot: 4, alasan: 'Kewajiban kontraktual & kepercayaan investor' },
  refund_customer: { bobot: 4, alasan: 'Kesepakatan tertulis dengan customer; risiko hukum & reputasi' },
  upah_tukang: { bobot: 4, alasan: 'Tukang berhenti kerja → proyek mundur' },
  utang_supplier: { bobot: 3, alasan: 'Toko bisa menghentikan kredit material' },
  pengajuan_material: { bobot: 3, alasan: 'Material terlambat → pekerjaan tertunda' },
  fee_marketing: { bobot: 3, alasan: 'Motivasi tim penjualan' },
  transfer_tertunda: { bobot: 3, alasan: 'Pengajuan sudah disetujui, menunggu transfer' },
  biaya_operasional: { bobot: 3, alasan: 'Operasional harian villa' },
  utang_owner: { bobot: 1, alasan: 'Dana talangan owner — paling fleksibel, internal' },
};

export interface Kewajiban {
  id: string;
  lini: 'L1' | 'L2' | 'Grup';
  jenis: JenisKewajiban;
  pihak: string;
  nominal: number;
  jatuhTempo: string | null;
  /** true = tanggal jatuh tempo adalah asumsi (tidak tercatat di sumber) */
  jatuhTempoAsumsi: boolean;
  dasar: string;
  sumber: Sumber;
}

export interface KewajibanBerprioritas extends Kewajiban {
  skor: number;
  hariLagi: number | null;
  status: 'lewat' | 'minggu_ini' | 'bulan_ini' | 'nanti' | 'tanpa_tanggal';
  urutan: number;
  kumulatif: number;
  tertutupKas: boolean;
  alasanPrioritas: string;
}

function urgensi(hari: number | null): number {
  if (hari === null) return 0;
  if (hari < 0) return 40;
  if (hari <= 7) return 30;
  if (hari <= 30) return 20;
  if (hari <= 90) return 10;
  return 0;
}

export function prioritaskan(daftar: Kewajiban[], hariIni: string, kasTersedia: number): KewajibanBerprioritas[] {
  const dinilai = daftar
    .filter((k) => k.nominal > 0)
    .map((k) => {
      const hariLagi = k.jatuhTempo ? selisihHari(hariIni, k.jatuhTempo) : null;
      const r = BOBOT_RISIKO[k.jenis];
      const skor = r.bobot * 20 + urgensi(hariLagi);
      const status: KewajibanBerprioritas['status'] =
        hariLagi === null ? 'tanpa_tanggal' : hariLagi < 0 ? 'lewat' : hariLagi <= 7 ? 'minggu_ini' : hariLagi <= 30 ? 'bulan_ini' : 'nanti';
      return { ...k, skor, hariLagi, status };
    })
    // skor tertinggi dulu; seri → jatuh tempo lebih awal → nominal lebih kecil (cepat menutup satu kewajiban)
    .sort(
      (a, b) =>
        b.skor - a.skor ||
        (a.hariLagi ?? 99999) - (b.hariLagi ?? 99999) ||
        a.nominal - b.nominal ||
        a.id.localeCompare(b.id),
    );

  let kumulatif = 0;
  return dinilai.map((k, i) => {
    kumulatif += k.nominal;
    const r = BOBOT_RISIKO[k.jenis];
    const waktu =
      k.status === 'lewat'
        ? `sudah lewat ${-(k.hariLagi ?? 0)} hari`
        : k.status === 'tanpa_tanggal'
          ? 'tanpa jatuh tempo'
          : `jatuh tempo ${k.hariLagi} hari lagi${k.jatuhTempoAsumsi ? ' (asumsi)' : ''}`;
    return {
      ...k,
      urutan: i + 1,
      kumulatif: bulat(kumulatif),
      tertutupKas: kumulatif <= kasTersedia,
      alasanPrioritas: `${r.alasan}; ${waktu}`,
    };
  });
}

export function ringkasKewajiban(daftar: Kewajiban[], hariIni: string) {
  const per = (pred: (k: Kewajiban) => boolean) => bulat(daftar.filter(pred).reduce((s, k) => s + k.nominal, 0));
  const hari = (k: Kewajiban) => (k.jatuhTempo ? selisihHari(hariIni, k.jatuhTempo) : null);
  return {
    total: per(() => true),
    L1: per((k) => k.lini === 'L1'),
    L2: per((k) => k.lini === 'L2'),
    Grup: per((k) => k.lini === 'Grup'),
    jatuhTempo7Hari: per((k) => {
      const h = hari(k);
      return h !== null && h <= 7;
    }),
    jatuhTempo30Hari: per((k) => {
      const h = hari(k);
      return h !== null && h <= 30;
    }),
    lewatJatuhTempo: per((k) => {
      const h = hari(k);
      return h !== null && h < 0;
    }),
  };
}
