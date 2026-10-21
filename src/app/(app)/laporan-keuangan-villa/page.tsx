'use client';

import { useCallback, useEffect, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, PesanGalat } from '@/components/ui/Umum';
import { Bidang } from '@/components/ui/Form';
import { fmtAbs, today } from '@/lib/format';
import { PERUSAHAAN } from '@/lib/config';
import { sbQuery } from '@/lib/supabase';
import { bulanKePeriode, labelBulanPeriode } from '@/lib/villa';
import type { LaporanVillaBulanan } from '@/lib/villa-laporan';

/**
 * Laporan keuangan Loonars Villa dari kiriman harian villa-api (migrasi
 * 0054): pendapatan kotor, komisi OTA, bersih, COGS, laba kotor, OPEX (gaji),
 * laba bersih. Angkanya sama persis dengan halaman Finance di sistem villa.
 * Beda dengan "Laporan Laba-Rugi Villa" (input manual); halaman itu tetap ada.
 */
export default function HalamanLaporanKeuanganVilla() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiLaporanKeuanganVilla />
    </GuardHalaman>
  );
}

const n = (v: number | string | null | undefined): string => (Math.abs(Number(v) || 0) < 0.5 ? '-' : fmtAbs(Number(v)));
const neg = (v: number | string): string => (Math.abs(Number(v) || 0) < 0.5 ? '-' : `(${fmtAbs(Math.abs(Number(v)))})`);

function IsiLaporanKeuanganVilla() {
  const [bulan, setBulan] = useState(today().slice(0, 7));
  const [lap, setLap] = useState<LaporanVillaBulanan | null | undefined>(undefined);
  const [galat, setGalat] = useState<string | null>(null);

  useJudul({
    judul: 'Laporan Keuangan Villa',
    deskripsi: 'Dikirim otomatis dari sistem villa tiap malam — kotor, komisi OTA, COGS, OPEX, laba bersih',
  });

  const muat = useCallback(async () => {
    setGalat(null);
    setLap(undefined);
    try {
      const baris = await sbQuery<LaporanVillaBulanan>('laporan_villa_bulanan', `select=*&periode=eq.${bulanKePeriode(bulan)}`);
      setLap(baris[0] ?? null);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, [bulan]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const toolbar = (
    <div className="no-print card-pad flex flex-wrap items-end gap-3">
      <Bidang label="Bulan" htmlFor="lkv-bulan" anak={<input id="lkv-bulan" type="month" className="input" value={bulan} onChange={(e) => e.target.value && setBulan(e.target.value)} />} />
      <button className="btn-amber" onClick={() => window.print()} disabled={!lap}>
        <Icon name="printer" className="h-4 w-4" /> Cetak / Simpan PDF
      </button>
      {lap && (
        <span className="font-mono text-[10.5px] text-slate-500">
          {lap.status === 'final' ? '✓ Final' : '⏳ Sementara (bulan berjalan)'} · diperbarui {new Date(lap.diterima_pada).toLocaleString('id-ID')}
        </span>
      )}
    </div>
  );

  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat()} />;
  if (lap === undefined) return <div className="space-y-4">{toolbar}<Memuat pesan="Memuat laporan villa…" /></div>;
  if (lap === null) {
    return (
      <div className="space-y-4">
        {toolbar}
        <Kosong pesan={`Belum ada kiriman dari sistem villa untuk ${labelBulanPeriode(bulanKePeriode(bulan))}. Dikirim otomatis tiap malam.`} ikon="grafik" />
      </div>
    );
  }

  const r = lap.rincian ?? {};
  const malamTerisi = lap.malam_terjual + lap.malam_gratis;
  const net = Number(lap.net_profit);

  return (
    <div className="space-y-4">
      {toolbar}
      <div className="laporan-paper">
        <div className="page">
          <div className="lh">
            <div className="text-[13pt] font-bold uppercase tracking-wide">{PERUSAHAAN}</div>
            <div className="mt-0.5 text-[12pt] font-bold uppercase">Laporan Keuangan — Loonars Villa</div>
            <div className="mt-0.5 text-[10pt]">{labelBulanPeriode(lap.periode)}{lap.status === 'sementara' ? ' (sementara)' : ''}</div>
            <div className="text-[10pt]">(Disajikan dalam Rupiah)</div>
          </div>

          <div className="sec-title">Pendapatan Kamar</div>
          <table className="lt">
            <tbody>
              <tr><td className="indent">Pendapatan kotor (total dibayar tamu)</td><td>{n(lap.omzet_kotor)}</td></tr>
              <tr><td className="indent">Komisi OTA</td><td>{neg(lap.komisi_ota)}</td></tr>
              <tr className="subtotal"><td>Pendapatan Bersih</td><td>{n(lap.pendapatan_bersih)}</td></tr>
            </tbody>
          </table>

          <div className="sec-title">Harga Pokok Penjualan (COGS)</div>
          <table className="lt">
            <tbody>
              <tr><td className="indent">COGS standar {fmtAbs(Number(lap.cogs_per_malam))} × {malamTerisi} malam terisi</td><td>{neg(lap.cogs)}</td></tr>
              <tr className="subtotal"><td>Laba Kotor (Gross Profit)</td><td>{Number(lap.gross_profit) < 0 ? neg(lap.gross_profit) : n(lap.gross_profit)}</td></tr>
            </tbody>
          </table>

          <div className="sec-title">Beban Operasional (OPEX)</div>
          <table className="lt">
            <tbody>
              {(r.opex_rincian ?? []).map((o) => (
                <tr key={o.peran}><td className="indent">Gaji {o.peran} ({o.orang} orang)</td><td>{neg(o.periode)}</td></tr>
              ))}
              <tr className="subtotal"><td>Total OPEX</td><td>{neg(lap.opex)}</td></tr>
            </tbody>
          </table>

          <table className="lt">
            <tbody>
              <tr className="double-line">
                <td>{net < 0 ? 'Rugi Bersih (Net Profit)' : 'Laba Bersih (Net Profit)'}</td>
                <td>{net < 0 ? neg(net) : fmtAbs(net)}</td>
              </tr>
            </tbody>
          </table>

          <div className="sec-title">Informasi Operasional</div>
          <table className="lt">
            <tbody>
              <tr><td className="indent">Malam terjual</td><td>{lap.malam_terjual}</td></tr>
              <tr><td className="indent">Malam gratis (investor)</td><td>{lap.malam_gratis}</td></tr>
              <tr><td className="indent">Okupansi</td><td>{lap.okupansi_pct == null ? '-' : `${Number(lap.okupansi_pct).toFixed(1)}%`}</td></tr>
              <tr><td className="indent">Pendapatan walk-in (cafe/spa/lainnya), di luar laba di atas</td><td>{n(lap.pendapatan_walkin)}</td></tr>
            </tbody>
          </table>

          {(r.channel ?? []).length > 0 && (
            <>
              <div className="sec-title">Per Channel</div>
              <table className="lt">
                <thead>
                  <tr><td>Channel</td><td>Booking</td><td>Malam</td><td>Kotor</td><td>Komisi</td><td>Bersih</td></tr>
                </thead>
                <tbody>
                  {(r.channel ?? []).map((c) => (
                    <tr key={c.sumber}><td className="indent">{c.sumber}</td><td>{c.booking}</td><td>{c.malam}</td><td>{n(c.kotor)}</td><td>{neg(c.komisi)}</td><td>{n(c.bersih)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {r.bagi_hasil && (
            <>
              <div className="sec-title">Pembagian Laba Bersih</div>
              <table className="lt">
                <tbody>
                  <tr><td className="indent">Investor (70%) — {r.bagi_hasil.investor_count} unit, per unit {fmtAbs(r.bagi_hasil.per_unit)}</td><td>{n(r.bagi_hasil.pool_investor)}</td></tr>
                  <tr><td className="indent">Pengelola (30%)</td><td>{n(r.bagi_hasil.pengelola)}</td></tr>
                </tbody>
              </table>
            </>
          )}

          <p className="mt-6 text-[9.5pt] leading-relaxed text-slate-500">
            {(r.catatan ?? []).map((c) => `${c} `)}
            Angka dikirim otomatis dari sistem villa dan sama dengan halaman Finance villa; tidak ada penyesuaian di MKH Property.
          </p>
        </div>
      </div>
    </div>
  );
}
