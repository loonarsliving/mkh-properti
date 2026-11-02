import { describe, expect, it } from 'vitest';
import { faktaCfo, jawabDeterministik } from './chat';
import { HARI, dataProduksi } from './fixture-uji';
import { gajiDariSnapshot, laporanHolding, pphBadan, TAHUN_BUKU_RESMI_PERTAMA } from './holding';
import { susunModelCfo } from './model';
import type { DataCfo } from './tipe';

function dataDenganGaji(): DataCfo {
  const d = dataProduksi();
  const g = (id: string, cabang: string, periode: string, nominal: number, status: string) => ({
    sumber: 'svcmyb', jenis: 'gaji_karyawan', id, data: { cabang, periode, nominal, status }, diterima_pada: HARI, sumber_diubah_pada: null,
  });
  d.snapshot.push(
    g('1', 'Jogja', '2026-11', 4_000_000, 'transferred'),
    g('2', 'Jogja', '2026-11', 8_000_000, 'transferred'),
    g('3', 'Jogja', '2026-10', 3_500_000, 'pending_transfer'),
    g('4', 'Makassar', '2026-10', 7_000_000, 'pending_transfer'),
    g('5', 'Loonars Private Living', '2026-11', 2_000_000, 'transferred'),
    g('6', 'Jogja', '2025-12', 9_000_000, 'transferred'),
    g('7', 'Jogja', 'bukan-periode', 1, 'transferred'),
  );
  return d;
}

describe('laporan holding PT Loonars Mahakarya', () => {
  const data = dataDenganGaji();
  const m = susunModelCfo(data, HARI);
  const h = laporanHolding(m, data, 2026);
  const lr = Object.fromEntries(h.labaRugi.map((b) => [b.kode, b]));

  it('2026 = periode persiapan; tahun buku resmi pertama 2027', () => {
    expect(TAHUN_BUKU_RESMI_PERTAMA).toBe(2027);
    expect(h.resmi).toBe(false);
    expect(h.statusPeriode).toMatch(/persiapan 2026/);
    expect(laporanHolding(m, data, 2027).resmi).toBe(true);
  });

  it('gaji tim bersama = beban holding (akrual per periode), slip staf villa dikecualikan', () => {
    expect(gajiDariSnapshot(data)).toHaveLength(6);
    expect(lr['6-05'].holding).toBe(-(4_000_000 + 8_000_000 + 3_500_000 + 7_000_000));
    expect(h.gaji.dikecualikanVilla).toBe(2_000_000);
    expect(h.gaji.perCabang).toEqual([
      { cabang: 'Jogja', dibayar: 12_000_000, terutang: 3_500_000 },
      { cabang: 'Makassar', dibayar: 0, terutang: 7_000_000 },
    ]);
    const utang = h.posisi.liabilitas.find((b) => b.kode === '2-08')!;
    expect(utang.holding).toBe(10_500_000);
  });

  it('pendapatan villa KOTOR; bagi hasil & top-up jadi beban; laba L1 = bagian MKH bersih laporan villa', () => {
    const bulan = m.l1.bulan.filter((b) => b.bulan.startsWith('2026'));
    expect(lr['4-01'].L1).toBe(Math.round(bulan.reduce((a, b) => a + b.revenue, 0)));
    expect(lr['6-02'].L1).toBeLessThanOrEqual(0);
    expect(lr['6-03'].L1).toBeLessThanOrEqual(0);
    const rek = h.rekonsiliasi.find((r) => r.label.startsWith('Laba L1'))!;
    expect(rek.cocok).toBe(true);
  });

  it('konsolidasi = L1 + L2 + holding; uang investor bukan pendapatan', () => {
    const { L1, L2, holding, konsolidasi } = h.labaBersih;
    expect(konsolidasi).toBe((L1 ?? 0) + (L2 ?? 0) + holding);
    expect(lr['4-02'].L2).toBe(m.l2.pendapatanDiakui);
    const um = h.posisi.liabilitas.find((b) => b.kode === '2-02')!;
    expect(um.L2).toBe(m.l2.neraca.uangMukaInvestor);
    expect(h.rekonsiliasi.find((r) => r.label.startsWith('Aset L2'))!.cocok).toBe(true);
  });

  it('2027 tanpa arsip tutup buku Desember 2026 → L2 null (tidak ditebak); dengan arsip → selisih kumulatif', () => {
    const h27 = laporanHolding(m, data, 2027);
    expect(h27.labaBersih.L2).toBeNull();
    expect(h27.labaBersih.konsolidasi).toBeNull();
    expect(h27.catatan.flatMap((c) => c.isi).join(' ')).toMatch(/membutuhkan arsip tutup buku Desember 2026/);
    const arsip = [{ periode: '2026-12-01', data: { holding: { kumulatifL2: { pendapatan: 0, hpp: 0, fee: 0 }, ekuitasAkhir: { L1: 1, L2: 2, holding: 3 } } } }];
    const dgnArsip = laporanHolding(m, data, 2027, arsip);
    expect(dgnArsip.labaBersih.L2).not.toBeNull();
    expect(dgnArsip.labaRugi.find((b) => b.kode === '4-02')!.L2).toBe(m.l2.pendapatanDiakui);
  });

  it('bunga 0 (tanpa pinjaman bank); AFP tidak muncul; PPh & penyusutan tercantum', () => {
    expect(lr['7-02']).toMatchObject({ L1: 0, L2: 0, holding: 0, konsolidasi: 0 });
    const semua = JSON.stringify(h.labaRugi) + JSON.stringify(h.posisi);
    expect(semua).not.toMatch(/AFP|utang bank/i);
    expect(lr['8-01'].L2).toBe(-Math.round((m.l2.pendapatanDiakui * 2.5) / 100) || 0);
    expect(lr['8-02'].holding).toBe(-h.pajak.pphBadan || 0);
    expect(lr['7-01'].L2).toBe(0); // Loonars Coffee belum completed
  });

  it('modal disetor 2026 = ekuitas − laba berjalan (posisi bisnis berjalan)', () => {
    const k = Object.fromEntries(h.posisi.komponenEkuitas.map((b) => [b.kode, b]));
    expect(k['3-01'].label).toMatch(/posisi bisnis berjalan/);
    expect((k['3-01'].holding ?? 0) + (k['3-02'].holding ?? 0)).toBe(h.posisi.ekuitas.holding);
    expect(k['3-03']).toBeUndefined();
  });

  it('neraca: ekuitas = aset − liabilitas per kolom; kas villa belum dicatat → total L1 null', () => {
    const { totalAset, totalLiabilitas, ekuitas } = h.posisi;
    expect(ekuitas.L2).toBe((totalAset.L2 ?? 0) - (totalLiabilitas.L2 ?? 0));
    expect(ekuitas.holding).toBe(-10_500_000);
    if (m.l1.neraca.kas === null) expect(totalAset.L1).toBeNull();
  });

  it('AI CFO menjawab "gaji ini masuk mana" dari laporan holding', () => {
    const j = jawabDeterministik('Gaji ini km masukkan di pengeluaran mana? Loonars 1 atau 2?', m, faktaCfo(m, undefined, h));
    expect(j.niat).toBe('holding');
    expect(j.jawaban).toMatch(/beban holding, bukan Loonars 1\/2/);
    expect(j.jawaban).toContain('gaji cabang Jogja (sudah ditransfer): Rp 12.000.000');
  });

});

describe('PPh badan Pasal 31E', () => {
  it('omzet ≤ 4,8 M → 11% PKP; > 4,8 M ≤ 50 M → proporsional; rugi → 0', () => {
    expect(pphBadan(100_000_000, 1_000_000_000)).toBe(11_000_000);
    expect(pphBadan(1_000_000_000, 9_600_000_000)).toBe(Math.round(1e9 * 0.5 * 0.22 * 0.5 + 1e9 * 0.5 * 0.22));
    expect(pphBadan(100_000_000, 60_000_000_000)).toBe(22_000_000);
    expect(pphBadan(-5, 1)).toBe(0);
  });
});

describe('penyusutan Loonars Coffee setelah completed', () => {
  it('garis lurus 20 tahun mulai bulan berikutnya', () => {
    const d = dataProduksi();
    d.snapshot.push({
      sumber: 'svcmyb', jenis: 'proyek_konstruksi', id: 'lc',
      data: { nama: 'Loonars Coffee', status: 'completed', budget_total: 240_000_000, realisasi: { material_purchase: 240_000_000 }, komitmen: {}, utang_belum_lunas: 0 },
      diterima_pada: HARI, sumber_diubah_pada: '2026-08-15T00:00:00Z',
    });
    const mm = susunModelCfo(d, HARI);
    const hh = laporanHolding(mm, d, 2026);
    const bulan = Number(HARI.slice(5, 7)) - 8; // Sep..bulan HARI
    expect(hh.labaRugi.find((b) => b.kode === '7-01')!.L2).toBe(-Math.round(1_000_000 * bulan));
    expect(hh.posisi.aset.find((b) => b.kode === '1-05')!.L2).toBe(-Math.round(1_000_000 * bulan));
  });
});

describe('konsolidasi: kolom "tidak berlaku" vs "tidak tersedia"', () => {
  it('baris satu lini tetap punya angka konsolidasi; kas villa belum dicatat → total null', () => {
    const d = dataProduksi();
    const m = susunModelCfo(d, HARI);
    const h = laporanHolding(m, d, 2026);
    const pendapatan = h.labaRugi.find((b) => b.kode === '4-01')!;
    expect(pendapatan.konsolidasi).toBe(pendapatan.L1);
    const gaji = h.labaRugi.find((b) => b.kode === '6-05')!;
    expect(gaji.konsolidasi).toBe(gaji.holding);
    const kas = h.posisi.aset.find((b) => b.kode === '1-01')!;
    if (m.l1.neraca.kas === null) {
      expect(kas.konsolidasi).toBeNull();
      expect(h.posisi.totalAset.konsolidasi).toBeNull();
    }
    const utangToko = h.posisi.liabilitas.find((b) => b.kode === '2-01')!;
    expect(utangToko.konsolidasi).toBe(utangToko.L2);
  });
});
