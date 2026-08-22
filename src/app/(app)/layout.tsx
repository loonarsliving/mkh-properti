'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useGuard, type Peran } from '@/lib/auth';
import { Sidebar } from '@/components/shell/Sidebar';
import { FilterPeriode } from '@/components/shell/FilterPeriode';
import { PeriodeProvider } from '@/components/shell/PeriodeProvider';
import { DataProvider } from '@/components/shell/DataProvider';
import { JudulProvider, useIsiJudul } from '@/components/shell/JudulProvider';
import { SesiProvider } from '@/components/shell/SesiProvider';

/** Semua peran boleh masuk kerangka ini; tiap halaman menyaring lebih lanjut. */
const SEMUA_PERAN: Peran[] = ['cfo', 'admin-proyek', 'verifikator'];

function Topbar({ onBukaMenu }: { onBukaMenu: () => void }) {
  const { judul, deskripsi, tampilkanFilter, tampilkanFilterProyek } = useIsiJudul();

  return (
    <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          onClick={onBukaMenu}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 lg:hidden"
          aria-label="Buka menu"
        >
          <Icon name="menu" />
        </button>

        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold text-slate-800">{judul}</h1>
          {deskripsi ? <p className="truncate text-[11px] text-slate-500">{deskripsi}</p> : null}
        </div>

        {tampilkanFilter ? (
          <div className="ml-auto">
            <FilterPeriode tampilkanProyek={tampilkanFilterProyek} />
          </div>
        ) : null}
      </div>

      {tampilkanFilter ? (
        <p className="border-t border-slate-100 px-4 py-1.5 font-mono text-[10px] italic text-slate-400">
          Filter periode berlaku untuk seluruh menu transaksi &amp; laporan.
        </p>
      ) : null}
    </header>
  );
}

export default function LayoutAplikasi({ children }: { children: React.ReactNode }) {
  const { status, sesi } = useGuard(SEMUA_PERAN);
  const [menuTerbuka, setMenuTerbuka] = useState(false);

  if (status !== 'siap' || !sesi) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-blue-600" />
          <p className="font-mono text-xs text-slate-500">Memeriksa sesi…</p>
        </div>
      </div>
    );
  }

  return (
    <SesiProvider sesi={sesi}>
      <PeriodeProvider>
        <DataProvider>
          <JudulProvider>
            <div className="min-h-screen bg-slate-100">
              <div className="no-print">
                <Sidebar sesi={sesi} terbuka={menuTerbuka} onTutup={() => setMenuTerbuka(false)} />
              </div>

              <div className="lg:pl-[248px] print:pl-0">
                <Topbar onBukaMenu={() => setMenuTerbuka(true)} />
                <main className="animate-fadeIn p-4 sm:p-5 print:p-0">{children}</main>
              </div>
            </div>
          </JudulProvider>
        </DataProvider>
      </PeriodeProvider>
    </SesiProvider>
  );
}
