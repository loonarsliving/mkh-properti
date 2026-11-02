import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { HARI, dataProduksi } from './fixture-uji';
import { KERJA_KOSONG } from './kerja';
import { aman, rpPdf } from './pdf';
import { susunDokumenPdf } from './pdf-dokumen';

describe('PDF laporan keuangan AI CFO', () => {
  const data = dataProduksi();
  data.snapshot.push({ sumber: 'svcmyb', jenis: 'gaji_karyawan', id: 'g1', data: { cabang: 'Jogja', periode: '2026-10', nominal: 4_000_000, status: 'transferred' }, diterima_pada: HARI, sumber_diubah_pada: null });

  it.each([
    ['holding', '2026'],
    ['loonars1', null],
    ['loonars1', '2026-10'],
    ['loonars1', '2019-01'],
    ['loonars2', null],
  ] as const)('%s %s → PDF valid', async (jenis, periode) => {
    const buf = await renderToBuffer(susunDokumenPdf(jenis, periode, data, KERJA_KOSONG, HARI));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  }, 20_000);

  it('format akuntansi & teks aman untuk font standar', () => {
    expect(rpPdf(-1_234_567)).toBe('(1.234.567)');
    expect(rpPdf(null)).toBe('-');
    expect(aman('L1↔L2 − x ≤ 5 → y')).toBe('L1-L2 - x <= 5 -> y');
  });
});
