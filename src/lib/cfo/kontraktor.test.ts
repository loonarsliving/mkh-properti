import { describe, expect, it } from 'vitest';
import { dataProduksi } from './fixture-uji';
import { laporanLoonars2, pembayaranKontraktorL2 } from './loonars2';
import type { L2Pengeluaran } from './tipe';

const tukang = (id: number, tanggal: string, nominal: number, unit_id: number | null): L2Pengeluaran => ({
  id, dari: 'C', kategori: 'tukang', unit_id, nominal, tanggal, talangan: false, toko_id: null, cicilan_id: null,
});

/** Pola produksi per 9 Nov 2026: borongan AVARA dipecah 6 unit, lalu Sarno dicatat ke BANYU-01. */
function dataSarno(dibuat = '2026-11-09T13:31:00Z') {
  const d = dataProduksi();
  d.dibuat_pada = dibuat;
  d.l2_pengeluaran = [
    ...d.l2_pengeluaran.filter((x) => x.kategori !== 'tukang'),
    ...[1, 2, 3, 4, 5, 6].map((u) => tukang(500 + u, '2026-10-15', u === 1 ? 2_166_670 : 2_166_666, u)),
    ...[1, 2, 3, 4, 5, 6].map((u) => tukang(510 + u, '2026-10-28', u === 1 ? 4_166_670 : 4_166_666, u)),
    tukang(520, '2026-11-05', 20_000_000, 6),
    // Tukang Loonars 1 yang diajukan lewat Loonars 2 (Minggu & Senin), tercatat di BANYU/unit 6.
    tukang(530, '2026-11-01', 9_180_000, 6),
    tukang(531, '2026-11-09', 10_445_000, 6),
  ];
  // Samakan dengan loonars2_v_unit: terpakai_konstruksi = pengeluaran konstruksi rekening C per unit.
  for (const u of d.l2_unit) {
    u.terpakai_konstruksi = d.l2_pengeluaran
      .filter((x) => x.unit_id === u.id && x.dari === 'C' && ['material', 'tukang', 'lain_konstruksi'].includes(x.kategori))
      .reduce((a, x) => a + Number(x.nominal), 0);
  }
  return d;
}

describe('Pembayaran kontraktor mingguan (tidak dipecah per unit)', () => {
  it('menjumlah per minggu Senin–Minggu tanpa melihat unit', () => {
    const k = pembayaranKontraktorL2(dataSarno());
    expect(k.minggu.map((w) => [w.mulai, w.nominal])).toEqual([
      ['2026-10-12', 13_000_000],
      ['2026-10-26', 25_000_000],
      ['2026-11-02', 20_000_000],
    ]);
    expect(k.total).toBe(58_000_000);
    expect(k.terakhir).toBe('2026-11-05');
  });

  it('Sabtu/Minggu/Senin = tukang Loonars 1, dipisah dari kontraktor villa', () => {
    const k = pembayaranKontraktorL2(dataSarno());
    expect(k.tukangL1).toEqual({ total: 19_625_000, pembayaran: [{ tanggal: '2026-11-01', nominal: 9_180_000 }, { tanggal: '2026-11-09', nominal: 10_445_000 }] });
  });

  it('tukang Loonars 1 jadi piutang ke Loonars 1: biaya villa turun, ekuitas & total aset tetap', () => {
    const d = dataSarno();
    const sebelum = laporanLoonars2({ ...d, l2_pengeluaran: d.l2_pengeluaran.map((x) => (x.id >= 530 ? { ...x, tanggal: '2026-11-05' } : x)) });
    const l2 = laporanLoonars2(d);
    expect(l2.neraca.piutangLoonars1).toBe(19_625_000);
    expect(sebelum.biayaKonstruksiKas - l2.biayaKonstruksiKas).toBe(19_625_000);
    expect(sebelum.neraca.asetDalamPembangunan - l2.neraca.asetDalamPembangunan).toBe(19_625_000);
    expect(l2.neraca.totalAset).toBe(sebelum.neraca.totalAset);
    expect(l2.neraca.ekuitasTersirat).toBe(sebelum.neraca.ekuitasTersirat);
    const u6 = (x: typeof l2) => x.unit.find((u) => u.id === 6)!.aktual;
    expect(u6(sebelum) - u6(l2)).toBe(19_625_000);
  });

  it('menandai minggu tanpa pembayaran; minggu berjalan baru ditandai setelah lewat Kamis', () => {
    const senin = pembayaranKontraktorL2(dataSarno('2026-11-09T13:31:00Z'));
    expect(senin.mingguTanpaBayar.map((w) => w.mulai)).toEqual(['2026-10-19']);
    const jumat = pembayaranKontraktorL2(dataSarno('2026-11-13T03:00:00Z'));
    expect(jumat.mingguTanpaBayar.map((w) => w.mulai)).toEqual(['2026-10-19', '2026-11-09']);
  });

  it('per unit hanya material & lain-lain; total = villa + tukang Loonars 1', () => {
    const d = dataSarno();
    const l2 = laporanLoonars2(d);
    const kontraktor = l2.kontraktor.total;
    const perUnitTukang = l2.unit.reduce((a, u) => a + (u.aktual - u.aktualTanpaKontraktor), 0);
    expect(perUnitTukang).toBe(kontraktor);
    expect(l2.biayaKonstruksiKas + l2.kontraktor.tukangL1.total).toBe(
      d.l2_pengeluaran.filter((x) => ['material', 'tukang', 'lain_konstruksi'].includes(x.kategori)).reduce((a, x) => a + Number(x.nominal), 0),
    );
  });
});

describe('AI CFO chat: total pembayaran kontraktor L2', () => {
  it('pertanyaan owner 2026-11-11 dijawab dengan angka total, bukan "tidak tersedia"', async () => {
    const { susunModelCfo } = await import('./model');
    const { faktaCfo, jawabDeterministik } = await import('./chat');
    const m = susunModelCfo(dataSarno(), '2026-11-11');
    const fakta = faktaCfo(m);
    for (const q of ['Oke skrng coba total berapa total pembayaran kontraktor L2', 'Total keseluruhan pembayaran kontraktor L2']) {
      const j = jawabDeterministik(q, m, fakta);
      expect(j.niat).toBe('kontraktor_l2');
      expect(j.jawaban).toContain('Rp 58.000.000');
      expect(j.jawaban).toContain('Rp 19.625.000'); // tukang Loonars 1 disebut terpisah
    }
    // "L2" sekarang dikenali sebagai Loonars 2.
    expect(jawabDeterministik('unit terjual L2', m, fakta).niat).toBe('loonars2');
  });
});
