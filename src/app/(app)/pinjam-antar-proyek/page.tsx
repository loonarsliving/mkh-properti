'use client';

import { useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah, PilihProyek } from '@/components/ui/Form';
import { AKUN_KAS, REK_COA, getProyek } from '@/lib/master';
import { hitungSaldo, jurnalSampai, saldoAkun } from '@/lib/akuntansi/saldo';
import { fmt, rupiah, tanggalPendek, today } from '@/lib/format';
import { nomorBerikutnya, simpanPinjamAntarProyek } from '@/lib/transaksi';

export default function HalamanPinjamAntarProyek() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiPinjam />
    </GuardHalaman>
  );
}

function IsiPinjam() {
  const { jurnal, memuat, galat, muatUlang, tambahJurnal } = useData();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);

  useJudul({
    judul: 'Pinjam Antar Proyek',
    deskripsi: 'Mutasi dana antar proyek — otomatis mencatat piutang & utang antar proyek',
  });

  const [tgl, setTgl] = useState(today());
  const [no, setNo] = useState('');
  const [dari, setDari] = useState('AFP');
  const [ke, setKe] = useState('IH');
  const [nominal, setNominal] = useState(0);
  const [ket, setKet] = useState('');

  const peta = useMemo(() => hitungSaldo(jurnalSampai(jurnal, today())), [jurnal]);
  // Proyek HO tidak punya rekening bank sendiri — saldonya adalah kas tunai.
  const saldoDari = useMemo(() => saldoAkun(REK_COA[dari] ?? '1-1001', peta), [peta, dari]);
  const totalKasPerusahaan = useMemo(
    () => AKUN_KAS.reduce((s, k) => s + saldoAkun(k, peta), 0),
    [peta],
  );

  const riwayat = useMemo(
    () => jurnal.filter((j) => j.no?.startsWith('PAP') && j.akun === '1-1006').reverse(),
    [jurnal],
  );

  async function simpan() {
    if (!tgl || !no || !nominal) {
      toast.galat('Lengkapi semua field!');
      return;
    }
    if (dari === ke) {
      toast.galat('Proyek asal dan tujuan tidak boleh sama!');
      return;
    }
    setSibuk('Menyimpan pinjaman…');
    try {
      const baris = await simpanPinjamAntarProyek({ tgl, no, dari, ke, nominal, ket });
      tambahJurnal(baris);
      toast.sukses(
        `Pinjaman ${rupiah(nominal)} dari ${getProyek(dari).nama} ke ${getProyek(ke).nama} tersimpan!`,
      );
      setNominal(0);
      setKet('');
      setNo('');
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

      <Panel judul="Catat Pinjaman Antar Proyek" ikon="transfer">
        <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-[11px] leading-relaxed text-violet-800">
          Satu transaksi menghasilkan empat baris jurnal: <b>Piutang Antar Proyek</b> dan
          pengurangan bank di proyek pemberi, serta penambahan bank dan <b>Utang Antar Proyek</b> di
          proyek penerima.
        </div>

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
                  placeholder="PAP-001"
                  value={no}
                  onChange={(e) => setNo(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2.5 py-1 text-[11px]"
                  onClick={() => setNo(nomorBerikutnya(jurnal, 'PAP'))}
                >
                  Auto
                </button>
              </div>
            }
          />
          <Bidang
            label="Dana DARI Proyek"
            bantuan={`Saldo bank proyek: ${rupiah(saldoDari)}`}
            anak={<PilihProyek id="pap-dari" nilai={dari} onUbah={setDari} />}
          />
          <Bidang label="Dana KE Proyek" anak={<PilihProyek id="pap-ke" nilai={ke} onUbah={setKe} />} />
          <Bidang label="Nominal" span anak={<InputRupiah id="pap-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Keterangan"
            span
            anak={
              <input
                className="input"
                placeholder="Alasan peminjaman…"
                value={ket}
                onChange={(e) => setKet(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-primary mt-4 w-full" onClick={() => void simpan()}>
          <Icon name="transfer" className="h-4 w-4" /> Catat Pinjaman
        </button>

        <p className="mt-3 font-mono text-[10px] text-slate-400">
          Total kas &amp; bank perusahaan saat ini: {rupiah(totalKasPerusahaan)}
        </p>
      </Panel>

      <Panel judul={`Riwayat Pinjaman — ${riwayat.length} transaksi`} ikon="buku" padat>
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada pinjaman antar proyek." />
        ) : (
          <div className="thin-scroll max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Tgl</th>
                  <th>No</th>
                  <th>Keterangan</th>
                  <th className="text-right">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((j, i) => (
                  <tr key={j.id ?? `${j.no}-${i}`}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(j.tgl)}
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px] font-semibold text-violet-600">
                      {j.no}
                    </td>
                    <td className="text-slate-500">{j.ket}</td>
                    <td className="num font-semibold text-violet-600">Rp {fmt(j.D)}</td>
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
