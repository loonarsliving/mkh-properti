'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Memuat, PesanGalat } from '@/components/ui/Umum';
import { LembarLaporan, type PilihanLaporan } from '@/components/laporan/LembarLaporan';
import { susunLaporan } from '@/lib/akuntansi/sak-emkm';
import { filterProyek as saringProyek } from '@/lib/akuntansi/saldo';
import { InputRupiah } from '@/components/ui/Form';
import { labelPeriodeRingkas } from '@/lib/periode';
import { getProyek } from '@/lib/master';

export default function HalamanLaporanKeuangan() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiLaporanKeuangan />
    </GuardHalaman>
  );
}

function IsiLaporanKeuangan() {
  const { jurnal, memuat, galat, muatUlang } = useData();
  const { periode, proyek } = usePeriode();

  useJudul({
    judul: 'Laporan Keuangan SAK EMKM',
    deskripsi: 'Siap cetak — pilih periode di atas, lalu cetak atau simpan sebagai PDF',
  });

  const [direktur, setDirektur] = useState('');
  const [akuntan, setAkuntan] = useState('');
  const [kota, setKota] = useState('Kendari');
  const [bebanPajak, setBebanPajak] = useState(0);
  const [pilihan, setPilihan] = useState<PilihanLaporan>({
    posisiKeuangan: true,
    labaRugi: true,
    calk: true,
    perubahanEkuitas: false,
    arusKas: false,
  });

  const laporan = useMemo(
    () => susunLaporan(saringProyek(jurnal, proyek), periode, { bebanPajak }),
    [jurnal, proyek, periode, bebanPajak],
  );

  if (memuat) return <Memuat pesan="Menyusun laporan keuangan…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const ubahPilihan = (k: keyof PilihanLaporan) =>
    setPilihan((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      {/* Panel pengaturan — tidak ikut tercetak */}
      <div className="no-print space-y-3">
        <div className="card-pad">
          <h2 className="section-title">
            <Icon name="printer" className="h-4 w-4" /> Pengaturan Laporan
          </h2>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label" htmlFor="lk-dir">
                Nama Direktur Utama
              </label>
              <input
                id="lk-dir"
                className="input"
                placeholder="Nama penanda tangan"
                value={direktur}
                onChange={(e) => setDirektur(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lk-akt">
                Nama Akuntan / Penyusun
              </label>
              <input
                id="lk-akt"
                className="input"
                placeholder="Nama penyusun"
                value={akuntan}
                onChange={(e) => setAkuntan(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lk-kota">
                Kota Penandatanganan
              </label>
              <input
                id="lk-kota"
                className="input"
                value={kota}
                onChange={(e) => setKota(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="lk-pajak">
                Beban Pajak Penghasilan
              </label>
              <InputRupiah id="lk-pajak" nilai={bebanPajak} onUbah={setBebanPajak} />
              <p className="mt-1 text-[10px] text-slate-400">
                Diisi manual. Nilainya juga muncul sebagai utang pajak di neraca agar tetap seimbang.
              </p>
            </div>
          </div>
        </div>

        <div className="card-pad">
          <h2 className="section-title">Laporan yang Disertakan</h2>

          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-900">
            SAK EMKM mewajibkan <b>tiga</b> laporan saja: Laporan Posisi Keuangan, Laporan Laba Rugi,
            dan Catatan atas Laporan Keuangan. Laporan Perubahan Ekuitas dan Arus Kas{' '}
            <b>bukan syarat SAK EMKM</b> (itu ketentuan SAK ETAP), tetapi tetap disediakan untuk
            kebutuhan internal atau permintaan bank.
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                ['posisiKeuangan', 'Posisi Keuangan (wajib)'],
                ['labaRugi', 'Laba Rugi (wajib)'],
                ['calk', 'Catatan atas Laporan Keuangan (wajib)'],
                ['perubahanEkuitas', 'Perubahan Ekuitas (tambahan)'],
                ['arusKas', 'Arus Kas (tambahan)'],
              ] as [keyof PilihanLaporan, string][]
            ).map(([kunci, label]) => (
              <button
                key={kunci}
                type="button"
                onClick={() => ubahPilihan(kunci)}
                className={`btn-xs ${
                  pilihan[kunci] ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {pilihan[kunci] ? '✓ ' : ''}
                {label}
              </button>
            ))}
          </div>

          {laporan.akunAsing.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
              <b>Ada akun yang dipakai di jurnal tapi belum terdaftar di COA aplikasi.</b> Nilainya
              tetap ikut dihitung (dikelompokkan dari digit pertama kode akun), jadi neraca tidak
              timpang — tetapi labelnya seadanya. Akun ini biasanya berasal dari sistem lain
              (mkhsistem) lewat <code>sync_inbound</code>. Sebaiknya daftarkan kodenya di{' '}
              <code>src/lib/master.ts</code>:
              <ul className="mt-1.5 list-inside list-disc font-mono text-[10.5px]">
                {laporan.akunAsing.map((a) => (
                  <li key={a.kode}>
                    {a.kode} — {a.nama}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3">
            <button className="btn-amber" onClick={() => window.print()}>
              <Icon name="printer" className="h-4 w-4" /> Cetak / Simpan PDF
            </button>
            <span className="font-mono text-[10.5px] text-slate-500">
              Periode {labelPeriodeRingkas(periode)} · {laporan.jumlahTransaksi} baris jurnal ·{' '}
              {proyek === 'ALL' ? 'Semua proyek' : getProyek(proyek).nama}
            </span>
            {laporan.akunAsing.length > 0 ? (
              <span
                className="chip bg-amber-100 text-amber-800"
                title={laporan.akunAsing.map((a) => `${a.kode} — ${a.nama}`).join('\n')}
              >
                ⚠ {laporan.akunAsing.length} akun di luar COA
              </span>
            ) : null}
            {!laporan.posisiKeuangan.seimbang ? (
              <span className="chip bg-rose-100 text-rose-700">
                ⚠ Neraca belum seimbang — periksa jurnal
              </span>
            ) : (
              <span className="chip bg-emerald-100 text-emerald-700">✓ Neraca seimbang</span>
            )}
          </div>
        </div>
      </div>

      {/* Lembar laporan siap cetak */}
      <LembarLaporan
        laporan={laporan}
        pilihan={pilihan}
        direktur={direktur}
        akuntan={akuntan}
        kota={kota}
        lingkupProyek={proyek === 'ALL' ? null : getProyek(proyek).nama}
      />
    </div>
  );
}
