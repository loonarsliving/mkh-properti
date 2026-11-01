'use client';

import { useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { InputRupiah } from '@/components/ui/Form';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, KartuPeringatan, Uang } from '@/components/cfo/Ui';
import type { ModelCfo } from '@/lib/cfo/model';
import { evaluasiKeputusan, type HasilEvaluasi } from '@/lib/cfo/penantang';
import type { Tingkat } from '@/lib/cfo/tipe';
import { labelTanggal } from '@/lib/cfo/util';

/** 7. Financial Alerts + CEO Challenger. */
export default function HalamanCfoPeringatan() {
  useJudul({ judul: 'Financial Alerts & CEO Challenger', deskripsi: 'Peringatan risiko berbasis aturan + uji keputusan pengeluaran terhadap forecast kas', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

function Isi({ m }: { m: ModelCfo }) {
  const [filter, setFilter] = useState<Tingkat | 'semua'>('semua');
  const [nominal, setNominal] = useState(0);
  const [lini, setLini] = useState<'L1' | 'L2' | 'Grup'>('Grup');
  const [ket, setKet] = useState('');
  const [tanggal, setTanggal] = useState(m.hariIni);
  const [cicilan, setCicilan] = useState(1);
  const [hasil, setHasil] = useState<HasilEvaluasi | null>(null);

  const daftar = m.peringatan.filter((p) => filter === 'semua' || p.tingkat === filter);
  const n = nominal;

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="space-y-2 xl:col-span-3">
        <div className="flex flex-wrap gap-1.5">
          {(['semua', 'kritis', 'tinggi', 'sedang', 'info'] as const).map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`rounded-full border px-3 py-1 text-[11.5px] ${filter === t ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`}>
              {t} ({t === 'semua' ? m.peringatan.length : m.peringatan.filter((p) => p.tingkat === t).length})
            </button>
          ))}
        </div>
        {daftar.map((p) => <KartuPeringatan key={p.id} p={p} />)}
        {!daftar.length && <Catatan>Tidak ada peringatan pada tingkat ini.</Catatan>}
      </div>

      <div className="xl:col-span-2">
        <Panel judul="CEO Challenger — uji keputusan" ikon="peringatan">
          <Catatan>Masukkan rencana pengeluaran/keputusan. AI CFO menguji dampaknya ke kas di 3 skenario, lalu menyatakan AMAN / WASPADA / TIDAK MENYARANKAN beserta alternatif yang dihitung. Tidak ada uang yang dipindahkan.</Catatan>
          <div className="mt-3 space-y-2">
            <label className="block text-[12px]">Keputusan<input className="input mt-1 w-full" placeholder="mis. beli mobil operasional, bangun unit LUNARA-01" value={ket} onChange={(e) => setKet(e.target.value)} /></label>
            <label className="block text-[12px]">Nominal (Rp)<InputRupiah id="cfo-nominal" nilai={nominal} onUbah={setNominal} /></label>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[12px]">Lini<select className="input mt-1 w-full" value={lini} onChange={(e) => setLini(e.target.value as typeof lini)}><option value="L1">Loonars 1</option><option value="L2">Loonars 2</option><option value="Grup">Grup</option></select></label>
              <label className="text-[12px]">Tanggal<input type="date" className="input mt-1 w-full" value={tanggal} min={m.hariIni} onChange={(e) => setTanggal(e.target.value)} /></label>
              <label className="text-[12px]">Cicilan (bln)<input type="number" min={1} max={24} className="input mt-1 w-full" value={cicilan} onChange={(e) => setCicilan(Math.max(1, Math.min(24, Number(e.target.value) || 1)))} /></label>
            </div>
            <button className="btn-amber w-full" disabled={n <= 0 || !ket.trim()} onClick={() => setHasil(evaluasiKeputusan(m, { nominal: n, lini, ket: ket.trim(), tanggal, cicilan }))}>Uji keputusan</button>
          </div>
          {hasil && (
            <div className={`mt-4 rounded-lg border p-3 ${hasil.putusan === 'tolak' ? 'border-rose-300 bg-rose-50' : hasil.putusan === 'waspada' ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
              <div className="text-[13px] font-bold">{hasil.ringkas}</div>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px]">{hasil.alasan.map((a) => <li key={a}>{a}</li>)}</ul>
              <table className="mt-2 w-full text-[11.5px]">
                <thead className="text-[10px] uppercase text-slate-500"><tr><th className="text-left">Skenario</th><th className="text-right">Kas terendah sebelum</th><th className="text-right">Sesudah</th><th className="text-left pl-2">Defisit</th></tr></thead>
                <tbody>
                  {hasil.dampak.map((d) => (
                    <tr key={d.skenario}><td>{d.skenario}</td><td className="text-right font-mono"><Uang n={d.saldoMinSebelum} ringkas /></td><td className="text-right font-mono"><Uang n={d.saldoMinSesudah} ringkas /></td><td className="pl-2">{d.tanggalDefisitSesudah ? labelTanggal(d.tanggalDefisitSesudah) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              {hasil.alternatif.length > 0 && (
                <>
                  <div className="mt-2 text-[12px] font-semibold">Alternatif lebih aman:</div>
                  <ul className="list-disc space-y-1 pl-4 text-[12px]">{hasil.alternatif.map((a) => <li key={a}>{a}</li>)}</ul>
                </>
              )}
              <Catatan>Keputusan akhir tetap di tangan owner.</Catatan>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
