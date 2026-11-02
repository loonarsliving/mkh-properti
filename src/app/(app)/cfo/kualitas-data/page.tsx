'use client';

import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DaftarSumber, DenganModel } from '@/components/cfo/Ui';
import { ChipKelengkapan } from '@/components/cfo/UiKeuangan';
import type { ModelCfo } from '@/lib/cfo/model';
import { rp } from '@/lib/cfo/util';
import { unduhCsv } from '@/lib/ekspor';
import { cekKualitasData, LABEL_AREA, type AreaLaporan } from '@/lib/keuangan/kualitas-data';
import { LABEL_KELENGKAPAN, type Kelengkapan } from '@/lib/keuangan/status';

/** Financial Reporting Completeness & Data Quality Warnings. */
export default function HalamanKualitasData() {
  useJudul({ judul: 'Data Quality & Reporting Completeness', deskripsi: 'Complete / Incomplete / Needs Verification per area laporan', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

function Isi({ m }: { m: ModelCfo }) {
  const { data } = useCfo();
  const r = useMemo(() => (data ? cekKualitasData(m, data) : null), [m, data]);
  const [area, setArea] = useState<AreaLaporan | 'semua'>('semua');
  const [status, setStatus] = useState<Kelengkapan | 'semua'>('semua');
  if (!r) return null;
  const tampil = r.cek.filter((c) => (area === 'semua' || c.area === area) && (status === 'semua' || c.status === status));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
        Indikator ini menunjukkan bagian laporan yang sudah dan belum bisa dipertanggungjawabkan. Sengaja <b>tidak ada skor &quot;siap investasi&quot;</b>:
        kesiapan untuk investor/PE diputuskan manusia setelah setiap butir Incomplete dan Needs Verification ditangani.
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {r.perArea.map((a) => (
          <button
            key={a.area}
            onClick={() => setArea(area === a.area ? 'semua' : a.area)}
            className={`card-pad text-left transition ${area === a.area ? 'ring-2 ring-slate-800' : ''}`}
          >
            <div className="text-[11.5px] font-semibold text-slate-700">{LABEL_AREA[a.area]}</div>
            <div className="mt-1"><ChipKelengkapan k={a.status} kecil /></div>
            <div className="mt-1 font-mono text-[10px] text-slate-400">
              {a.lengkap} ok · {a.verifikasi} verif · {a.tidakLengkap} kurang
            </div>
          </button>
        ))}
      </div>

      <Panel
        judul={`Daftar pemeriksaan (${tampil.length})`}
        ikon="peringatan"
        aksi={
          <div className="no-print flex items-center gap-1.5">
            <select aria-label="Status" className="input h-7 w-auto py-0.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value as Kelengkapan | 'semua')}>
              <option value="semua">Semua status</option>
              {(Object.keys(LABEL_KELENGKAPAN) as Kelengkapan[]).map((k) => (
                <option key={k} value={k}>{LABEL_KELENGKAPAN[k]} ({r.jumlah[k]})</option>
              ))}
            </select>
            <button
              className="btn-ghost btn-xs"
              onClick={() =>
                unduhCsv(
                  `kualitas-data-${m.hariIni}.csv`,
                  ['Area', 'Status', 'Pemeriksaan', 'Temuan', 'Tindakan', 'Nilai', 'Rujukan'],
                  r.cek.map((c) => [LABEL_AREA[c.area], LABEL_KELENGKAPAN[c.status], c.judul, c.isi, c.tindakan, c.nilai ?? '', c.rujukan ?? '']),
                )
              }
            >
              <Icon name="unduh" className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        }
        padat
      >
        <ul className="divide-y divide-slate-100">
          {tampil.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <ChipKelengkapan k={c.status} kecil />
                <span className="chip bg-slate-100 text-slate-600">{LABEL_AREA[c.area]}</span>
                <span className="text-[12.5px] font-semibold text-slate-800">{c.judul}</span>
                {c.rujukan ? <span className="font-mono text-[10px] text-slate-400">{c.rujukan}</span> : null}
                {c.nilai !== undefined ? <span className="ml-auto font-mono text-[12px] text-slate-700">{rp(c.nilai)}</span> : null}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{c.isi}</p>
              {c.tindakan !== '—' ? <p className="mt-0.5 text-[11.5px] text-slate-500"><b>Tindakan:</b> {c.tindakan}</p> : null}
              {c.sumber.length ? <div className="mt-0.5"><DaftarSumber sumber={c.sumber} /></div> : null}
            </li>
          ))}
        </ul>
      </Panel>
      <Catatan>
        Temuan F-n dan keputusan D-n merujuk ke docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md. Pemeriksaan debit = kredit, akun COA,
        rekonsiliasi lintas sumber, laporan sementara, dan sinkronisasi dihitung ulang dari data setiap kali halaman dimuat.
      </Catatan>
    </div>
  );
}
