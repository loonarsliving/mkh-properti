'use client';

import { useEffect, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Badge, Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, Uang } from '@/components/cfo/Ui';
import { sbQuery } from '@/lib/supabase';

/** 10. Integration & Sync Monitoring — kesegaran data, rekonsiliasi, audit trail. */
interface BarisAudit {
  id: number;
  waktu: string;
  aktor: string;
  kanal: string;
  aksi: string;
  ringkas: Record<string, unknown>;
}

function waktu(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '—';
}

export default function HalamanCfoSinkron() {
  useJudul({ judul: 'Integration & Sync Monitoring', deskripsi: 'Kesegaran setiap sumber data, rekonsiliasi otomatis, dan jejak audit AI CFO', tampilkanFilter: false });
  const [audit, setAudit] = useState<BarisAudit[] | null>(null);
  useEffect(() => {
    sbQuery<BarisAudit>('cfo_audit_log', 'select=id,waktu,aktor,kanal,aksi,ringkas&order=waktu.desc&limit=50')
      .then(setAudit)
      .catch(() => setAudit([]));
  }, []);

  return (
    <DenganModel>
      {(m) => (
        <div className="space-y-4">
          <Panel judul="Sumber data" ikon="transfer" padat>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-[12px]">
                <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Sumber</th><th className="px-3 py-2 text-left">Jalur</th><th className="px-3 py-2 text-left">Terakhir diterima</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Catatan</th></tr></thead>
                <tbody>
                  {m.sinkron.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-semibold">{s.nama}</td>
                      <td className="px-3 py-1.5 text-[11px] text-slate-500">{s.asal}</td>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{waktu(s.terakhir)}</td>
                      <td className="px-3 py-1.5"><Badge nada={s.status === 'segar' ? 'green' : s.status === 'terlambat' ? 'amber' : 'slate'} anak={s.status.replace('_', ' ')} /></td>
                      <td className="px-3 py-1.5 text-[11px] text-slate-500">{s.catatan} (batas {s.batasJam} jam)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2"><Catatan>Data sumber tidak pernah diubah oleh AI CFO. Snapshot eksternal disimpan dengan source ID + hash; baris yang hilang dari sumber ditandai nonaktif, tidak dihapus.</Catatan></div>
          </Panel>

          <Panel judul="Rekonsiliasi otomatis" ikon="ceklis" padat>
            <table className="w-full text-[12px]">
              <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Pemeriksaan</th><th className="px-3 py-2 text-right">Kiri</th><th className="px-3 py-2 text-right">Kanan</th><th className="px-3 py-2 text-right">Selisih</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody>
                {m.rekonsiliasi.map((r) => (
                  <tr key={r.id} className={`border-b border-slate-100 ${r.status === 'selisih' ? 'bg-rose-50' : ''}`}>
                    <td className="px-3 py-1.5">{r.judul}<div className="text-[10.5px] text-slate-500">{r.catatan}</div></td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.kiri.label}<br /><Uang n={r.kiri.nilai} tidakAda="n/a" /></td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.kanan.label}<br /><Uang n={r.kanan.nilai} tidakAda="n/a" /></td>
                    <td className="px-3 py-1.5 text-right font-mono"><Uang n={r.selisih} tidakAda="—" /></td>
                    <td className="px-3 py-1.5"><Badge nada={r.status === 'cocok' ? 'green' : r.status === 'selisih' ? 'red' : 'slate'} anak={r.status.replace(/_/g, ' ')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel judul="Jejak audit AI CFO (50 terakhir)" ikon="buku" padat>
            {audit === null ? <div className="p-4"><Catatan>Memuat…</Catatan></div> : (
              <table className="w-full text-[12px]">
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 font-mono text-[11px]">{waktu(a.waktu)}</td>
                      <td className="px-3 py-1.5">{a.aksi}<div className="text-[10.5px] text-slate-500">{a.kanal} · {a.aktor}</div></td>
                      <td className="px-3 py-1.5 text-[11px] text-slate-600">{typeof a.ringkas.pertanyaan === 'string' ? `“${a.ringkas.pertanyaan}”` : JSON.stringify(a.ringkas).slice(0, 160)}</td>
                    </tr>
                  ))}
                  {!audit.length && <tr><td className="p-4"><Catatan>Belum ada aktivitas tercatat.</Catatan></td></tr>}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </DenganModel>
  );
}
