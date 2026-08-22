'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sbGet } from '@/lib/supabase';
import { normalisasiJurnal } from '@/lib/akuntansi/saldo';
import type {
  Aset,
  BayarTukang,
  Jurnal,
  JurnalRow,
  TukangBorongan,
  UsersProyek,
  UtangBank,
} from '@/types';

/**
 * Pemuat data inti sekali jalan untuk seluruh modul yang butuh login.
 *
 * Di versi HTML lama, setiap halaman memuat ulang `jurnal`, `aset`, dst dari
 * nol. Karena provider ini hidup di layout, data tetap tersimpan saat pindah
 * antar menu — pindah dari Jurnal ke Laba Rugi tidak menembak database lagi.
 *
 * Tabel opsional (`utang_bank`, `tukang_borongan`, `bayar_tukang`,
 * `users_proyek`) diperlakukan sama seperti sebelumnya: kegagalan query tidak
 * menggagalkan halaman, hanya menghasilkan daftar kosong.
 */

interface KonteksData {
  jurnal: Jurnal[];
  aset: Aset[];
  utangBank: UtangBank[];
  usersProyek: UsersProyek[];
  tukang: TukangBorongan[];
  bayarTukang: BayarTukang[];
  memuat: boolean;
  galat: string | null;
  muatUlang: () => Promise<void>;
  /** Sisipkan baris jurnal baru ke state tanpa memuat ulang seluruh tabel. */
  tambahJurnal: (rows: JurnalRow[]) => void;
  hapusJurnalNo: (no: string) => void;
  setAset: React.Dispatch<React.SetStateAction<Aset[]>>;
  setUtangBank: React.Dispatch<React.SetStateAction<UtangBank[]>>;
  setUsersProyek: React.Dispatch<React.SetStateAction<UsersProyek[]>>;
  setTukang: React.Dispatch<React.SetStateAction<TukangBorongan[]>>;
  setBayarTukang: React.Dispatch<React.SetStateAction<BayarTukang[]>>;
}

const Ctx = createContext<KonteksData | null>(null);

function angka(v: unknown): number {
  return Number(v) || 0;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [jurnal, setJurnal] = useState<Jurnal[]>([]);
  const [aset, setAset] = useState<Aset[]>([]);
  const [utangBank, setUtangBank] = useState<UtangBank[]>([]);
  const [usersProyek, setUsersProyek] = useState<UsersProyek[]>([]);
  const [tukang, setTukang] = useState<TukangBorongan[]>([]);
  const [bayarTukang, setBayarTukang] = useState<BayarTukang[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState<string | null>(null);

  const muatUlang = useCallback(async () => {
    setMemuat(true);
    setGalat(null);
    try {
      const [j, a, ub, up, tk, bt] = await Promise.all([
        sbGet<JurnalRow>('jurnal', 'select=*'),
        sbGet<Aset>('aset', 'select=*'),
        sbGet<UtangBank>('utang_bank', 'select=*').catch(() => [] as UtangBank[]),
        sbGet<UsersProyek>('users_proyek', 'select=*').catch(() => [] as UsersProyek[]),
        sbGet<TukangBorongan>('tukang_borongan', 'select=*').catch(() => [] as TukangBorongan[]),
        sbGet<BayarTukang>('bayar_tukang', 'select=*').catch(() => [] as BayarTukang[]),
      ]);

      setJurnal(normalisasiJurnal(j));
      setAset(a);
      setUtangBank(
        ub.map((u) => ({
          ...u,
          pokok: angka(u.pokok),
          potongan_per_unit: angka(u.potongan_per_unit),
          terbayar: angka(u.terbayar),
        })),
      );
      setUsersProyek(up);
      setTukang(
        tk.map((t) => ({
          ...t,
          nilai_kontrak: angka(t.nilai_kontrak),
          terbayar: angka(t.terbayar),
          total_unit: angka(t.total_unit),
          unit_selesai: angka(t.unit_selesai),
          harga_per_unit: angka(t.harga_per_unit),
        })),
      );
      setBayarTukang(bt);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  const tambahJurnal = useCallback((rows: JurnalRow[]) => {
    setJurnal((sebelumnya) => [...sebelumnya, ...normalisasiJurnal(rows)]);
  }, []);

  const hapusJurnalNo = useCallback((no: string) => {
    setJurnal((sebelumnya) => sebelumnya.filter((j) => j.no !== no));
  }, []);

  const nilai = useMemo<KonteksData>(
    () => ({
      jurnal,
      aset,
      utangBank,
      usersProyek,
      tukang,
      bayarTukang,
      memuat,
      galat,
      muatUlang,
      tambahJurnal,
      hapusJurnalNo,
      setAset,
      setUtangBank,
      setUsersProyek,
      setTukang,
      setBayarTukang,
    }),
    [jurnal, aset, utangBank, usersProyek, tukang, bayarTukang, memuat, galat, muatUlang, tambahJurnal, hapusJurnalNo],
  );

  return <Ctx.Provider value={nilai}>{children}</Ctx.Provider>;
}

export function useData(): KonteksData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useData harus dipakai di dalam <DataProvider>.');
  return ctx;
}
