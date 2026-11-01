'use client';

import type { HasilSkenario } from '@/lib/cfo/arus-kas';
import type { Peringatan, Sumber, Tingkat } from '@/lib/cfo/tipe';
import { labelTanggal, rp, rpRingkas } from '@/lib/cfo/util';
import { Icon, type NamaIkon } from '@/components/ui/Icon';
import { Memuat, PesanGalat } from '@/components/ui/Umum';
import { useCfo } from './CfoProvider';
import type { ModelCfo } from '@/lib/cfo/model';

/** Pembungkus halaman: tangani memuat/galat, lalu render isi dengan model siap. */
export function DenganModel({ children }: { children: (m: ModelCfo) => React.ReactNode }) {
  const { model, galat, memuat, muatUlang } = useCfo();
  if (galat) return <PesanGalat pesan={`Gagal memuat data AI CFO: ${galat}`} onCoba={muatUlang} />;
  if (memuat || !model) return <Memuat pesan="Menghitung kondisi keuangan…" />;
  return <>{children(model)}</>;
}

export function Uang({ n, ringkas = false, tidakAda = 'tidak tersedia' }: { n: number | null | undefined; ringkas?: boolean; tidakAda?: string }) {
  if (n === null || n === undefined) return <span className="italic text-slate-400">{tidakAda}</span>;
  return <span className={n < 0 ? 'text-rose-600' : undefined} title={rp(n)}>{ringkas ? rpRingkas(n) : rp(n)}</span>;
}

export function Kpi({ label, nilai, catatan, ikon, nada = 'slate', ringkas = true }: {
  label: string; nilai: number | null; catatan?: string; ikon: NamaIkon; nada?: 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' | 'slate'; ringkas?: boolean;
}) {
  const warna = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', blue: 'bg-blue-600', violet: 'bg-violet-500', slate: 'bg-slate-500' }[nada];
  return (
    <div className="card-pad flex items-start gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${warna}`}>
        <Icon name={ikon} className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-slate-500">{label}</div>
        <div className="truncate text-[17px] font-bold text-slate-800"><Uang n={nilai} ringkas={ringkas} /></div>
        {catatan ? <div className="text-[10.5px] leading-snug text-slate-500">{catatan}</div> : null}
      </div>
    </div>
  );
}

const WARNA_TINGKAT: Record<Tingkat, string> = {
  kritis: 'border-rose-300 bg-rose-50 text-rose-800',
  tinggi: 'border-amber-300 bg-amber-50 text-amber-900',
  sedang: 'border-yellow-200 bg-yellow-50 text-yellow-900',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function ChipTingkat({ t }: { t: Tingkat }) {
  return <span className={`chip border ${WARNA_TINGKAT[t]} uppercase`}>{t}</span>;
}

export function DaftarSumber({ sumber }: { sumber: Sumber[] }) {
  return (
    <span className="font-mono text-[10px] text-slate-400">
      sumber: {sumber.map((s) => (s.ket ? `${s.tabel} (${s.ket})` : s.tabel)).join(' · ')}
    </span>
  );
}

export function KartuPeringatan({ p }: { p: Peringatan }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${WARNA_TINGKAT[p.tingkat]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ChipTingkat t={p.tingkat} />
        <span className="chip bg-white/70 text-slate-600">{p.lini}</span>
        <span className="text-[12.5px] font-semibold">{p.judul}</span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed">{p.isi}</p>
      <div className="mt-1"><DaftarSumber sumber={p.sumber} /></div>
    </div>
  );
}

/** Grafik garis saldo (SVG murni, tanpa pustaka) untuk beberapa skenario. */
export function GrafikSaldo({ skenario, kasMinimum, hari = 91 }: { skenario: HasilSkenario[]; kasMinimum: number; hari?: number }) {
  const W = 720;
  const H = 220;
  const P = { l: 64, r: 12, t: 12, b: 28 };
  const seri = skenario.map((s) => s.harian.slice(0, hari));
  const semua = seri.flat().map((h) => h.saldo).concat([kasMinimum, 0]);
  const min = Math.min(...semua);
  const max = Math.max(...semua);
  const rentang = max - min || 1;
  const x = (i: number) => P.l + (i / Math.max(1, hari - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - min) / rentang) * (H - P.t - P.b);
  const warna: Record<string, string> = { optimis: '#059669', normal: '#2563eb', pesimis: '#e11d48' };
  const tick = [max, (max + min) / 2, min];
  return (
    <figure className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Proyeksi saldo kas">
        {tick.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#64748b">{rpRingkas(t).replace('Rp ', '')}</text>
          </g>
        ))}
        <line x1={P.l} x2={W - P.r} y1={y(0)} y2={y(0)} stroke="#0f172a" strokeWidth="1" />
        <line x1={P.l} x2={W - P.r} y1={y(kasMinimum)} y2={y(kasMinimum)} stroke="#f59e0b" strokeDasharray="4 3" />
        <text x={W - P.r} y={y(kasMinimum) - 4} textAnchor="end" fontSize="10" fill="#b45309">kas minimum</text>
        {seri.map((s, k) => (
          <polyline
            key={skenario[k].nama}
            fill="none"
            stroke={warna[skenario[k].nama]}
            strokeWidth={skenario[k].nama === 'normal' ? 2.4 : 1.6}
            points={s.map((h, i) => `${x(i).toFixed(1)},${y(h.saldo).toFixed(1)}`).join(' ')}
          />
        ))}
        {[0, Math.floor(hari / 2), hari - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">
            {seri[0]?.[i] ? labelTanggal(seri[0][i].tanggal) : ''}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
        {skenario.map((s) => (
          <span key={s.nama} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded" style={{ background: warna[s.nama] }} /> {s.nama}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Tabel sederhana: baris label → nilai rupiah. */
export function TabelAngka({ baris }: { baris: { label: string; nilai: number | null; tebal?: boolean; indent?: boolean; catatan?: string }[] }) {
  return (
    <table className="w-full text-[12.5px]">
      <tbody>
        {baris.map((b) => (
          <tr key={b.label} className={`border-b border-slate-100 ${b.tebal ? 'font-bold' : ''}`}>
            <td className={`py-1.5 ${b.indent ? 'pl-4 text-slate-600' : ''}`}>
              {b.label}
              {b.catatan ? <div className="text-[10.5px] font-normal text-slate-400">{b.catatan}</div> : null}
            </td>
            <td className="py-1.5 text-right font-mono"><Uang n={b.nilai} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Catatan({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-slate-500">{children}</p>;
}
