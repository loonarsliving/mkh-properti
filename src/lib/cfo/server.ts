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
 * Narasi AI memakai layanan AI MK Connect (lihat narasiMkConnect).
 */
import { createHash } from 'node:crypto';
import { rpc, type Kredensial } from '@/lib/laporan-investor/server';
import { faktaCfo, jawabDeterministik, promptPengguna, ringkasUntukLog, validasiJawaban, type JawabanCfo } from './chat';
import { KERJA_KOSONG, susunKerjaCfo, type DataKerja, type KerjaCfo } from './kerja';
import { susunModelCfo, type ModelCfo } from './model';
import type { DataCfo } from './tipe';
import { hariIniJakarta } from './util';

export type KredensialCfo = Extract<Kredensial, { jenis: 'cfo' | 'wa' }>;

export function nomorPeminta(k: KredensialCfo): string | null {
  return k.jenis === 'wa' && k.nomor ? k.nomor : null;
}

export async function ambilModel(k: KredensialCfo): Promise<{ data: DataCfo; model: ModelCfo; kerja: KerjaCfo; dataKerja: DataKerja }> {
  const [data, dataKerja] = await Promise.all([
    rpc<DataCfo>(k, 'cfo_ambil_data', { p_peminta_wa: nomorPeminta(k) }),
    // Data kerja (migrasi 0058). Bila belum tersedia, AI CFO tetap berjalan tanpa reviu/tindakan.
    rpc<DataKerja>(k, 'cfo_ambil_kerja', { p_peminta_wa: nomorPeminta(k) }).catch((e: unknown) => {
      console.error('cfo_ambil_kerja gagal', e);
      return KERJA_KOSONG;
    }),
  ]);
  const model = susunModelCfo(data, hariIniJakarta());
  return { data, model, kerja: susunKerjaCfo(model, dataKerja), dataKerja };
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
 * Narasi oleh layanan AI MK Connect (Mkhsistem) — MKH Property TIDAK punya
 * kunci/penyedia AI sendiri. Isi permintaan di-hash, ditandatangani database
 * (RPC cfo_tanda_ai, HMAC rahasia sync yang sudah ada, berlaku 5 menit), lalu
 * MK Connect memverifikasi dan memanggil penyedia AI-nya (circuit breaker,
 * telemetri) lewat POST /api/mkh-property/ai-cfo/narasi.
 * Gagal di titik mana pun → null → jawaban deterministik dipakai.
 */
const MK_CONNECT_URL = (process.env.MK_CONNECT_URL || 'https://mkh.haluoleo.id').replace(/\/$/, '');

async function narasiMkConnect(k: KredensialCfo, pengguna: string): Promise<string | null> {
  // System prompt (aturan AI CFO) dipegang MK Connect, bukan dikirim dari sini.
  const body = JSON.stringify({ pengguna });
  try {
    const hash = createHash('sha256').update(body).digest('hex');
    const tanda = await rpc<{ ts: number; sig: string }>(k, 'cfo_tanda_ai', { p_hash: hash, p_peminta_wa: nomorPeminta(k) });
    const res = await fetch(`${MK_CONNECT_URL}/api/mkh-property/ai-cfo/narasi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mkh-cfo-ts': String(tanda.ts), 'x-mkh-cfo-sig': tanda.sig },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.error('AI MK Connect gagal', res.status);
      return null;
    }
    const j = (await res.json()) as { teks?: string };
    return j.teks?.trim() || null;
  } catch (e) {
    console.error('AI MK Connect error', e);
    return null;
  }
}

export interface HasilTanya {
  jawaban: string;
  mode: 'deterministik' | 'ai' | 'ai_ditolak';
  niat: string;
  putusan: string | null;
  fakta: { id: string; label: string; teks: string; sumber: string }[];
}

/**
 * @param narasi  kredensial untuk meminta narasi AI MK Connect; null = hanya
 *                jawaban deterministik (dipakai jalur WA, karena asisten WA
 *                MK Connect sendiri yang merangkai jawaban akhirnya).
 */
export async function tanyaCfo(
  model: ModelCfo,
  pertanyaan: string,
  riwayat: { peran: 'owner' | 'cfo'; isi: string }[] = [],
  narasi: KredensialCfo | null = null,
  kerja?: KerjaCfo,
): Promise<HasilTanya & { dasar: JawabanCfo }> {
  const fakta = faktaCfo(model, kerja);
  const dasar = jawabDeterministik(pertanyaan, model, fakta);
  const rujukan = (ids: string[]) => fakta.filter((f) => ids.includes(f.id)).map(({ id, label, teks, sumber }) => ({ id, label, teks, sumber }));

  const ai = narasi ? await narasiMkConnect(narasi, promptPengguna(pertanyaan, fakta, dasar, riwayat)) : null;
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
