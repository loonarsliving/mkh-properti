'use client';

import { useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, GrafikSaldo, Kpi, Uang } from '@/components/cfo/Ui';
import { SKENARIO, type NamaSkenario } from '@/lib/cfo/arus-kas';
import { labelBulan, labelTanggal, persen } from '@/lib/cfo/util';

/** 4. Cash Flow Forecast — harian, 13 minggu, bulanan; 3 skenario. */
export default function HalamanCfoArusKas() {
  useJudul({ judul: 'Cash Flow Forecast', deskripsi: 'Forecast harian, 13 minggu, dan bulanan — skenario optimis, normal, pesimis', tampilkanFilter: false });
  const [nama, setNama] = useState<NamaSkenario>('normal');
  const [tampil, setTampil] = useState<'mingguan' | 'harian' | 'bulanan'>('mingguan');
  return (
    <DenganModel>
      {(m) => {
        const s = m.arusKas.skenario[nama];
        const p = SKENARIO[nama];
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(['optimis', 'normal', 'pesimis'] as const).map((n) => (
                <button key={n} onClick={() => setNama(n)} className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${nama === n ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`}>{n}</button>
              ))}
              <span className="self-center text-[11px] text-slate-500">
                Pendapatan villa ×{p.pendapatanL1} · tagihan investor mundur {p.investorTelatHari} hari · biaya konstruksi ×{p.biayaKonstruksi} · tunggakan {p.tunggakanMasukHari === null ? 'tidak masuk' : `masuk +${p.tunggakanMasukHari} hari`}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Saldo awal" nilai={m.arusKas.input.kasAwal} ikon="dompet" nada="blue" />
              <Kpi label="Saldo terendah" nilai={s.saldoMin} ikon="grafik" nada={s.saldoMin < m.kasMinimum ? 'rose' : 'emerald'} catatan={labelTanggal(s.tanggalSaldoMin)} />
              <Kpi label="Prediksi defisit" nilai={s.tanggalDefisit ? -s.besarDefisit : 0} ikon="peringatan" nada={s.tanggalDefisit ? 'rose' : 'emerald'} catatan={s.tanggalDefisit ? `mulai ${labelTanggal(s.tanggalDefisit)}` : 'tidak ada dalam 182 hari'} />
              <Kpi label="Kebutuhan dana / working capital" nilai={s.kebutuhanDana} ikon="bank" nada={s.kebutuhanDana > 0 ? 'amber' : 'emerald'} catatan={`agar saldo ≥ kas minimum. Modal kerja bersih saat ini: ${m.modalKerja.bersih.toLocaleString('id-ID')}`} />
            </div>
            <Panel judul="Proyeksi saldo 13 minggu" ikon="grafik">
              <GrafikSaldo skenario={[m.arusKas.skenario.optimis, m.arusKas.skenario.normal, m.arusKas.skenario.pesimis]} kasMinimum={m.kasMinimum} />
            </Panel>
            <Panel
              judul={`Rincian — skenario ${nama}`}
              ikon="kalender"
              padat
              aksi={
                <div className="flex gap-1">
                  {(['harian', 'mingguan', 'bulanan'] as const).map((t) => (
                    <button key={t} onClick={() => setTampil(t)} className={`rounded px-2 py-0.5 text-[11px] ${tampil === t ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{t}</button>
                  ))}
                </div>
              }
            >
              <div className="max-h-[460px] overflow-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Periode</th><th className="px-3 py-2 text-right">Masuk</th><th className="px-3 py-2 text-right">Keluar</th><th className="px-3 py-2 text-right">Bersih</th><th className="px-3 py-2 text-right">Saldo akhir</th></tr></thead>
                  <tbody className="font-mono">
                    {(tampil === 'harian'
                      ? s.harian.slice(0, 30).map((h) => ({ k: h.tanggal, label: labelTanggal(h.tanggal), masuk: h.masuk, keluar: h.keluar, bersih: h.masuk - h.keluar, saldo: h.saldo }))
                      : (tampil === 'mingguan' ? s.mingguan : s.bulanan).map((b) => ({ k: b.label, label: tampil === 'bulanan' ? labelBulan(b.label) : `${b.label}: ${labelTanggal(b.mulai)} – ${labelTanggal(b.selesai)}`, masuk: b.masuk, keluar: b.keluar, bersih: b.bersih, saldo: b.saldoAkhir }))
                    ).map((r) => (
                      <tr key={r.k} className={`border-b border-slate-100 ${r.saldo < 0 ? 'bg-rose-50' : r.saldo < m.kasMinimum ? 'bg-amber-50' : ''}`}>
                        <td className="px-3 py-1.5 font-sans">{r.label}</td>
                        <td className="px-3 py-1.5 text-right"><Uang n={r.masuk} /></td>
                        <td className="px-3 py-1.5 text-right"><Uang n={-r.keluar} /></td>
                        <td className="px-3 py-1.5 text-right"><Uang n={r.bersih} /></td>
                        <td className="px-3 py-1.5 text-right font-bold"><Uang n={r.saldo} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel judul="Peristiwa terjadwal dalam forecast" ikon="dokumen" padat>
                <div className="max-h-[360px] overflow-auto">
                  <table className="w-full text-[12px]">
                    <tbody>
                      {s.rincianPeristiwa.slice(0, 80).map((e, i) => (
                        <tr key={`${e.tanggalEfektif}-${i}`} className="border-b border-slate-100">
                          <td className="px-3 py-1.5 font-mono text-[11px]">{labelTanggal(e.tanggalEfektif)}</td>
                          <td className="px-3 py-1.5">{e.ket}<div className="text-[10px] text-slate-400">{e.lini} · {e.jenis} · {e.sumber.tabel}</div></td>
                          <td className="px-3 py-1.5 text-right font-mono"><Uang n={e.nominal} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2">
                  <Catatan>
                    Ditambah arus operasi villa per hari (masuk {m.arusKas.input.l1MasukHarian.toLocaleString('id-ID', { maximumFractionDigits: 0 })}, keluar {m.arusKas.input.l1KeluarHarian.toLocaleString('id-ID', { maximumFractionDigits: 0 })}) dan laju konstruksi {m.arusKas.input.konstruksiPerHari.toLocaleString('id-ID', { maximumFractionDigits: 0 })}/hari sampai sisa budget {m.arusKas.input.konstruksiSisaBudget.toLocaleString('id-ID')} habis.
                  </Catatan>
                </div>
              </Panel>
              <Panel judul="Asumsi forecast" ikon="info">
                <ul className="list-disc space-y-1 pl-4">{m.arusKas.asumsi.map((a) => <li key={a}><Catatan>{a}</Catatan></li>)}</ul>
                <Catatan>Skenario: optimis pendapatan villa +10%; pesimis −25%, tagihan investor mundur 6 minggu, biaya konstruksi +{persen(10, 0)}.</Catatan>
              </Panel>
            </div>
          </div>
        );
      }}
    </DenganModel>
  );
}
