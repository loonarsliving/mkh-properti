'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Memuat, PesanGalat } from '@/components/ui/Umum';
import { sbQuery } from '@/lib/supabase';
import { fmtAbs, rupiah } from '@/lib/format';
import { PERUSAHAAN } from '@/lib/config';
import { labelPeriodeLaporan, rentang } from '@/lib/periode';
import { KATEGORI_BEBAN_VILLA, KATEGORI_PENDAPATAN_VILLA, ringkasBebanVilla, ringkasPendapatanVilla } from '@/lib/villa';
import type { BebanVilla, PendapatanVilla } from '@/types';

export default function HalamanLaporanVilla() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiLaporanVilla />
    </GuardHalaman>
  );
}

/** Angka laporan: nol sebagai strip, sama seperti LembarLaporan SAK EMKM. */
function n(v: number): string {
  return Math.abs(v) < 0.5 ? '-' : fmtAbs(v);
}

function IsiLaporanVilla() {
  const { periode } = usePeriode();
  const [pendapatan, setPendapatan] = useState<PendapatanVilla[] | null>(null);
  const [beban, setBeban] = useState<BebanVilla[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useJudul({
    judul: 'Laporan Laba-Rugi Villa',
    deskripsi: 'Siap cetak — laba-rugi Loonars Villa untuk periode terpilih di atas',
  });

  const muatUlang = useCallback(async () => {
    setGalat(null);
    try {
      const [p, b] = await Promise.all([
        sbQuery<PendapatanVilla>('pendapatan_villa', 'select=*&order=periode.asc'),
        sbQuery<BebanVilla>('beban_villa', 'select=*&order=periode.asc'),
      ]);
      setPendapatan(p);
      setBeban(b);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  const rentangTanggal = useMemo(() => rentang(periode), [periode]);

  const dalamPeriode = useCallback(
    (p: string) => p >= rentangTanggal.mulai && p <= rentangTanggal.selesai,
    [rentangTanggal],
  );

  const ringkasanPendapatan = useMemo(
    () => ringkasPendapatanVilla((pendapatan ?? []).filter((b) => dalamPeriode(b.periode))),
    [pendapatan, dalamPeriode],
  );
  const ringkasanBeban = useMemo(
    () => ringkasBebanVilla((beban ?? []).filter((b) => dalamPeriode(b.periode))),
    [beban, dalamPeriode],
  );

  const labaBersih = ringkasanPendapatan.total - ringkasanBeban.total;

  if (pendapatan === null || beban === null) {
    if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;
    return <Memuat pesan="Menyusun laporan laba-rugi villa…" />;
  }
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="space-y-4">
      <div className="no-print card-pad flex flex-wrap items-center gap-2.5">
        <button className="btn-amber" onClick={() => window.print()}>
          <Icon name="printer" className="h-4 w-4" /> Cetak / Simpan PDF
        </button>
        <span className="font-mono text-[10.5px] text-slate-500">
          {labelPeriodeLaporan(periode)} · {ringkasanPendapatan.total > 0 || ringkasanBeban.total > 0 ? 'Ada data' : 'Belum ada data'} untuk periode ini
        </span>
        {labaBersih < 0 ? (
          <span className="chip bg-rose-100 text-rose-700">⚠ Rugi periode ini</span>
        ) : (
          <span className="chip bg-emerald-100 text-emerald-700">✓ Laba periode ini</span>
        )}
      </div>

      <div className="laporan-paper">
        <div className="page">
          <div className="lh">
            <div className="text-[13pt] font-bold uppercase tracking-wide">{PERUSAHAAN}</div>
            <div className="mt-0.5 text-[12pt] font-bold uppercase">Laporan Laba Rugi — Loonars Villa</div>
            <div className="mt-0.5 text-[10pt]">{labelPeriodeLaporan(periode)}</div>
            <div className="text-[10pt]">(Disajikan dalam Rupiah, kecuali dinyatakan lain)</div>
          </div>

          <div className="sec-title">Pendapatan</div>
          <table className="lt">
            <tbody>
              {KATEGORI_PENDAPATAN_VILLA.map((k) => (
                <tr key={k.id}>
                  <td className="indent">{k.label}</td>
                  <td>{n(ringkasanPendapatan.perKategori[k.id])}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td>Total Pendapatan</td>
                <td>{n(ringkasanPendapatan.total)}</td>
              </tr>
            </tbody>
          </table>

          <div className="sec-title">Beban</div>
          <table className="lt">
            <tbody>
              {KATEGORI_BEBAN_VILLA.map((k) => (
                <tr key={k.id}>
                  <td className="indent">{k.label}</td>
                  <td>{n(ringkasanBeban.perKategori[k.id])}</td>
                </tr>
              ))}
              <tr className="subtotal">
                <td>Total Beban</td>
                <td>{n(ringkasanBeban.total)}</td>
              </tr>
            </tbody>
          </table>

          <table className="lt">
            <tbody>
              <tr className="double-line">
                <td>{labaBersih < 0 ? 'Rugi Bersih' : 'Laba Bersih'}</td>
                <td>{labaBersih < 0 ? `(${fmtAbs(labaBersih)})` : fmtAbs(labaBersih)}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-6 text-[9.5pt] leading-relaxed text-slate-500">
            Catatan: Pendapatan &amp; beban Loonars Villa dicatat terpisah dari jurnal umum MKH
            Property karena sistem villa berjalan di project Supabase yang berbeda — lihat menu
            Pendapatan Villa &amp; Beban Villa untuk rincian per baris. Opex &amp; Marketing dihitung
            sesuai persentase akad villa sendiri, bukan rincian biaya aktual.
          </p>
        </div>
      </div>
    </div>
  );
}
