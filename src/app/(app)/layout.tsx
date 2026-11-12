'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { useGuard, type Peran } from '@/lib/auth';
import { Sidebar } from '@/components/shell/Sidebar';
import { FilterPeriode } from '@/components/shell/FilterPeriode';
import { PeriodeProvider } from '@/components/shell/PeriodeProvider';
import { DataProvider } from '@/components/shell/DataProvider';
import { JudulProvider, useIsiJudul } from '@/components/shell/JudulProvider';
import { SesiProvider } from '@/components/shell/SesiProvider';

/** Semua peran boleh masuk kerangka ini; tiap halaman menyaring lebih lanjut. */
const SEMUA_PERAN: Peran[] = ['cfo', 'admin-proyek', 'verifikator', 'pelaksana'];

function Topbar({ onBukaMenu }: { onBukaMenu: () => void }) {
  const { judul, deskripsi, tampilkanFilter, tampilkanFilterProyek } = useIsiJudul();

  return (
    <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          onClick={onBukaMenu}
          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 lg:hidden"
          aria-label="Buka menu"
        >
          <Icon name="menu" />
        </button>

        <div key={judul} className="anim-naik min-w-0">
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
  const { status, sesi } = useGuard(SEMUA_PERAN, true);
  const [menuTerbuka, setMenuTerbuka] = useState(false);

  // Transisi halus tiap pindah halaman. Sengaja Web Animations API, BUKAN
  // `key` pada <main>: `key` akan memasang ulang layout anak (mis. CfoProvider
  // yang memuat data sekali) setiap pindah menu. Animasi ini juga tidak
  // meninggalkan transform, jadi overlay `fixed` di dalam halaman tetap benar.
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement | null>(null);
  const pertama = useRef(true);
  useEffect(() => {
    if (pertama.current) {
      pertama.current = false;
      return;
    }
    const el = mainRef.current;
    if (!el?.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [pathname]);

  if (status !== 'siap' || !sesi) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="anim-muncul flex flex-col items-center gap-4">
          <div className="anim-melayang flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-amber to-brand-green text-lg font-bold text-slate-900 shadow-lg shadow-amber-500/30">
            MK
          </div>
          <div className="kerangka h-1 w-36" />
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
                <main ref={mainRef} className="animate-fadeIn p-4 sm:p-5 print:p-0">
                  {children}
                </main>
              </div>
            </div>
          </JudulProvider>
        </DataProvider>
      </PeriodeProvider>
    </SesiProvider>
  );
}
