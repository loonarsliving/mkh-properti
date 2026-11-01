'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { KERJA_KOSONG, susunKerjaCfo, type DataKerja, type KerjaCfo } from '@/lib/cfo/kerja';
import { susunModelCfo, type ModelCfo } from '@/lib/cfo/model';
import type { DataCfo } from '@/lib/cfo/tipe';
import { hariIniJakarta } from '@/lib/cfo/util';
import { sbRpc } from '@/lib/supabase';

/**
 * Satu kali muat `cfo_ambil_data` (hanya baca, CFO) untuk semua halaman AI CFO,
 * lalu susun model deterministik di browser. Semua halaman /cfo/* memakai
 * model yang sama → angka konsisten antar-halaman, dengan briefing WA, dan
 * dengan jawaban AI CFO Chat (yang memakai fungsi penyusun yang sama di server).
 */
interface IsiCfo {
  data: DataCfo | null;
  model: ModelCfo | null;
  kerja: KerjaCfo | null;
  galat: string | null;
  memuat: boolean;
  muatUlang: () => void;
}

const Ctx = createContext<IsiCfo | null>(null);

export function CfoProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<DataCfo | null>(null);
  const [dataKerja, setDataKerja] = useState<DataKerja>(KERJA_KOSONG);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);

  const muat = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const [d, k] = await Promise.all([
        sbRpc<DataCfo>('cfo_ambil_data', { p_peminta_wa: null }),
        // Data kerja (migrasi 0058); bila belum ada, halaman lain tetap berjalan.
        sbRpc<DataKerja>('cfo_ambil_kerja', { p_peminta_wa: null }).catch(() => KERJA_KOSONG),
      ]);
      setData(d);
      setDataKerja(k);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  const model = useMemo(() => (data ? susunModelCfo(data, hariIniJakarta()) : null), [data]);
  const kerja = useMemo(() => (model ? susunKerjaCfo(model, dataKerja) : null), [model, dataKerja]);
  const isi = useMemo(() => ({ data, model, kerja, galat, memuat, muatUlang: () => void muat() }), [data, model, kerja, galat, memuat, muat]);
  return <Ctx.Provider value={isi}>{children}</Ctx.Provider>;
}

export function useCfo(): IsiCfo {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCfo harus di dalam CfoProvider');
  return c;
}
