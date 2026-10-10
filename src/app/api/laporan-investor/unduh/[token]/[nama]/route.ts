import { GalatAkses, responsPdf, susunLaporanServer } from '@/lib/laporan-investor/server';

/**
 * GET /api/laporan-investor/unduh/<token>/<nama>.pdf — tautan sementara
 * yang dibuat POST /api/laporan-investor/wa dan diambil Whacenter untuk
 * dilampirkan ke WhatsApp super admin. Token divalidasi database
 * (ir_ambil_data_tautan, migrasi 0042: 10 menit, maks 3 kali ambil);
 * parameter laporan berasal dari saat tautan dibuat, bukan dari URL.
 * Segmen <nama> hanya nama berkas.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string; nama: string }> },
): Promise<Response> {
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('Tautan tidak valid', { status: 404 });

  try {
    const { pdf, namaBerkas, sha256 } = await susunLaporanServer({ jenis: 'tautan', token }, {});
    return responsPdf(pdf, namaBerkas, sha256);
  } catch (e) {
    if (e instanceof GalatAkses) return new Response('Tautan tidak valid atau kedaluwarsa', { status: 404 });
    console.error('laporan-investor/unduh', e);
    return new Response('Gagal membuat laporan', { status: 500 });
  }
}
