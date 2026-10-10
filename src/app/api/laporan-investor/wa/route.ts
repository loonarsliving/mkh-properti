import { GalatAkses, bacaOpsi, rahasiaCocok, responsPdf, susunLaporanServer } from '@/lib/laporan-investor/server';

/**
 * POST /api/laporan-investor/wa — dipanggil MK Connect saat super admin
 * mengirim permintaan laporan ke nomor WhatsApp sistem. Mengembalikan PDF
 * (application/pdf) yang lalu dikirim MK Connect sebagai dokumen WA.
 *
 * Header: x-ir-report-secret = env IR_REPORT_SECRET (= Vault ir_report_secret).
 * Body: { nomor: '62812…', dari?: 'YYYY-MM', sampai?: 'YYYY-MM', unit?: string[] }
 *
 * Dua lapis pemeriksaan: rahasia dicek di sini DAN di database
 * (ir_boleh_akses), dan nomor peminta harus terdaftar aktif di
 * ir_wa_penerima. Nomor tidak terdaftar → 403, tanpa PDF.
 * Spesifikasi sisi MK Connect: docs/laporan-investor/03-SPESIFIKASI-MKHSISTEM.md.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rahasia = process.env.IR_REPORT_SECRET ?? '';
  if (!rahasia) return Response.json({ error: 'Laporan lewat WhatsApp belum dikonfigurasi' }, { status: 503 });

  const diberikan = req.headers.get('x-ir-report-secret') ?? '';
  if (!rahasiaCocok(diberikan, rahasia)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body harus JSON' }, { status: 400 });
  }

  const nomor = typeof body.nomor === 'string' ? body.nomor.replace(/\D/g, '').replace(/^0/, '62') : '';
  if (!/^62\d{8,14}$/.test(nomor)) return Response.json({ error: 'Nomor tidak valid' }, { status: 400 });

  try {
    const { pdf, namaBerkas, sha256 } = await susunLaporanServer({ jenis: 'wa', rahasia, nomor }, bacaOpsi(body));
    return responsPdf(pdf, namaBerkas, sha256);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Nomor tidak terdaftar sebagai penerima laporan' }, { status: 403 });
    console.error('laporan-investor/wa', e);
    return Response.json({ error: 'Gagal membuat laporan' }, { status: 500 });
  }
}
