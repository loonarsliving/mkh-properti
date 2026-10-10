import { GalatAkses, bacaOpsi, responsPdf, susunLaporanServer } from '@/lib/laporan-investor/server';

/**
 * POST /api/laporan-investor/wa — dipanggil MK Connect saat SUPER ADMIN
 * mengirim permintaan laporan ke nomor WhatsApp sistem. Mengembalikan PDF
 * (application/pdf) yang lalu dikirim MK Connect sebagai dokumen WA.
 *
 * Memakai fitur yang sudah ada (keputusan owner 2026-10-10):
 *   - Header x-sync-secret = rahasia sync MK Connect yang sama dengan
 *     sync_inbound. Server ini TIDAK menyimpan salinannya: header diteruskan
 *     ke Supabase dan database yang mencocokkannya dengan Vault
 *     mk_sync_shared_secret (ir_boleh_akses, migrasi 0041).
 *   - Siapa yang boleh meminta = peran super_admin di MK Connect; dicek di
 *     MK Connect sebelum memanggil route ini.
 * Body: { nomor: '62812…', dari?: 'YYYY-MM', sampai?: 'YYYY-MM', unit?: string[] }
 * Spesifikasi sisi MK Connect: docs/laporan-investor/03-SPESIFIKASI-MKHSISTEM.md.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  if (!rahasia) return Response.json({ error: 'Unauthorized' }, { status: 401 });

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
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('laporan-investor/wa', e);
    return Response.json({ error: 'Gagal membuat laporan' }, { status: 500 });
  }
}
