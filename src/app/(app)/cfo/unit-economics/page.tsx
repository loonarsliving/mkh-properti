'use client';

import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel } from '@/components/cfo/Ui';
import { angkaAkuntansi, LegendaStatus } from '@/components/cfo/UiKeuangan';
import type { ModelCfo } from '@/lib/cfo/model';
import { labelBulan } from '@/lib/cfo/util';
import { unduhCsv } from '@/lib/ekspor';
import { LABEL_STATUS } from '@/lib/keuangan/status';
import { unitEkonomiLoonars1, type KpiHospitality } from '@/lib/keuangan/unit-ekonomi';

/** Hospitality Unit Economics — Loonars 1. */
export default function HalamanUnitEconomics() {
  useJudul({ judul: 'Hospitality Unit Economics', deskripsi: 'Loonars 1 — okupansi, ADR, RevPAR, GOPPAR, channel', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

function format(k: KpiHospitality): string {
  const n = k.sel.nilai;
  if (n === null) return '';
  if (k.satuan === 'pct') return `${n.toFixed(1).replace('.', ',')}%`;
  if (k.satuan === 'malam' || k.satuan === 'hari') return `${n.toFixed(2).replace('.', ',')} ${k.satuan}`;
  return `Rp ${angkaAkuntansi(n)}`;
}

function NilaiKpi({ k, besar = false }: { k: KpiHospitality; besar?: boolean }) {
  const judul = [k.rumus, LABEL_STATUS[k.sel.status], k.sel.catatan].filter(Boolean).join('\n');
  if (k.sel.nilai === null) return <span className="text-[11px] italic text-rose-500" title={judul}>tidak tersedia</span>;
  return (
    <span className={besar ? 'text-[18px] font-bold text-slate-900' : ''} title={judul}>
      {format(k)}
      {k.sel.status === 'estimasi' ? <sup className="ml-0.5 text-[9px] font-bold text-amber-600">E</sup> : null}
    </span>
  );
}

function Isi({ m }: { m: ModelCfo }) {
  const { data } = useCfo();
  const bulan = useMemo(() => (data ? unitEkonomiLoonars1(m, data) : []), [m, data]);
  const [pilih, setPilih] = useState<string | null>(null);
  if (!bulan.length) return <Kosong pesan="Belum ada laporan villa (Loonars 1) — unit economics belum bisa dihitung." />;
  const aktif = bulan.find((b) => b.bulan === pilih) ?? [...bulan].reverse().find((b) => b.status === 'final') ?? bulan.at(-1)!;
  const utama = ['OCC', 'ADR', 'REVPAR', 'GOPPAR'];

  const ekspor = () => {
    const kode = bulan[0].kpi.map((k) => k.kode);
    unduhCsv(
      'unit-economics-loonars1.csv',
      ['KPI', 'Rumus', ...bulan.map((b) => `${b.bulan} (${b.status})`)],
      kode.map((kd) => {
        const contoh = bulan[0].kpi.find((x) => x.kode === kd)!;
        return [contoh.label, contoh.rumus, ...bulan.map((b) => b.kpi.find((x) => x.kode === kd)!.sel.nilai ?? 'tidak tersedia')];
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div className="no-print card-pad flex flex-wrap items-center gap-2">
        <select aria-label="Bulan" className="input h-8 w-auto py-1 text-xs" value={aktif.bulan} onChange={(e) => setPilih(e.target.value)}>
          {[...bulan].reverse().map((b) => (
            <option key={b.bulan} value={b.bulan}>{labelBulan(b.bulan)}{b.status !== 'final' ? ' (sementara)' : ''}</option>
          ))}
        </select>
        <select aria-label="Properti" className="input h-8 w-auto py-1 text-xs" value="L1" disabled>
          <option value="L1">Loonars 1 (13 kamar)</option>
        </select>
        <span className="text-[11px] text-slate-500">Loonars 2 belum beroperasi sebagai hospitality.</span>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-ghost btn-xs" onClick={ekspor}><Icon name="unduh" className="h-3.5 w-3.5" /> CSV</button>
          <button className="btn-ghost btn-xs" onClick={() => window.print()}><Icon name="printer" className="h-3.5 w-3.5" /> Cetak</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {utama.map((kd) => {
          const k = aktif.kpi.find((x) => x.kode === kd)!;
          return (
            <div key={kd} className="card-pad">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-slate-500">{k.label}</div>
              <div className="mt-0.5"><NilaiKpi k={k} besar /></div>
              <div className="text-[10.5px] text-slate-400">{k.rumus}</div>
            </div>
          );
        })}
      </div>

      <Panel judul={`KPI ${labelBulan(aktif.bulan)}${aktif.status !== 'final' ? ' — sementara' : ''}`} ikon="grafik" padat>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">KPI</th>
                <th className="px-3 py-2 text-right">Nilai</th>
                <th className="px-3 py-2">Rumus</th>
                <th className="px-3 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {aktif.kpi.map((k) => (
                <tr key={k.kode} className="border-b border-slate-100">
                  <td className="px-4 py-1.5 font-medium">{k.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono"><NilaiKpi k={k} /></td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-500">{k.rumus}</td>
                  <td className="px-3 py-1.5 text-[11px] text-slate-500">{k.sel.catatan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">
          Malam tersedia {aktif.malamTersedia} · malam terjual {aktif.malamTerjual} · kamar {aktif.jumlahKamar ?? '—'}
        </div>
      </Panel>

      <Panel judul={`Revenue per channel — ${labelBulan(aktif.bulan)}`} ikon="kirim" padat>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Channel</th>
                <th className="px-3 py-2">Jenis</th>
                <th className="px-3 py-2 text-right">Booking</th>
                <th className="px-3 py-2 text-right">Room nights</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Porsi</th>
                <th className="px-3 py-2 text-right">Komisi</th>
                <th className="px-3 py-2 text-right">Rasio komisi</th>
                <th className="px-3 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {aktif.channel.map((c) => (
                <tr key={c.sumber} className="border-b border-slate-100">
                  <td className="px-4 py-1.5 font-sans">{c.sumber}</td>
                  <td className="px-3 py-1.5 font-sans text-[11px] text-slate-500">{c.langsung ? 'Direct' : 'OTA'}</td>
                  <td className="px-3 py-1.5 text-right">{c.booking}</td>
                  <td className="px-3 py-1.5 text-right">{c.malam}</td>
                  <td className="px-3 py-1.5 text-right">{angkaAkuntansi(c.kotor)}</td>
                  <td className="px-3 py-1.5 text-right">{c.porsiKotorPct === null ? '—' : `${c.porsiKotorPct.toFixed(1)}%`}</td>
                  <td className="px-3 py-1.5 text-right">{angkaAkuntansi(c.komisi)}</td>
                  <td className="px-3 py-1.5 text-right">{c.rasioKomisiPct === null ? '—' : `${c.rasioKomisiPct.toFixed(1)}%`}</td>
                  <td className="px-3 py-1.5 text-right">{angkaAkuntansi(c.bersih)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel judul="Tren bulanan" ikon="kalender" padat>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">KPI</th>
                {bulan.map((b) => (
                  <th key={b.bulan} className="px-3 py-2 text-right">{labelBulan(b.bulan)}{b.status !== 'final' ? '*' : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {bulan[0].kpi.map((k0) => (
                <tr key={k0.kode} className="border-b border-slate-100">
                  <td className="px-4 py-1.5 font-sans">{k0.label}</td>
                  {bulan.map((b) => (
                    <td key={b.bulan} className="px-3 py-1.5 text-right"><NilaiKpi k={b.kpi.find((x) => x.kode === k0.kode)!} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500">* sementara</div>
      </Panel>

      <div className="space-y-2">
        <LegendaStatus />
        <Catatan>
          Available Room Nights saat ini = unit × hari dari laporan villa, belum mengurangi kamar yang ditutup maintenance per tanggal.
          Inventaris kamar historis per tanggal (snapshot harian villa) dijadwalkan di Tahap 2c, sehingga Occupancy, RevPAR, dan GOPPAR
          ditandai estimasi sampai saat itu. GOP memakai biaya standar villa.
        </Catatan>
      </div>
    </div>
  );
}
