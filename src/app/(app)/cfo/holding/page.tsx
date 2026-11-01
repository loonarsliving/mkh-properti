'use client';

import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Badge, Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel, Uang } from '@/components/cfo/Ui';
import { laporanHolding, TAHUN_BUKU_RESMI_PERTAMA, type BarisLr } from '@/lib/cfo/holding';
import type { ModelCfo } from '@/lib/cfo/model';
import { labelTanggal } from '@/lib/cfo/util';

/** Laporan Keuangan Holding (SAK EMKM) — Loonars 1 + Loonars 2 + biaya holding. */
export default function HalamanCfoHolding() {
  useJudul({ judul: 'Laporan Holding (SAK EMKM)', deskripsi: 'PT Loonars Mahakarya — gabungan Loonars 1 + Loonars 2 + biaya holding', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

function Tabel({ baris, total }: { baris: BarisLr[]; total?: BarisLr[] }) {
  const sel = (n: number | null) => (
    <td className="px-3 py-1.5 text-right font-mono">
      <Uang n={n} tidakAda="—" />
    </td>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11px] uppercase text-slate-500">
            <th className="px-3 py-1.5">Akun</th>
            <th className="px-3 py-1.5 text-right">Loonars 1</th>
            <th className="px-3 py-1.5 text-right">Loonars 2</th>
            <th className="px-3 py-1.5 text-right">Holding</th>
            <th className="px-3 py-1.5 text-right">Konsolidasi</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((b) => (
            <tr key={b.kode} className="border-b border-slate-100">
              <td className="px-3 py-1.5">
                {b.label}
                {b.catatan && <div className="text-[10.5px] text-slate-500">{b.catatan}</div>}
              </td>
              {sel(b.L1)}
              {sel(b.L2)}
              {sel(b.holding)}
              {sel(b.konsolidasi)}
            </tr>
          ))}
          {(total ?? []).map((b) => (
            <tr key={b.kode} className="border-t-2 border-slate-300 font-semibold">
              <td className="px-3 py-1.5">{b.label}</td>
              {sel(b.L1)}
              {sel(b.L2)}
              {sel(b.holding)}
              {sel(b.konsolidasi)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Isi({ m }: { m: ModelCfo }) {
  const { data } = useCfo();
  const tahunIni = Number(m.hariIni.slice(0, 4));
  const pilihan = [...new Set([tahunIni, TAHUN_BUKU_RESMI_PERTAMA])].sort();
  const [tahun, setTahun] = useState(tahunIni);
  const h = useMemo(() => (data ? laporanHolding(m, data, tahun) : null), [m, data, tahun]);
  if (!h) return null;
  const lb = h.labaBersih;
  const barisLaba: BarisLr = { kode: '9-99', label: 'LABA (RUGI) BERSIH', L1: lb.L1, L2: lb.L2, holding: lb.holding, konsolidasi: lb.konsolidasi };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[15px] font-bold">{h.entitas}</div>
        <Badge nada={h.resmi ? 'green' : 'amber'} anak={h.statusPeriode} />
        <div className="no-print ml-auto flex items-center gap-2">
          <select aria-label="Tahun" className="input h-8 w-auto py-1 text-xs" value={tahun} onChange={(e) => setTahun(Number(e.target.value))}>
            {pilihan.map((t) => (
              <option key={t} value={t}>
                {t}
                {t >= TAHUN_BUKU_RESMI_PERTAMA ? ' (resmi)' : ' (persiapan)'}
              </option>
            ))}
          </select>
          <button className="btn-amber" onClick={() => window.print()}>
            <Icon name="printer" className="h-3.5 w-3.5" /> Cetak
          </button>
        </div>
      </div>

      <Panel judul={`Laporan Laba Rugi — tahun ${h.tahun}`} ikon="grafik">
        <Tabel baris={h.labaRugi} total={[barisLaba]} />
        <Catatan>Pendapatan positif, beban negatif. Uang investor Loonars 2 sebelum serah terima adalah uang muka (liabilitas), bukan pendapatan.</Catatan>
      </Panel>

      <Panel judul={`Laporan Posisi Keuangan — per ${labelTanggal(h.posisi.perTanggal)}`} ikon="buku">
        <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500">Aset</div>
        <Tabel baris={h.posisi.aset} total={[h.posisi.totalAset]} />
        <div className="mb-1 mt-3 text-[11px] font-semibold uppercase text-slate-500">Liabilitas</div>
        <Tabel baris={h.posisi.liabilitas} total={[h.posisi.totalLiabilitas, h.posisi.ekuitas]} />
        <Catatan>Posisi keuangan dihitung dari data hari ini. Arsip posisi akhir bulan/tahun dibekukan lewat tutup buku (Meja Kerja CFO).</Catatan>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel judul="Beban gaji holding per cabang" ikon="orang-grup">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase text-slate-500">
                <th className="py-1">Cabang</th>
                <th className="py-1 text-right">Sudah ditransfer</th>
                <th className="py-1 text-right">Belum ditransfer (utang)</th>
              </tr>
            </thead>
            <tbody>
              {h.gaji.perCabang.map((c) => (
                <tr key={c.cabang} className="border-b border-slate-100">
                  <td className="py-1">{c.cabang}</td>
                  <td className="py-1 text-right font-mono"><Uang n={c.dibayar} /></td>
                  <td className="py-1 text-right font-mono"><Uang n={c.terutang} /></td>
                </tr>
              ))}
              {!h.gaji.perCabang.length && (
                <tr><td colSpan={3} className="py-2 italic text-slate-400">Belum ada slip gaji untuk tahun ini (atau data MK Connect belum tersinkron).</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
        <Panel judul="Rekonsiliasi ke laporan sumber" ikon="ceklis">
          <ul className="space-y-1 text-[12px]">
            {h.rekonsiliasi.map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-2 border-b border-slate-100 py-1">
                <span>{r.label}<div className="font-mono text-[10.5px] text-slate-500"><Uang n={r.kiri} /> vs <Uang n={r.kanan} /></div></span>
                <Badge nada={r.cocok ? 'green' : 'red'} anak={r.cocok ? 'cocok' : 'selisih'} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel judul="Catatan atas Laporan Keuangan" ikon="dokumen">
        <div className="space-y-3 text-[12.5px]">
          {h.catatan.map((c) => (
            <div key={c.judul}>
              <div className="font-semibold">{c.judul}</div>
              <ul className="ml-4 list-disc space-y-0.5 text-slate-700">
                {c.isi.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
