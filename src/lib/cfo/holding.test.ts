import { describe, expect, it } from 'vitest';
import { faktaCfo, jawabDeterministik } from './chat';
import { HARI, dataProduksi } from './fixture-uji';
import { gajiDariSnapshot, laporanHolding, TAHUN_BUKU_RESMI_PERTAMA } from './holding';
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
    expect(h.rekonsiliasi.find((r) => r.label.startsWith('Total aset L2'))!.cocok).toBe(true);
  });

  it('tahun tanpa tanggal serah terima L2 → L2 null (tidak ditebak), dicatat di CaLK', () => {
    const h27 = laporanHolding(m, data, 2027);
    expect(h27.labaBersih.L2).toBeNull();
    expect(h27.labaBersih.konsolidasi).toBeNull();
    expect(h27.catatan.flatMap((c) => c.isi).join(' ')).toMatch(/Loonars 2 untuk 2027 belum bisa dihitung/);
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
