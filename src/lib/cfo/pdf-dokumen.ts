import { createElement, type ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import { laporanHolding } from './holding';
import type { DataKerja } from './kerja';
import { susunModelCfo } from './model';
import { DokumenHolding, DokumenLoonars1, DokumenLoonars2 } from './pdf';
import type { DataCfo } from './tipe';
import { hariIniJakarta } from './util';

export type JenisPdf = 'holding' | 'loonars1' | 'loonars2';

/**
 * Pilih & susun dokumen PDF dari data cfo_pdf_data. Periode:
 *   holding  → 'YYYY' (atau 'YYYY-MM' → tahunnya); kosong = tahun ini
 *   loonars1 → 'YYYY-MM'; 'YYYY' = bulan terakhir tahun itu; kosong = bulan final terakhir
 *   loonars2 → posisi hari ini (periode diabaikan)
 */
export function susunDokumenPdf(jenis: JenisPdf, periode: string | null, data: DataCfo, kerja: DataKerja, hariIni = hariIniJakarta()): ReactElement<DocumentProps> {
  const m = susunModelCfo(data, hariIni);
  const dibuat = new Date().toISOString();
  if (jenis === 'holding') {
    const tahun = periode ? Number(periode.slice(0, 4)) : Number(hariIni.slice(0, 4));
    const h = laporanHolding(m, data, tahun, kerja.laporan_bulanan);
    return createElement(DokumenHolding, { h, dibuat }) as unknown as ReactElement<DocumentProps>;
  }
  if (jenis === 'loonars1') {
    const pilihan = periode
      ? periode.length === 7
        ? m.l1.bulan.find((b) => b.bulan === periode) ?? null
        : [...m.l1.bulan].filter((b) => b.bulan.startsWith(periode)).pop() ?? null
      : m.l1.terakhirFinal ?? m.l1.terakhir;
    return createElement(DokumenLoonars1, { m, bulan: pilihan, dibuat }) as unknown as ReactElement<DocumentProps>;
  }
  return createElement(DokumenLoonars2, { m, dibuat }) as unknown as ReactElement<DocumentProps>;
}
