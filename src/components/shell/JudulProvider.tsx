'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface IsiJudul {
  judul: string;
  deskripsi?: string;
  tampilkanFilter: boolean;
  tampilkanFilterProyek: boolean;
}

interface KonteksJudul {
  isi: IsiJudul;
  set: (i: IsiJudul) => void;
}

const DEFAULT: IsiJudul = {
  judul: 'MKH Property',
  tampilkanFilter: true,
  tampilkanFilterProyek: true,
};

const Ctx = createContext<KonteksJudul | null>(null);

export function JudulProvider({ children }: { children: React.ReactNode }) {
  const [isi, setIsi] = useState<IsiJudul>(DEFAULT);
  const nilai = useMemo<KonteksJudul>(() => ({ isi, set: setIsi }), [isi]);
  return <Ctx.Provider value={nilai}>{children}</Ctx.Provider>;
}

function useJudulCtx(): KonteksJudul {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useJudul harus dipakai di dalam <JudulProvider>.');
  return ctx;
}

export function useIsiJudul(): IsiJudul {
  return useJudulCtx().isi;
}

/**
 * Dipanggil setiap halaman untuk mengisi judul & deskripsi di topbar.
 *
 * Sengaja hanya menerima nilai primitif — tombol aksi dirender halaman itu
 * sendiri di area konten, supaya tidak ada elemen React tersimpan di state
 * yang closure-nya bisa basi.
 */
export function useJudul(opsi: {
  judul: string;
  deskripsi?: string;
  tampilkanFilter?: boolean;
  tampilkanFilterProyek?: boolean;
}): void {
  const { set } = useJudulCtx();
  const { judul, deskripsi, tampilkanFilter = true, tampilkanFilterProyek = true } = opsi;

  useEffect(() => {
    set({ judul, deskripsi, tampilkanFilter, tampilkanFilterProyek });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [judul, deskripsi, tampilkanFilter, tampilkanFilterProyek]);
}
