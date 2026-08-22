'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah, PilihProyek, PilihRekening, TagProyek } from '@/components/ui/Form';
import { REK_COA, getAkun } from '@/lib/master';
import { fmt, rupiah, tanggalPendek, today } from '@/lib/format';
import { JENIS_KAS_KELUAR, akunBeban, nomorBerikutnya, simpanKasKeluar } from '@/lib/transaksi';
import { sbDeleteWhere } from '@/lib/supabase';

export default function HalamanKasKeluar() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiKasKeluar />
    </GuardHalaman>
  );
}

function IsiKasKeluar() {
  const { jurnal, memuat, galat, muatUlang, tambahJurnal, hapusJurnalNo } = useData();
  const { proyek: filterProyekAktif } = usePeriode();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);

  useJudul({ judul: 'Kas Keluar', deskripsi: 'Pengeluaran material, distributor & operasional' });

  const proyekAwal = filterProyekAktif !== 'ALL' ? filterProyekAktif : 'AFP';
  const [tgl, setTgl] = useState(today());
  const [no, setNo] = useState('');
  const [proyek, setProyek] = useState(proyekAwal);
  const [rekening, setRekening] = useState(REK_COA[proyekAwal] ?? '1-1001');
  const [jenis, setJenis] = useState(JENIS_KAS_KELUAR[0]);
  const [supplier, setSupplier] = useState('');
  const [nominal, setNominal] = useState(0);
  const [ket, setKet] = useState('');

  const riwayat = useMemo(
    () => jurnal.filter((j) => j.no?.startsWith('KK') && j.D > 0).reverse(),
    [jurnal],
  );
  const akunTujuan = getAkun(akunBeban(jenis));

  function gantiProyek(v: string) {
    setProyek(v);
    setRekening(REK_COA[v] ?? '1-1001');
  }

  async function simpan() {
    if (!tgl || !no || !nominal) {
      toast.galat('Lengkapi tanggal, no transaksi, dan nominal!');
      return;
    }
    setSibuk('Menyimpan kas keluar…');
    try {
      const baris = await simpanKasKeluar({ tgl, no, proyek, rekening, jenis, supplier, nominal, ket });
      tambahJurnal(baris);
      toast.sukses(`Kas keluar ${rupiah(nominal)} berhasil disimpan!`);
      setNominal(0);
      setSupplier('');
      setKet('');
      setNo('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function hapus(nomor: string) {
    if (!window.confirm(`Hapus semua jurnal dengan no ${nomor}?`)) return;
    setSibuk('Menghapus jurnal…');
    try {
      await sbDeleteWhere('jurnal', `no=eq.${encodeURIComponent(nomor)}`);
      hapusJurnalNo(nomor);
      toast.sukses('Jurnal dihapus.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel judul="Input Kas Keluar" ikon="kas-keluar">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Tanggal"
            anak={<input type="date" className="input" value={tgl} onChange={(e) => setTgl(e.target.value)} />}
          />
          <Bidang
            label="No. Transaksi"
            anak={
              <div className="flex gap-1.5">
                <input
                  className="input"
                  placeholder="KK-001"
                  value={no}
                  onChange={(e) => setNo(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2.5 py-1 text-[11px]"
                  onClick={() => setNo(nomorBerikutnya(jurnal, 'KK'))}
                >
                  Auto
                </button>
              </div>
            }
          />
          <Bidang label="Proyek" anak={<PilihProyek id="kk-proyek" nilai={proyek} onUbah={gantiProyek} />} />
          <Bidang
            label="Rekening Sumber"
            anak={<PilihRekening id="kk-rek" nilai={rekening} onUbah={setRekening} />}
          />
          <Bidang
            label="Jenis Pengeluaran"
            bantuan={akunTujuan ? `Dibukukan ke akun ${akunTujuan.kode} — ${akunTujuan.nama}` : undefined}
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_KAS_KELUAR.map((j) => (
                  <option key={j}>{j}</option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Supplier / Distributor"
            anak={
              <input
                className="input"
                placeholder="Nama supplier / vendor"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            }
          />
          <Bidang label="Nominal" span anak={<InputRupiah id="kk-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Keterangan"
            span
            anak={
              <input
                className="input"
                placeholder="Detail barang / pekerjaan…"
                value={ket}
                onChange={(e) => setKet(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-danger mt-4 w-full" onClick={() => void simpan()}>
          <Icon name="kas-keluar" className="h-4 w-4" /> Simpan Kas Keluar
        </button>
      </Panel>

      <Panel judul={`Riwayat Kas Keluar — ${riwayat.length} transaksi`} ikon="buku" padat>
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada kas keluar tercatat." />
        ) : (
          <div className="thin-scroll max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Tgl</th>
                  <th>No</th>
                  <th>Proyek</th>
                  <th>Keterangan</th>
                  <th className="text-right">Nominal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {riwayat.map((j, i) => (
                  <tr key={j.id ?? `${j.no}-${i}`}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(j.tgl)}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-rose-600">
                      {j.no}
                    </td>
                    <td>
                      <TagProyek id={j.proyek} />
                    </td>
                    <td className="max-w-[260px] truncate text-slate-500" title={j.ket}>
                      {j.ket}
                    </td>
                    <td className="num font-semibold text-rose-600">Rp {fmt(j.D)}</td>
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
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
