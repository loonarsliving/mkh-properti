import { SB_KEY, SB_URL } from '@/lib/config';
import { bacaPermintaan, GalatPermintaan, jawabAdvisor } from '@/lib/cfo/advisor';
import { laporanHolding } from '@/lib/cfo/holding';
import { KERJA_KOSONG, susunKerjaCfo, type DataKerja } from '@/lib/cfo/kerja';
import { susunModelCfo } from '@/lib/cfo/model';
import type { DataCfo } from '@/lib/cfo/tipe';
import { hariIniJakarta } from '@/lib/cfo/util';

/**
 * POST /api/cfo/advisor — AI CFO untuk Loonars AI Advisor (repo Istri). HANYA BACA.
 *
 * Auth: header x-advisor-secret, diteruskan apa adanya ke RPC
 * cfo_advisor_ambil_data / cfo_advisor_ambil_kerja (migrasi 0072); database
 * yang mencocokkannya dengan Vault `advisor_shared_secret`. Rahasia ini
 * terpisah dari rahasia sync MK Connect. Sebelum secret dibuat di Vault,
 * endpoint ini selalu 401.
 *
 * Body: { mode: 'fakta' } | { mode: 'tanya', pertanyaan } |
 *       { mode: 'evaluasi', rencana: { nominal, lini: 'L1'|'L2'|'Grup', ket, tanggal?, cicilan? } }
 * Respons: JawabanAdvisor (src/lib/cfo/advisor.ts) — fakta bernomor, jawaban
 * deterministik, putusan CEO challenger. Tanpa data mentah, tanpa narasi AI.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class GalatAksesAdvisor extends Error {}

async function rpcAdvisor<T>(rahasia: string, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'x-advisor-secret': rahasia,
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  const teks = await res.text();
  if (res.status === 401 || res.status === 403 || teks.includes('42501') || teks.includes('Tidak berhak')) {
    throw new GalatAksesAdvisor('Tidak berhak');
  }
  if (!res.ok) throw new Error(`Supabase ${fn} gagal (${res.status})`);
  return JSON.parse(teks) as T;
}

export async function POST(req: Request): Promise<Response> {
  const rahasia = req.headers.get('x-advisor-secret') ?? '';
  if (rahasia.length < 32) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let permintaan;
  try {
    permintaan = bacaPermintaan(await req.json());
  } catch (e) {
    const pesan = e instanceof GalatPermintaan ? e.message : 'Body harus JSON';
    return Response.json({ error: pesan }, { status: 400 });
  }

  try {
    const data = await rpcAdvisor<DataCfo>(rahasia, 'cfo_advisor_ambil_data', { p_mode: permintaan.mode });
    const dataKerja = await rpcAdvisor<DataKerja>(rahasia, 'cfo_advisor_ambil_kerja', {}).catch((e: unknown) => {
      if (e instanceof GalatAksesAdvisor) throw e;
      console.error('cfo_advisor_ambil_kerja gagal', e);
      return KERJA_KOSONG;
    });
    const model = susunModelCfo(data, hariIniJakarta());
    const kerja = susunKerjaCfo(model, dataKerja);
    const holding = laporanHolding(model, data, undefined, dataKerja.laporan_bulanan);
    return Response.json(jawabAdvisor(model, permintaan, kerja, holding));
  } catch (e) {
    if (e instanceof GalatAksesAdvisor) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('cfo/advisor', e);
    return Response.json({ error: 'Gagal menjawab' }, { status: 500 });
  }
}
