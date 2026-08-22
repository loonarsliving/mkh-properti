'use client';

import { createContext, useContext } from 'react';
import type { Peran, Sesi } from '@/lib/auth';

const Ctx = createContext<Sesi | null>(null);

export function SesiProvider({ sesi, children }: { sesi: Sesi; children: React.ReactNode }) {
  return <Ctx.Provider value={sesi}>{children}</Ctx.Provider>;
}

export function useSesi(): Sesi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSesi harus dipakai di dalam <SesiProvider>.');
  return ctx;
}

/**
 * Penjaga tingkat halaman. Layout sudah memastikan user login; ini memastikan
 * peran-nya memang boleh membuka halaman tertentu.
 */
export function bolehAkses(peran: Peran, izinkan: Peran[]): boolean {
  return izinkan.includes(peran);
}
