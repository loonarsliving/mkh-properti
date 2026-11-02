import { createHash } from 'node:crypto';
import { renderToBuffer } from '@react-pdf/renderer';
import { GalatAkses, responsPdf, rpc } from '@/lib/laporan-investor/server';
import { susunDokumenPdf, type JenisPdf } from '@/lib/cfo/pdf-dokumen';
import type { DataKerja } from '@/lib/cfo/kerja';
import type { DataCfo } from '@/lib/cfo/tipe';

/**
 * GET /api/cfo/pdf/<token>/<nama>.pdf — PDF laporan keuangan AI CFO
 * (migrasi 0062). Token dibuat database saat owner meminta lewat WhatsApp:
 * berumur 15 menit, HMAC rahasia sync, terikat jenis & periode. Database yang
 * memeriksa token (RPC cfo_pdf_data); server tidak memakai service-role key.
 * PDF dibuat saat diunduh dari data terbaru dan tidak disimpan.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; nama: string }> }): Promise<Response> {
  const { token, nama } = await params;
  if (!/^[0-9]{9,12}\.(holding|loonars1|loonars2)\.([0-9]{4}(-[0-9]{2})?|-)\.[0-9a-f]{64}$/.test(token)) {
    return new Response('Tautan tidak valid', { status: 404 });
  }
  try {
    const d = await rpc<{ jenis: JenisPdf; periode: string | null; data: DataCfo; kerja: DataKerja }>({ jenis: 'tautan', token }, 'cfo_pdf_data', { p_token: token });
    const pdf = await renderToBuffer(susunDokumenPdf(d.jenis, d.periode, d.data, d.kerja));
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const namaBerkas = /^[A-Za-z0-9_.-]{5,120}\.pdf$/.test(nama) ? nama : `Laporan-${d.jenis}.pdf`;
    return responsPdf(pdf, namaBerkas, sha256);
  } catch (e) {
    if (e instanceof GalatAkses) return new Response('Tautan tidak valid atau kedaluwarsa', { status: 404 });
    console.error('cfo/pdf', e);
    return new Response('Gagal membuat laporan', { status: 500 });
  }
}
