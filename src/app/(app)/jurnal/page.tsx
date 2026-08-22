'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { TagProyek } from '@/components/ui/Form';
import { COA, getAkun } from '@/lib/master';
import { filterProyek as saringProyek, jurnalDalamRentang } from '@/lib/akuntansi/saldo';
import { fmt, tanggalPendek } from '@/lib/format';
import { labelPeriodeRingkas, rentang } from '@/lib/periode';
import { sbDeleteWhere } from '@/lib/supabase';
import { unduhCsv } from '@/lib/ekspor';
import type { Jurnal } from '@/types';

export default function HalamanJurnal() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiJurnal />
    </GuardHalaman>
  );
}

function IsiJurnal() {
  const { jurnal, memuat, galat, muatUlang, hapusJurnalNo } = useData();
  const { periode, proyek } = usePeriode();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [akunFilter, setAkunFilter] = useState('');
  const [tampilkanSemuaPeriode, setTampilkanSemuaPeriode] = useState(false);

  useJudul({
    judul: 'Jurnal Umum (General Ledger)',
    deskripsi: 'Buku besar seluruh transaksi — dasar penyusunan laporan SAK EMKM',
  });

  const r = rentang(periode);

  const baris = useMemo(() => {
    let hasil = saringProyek(jurnal, proyek);
    if (!tampilkanSemuaPeriode) hasil = jurnalDalamRentang(hasil, r.mulai, r.selesai);
    if (akunFilter) hasil = hasil.filter((j) => j.akun === akunFilter);
    const q = cari.trim().toLowerCase();
    if (q) {
      hasil = hasil.filter(
        (j) =>
          j.no?.toLowerCase().includes(q) ||
          j.ket?.toLowerCase().includes(q) ||
          j.nama?.toLowerCase().includes(q) ||
          j.akun?.toLowerCase().includes(q),
      );
    }
    return hasil.slice().reverse();
  }, [jurnal, proyek, tampilkanSemuaPeriode, r.mulai, r.selesai, akunFilter, cari]);

  const totalD = baris.reduce((s, j) => s + j.D, 0);
  const totalK = baris.reduce((s, j) => s + j.K, 0);
  const seimbang = Math.abs(totalD - totalK) < 1;

  async function hapus(no: string) {
    if (!window.confirm(`Hapus semua jurnal dengan no ${no}?`)) return;
    setSibuk('Menghapus jurnal…');
    try {
      await sbDeleteWhere('jurnal', `no=eq.${encodeURIComponent(no)}`);
      hapusJurnalNo(no);
      toast.sukses('Jurnal dihapus.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  function ekspor() {
    unduhCsv(
      `jurnal-umum-${r.mulai}_${r.selesai}.csv`,
      ['Tanggal', 'No', 'Proyek', 'Keterangan', 'Kode Akun', 'Nama Akun', 'Debet', 'Kredit'],
      baris.map((j: Jurnal) => [j.tgl, j.no, j.proyek, j.ket, j.akun, j.nama, j.D, j.K]),
    );
    toast.sukses('CSV jurnal berhasil diunduh.');
  }

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="card-pad flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="cari" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Cari nomor, keterangan, atau akun…"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
          />
        </div>

        <select className="input w-auto" value={akunFilter} onChange={(e) => setAkunFilter(e.target.value)}>
          <option value="">Semua akun</option>
          {COA.map((a) => (
            <option key={a.kode} value={a.kode}>
              {a.kode} — {a.nama}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-slate-600">
          <input
            type="checkbox"
            checked={tampilkanSemuaPeriode}
            onChange={(e) => setTampilkanSemuaPeriode(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Abaikan filter periode
        </label>

        <button className="btn-ghost px-3 py-1.5 text-[11px]" onClick={ekspor}>
          <Icon name="unduh" className="h-3.5 w-3.5" /> Ekspor CSV
        </button>
      </div>

      <Panel
        judul={`Jurnal Umum — ${baris.length} baris ${
          tampilkanSemuaPeriode ? '(semua periode)' : `(${labelPeriodeRingkas(periode)})`
        }`}
        ikon="buku"
        padat
        aksi={
          <span className={`chip ${seimbang ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {seimbang ? '✓ Debet = Kredit' : '⚠ Debet ≠ Kredit'}
          </span>
        }
      >
        {baris.length === 0 ? (
          <Kosong pesan="Tidak ada jurnal pada filter ini." ikon="buku" />
        ) : (
          <div className="thin-scroll max-h-[68vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Tgl</th>
                  <th>No</th>
                  <th>Proyek</th>
                  <th>Keterangan</th>
                  <th>Kode</th>
                  <th>Nama Akun</th>
                  <th className="text-right">Debet</th>
                  <th className="text-right">Kredit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {baris.map((j, i) => (
                  <tr key={j.id ?? `${j.no}-${i}`}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(j.tgl)}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-blue-600">
                      {j.no}
                    </td>
                    <td>
                      <TagProyek id={j.proyek} />
                    </td>
                    <td className="max-w-[220px] truncate text-slate-500" title={j.ket}>
                      {j.ket}
                    </td>
                    <td className="font-mono text-[10.5px] text-slate-400">{j.akun}</td>
                    <td className="text-[11.5px]">{getAkun(j.akun)?.nama ?? j.nama}</td>
                    <td className="num text-emerald-600">{j.D > 0 ? fmt(j.D) : '-'}</td>
                    <td className="num text-amber-600">{j.K > 0 ? fmt(j.K) : '-'}</td>
                    <td>
                      <button
                        onClick={() => void hapus(j.no)}
                        className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                        aria-label={`Hapus jurnal ${j.no}`}
                      >
                        <Icon name="sampah" className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100">
                  <td colSpan={6} className="px-3 py-2.5 text-right text-[11.5px] font-bold text-slate-700">
                    TOTAL
                  </td>
                  <td className="num px-3 py-2.5 font-bold text-emerald-600">{fmt(totalD)}</td>
                  <td className="num px-3 py-2.5 font-bold text-amber-600">{fmt(totalK)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
