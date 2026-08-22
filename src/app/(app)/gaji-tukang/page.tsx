'use client';

import { useMemo } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, Panel, PesanGalat } from '@/components/ui/Umum';
import { PERUSAHAAN } from '@/lib/config';
import { getProyek } from '@/lib/master';
import { fmt, rupiah, tanggalPanjang, tanggalPendek, today } from '@/lib/format';
import type { BayarTukang, TukangBorongan } from '@/types';

export default function HalamanGajiTukang() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiGajiTukang />
    </GuardHalaman>
  );
}

function IsiGajiTukang() {
  const { tukang, bayarTukang, memuat, galat, muatUlang } = useData();
  const { proyek: filterAktif } = usePeriode();

  useJudul({
    judul: 'Gaji Tukang Borongan',
    deskripsi: 'Sisa gaji per tukang & rekap pembayaran harian',
  });

  const daftarTukang = useMemo(
    () => (filterAktif === 'ALL' ? tukang : tukang.filter((t) => t.proyek === filterAktif)),
    [tukang, filterAktif],
  );

  const pembayaran = useMemo(
    () =>
      (filterAktif === 'ALL' ? bayarTukang : bayarTukang.filter((b) => b.proyek === filterAktif))
        .slice()
        .sort((a, b) => (a.tgl < b.tgl ? 1 : -1)),
    [bayarTukang, filterAktif],
  );

  const hariIni = today();
  const bayarHariIni = useMemo(
    () => pembayaran.filter((b) => b.tgl === hariIni),
    [pembayaran, hariIni],
  );

  const totalSisa = daftarTukang.reduce(
    (s, t) => s + Math.max(0, t.nilai_kontrak - t.terbayar),
    0,
  );
  const totalHariIni = bayarHariIni.reduce((s, b) => s + (Number(b.nominal) || 0), 0);
  const namaProyek = filterAktif === 'ALL' ? 'Semua Proyek' : getProyek(filterAktif).nama;

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <>
      <div className="space-y-4 print:hidden">
        <Panel
          judul="Sisa Gaji Tukang / Kontraktor"
          ikon="palu"
          aksi={
            <button className="btn-green px-3 py-1.5 text-[11px]" onClick={() => window.print()}>
              <Icon name="printer" className="h-3.5 w-3.5" /> Cetak Slip Hari Ini
            </button>
          }
        >
          {daftarTukang.length === 0 ? (
            <Kosong pesan="Belum ada data tukang / kontraktor." ikon="palu" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {daftarTukang.map((t) => {
                const sisaUang = t.nilai_kontrak - t.terbayar;
                const sisaUnit = t.total_unit - t.unit_selesai;
                const pct = t.nilai_kontrak > 0 ? Math.min(100, (t.terbayar / t.nilai_kontrak) * 100) : 0;
                const p = getProyek(t.proyek);
                return (
                  <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
                    <div className="mb-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-bold text-slate-800">{t.nama}</div>
                        <div className="truncate text-[10px] text-slate-400">
                          {t.item || '—'}
                          {t.blok ? ` · Blok ${t.blok}` : ''}
                        </div>
                      </div>
                      <span
                        className="chip shrink-0"
                        style={{ backgroundColor: `${p.warna}22`, color: p.warna }}
                      >
                        {t.proyek}
                      </span>
                    </div>

                    <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <div className="label-mono">Nilai Kontrak</div>
                        <div className="font-bold text-slate-700">{rupiah(t.nilai_kontrak)}</div>
                      </div>
                      <div>
                        <div className="label-mono">Sudah Dibayar</div>
                        <div className="font-bold text-emerald-600">{rupiah(t.terbayar)}</div>
                      </div>
                      <div>
                        <div className="label-mono">Sisa Gaji</div>
                        <div className={`text-[14px] font-bold ${sisaUang <= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {sisaUang <= 0 ? '✓ LUNAS' : rupiah(sisaUang)}
                        </div>
                      </div>
                      <div>
                        <div className="label-mono">Sisa Unit</div>
                        <div className="font-bold text-slate-700">
                          {sisaUnit} / {t.total_unit}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel judul={`Riwayat Pembayaran Tukang — ${pembayaran.length} transaksi`} ikon="buku" padat>
          {pembayaran.length === 0 ? (
            <Kosong pesan="Belum ada pembayaran tukang." />
          ) : (
            <div className="thin-scroll max-h-[60vh] overflow-auto">
              <table className="tbl">
                <thead className="sticky top-0">
                  <tr>
                    <th>Tgl</th>
                    <th>No</th>
                    <th>Proyek</th>
                    <th>Tukang</th>
                    <th>Blok</th>
                    <th className="text-right">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  {pembayaran.map((b, i) => (
                    <tr key={b.id ?? i}>
                      <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {tanggalPendek(b.tgl)}
                      </td>
                      <td className="font-mono text-[11px] text-blue-600">{b.no ?? '-'}</td>
                      <td className="text-[11px]">{getProyek(b.proyek ?? '').nama}</td>
                      <td className="font-semibold text-slate-700">{b.tukang_nama ?? '-'}</td>
                      <td className="text-[11px] text-slate-500">{b.blok_selesai ?? '-'}</td>
                      <td className="num font-semibold text-emerald-600">
                        Rp {fmt(Number(b.nominal) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <SlipCetak
        namaProyek={namaProyek}
        bayarHariIni={bayarHariIni}
        tukang={daftarTukang}
        totalHariIni={totalHariIni}
        totalSisa={totalSisa}
      />
    </>
  );
}

/**
 * Lembar cetak slip gaji harian.
 *
 * Versi lama membuka `window.open()` lalu menulis HTML lewat `document.write`.
 * Di sini lembarnya cukup dirender sebagai bagian halaman yang hanya tampil
 * saat mencetak — tidak ada penyusunan HTML sebagai string, jadi nama tukang
 * dan blok tidak bisa lagi menjadi jalur XSS.
 */
function SlipCetak({
  namaProyek,
  bayarHariIni,
  tukang,
  totalHariIni,
  totalSisa,
}: {
  namaProyek: string;
  bayarHariIni: BayarTukang[];
  tukang: TukangBorongan[];
  totalHariIni: number;
  totalSisa: number;
}) {
  return (
    <div className="hidden print:block laporan-paper">
      <div className="lh">
        <div className="text-[16pt] font-bold uppercase">{PERUSAHAAN}</div>
        <div className="text-[9pt]">Slip Pembayaran Gaji Tukang / Kontraktor — Harian</div>
      </div>

      <div className="mb-4 flex justify-between text-[10pt]">
        <div>
          <b>Proyek:</b> {namaProyek}
        </div>
        <div>
          <b>Tanggal:</b> {tanggalPanjang(new Date())}
        </div>
      </div>

      <table className="calk-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Proyek</th>
            <th>Nama Tukang</th>
            <th>Blok</th>
            <th>Dibayar Hari Ini</th>
          </tr>
        </thead>
        <tbody>
          {bayarHariIni.length === 0 ? (
            <tr>
              <td colSpan={5}>Belum ada pembayaran hari ini</td>
            </tr>
          ) : (
            bayarHariIni.map((b, i) => (
              <tr key={b.id ?? i}>
                <td>{i + 1}</td>
                <td>{getProyek(b.proyek ?? '').nama}</td>
                <td>{b.tukang_nama ?? '-'}</td>
                <td>{b.blok_selesai ?? '-'}</td>
                <td>{rupiah(Number(b.nominal) || 0)}</td>
              </tr>
            ))
          )}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={4}>TOTAL DIBAYAR HARI INI</td>
            <td>{rupiah(totalHariIni)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mb-2 mt-6 border-b-2 border-black pb-1 text-[11.5pt] font-bold">
        REKAP SISA GAJI SELURUH TUKANG / KONTRAKTOR
      </div>
      <table className="calk-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Proyek</th>
            <th>Nama Tukang</th>
            <th>Pekerjaan</th>
            <th>Nilai Kontrak</th>
            <th>Sudah Dibayar</th>
            <th>Sisa Gaji</th>
          </tr>
        </thead>
        <tbody>
          {tukang.length === 0 ? (
            <tr>
              <td colSpan={7}>Belum ada data tukang</td>
            </tr>
          ) : (
            tukang.map((t, i) => {
              const sisa = t.nilai_kontrak - t.terbayar;
              return (
                <tr key={t.id ?? i}>
                  <td>{i + 1}</td>
                  <td>{getProyek(t.proyek).nama}</td>
                  <td>{t.nama}</td>
                  <td>{t.item || '-'}</td>
                  <td>{rupiah(t.nilai_kontrak)}</td>
                  <td>{rupiah(t.terbayar)}</td>
                  <td>{sisa <= 0 ? '✓ LUNAS' : rupiah(sisa)}</td>
                </tr>
              );
            })
          )}
          <tr style={{ fontWeight: 700 }}>
            <td colSpan={6}>TOTAL SISA GAJI BELUM DIBAYAR</td>
            <td>{rupiah(totalSisa)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mt-16 flex justify-between text-[9.5pt]">
        <div className="w-[200px] text-center">
          <div className="mt-12 border-t border-black pt-1">Manager / Verifikator</div>
        </div>
        <div className="w-[200px] text-center">
          <div className="mt-12 border-t border-black pt-1">Owner</div>
        </div>
      </div>
    </div>
  );
}
