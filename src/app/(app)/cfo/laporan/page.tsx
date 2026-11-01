'use client';

import { useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, TabelAngka } from '@/components/cfo/Ui';
import { PERUSAHAAN } from '@/lib/config';
import type { ModelCfo } from '@/lib/cfo/model';
import { labelBulan, labelTanggal } from '@/lib/cfo/util';
import { getAccessToken, perbaruiToken } from '@/lib/supabase';

/** 9. Financial Reports — laporan konsolidasi siap cetak + briefing WhatsApp. */
export default function HalamanCfoLaporan() {
  useJudul({ judul: 'Financial Reports', deskripsi: 'Laporan konsolidasi siap cetak + pratinjau & kirim briefing WhatsApp ke owner', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

async function panggilBriefing(jenis: 'harian' | 'mingguan', kirim: boolean): Promise<{ ok: boolean; j: Record<string, unknown> }> {
  const panggil = (t: string | null) =>
    fetch('/api/cfo/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t ?? ''}` }, body: JSON.stringify({ jenis, kirim }) });
  let res = await panggil(getAccessToken());
  if (res.status === 401) {
    const baru = await perbaruiToken();
    if (baru) res = await panggil(baru);
  }
  return { ok: res.ok, j: (await res.json()) as Record<string, unknown> };
}

function Isi({ m }: { m: ModelCfo }) {
  const [teks, setTeks] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const l1 = m.l1.terakhirFinal ?? m.l1.terakhir;
  const l2 = m.l2;

  async function jalankan(jenis: 'harian' | 'mingguan', kirim: boolean) {
    if (kirim && !window.confirm('Kirim briefing ini ke WhatsApp owner sekarang?')) return;
    setSibuk(true);
    setInfo(null);
    try {
      const { ok, j } = await panggilBriefing(jenis, kirim);
      if (!ok) setInfo(`Gagal: ${String(j.error ?? 'error')}`);
      else {
        setTeks(String(j.teks ?? ''));
        if (kirim) setInfo(j.status === 'ok' ? `Masuk antrean WA (${String(j.antre)} penerima).` : `Status: ${String(j.status)}`);
      }
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="no-print grid gap-4 xl:grid-cols-2">
        <Panel judul="Briefing WhatsApp owner" ikon="kirim">
          <Catatan>Otomatis: harian 07.07 WITA, mingguan Senin 07.17 WITA, cek peringatan kritis tiap 6 jam (pg_cron → antrean WA yang sudah ada → Whacenter). Penerima: nomor peran owner di Loonars 2.</Catatan>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-amber" disabled={sibuk} onClick={() => void jalankan('harian', false)}>Pratinjau harian</button>
            <button className="btn-amber" disabled={sibuk} onClick={() => void jalankan('mingguan', false)}>Pratinjau mingguan</button>
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px]" disabled={sibuk} onClick={() => void jalankan('harian', true)}>Kirim harian sekarang</button>
          </div>
          {info && <p className="mt-2 text-[12px] font-semibold">{info}</p>}
          {teks && <pre className="mt-2 max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11.5px]">{teks}</pre>}
        </Panel>
        <Panel judul="Cetak laporan" ikon="printer">
          <Catatan>Laporan di bawah memuat Loonars 1, Loonars 2, dan konsolidasi owner dengan angka yang sama dengan dashboard. Gunakan tombol cetak untuk menyimpan sebagai PDF.</Catatan>
          <button className="btn-amber mt-2" onClick={() => window.print()}><Icon name="printer" className="h-4 w-4" /> Cetak / Simpan PDF</button>
        </Panel>
      </div>

      <div className="laporan-paper">
        <div className="page space-y-4">
          <div className="lh">
            <div className="text-[13pt] font-bold uppercase tracking-wide">{PERUSAHAAN}</div>
            <div className="mt-0.5 text-[12pt] font-bold uppercase">Laporan Keuangan Manajemen — Loonars</div>
            <div className="text-[10pt]">Per {labelTanggal(m.hariIni)} · disajikan dalam Rupiah</div>
          </div>

          <div className="sec-title">A. Konsolidasi Owner</div>
          <TabelAngka baris={[
            { label: 'Total posisi kas (tercatat)', nilai: m.konsolidasi.kasTotal },
            { label: 'Total kewajiban (termasuk grup MKH lain)', nilai: m.konsolidasi.kewajibanTotal },
            { label: 'Total piutang', nilai: m.konsolidasi.piutangTotal },
            { label: 'Pendapatan operasional bulan ini (Loonars 1)', nilai: m.konsolidasi.pendapatanOperasionalBulanIni },
            { label: 'Cash-in investor Loonars 2 (uang muka, bukan pendapatan)', nilai: m.konsolidasi.cashInInvestor },
            { label: 'Beban operasional bulan ini', nilai: m.konsolidasi.bebanOperasionalBulanIni },
            { label: 'Belanja konstruksi kumulatif', nilai: m.konsolidasi.belanjaKonstruksiTotal },
            { label: 'Kebutuhan dana — skenario normal', nilai: m.konsolidasi.kebutuhanDana.normal },
            { label: 'Kebutuhan dana — skenario pesimis', nilai: m.konsolidasi.kebutuhanDana.pesimis },
          ]} />

          <div className="sec-title">B. Loonars 1 — Hospitality {l1 ? `(${labelBulan(l1.bulan)}${l1.status === 'sementara' ? ', sementara' : ''})` : ''}</div>
          {l1 ? (
            <TabelAngka baris={[
              { label: 'Revenue', nilai: l1.revenue },
              { label: 'Cost of Revenue (komisi OTA + COGS)', nilai: -l1.costOfRevenue },
              { label: 'Laba kotor (atas pendapatan bersih)', nilai: l1.labaKotor, tebal: true },
              { label: 'Payroll', nilai: -l1.payroll, indent: true },
              { label: 'OPEX lain', nilai: -l1.opexLain, indent: true },
              { label: 'EBITDA', nilai: l1.ebitda, tebal: true },
              { label: 'Net Profit (D&A, bunga, PPh belum tercatat)', nilai: l1.netProfit, tebal: true },
              { label: 'Bagi hasil investor + top-up jaminan', nilai: -(l1.bagiHasilInvestor + l1.topupJaminan) },
              { label: 'Bagian MKH bersih', nilai: l1.bagianMkhBersih, tebal: true },
            ]} />
          ) : <Catatan>Belum ada data.</Catatan>}

          <div className="sec-title">C. Loonars 2 — Developer &amp; Construction{l2.proyek.length ? ` (termasuk ${l2.proyek.map((x) => x.nama).join(', ')})` : ''}</div>
          <TabelAngka baris={[
            { label: 'Sales contract value', nilai: l2.nilaiKontrak },
            { label: 'Investor cash-in', nilai: l2.cashInInvestor },
            { label: 'Outstanding receivables', nilai: l2.piutangKontrak },
            { label: 'Construction expenses villa Loonars 2 (kas)', nilai: l2.biayaKonstruksiKas },
            ...l2.proyek.flatMap((pr) => [
              { label: `${pr.nama} (dibiayai Loonars 2): realisasi`, nilai: pr.realisasiTotal },
              { label: `${pr.nama}: budget`, nilai: pr.budgetTotal, indent: true },
              { label: `${pr.nama}: ${pr.selisihBudget !== null && pr.selisihBudget > 0 ? 'lewat budget' : 'sisa budget'}`, nilai: pr.selisihBudget === null ? null : Math.abs(pr.selisihBudget), indent: true },
            ]),
            { label: 'Budget unit dibangun', nilai: l2.budgetUnitAktif, indent: true },
            { label: 'Aktual unit dibangun', nilai: l2.aktualUnitAktif, indent: true },
            { label: 'Accounts payable (toko bangunan, villa + proyek)', nilai: l2.utangToko + l2.utangProyekLain },
            { label: 'Utang ke owner (dana talangan)', nilai: l2.danaTalangan },
            { label: 'Proyeksi laba proyek', nilai: l2.proyeksi.laba, tebal: true },
            { label: 'Total aset', nilai: l2.neraca.totalAset },
            { label: 'Total liabilitas', nilai: l2.neraca.totalLiabilitas },
            { label: 'Ekuitas (defisit) tersirat', nilai: l2.neraca.ekuitasTersirat, tebal: true },
          ]} />

          <div className="sec-title">D. Catatan</div>
          <ul className="list-disc pl-5 text-[9.5pt] leading-relaxed text-slate-600">
            <li>Pendapatan hospitality dan cash-in penjualan investor disajikan terpisah; cash-in investor diakui sebagai uang muka sampai unit diserahterimakan.</li>
            {m.l1.neraca.catatan.map((c) => <li key={c}>{c}</li>)}
            {m.rekonsiliasi.filter((r) => r.status === 'selisih').map((r) => <li key={r.id}>Rekonsiliasi belum cocok: {r.judul} (selisih {r.selisih?.toLocaleString('id-ID')}).</li>)}
            <li>Seluruh angka dihitung deterministik oleh sistem dari data sumber; AI CFO hanya menafsirkan.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
