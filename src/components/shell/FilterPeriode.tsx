'use client';

import { useMemo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { usePeriode } from './PeriodeProvider';
import {
  NAMA_BULAN,
  daftarTahun,
  isSetahunPenuh,
  labelPeriodeRingkas,
  periodeBerjalan,
  periodeBulanIni,
  periodeTahun,
  rentang,
  type Periode,
} from '@/lib/periode';
import { PROYEK } from '@/lib/master';

/**
 * Pemilih periode laporan.
 *
 * Memenuhi dua cara pilih yang diminta:
 *   - rentang bulan bebas: "dari bulan X tahun A s.d. bulan Y tahun B"
 *   - satu tahun penuh: tombol pintas "Setahun" mengunci Januari–Desember
 *
 * Tanggal efektif (yyyy-mm-dd) ditampilkan sebagai teks read-only agar jelas
 * hari pertama/terakhir mana yang benar-benar dipakai mesin laporan.
 */
export function FilterPeriode({ tampilkanProyek = true }: { tampilkanProyek?: boolean }) {
  const { periode, setPeriode, proyek, setProyek } = usePeriode();
  const tahunOpsi = useMemo(() => daftarTahun('2024-01-01'), []);
  const r = rentang(periode);
  const setahun = isSetahunPenuh(periode);

  const ubah = (patch: Partial<Periode>) => setPeriode({ ...periode, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="chip bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200">
        <Icon name="kalender" className="h-3.5 w-3.5" />
        Periode: {labelPeriodeRingkas(periode)}
      </span>

      <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase text-slate-400 sm:flex">
        <Icon name="filter" className="h-3.5 w-3.5" />
        Dari
      </span>

      <select
        aria-label="Bulan mulai"
        className="input h-8 w-auto py-1 text-xs"
        value={periode.bulanMulai}
        onChange={(e) => ubah({ bulanMulai: Number(e.target.value) })}
      >
        {NAMA_BULAN.map((b, i) => (
          <option key={b} value={i + 1}>
            {b}
          </option>
        ))}
      </select>

      <select
        aria-label="Tahun mulai"
        className="input h-8 w-auto py-1 text-xs"
        value={periode.tahunMulai}
        onChange={(e) => ubah({ tahunMulai: Number(e.target.value) })}
      >
        {tahunOpsi.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <span className="font-mono text-[10px] uppercase text-slate-400">s/d</span>

      <select
        aria-label="Bulan selesai"
        className="input h-8 w-auto py-1 text-xs"
        value={periode.bulanSelesai}
        onChange={(e) => ubah({ bulanSelesai: Number(e.target.value) })}
      >
        {NAMA_BULAN.map((b, i) => (
          <option key={b} value={i + 1}>
            {b}
          </option>
        ))}
      </select>

      <select
        aria-label="Tahun selesai"
        className="input h-8 w-auto py-1 text-xs"
        value={periode.tahunSelesai}
        onChange={(e) => ubah({ tahunSelesai: Number(e.target.value) })}
      >
        {tahunOpsi.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <span className="hidden font-mono text-[10px] text-slate-400 xl:inline">
        {r.mulai} → {r.selesai}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPeriode(periodeBulanIni())}
          className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          Bulan Ini
        </button>
        <button
          type="button"
          onClick={() => setPeriode(periodeBerjalan())}
          className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200"
        >
          YTD
        </button>
        <button
          type="button"
          onClick={() => setPeriode(periodeTahun(periode.tahunSelesai))}
          className={`btn-xs ${
            setahun ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Setahun {periode.tahunSelesai}
        </button>
      </div>

      {tampilkanProyek ? (
        <select
          aria-label="Filter proyek"
          className="input h-8 w-auto py-1 text-xs"
          value={proyek}
          onChange={(e) => setProyek(e.target.value)}
        >
          <option value="ALL">Semua Proyek</option>
          {PROYEK.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.nama}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
