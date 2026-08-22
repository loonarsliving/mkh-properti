'use client';

import { useMemo } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { susunLaporan } from '@/lib/akuntansi/sak-emkm';
import { filterProyek as saringProyek } from '@/lib/akuntansi/saldo';
import { fmt } from '@/lib/format';
import { labelPeriodeRingkas } from '@/lib/periode';
import { unduhCsv } from '@/lib/ekspor';

export default function HalamanNeracaSaldo() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiNeracaSaldo />
    </GuardHalaman>
  );
}

function IsiNeracaSaldo() {
  const { jurnal, memuat, galat, muatUlang } = useData();
  const { periode, proyek } = usePeriode();
  const toast = useToast();

  useJudul({
    judul: 'Neraca Saldo',
    deskripsi: 'Mutasi debet & kredit per akun dalam periode terpilih',
  });

  const laporan = useMemo(
    () => susunLaporan(saringProyek(jurnal, proyek), periode),
    [jurnal, proyek, periode],
  );

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const seimbang = Math.abs(laporan.totalNeracaSaldoD - laporan.totalNeracaSaldoK) < 1;

  return (
    <div className="space-y-4">
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel
        judul={`Neraca Saldo — ${labelPeriodeRingkas(periode)}`}
        ikon="coa"
        padat
        aksi={
          <>
            <span className={`chip ${seimbang ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              {seimbang ? '✓ Seimbang' : '⚠ Tidak seimbang'}
            </span>
            <button
              className="btn-ghost px-3 py-1 text-[11px]"
              onClick={() => {
                unduhCsv(
                  `neraca-saldo-${laporan.rentang.mulai}_${laporan.rentang.selesai}.csv`,
                  ['Kode', 'Nama Akun', 'Kategori', 'Mutasi Debet', 'Mutasi Kredit', 'Saldo'],
                  laporan.neracaSaldo.map((b) => [b.kode, b.nama, b.kat, b.D, b.K, b.saldo]),
                );
                toast.sukses('CSV neraca saldo diunduh.');
              }}
            >
              <Icon name="unduh" className="h-3.5 w-3.5" /> CSV
            </button>
          </>
        }
      >
        {laporan.neracaSaldo.length === 0 ? (
          <Kosong pesan="Tidak ada mutasi akun pada periode ini." ikon="coa" />
        ) : (
          <div className="thin-scroll max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th className="w-24">Kode</th>
                  <th>Nama Akun</th>
                  <th>Kategori</th>
                  <th className="text-right">Mutasi Debet</th>
                  <th className="text-right">Mutasi Kredit</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {laporan.neracaSaldo.map((b) => (
                  <tr key={b.kode}>
                    <td className="font-mono text-[11px] font-semibold text-blue-600">{b.kode}</td>
                    <td className="text-slate-700">{b.nama}</td>
                    <td className="text-[10.5px] text-slate-400">{b.kat || '(di luar COA)'}</td>
                    <td className="num text-emerald-600">{b.D > 0 ? fmt(b.D) : '-'}</td>
                    <td className="num text-amber-600">{b.K > 0 ? fmt(b.K) : '-'}</td>
                    <td className="num font-semibold text-slate-700">{fmt(b.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100">
                  <td colSpan={3} className="px-3 py-2.5 text-right text-[11.5px] font-bold text-slate-700">
                    TOTAL
                  </td>
                  <td className="num px-3 py-2.5 font-bold text-emerald-600">
                    {fmt(laporan.totalNeracaSaldoD)}
                  </td>
                  <td className="num px-3 py-2.5 font-bold text-amber-600">
                    {fmt(laporan.totalNeracaSaldoK)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
