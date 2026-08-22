'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah, PilihProyek, TagProyek, TagStatusAset } from '@/components/ui/Form';
import { fmt, rupiah } from '@/lib/format';
import { TIPE_PROPERTI } from '@/lib/transaksi';
import { sbDelete, sbInsert } from '@/lib/supabase';
import type { Aset } from '@/types';

export default function HalamanAset() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiAset />
    </GuardHalaman>
  );
}

function IsiAset() {
  const { aset, memuat, galat, muatUlang, setAset } = useData();
  const { proyek: filterAktif } = usePeriode();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);

  useJudul({ judul: 'Aset & Unit Properti', deskripsi: 'Master data unit yang dijual' });

  const [proyek, setProyek] = useState(filterAktif !== 'ALL' ? filterAktif : 'AFP');
  const [tipe, setTipe] = useState(TIPE_PROPERTI[0]);
  const [blok, setBlok] = useState('');
  const [luas, setLuas] = useState('');
  const [harga, setHarga] = useState(0);
  const [ket, setKet] = useState('');

  const daftar = useMemo(
    () => (filterAktif === 'ALL' ? aset : aset.filter((a) => a.proyek === filterAktif)),
    [aset, filterAktif],
  );

  const stat = useMemo(
    () => ({
      tersedia: daftar.filter((a) => a.status === 'tersedia').length,
      dp: daftar.filter((a) => a.status === 'dp').length,
      terjual: daftar.filter((a) => a.status === 'terjual').length,
      nilaiTersedia: daftar
        .filter((a) => a.status === 'tersedia')
        .reduce((s, a) => s + (Number(a.harga) || 0), 0),
    }),
    [daftar],
  );

  async function simpan() {
    if (!blok || !harga) {
      toast.galat('Lengkapi nama unit dan harga!');
      return;
    }
    setSibuk('Menyimpan aset…');
    try {
      const baris = await sbInsert<Aset>('aset', [
        {
          proyek,
          tipe,
          blok,
          luas: Number(luas) || 0,
          harga,
          status: 'tersedia',
          pembeli: '',
          ket,
        },
      ]);
      setAset((sebelum) => [...sebelum, ...baris]);
      toast.sukses(`Aset ${blok} berhasil didaftarkan!`);
      setBlok('');
      setLuas('');
      setHarga(0);
      setKet('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function hapus(id: number) {
    if (!window.confirm('Hapus aset ini?')) return;
    setSibuk('Menghapus…');
    try {
      await sbDelete('aset', id);
      setAset((sebelum) => sebelum.filter((a) => a.id !== id));
      toast.sukses('Aset dihapus.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel judul="Daftarkan Unit Properti" ikon="rumah">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang label="Proyek" anak={<PilihProyek id="ast-proyek" nilai={proyek} onUbah={setProyek} />} />
          <Bidang
            label="Tipe Properti"
            anak={
              <select className="input" value={tipe} onChange={(e) => setTipe(e.target.value)}>
                {TIPE_PROPERTI.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Nama Unit / Blok"
            anak={
              <input
                className="input"
                placeholder="Mis: Blok A1, Unit B-02"
                value={blok}
                onChange={(e) => setBlok(e.target.value)}
              />
            }
          />
          <Bidang
            label="Luas Bangunan (m²)"
            anak={
              <input
                className="input"
                type="number"
                placeholder="36"
                value={luas}
                onChange={(e) => setLuas(e.target.value)}
              />
            }
          />
          <Bidang label="Harga Jual" span anak={<InputRupiah id="ast-harga" nilai={harga} onUbah={setHarga} />} />
          <Bidang
            label="Keterangan"
            span
            anak={
              <input
                className="input"
                placeholder="Spesifikasi, lokasi, dll…"
                value={ket}
                onChange={(e) => setKet(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-amber mt-4 w-full" onClick={() => void simpan()}>
          <Icon name="plus" className="h-4 w-4" /> Daftarkan Aset
        </button>
      </Panel>

      <Panel judul={`Daftar Aset — ${daftar.length} unit`} ikon="rumah" padat>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-[11px]">
          <span className="chip bg-emerald-100 text-emerald-700">Tersedia {stat.tersedia}</span>
          <span className="chip bg-violet-100 text-violet-700">DP/Booking {stat.dp}</span>
          <span className="chip bg-rose-100 text-rose-700">Terjual {stat.terjual}</span>
          <span className="ml-auto text-slate-500">
            Nilai unit tersedia: <b className="text-emerald-600">{rupiah(stat.nilaiTersedia)}</b>
          </span>
        </div>

        {daftar.length === 0 ? (
          <Kosong pesan="Belum ada aset terdaftar." ikon="rumah" />
        ) : (
          <div className="thin-scroll max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Proyek</th>
                  <th>Tipe</th>
                  <th>Unit / Blok</th>
                  <th>Luas</th>
                  <th className="text-right">Harga</th>
                  <th>Status</th>
                  <th>Pembeli</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {daftar.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <TagProyek id={a.proyek} />
                    </td>
                    <td className="text-[11px] text-slate-500">{a.tipe ?? '-'}</td>
                    <td className="font-semibold text-slate-700">{a.blok}</td>
                    <td className="text-slate-500">{a.luas ? `${a.luas} m²` : '-'}</td>
                    <td className="num font-semibold text-blue-600">{fmt(a.harga)}</td>
                    <td>
                      <TagStatusAset status={a.status} />
                    </td>
                    <td className="text-[11px] text-slate-500">{a.pembeli || '-'}</td>
                    <td>
                      {a.status === 'tersedia' && a.id !== undefined ? (
                        <button
                          onClick={() => void hapus(a.id as number)}
                          className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                          aria-label={`Hapus aset ${a.blok}`}
                        >
                          <Icon name="sampah" className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
