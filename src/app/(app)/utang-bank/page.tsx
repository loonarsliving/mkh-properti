'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { usePeriode } from '@/components/shell/PeriodeProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah, PilihProyek, PilihRekening, TagProyek } from '@/components/ui/Form';
import { getProyek } from '@/lib/master';
import { fmt, rupiah, today } from '@/lib/format';
import { JENIS_UTANG, bayarUtangBank, simpanUtangBank } from '@/lib/transaksi';
import { sbDelete } from '@/lib/supabase';
import type { UtangBank } from '@/types';

export default function HalamanUtangBank() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiUtangBank />
    </GuardHalaman>
  );
}

function IsiUtangBank() {
  const { utangBank, memuat, galat, muatUlang, setUtangBank, tambahJurnal, jurnal } = useData();
  const { proyek: filterAktif } = usePeriode();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [tab, setTab] = useState<'tambah' | 'bayar'>('tambah');

  useJudul({ judul: 'Utang Bank', deskripsi: 'Pokok pinjaman, pembayaran, dan pemotongan otomatis' });

  // Form tambah utang
  const [proyek, setProyek] = useState(filterAktif !== 'ALL' ? filterAktif : 'AFP');
  const [jenis, setJenis] = useState(JENIS_UTANG[0]);
  const [bank, setBank] = useState('');
  const [noAkad, setNoAkad] = useState('');
  const [pokok, setPokok] = useState(0);
  const [potUnit, setPotUnit] = useState(0);
  const [tglAkad, setTglAkad] = useState('');
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [ket, setKet] = useState('');

  // Form bayar utang
  const [utangId, setUtangId] = useState('');
  const [bayarTgl, setBayarTgl] = useState(today());
  const [bayarNo, setBayarNo] = useState('');
  const [bayarNominal, setBayarNominal] = useState(0);
  const [bayarRek, setBayarRek] = useState('1-1001');
  const [bayarKet, setBayarKet] = useState('');

  const daftar = useMemo(
    () => (filterAktif === 'ALL' ? utangBank : utangBank.filter((u) => u.proyek === filterAktif)),
    [utangBank, filterAktif],
  );

  const total = useMemo(
    () => ({
      pokok: daftar.reduce((s, u) => s + u.pokok, 0),
      terbayar: daftar.reduce((s, u) => s + (u.terbayar || 0), 0),
      sisa: daftar.reduce((s, u) => s + Math.max(0, u.pokok - (u.terbayar || 0)), 0),
    }),
    [daftar],
  );

  const utangAktif = useMemo(
    () => utangBank.filter((u) => u.pokok - (u.terbayar || 0) > 0),
    [utangBank],
  );

  async function simpanBaru() {
    if (!proyek || !pokok || !bank) {
      toast.galat('Lengkapi proyek, bank, dan pokok pinjaman!');
      return;
    }
    setSibuk('Menyimpan utang bank…');
    try {
      const hasil = await simpanUtangBank({
        proyek,
        jenis,
        bank,
        noAkad,
        pokok,
        potonganPerUnit: potUnit,
        tglAkad,
        jatuhTempo,
        ket,
        jumlahUtangSaatIni: utangBank.length,
      });
      setUtangBank((sebelum) => [
        ...sebelum,
        ...hasil.utang.map((u) => ({
          ...u,
          pokok: Number(u.pokok) || 0,
          potongan_per_unit: Number(u.potongan_per_unit) || 0,
          terbayar: Number(u.terbayar) || 0,
        })),
      ]);
      tambahJurnal(hasil.baris);
      toast.sukses(`Utang ${bank} ${rupiah(pokok)} berhasil dicatat!`);
      setBank('');
      setNoAkad('');
      setPokok(0);
      setPotUnit(0);
      setTglAkad('');
      setJatuhTempo('');
      setKet('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function bayar() {
    const ub = utangBank.find((u) => String(u.id) === utangId);
    if (!ub) {
      toast.galat('Pilih utang yang akan dibayar.');
      return;
    }
    if (!bayarNominal || !bayarTgl || !bayarNo) {
      toast.galat('Lengkapi semua field pembayaran!');
      return;
    }
    const sisa = ub.pokok - (ub.terbayar || 0);
    if (bayarNominal > sisa) {
      toast.galat(`Pembayaran melebihi sisa utang ${rupiah(sisa)}!`);
      return;
    }

    setSibuk('Menyimpan pembayaran…');
    try {
      const baris = await bayarUtangBank({
        utang: ub,
        tgl: bayarTgl,
        no: bayarNo,
        nominal: bayarNominal,
        rekening: bayarRek,
        ket: bayarKet,
      });
      tambahJurnal(baris);
      const terbayarBaru = (ub.terbayar || 0) + bayarNominal;
      setUtangBank((sebelum) =>
        sebelum.map((u) => (u.id === ub.id ? { ...u, terbayar: terbayarBaru } : u)),
      );
      toast.sukses(
        `Pembayaran ${rupiah(bayarNominal)} tercatat. Sisa utang ${rupiah(ub.pokok - terbayarBaru)}.`,
      );
      setBayarNominal(0);
      setBayarNo('');
      setBayarKet('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function hapus(id: number) {
    if (!window.confirm('Hapus data utang ini? Jurnal terkait tidak ikut terhapus.')) return;
    setSibuk('Menghapus…');
    try {
      await sbDelete('utang_bank', id);
      setUtangBank((sebelum) => sebelum.filter((u) => u.id !== id));
      toast.info('Data utang dihapus.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  const utangDipilih: UtangBank | undefined = utangBank.find((u) => String(u.id) === utangId);
  const jumlahPotonganOtomatis = jurnal.filter((j) => j.no?.startsWith('APT-')).length;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]">
        <Panel
          judul={tab === 'tambah' ? 'Catat Utang Bank Baru' : 'Bayar Utang Bank'}
          ikon="bank"
          aksi={
            <div className="flex gap-1">
              <button
                onClick={() => setTab('tambah')}
                className={`btn-xs ${tab === 'tambah' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                Tambah
              </button>
              <button
                onClick={() => setTab('bayar')}
                className={`btn-xs ${tab === 'bayar' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                Bayar
              </button>
            </div>
          }
        >
          {tab === 'tambah' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Bidang label="Proyek" anak={<PilihProyek id="ub-proyek" nilai={proyek} onUbah={setProyek} />} />
                <Bidang
                  label="Jenis Utang"
                  anak={
                    <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                      {JENIS_UTANG.map((j) => (
                        <option key={j}>{j}</option>
                      ))}
                    </select>
                  }
                />
                <Bidang
                  label="Nama Bank"
                  anak={
                    <input
                      className="input"
                      placeholder="BSI, BRI, BNI, dll"
                      value={bank}
                      onChange={(e) => setBank(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="No. Rekening / Akad"
                  anak={
                    <input
                      className="input"
                      placeholder="No akad pinjaman"
                      value={noAkad}
                      onChange={(e) => setNoAkad(e.target.value)}
                    />
                  }
                />
                <Bidang label="Pokok Pinjaman" anak={<InputRupiah id="ub-pokok" nilai={pokok} onUbah={setPokok} />} />
                <Bidang
                  label="Potongan per Unit Terjual"
                  bantuan="Dipotong otomatis tiap penjualan rumah."
                  anak={<InputRupiah id="ub-potunit" nilai={potUnit} onUbah={setPotUnit} />}
                />
                <Bidang
                  label="Tanggal Akad"
                  anak={
                    <input
                      type="date"
                      className="input"
                      value={tglAkad}
                      onChange={(e) => setTglAkad(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Jatuh Tempo"
                  anak={
                    <input
                      type="date"
                      className="input"
                      value={jatuhTempo}
                      onChange={(e) => setJatuhTempo(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Keterangan"
                  span
                  anak={
                    <input
                      className="input"
                      placeholder="Keterangan tambahan"
                      value={ket}
                      onChange={(e) => setKet(e.target.value)}
                    />
                  }
                />
              </div>
              <button className="btn-amber mt-4 w-full" onClick={() => void simpanBaru()}>
                <Icon name="plus" className="h-4 w-4" /> Catat Utang Bank
              </button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Bidang
                  label="Pilih Utang"
                  span
                  anak={
                    <select className="input" value={utangId} onChange={(e) => setUtangId(e.target.value)}>
                      <option value="">— Pilih utang —</option>
                      {utangAktif.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          [{u.proyek}] {u.bank} — sisa {rupiah(u.pokok - (u.terbayar || 0))}
                        </option>
                      ))}
                    </select>
                  }
                />
                <Bidang
                  label="Tanggal"
                  anak={
                    <input
                      type="date"
                      className="input"
                      value={bayarTgl}
                      onChange={(e) => setBayarTgl(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="No. Transaksi"
                  anak={
                    <input
                      className="input"
                      placeholder="BYR-001"
                      value={bayarNo}
                      onChange={(e) => setBayarNo(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Nominal"
                  bantuan={
                    utangDipilih
                      ? `Sisa utang: ${rupiah(utangDipilih.pokok - (utangDipilih.terbayar || 0))}`
                      : undefined
                  }
                  anak={<InputRupiah id="pay-nominal" nilai={bayarNominal} onUbah={setBayarNominal} />}
                />
                <Bidang
                  label="Rekening Sumber"
                  anak={<PilihRekening id="pay-rek" nilai={bayarRek} onUbah={setBayarRek} />}
                />
                <Bidang
                  label="Keterangan"
                  span
                  anak={
                    <input
                      className="input"
                      placeholder="Opsional…"
                      value={bayarKet}
                      onChange={(e) => setBayarKet(e.target.value)}
                    />
                  }
                />
              </div>
              <button className="btn-primary mt-4 w-full" onClick={() => void bayar()}>
                <Icon name="kas-keluar" className="h-4 w-4" /> Simpan Pembayaran
              </button>
            </>
          )}
        </Panel>

        <Panel judul="Pemotongan Otomatis" ikon="info">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-[12px] leading-relaxed text-emerald-900">
            <p className="mb-2 font-bold">⚡ Aktif</p>
            <p>
              Setiap transaksi <b>Penjualan Rumah</b> di menu Kas Masuk otomatis memotong utang bank
              proyek terkait sebesar nilai <b>Potongan per Unit</b> yang sudah disetel. Tidak perlu
              input pembayaran manual untuk potongan ini.
            </p>
            <p className="mt-2 font-mono text-[11px]">
              Riwayat potongan tercatat di Jurnal dengan prefix <b>APT-</b> ({jumlahPotonganOtomatis}{' '}
              baris tercatat).
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="label-mono">Total Pokok</div>
              <div className="text-[15px] font-bold text-slate-700">{rupiah(total.pokok)}</div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="label-mono">Total Terbayar</div>
              <div className="text-[15px] font-bold text-emerald-600">{rupiah(total.terbayar)}</div>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <div className="label-mono">Total Sisa Utang</div>
              <div className="text-[15px] font-bold text-rose-600">{rupiah(total.sisa)}</div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel
        judul={`Daftar Utang Bank${filterAktif !== 'ALL' ? ` — ${getProyek(filterAktif).nama}` : ''}`}
        ikon="bank"
        padat
      >
        {daftar.length === 0 ? (
          <Kosong pesan="Belum ada utang bank tercatat." ikon="bank" />
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Proyek</th>
                  <th>Jenis</th>
                  <th>Bank</th>
                  <th className="text-right">Pokok</th>
                  <th className="text-right">Terbayar</th>
                  <th className="text-right">Sisa</th>
                  <th className="text-right">Pot/Unit</th>
                  <th>Progress</th>
                  <th>J. Tempo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {daftar.map((u) => {
                  const sisa = u.pokok - (u.terbayar || 0);
                  const pct = u.pokok > 0 ? Math.min(100, ((u.terbayar || 0) / u.pokok) * 100) : 0;
                  const lunas = sisa <= 0;
                  return (
                    <tr key={u.id}>
                      <td>
                        <TagProyek id={u.proyek} />
                      </td>
                      <td className="text-[11px]">{u.jenis || '-'}</td>
                      <td className="text-[11px] font-semibold">{u.bank || '-'}</td>
                      <td className="num">{fmt(u.pokok)}</td>
                      <td className="num text-emerald-600">{fmt(u.terbayar || 0)}</td>
                      <td className={`num font-semibold ${lunas ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {lunas ? '✓ LUNAS' : fmt(sisa)}
                      </td>
                      <td className="num text-amber-600">{fmt(u.potongan_per_unit || 0)}</td>
                      <td className="min-w-[110px]">
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full rounded-full ${lunas ? 'bg-emerald-500' : 'bg-amber-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] text-slate-400">{pct.toFixed(1)}%</div>
                      </td>
                      <td className="font-mono text-[10px] text-slate-500">{u.jt_tempo || '-'}</td>
                      <td>
                        {u.id !== undefined ? (
                          <button
                            onClick={() => void hapus(u.id as number)}
                            className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                            aria-label={`Hapus utang ${u.bank}`}
                          >
                            <Icon name="sampah" className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
