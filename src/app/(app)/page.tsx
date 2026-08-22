'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { useSesi } from '@/components/shell/SesiProvider';
import { KartuKpi, KartuPil, KartuStat } from '@/components/ui/Kartu';
import { Icon } from '@/components/ui/Icon';
import { Memuat, Panel, PesanGalat } from '@/components/ui/Umum';
import { TabelTransaksi } from '@/components/ui/TabelTransaksi';
import { ringkasanPeriode } from '@/lib/akuntansi/sak-emkm';
import { filterProyek as saringProyek } from '@/lib/akuntansi/saldo';
import { BRANCHES, getProyek } from '@/lib/master';
import { fmtRingkas, rupiah, salamWaktu } from '@/lib/format';
import { labelPeriodeRingkas, periodeSebelumnya, rentang } from '@/lib/periode';
import type { Aset, Jurnal } from '@/types';

function persenPerubahan(sekarang: number, sebelum: number): number | null {
  if (Math.abs(sebelum) < 0.5) return sekarang === 0 ? null : 100;
  return ((sekarang - sebelum) / Math.abs(sebelum)) * 100;
}

function ringkasAset(daftar: Aset[]) {
  return {
    total: daftar.length,
    tersedia: daftar.filter((a) => a.status === 'tersedia').length,
    dp: daftar.filter((a) => a.status === 'dp').length,
    terjual: daftar.filter((a) => a.status === 'terjual').length,
    nilai: daftar.reduce((s, a) => s + (Number(a.harga) || 0), 0),
    nilaiTersedia: daftar
      .filter((a) => a.status === 'tersedia')
      .reduce((s, a) => s + (Number(a.harga) || 0), 0),
  };
}

export default function HalamanDashboard() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiDashboard />
    </GuardHalaman>
  );
}

function IsiDashboard() {
  const { jurnal, aset, memuat, galat, muatUlang } = useData();
  const { periode, proyek } = usePeriode();
  const sesi = useSesi();
  const [cabangTerpilih, setCabangTerpilih] = useState<string | null>(null);

  useJudul({
    judul: 'Dashboard Utama Keuangan',
    deskripsi: `Ringkasan kinerja ${labelPeriodeRingkas(periode)}`,
  });

  const jurnalTersaring = useMemo(() => saringProyek(jurnal, proyek), [jurnal, proyek]);
  const asetTersaring = useMemo(
    () => (proyek === 'ALL' ? aset : aset.filter((a) => a.proyek === proyek)),
    [aset, proyek],
  );

  const kini = useMemo(() => ringkasanPeriode(jurnalTersaring, periode), [jurnalTersaring, periode]);
  const lalu = useMemo(
    () => ringkasanPeriode(jurnalTersaring, periodeSebelumnya(periode)),
    [jurnalTersaring, periode],
  );

  const r = rentang(periode);
  const transaksiPeriode = useMemo(
    () => jurnalTersaring.filter((j) => j.tgl >= r.mulai && j.tgl <= r.selesai),
    [jurnalTersaring, r.mulai, r.selesai],
  );

  const statAset = useMemo(() => ringkasAset(asetTersaring), [asetTersaring]);

  if (memuat) return <Memuat pesan="Mengambil data keuangan…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const asetLancar = kini.kas + kini.piutang;
  const utangPendek = kini.utang;
  const rasioLancar = utangPendek > 0 ? asetLancar / utangPendek : null;

  return (
    <div className="space-y-4">
      {/* Sapaan */}
      <div className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-4 text-white shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-bold">
              {salamWaktu()}, {sesi.email.split('@')[0]}! 👋
            </h2>
            <p className="mt-0.5 text-[12px] text-blue-100">
              Menampilkan data periode {labelPeriodeRingkas(periode)}, dibandingkan periode
              sebelumnya dengan durasi sama.
            </p>
          </div>
          <span className="chip bg-white/15 text-white">
            <Icon name="grafik" className="h-3.5 w-3.5" /> Ringkasan Kinerja Bisnis
          </span>
        </div>
      </div>

      {/* KPI utama */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KartuKpi
          label="Total Pendapatan"
          nilai={kini.pendapatan}
          ikon="grafik"
          nada="emerald"
          perubahan={persenPerubahan(kini.pendapatan, lalu.pendapatan)}
          catatan="vs periode sebelumnya"
        />
        <KartuKpi
          label="Laba Kotor"
          nilai={kini.labaKotor}
          ikon="dompet"
          nada="amber"
          perubahan={persenPerubahan(kini.labaKotor, lalu.labaKotor)}
          progres={kini.pendapatan > 0 ? kini.marginKotor : null}
        />
        <KartuKpi
          label="Total Beban Operasional"
          nilai={kini.opex}
          ikon="kas-keluar"
          nada="rose"
          perubahan={persenPerubahan(kini.opex, lalu.opex)}
          catatan="Biaya operasional usaha"
        />
        <KartuKpi
          label="Laba Bersih"
          nilai={kini.labaBersih}
          ikon="ceklis"
          nada="blue"
          perubahan={persenPerubahan(kini.labaBersih, lalu.labaBersih)}
          progres={kini.pendapatan > 0 ? kini.marginBersih : null}
        />
      </div>

      {/* Statistik ringkas */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KartuStat
          label="Jumlah Transaksi"
          nilai={String(kini.jumlahTransaksi)}
          catatan={`${transaksiPeriode.length} baris jurnal`}
          ikon="dokumen"
          nada="violet"
        />
        <KartuStat
          label="Beban Pokok (HPP)"
          nilai={`Rp ${fmtRingkas(kini.hpp)}`}
          catatan={
            kini.pendapatan > 0
              ? `${((kini.hpp / kini.pendapatan) * 100).toFixed(1)}% dari pendapatan`
              : 'Belum ada pendapatan'
          }
          ikon="kotak"
          nada="rose"
        />
        <KartuStat
          label="Unit Terjual"
          nilai={`${statAset.terjual} / ${statAset.total}`}
          catatan={`${statAset.tersedia} unit masih tersedia`}
          ikon="rumah"
          nada="emerald"
        />
        <KartuStat
          label="Nilai Unit Tersedia"
          nilai={`Rp ${fmtRingkas(statAset.nilaiTersedia)}`}
          catatan="Potensi pendapatan"
          ikon="dompet"
          nada="amber"
        />
      </div>

      {/* Posisi keuangan ringkas */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KartuPil label="Kas & Bank" nilai={kini.kas} ikon="bank" nada="emerald" />
        <KartuPil label="Piutang" nilai={kini.piutang} ikon="dokumen" nada="blue" />
        <KartuPil label="Utang Jangka Pendek" nilai={kini.utang} ikon="kas-keluar" nada="rose" />
        <KartuPil label="Utang Jangka Panjang" nilai={kini.utangJangkaPanjang} ikon="bank" nada="amber" />
        <KartuPil label="Aset Tetap" nilai={kini.asetTetap} ikon="kotak" nada="violet" />
      </div>

      {/* Rasio lancar */}
      <div className="card-pad">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Icon name="ceklis" className="h-4 w-4 text-emerald-500" />
          <h3 className="text-[12.5px] font-bold text-slate-700">
            Kesehatan Likuiditas (Current Ratio)
          </h3>
          <span
            className={`chip ml-auto ${
              rasioLancar === null
                ? 'bg-slate-100 text-slate-500'
                : rasioLancar >= 1
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-rose-100 text-rose-700'
            }`}
          >
            {rasioLancar === null ? 'Tidak ada utang lancar' : `Rasio: ${rasioLancar.toFixed(1)}x`}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${
              rasioLancar === null || rasioLancar >= 1 ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
            style={{
              width: `${Math.max(2, Math.min(100, ((rasioLancar ?? 3) / 3) * 100))}%`,
            }}
          />
        </div>
        <p className="mt-2 text-[10.5px] text-slate-500">
          Aset lancar (kas &amp; bank {rupiah(kini.kas)} + piutang {rupiah(kini.piutang)}) dibanding
          utang jangka pendek {rupiah(utangPendek)}.
        </p>
      </div>

      {/* Cabang */}
      {cabangTerpilih ? (
        <DetailCabang
          id={cabangTerpilih}
          jurnal={jurnal}
          aset={aset}
          onKembali={() => setCabangTerpilih(null)}
        />
      ) : (
        <Panel judul="Ringkasan Cabang" ikon="bank">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {BRANCHES.map((b) => {
              const jb = jurnal.filter((j) => b.proyekIds.includes(j.proyek));
              const rb = ringkasanPeriode(jb, periode);
              const ab = ringkasAset(aset.filter((a) => b.proyekIds.includes(a.proyek)));
              return (
                <button
                  key={b.id}
                  onClick={() => setCabangTerpilih(b.id)}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:shadow-cardHover"
                  style={{ borderLeft: `3px solid ${b.warna}` }}
                >
                  <div className="font-mono text-[9px] uppercase tracking-wider" style={{ color: b.warna }}>
                    Cabang
                  </div>
                  <div className="text-[14px] font-bold text-slate-800">{b.nama}</div>
                  <div className="mb-2 truncate text-[10px] text-slate-400">
                    {b.proyekIds.map((id) => getProyek(id).nama).join(', ')}
                  </div>
                  <div className="text-[16px] font-bold" style={{ color: b.warna }}>
                    {rupiah(rb.kas)}
                  </div>
                  <div className="text-[9.5px] text-slate-400">Saldo kas &amp; bank</div>

                  <div className="mt-2.5 flex justify-between border-t border-slate-100 pt-2 text-[10px]">
                    <span className="text-slate-400">
                      Pendapatan
                      <br />
                      <b className="text-emerald-600">Rp {fmtRingkas(rb.pendapatan)}</b>
                    </span>
                    <span className="text-right text-slate-400">
                      Beban
                      <br />
                      <b className="text-rose-600">Rp {fmtRingkas(rb.hpp + rb.opex)}</b>
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-[10.5px]">
                    <span className="text-slate-400">Laba</span>
                    <b className={rb.labaBersih >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      Rp {fmtRingkas(rb.labaBersih)}
                    </b>
                  </div>
                  <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 font-mono text-[9px] text-slate-400">
                    <span>Unit {ab.total}</span>
                    <span className="text-rose-500">Terjual {ab.terjual}</span>
                    <span className="text-emerald-600">Sisa {ab.tersedia}</span>
                  </div>
                  <div className="mt-2 text-right text-[9.5px]" style={{ color: b.warna }}>
                    Lihat detail →
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Transaksi terbaru */}
      <Panel
        judul={`Transaksi Terbaru — ${labelPeriodeRingkas(periode)}`}
        ikon="buku"
        padat
        aksi={
          <Link href="/jurnal" className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200">
            Lihat semua jurnal →
          </Link>
        }
      >
        <TabelTransaksi baris={[...transaksiPeriode].reverse().slice(0, 12)} />
      </Panel>
    </div>
  );
}

function DetailCabang({
  id,
  jurnal,
  aset,
  onKembali,
}: {
  id: string;
  jurnal: Jurnal[];
  aset: Aset[];
  onKembali: () => void;
}) {
  const { periode } = usePeriode();
  const b = BRANCHES.find((x) => x.id === id);
  if (!b) return null;

  const jb = jurnal.filter((j) => b.proyekIds.includes(j.proyek));
  const r = rentang(periode);

  return (
    <Panel
      judul={`Cabang ${b.nama}`}
      ikon="bank"
      aksi={
        <button onClick={onKembali} className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200">
          <Icon name="panah-kiri" className="h-3 w-3" /> Kembali
        </button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {b.proyekIds.map((pid) => {
          const p = getProyek(pid);
          const rp = ringkasanPeriode(
            jurnal.filter((j) => j.proyek === pid),
            periode,
          );
          const ap = ringkasAset(aset.filter((a) => a.proyek === pid));
          return (
            <div
              key={pid}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"
              style={{ borderLeft: `3px solid ${p.warna}` }}
            >
              <div className="font-mono text-[9px] font-bold" style={{ color: p.warna }}>
                {p.id}
              </div>
              <div className="text-[13px] font-bold text-slate-800">{p.nama}</div>
              <div className="mb-2 font-mono text-[9px] text-slate-400">
                {p.rek} · {p.bank}
              </div>
              <div className="text-[16px] font-bold" style={{ color: p.warna }}>
                {rupiah(rp.kas)}
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-[10.5px]">
                <span className="text-slate-400">Laba periode</span>
                <b className={rp.labaBersih >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  Rp {fmtRingkas(rp.labaBersih)}
                </b>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 font-mono text-[9px] text-slate-400">
                <span>Unit {ap.total}</span>
                <span className="text-rose-500">Terjual {ap.terjual}</span>
                <span className="text-emerald-600">Sisa {ap.tersedia}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <h3 className="section-title">Transaksi Terbaru Cabang</h3>
        <div className="overflow-x-auto">
          <TabelTransaksi
            baris={[...jb.filter((j) => j.tgl >= r.mulai && j.tgl <= r.selesai)].reverse().slice(0, 10)}
          />
        </div>
      </div>
    </Panel>
  );
}
