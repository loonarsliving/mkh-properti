/**
 * Bagian SERVER AI CFO — hanya diimpor route handler di src/app/api/cfo/.
 *
 * Tidak memakai service-role key (pola sama dengan Laporan Investor):
 *   - web  : access token CFO dari browser diteruskan ke RPC; database yang
 *            memeriksa cfo_users (mkh_is_cfo).
 *   - WA   : anon key + header x-sync-secret (rahasia sync MK Connect yang
 *            sudah ada) diteruskan apa adanya; database mencocokkannya dengan
 *            Vault (migrasi 0057, _cfo_akses).
 *   - cron : sama dengan WA tanpa nomor (pg_cron → /api/cfo/briefing).
 */
import { rpc, type Kredensial } from '@/lib/laporan-investor/server';
import { faktaCfo, jawabDeterministik, promptPengguna, promptSistem, ringkasUntukLog, validasiJawaban, type JawabanCfo } from './chat';
import { susunModelCfo, type ModelCfo } from './model';
import type { DataCfo } from './tipe';
import { hariIniJakarta } from './util';

export type KredensialCfo = Extract<Kredensial, { jenis: 'cfo' | 'wa' }>;

export function nomorPeminta(k: KredensialCfo): string | null {
  return k.jenis === 'wa' && k.nomor ? k.nomor : null;
}

export async function ambilModel(k: KredensialCfo): Promise<{ data: DataCfo; model: ModelCfo }> {
  const data = await rpc<DataCfo>(k, 'cfo_ambil_data', { p_peminta_wa: nomorPeminta(k) });
  return { data, model: susunModelCfo(data, hariIniJakarta()) };
}

export async function catat(k: KredensialCfo, aksi: string, ringkas: Record<string, unknown>): Promise<void> {
  try {
    await rpc<number>(k, 'cfo_catat', { p_aksi: aksi, p_ringkas: ringkas, p_peminta_wa: nomorPeminta(k) });
  } catch (e) {
    // Audit tidak boleh menggagalkan jawaban, tapi kegagalannya harus terlihat di log server.
    console.error('cfo_catat gagal', e);
  }
}

/**
 * Narasi opsional oleh Gemini (penyedia AI yang sama dengan MK Connect).
 * Aktif hanya bila GEMINI_API_KEY diisi di environment server. Tanpa itu,
 * AI CFO tetap menjawab — dengan jawaban deterministik.
 */
async function narasiGemini(sistem: string, pengguna: string): Promise<string | null> {
  const kunci = process.env.GEMINI_API_KEY;
  if (!kunci) return null;
  const model = process.env.CFO_AI_MODEL || 'gemini-2.5-flash';
  const ctrl = new AbortController();
  const waktu = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': kunci },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistem }] },
        contents: [{ role: 'user', parts: [{ text: pengguna }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
      }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error('Gemini gagal', res.status);
      return null;
    }
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const teks = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
    return teks || null;
  } catch (e) {
    console.error('Gemini error', e);
    return null;
  } finally {
    clearTimeout(waktu);
  }
}

export interface HasilTanya {
  jawaban: string;
  mode: 'deterministik' | 'ai' | 'ai_ditolak';
  niat: string;
  putusan: string | null;
  fakta: { id: string; label: string; teks: string; sumber: string }[];
}

export async function tanyaCfo(
  model: ModelCfo,
  pertanyaan: string,
  riwayat: { peran: 'owner' | 'cfo'; isi: string }[] = [],
): Promise<HasilTanya & { dasar: JawabanCfo }> {
  const fakta = faktaCfo(model);
  const dasar = jawabDeterministik(pertanyaan, model, fakta);
  const rujukan = (ids: string[]) => fakta.filter((f) => ids.includes(f.id)).map(({ id, label, teks, sumber }) => ({ id, label, teks, sumber }));

  const ai = await narasiGemini(promptSistem(), promptPengguna(pertanyaan, fakta, dasar, riwayat));
  if (ai && validasiJawaban(ai, fakta, dasar)) {
    const disebut = [...new Set([...ai.matchAll(/\[(F\d+)\]/g)].map((m) => m[1]))];
    return { jawaban: ai, mode: 'ai', niat: dasar.niat, putusan: dasar.evaluasi?.putusan ?? null, fakta: rujukan(disebut.length ? disebut : dasar.fakta), dasar };
  }
  return {
    jawaban: dasar.jawaban,
    mode: ai ? 'ai_ditolak' : 'deterministik',
    niat: dasar.niat,
    putusan: dasar.evaluasi?.putusan ?? null,
    fakta: rujukan(dasar.fakta),
    dasar,
  };
}

export { ringkasUntukLog };
