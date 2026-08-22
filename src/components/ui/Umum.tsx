'use client';

import { useEffect, useState } from 'react';
import { Icon, type NamaIkon } from './Icon';

export function Memuat({ pesan = 'Memuat data…' }: { pesan?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600" />
      <p className="font-mono text-xs text-slate-500">{pesan}</p>
    </div>
  );
}

export function PesanGalat({ pesan, onCoba }: { pesan: string; onCoba?: () => void }) {
  return (
    <div className="card-pad border-red-200 bg-red-50">
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
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Icon name={ikon} className="h-7 w-7 text-slate-300" />
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

  if (!isi) return null;

  const warna =
    isi.nada === 'sukses'
      ? 'bg-emerald-500 text-white'
      : isi.nada === 'galat'
        ? 'bg-red-500 text-white'
        : 'bg-brand-amber text-slate-900';

  return (
    <div
      role="status"
      className={`fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg ${warna}`}
    >
      {isi.pesan}
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-slate-900/45">
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
