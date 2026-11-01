'use client';

import { useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { InputRupiah } from '@/components/ui/Form';
import { Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel, DaftarSumber, Kpi, TabelAngka, Uang } from '@/components/cfo/Ui';
import type { KasL1 } from '@/lib/cfo/loonars1';
import { hariIniJakarta, labelBulan, labelTanggal, persen, rp } from '@/lib/cfo/util';
import { sbRpc } from '@/lib/supabase';

/** Kas villa: catat saldo rekening (dari mutasi bank) + kas berjalan dari mutasi villa. */
function PanelKasVilla({ kas }: { kas: KasL1 | null }) {
  const { muatUlang } = useCfo();
  const [rekening, setRekening] = useState(kas?.rekening[0]?.rekening ?? 'Rekening operasional villa');
  const [saldo, setSaldo] = useState(0);
  const [tanggal, setTanggal] = useState(hariIniJakarta());
  const [catatan, setCatatan] = useState('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function simpan() {
    setSibuk(true);
    setPesan(null);
    try {
      await sbRpc<number>('cfo_saldo_catat', { p_lini: 'L1', p_rekening: rekening.trim(), p_saldo: Math.round(saldo), p_per_tanggal: tanggal, p_catatan: catatan || null });
      setPesan('Saldo tercatat.');
      setSaldo(0);
      setCatatan('');
      muatUlang();
    } catch (e) {
      setPesan(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Panel judul="Kas & bank villa" ikon="bank">
      {kas ? (
        <>
          <TabelAngka
            baris={[
              ...kas.rekening.map((r) => ({ label: `Saldo ${r.rekening} per ${labelTanggal(r.perTanggal)}`, nilai: r.saldo, catatan: `dicatat ${r.dicatatOleh}` })),
              { label: `Masuk sesudah ${labelTanggal(kas.perTanggal)} (OTA cair, website, walk-in)`, nilai: kas.masukSesudah, indent: true },
              { label: 'Keluar sesudahnya (biaya villa ditransfer)', nilai: -kas.keluarSesudah, indent: true },
              { label: 'Kas villa berjalan (estimasi)', nilai: kas.kasBerjalan, tebal: true },
            ]}
          />
          <Catatan>Saldo dicatat {kas.umurHari} hari lalu. Gaji staf dan bagi hasil investor tidak tercatat sebagai mutasi di sistem villa — catat saldo baru setelah membayarnya atau minimal seminggu sekali.</Catatan>
        </>
      ) : (
        <Catatan>Belum ada saldo rekening villa tercatat. Sistem villa tidak bisa membaca bank, jadi saldo diambil dari mutasi bank lalu dicatat di sini (dengan tanggal saldonya).</Catatan>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[12px]">Rekening<input className="input mt-1 w-full" value={rekening} onChange={(e) => setRekening(e.target.value)} maxLength={80} /></label>
        <label className="text-[12px]">Saldo per tanggal<input type="date" className="input mt-1 w-full" value={tanggal} max={hariIniJakarta()} onChange={(e) => setTanggal(e.target.value)} /></label>
        <label className="text-[12px]">Saldo (Rp)<InputRupiah id="cfo-saldo-villa" nilai={saldo} onUbah={setSaldo} /></label>
        <label className="text-[12px]">Catatan<input className="input mt-1 w-full" value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} placeholder="mis. dari mutasi BTN" /></label>
      </div>
      <button className="btn-amber mt-2" disabled={sibuk || rekening.trim().length < 2 || !tanggal} onClick={() => void simpan()}>Catat saldo</button>
      {pesan && <span className="ml-2 text-[12px]">{pesan}</span>}
      <div className="mt-1"><Catatan>Tercatat permanen (koreksi = catat baris baru) dan masuk jejak audit.</Catatan></div>
    </Panel>
  );
}

/** 2. Loonars 1 — Hospitality Financial Report. */
export default function HalamanCfoL1() {
  useJudul({ judul: 'Loonars 1 — Hospitality Finance', deskripsi: 'Revenue, Cost of Revenue, OPEX, Payroll, EBITDA, Net Profit, Cash Flow, Balance Sheet', tampilkanFilter: false });
  return (
    <DenganModel>
      {(m) => {
        const l1 = m.l1;
        const t = l1.terakhir;
        const f = l1.terakhirFinal;
        if (!t) return <Panel judul="Belum ada data"><Catatan>Belum ada kiriman laporan villa (laporan_villa_bulanan).</Catatan></Panel>;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label={`Revenue ${labelBulan(t.bulan)} (${t.status})`} nilai={t.revenue} ikon="grafik" nada="blue" />
              <Kpi label={`EBITDA ${labelBulan(t.bulan)}`} nilai={t.ebitda} ikon="kotak" nada={t.ebitda >= 0 ? 'emerald' : 'rose'} catatan={t.marginEbitdaPct === null ? undefined : `margin ${persen(t.marginEbitdaPct)} dari pendapatan bersih`} />
              <Kpi label="Bagian MKH bersih" nilai={t.bagianMkhBersih} ikon="dompet" nada={t.bagianMkhBersih >= 0 ? 'emerald' : 'rose'} catatan="Pengelola 30% − top-up jaminan investor" />
              <Kpi label="YTD revenue" nilai={l1.ytd?.revenue ?? 0} ikon="kalender" nada="violet" catatan={`YTD EBITDA ${rp(l1.ytd?.ebitda ?? 0)}`} />
            </div>

            <PanelKasVilla kas={l1.kas} />

            <Panel judul="Laba rugi per bulan" ikon="grafik" padat>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Pos</th>
                      {l1.bulan.map((b) => <th key={b.bulan} className="px-3 py-2 text-right">{labelBulan(b.bulan)}{b.status === 'sementara' ? '*' : ''}</th>)}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {([
                      ['Revenue (dibayar tamu)', 'revenue', false],
                      ['  Komisi OTA', 'komisiOta', false],
                      ['  COGS standar', 'cogs', false],
                      ['Cost of Revenue', 'costOfRevenue', true],
                      ['Laba kotor', 'labaKotor', true],
                      ['  Payroll (gaji staf)', 'payroll', false],
                      ['  OPEX lain', 'opexLain', false],
                      ['OPEX', 'opex', true],
                      ['EBITDA', 'ebitda', true],
                      ['Net Profit', 'netProfit', true],
                      ['  Bagi hasil investor (70%)', 'bagiHasilInvestor', false],
                      ['  Top-up jaminan investor', 'topupJaminan', false],
                      ['Bagian MKH bersih', 'bagianMkhBersih', true],
                    ] as const).map(([label, key, tebal]) => (
                      <tr key={key} className={`border-b border-slate-100 ${tebal ? 'font-bold' : ''}`}>
                        <td className="whitespace-pre px-3 py-1.5 font-sans">{label}</td>
                        {l1.bulan.map((b) => <td key={b.bulan} className="px-3 py-1.5 text-right"><Uang n={b[key]} /></td>)}
                      </tr>
                    ))}
                    <tr className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">Okupansi</td>{l1.bulan.map((b) => <td key={b.bulan} className="px-3 py-1.5 text-right">{b.okupansiPct === null ? '-' : persen(b.okupansiPct)}</td>)}</tr>
                    <tr className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">ADR (kotor)</td>{l1.bulan.map((b) => <td key={b.bulan} className="px-3 py-1.5 text-right"><Uang n={b.adr} tidakAda="-" /></td>)}</tr>
                    <tr className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">RevPAR</td>{l1.bulan.map((b) => <td key={b.bulan} className="px-3 py-1.5 text-right"><Uang n={b.revpar} tidakAda="-" /></td>)}</tr>
                    <tr><td className="px-3 py-1.5 font-sans">Pendapatan walk-in (di luar laba)</td>{l1.bulan.map((b) => <td key={b.bulan} className="px-3 py-1.5 text-right"><Uang n={b.pendapatanLain} /></td>)}</tr>
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2"><Catatan>* bulan berjalan, angka sementara. Net Profit = EBITDA karena depresiasi, bunga, dan PPh belum tercatat di sumber. <DaftarSumber sumber={l1.sumber} /></Catatan></div>
            </Panel>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel judul="Arus kas operasi (estimasi akrual)" ikon="transfer" padat>
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Bulan</th><th className="px-3 py-2 text-right">Masuk bersih</th><th className="px-3 py-2 text-right">COGS+OPEX</th><th className="px-3 py-2 text-right">Bagi hasil</th><th className="px-3 py-2 text-right">Bersih</th></tr></thead>
                  <tbody className="font-mono">
                    {l1.arusKasEstimasi.map((a) => (
                      <tr key={a.bulan} className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">{labelBulan(a.bulan)}</td><td className="px-3 py-1.5 text-right"><Uang n={a.masukBersih} /></td><td className="px-3 py-1.5 text-right"><Uang n={-(a.keluarCogs + a.keluarOpex)} /></td><td className="px-3 py-1.5 text-right"><Uang n={-a.keluarBagiHasil} /></td><td className="px-3 py-1.5 text-right font-bold"><Uang n={a.bersih} /></td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2"><Catatan>Estimasi dari laporan bulanan, bukan mutasi bank — rekening villa belum tersambung.</Catatan></div>
              </Panel>
              <Panel judul="Neraca (parsial)" ikon="kotak">
                <TabelAngka
                  baris={[
                    { label: 'Kas & bank villa', nilai: l1.neraca.kas, catatan: l1.kas ? `saldo ${l1.kas.perTanggal} + mutasi sesudahnya` : 'Saldo belum dicatat' },
                    { label: 'Piutang settlement OTA', nilai: l1.neraca.piutangOta },
                    { label: '  jatuh tempo ≤7 hari', nilai: l1.neraca.piutangOtaJatuhTempo7Hari, indent: true },
                    { label: 'Kewajiban bagi hasil investor bulan berjalan', nilai: l1.neraca.kewajibanBagiHasilBerjalan },
                    { label: 'Pajak hotel terutang belum disetor', nilai: l1.neraca.pajakHotelTerutang },
                    { label: 'Pengajuan biaya villa belum dibayar', nilai: l1.neraca.pengajuanBiayaBelumDibayar },
                  ]}
                />
                <ul className="mt-2 list-disc pl-4">{l1.neraca.catatan.map((c) => <li key={c}><Catatan>{c}</Catatan></li>)}</ul>
              </Panel>
            </div>

            {f && f.channel.length > 0 && (
              <Panel judul={`Revenue per channel — ${labelBulan(f.bulan)}`} ikon="grafik" padat>
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Channel</th><th className="px-3 py-2 text-right">Malam</th><th className="px-3 py-2 text-right">Kotor</th><th className="px-3 py-2 text-right">Komisi</th><th className="px-3 py-2 text-right">Bersih</th><th className="px-3 py-2 text-right">Komisi %</th></tr></thead>
                  <tbody className="font-mono">
                    {f.channel.map((c) => (
                      <tr key={c.sumber} className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">{c.sumber}</td><td className="px-3 py-1.5 text-right">{c.malam}</td><td className="px-3 py-1.5 text-right"><Uang n={c.kotor} /></td><td className="px-3 py-1.5 text-right"><Uang n={-c.komisi} /></td><td className="px-3 py-1.5 text-right"><Uang n={c.bersih} /></td><td className="px-3 py-1.5 text-right">{c.kotor > 0 ? persen((c.komisi / c.kotor) * 100) : '-'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </div>
        );
      }}
    </DenganModel>
  );
}
