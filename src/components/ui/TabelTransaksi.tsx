'use client';

import { Kosong } from './Umum';
import { TagProyek } from './Form';
import { fmt, tanggalPendek } from '@/lib/format';
import type { Jurnal } from '@/types';

/** Tabel ringkas baris jurnal — dipakai dashboard dan detail cabang. */
export function TabelTransaksi({ baris }: { baris: Jurnal[] }) {
  if (baris.length === 0) return <Kosong pesan="Belum ada transaksi pada periode ini." ikon="buku" />;

  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Tgl</th>
            <th>No</th>
            <th>Proyek</th>
            <th>Keterangan</th>
            <th className="text-right">Debet</th>
            <th className="text-right">Kredit</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((j, i) => (
            <tr key={j.id ?? `${j.no}-${i}`}>
              <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                {tanggalPendek(j.tgl)}
              </td>
              <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-blue-600">
                {j.no}
              </td>
              <td>
                <TagProyek id={j.proyek} />
              </td>
              <td className="max-w-[280px] truncate text-slate-500" title={j.ket}>
                {j.ket}
              </td>
              <td className="num text-emerald-600">{j.D > 0 ? fmt(j.D) : '-'}</td>
              <td className="num text-amber-600">{j.K > 0 ? fmt(j.K) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
