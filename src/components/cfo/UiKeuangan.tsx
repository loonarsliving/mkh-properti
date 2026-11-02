'use client';

import { rp } from '@/lib/cfo/util';
import { daftarPeriode, type JenisPeriode, type PeriodeLaporan } from '@/lib/keuangan/periode';
import { LABEL_KELENGKAPAN, LABEL_STATUS, type Kelengkapan, type Sel, type StatusAngka } from '@/lib/keuangan/status';

/**
 * Komponen tampilan laporan institusional. Palet sengaja minim: angka hitam,
 * negatif dalam kurung, status ditandai penanda kecil — angka tetap fokus.
 */

const PENANDA: Record<StatusAngka, { simbol: string; warna: string }> = {
  aktual: { simbol: '', warna: '' },
  estimasi: { simbol: 'E', warna: 'text-amber-600' },
  sebagian: { simbol: 'S', warna: 'text-rose-600' },
  nol_kebijakan: { simbol: 'K', warna: 'text-slate-400' },
  belum_tercatat: { simbol: '', warna: '' },
  tidak_tersedia: { simbol: '', warna: '' },
  tidak_berlaku: { simbol: '', warna: '' },
};

/** Format akuntansi: negatif dalam kurung, tanpa "Rp" di tabel. */
export function angkaAkuntansi(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r).toLocaleString('id-ID');
  return r < 0 ? `(${s})` : s;
}

export function SelAngka({ s, tebal = false }: { s: Sel; tebal?: boolean }) {
  const judul = [LABEL_STATUS[s.status], s.catatan, s.sumber.length ? `Sumber: ${s.sumber.map((x) => (x.ket ? `${x.tabel} (${x.ket})` : x.tabel)).join('; ')}` : '']
    .filter(Boolean)
    .join('\n');
  if (s.status === 'tidak_berlaku') return <span className="text-slate-300" title={judul}>—</span>;
  if (s.nilai === null) {
    return (
      <span className="whitespace-nowrap text-[10.5px] italic text-rose-500" title={judul}>
        {s.status === 'belum_tercatat' ? 'belum tercatat' : 'tidak tersedia'}
      </span>
    );
  }
  const p = PENANDA[s.status];
  return (
    <span className={`whitespace-nowrap ${tebal ? 'font-bold' : ''}`} title={`${rp(s.nilai)}\n${judul}`}>
      {angkaAkuntansi(s.nilai)}
      {p.simbol ? <sup className={`ml-0.5 text-[8.5px] font-bold ${p.warna}`}>{p.simbol}</sup> : null}
    </span>
  );
}

const WARNA_KELENGKAPAN: Record<Kelengkapan, string> = {
  lengkap: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  perlu_verifikasi: 'border-amber-200 bg-amber-50 text-amber-800',
  tidak_lengkap: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function ChipKelengkapan({ k, kecil = false }: { k: Kelengkapan; kecil?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 ${kecil ? 'py-0 text-[9.5px]' : 'py-0.5 text-[10.5px]'} font-semibold ${WARNA_KELENGKAPAN[k]}`}>
      {LABEL_KELENGKAPAN[k]}
    </span>
  );
}

export function LegendaStatus() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-slate-500">
      <span>Angka tanpa tanda = aktual</span>
      <span><sup className="font-bold text-amber-600">E</sup> estimasi / biaya standar / sementara</span>
      <span><sup className="font-bold text-rose-600">S</sup> sebagian periode atau pos tidak lengkap</span>
      <span><sup className="font-bold text-slate-400">K</sup> nol karena kebijakan</span>
      <span><i className="text-rose-500">belum tercatat</i> = tidak ada sistem yang mencatat (bukan nol)</span>
      <span>— = tidak berlaku</span>
      <span>(…) = negatif · arahkan kursor untuk sumber & catatan</span>
    </div>
  );
}

export const NAMA_JENIS: Record<JenisPeriode, string> = { bulanan: 'Monthly', kuartalan: 'Quarterly', tahunan: 'Annual' };

export function PilihPeriode({
  hariIni,
  jenis,
  kode,
  onUbah,
}: {
  hariIni: string;
  jenis: JenisPeriode;
  kode: string;
  onUbah: (jenis: JenisPeriode, kode: string) => void;
}) {
  const daftar = daftarPeriode(jenis, hariIni, jenis === 'bulanan' ? 18 : jenis === 'kuartalan' ? 8 : 3);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
        {(Object.keys(NAMA_JENIS) as JenisPeriode[]).map((j) => (
          <button
            key={j}
            onClick={() => onUbah(j, daftarPeriode(j, hariIni, 1)[0].kode)}
            className={`px-2.5 py-1 text-[11px] font-semibold ${j === jenis ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}
          >
            {NAMA_JENIS[j]}
          </button>
        ))}
      </div>
      <select aria-label="Periode" className="input h-8 w-auto py-1 text-xs" value={kode} onChange={(e) => onUbah(jenis, e.target.value)}>
        {daftar.map((p: PeriodeLaporan) => (
          <option key={p.kode} value={p.kode}>
            {p.label}
          </option>
        ))}
      </select>
    </div>
  );
}
