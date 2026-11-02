'use client';

import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel } from '@/components/cfo/Ui';
import { ChipKelengkapan, LegendaStatus, PilihPeriode, SelAngka } from '@/components/cfo/UiKeuangan';
import type { ModelCfo } from '@/lib/cfo/model';
import { unduhCsv } from '@/lib/ekspor';
import { bandingLabaRugi, KOLOM, labaRugiInstitusional, type Cakupan, type BarisPl } from '@/lib/keuangan/laba-rugi';
import { periodeMemuat, type JenisPeriode } from '@/lib/keuangan/periode';
import { LABEL_KELENGKAPAN, LABEL_STATUS, type Sel } from '@/lib/keuangan/status';

/** Profit & Loss Statement — institusional, per properti & konsolidasi. */
export default function HalamanLabaRugiInstitusional() {
  useJudul({ judul: 'Profit & Loss Statement', deskripsi: 'Laba rugi institusional — aktual vs periode lalu vs anggaran, per properti & konsolidasi', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

function kodePeriode(jenis: JenisPeriode, kode: string) {
  if (jenis === 'bulanan') return periodeMemuat('bulanan', kode);
  if (jenis === 'kuartalan') return periodeMemuat('kuartalan', `${kode.slice(0, 4)}-${String((Number(kode.slice(6)) - 1) * 3 + 1).padStart(2, '0')}`);
  return periodeMemuat('tahunan', `${kode}-01`);
}

const gayaBaris = (j: BarisPl['jenis']) =>
  j === 'subtotal' ? 'border-t border-slate-300 bg-slate-50/70 font-semibold' : j === 'memo' ? 'border-t border-dashed border-slate-200 italic text-slate-500' : 'border-b border-slate-100';

const nilaiCsv = (s: Sel) => (s.nilai === null ? LABEL_STATUS[s.status] : s.nilai);

function Isi({ m }: { m: ModelCfo }) {
  const { data, kerja } = useCfo();
  const awal = m.l1.terakhirFinal?.bulan ?? m.hariIni.slice(0, 7);
  const [jenis, setJenis] = useState<JenisPeriode>('bulanan');
  const [kode, setKode] = useState(awal);
  const [cakupan, setCakupan] = useState<Cakupan>('konsolidasi');
  const [tampilan, setTampilan] = useState<'banding' | 'properti'>('banding');
  const periode = kodePeriode(jenis, kode);
  const arsip = kerja?.laporanBulanan;

  const banding = useMemo(() => (data ? bandingLabaRugi(m, data, periode, cakupan, arsip) : null), [m, data, periode.kode, periode.jenis, cakupan, arsip]); // eslint-disable-line react-hooks/exhaustive-deps
  const lr = useMemo(() => (data ? labaRugiInstitusional(m, data, periode, arsip) : null), [m, data, periode.kode, periode.jenis, arsip]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!banding || !lr) return null;

  const adaAnggaran = banding.baris.some((b) => b.anggaran.nilai !== null);
  const namaCakupan = cakupan === 'konsolidasi' ? 'Consolidated' : KOLOM.find((k) => k.id === cakupan)!.label;
  const dibuat = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  const ekspor = () => {
    if (tampilan === 'banding') {
      unduhCsv(
        `laba-rugi-${cakupan}-${periode.kode}.csv`,
        ['Kode', 'Pos', `Aktual ${periode.label}`, 'Status aktual', `Periode lalu ${banding.lalu.periode.label}`, 'Selisih', 'Anggaran', 'Kelengkapan', 'Catatan'],
        banding.baris.map((b) => [b.kode, b.label, nilaiCsv(b.aktual), LABEL_STATUS[b.aktual.status], nilaiCsv(b.lalu), b.selisih, nilaiCsv(b.anggaran), LABEL_KELENGKAPAN[b.kelengkapan], b.aktual.catatan ?? '']),
      );
    } else {
      unduhCsv(
        `laba-rugi-per-properti-${periode.kode}.csv`,
        ['Kode', 'Pos', ...KOLOM.map((k) => k.label), 'Konsolidasi', 'Kelengkapan'],
        lr.baris.map((b) => [b.kode, b.label, ...KOLOM.map((k) => nilaiCsv(b.sel[k.id])), nilaiCsv(b.konsolidasi), LABEL_KELENGKAPAN[b.kelengkapan]]),
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print card-pad flex flex-wrap items-center gap-2">
        <PilihPeriode hariIni={m.hariIni} jenis={jenis} kode={periode.kode} onUbah={(j, k) => { setJenis(j); setKode(k); }} />
        <select aria-label="Entitas legal" className="input h-8 w-auto py-1 text-xs" value="pt" disabled>
          <option value="pt">{lr.entitas}</option>
        </select>
        <select aria-label="Properti" className="input h-8 w-auto py-1 text-xs" value={cakupan} onChange={(e) => setCakupan(e.target.value as Cakupan)} disabled={tampilan === 'properti'}>
          <option value="konsolidasi">Consolidated</option>
          {KOLOM.map((k) => (
            <option key={k.id} value={k.id}>{k.label}</option>
          ))}
        </select>
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
          {(['banding', 'properti'] as const).map((t) => (
            <button key={t} onClick={() => setTampilan(t)} className={`px-2.5 py-1 text-[11px] font-semibold ${t === tampilan ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>
              {t === 'banding' ? 'Actual vs Prior vs Budget' : 'By Property'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1.5">
          <button className="btn-ghost btn-xs" onClick={ekspor}><Icon name="unduh" className="h-3.5 w-3.5" /> CSV</button>
          <button className="btn-ghost btn-xs" onClick={() => window.print()}><Icon name="printer" className="h-3.5 w-3.5" /> Cetak</button>
        </div>
      </div>

      <section className="card overflow-hidden">
        <header className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-[15px] font-bold text-slate-900">{lr.entitas}</div>
            <div className="text-[12px] text-slate-600">
              Profit & Loss Statement · {tampilan === 'banding' ? namaCakupan : 'By Property'} · {periode.label}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10.5px] text-slate-500">Net Profit:</span>
            <ChipKelengkapan k={lr.kelengkapan} />
          </div>
          <div className="w-full font-mono text-[10px] text-slate-400">
            Dibuat {dibuat} WIB · Rupiah · data per {new Date(m.dibuatPada).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} · sumber: laporan_villa_bulanan, loonars2_*, snapshot MK Connect, kebijakan owner 2026-11-02
          </div>
        </header>

        <div className="overflow-x-auto">
          {tampilan === 'banding' ? (
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Line item</th>
                  <th className="px-3 py-2 text-right">Actual<div className="font-normal normal-case">{periode.label}</div></th>
                  <th className="px-3 py-2 text-right">Prior<div className="font-normal normal-case">{banding.lalu.periode.label}</div></th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">Budget{!adaAnggaran ? <div className="font-normal normal-case text-rose-500">belum ada anggaran</div> : null}</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {banding.baris.map((b) => (
                  <tr key={b.kode} className={gayaBaris(b.jenis)}>
                    <td className={`px-4 py-1.5 font-sans ${b.jenis === 'pos' ? 'pl-7' : ''}`}>
                      {b.label}
                      {b.jenis === 'pos' && b.aktual.catatan ? <div className="hidden text-[10px] font-normal text-slate-400 print:block">{b.aktual.catatan}</div> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right"><SelAngka s={b.aktual} tebal={b.jenis === 'subtotal'} /></td>
                    <td className="px-3 py-1.5 text-right text-slate-500"><SelAngka s={b.lalu} /></td>
                    <td className="px-3 py-1.5 text-right text-slate-500">
                      {b.selisih === null ? <span className="text-slate-300">—</span> : (
                        <span title={b.selisihPct === null ? '' : `${b.selisihPct.toFixed(1)}%`}>{b.selisih < 0 ? `(${Math.abs(b.selisih).toLocaleString('id-ID')})` : b.selisih.toLocaleString('id-ID')}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">{adaAnggaran ? <SelAngka s={b.anggaran} /> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-1.5 font-sans">{b.jenis !== 'pos' ? <ChipKelengkapan k={b.kelengkapan} kecil /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2">Line item</th>
                  {KOLOM.map((k) => (
                    <th key={k.id} className="px-3 py-2 text-right" title={k.ket}>{k.label}</th>
                  ))}
                  <th className="px-3 py-2 text-right">Consolidated</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {lr.baris.map((b) => (
                  <tr key={b.kode} className={gayaBaris(b.jenis)}>
                    <td className={`px-4 py-1.5 font-sans ${b.jenis === 'pos' ? 'pl-7' : ''}`}>{b.label}</td>
                    {KOLOM.map((k) => (
                      <td key={k.id} className="px-3 py-1.5 text-right"><SelAngka s={b.sel[k.id]} tebal={b.jenis === 'subtotal'} /></td>
                    ))}
                    <td className="px-3 py-1.5 text-right"><SelAngka s={b.konsolidasi} tebal={b.jenis !== 'memo'} /></td>
                    <td className="px-3 py-1.5 font-sans"><ChipKelengkapan k={b.kelengkapan} kecil /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="space-y-2 border-t border-slate-200 px-4 py-3">
          <LegendaStatus />
        </div>
      </section>

      <Panel judul="Catatan & sumber data" ikon="info">
        <ul className="list-disc space-y-1 pl-5 text-[12px] text-slate-600">
          {lr.catatan.map((c) => <li key={c}>{c}</li>)}
          {lr.cakupanL1.tidakAda.length ? <li>Loonars 1: tidak ada laporan villa untuk {lr.cakupanL1.tidakAda.join(', ')}.</li> : null}
        </ul>
        <div className="mt-3">
          <Catatan>
            Pos per kolom beserta catatannya (arahkan kursor ke angka). Rincian kelengkapan data lintas laporan: AI CFO → Data Quality.
            Laporan ini belum menggantikan Laporan Holding (SAK EMKM); laba bersih tahunan keduanya identik.
          </Catatan>
        </div>
      </Panel>
    </div>
  );
}
