import { GalatAkses } from '@/lib/laporan-investor/server';
import { ambilModel, catat, ringkasUntukLog, tanyaCfo } from '@/lib/cfo/server';

/**
 * POST /api/cfo/chat — AI CFO Chat di web (khusus CFO/owner).
 *
 * Header: Authorization: Bearer <access token login>. Token diteruskan ke RPC
 * cfo_ambil_data; database yang menolak bila bukan CFO.
 * Body: { pertanyaan: string, riwayat?: {peran:'owner'|'cfo', isi:string}[] }
 *
 * Jawaban selalu bisa ditelusuri: angka berasal dari mesin deterministik
 * (src/lib/cfo), dan setiap angka narasi AI divalidasi terhadap daftar fakta.
 * Setiap pertanyaan tercatat di cfo_audit_log. Hanya baca — tidak ada aksi uang.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Body harus JSON' }, { status: 400 });
  }
  const pertanyaan = typeof body.pertanyaan === 'string' ? body.pertanyaan.trim().slice(0, 1000) : '';
  if (!pertanyaan) return Response.json({ error: 'Pertanyaan kosong' }, { status: 400 });
  const riwayat = Array.isArray(body.riwayat)
    ? body.riwayat
        .filter((r): r is { peran: 'owner' | 'cfo'; isi: string } => !!r && typeof r === 'object' && ((r as { peran?: unknown }).peran === 'owner' || (r as { peran?: unknown }).peran === 'cfo') && typeof (r as { isi?: unknown }).isi === 'string')
        .slice(-6)
    : [];

  const k = { jenis: 'cfo' as const, token };
  try {
    const { model } = await ambilModel(k);
    const hasil = await tanyaCfo(model, pertanyaan, riwayat, k);
    await catat(k, 'tanya_cfo', { pertanyaan, mode: hasil.mode, ...ringkasUntukLog(hasil.dasar) });
    const { dasar: _dasar, ...keluar } = hasil;
    void _dasar;
    return Response.json(keluar);
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/chat', e);
    return Response.json({ error: 'Gagal menjawab' }, { status: 500 });
  }
}
