'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  periodeBerjalan,
  periodeDariParam,
  periodeKeParam,
  normalisasi,
  type Periode,
} from '@/lib/periode';

/**
 * Periode aktif dibagikan ke seluruh aplikasi supaya filter di topbar berlaku
 * untuk semua menu transaksi & laporan (persis seperti keterangan di tampilan
 * referensi: "Filter ini berlaku untuk seluruh menu transaksi & laporan").
 *
 * Nilai disimpan di sessionStorage agar bertahan saat pindah halaman/refresh,
 * dan dicerminkan ke query string `?periode=` supaya sebuah tampilan bisa
 * dibagikan lewat link.
 */

const KUNCI = 'mkh_periode';

interface KonteksPeriode {
  periode: Periode;
  setPeriode: (p: Periode) => void;
  proyek: string;
  setProyek: (p: string) => void;
}

const Ctx = createContext<KonteksPeriode | null>(null);

export function PeriodeProvider({ children }: { children: React.ReactNode }) {
  const [periode, setPeriodeState] = useState<Periode>(() => periodeBerjalan());
  const [proyek, setProyekState] = useState<string>('ALL');
  const [siap, setSiap] = useState(false);

  // Muat dari URL (prioritas) lalu sessionStorage, sekali di awal.
  useEffect(() => {
    const dariUrl = periodeDariParam(new URLSearchParams(window.location.search).get('periode'));
    if (dariUrl) {
      setPeriodeState(dariUrl);
    } else {
      const tersimpan = periodeDariParam(window.sessionStorage.getItem(KUNCI));
      if (tersimpan) setPeriodeState(tersimpan);
    }
    const proyekTersimpan = window.sessionStorage.getItem(`${KUNCI}_proyek`);
    if (proyekTersimpan) setProyekState(proyekTersimpan);
    setSiap(true);
  }, []);

  useEffect(() => {
    if (!siap) return;
    window.sessionStorage.setItem(KUNCI, periodeKeParam(periode));
  }, [periode, siap]);

  useEffect(() => {
    if (!siap) return;
    window.sessionStorage.setItem(`${KUNCI}_proyek`, proyek);
  }, [proyek, siap]);

  const setPeriode = useCallback((p: Periode) => setPeriodeState(normalisasi(p)), []);
  const setProyek = useCallback((p: string) => setProyekState(p), []);

  const nilai = useMemo(
    () => ({ periode, setPeriode, proyek, setProyek }),
    [periode, setPeriode, proyek, setProyek],
  );

  return <Ctx.Provider value={nilai}>{children}</Ctx.Provider>;
}

export function usePeriode(): KonteksPeriode {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePeriode harus dipakai di dalam <PeriodeProvider>.');
  return ctx;
}
