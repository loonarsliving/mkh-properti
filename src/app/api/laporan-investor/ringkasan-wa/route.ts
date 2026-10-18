import { GalatAkses, bacaOpsi, susunModelServer } from '@/lib/laporan-investor/server';
import { susunRingkasan } from '@/lib/laporan-investor/ringkasan';

/**
 * POST /api/laporan-investor/ringkasan-wa — dipanggil MK Connect saat SUPER
 * ADMIN bertanya soal keuangan/okupansi ke asisten WhatsApp owner
 * (lib/ai/domains/owner-assistant.ts di Mkhsistem).
 *
 * Hanya-baca. Data dan rumus sama persis dengan PDF Laporan Investor
 * (ir_ambil_data + susunModel); bedanya respons berupa JSON ringkas, tanpa
 * PDF dan tanpa catatan unduhan. Akses sama dengan /api/laporan-investor/wa:
 * header x-sync-secret diteruskan apa adanya, database yang mencocokkannya
 * (ir_boleh_akses, migrasi 0041); MK Connect yang memastikan peminta adalah
 * super_admin. Tidak ada migrasi baru.
 *
 * Body: { nomor: '62812…', dari?: 'YYYY-MM', sampai?: 'YYYY-MM' }
 * Respons: RingkasanKeuangan (src/lib/laporan-investor/ringkasan.ts).
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
  const { dari, sampai } = bacaOpsi(body);

  try {
    const model = await susunModelServer({ jenis: 'wa', rahasia, nomor }, { dari, sampai });
    return Response.json(susunRingkasan(model));
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('laporan-investor/ringkasan-wa', e);
    return Response.json({ error: 'Gagal menyusun ringkasan' }, { status: 500 });
  }
}
