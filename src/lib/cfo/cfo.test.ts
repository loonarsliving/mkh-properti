import { describe, expect, it } from 'vitest';
import { simulasi, SKENARIO } from './arus-kas';
import { teksBriefingHarian, teksBriefingMingguan, teksPeringatanKritis } from './briefing';
import { bacaNominal, faktaCfo, jawabDeterministik, validasiJawaban } from './chat';
import { prioritaskan, type Kewajiban } from './kewajiban';
import { deteksiAbnormal } from './kontrol';
import { laporanLoonars1 } from './loonars1';
import { laporanLoonars2 } from './loonars2';
import { susunModelCfo } from './model';
import { evaluasiKeputusan, simulasiRestrukturisasi } from './penantang';
import type { DataCfo, L2Unit } from './tipe';

const HARI = '2026-11-01';

function unit(i: number, over: Partial<L2Unit> = {}): L2Unit {
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
function dataProduksi(): DataCfo {
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

describe('Loonars 1 — hospitality', () => {
  const l1 = laporanLoonars1(dataProduksi(), HARI);
  const okt = l1.bulan.find((b) => b.bulan === '2026-10')!;

  it('menyusun laba rugi persis dari laporan villa (EBITDA = bersih − COGS − OPEX)', () => {
    expect(okt.revenue).toBeCloseTo(155_084_925.75, 2);
    expect(okt.costOfRevenue).toBeCloseTo(38_092_576.75 + 27_543_972, 2);
    expect(okt.ebitda).toBe(78_948_377);
    expect(okt.netProfit).toBe(okt.ebitda);
    expect(okt.payroll).toBe(10_500_000);
  });

  it('menghitung ADR & RevPAR dari malam terjual/tersedia', () => {
    expect(okt.adr).toBeCloseTo(155_084_925.75 / 271, 4);
    expect(okt.revpar).toBeCloseTo(155_084_925.75 / 403, 4);
  });

  it('bagian MKH bulan berjalan negatif bila top-up jaminan > bagian pengelola', () => {
    expect(l1.terakhir!.bulan).toBe('2026-11');
    expect(l1.terakhir!.bagianMkhBersih).toBeCloseTo(747_493.8 - 4_865_834.45, 2);
    expect(l1.terakhirFinal!.bulan).toBe('2026-10');
  });

  it('kas villa dinyatakan tidak tersedia, bukan nol', () => {
    expect(l1.neraca.kas).toBeNull();
    expect(l1.neraca.piutangOta).toBeNull();
  });
});

describe('Loonars 2 — developer & konstruksi', () => {
  it('belum ada penjualan: kontrak & cash-in nol, konstruksi dibiayai talangan', () => {
    const l2 = laporanLoonars2(dataProduksi());
    expect(l2.unitTerjual).toBe(0);
    expect(l2.nilaiKontrak).toBe(0);
    expect(l2.cashInInvestor).toBe(0);
    expect(l2.danaTalangan).toBe(123_992_000);
    expect(l2.kasRekeningPositif).toBe(0);
    expect(l2.unit.filter((u) => u.dibangunTanpaPembeli).map((u) => u.kode)).toEqual([
      'AVARA-01', 'AVARA-02', 'AVARA-03', 'AVARA-04', 'AVARA-05', 'AVARA-06', 'BANYU-01',
    ]);
    // utang toko = disetujui − dibayar (cicilan yang masih diproses tetap utang)
    expect(l2.utangToko).toBe(8_978_000 + (134_646_500 - 44_173_000));
  });

  it('pembayaran investor sebelum serah terima = uang muka, bukan pendapatan', () => {
    const d = dataProduksi();
    d.l2_unit[11] = { ...d.l2_unit[11], status: 'dp', nama_pembeli: 'Investor A', total_dibayar: 215_000_000, sisa_pelunasan: 205_000_000, jatuh_tempo: '2026-12-15' };
    d.l2_penerimaan = [
      { id: 1, unit_id: 12, jenis: 'booking', nominal: 5_000_000, tanggal: '2026-10-01', status: 'aktif' },
      { id: 2, unit_id: 12, jenis: 'dp', nominal: 210_000_000, tanggal: '2026-10-05', status: 'aktif' },
      { id: 3, unit_id: 12, jenis: 'dp', nominal: 999, tanggal: '2026-10-06', status: 'batal' },
    ];
    const l2 = laporanLoonars2(d);
    expect(l2.nilaiKontrak).toBe(420_000_000);
    expect(l2.cashInInvestor).toBe(215_000_000);
    expect(l2.piutangKontrak).toBe(205_000_000);
    expect(l2.uangMukaInvestor).toBe(215_000_000);
    expect(l2.pendapatanDiakui).toBe(0);
    expect(l2.neraca.uangMukaInvestor).toBe(215_000_000);

    d.l2_unit[11] = { ...d.l2_unit[11], status: 'lunas', status_bangun: 'serah_terima', terpakai_konstruksi: 118_000_000, sisa_pelunasan: 0 };
    const l2b = laporanLoonars2(d);
    expect(l2b.pendapatanDiakui).toBe(420_000_000);
    expect(l2b.hppDiakui).toBe(118_000_000);
    expect(l2b.uangMukaInvestor).toBe(0);
  });

  it('proyeksi laba proyek memakai biaya terbesar (budget vs aktual), fee, dan sewa tanah', () => {
    const l2 = laporanLoonars2(dataProduksi());
    const pendapatan = 12 * 420_000_000 + 5 * 600_000_000;
    const biaya = 12 * 120_000_000 + 5 * 160_000_000 + 2_768_000;
    const fee = 12 * 33_600_000 + 5 * 48_000_000;
    expect(l2.proyeksi.laba).toBe(pendapatan - biaya - fee - 1_000_000_000);
  });

  it('neraca L2 seimbang (aset = liabilitas + ekuitas tersirat)', () => {
    const n = laporanLoonars2(dataProduksi()).neraca;
    expect(n.totalAset).toBe(n.totalLiabilitas + n.ekuitasTersirat);
  });
});

describe('model konsolidasi & kontrol', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('kas total tidak memasukkan saldo negatif rekening C maupun kas villa yang tidak tersedia', () => {
    const ll = 1_298_000_000 - 71_221_750 + 610_000_000 - 1_027_042_297;
    expect(m.kas.find((k) => k.id === 'll_buku_besar')!.nilai).toBe(ll);
    expect(m.kasTotal).toBe(ll);
    expect(m.kas.find((k) => k.id === 'l1_villa')!.dipakaiDalamTotal).toBe(false);
  });

  it('memisahkan cash-in investor dari pendapatan operasional', () => {
    expect(m.konsolidasi.pendapatanOperasionalBulanIni).toBeCloseTo(5_889_243.15, 2);
    expect(m.konsolidasi.cashInInvestor).toBe(0);
  });

  it('memberi peringatan dana talangan, unit tanpa pembeli, dan utang bank jatuh tempo', () => {
    const ids = m.peringatan.map((p) => p.id);
    expect(ids).toContain('l2_dana_talangan');
    expect(ids.some((i) => i.startsWith('l2_bangun_tanpa_pembeli'))).toBe(true);
    expect(ids).toContain('utang_bank:1');
    expect(ids).toContain('l1_jaminan_rugi:2026-11');
    // urutan: kritis dulu
    const tingkat = m.peringatan.map((p) => p.tingkat);
    expect(tingkat.indexOf('kritis') === -1 || tingkat.indexOf('kritis') < tingkat.indexOf('sedang')).toBe(true);
  });

  it('rekonsiliasi talangan & jurnal cocok; data siteplan belum bisa dicek tanpa snapshot', () => {
    const r = Object.fromEntries(m.rekonsiliasi.map((x) => [x.id, x.status]));
    expect(r.l2_talangan).toBe('cocok');
    expect(r.l1_channel_kotor).toBe('cocok');
    expect(r.l1_channel_bersih).toBe('cocok');
    expect(r.l2_unit_terjual).toBe('tidak_bisa_dicek');
  });

  it('rekonsiliasi mendeteksi unit terjual di siteplan yang belum tercatat di modul Loonars 2', () => {
    const d = dataProduksi();
    d.snapshot = [
      { sumber: 'svcmyb', jenis: 'investor_penjualan', id: 'p1', data: { proyek: 'LNR2', blok: 'BANYU-06', harga: 420_000_000, booking_fee: 5_000_000, dp: 205_000_000, status: 'verified' }, diterima_pada: HARI, sumber_diubah_pada: null },
      { sumber: 'svcmyb', jenis: 'investor_penjualan', id: 'p2', data: { proyek: 'LNR2', blok: 'BANYU-05', harga: 420_000_000, booking_fee: 5_000_000, dp: 210_000_000, status: 'verified' }, diterima_pada: HARI, sumber_diubah_pada: null },
    ];
    d.sync_log = [{ sumber: 'svcmyb', jenis: 'investor_penjualan', jumlah: 2, baru: 2, berubah: 0, sama: 0, nonaktif: 0, lengkap: true, galat: null, diterima_pada: `${HARI}T04:30:00Z` }];
    const mm = susunModelCfo(d, HARI);
    const r = Object.fromEntries(mm.rekonsiliasi.map((x) => [x.id, x]));
    expect(r.l2_unit_terjual.status).toBe('selisih');
    expect(r.l2_unit_terjual.selisih).toBe(2);
    expect(r.l2_nilai_kontrak.selisih).toBe(840_000_000);
    expect(r.l2_cash_in.selisih).toBe(425_000_000);
    expect(mm.peringatan.some((p) => p.id === 'rekon:l2_cash_in')).toBe(true);
  });

  it('kewajiban grup (utang bank, refund) tidak ikut forecast kas Loonars', () => {
    expect(m.arusKas.input.peristiwa.some((p) => p.jenis === 'utang_bank')).toBe(false);
    expect(m.kewajiban.some((k) => k.jenis === 'utang_bank')).toBe(true);
  });
});

describe('arus kas & skenario', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('deterministik: masukan sama → hasil sama', () => {
    const a = susunModelCfo(dataProduksi(), HARI);
    expect(a.arusKas.skenario.normal.saldoMin).toBe(m.arusKas.skenario.normal.saldoMin);
    expect(a.arusKas.skenario.normal.mingguan).toEqual(m.arusKas.skenario.normal.mingguan);
  });

  it('pesimis ≤ normal ≤ optimis untuk saldo terendah', () => {
    const s = m.arusKas.skenario;
    expect(s.pesimis.saldoMin).toBeLessThanOrEqual(s.normal.saldoMin);
    expect(s.normal.saldoMin).toBeLessThanOrEqual(s.optimis.saldoMin);
  });

  it('13 minggu, saldo akhir minggu = saldo awal + Σ bersih', () => {
    const n = m.arusKas.skenario.normal;
    expect(n.mingguan).toHaveLength(13);
    const total = n.mingguan.reduce((s, w) => s + w.bersih, 0);
    expect(Math.abs(n.mingguan[12].saldoAkhir - (m.kasTotal + total))).toBeLessThanOrEqual(13);
  });

  it('mendeteksi tanggal & besar defisit', () => {
    const hasil = simulasi(
      { hariIni: HARI, kasAwal: 100, kasMinimum: 50, l1MasukHarian: 0, l1KeluarHarian: 0, konstruksiPerHari: 0, konstruksiSisaBudget: 0,
        peristiwa: [{ tanggal: '2026-11-10', nominal: -300, jenis: 'x', lini: 'L2', ket: 'uji', sumber: { tabel: 'uji' } }] },
      'normal',
    );
    expect(hasil.tanggalDefisit).toBe('2026-11-10');
    expect(hasil.besarDefisit).toBe(200);
    expect(hasil.kebutuhanDana).toBe(250);
  });

  it('pesimis menunda tagihan investor; tunggakan tidak masuk horizon', () => {
    const base = { hariIni: HARI, kasAwal: 0, kasMinimum: 0, l1MasukHarian: 0, l1KeluarHarian: 0, konstruksiPerHari: 0, konstruksiSisaBudget: 0 };
    const tagihan = { nominal: 1000, jenis: 'tagihan_investor', lini: 'L2' as const, ket: 'uji', sumber: { tabel: 'uji' } };
    const r = simulasi({ ...base, peristiwa: [{ ...tagihan, tanggal: '2026-11-05' }] }, 'pesimis');
    expect(r.rincianPeristiwa[0].tanggalEfektif).toBe('2026-12-17');
    const lewat = simulasi({ ...base, peristiwa: [{ ...tagihan, tanggal: '2026-10-01' }] }, 'pesimis');
    expect(lewat.rincianPeristiwa).toHaveLength(0);
    expect(SKENARIO.normal.tunggakanMasukHari).toBe(21);
  });

  it('simulasi restrukturisasi: menunda utang toko tidak memperburuk saldo terendah', () => {
    const r = simulasiRestrukturisasi(m, ['utang_supplier'], 28);
    const n = r.find((x) => x.skenario === 'normal')!;
    expect(n.saldoMinSesudah).toBeGreaterThanOrEqual(n.saldoMinSebelum);
  });
});

describe('prioritas kewajiban', () => {
  it('pajak & bank lewat jatuh tempo didahulukan, talangan owner paling akhir', () => {
    const k = (id: string, jenis: Kewajiban['jenis'], jatuhTempo: string | null, nominal = 1000): Kewajiban => ({
      id, lini: 'L2', jenis, pihak: id, nominal, jatuhTempo, jatuhTempoAsumsi: false, dasar: '', sumber: { tabel: 'uji' },
    });
    const hasil = prioritaskan(
      [k('owner', 'utang_owner', null), k('toko', 'utang_supplier', '2026-11-05'), k('pajak', 'pajak', '2026-11-15'), k('bank', 'utang_bank', '2026-10-20')],
      HARI,
      2500,
    );
    expect(hasil.map((x) => x.id)).toEqual(['bank', 'pajak', 'toko', 'owner']);
    expect(hasil.map((x) => x.tertutupKas)).toEqual([true, true, false, false]);
    expect(hasil[0].status).toBe('lewat');
  });
});

describe('CEO challenger', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('menolak pengeluaran yang membuat kas defisit dan memberi alternatif terhitung', () => {
    const ev = evaluasiKeputusan(m, { nominal: 5_000_000_000, lini: 'Grup', ket: 'Beli tanah baru' });
    expect(ev.putusan).toBe('tolak');
    expect(ev.alternatif.length).toBeGreaterThan(0);
    expect(ev.maksAmanSekarang).toBeLessThan(5_000_000_000);
  });

  it('pengeluaran L2 kecil tetap "waspada" selama konstruksi memakai dana talangan', () => {
    const ev = evaluasiKeputusan(m, { nominal: 1_000_000, lini: 'L2', ket: 'tambah material unit' });
    expect(ev.putusan).not.toBe('aman');
    expect(ev.alasan.join(' ')).toMatch(/talangan/);
  });
});

describe('AI CFO chat', () => {
  const m = susunModelCfo(dataProduksi(), HARI);
  const fakta = faktaCfo(m);

  it('membaca nominal bahasa sehari-hari', () => {
    expect(bacaNominal('mau beli mobil 350 jt')).toBe(350_000_000);
    expect(bacaNominal('ekspansi 1,2 M')).toBe(1_200_000_000);
    expect(bacaNominal('bayar Rp 25.000.000')).toBe(25_000_000);
    expect(bacaNominal('berapa kas?')).toBeNull();
  });

  it('pertanyaan keputusan dijawab dengan evaluasi (CEO challenger)', () => {
    const j = jawabDeterministik('Saya mau beli tanah baru 3 M bulan ini, boleh?', m, fakta);
    expect(j.niat).toBe('evaluasi_keputusan');
    expect(j.evaluasi?.putusan).toBe('tolak');
    expect(j.jawaban).toMatch(/TIDAK MENYARANKAN/);
  });

  it('jawaban data menyertakan rujukan fakta', () => {
    const j = jawabDeterministik('berapa EBITDA villa bulan lalu?', m, fakta);
    expect(j.niat).toBe('loonars1');
    expect(j.jawaban).toMatch(/\[F\d+\]/);
    expect(j.jawaban).toContain('Rp 78.948.377');
  });

  it('menolak jawaban AI yang memuat angka karangan, menerima yang sesuai fakta', () => {
    const dasar = jawabDeterministik('kas', m, fakta);
    const kasTeks = fakta[0].teks;
    expect(validasiJawaban(`Kas Anda ${kasTeks} [F1].`, fakta, dasar)).toBe(true);
    expect(validasiJawaban('Dana talangan sekitar Rp 124 jt [F50].', fakta, dasar)).toBe(true);
    expect(validasiJawaban('Kas Anda Rp 987.654.321.', fakta, dasar)).toBe(false);
    expect(validasiJawaban('Laba bulan depan Rp 5 M.', fakta, dasar)).toBe(false);
  });
});

describe('briefing WhatsApp & deteksi abnormal', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('briefing harian & mingguan ≤ 4000 karakter dan memuat kas', () => {
    const h = teksBriefingHarian(m, 'https://finance.haluoleo.id');
    const w = teksBriefingMingguan(m, 'https://finance.haluoleo.id');
    expect(h.length).toBeLessThanOrEqual(4000);
    expect(w.length).toBeLessThanOrEqual(4000);
    expect(h).toContain('Kas tercatat');
    expect(h).toContain('https://finance.haluoleo.id/cfo');
  });

  it('peringatan kritis punya kunci stabil (anti kirim ganda)', () => {
    const a = teksPeringatanKritis(m, 'u');
    const b = teksPeringatanKritis(susunModelCfo(dataProduksi(), HARI), 'u');
    if (a) {
      expect(a.kunci).toBe(b!.kunci);
      expect(a.kunci).toMatch(/^[A-Za-z0-9:_.-]{1,120}$/);
    }
  });

  it('mendeteksi pengeluaran kembar', () => {
    const d = dataProduksi();
    d.l2_pengeluaran.push({ ...d.l2_pengeluaran[5], id: 999 });
    expect(deteksiAbnormal(d).some((x) => x.id.startsWith('kembar:') && x.id.includes('999'))).toBe(true);
  });
});
