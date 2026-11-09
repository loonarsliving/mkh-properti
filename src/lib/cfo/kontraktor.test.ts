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
  ];
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

  it('menandai minggu tanpa pembayaran; minggu berjalan baru ditandai setelah lewat Kamis', () => {
    const senin = pembayaranKontraktorL2(dataSarno('2026-11-09T13:31:00Z'));
    expect(senin.mingguTanpaBayar.map((w) => w.mulai)).toEqual(['2026-10-19']);
    const jumat = pembayaranKontraktorL2(dataSarno('2026-11-13T03:00:00Z'));
    expect(jumat.mingguTanpaBayar.map((w) => w.mulai)).toEqual(['2026-10-19', '2026-11-09']);
  });

  it('total pembangunan tidak berubah; per unit hanya material & lain-lain', () => {
    const d = dataSarno();
    const l2 = laporanLoonars2(d);
    const kontraktor = l2.kontraktor.total;
    const perUnitTukang = l2.unit.reduce((a, u) => a + (u.aktual - u.aktualTanpaKontraktor), 0);
    expect(perUnitTukang).toBe(kontraktor);
    expect(l2.biayaKonstruksiKas).toBe(
      d.l2_pengeluaran.filter((x) => ['material', 'tukang', 'lain_konstruksi'].includes(x.kategori)).reduce((a, x) => a + Number(x.nominal), 0),
    );
  });
});
