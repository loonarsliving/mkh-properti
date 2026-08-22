'use client';

import { useMemo } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Memuat, Panel, PesanGalat } from '@/components/ui/Umum';
import { susunLaporan, type KelompokPos } from '@/lib/akuntansi/sak-emkm';
import { filterProyek as saringProyek } from '@/lib/akuntansi/saldo';
import { fmt, fmtSigned, rupiah } from '@/lib/format';
import { labelTanggalPosisi } from '@/lib/periode';
import { PERUSAHAAN } from '@/lib/config';

export default function HalamanPosisiKeuangan() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiPosisiKeuangan />
    </GuardHalaman>
  );
}

function BlokPos({ kelompok }: { kelompok: KelompokPos }) {
  const baris = kelompok.baris.filter((b) => Math.abs(b.nilai) > 0.5);
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {kelompok.judul}
      </div>
      {baris.length === 0 ? (
        <p className="py-1 text-[11px] italic text-slate-400">Nihil.</p>
      ) : (
        baris.map((b) => (
          <div key={b.kode} className="flex justify-between border-b border-slate-100 py-1 text-[11.5px]">
            <span className="text-slate-500">{b.nama}</span>
            <span className="font-mono tabular-nums text-slate-700">{fmt(b.nilai)}</span>
          </div>
        ))
      )}
      <div className="flex justify-between border-t border-slate-300 py-1.5 text-[11.5px] font-bold">
        <span>Jumlah {kelompok.judul}</span>
        <span className="font-mono tabular-nums">{fmt(kelompok.total)}</span>
      </div>
    </div>
  );
}

function IsiPosisiKeuangan() {
  const { jurnal, memuat, galat, muatUlang } = useData();
  const { periode, proyek } = usePeriode();

  useJudul({
    judul: 'Laporan Posisi Keuangan (Neraca)',
    deskripsi: 'Saldo kumulatif sejak awal berdiri sampai akhir periode terpilih',
  });

  const laporan = useMemo(
    () => susunLaporan(saringProyek(jurnal, proyek), periode),
    [jurnal, proyek, periode],
  );

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const pk = laporan.posisiKeuangan;

  return (
    <div className="space-y-4">
      <div className="card-pad text-center">
        <div className="text-[14px] font-bold text-slate-800">{PERUSAHAAN}</div>
        <div className="text-[12px] font-semibold text-blue-600">LAPORAN POSISI KEUANGAN (NERACA)</div>
        <div className="text-[10.5px] text-slate-500">Per {labelTanggalPosisi(periode)}</div>
        <div className="text-[10px] italic text-slate-400">
          Neraca bersifat kumulatif — mencakup seluruh transaksi sejak awal sampai tanggal di atas,
          bukan hanya mutasi periode.
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel judul="Aset" ikon="kotak">
          <BlokPos kelompok={pk.asetLancar} />
          <BlokPos kelompok={pk.asetTetap} />
          <div className="flex justify-between rounded-lg bg-slate-100 px-3.5 py-2.5 text-[13px] font-bold">
            <span>JUMLAH ASET</span>
            <span className="text-emerald-600">{rupiah(pk.totalAset)}</span>
          </div>
        </Panel>

        <Panel judul="Liabilitas & Ekuitas" ikon="bank">
          <BlokPos kelompok={pk.liabilitasLancar} />
          <BlokPos kelompok={pk.liabilitasPanjang} />

          <div className="mb-4">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Ekuitas
            </div>
            {[
              ['Modal Disetor', pk.modal],
              ['Saldo Laba Awal Periode', pk.saldoLabaAwal],
              ['Laba (Rugi) Periode Berjalan', pk.labaPeriodeBerjalan],
            ].map(([label, nilai]) => (
              <div
                key={String(label)}
                className="flex justify-between border-b border-slate-100 py-1 text-[11.5px]"
              >
                <span className="text-slate-500">{label}</span>
                <span
                  className={`font-mono tabular-nums ${
                    (nilai as number) < 0 ? 'text-rose-600' : 'text-slate-700'
                  }`}
                >
                  {fmtSigned(nilai as number)}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-slate-300 py-1.5 text-[11.5px] font-bold">
              <span>Jumlah Ekuitas</span>
              <span className="font-mono tabular-nums">{fmt(pk.totalEkuitas)}</span>
            </div>
          </div>

          <div className="flex justify-between rounded-lg bg-slate-100 px-3.5 py-2.5 text-[13px] font-bold">
            <span>JUMLAH LIABILITAS DAN EKUITAS</span>
            <span className="text-amber-600">{rupiah(pk.totalLiabilitasEkuitas)}</span>
          </div>

          <div
            className={`mt-2 rounded-lg px-3 py-2 text-center text-[11px] font-semibold ${
              pk.seimbang ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {pk.seimbang
              ? '✓ Neraca seimbang'
              : `⚠ Selisih ${rupiah(pk.selisih)} — periksa jurnal yang debet ≠ kredit`}
          </div>
        </Panel>
      </div>
    </div>
  );
}
