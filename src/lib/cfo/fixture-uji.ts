/**
 * Data uji berbentuk produksi 2026-11-01 (dibaca read-only saat audit) —
 * dipakai bersama oleh tes AI CFO. Bukan kode aplikasi.
 */
import type { DataCfo, L2Unit } from './tipe';

export const HARI = '2026-11-01';

export function unit(i: number, over: Partial<L2Unit> = {}): L2Unit {
  const lunara = i > 12;
  return {
    id: i,
    kode: lunara ? `LUNARA-0${i - 12}` : i <= 6 ? `AVARA-0${i}` : `BANYU-0${i - 6}`,
    tipe: lunara ? '2 Kamar' : '1 Kamar',
    nama_pembeli: null,
    status: 'tersedia',
    status_bangun: 'belum',
    sedang_dibangun: false,
    harga: lunara ? 600_000_000 : 420_000_000,
    biaya_bangun: lunara ? 160_000_000 : 120_000_000,
    buffer: lunara ? 24_000_000 : 18_000_000,
    fee: lunara ? 48_000_000 : 33_600_000,
    kebutuhan_c: lunara ? 232_000_000 : 171_600_000,
    dp_target: lunara ? 300_000_000 : 210_000_000,
    total_dibayar: 0,
    sisa_pelunasan: lunara ? 600_000_000 : 420_000_000,
    terpakai_konstruksi: 0,
    utang_disetujui: 0,
    keluar_c: 0,
    jatuh_tempo: null,
    is_unit_contoh: false,
    ...over,
  };
}

/** Bentuk data mengikuti produksi 2026-11-01 (dibaca read-only saat audit). */
export function dataProduksi(): DataCfo {
  const units = Array.from({ length: 17 }, (_, k) => unit(k + 1));
  for (let i = 0; i < 6; i++) {
    units[i] = { ...units[i], status_bangun: 'proses', terpakai_konstruksi: 36_779_205, utang_disetujui: 23_937_374 };
  }
  units[6] = { ...units[6], status_bangun: 'proses', sedang_dibangun: true };
  return {
    versi: 1,
    dibuat_pada: `${HARI}T05:00:00Z`,
    akses: 'cfo',
    pengaturan: { url_aplikasi: 'https://finance.haluoleo.id', kas_minimum: 50_000_000, briefing_harian: true, briefing_mingguan: true, peringatan_otomatis: true, diubah_pada: HARI },
    l1_laporan: [
      {
        periode: '2026-10-01', status: 'final', omzet_kotor: '155084925.75', komisi_ota: '38092576.75', pendapatan_bersih: '116992349.00',
        pendapatan_walkin: 0, malam_terjual: 271, malam_gratis: 4, malam_tersedia: 403, okupansi_pct: '67.5', cogs: '27543972.00',
        gross_profit: '89448377', opex: '10500000.00', net_profit: '78948377.00',
        channel: [
          { sumber: 'booking.com', booking: 143, malam: 167, kotor: 97459975.75, komisi: 32267386.75, bersih: 65192589 },
          { sumber: 'agoda', booking: 55, malam: 60, kotor: 28648762, komisi: 0, bersih: 28648762 },
          { sumber: 'traveloka', booking: 15, malam: 16, kotor: 11909396, komisi: 4295192, bersih: 7614204 },
          { sumber: 'website', booking: 19, malam: 22, kotor: 11604292, komisi: 0, bersih: 11604292 },
          { sumber: 'airbnb', booking: 3, malam: 7, kotor: 5462500, komisi: 1529998, bersih: 3932502 },
        ],
        bagi_hasil: { per_unit: 4251066.45, pengelola: 23684513.1, jaminan_aktif: true, jaminan_topup: 748933.55, pool_investor: 55263863.9, investor_count: 13 },
        opex_rincian: [
          { peran: 'Cleaning service', orang: 2, periode: 3_000_000, per_bulan: 3_000_000 },
          { peran: 'Receptionist', orang: 3, periode: 4_500_000, per_bulan: 4_500_000 },
          { peran: 'Security', orang: 2, periode: 3_000_000, per_bulan: 3_000_000 },
        ],
        diterima_pada: '2026-10-31T18:11:24Z',
      },
      {
        periode: '2026-11-01', status: 'sementara', omzet_kotor: 5889243.15, komisi_ota: 1949830.15, pendapatan_bersih: 3939413, pendapatan_walkin: 0,
        malam_terjual: 11, malam_gratis: 0, malam_tersedia: 390, okupansi_pct: 2.8, cogs: 1097767, gross_profit: 2841646, opex: 350000, net_profit: 2491646,
        channel: [{ sumber: 'booking.com', booking: 10, malam: 11, kotor: 5889243.15, komisi: 1949830.15, bersih: 3939413 }],
        bagi_hasil: { per_unit: 134165.55, pengelola: 747493.8, jaminan_aktif: true, jaminan_topup: 4865834.45, pool_investor: 1744152.2, investor_count: 13 },
        opex_rincian: [],
        diterima_pada: '2026-10-31T18:11:24Z',
      },
    ],
    l1_metrik: [],
    l1_pajak: [],
    l2_pengaturan: { target_tanah: 1_000_000_000, jatuh_tempo_tanah: '2027-10-11', dp_persen_default: 50 },
    l2_unit: units,
    l2_rekening: [
      { kode: 'A', nama: 'Penampung', saldo_awal: 0, saldo: 0, menunggu_transfer: 0 },
      { kode: 'B', nama: 'Tanah', saldo_awal: 0, saldo: 0, menunggu_transfer: 0 },
      { kode: 'C', nama: 'Konstruksi & Fee', saldo_awal: 0, saldo: -123_992_000, menunggu_transfer: 0 },
      { kode: 'D', nama: 'Profit', saldo_awal: 0, saldo: 0, menunggu_transfer: 0 },
    ],
    l2_penerimaan: [],
    l2_pengeluaran: [
      ...Array.from({ length: 34 }, (_, i) => ({ id: i + 1, dari: 'C', kategori: 'material', unit_id: (i % 6) + 1, nominal: i === 0 ? 2_834_000 : 1_830_000, tanggal: `2026-10-${String(3 + (i % 25)).padStart(2, '0')}`, talangan: true, toko_id: null, cicilan_id: null })),
      ...Array.from({ length: 18 }, (_, i) => ({ id: 100 + i, dari: 'C', kategori: 'tukang', unit_id: (i % 6) + 1, nominal: i < 4 ? 3_000_000 : i === 4 ? 3_285_718 : 3_285_714, tanggal: `2026-10-${String(10 + i).padStart(2, '0')}`, talangan: true, toko_id: null, cicilan_id: null })),
      { id: 200, dari: 'C', kategori: 'lain_konstruksi', unit_id: null, nominal: 2_768_000, tanggal: '2026-10-20', talangan: true, toko_id: null, cicilan_id: null },
    ],
    l2_toko: [
      { id: 2, nama: 'BJ BASUKI JAYA', utang_disetujui: 8_978_000, utang_menunggu: 0, cicilan_dibayar: 0, cicilan_diproses: 0, sisa_utang: 8_978_000 },
      { id: 7, nama: 'TB Sumber Rejeki', utang_disetujui: 134_646_500, utang_menunggu: 0, cicilan_dibayar: 44_173_000, cicilan_diproses: 30_000_000, sisa_utang: 60_473_500 },
    ],
    l2_cicilan: [{ id: 1, kelompok: 'M-5', toko_id: 7, nominal: 30_000_000, status: 'menunggu', dibuat_pada: '2026-10-30T00:00:00Z' }],
    l2_pengajuan_menunggu: [{ id: 300, kategori: 'material', unit_id: 1, nominal: 35_037_500, kelompok: 'L2-61', dibuat_pada: '2026-10-29T00:00:00Z' }],
    jurnal_bulanan: [
      { proyek: 'LL', akun: '1-1001', bulan: '2026-08', d: 1_298_000_000, k: 71_221_750, n: 58 },
      { proyek: 'LL', akun: '1-1004', bulan: '2026-09', d: 610_000_000, k: 1_027_042_297, n: 400 },
      { proyek: 'LL', akun: '4-1001', bulan: '2026-08', d: 0, k: 1_763_000_000, n: 9 },
      { proyek: 'LL', akun: '5-1001', bulan: '2026-09', d: 499_828_028, k: 0, n: 298 },
      { proyek: 'LL', akun: '6-1007', bulan: '2026-09', d: 140_863_691, k: 0, n: 52 },
      { proyek: 'LL', akun: '1-1006', bulan: '2026-09', d: 124_400_000, k: 0, n: 2 },
      { proyek: 'LL', akun: '3-1002', bulan: '2026-07', d: 15_296_578, k: 0, n: 1 },
      { proyek: 'LL', akun: '4-1002', bulan: '2026-08', d: 0, k: 145_000_000, n: 1 },
      { proyek: 'LL', akun: '5-1003', bulan: '2026-09', d: 316_854_000, k: 0, n: 92 },
      { proyek: 'LL', akun: '6-1003', bulan: '2026-09', d: 1_021_750, k: 0, n: 3 },
    ],
    pengajuan_menunggu: [{ id: 9001, proyek: 'LL', tipe: 'bahan', nominal: 4_400_000, dibuat_pada: '2026-10-29T01:15:00Z' }],
    utang_bank: [{ id: 1, proyek: 'AFP', jenis: 'Kredit Konstruksi', bank: 'Btn', pokok: 1_490_000_000, terbayar: 0, jt_tempo: '2026-12-31' }],
    snapshot: [],
    kesegaran: { l1_laporan: '2026-10-31T18:11:24Z', l1_metrik: '2026-11-01T01:36:22Z', jurnal_mk_connect: '2026-10-30T12:18:00Z', l2_pengeluaran: '2026-10-31T05:32:52Z', l2_penerimaan: null },
    sync_log: [],
  };
}

