'use client';

import { Icon, type NamaIkon } from './Icon';
import { fmtRingkas, rupiah } from '@/lib/format';

export type NadaKartu = 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' | 'slate';

const NADA: Record<NadaKartu, { kartu: string; ikon: string; teks: string; bar: string }> = {
  emerald: {
    kartu: 'from-emerald-50 to-emerald-100/60 border-emerald-200/70',
    ikon: 'bg-emerald-500',
    teks: 'text-emerald-700',
    bar: 'bg-emerald-500',
  },
  amber: {
    kartu: 'from-amber-50 to-amber-100/60 border-amber-200/70',
    ikon: 'bg-amber-500',
    teks: 'text-amber-700',
    bar: 'bg-amber-500',
  },
  rose: {
    kartu: 'from-rose-50 to-rose-100/60 border-rose-200/70',
    ikon: 'bg-rose-500',
    teks: 'text-rose-700',
    bar: 'bg-rose-500',
  },
  blue: {
    kartu: 'from-blue-50 to-blue-100/60 border-blue-200/70',
    ikon: 'bg-blue-500',
    teks: 'text-blue-700',
    bar: 'bg-blue-500',
  },
  violet: {
    kartu: 'from-violet-50 to-violet-100/60 border-violet-200/70',
    ikon: 'bg-violet-500',
    teks: 'text-violet-700',
    bar: 'bg-violet-500',
  },
  slate: {
    kartu: 'from-slate-50 to-slate-100/60 border-slate-200',
    ikon: 'bg-slate-500',
    teks: 'text-slate-700',
    bar: 'bg-slate-500',
  },
};

/** Kartu KPI besar bergradasi — baris teratas dashboard. */
export function KartuKpi({
  label,
  nilai,
  ikon,
  nada,
  perubahan,
  catatan,
  progres,
}: {
  label: string;
  nilai: number;
  ikon: NamaIkon;
  nada: NadaKartu;
  /** Persentase perubahan vs periode pembanding. null = tidak ada pembanding. */
  perubahan?: number | null;
  catatan?: string;
  /** 0–100, menampilkan bar tipis di bawah nilai. */
  progres?: number | null;
}) {
  const n = NADA[nada];
  const naik = (perubahan ?? 0) >= 0;

  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 shadow-card ${n.kartu}`}>
      <div className="mb-3 flex items-start justify-between">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${n.ikon}`}>
          <Icon name={ikon} className="h-[18px] w-[18px]" />
        </div>
        {perubahan === null || perubahan === undefined ? null : (
          <span
            className={`chip ${
              naik ? 'bg-white/70 text-emerald-700' : 'bg-white/70 text-rose-700'
            }`}
          >
            {naik ? '▲' : '▼'} {Math.abs(perubahan).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-slate-500">{label}</div>
      <div className={`mt-1 text-[21px] font-bold leading-tight ${n.teks}`} title={rupiah(nilai)}>
        {rupiah(nilai)}
      </div>

      {progres !== null && progres !== undefined ? (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/70">
            <div
              className={`h-full rounded-full ${n.bar}`}
              style={{ width: `${Math.max(0, Math.min(100, progres))}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-slate-500">{progres.toFixed(1)}%</span>
        </div>
      ) : catatan ? (
        <div className="mt-1.5 text-[10px] text-slate-500">{catatan}</div>
      ) : null}
    </div>
  );
}

/** Kartu statistik kecil berlatar putih — baris kedua dashboard. */
export function KartuStat({
  label,
  nilai,
  catatan,
  ikon,
  nada,
}: {
  label: string;
  nilai: string;
  catatan?: string;
  ikon: NamaIkon;
  nada: NadaKartu;
}) {
  const n = NADA[nada];
  return (
    <div className="card-pad flex items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${n.ikon}`}>
        <Icon name={ikon} className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-slate-500">{label}</div>
        <div className="truncate text-[17px] font-bold text-slate-800">{nilai}</div>
        {catatan ? <div className="truncate text-[10px] text-slate-400">{catatan}</div> : null}
      </div>
    </div>
  );
}

/** Kartu pil gelap — baris posisi keuangan ringkas. */
export function KartuPil({
  label,
  nilai,
  ikon,
  nada,
}: {
  label: string;
  nilai: number;
  ikon: NamaIkon;
  nada: NadaKartu;
}) {
  const n = NADA[nada];
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-nav-bg px-3.5 py-3 shadow-card">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${n.ikon}`}>
        <Icon name={ikon} className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-[0.09em] text-slate-400">{label}</div>
        <div className="truncate text-[15px] font-bold text-white" title={rupiah(nilai)}>
          Rp {fmtRingkas(nilai)}
        </div>
      </div>
    </div>
  );
}
