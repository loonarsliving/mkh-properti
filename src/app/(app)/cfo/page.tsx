'use client';

import Link from 'next/link';
import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { DenganModel, GrafikSaldo, KartuPeringatan, Kpi, Uang } from '@/components/cfo/Ui';
import { labelTanggal, rp } from '@/lib/cfo/util';

/** 1. Owner Financial Overview — konsolidasi Loonars 1 + Loonars 2. */
export default function HalamanCfoOverview() {
  useJudul({ judul: 'AI CFO — Owner Financial Overview', deskripsi: 'Konsolidasi Loonars 1 (hospitality) dan Loonars 2 (developer & konstruksi)', tampilkanFilter: false });
  return (
    <DenganModel>
      {(m) => {
        const k = m.konsolidasi;
        const n = m.arusKas.skenario.normal;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Total posisi kas" nilai={k.kasTotal} ikon="dompet" nada="blue" catatan="Rekening L2 + buku besar LL. Kas villa belum tersambung." />
              <Kpi label="Total kewajiban" nilai={k.kewajibanTotal} ikon="kas-keluar" nada="rose" catatan={`Loonars ${rp(k.kewajibanLoonars)} · grup MKH lain ${rp(k.kewajibanTotal - k.kewajibanLoonars)}`} />
              <Kpi label="Total piutang" nilai={k.piutangTotal} ikon="kas-masuk" nada="emerald" catatan="Sisa tagihan investor L2 + settlement OTA L1" />
              <Kpi label="Kebutuhan dana (normal)" nilai={k.kebutuhanDana.normal} ikon="peringatan" nada={k.kebutuhanDana.normal > 0 ? 'rose' : 'emerald'} catatan={`Optimis ${rp(k.kebutuhanDana.optimis)} · pesimis ${rp(k.kebutuhanDana.pesimis)}`} />
              <Kpi label="Pendapatan operasional bulan ini" nilai={k.pendapatanOperasionalBulanIni} ikon="grafik" nada="violet" catatan={`Loonars 1 saja (YTD ${rp(k.pendapatanOperasionalYtd)}). Hospitality L2 belum beroperasi.`} />
              <Kpi label="Cash-in investor (L2)" nilai={k.cashInInvestor} ikon="orang-grup" nada="emerald" catatan="Bukan pendapatan — uang muka sampai serah terima" />
              <Kpi label="Beban operasional bulan ini" nilai={k.bebanOperasionalBulanIni} ikon="kas-keluar" nada="amber" catatan="COGS + OPEX villa" />
              <Kpi label="Belanja konstruksi L2" nilai={k.belanjaKonstruksiTotal} ikon="palu" nada="slate" catatan={`Villa Loonars 2${m.l2.proyek.length ? ` + ${m.l2.proyek.map((x) => x.nama).join(', ')}` : ''} · bulan ini (villa) ${rp(k.belanjaKonstruksiBulanIni)}`} />
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <Panel judul="Proyeksi kas 13 minggu" ikon="grafik" aksi={<Link href="/cfo/arus-kas" className="text-[11px] text-blue-600">detail →</Link>}>
                  <GrafikSaldo skenario={[m.arusKas.skenario.optimis, n, m.arusKas.skenario.pesimis]} kasMinimum={m.kasMinimum} />
                  <p className="mt-2 text-[12px] text-slate-600">
                    Skenario normal: saldo terendah <b><Uang n={n.saldoMin} /></b> pada {labelTanggal(n.tanggalSaldoMin)}.{' '}
                    {n.tanggalDefisit ? <b className="text-rose-600">Defisit mulai {labelTanggal(n.tanggalDefisit)}.</b> : 'Tidak ada defisit dalam 182 hari.'}
                  </p>
                </Panel>
              </div>
              <Panel judul="Komposisi kas" ikon="bank">
                <ul className="space-y-2 text-[12px]">
                  {m.kas.map((c) => (
                    <li key={c.id} className="border-b border-slate-100 pb-2">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">{c.label}</span>
                        <span className="font-mono"><Uang n={c.nilai} /></span>
                      </div>
                      <div className="text-[10.5px] text-slate-500">{c.dipakaiDalamTotal ? '✓ dihitung' : '✗ tidak dihitung'} · {c.catatan}</div>
                    </li>
                  ))}
                  <li className="flex justify-between text-[12px]"><span>Modal kerja bersih Loonars</span><span className="font-mono"><Uang n={m.modalKerja.bersih} /></span></li>
                </ul>
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel judul={`Peringatan risiko (${m.peringatan.length})`} ikon="peringatan" aksi={<Link href="/cfo/peringatan" className="text-[11px] text-blue-600">semua →</Link>}>
                <div className="space-y-2">
                  {m.peringatan.slice(0, 6).map((p) => <KartuPeringatan key={p.id} p={p} />)}
                  {!m.peringatan.length && <p className="text-[12px] text-slate-500">Tidak ada peringatan.</p>}
                </div>
              </Panel>
              <Panel judul="Urutan bayar yang disarankan" ikon="ceklis" aksi={<Link href="/cfo/kewajiban" className="text-[11px] text-blue-600">semua →</Link>}>
                <table className="w-full text-[12px]">
                  <tbody>
                    {m.kewajiban.slice(0, 8).map((x) => (
                      <tr key={x.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-2 font-mono text-slate-400">{x.urutan}</td>
                        <td className="py-1.5">
                          <div className="font-semibold">{x.pihak}</div>
                          <div className="text-[10.5px] text-slate-500">{x.lini} · {x.alasanPrioritas}</div>
                        </td>
                        <td className="py-1.5 text-right font-mono"><Uang n={x.nominal} /></td>
                        <td className="py-1.5 pl-2 text-[10px]">{x.tertutupKas ? '✓ kas cukup' : <span className="text-rose-600">kas kurang</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </div>
        );
      }}
    </DenganModel>
  );
}
