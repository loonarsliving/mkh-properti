/**
 * Bagian SERVER Laporan Investor: ambil data dari Supabase, render PDF,
 * catat unduhan. Hanya diimpor oleh route handler di src/app/api/.
 *
 * Tidak memakai service-role key. Akses ditentukan oleh database sendiri
 * (RPC ir_ambil_data, migrasi 0040):
 *   - web: access token CFO yang diteruskan dari browser;
 *   - WhatsApp: anon key + header x-ir-report-secret + nomor peminta yang
 *     terdaftar di ir_wa_penerima.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import { SB_KEY, SB_URL } from '@/lib/config';
import { hariTerakhir } from '@/lib/periode';
import { BAGIAN_LAPORAN, type KunciBagian } from './kontrak';
import { bulanDataPertama, bulanIni, susunModel, type DataLaporan, type ModelLaporan, type OpsiLaporan } from './model';
import { DokumenLaporan } from './pdf';

export type Kredensial =
  | { jenis: 'cfo'; token: string }
  | { jenis: 'wa'; rahasia: string; nomor: string };

function header(k: Kredensial): Record<string, string> {
  if (k.jenis === 'cfo') {
    return { apikey: SB_KEY, Authorization: `Bearer ${k.token}`, 'Content-Type': 'application/json' };
  }
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'x-ir-report-secret': k.rahasia,
  };
}

export class GalatAkses extends Error {}

async function rpc<T>(k: Kredensial, fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: header(k),
    body: JSON.stringify(args),
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) throw new GalatAkses('Tidak berhak');
  const teks = await res.text();
  if (!res.ok) {
    if (teks.includes('42501') || teks.includes('Tidak berhak')) throw new GalatAkses('Tidak berhak');
    throw new Error(`Supabase ${fn} gagal (${res.status})`);
  }
  return JSON.parse(teks) as T;
}

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;
const KUNCI_BAGIAN = new Set<string>(BAGIAN_LAPORAN.map((b) => b.kunci));

/** Validasi & normalisasi parameter dari klien / WA. */
export function bacaOpsi(masukan: unknown): Partial<OpsiLaporan> {
  const o = (masukan ?? {}) as Record<string, unknown>;
  const hasil: Partial<OpsiLaporan> = {};
  if (typeof o.dari === 'string' && POLA_BULAN.test(o.dari)) hasil.dari = o.dari;
  if (typeof o.sampai === 'string' && POLA_BULAN.test(o.sampai)) hasil.sampai = o.sampai;
  if (Array.isArray(o.unit)) hasil.unit = o.unit.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{2,41}$/.test(x));
  if (Array.isArray(o.bagian)) hasil.bagian = o.bagian.filter((x): x is KunciBagian => typeof x === 'string' && KUNCI_BAGIAN.has(x));
  return hasil;
}

function akhirBulan(p: string): string {
  const [t, b] = p.split('-').map(Number);
  return `${p}-${String(hariTerakhir(t, b)).padStart(2, '0')}`;
}

export async function susunLaporanServer(
  k: Kredensial,
  parsial: Partial<OpsiLaporan>,
): Promise<{ model: ModelLaporan; pdf: Buffer; sha256: string; namaBerkas: string }> {
  const sampai = parsial.sampai ?? bulanIni();
  const data = await rpc<DataLaporan>(k, 'ir_ambil_data', {
    p_sampai: akhirBulan(sampai),
    p_peminta_wa: k.jenis === 'wa' ? k.nomor : null,
  });
  // "Sampai saat ini": tanpa `dari`, mulai dari bulan data pertama.
  const dari = parsial.dari ?? bulanDataPertama(data);
  const opsi: OpsiLaporan = {
    unit: parsial.unit ?? [],
    dari: dari <= sampai ? dari : sampai,
    sampai,
    bagian: parsial.bagian?.length ? parsial.bagian : BAGIAN_LAPORAN.map((b) => b.kunci),
  };
  const model = susunModel(data, opsi);
  // DokumenLaporan merender <Document> di akarnya; tipe renderToBuffer hanya
  // menerima elemen Document secara langsung, jadi perlu penegasan tipe.
  const elemen = createElement(DokumenLaporan, { model }) as unknown as ReactElement<DocumentProps>;
  const pdf = await renderToBuffer(elemen);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const namaBerkas = `Laporan-Investor-MKH_${opsi.dari}_${opsi.sampai}.pdf`;

  await rpc<number>(k, 'ir_catat_unduhan', {
    p_kanal: k.jenis === 'cfo' ? 'web' : 'whatsapp',
    p_parameter: { ...opsi, bagian: opsi.bagian },
    p_sha256: sha256,
    p_ukuran: pdf.length,
    p_peminta_wa: k.jenis === 'wa' ? k.nomor : null,
  });

  return { model, pdf, sha256, namaBerkas };
}

/** Perbandingan rahasia yang tahan timing attack. */
export function rahasiaCocok(diberikan: string, seharusnya: string): boolean {
  const a = Buffer.from(diberikan);
  const b = Buffer.from(seharusnya);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function responsPdf(pdf: Buffer, namaBerkas: string, sha256: string): Response {
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${namaBerkas}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-SHA256': sha256,
    },
  });
}
