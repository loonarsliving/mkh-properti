'use client';

import { Badge, Kosong, Panel } from '@/components/ui/Umum';
import { rupiah } from '@/lib/format';
import type { L2Borongan, L2Rab } from '@/lib/loonars2';

/**
 * Borongan tukang + RAB pemakaian bahan per unit (migrasi 0047). Dipakai bersama
 * oleh dashboard owner dan tampilan pelaksana: hanya membaca.
 */

export interface UnitRingkas {
  id: number;
  nomor: number;
  kode: string;
  sedang_dibangun?: boolean;
}

function angka(n: number | null): string {
  if (n === null) return '';
  const bulat = Math.round(Number(n) * 100) / 100;
  return bulat.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

function Batang({ nilai, total }: { nilai: number; total: number }) {
  const persen = total > 0 ? Math.min(100, Math.round((nilai / total) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={persen} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${persen}%` }} />
    </div>
  );
}

export function PanelUnitDibangun({ unit }: { unit: UnitRingkas[] }) {
  const aktif = unit.filter((u) => u.sedang_dibangun);
  return (
    <Panel judul={`Unit sedang dibangun (${aktif.length})`} ikon="rumah">
      {aktif.length === 0 ? (
        <p className="text-[12px] text-slate-500">Belum ada. Pelaksana menjawabnya lewat WA: &quot;L2 unit 1-6&quot; (sistem menanyakan tiap pengajuan).</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {aktif.map((u) => (
            <span key={u.id} className="chip bg-emerald-100 font-mono text-emerald-800">
              {u.nomor} {u.kode}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10.5px] text-slate-500">Daftar ini menjadi acuan pembagian bahan dan upah ke unit; jawaban pelaksana terakhir yang dipakai.</p>
    </Panel>
  );
}

export function PanelBorongan({ borongan }: { borongan: L2Borongan[] }) {
  return (
    <Panel judul="Borongan tukang" ikon="palu">
      {borongan.length === 0 ? (
        <Kosong pesan='Belum ada borongan. Owner mencatat lewat WA: "L2 borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu".' ikon="palu" />
      ) : (
        <div className="space-y-4">
          {borongan.map((b) => {
            const mingguan = Math.floor(Number(b.total_mingguan) / b.jumlah_minggu);
            return (
              <div key={b.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-800">{b.nama}</span>
                  <Badge nada={b.status === 'aktif' ? 'green' : 'slate'} anak={b.status} />
                  <span className="text-[11px] text-slate-500">
                    {b.jumlah_unit} unit × {rupiah(b.nilai_per_unit)} (retensi {rupiah(b.retensi_per_unit)}/unit)
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-slate-700">
                  Dibayar mingguan {rupiah(b.total_mingguan)} ÷ {b.jumlah_minggu} minggu = <b className="font-mono">{rupiah(mingguan)}</b>/minggu
                </p>
                <div className="mt-2 space-y-1 text-[11.5px] text-slate-700">
                  <div className="flex justify-between">
                    <span>
                      Diajukan {b.minggu_diajukan}/{b.jumlah_minggu} minggu, dibayar {b.minggu_dibayar}
                    </span>
                    <span className="font-mono">{rupiah(b.nominal_diajukan)}</span>
                  </div>
                  <Batang nilai={b.minggu_diajukan} total={b.jumlah_minggu} />
                  <div className="flex justify-between text-slate-500">
                    <span>Sudah dibayar</span>
                    <span className="font-mono">{rupiah(b.nominal_dibayar)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Retensi ditahan</span>
                    <span className="font-mono">{rupiah(Number(b.total_retensi) - Number(b.retensi_diajukan))}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Retensi diajukan / dibayar</span>
                    <span className="font-mono">
                      {rupiah(b.retensi_diajukan)} / {rupiah(b.retensi_dibayar)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[10.5px] text-slate-500">
        Pelaksana cukup mengirim &quot;L2 tukang minggu ini&quot;; nominal dan minggu ke-n dihitung sistem lalu dibagi rata ke unit borongan. Retensi per
        unit diajukan setelah unit ditandai selesai/serah terima.
      </p>
    </Panel>
  );
}

export function PanelRab({ rab, unit }: { rab: L2Rab[]; unit: UnitRingkas[] }) {
  const perUnit = unit
    .map((u) => ({ u, baris: rab.filter((r) => r.unit_id === u.id).sort((a, b) => Number(b.nominal) - Number(a.nominal)) }))
    .filter((x) => x.baris.length > 0);
  const total = rab.reduce((s, r) => s + Number(r.nominal), 0);
  return (
    <Panel judul={`RAB pemakaian bahan per unit — total ${rupiah(total)}`} ikon="kotak" padat>
      {perUnit.length === 0 ? (
        <Kosong pesan='Belum ada pesanan bahan. Pelaksana memesan lewat WA: "L2 bahan TB Maju semen 100 sak, pasir 12 rit 8,5 juta".' ikon="kotak" />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Unit</th>
                <th className="text-right">Total bahan</th>
                <th>Rincian (hasil pembagian pesanan Vando)</th>
              </tr>
            </thead>
            <tbody>
              {perUnit.map(({ u, baris }) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap align-top font-mono">
                    {u.nomor}. {u.kode}
                  </td>
                  <td className="whitespace-nowrap text-right align-top font-mono font-bold">{rupiah(baris.reduce((s, r) => s + Number(r.nominal), 0))}</td>
                  <td className="text-[11.5px]">
                    {baris.map((r) => (
                      <div key={r.item} className="flex justify-between gap-4">
                        <span>
                          {r.item}
                          {r.qty !== null ? ` — ${angka(r.qty)}${r.satuan ? ` ${r.satuan}` : ''}` : ''}
                        </span>
                        <span className="font-mono text-slate-600">{rupiah(r.nominal)}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-2 text-[10.5px] text-slate-500">
        Pesanan dibagi sistem ke unit yang sedang dibangun (bagi rata, atau sesuai catatan &quot;untuk unit ...&quot; Vando). Bila harga per item tidak
        dirinci, pembagian nominal per item berupa perkiraan. Koreksi lewat WA: &quot;L2 koreksi M-7 semen unit 1,2,3&quot;.
      </p>
    </Panel>
  );
}
