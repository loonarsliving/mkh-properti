import { rpc, GalatAkses } from '@/lib/laporan-investor/server';
import { teksBriefingHarian, teksBriefingMingguan, teksPeringatanKritis } from '@/lib/cfo/briefing';
import { ambilModel, type KredensialCfo } from '@/lib/cfo/server';

/**
 * POST /api/cfo/briefing — menyusun briefing WhatsApp owner dari angka
 * deterministik lalu mengantrekannya lewat antrean WA yang sudah ada
 * (RPC cfo_briefing_antre → loonars2_outbox → MK Connect → Whacenter).
 *
 * Dua pemanggil:
 *  1. pg_cron MKH Property (cfo_briefing_bangunkan, migrasi 0057):
 *     header x-sync-secret, body { jenis: 'harian' | 'mingguan' | 'peringatan' }.
 *  2. CFO dari halaman Laporan: Authorization: Bearer <token>,
 *     body { jenis: 'harian' | 'mingguan', kirim?: boolean } →
 *     kirim=false hanya pratinjau; kirim=true mengantre (jenis 'manual').
 *
 * Kunci antre unik per jenis+tanggal → aman bila cron/route dipanggil ulang.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-sync-secret') ?? '';
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!rahasia && !token) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* body kosong boleh */
  }
  const jenis = body.jenis;
  if (jenis !== 'harian' && jenis !== 'mingguan' && jenis !== 'peringatan') {
    return Response.json({ error: 'jenis harus harian | mingguan | peringatan' }, { status: 400 });
  }

  const k: KredensialCfo = token ? { jenis: 'cfo', token } : { jenis: 'wa', rahasia, nomor: '' };
  const url = (process.env.NEXT_PUBLIC_APP_URL || 'https://finance.haluoleo.id').replace(/\/$/, '');

  try {
    const { model } = await ambilModel(k);
    let teks: string;
    let kunci: string;
    if (jenis === 'peringatan') {
      const p = teksPeringatanKritis(model, url);
      if (!p) return Response.json({ status: 'tidak_ada_peringatan_kritis' });
      teks = p.teks;
      kunci = p.kunci;
    } else {
      teks = jenis === 'harian' ? teksBriefingHarian(model, url) : teksBriefingMingguan(model, url);
      kunci = `${jenis}:${model.hariIni}`;
    }

    if (k.jenis === 'cfo') {
      if (body.kirim !== true) return Response.json({ status: 'pratinjau', teks });
      kunci = `manual:${jenis}:${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12)}`;
    }
    const hasil = await rpc<{ status: string; antre: number }>(k, 'cfo_briefing_antre', {
      p_jenis: k.jenis === 'cfo' ? 'manual' : jenis,
      p_pesan: teks,
      p_kunci: kunci,
    });
    return Response.json({ ...hasil, kunci, teks: k.jenis === 'cfo' ? teks : undefined });
  } catch (e) {
    if (e instanceof GalatAkses) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/briefing', e);
    return Response.json({ error: 'Gagal menyusun briefing' }, { status: 500 });
  }
}
