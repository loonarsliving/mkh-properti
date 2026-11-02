import { GalatAkses, rpc } from '@/lib/laporan-investor/server';

/**
 * POST /api/cfo/pdf-wa — asisten WA owner (MK Connect) meminta tautan PDF
 * laporan keuangan. Pola sama dengan /api/cfo/tanya-wa: header x-sync-secret
 * diteruskan apa adanya, database yang mencocokkan (cfo_pdf_buat_tautan).
 *
 * Body: { nomor: '62812…', jenis: 'holding'|'loonars1'|'loonars2', periode?: 'YYYY'|'YYYY-MM' }
 * Respons: { status, url, nama_berkas } — tautan berlaku 15 menit.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  if (!rahasia) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body harus JSON' }, { status: 400 });
  }
  const nomor = typeof body.nomor === 'string' ? body.nomor.replace(/\D/g, '').replace(/^0/, '62') : '';
  if (!/^62\d{8,14}$/.test(nomor)) return Response.json({ error: 'Nomor tidak valid' }, { status: 400 });
  const jenis = typeof body.jenis === 'string' ? body.jenis : '';
  if (!['holding', 'loonars1', 'loonars2'].includes(jenis)) return Response.json({ error: 'jenis tidak dikenal' }, { status: 400 });
  const periode = typeof body.periode === 'string' && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(body.periode) ? body.periode : null;

  try {
    const hasil = await rpc<{ status: string; token?: string; nama_berkas?: string; pesan?: string }>(
      { jenis: 'wa', rahasia, nomor },
      'cfo_pdf_buat_tautan',
      { p_jenis: jenis, p_periode: periode, p_peminta_wa: nomor },
    );
    if (hasil.status !== 'ok' || !hasil.token || !hasil.nama_berkas) return Response.json({ status: 'galat', pesan: hasil.pesan ?? 'gagal' }, { status: 500 });
    const asal = (process.env.NEXT_PUBLIC_APP_URL || 'https://finance.haluoleo.id').replace(/\/$/, '');
    return Response.json({ status: 'ok', url: `${asal}/api/cfo/pdf/${hasil.token}/${hasil.nama_berkas}`, nama_berkas: hasil.nama_berkas });
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/pdf-wa', e);
    return Response.json({ error: 'Gagal membuat tautan' }, { status: 500 });
  }
}
