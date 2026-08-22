'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Memuat, Panel, PesanGalat } from '@/components/ui/Umum';
import { susunLaporan } from '@/lib/akuntansi/sak-emkm';
import { filterProyek as saringProyek } from '@/lib/akuntansi/saldo';
import { fmt, fmtAbs, rupiah } from '@/lib/format';
import { labelPeriodeLaporan, periodeSebelumnya } from '@/lib/periode';
import { PERUSAHAAN } from '@/lib/config';

export default function HalamanLabaRugi() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiLabaRugi />
    </GuardHalaman>
  );
}

function IsiLabaRugi() {
  const { jurnal, memuat, galat, muatUlang } = useData();
  const { periode, proyek } = usePeriode();

  useJudul({
    judul: 'Laporan Laba Rugi',
    deskripsi: 'Penyajian sesuai SAK EMKM — pendapatan dikurangi beban',
  });

  const tersaring = useMemo(() => saringProyek(jurnal, proyek), [jurnal, proyek]);
  const kini = useMemo(() => susunLaporan(tersaring, periode), [tersaring, periode]);
  const lalu = useMemo(
    () => susunLaporan(tersaring, periodeSebelumnya(periode)),
    [tersaring, periode],
  );

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const lr = kini.labaRugi;
  const lrLalu = lalu.labaRugi;

  const kelompok = [
    { k: lr.pendapatan, pembanding: lrLalu.pendapatan.total, judul: 'Pendapatan', warna: 'text-emerald-600' },
    { k: lr.bebanPokok, pembanding: lrLalu.bebanPokok.total, judul: 'Beban Pokok Pendapatan', warna: 'text-rose-600' },
    {
      k: lr.bebanOperasional,
      pembanding: lrLalu.bebanOperasional.total,
      judul: 'Beban Operasional',
      warna: 'text-violet-600',
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel judul="Laporan Laba Rugi" ikon="grafik">
        <div className="mb-4 border-b border-slate-200 pb-3 text-center">
          <div className="text-[14px] font-bold text-slate-800">{PERUSAHAAN}</div>
          <div className="text-[12px] font-semibold text-blue-600">LAPORAN LABA RUGI</div>
          <div className="text-[10.5px] text-slate-500">{labelPeriodeLaporan(periode)}</div>
          <div className="text-[10px] italic text-slate-400">(Disajikan dalam Rupiah)</div>
        </div>

        {kelompok.map((g) => (
          <div key={g.judul} className="mb-4">
            <div className={`mb-1.5 text-[10.5px] font-bold uppercase tracking-wide ${g.warna}`}>
              {g.judul}
            </div>
            {g.k.baris.length === 0 ? (
              <p className="py-1 text-[11px] italic text-slate-400">Tidak ada mutasi pada periode ini.</p>
            ) : (
              g.k.baris.map((b) => (
                <div
                  key={b.kode}
                  className="flex justify-between border-b border-slate-100 py-1 text-[11.5px]"
                >
                  <span className="text-slate-500">
                    <span className="font-mono text-[10px] text-slate-400">{b.kode}</span> — {b.nama}
                  </span>
                  <span className="font-mono tabular-nums text-slate-700">{fmt(b.nilai)}</span>
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-slate-300 py-1.5 text-[11.5px] font-bold">
              <span>Jumlah {g.judul}</span>
              <span className={`font-mono tabular-nums ${g.warna}`}>{fmt(g.k.total)}</span>
            </div>
          </div>
        ))}

        <div className="mb-2 flex justify-between rounded-lg bg-slate-100 px-3.5 py-2.5 text-[12.5px] font-bold">
          <span>LABA KOTOR</span>
          <span className={lr.labaKotor >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
            {rupiah(lr.labaKotor)}
          </span>
        </div>

        <div
          className={`rounded-lg border px-4 py-3.5 ${
            lr.labaBersih >= 0 ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'
          }`}
        >
          <div className="flex justify-between text-[14px] font-bold">
            <span>LABA (RUGI) BERSIH PERIODE BERJALAN</span>
            <span className={lr.labaBersih >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              {lr.labaBersih >= 0 ? rupiah(lr.labaBersih) : `(Rp ${fmtAbs(lr.labaBersih)})`}
            </span>
          </div>
          {lr.pendapatan.total > 0 ? (
            <div className="mt-1 text-[10.5px] text-slate-500">
              Margin laba bersih: {((lr.labaBersih / lr.pendapatan.total) * 100).toFixed(1)}% · Margin
              laba kotor: {((lr.labaKotor / lr.pendapatan.total) * 100).toFixed(1)}%
            </div>
          ) : null}
        </div>

        <p className="mt-4 text-[10px] italic text-slate-400">
          Beban pajak penghasilan tidak dibukukan di jurnal dan karenanya tidak ditampilkan di sini.
          Isi taksiran pajak di halaman{' '}
          <Link href="/laporan-keuangan" className="text-blue-600 underline">
            Laporan Keuangan
          </Link>{' '}
          bila laporan resmi membutuhkannya.
        </p>
      </Panel>

      <Panel judul="Perbandingan Periode" ikon="grafik">
        <table className="tbl">
          <thead>
            <tr>
              <th>Pos</th>
              <th className="text-right">Periode Ini</th>
              <th className="text-right">Sebelumnya</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Pendapatan', lr.pendapatan.total, lrLalu.pendapatan.total],
              ['Beban Pokok', lr.bebanPokok.total, lrLalu.bebanPokok.total],
              ['Laba Kotor', lr.labaKotor, lrLalu.labaKotor],
              ['Beban Operasional', lr.bebanOperasional.total, lrLalu.bebanOperasional.total],
              ['Laba Bersih', lr.labaBersih, lrLalu.labaBersih],
            ].map(([label, a, b]) => (
              <tr key={String(label)}>
                <td className="text-[11.5px]">{label}</td>
                <td className="num font-semibold">{fmt(a as number)}</td>
                <td className="num text-slate-400">{fmt(b as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 text-[10px] text-slate-400">
          Periode pembanding memakai durasi yang sama persis dengan periode terpilih.
        </p>
      </Panel>
    </div>
  );
}
