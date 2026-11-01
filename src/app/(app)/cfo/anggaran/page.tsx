'use client';

import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, Kpi, TabelAngka, Uang } from '@/components/cfo/Ui';
import { labelBulan, labelTanggal, persen } from '@/lib/cfo/util';

/** 6. Budget & Expense Control — budget vs actual, beban operasional, transaksi abnormal. */
export default function HalamanCfoAnggaran() {
  useJudul({ judul: 'Budget & Expense Control', deskripsi: 'Budget vs actual konstruksi per unit, beban operasional villa, pengajuan menunggu, transaksi abnormal', tampilkanFilter: false });
  return (
    <DenganModel>
      {(m) => {
        const l2 = m.l2;
        const aktif = l2.unit.filter((u) => u.aktual > 0 || u.statusBangun !== 'belum' || u.sedangDibangun);
        const realisasi = l2.budgetUnitAktif > 0 ? (l2.aktualUnitAktif / l2.budgetUnitAktif) * 100 : null;
        const opex = m.l1.terakhirFinal ?? m.l1.terakhir;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Budget unit yang dibangun" nilai={l2.budgetUnitAktif} ikon="dokumen" nada="blue" catatan={`${aktif.length} unit`} />
              <Kpi label="Aktual unit yang dibangun" nilai={l2.aktualUnitAktif} ikon="palu" nada="slate" catatan={realisasi === null ? undefined : `realisasi ${persen(realisasi)}`} />
              <Kpi label="Pengajuan menunggu (L2)" nilai={l2.pengajuanMenunggu} ikon="kalender" nada="amber" />
              <Kpi label="Cicilan toko menunggu" nilai={l2.cicilanMenunggu} ikon="kas-keluar" nada="violet" />
            </div>
            <Panel judul="Budget vs actual konstruksi per unit" ikon="grafik">
              <div className="space-y-2">
                {aktif.map((u) => {
                  const pct = u.budget > 0 ? (u.aktual / u.budget) * 100 : 0;
                  const batas = u.budget > 0 ? (u.budgetDenganBuffer / u.budget) * 100 : 100;
                  return (
                    <div key={u.id} className="text-[12px]">
                      <div className="flex justify-between"><span className="font-semibold">{u.kode} {u.pembeli ? '' : <span className="font-normal text-amber-700">· belum ada pembeli</span>}</span><span className="font-mono"><Uang n={u.aktual} ringkas /> / <Uang n={u.budget} ringkas /> ({persen(pct, 0)})</span></div>
                      <div className="relative mt-1 h-2 rounded bg-slate-100">
                        <div className={`h-2 rounded ${pct > batas ? 'bg-rose-500' : pct > 100 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, (pct / Math.max(batas, 100)) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
                {!aktif.length && <Catatan>Belum ada unit yang dibangun.</Catatan>}
              </div>
              <Catatan>Biru ≤ budget; kuning melewati budget tetapi masih dalam buffer; merah melewati budget + buffer. Biaya konstruksi tanpa unit tidak termasuk.</Catatan>
            </Panel>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel judul={`Beban operasional villa${opex ? ` — ${labelBulan(opex.bulan)}` : ''}`} ikon="kas-keluar">
                {opex ? (
                  <TabelAngka
                    baris={[
                      { label: 'Komisi OTA', nilai: opex.komisiOta },
                      { label: 'COGS standar (listrik kamar, laundry, amenities, biaya tetap)', nilai: opex.cogs },
                      { label: 'Payroll staf', nilai: opex.payroll },
                      { label: 'OPEX lain', nilai: opex.opexLain },
                      { label: 'Total biaya', nilai: opex.komisiOta + opex.cogs + opex.opex, tebal: true },
                      { label: 'Rasio biaya terhadap revenue', nilai: null, catatan: opex.revenue > 0 ? persen(((opex.komisiOta + opex.cogs + opex.opex) / opex.revenue) * 100) : '-' },
                    ]}
                  />
                ) : <Catatan>Belum ada laporan villa.</Catatan>}
              </Panel>
              <Panel judul={`Transaksi perlu diperiksa (${m.abnormal.length})`} ikon="peringatan" padat>
                <table className="w-full text-[12px]">
                  <tbody>
                    {m.abnormal.slice(0, 20).map((a) => (
                      <tr key={a.id} className="border-b border-slate-100">
                        <td className="px-3 py-1.5 font-mono text-[11px]">{labelTanggal(a.tanggal)}</td>
                        <td className="px-3 py-1.5">{a.alasan}<div className="font-mono text-[10px] text-slate-400">{a.sumber}</div></td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={a.nominal} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!m.abnormal.length && <div className="p-4"><Catatan>Tidak ada transaksi abnormal terdeteksi (aturan: nominal &gt; 4× median kategori, atau transaksi kembar).</Catatan></div>}
              </Panel>
            </div>
          </div>
        );
      }}
    </DenganModel>
  );
}
