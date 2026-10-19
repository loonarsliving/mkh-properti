import { createHash } from 'node:crypto';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import { GalatAkses, responsPdf, rpc } from '@/lib/laporan-investor/server';
import { DokumenLaporanUtang, type LaporanUtangData } from '@/lib/loonars2/laporan-utang-pdf';

/**
 * GET /api/loonars2/laporan-utang/<token>/<nama>.pdf — tautan unduh Laporan
 * Pembayaran Utang Toko Loonars 2 (migrasi 0053).
 *
 * Token dibuat database saat owner meminta lewat WhatsApp (aksi
 * laporan_utang): berumur 15 menit dan bertanda tangan HMAC dengan rahasia
 * sync yang sudah ada, jadi tidak bisa ditebak/dipalsukan. Pengambilnya
 * adalah Whacenter (melampirkan dokumen ke WhatsApp owner). PDF dibuat saat
 * diunduh dari data terbaru dan tidak disimpan. Server ini tidak memakai
 * service-role key: database yang memeriksa token lewat RPC
 * loonars2_laporan_utang_data.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; nama: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!/^[0-9]{9,12}\.[0-9a-f]{64}$/.test(token)) return new Response('Tautan tidak valid', { status: 404 });

  try {
    const data = await rpc<LaporanUtangData>({ jenis: 'tautan', token }, 'loonars2_laporan_utang_data', { p_token: token });
    const pdf = await renderToBuffer(createElement(DokumenLaporanUtang, { data }) as unknown as ReactElement<DocumentProps>);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const tanggal = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    return responsPdf(pdf, `Laporan-Utang-Toko-Loonars2_${tanggal}.pdf`, sha256);
  } catch (e) {
    if (e instanceof GalatAkses) return new Response('Tautan tidak valid atau kedaluwarsa', { status: 404 });
    console.error('loonars2/laporan-utang', e);
    return new Response('Gagal membuat laporan', { status: 500 });
  }
}
