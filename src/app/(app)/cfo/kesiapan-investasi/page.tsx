'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel } from '@/components/cfo/Ui';
import { ChipKelengkapan } from '@/components/cfo/UiKeuangan';
import type { ModelCfo } from '@/lib/cfo/model';
import { unduhCsv } from '@/lib/ekspor';
import {
  kesiapanInvestasi,
  LABEL_KELOMPOK,
  LABEL_PELAKSANA,
  type KelompokKesiapan,
} from '@/lib/keuangan/kesiapan-investasi';
import { LABEL_KELENGKAPAN } from '@/lib/keuangan/status';

/** Peta jalan kesiapan investasi — apa yang biasa diminta investor, posisi kita, dan langkah berikutnya. */
export default function HalamanKesiapanInvestasi() {
  useJudul({ judul: 'Kesiapan Investasi', deskripsi: 'Yang biasa diminta investor, posisi data kita, dan langkah berikutnya', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

const URUT_KELOMPOK: KelompokKesiapan[] = ['laporan', 'kontrol', 'kinerja', 'rencana', 'struktur', 'kepatuhan'];

function Isi({ m }: { m: ModelCfo }) {
  const { data } = useCfo();
  const r = useMemo(() => (data ? kesiapanInvestasi(m, data) : null), [m, data]);
  const [buka, setBuka] = useState<string | null>(null);
  if (!r) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-600">
        Daftar ini dihitung ulang dari data setiap kali dibuka dan diringkas di laporan mingguan WhatsApp, sehingga kemajuan terlihat begitu data dilengkapi.
        Sengaja <b>tidak ada skor &quot;siap investasi&quot;</b>: keputusan menawarkan investasi tetap di tangan owner setelah butir yang kurang ditangani.
      </div>

      <div className="grid grid-cols-3 gap-3">
        {(['lengkap', 'perlu_verifikasi', 'tidak_lengkap'] as const).map((k) => (
          <div key={k} className="card-pad">
            <ChipKelengkapan k={k} kecil />
            <div className="mt-1 text-2xl font-semibold text-slate-800">{r.jumlah[k]}</div>
            <div className="text-[10.5px] text-slate-400">dari {r.butir.length} butir</div>
          </div>
        ))}
      </div>

      <Panel judul="Langkah berikutnya" ikon="ceklis">
        {r.langkahBerikutnya.length === 0 ? (
          <p className="text-[12px] text-slate-600">Tidak ada langkah yang menunggu.</p>
        ) : (
          <ol className="space-y-2">
            {r.langkahBerikutnya.map((b, i) => (
              <li key={b.id} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-700">
                <span className="font-mono text-slate-400">{i + 1}.</span>
                <span>
                  {b.langkah}
                  <span className="ml-2 chip bg-slate-100 text-slate-600">{LABEL_PELAKSANA[b.pelaksana]}</span>
                  {b.tahap ? <span className="ml-1 font-mono text-[10px] text-slate-400">tahap {b.tahap}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {r.siapDibagikan.length ? (
        <Panel judul="Sudah bisa ditunjukkan ke calon investor" ikon="dokumen">
          <ul className="flex flex-wrap gap-2">
            {r.siapDibagikan.map((b) => (
              <li key={b.id}>
                <Link href={b.bukti!.href} className="chip bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                  {b.bukti!.label} <span className="text-emerald-500">· {LABEL_KELENGKAPAN[b.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">Bagian berstatus Needs Verification sebaiknya disertai catatan keterbatasannya saat dibagikan.</p>
        </Panel>
      ) : null}

      <Panel
        judul="Daftar yang biasa diminta investor"
        ikon="peringatan"
        padat
        aksi={
          <button
            className="no-print btn-ghost btn-xs"
            onClick={() =>
              unduhCsv(
                `kesiapan-investasi-${m.hariIni}.csv`,
                ['Kelompok', 'Diminta investor', 'Status', 'Posisi sekarang', 'Langkah berikutnya', 'Pelaksana', 'Tahap'],
                r.butir.map((b) => [LABEL_KELOMPOK[b.kelompok], b.diminta, LABEL_KELENGKAPAN[b.status], b.posisi, b.langkah, LABEL_PELAKSANA[b.pelaksana], b.tahap ?? '']),
              )
            }
          >
            <Icon name="unduh" className="h-3.5 w-3.5" /> CSV
          </button>
        }
      >
        {URUT_KELOMPOK.map((k) => {
          const isi = r.butir.filter((b) => b.kelompok === k);
          if (!isi.length) return null;
          return (
            <div key={k}>
              <div className="bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{LABEL_KELOMPOK[k]}</div>
              <ul className="divide-y divide-slate-100">
                {isi.map((b) => (
                  <li key={b.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ChipKelengkapan k={b.status} kecil />
                      <span className="text-[12.5px] font-semibold text-slate-800">{b.diminta}</span>
                      {b.diLuarSistem ? <span className="chip bg-slate-100 text-slate-500">di luar data sistem</span> : null}
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{b.posisi}</p>
                    {b.langkah !== '—' ? (
                      <p className="mt-0.5 text-[11.5px] text-slate-500">
                        <b>Langkah:</b> {b.langkah} <span className="text-slate-400">({LABEL_PELAKSANA[b.pelaksana]}{b.tahap ? `, tahap ${b.tahap}` : ''})</span>
                      </p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                      {b.bukti ? <Link href={b.bukti.href} className="text-sky-700 hover:underline">Lihat: {b.bukti.label}</Link> : null}
                      {b.cek.length ? (
                        <button className="text-slate-500 hover:underline" onClick={() => setBuka(buka === b.id ? null : b.id)}>
                          {buka === b.id ? 'Sembunyikan' : 'Lihat'} {b.cek.length} pemeriksaan data
                        </button>
                      ) : null}
                    </div>
                    {buka === b.id ? (
                      <ul className="mt-2 space-y-1 rounded-md bg-slate-50 p-2">
                        {b.cek.map((c) => (
                          <li key={c.id} className="text-[11.5px] text-slate-600">
                            <ChipKelengkapan k={c.status} kecil /> <b>{c.judul}</b> — {c.isi}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </Panel>

      <Catatan>
        Status diturunkan dari pemeriksaan Data Quality (lihat halaman Data Quality & Completeness). Tahap merujuk rencana di
        docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md §6. Butir legal & pajak tidak dicatat di sistem dan tidak dinilai dari data.
      </Catatan>
    </div>
  );
}
