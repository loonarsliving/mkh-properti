'use client';

import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, Kpi, Uang } from '@/components/cfo/Ui';
import { BOBOT_RISIKO, type JenisKewajiban } from '@/lib/cfo/kewajiban';
import type { ModelCfo } from '@/lib/cfo/model';
import { simulasiRestrukturisasi } from '@/lib/cfo/penantang';
import { labelTanggal } from '@/lib/cfo/util';

/** 5. Debt & Liability Center — jatuh tempo, prioritas bayar, simulasi restrukturisasi. */
export default function HalamanCfoKewajiban() {
  useJudul({ judul: 'Debt & Liability Center', deskripsi: 'Utang, refund, investor, supplier — jatuh tempo, prioritas bayar, simulasi restrukturisasi', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

const LABEL_STATUS = { lewat: 'Lewat', minggu_ini: '≤7 hari', bulan_ini: '≤30 hari', nanti: '>30 hari', tanpa_tanggal: '—' } as const;

function Isi({ m }: { m: ModelCfo }) {
  const [lini, setLini] = useState<'semua' | 'L1' | 'L2' | 'Grup'>('semua');
  const jenisAda = useMemo(() => [...new Set(m.kewajiban.map((k) => k.jenis))], [m]);
  const [pilih, setPilih] = useState<JenisKewajiban[]>(['utang_supplier']);
  const [hari, setHari] = useState(28);
  const sim = useMemo(() => simulasiRestrukturisasi(m, pilih, hari), [m, pilih, hari]);
  const r = m.ringkasKewajiban;
  const daftar = m.kewajiban.filter((k) => lini === 'semua' || k.lini === lini);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total kewajiban" nilai={r.total} ikon="kas-keluar" nada="rose" catatan={`L1 ${r.L1.toLocaleString('id-ID')} · L2 ${r.L2.toLocaleString('id-ID')} · grup ${r.Grup.toLocaleString('id-ID')}`} />
        <Kpi label="Lewat jatuh tempo" nilai={r.lewatJatuhTempo} ikon="peringatan" nada={r.lewatJatuhTempo > 0 ? 'rose' : 'emerald'} />
        <Kpi label="Jatuh tempo ≤7 hari" nilai={r.jatuhTempo7Hari} ikon="kalender" nada="amber" />
        <Kpi label="Jatuh tempo ≤30 hari" nilai={r.jatuhTempo30Hari} ikon="kalender" nada="violet" catatan={`Kas tercatat ${m.kasTotal.toLocaleString('id-ID')}`} />
      </div>

      <Panel
        judul="Daftar kewajiban — urutan bayar yang disarankan"
        ikon="ceklis"
        padat
        aksi={
          <select className="input py-0.5 text-[11px]" value={lini} onChange={(e) => setLini(e.target.value as typeof lini)}>
            <option value="semua">Semua lini</option><option value="L1">Loonars 1</option><option value="L2">Loonars 2</option><option value="Grup">Grup MKH lain</option>
          </select>
        }
      >
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[860px] text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-[10.5px] uppercase text-slate-500">
              <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Pihak / dasar</th><th className="px-3 py-2 text-left">Lini · jenis</th><th className="px-3 py-2 text-left">Jatuh tempo</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-right">Kumulatif</th><th className="px-3 py-2 text-left">Kas</th></tr>
            </thead>
            <tbody>
              {daftar.map((k) => (
                <tr key={k.id} className={`border-b border-slate-100 ${k.status === 'lewat' ? 'bg-rose-50' : ''}`}>
                  <td className="px-3 py-1.5 font-mono text-slate-400">{k.urutan}</td>
                  <td className="px-3 py-1.5"><div className="font-semibold">{k.pihak}</div><div className="text-[10.5px] text-slate-500">{k.dasar} · {k.alasanPrioritas}</div><div className="font-mono text-[10px] text-slate-400">{k.sumber.tabel}{k.sumber.ket ? ` (${k.sumber.ket})` : ''}</div></td>
                  <td className="px-3 py-1.5">{k.lini}<div className="text-[10.5px] text-slate-500">{k.jenis} (risiko {BOBOT_RISIKO[k.jenis].bobot})</div></td>
                  <td className="px-3 py-1.5">{k.jatuhTempo ? labelTanggal(k.jatuhTempo) : '—'}{k.jatuhTempoAsumsi && <span className="text-[10px] text-slate-400"> (asumsi)</span>}<div className="text-[10.5px] text-slate-500">{LABEL_STATUS[k.status]}</div></td>
                  <td className="px-3 py-1.5 text-right font-mono"><Uang n={k.nominal} /></td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500"><Uang n={k.kumulatif} /></td>
                  <td className="px-3 py-1.5 text-[11px]">{k.tertutupKas ? '✓ cukup' : <span className="text-rose-600">kurang</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2"><Catatan>Skor prioritas = bobot risiko × 20 + urgensi jatuh tempo. &ldquo;Kas cukup&rdquo; = kumulatif ≤ kas tercatat (urutan menurut prioritas, bukan semua urutan bayar). AI CFO hanya menyarankan; pembayaran tetap dilakukan manusia.</Catatan></div>
      </Panel>

      <Panel judul="Simulasi restrukturisasi (tunda pembayaran)" ikon="transfer">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            {jenisAda.filter((j) => j !== 'utang_owner').map((j) => (
              <label key={j} className="inline-flex items-center gap-1 text-[12px]">
                <input type="checkbox" checked={pilih.includes(j)} onChange={(e) => setPilih(e.target.checked ? [...pilih, j] : pilih.filter((x) => x !== j))} /> {j}
              </label>
            ))}
          </div>
          <label className="text-[12px]">Tunda <input type="number" min={7} max={120} step={7} className="input w-20 py-0.5" value={hari} onChange={(e) => setHari(Math.max(0, Math.min(180, Number(e.target.value) || 0)))} /> hari</label>
        </div>
        <table className="mt-3 w-full text-[12px]">
          <thead className="text-[10.5px] uppercase text-slate-500"><tr><th className="py-1 text-left">Skenario</th><th className="py-1 text-right">Saldo terendah sebelum</th><th className="py-1 text-right">Sesudah</th><th className="py-1 text-left">Defisit sebelum → sesudah</th></tr></thead>
          <tbody>
            {sim.map((s) => (
              <tr key={s.skenario} className="border-t border-slate-100">
                <td className="py-1.5">{s.skenario}</td>
                <td className="py-1.5 text-right font-mono"><Uang n={s.saldoMinSebelum} /></td>
                <td className="py-1.5 text-right font-mono"><Uang n={s.saldoMinSesudah} /></td>
                <td className="py-1.5">{s.tanggalDefisitSebelum ? labelTanggal(s.tanggalDefisitSebelum) : 'tidak ada'} → {s.tanggalDefisitSesudah ? labelTanggal(s.tanggalDefisitSesudah) : 'tidak ada'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Catatan>Hanya simulasi angka. Penundaan nyata perlu kesepakatan tertulis dengan pihak terkait; kewajiban tidak dihapus tanpa bukti.</Catatan>
      </Panel>
      {m.kewajibanDiLuarLingkup.daftar.length > 0 && (
        <Panel judul="Arsip — kewajiban proyek yang dikunci (di luar laporan)" ikon="kunci">
          <ul className="space-y-1 text-[12px]">
            {m.kewajibanDiLuarLingkup.daftar.map((k) => (
              <li key={k.id} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                <span>{k.pihak}<span className="text-[10.5px] text-slate-500"> · {k.jenis}{k.jatuhTempo ? ` · jatuh tempo ${labelTanggal(k.jatuhTempo)}` : ''}</span></span>
                <span className="font-mono"><Uang n={k.nominal} /></span>
              </li>
            ))}
          </ul>
          <Catatan>Sejak {labelTanggal(m.kewajibanDiLuarLingkup.sejak)} hanya Loonars 1 &amp; Loonars 2 yang dilaporkan. Kewajiban ini tidak masuk total, urutan bayar, maupun forecast — tetapi secara hukum tetap ada dan tidak dihapus.</Catatan>
        </Panel>
      )}
    </div>
  );
}
