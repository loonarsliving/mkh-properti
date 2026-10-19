import { describe, expect, it } from 'vitest';

import { periodeTahun } from '@/lib/periode';
import type { Jurnal } from '@/types';

import { ringkasanPeriode, susunLaporan } from './sak-emkm';
import { hitungSaldo, labaBersihDari, saldoAkun } from './saldo';

/** Satu transaksi seimbang: debet ke `debet`, kredit ke `kredit`. */
function trx(no: string, tgl: string, debet: string, kredit: string, nilai: number, proyek = 'AFP'): Jurnal[] {
  const dasar = { tgl, no, ket: no, nama: '', proyek };
  return [
    { ...dasar, akun: debet, d: nilai, k: 0, D: nilai, K: 0 },
    { ...dasar, akun: kredit, d: 0, k: nilai, D: 0, K: nilai },
  ];
}

// Tahun 2025: setor modal, beli tanah, jual rumah, bayar material dan gaji.
// Tahun 2026: jual rumah lagi, bayar upah, pindah dana antar rekening, ambil
// utang bank, dan satu beban dengan kode akun yang tidak ada di COA (seperti
// yang bisa dikirim mkhsistem lewat sync_inbound).
const JURNAL: Jurnal[] = [
  ...trx('T1', '2025-01-05', '1-1002', '3-1001', 1_000_000_000),
  ...trx('T2', '2025-02-10', '1-2001', '1-1002', 300_000_000),
  ...trx('T3', '2025-06-01', '1-1002', '4-1001', 450_000_000),
  ...trx('T4', '2025-06-15', '5-1001', '1-1002', 120_000_000),
  ...trx('T5', '2025-12-28', '6-1001', '1-1001', 30_000_000),
  ...trx('T6', '2026-03-01', '1-1002', '4-1001', 500_000_000),
  ...trx('T7', '2026-03-20', '5-1003', '1-1002', 80_000_000),
  ...trx('T8', '2026-04-02', '1-1001', '1-1002', 25_000_000),
  ...trx('T9', '2026-05-11', '1-1002', '2-2001', 200_000_000),
  ...trx('T10', '2026-07-07', '6-1099', '1-1001', 5_000_000),
];

const LABA_2025 = 450_000_000 - 120_000_000 - 30_000_000;
const LABA_2026 = 500_000_000 - 80_000_000 - 5_000_000;

describe('susunLaporan', () => {
  it('neraca seimbang setiap tahun bila semua jurnal seimbang', () => {
    for (const tahun of [2025, 2026]) {
      const { posisiKeuangan } = susunLaporan(JURNAL, periodeTahun(tahun));
      expect(posisiKeuangan.selisih).toBe(0);
      expect(posisiKeuangan.seimbang).toBe(true);
    }
  });

  it('memisahkan saldo laba awal dari laba periode berjalan', () => {
    const { labaRugi, posisiKeuangan } = susunLaporan(JURNAL, periodeTahun(2026));
    expect(labaRugi.labaBersih).toBe(LABA_2026);
    expect(posisiKeuangan.saldoLabaAwal).toBe(LABA_2025);
    expect(posisiKeuangan.labaPeriodeBerjalan).toBe(LABA_2026);
    expect(posisiKeuangan.saldoLabaAkhir).toBe(LABA_2025 + LABA_2026);
    expect(posisiKeuangan.modal).toBe(1_000_000_000);
  });

  it('laba rugi hanya memakai mutasi periode, neraca kumulatif', () => {
    const { labaRugi, posisiKeuangan } = susunLaporan(JURNAL, periodeTahun(2026));
    expect(labaRugi.pendapatan.total).toBe(500_000_000);
    expect(labaRugi.bebanPokok.total).toBe(80_000_000);
    // Tanah dibeli 2025 tetap tampil di neraca 2026.
    expect(posisiKeuangan.asetTetap.total).toBe(300_000_000);
    expect(posisiKeuangan.liabilitasPanjang.total).toBe(200_000_000);
  });

  it('akun di luar COA tetap dihitung dan dilaporkan', () => {
    const paket = susunLaporan(JURNAL, periodeTahun(2026));
    expect(paket.akunAsing.map((a) => a.kode)).toEqual(['6-1099']);
    expect(paket.labaRugi.bebanOperasional.total).toBe(5_000_000);
    expect(paket.posisiKeuangan.seimbang).toBe(true);
  });

  it('beban pajak manual mengurangi laba dan muncul sebagai utang pajak', () => {
    const pajak = 10_000_000;
    const { labaRugi, posisiKeuangan } = susunLaporan(JURNAL, periodeTahun(2026), { bebanPajak: pajak });
    expect(labaRugi.labaBersih).toBe(LABA_2026 - pajak);
    expect(posisiKeuangan.liabilitasLancar.baris.some((b) => b.kode === '2-1005' && b.nilai === pajak)).toBe(true);
    expect(posisiKeuangan.seimbang).toBe(true);
  });

  it('arus kas cocok dengan saldo buku dan diklasifikasikan benar', () => {
    const { arusKas } = susunLaporan(JURNAL, periodeTahun(2025));
    expect(arusKas.kasAwal).toBe(0);
    expect(arusKas.selisih).toBe(0);
    expect(arusKas.investasi.total).toBe(-300_000_000);
    expect(arusKas.pendanaan.total).toBe(1_000_000_000);
    expect(arusKas.operasi.total).toBe(LABA_2025);

    const tahun2026 = susunLaporan(JURNAL, periodeTahun(2026)).arusKas;
    expect(tahun2026.selisih).toBe(0);
    // Pindah dana antar rekening kas (T8) bukan arus kas masuk/keluar.
    expect(tahun2026.operasi.total).toBe(LABA_2026);
    expect(tahun2026.pendanaan.total).toBe(200_000_000);
  });

  it('neraca saldo periode seimbang debet dan kredit', () => {
    const paket = susunLaporan(JURNAL, periodeTahun(2026));
    expect(paket.totalNeracaSaldoD).toBe(paket.totalNeracaSaldoK);
  });
});

describe('ringkasanPeriode', () => {
  it('menghitung KPI dari jurnal periode dan kas kumulatif', () => {
    const r = ringkasanPeriode(JURNAL, periodeTahun(2026));
    expect(r.pendapatan).toBe(500_000_000);
    expect(r.labaBersih).toBe(LABA_2026);
    expect(r.utangJangkaPanjang).toBe(200_000_000);
    const peta = hitungSaldo(JURNAL);
    expect(r.kas).toBe(saldoAkun('1-1001', peta) + saldoAkun('1-1002', peta));
    expect(r.jumlahTransaksi).toBe(5);
  });
});

describe('saldo', () => {
  it('menebak kategori akun di luar COA dari digit pertama kodenya', () => {
    const peta = hitungSaldo(trx('X', '2026-01-01', '1-9999', '4-9999', 1000));
    expect(peta['1-9999']).toMatchObject({ kat: 'Aset Lancar', tipe: 'D', diluarCoa: true });
    expect(peta['4-9999']).toMatchObject({ kat: 'Pendapatan', tipe: 'K', diluarCoa: true });
    expect(labaBersihDari(trx('X', '2026-01-01', '1-9999', '4-9999', 1000))).toBe(1000);
  });
});
