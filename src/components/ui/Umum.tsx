'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { Icon, type NamaIkon } from './Icon';

export function Memuat({ pesan = 'Memuat data…' }: { pesan?: string }) {
  return (
    <div role="status" aria-live="polite" className="anim-muncul space-y-4 py-6">
      {/* Kerangka halaman berkilau: terasa lebih cepat daripada lingkaran berputar. */}
      <div aria-hidden className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`kerangka h-[92px] ${i > 1 ? 'hidden xl:block' : i === 1 ? 'hidden sm:block' : ''}`} />
        ))}
      </div>
      <div aria-hidden className="kerangka h-40" />
      <div className="flex items-center justify-center gap-2.5">
        <span className="titik-ketik text-blue-600" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <p className="font-mono text-xs text-slate-500">{pesan}</p>
      </div>
    </div>
  );
}

export function PesanGalat({ pesan, onCoba }: { pesan: string; onCoba?: () => void }) {
  return (
    <div role="alert" className="card-pad border-red-200 bg-red-50">
      <div className="flex items-start gap-2.5">
        <Icon name="peringatan" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-700">Gagal memuat data</p>
          <p className="mt-0.5 break-words font-mono text-[11px] text-red-600">{pesan}</p>
        </div>
        {onCoba ? (
          <button onClick={onCoba} className="btn-ghost shrink-0 px-3 py-1 text-xs">
            <Icon name="segar" className="h-3.5 w-3.5" /> Coba lagi
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Kosong({ pesan, ikon = 'info' }: { pesan: string; ikon?: NamaIkon }) {
  return (
    <div className="anim-naik flex flex-col items-center gap-2 py-12 text-center">
      <span className="anim-melayang flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <Icon name={ikon} className="h-6 w-6 text-slate-300" />
      </span>
      <p className="text-sm text-slate-400">{pesan}</p>
    </div>
  );
}

export function Panel({
  judul,
  ikon,
  aksi,
  children,
  padat = false,
}: {
  judul: string;
  ikon?: NamaIkon;
  aksi?: React.ReactNode;
  children: React.ReactNode;
  padat?: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
        {ikon ? <Icon name={ikon} className="h-4 w-4 text-slate-400" /> : null}
        <h2 className="text-[12.5px] font-bold uppercase tracking-[0.04em] text-slate-700">{judul}</h2>
        {aksi ? <div className="ml-auto flex items-center gap-2">{aksi}</div> : null}
      </div>
      <div className={padat ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export type NadaToast = 'sukses' | 'galat' | 'info';

export interface IsiToast {
  pesan: string;
  nada: NadaToast;
}

/** Toast sederhana — pengganti fungsi toast() di halaman HTML lama. */
export function Toast({ isi, onSelesai }: { isi: IsiToast | null; onSelesai: () => void }) {
  useEffect(() => {
    if (!isi) return;
    const t = setTimeout(onSelesai, 3500);
    return () => clearTimeout(t);
  }, [isi, onSelesai]);

  const warna =
    isi?.nada === 'sukses'
      ? 'bg-emerald-500 text-white shadow-emerald-500/30'
      : isi?.nada === 'galat'
        ? 'bg-red-500 text-white shadow-red-500/30'
        : 'bg-brand-amber text-slate-900 shadow-amber-500/30';
  const tanda = isi?.nada === 'sukses' ? '✓' : isi?.nada === 'galat' ? '!' : 'i';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <AnimatePresence>
        {isi ? (
          <m.div
            key={`${isi.nada}:${isi.pesan}`}
            role="status"
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={`pointer-events-auto flex max-w-[90vw] items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg ${warna}`}
          >
            <span className="anim-letup flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/25 text-[11px] font-bold [animation-delay:0.12s]">
              {tanda}
            </span>
            {isi.pesan}
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function useToast() {
  const [isi, setIsi] = useState<IsiToast | null>(null);
  return {
    isi,
    bersihkan: () => setIsi(null),
    sukses: (pesan: string) => setIsi({ pesan, nada: 'sukses' }),
    galat: (pesan: string) => setIsi({ pesan, nada: 'galat' }),
    info: (pesan: string) => setIsi({ pesan, nada: 'info' }),
  };
}

/** Overlay saat menyimpan ke database. */
export function OverlaySimpan({ pesan }: { pesan: string | null }) {
  if (!pesan) return null;
  return (
    <div className="anim-muncul fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-900/50 backdrop-blur-[2px]">
      <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
      <p className="font-mono text-xs text-white">{pesan}</p>
    </div>
  );
}

export function Badge({
  anak,
  nada = 'slate',
}: {
  anak: React.ReactNode;
  nada?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const warna = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
  }[nada];
  return <span className={`chip ${warna}`}>{anak}</span>;
}
