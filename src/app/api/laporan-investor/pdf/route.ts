import { GalatAkses, bacaOpsi, responsPdf, susunLaporanServer } from '@/lib/laporan-investor/server';

/**
 * POST /api/laporan-investor/pdf — unduh PDF Laporan Investor (CFO/owner).
 *
 * Header: Authorization: Bearer <access token login>. Token diteruskan apa
 * adanya ke Supabase; database (mkh_is_cfo) yang memutuskan boleh/tidak.
 * Body (JSON, semua opsional): { dari: 'YYYY-MM', sampai: 'YYYY-MM',
 * unit: string[], bagian: string[] }.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return Response.json({ error: 'Perlu login' }, { status: 401 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const { pdf, namaBerkas, sha256 } = await susunLaporanServer({ jenis: 'cfo', token }, bacaOpsi(body));
    return responsPdf(pdf, namaBerkas, sha256);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Hanya CFO/owner yang boleh mengunduh laporan ini' }, { status: 403 });
    console.error('laporan-investor/pdf', e);
    return Response.json({ error: 'Gagal membuat laporan' }, { status: 500 });
  }
}
