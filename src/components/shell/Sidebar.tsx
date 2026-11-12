'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { logout, type Peran, type Sesi } from '@/lib/auth';
import { navigasiUntuk } from '@/lib/navigasi';
import { PERUSAHAAN } from '@/lib/config';

const LABEL_PERAN: Record<Peran, string> = {
  cfo: 'CFO / Owner',
  'admin-proyek': 'Admin Proyek',
  verifikator: 'Verifikator',
  pelaksana: 'Pelaksana Loonars 2',
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Sidebar({
  sesi,
  terbuka,
  onTutup,
}: {
  sesi: Sesi;
  terbuka: boolean;
  onTutup: () => void;
}) {
  const pathname = usePathname();
  const grup = navigasiUntuk(sesi.peran, sesi.aksesLoonars2);

  // Penanda menu aktif: satu kotak biru yang MELUNCUR ke menu yang dipilih
  // (posisinya diukur dari tautan aktif), bukan latar yang berkedip pindah.
  const daftarRef = useRef<HTMLDivElement | null>(null);
  const penandaRef = useRef<HTMLSpanElement | null>(null);
  const kunciMenu = grup.map((g) => g.item.map((i) => i.href).join(',')).join('|');
  useIsoLayoutEffect(() => {
    const penanda = penandaRef.current;
    const aktif = daftarRef.current?.querySelector<HTMLElement>('[data-aktif="true"]');
    if (!penanda) return;
    if (!aktif) {
      penanda.style.opacity = '0';
      return;
    }
    penanda.style.opacity = '1';
    penanda.style.top = `${aktif.offsetTop}px`;
    penanda.style.height = `${aktif.offsetHeight}px`;
  }, [pathname, kunciMenu]);

  return (
    <>
      {/* Latar gelap untuk mode mobile */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${
          terbuka ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onTutup}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-nav-bg text-slate-300
          transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:translate-x-0 ${
            terbuka ? 'translate-x-0 shadow-2xl shadow-black/40' : '-translate-x-full'
          }`}
      >
        {/* Blok identitas */}
        <div className="flex items-center gap-3 border-b border-nav-border px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-green text-base font-bold text-slate-900 shadow-lg shadow-amber-500/20 transition-transform duration-500 hover:rotate-[8deg] hover:scale-105">
            MK
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-white">MKH Property</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="anim-denyut h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                {LABEL_PERAN[sesi.peran]}
              </span>
            </div>
          </div>
          <button
            onClick={onTutup}
            className="rounded-md p-1 text-slate-400 hover:bg-nav-border hover:text-white lg:hidden"
            aria-label="Tutup menu"
          >
            <Icon name="silang" />
          </button>
        </div>

        {/* Daftar menu */}
        <nav className="thin-scroll flex-1 overflow-y-auto px-2.5 py-3">
          <div ref={daftarRef} className="relative">
          <span
            ref={penandaRef}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-lg bg-blue-600 opacity-0 shadow-md shadow-blue-900/50 transition-[top,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
          {grup.map((g, gi) => (
            <div key={g.judul || `grup-${gi}`} className="pb-1">
              {g.judul ? (
                <div className="px-2.5 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-nav-textDim">
                  {g.judul}
                </div>
              ) : null}
              {g.item.map((item) => {
                const aktif = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onTutup}
                    data-aktif={aktif}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px]
                      ${
                        aktif
                          ? 'font-semibold text-white'
                          : 'text-nav-text hover:bg-nav-bgAlt hover:text-white'
                      }`}
                  >
                    <Icon
                      name={item.ikon}
                      className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-125"
                    />
                    <span className="truncate transition-transform duration-300 group-hover:translate-x-0.5">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
          </div>
        </nav>

        {/* Kaki sidebar */}
        <div className="border-t border-nav-border px-3 py-3">
          <div className="mb-2 truncate px-1 font-mono text-[9.5px] text-nav-textDim" title={sesi.email}>
            {sesi.email}
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-slate-400 transition hover:bg-red-500/10 hover:text-red-400"
          >
            <Icon name="keluar" className="h-4 w-4" />
            Keluar
          </button>
          <div className="mt-2 px-1 font-mono text-[8.5px] leading-tight text-nav-textDim">
            {PERUSAHAAN}
          </div>
        </div>
      </aside>
    </>
  );
}
