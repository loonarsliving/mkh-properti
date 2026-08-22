'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah, PilihProyek, PilihRekening, TagProyek } from '@/components/ui/Form';
import { REK_COA } from '@/lib/master';
import { fmt, rupiah, tanggalPendek, today } from '@/lib/format';
import { JENIS_KAS_MASUK, nomorBerikutnya, simpanKasMasuk } from '@/lib/transaksi';
import { sbDeleteWhere, sbUpdate } from '@/lib/supabase';

export default function HalamanKasMasuk() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiKasMasuk />
    </GuardHalaman>
  );
}

function IsiKasMasuk() {
  const { jurnal, aset, utangBank, memuat, galat, muatUlang, tambahJurnal, hapusJurnalNo, setAset, setUtangBank } =
    useData();
  const { proyek: filterProyekAktif } = usePeriode();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);

  useJudul({ judul: 'Kas Masuk', deskripsi: 'Pencatatan penerimaan kas & penjualan unit' });

  const proyekAwal = filterProyekAktif !== 'ALL' ? filterProyekAktif : 'AFP';
  const [tgl, setTgl] = useState(today());
  const [no, setNo] = useState('');
  const [proyek, setProyek] = useState(proyekAwal);
  const [rekening, setRekening] = useState(REK_COA[proyekAwal] ?? '1-1001');
  const [jenis, setJenis] = useState(JENIS_KAS_MASUK[0]);
  const [unitId, setUnitId] = useState('');
  const [pembeli, setPembeli] = useState('');
  const [nominal, setNominal] = useState(0);
  const [ket, setKet] = useState('');

  const unitTersedia = useMemo(() => aset.filter((a) => a.status !== 'terjual'), [aset]);
  const riwayat = useMemo(
    () => jurnal.filter((j) => j.no?.startsWith('KM') && j.D > 0).reverse(),
    [jurnal],
  );

  function gantiProyek(v: string) {
    setProyek(v);
    setRekening(REK_COA[v] ?? '1-1001');
  }

  async function simpan() {
    if (!tgl || !no || !nominal) {
      toast.galat('Lengkapi tanggal, no transaksi, dan nominal!');
      return;
    }
    setSibuk('Menyimpan kas masuk…');
    try {
      const unit = aset.find((a) => String(a.id) === unitId);
      const hasil = await simpanKasMasuk({
        tgl,
        no,
        proyek,
        rekening,
        jenis,
        pembeli,
        unitId,
        namaUnit: unit?.blok ?? '',
        nominal,
        ket,
        utangBank,
      });
      tambahJurnal(hasil.baris);

      // Perbarui status unit bila dipilih — perilaku sama dengan versi lama.
      if (unit?.id !== undefined) {
        const statusBaru = jenis === 'Penjualan Rumah' ? 'terjual' : 'dp';
        await sbUpdate('aset', unit.id, { status: statusBaru, pembeli, tgl_jual: tgl });
        setAset((sebelum) =>
          sebelum.map((a) =>
            a.id === unit.id ? { ...a, status: statusBaru, pembeli, tgl_jual: tgl } : a,
          ),
        );
      }

      if (hasil.utangDiperbarui.length > 0) {
        setUtangBank((sebelum) =>
          sebelum.map((u) => {
            const upd = hasil.utangDiperbarui.find((x) => x.id === u.id);
            return upd ? { ...u, terbayar: upd.terbayar } : u;
          }),
        );
      }

      if (hasil.potongan.length > 0) {
        const p = hasil.potongan[0];
        toast.info(
          `Kas masuk tersimpan. Utang ${p.bank} otomatis terpotong ${rupiah(p.potong)} — sisa ${rupiah(p.sisa)}.`,
        );
      } else {
        toast.sukses(`Kas masuk ${rupiah(nominal)} berhasil disimpan!`);
      }

      setNominal(0);
      setPembeli('');
      setKet('');
      setNo('');
      setUnitId('');
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

      <Panel judul="Input Kas Masuk" ikon="kas-masuk">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Tanggal"
            htmlFor="km-tgl"
            anak={
              <input
                id="km-tgl"
                type="date"
                className="input"
                value={tgl}
                onChange={(e) => setTgl(e.target.value)}
              />
            }
          />
          <Bidang
            label="No. Transaksi"
            htmlFor="km-no"
            anak={
              <div className="flex gap-1.5">
                <input
                  id="km-no"
                  className="input"
                  placeholder="KM-001"
                  value={no}
                  onChange={(e) => setNo(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2.5 py-1 text-[11px]"
                  onClick={() => setNo(nomorBerikutnya(jurnal, 'KM'))}
                >
                  Auto
                </button>
              </div>
            }
          />
          <Bidang
            label="Proyek"
            anak={<PilihProyek id="km-proyek" nilai={proyek} onUbah={gantiProyek} />}
          />
          <Bidang
            label="Rekening Tujuan"
            anak={<PilihRekening id="km-rek" nilai={rekening} onUbah={setRekening} />}
          />
          <Bidang
            label="Jenis Pemasukan"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_KAS_MASUK.map((j) => (
                  <option key={j}>{j}</option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Pilih Unit Aset"
            bantuan="Opsional — status unit ikut diperbarui."
            anak={
              <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">— Tidak terkait unit —</option>
                {unitTersedia.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    [{a.proyek}] {a.blok} — {rupiah(a.harga)}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Nama Pembeli"
            anak={
              <input
                className="input"
                placeholder="Nama pembeli / klien"
                value={pembeli}
                onChange={(e) => setPembeli(e.target.value)}
              />
            }
          />
          <Bidang label="Nominal" anak={<InputRupiah id="km-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Keterangan"
            span
            anak={
              <input
                className="input"
                placeholder="Opsional…"
                value={ket}
                onChange={(e) => setKet(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-green mt-4 w-full" onClick={() => void simpan()}>
          <Icon name="kas-masuk" className="h-4 w-4" /> Simpan Kas Masuk
        </button>

        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-800">
          Untuk jenis <b>Penjualan Rumah</b>, utang bank proyek terkait otomatis terpotong sesuai
          nilai <b>Potongan per Unit</b> yang disetel di menu Utang Bank. Potongan tercatat di jurnal
          dengan prefix <b>APT-</b>.
        </p>
      </Panel>

      <Panel judul={`Riwayat Kas Masuk — ${riwayat.length} transaksi`} ikon="buku" padat>
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada kas masuk tercatat." />
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
                    <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-emerald-600">
                      {j.no}
                    </td>
                    <td>
                      <TagProyek id={j.proyek} />
                    </td>
                    <td className="max-w-[260px] truncate text-slate-500" title={j.ket}>
                      {j.ket}
                    </td>
                    <td className="num font-semibold text-emerald-600">Rp {fmt(j.D)}</td>
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
