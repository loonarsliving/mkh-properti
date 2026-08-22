'use client';

import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { COA } from '@/lib/master';
import type { KategoriAkun } from '@/types';

const KATEGORI: KategoriAkun[] = [
  'Aset Lancar',
  'Aset Tetap',
  'Liabilitas Lancar',
  'Liabilitas Panjang',
  'Ekuitas',
  'Pendapatan',
  'HPP',
  'Beban Operasional',
];

export default function HalamanCoa() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiCoa />
    </GuardHalaman>
  );
}

function IsiCoa() {
  useJudul({
    judul: 'Bagan Akun (Chart of Accounts)',
    deskripsi: `${COA.length} akun — kode akun inilah yang tersimpan di kolom jurnal.akun`,
    tampilkanFilter: false,
  });

  return (
    <div className="space-y-4">
      <div className="card-pad border-amber-200 bg-amber-50 text-[11.5px] leading-relaxed text-amber-900">
        Kode akun tidak boleh diubah — nilainya sudah tersimpan di ribuan baris jurnal yang ada.
        Kolom <b>Nama Operasional</b> dipakai di layar transaksi harian, sedangkan{' '}
        <b>Nama Laporan</b> dipakai saat penyajian laporan keuangan SAK EMKM.
      </div>

      {KATEGORI.map((kat) => {
        const akun = COA.filter((a) => a.kat === kat);
        if (akun.length === 0) return null;
        return (
          <Panel key={kat} judul={kat} ikon="coa" padat>
            <div className="thin-scroll overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-24">Kode</th>
                    <th>Nama Operasional</th>
                    <th>Nama Laporan (SAK EMKM)</th>
                    <th>No. Rekening</th>
                    <th className="w-24">Saldo Normal</th>
                  </tr>
                </thead>
                <tbody>
                  {akun.map((a) => (
                    <tr key={a.kode}>
                      <td className="font-mono text-[11px] font-semibold text-blue-600">{a.kode}</td>
                      <td className="font-medium text-slate-700">{a.nama}</td>
                      <td className="text-slate-500">{a.namaLaporan}</td>
                      <td className="font-mono text-[10.5px] text-slate-400">{a.rek ?? '-'}</td>
                      <td>
                        <span
                          className={`chip ${
                            a.tipe === 'D'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {a.tipe === 'D' ? 'Debet' : 'Kredit'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
