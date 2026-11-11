/**
 * Jawaban AI CFO untuk Loonars AI Advisor (repo Istri) — fungsi murni.
 *
 * Hanya baca. Memakai mesin deterministik yang sama dengan dashboard dan WA
 * (faktaCfo, jawabDeterministik, evaluasiKeputusan), TANPA narasi AI: advisor
 * yang merangkai kalimatnya sendiri, angka tetap dari sini. Data mentah
 * (cfo_ambil_data) tidak pernah dikembalikan — hanya fakta bernomor,
 * jawaban, dan hasil evaluasi.
 */
import { faktaCfo, jawabDeterministik, type Fakta } from './chat';
import type { LaporanHolding } from './holding';
import type { KerjaCfo } from './kerja';
import type { ModelCfo } from './model';
import { evaluasiKeputusan, type HasilEvaluasi, type RencanaKeputusan } from './penantang';

export type PermintaanAdvisor =
  | { mode: 'fakta' }
  | { mode: 'tanya'; pertanyaan: string }
  | { mode: 'evaluasi'; rencana: RencanaKeputusan };

export class GalatPermintaan extends Error {}

const LINI = ['L1', 'L2', 'Grup'] as const;

export function bacaPermintaan(body: unknown): PermintaanAdvisor {
  if (!body || typeof body !== 'object') throw new GalatPermintaan('Body harus objek JSON');
  const b = body as Record<string, unknown>;
  const mode = b.mode;
  if (mode === 'fakta') return { mode };
  if (mode === 'tanya') {
    const pertanyaan = typeof b.pertanyaan === 'string' ? b.pertanyaan.trim().slice(0, 1000) : '';
    if (!pertanyaan) throw new GalatPermintaan('Pertanyaan kosong');
    return { mode, pertanyaan };
  }
  if (mode === 'evaluasi') {
    const r = (b.rencana ?? {}) as Record<string, unknown>;
    const nominal = typeof r.nominal === 'number' ? r.nominal : NaN;
    if (!Number.isFinite(nominal) || nominal <= 0 || nominal > 1e13) throw new GalatPermintaan('rencana.nominal harus angka rupiah > 0');
    if (typeof r.lini !== 'string' || !(LINI as readonly string[]).includes(r.lini)) throw new GalatPermintaan('rencana.lini harus L1, L2, atau Grup');
    const ket = typeof r.ket === 'string' ? r.ket.trim().slice(0, 200) : '';
    if (!ket) throw new GalatPermintaan('rencana.ket wajib diisi');
    const tanggal = typeof r.tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.tanggal) ? r.tanggal : undefined;
    const cicilan = typeof r.cicilan === 'number' && Number.isInteger(r.cicilan) && r.cicilan >= 1 && r.cicilan <= 24 ? r.cicilan : undefined;
    return { mode, rencana: { nominal, lini: r.lini as RencanaKeputusan['lini'], ket, tanggal, cicilan } };
  }
  throw new GalatPermintaan('mode harus fakta, tanya, atau evaluasi');
}

type FaktaKeluar = Pick<Fakta, 'id' | 'label' | 'nilai' | 'teks' | 'sumber'>;

export interface JawabanAdvisor {
  sumber: 'MKH Property AI CFO';
  hariIni: string;
  mode: PermintaanAdvisor['mode'];
  label: 'ACTUAL' | 'PROJECTION';
  jawaban?: string;
  niat?: string;
  putusan?: string | null;
  evaluasi?: HasilEvaluasi;
  fakta: FaktaKeluar[];
}

export function jawabAdvisor(model: ModelCfo, p: PermintaanAdvisor, kerja?: KerjaCfo, holding?: LaporanHolding): JawabanAdvisor {
  const semua = faktaCfo(model, kerja, holding);
  const keluar = (daftar: Fakta[]): FaktaKeluar[] => daftar.map(({ id, label, nilai, teks, sumber }) => ({ id, label, nilai, teks, sumber }));
  const dasar = { sumber: 'MKH Property AI CFO' as const, hariIni: model.hariIni };
  if (p.mode === 'fakta') return { ...dasar, mode: 'fakta', label: 'ACTUAL', fakta: keluar(semua) };
  if (p.mode === 'tanya') {
    const j = jawabDeterministik(p.pertanyaan, model, semua);
    return {
      ...dasar,
      mode: 'tanya',
      label: j.evaluasi ? 'PROJECTION' : 'ACTUAL',
      jawaban: j.jawaban,
      niat: j.niat,
      putusan: j.evaluasi?.putusan ?? null,
      evaluasi: j.evaluasi,
      fakta: keluar(semua.filter((f) => j.fakta.includes(f.id))),
    };
  }
  const evaluasi = evaluasiKeputusan(model, p.rencana);
  return { ...dasar, mode: 'evaluasi', label: 'PROJECTION', putusan: evaluasi.putusan, evaluasi, fakta: keluar(semua) };
}
