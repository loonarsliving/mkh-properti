import { GalatAkses } from '@/lib/laporan-investor/server';
import { ambilModel, catat, ringkasUntukLog, tanyaCfo } from '@/lib/cfo/server';

/**
 * POST /api/cfo/tanya-wa — pertanyaan owner ke AI CFO lewat WhatsApp.
 *
 * Dipanggil asisten WA owner di MK Connect (lib/ai/domains/owner-assistant.ts)
 * dengan pola yang sama seperti /api/laporan-investor/ringkasan-wa:
 * header x-sync-secret (rahasia sync yang sudah ada) diteruskan apa adanya,
 * database yang mencocokkan; MK Connect yang memastikan peminta super admin.
 *
 * Body: { nomor: '62812…', pertanyaan: string }
 * Respons: { jawaban, mode, niat, putusan, fakta[] } — hanya baca.
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
  const pertanyaan = typeof body.pertanyaan === 'string' ? body.pertanyaan.trim().slice(0, 1000) : '';
  if (!pertanyaan) return Response.json({ error: 'Pertanyaan kosong' }, { status: 400 });

  const k = { jenis: 'wa' as const, rahasia, nomor };
  try {
    const { model, kerja } = await ambilModel(k);
    const hasil = await tanyaCfo(model, pertanyaan, [], null, kerja);
    await catat(k, 'tanya_cfo', { pertanyaan, mode: hasil.mode, ...ringkasUntukLog(hasil.dasar) });
    const { dasar: _dasar, ...keluar } = hasil;
    void _dasar;
    return Response.json(keluar);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/tanya-wa', e);
    return Response.json({ error: 'Gagal menjawab' }, { status: 500 });
  }
}
