'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { useSesi } from '@/components/shell/SesiProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah } from '@/components/ui/Form';
import { Kwitansi, type DataKwitansi } from '@/components/laporan/Kwitansi';
import { REK_COA, PROYEK, getProyek } from '@/lib/master';
import { normalisasiJurnal } from '@/lib/akuntansi/saldo';
import { fmt, rupiah, tanggalPendek, today } from '@/lib/format';
import { sbInsert, sbQuery, sbRpc } from '@/lib/supabase';
import {
  AKUN_BAHAN,
  AKUN_KAS_KELUAR_UMUM,
  AKUN_PENDAPATAN,
  JENIS_BAHAN,
  JENIS_KAS_KELUAR_UMUM,
  JENIS_PENERIMAAN,
  akunPendapatanProyek,
  saldoKasProyek,
  totalBahan,
  totalPendapatan,
  totalTukang,
} from '@/lib/proyek-admin';
import type { Aset, BayarTukang, Jurnal, JurnalRow, TukangBorongan } from '@/types';

type Tab = 'dashboard' | 'kas-masuk' | 'bahan' | 'kas-keluar' | 'tukang' | 'laporan';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'kas-masuk', label: 'Kas Masuk' },
  { id: 'bahan', label: 'Pembelian Bahan' },
  { id: 'kas-keluar', label: 'Kas Keluar Umum' },
  { id: 'tukang', label: 'Tukang / Kontraktor' },
  { id: 'laporan', label: 'Laporan Proyek' },
];

export default function HalamanAdminProyek() {
  return (
    <GuardHalaman izinkan={['cfo', 'admin-proyek']}>
      <IsiAdminProyek />
    </GuardHalaman>
  );
}

function IsiAdminProyek() {
  const sesi = useSesi();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');

  const proyekTerkunci = sesi.peran === 'admin-proyek' ? sesi.proyekId : null;
  const [proyekId, setProyekId] = useState(proyekTerkunci ?? 'AFP');
  const p = getProyek(proyekId);
  const rekBank = REK_COA[proyekId] ?? '1-1001';

  const [jurnal, setJurnal] = useState<Jurnal[] | null>(null);
  const [tukang, setTukang] = useState<TukangBorongan[]>([]);
  const [bayar, setBayar] = useState<BayarTukang[]>([]);
  const [aset, setAset] = useState<Aset[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [kwitansi, setKwitansi] = useState<DataKwitansi | null>(null);

  useJudul({
    judul: `Dashboard Proyek — ${p.nama}`,
    deskripsi: `${p.bank} · ${p.rek}`,
    tampilkanFilter: false,
  });

  const muat = useCallback(async (pid: string) => {
    setJurnal(null);
    setGalat(null);
    try {
      const [j, t, b, a] = await Promise.all([
        sbQuery<JurnalRow>('jurnal', `proyek=eq.${encodeURIComponent(pid)}&select=*&order=id.desc`),
        sbQuery<TukangBorongan>(
          'tukang_borongan',
          `proyek=eq.${encodeURIComponent(pid)}&select=*&order=id.desc`,
        ).catch(() => [] as TukangBorongan[]),
        sbQuery<BayarTukang>(
          'bayar_tukang',
          `proyek=eq.${encodeURIComponent(pid)}&select=*&order=id.desc`,
        ).catch(() => [] as BayarTukang[]),
        sbQuery<Aset>('aset', `proyek=eq.${encodeURIComponent(pid)}&select=*&order=id.desc`).catch(
          () => [] as Aset[],
        ),
      ]);
      setJurnal(normalisasiJurnal(j));
      setTukang(
        t.map((x) => ({
          ...x,
          nilai_kontrak: Number(x.nilai_kontrak) || 0,
          harga_per_unit: Number(x.harga_per_unit) || 0,
          total_unit: Number(x.total_unit) || 0,
          terbayar: Number(x.terbayar) || 0,
          unit_selesai: Number(x.unit_selesai) || 0,
        })),
      );
      setBayar(b);
      setAset(a);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
      setJurnal([]);
    }
  }, []);

  useEffect(() => {
    void muat(proyekId);
  }, [proyekId, muat]);

  const j = useMemo(() => jurnal ?? [], [jurnal]);
  const stat = useMemo(
    () => ({
      masuk: totalPendapatan(j),
      bahan: totalBahan(j),
      tukang: totalTukang(j),
      kas: saldoKasProyek(j, proyekId),
    }),
    [j, proyekId],
  );

  if (sesi.peran === 'admin-proyek' && !proyekTerkunci) {
    return <PesanGalat pesan={`Akun ${sesi.email} belum di-assign ke proyek mana pun.`} />;
  }
  if (jurnal === null) return <Memuat pesan="Memuat data proyek…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat(proyekId)} />;

  const konteks = {
    proyekId,
    p,
    rekBank,
    jurnal: j,
    tukang,
    bayar,
    aset,
    toast,
    setSibuk,
    setJurnal,
    setTukang,
    setKwitansi,
    email: sesi.email,
    muatUlang: () => muat(proyekId),
  };

  return (
    <>
      <div className="space-y-4 print:hidden">
        <OverlaySimpan pesan={sibuk} />
        <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

        <div className="card-pad flex flex-wrap items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`btn-xs ${
                tab === t.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}

          {sesi.peran === 'cfo' ? (
            <select
              className="input ml-auto h-8 w-auto py-1 text-xs"
              value={proyekId}
              onChange={(e) => setProyekId(e.target.value)}
              aria-label="Pilih proyek"
            >
              {PROYEK.filter((x) => REK_COA[x.id]).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nama}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {tab === 'dashboard' ? <TabDashboard stat={stat} jurnal={j} tukang={tukang} p={p} /> : null}
        {tab === 'kas-masuk' ? <TabKasMasuk {...konteks} /> : null}
        {tab === 'bahan' ? <TabBahan {...konteks} /> : null}
        {tab === 'kas-keluar' ? <TabKasKeluar {...konteks} /> : null}
        {tab === 'tukang' ? <TabTukang {...konteks} /> : null}
        {tab === 'laporan' ? <TabLaporan stat={stat} jurnal={j} tukang={tukang} p={p} /> : null}
      </div>

      <Kwitansi data={kwitansi} />
    </>
  );
}

/* ─────────────────────────── Tipe konteks tab ─────────────────────────── */

interface KonteksTab {
  proyekId: string;
  p: ReturnType<typeof getProyek>;
  rekBank: string;
  jurnal: Jurnal[];
  tukang: TukangBorongan[];
  bayar: BayarTukang[];
  aset: Aset[];
  toast: ReturnType<typeof useToast>;
  setSibuk: (v: string | null) => void;
  setJurnal: React.Dispatch<React.SetStateAction<Jurnal[] | null>>;
  setTukang: React.Dispatch<React.SetStateAction<TukangBorongan[]>>;
  setKwitansi: (d: DataKwitansi | null) => void;
  email: string;
  muatUlang: () => Promise<void>;
}

/** Nomor transaksi atomik dari database; jatuh ke cadangan bila RPC gagal. */
async function nomorDb(prefix: string): Promise<string> {
  try {
    const seq = await sbRpc<number | string>('next_mkh_no', { p_prefix: prefix });
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  } catch {
    return `${prefix}-${Date.now().toString().slice(-4)}`;
  }
}

/* ─────────────────────────────── Dashboard ─────────────────────────────── */

function TabDashboard({
  stat,
  jurnal,
  tukang,
  p,
}: {
  stat: { masuk: number; bahan: number; tukang: number; kas: number };
  jurnal: Jurnal[];
  tukang: TukangBorongan[];
  p: ReturnType<typeof getProyek>;
}) {
  const aktif = tukang.filter((t) => t.terbayar < t.nilai_kontrak);
  const sisaBayar = tukang.reduce((s, t) => s + Math.max(0, t.nilai_kontrak - t.terbayar), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { l: 'Saldo Kas Proyek', v: stat.kas, c: 'text-emerald-600', b: 'from-emerald-50 to-emerald-100/60 border-emerald-200' },
          { l: 'Total Pendapatan', v: stat.masuk, c: 'text-amber-600', b: 'from-amber-50 to-amber-100/60 border-amber-200' },
          { l: 'Pengeluaran Bahan', v: stat.bahan, c: 'text-sky-600', b: 'from-sky-50 to-sky-100/60 border-sky-200' },
          { l: 'Bayar Tukang', v: stat.tukang, c: 'text-violet-600', b: 'from-violet-50 to-violet-100/60 border-violet-200' },
        ].map((k) => (
          <div key={k.l} className={`rounded-xl border bg-gradient-to-br p-4 shadow-card ${k.b}`}>
            <div className="label-mono">{k.l}</div>
            <div className={`mt-1 text-[19px] font-bold ${k.c}`}>{rupiah(k.v)}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel judul="Tukang / Kontraktor Aktif" ikon="palu">
          {aktif.length === 0 ? (
            <Kosong pesan="Tidak ada kontrak aktif." ikon="palu" />
          ) : (
            <>
              {aktif.map((t) => {
                const sisa = t.nilai_kontrak - t.terbayar;
                const pct = t.nilai_kontrak > 0 ? Math.min(100, (t.terbayar / t.nilai_kontrak) * 100) : 0;
                return (
                  <div key={t.id} className="mb-3.5 border-b border-slate-100 pb-3.5 last:border-0">
                    <div className="mb-1 flex justify-between gap-2">
                      <span className="text-[12px] font-bold text-slate-800">{t.nama}</span>
                      <span className="text-[10px] text-slate-400">{t.item || '-'}</span>
                    </div>
                    <div className="mb-1.5 flex justify-between text-[10.5px]">
                      <span className="text-slate-500">
                        Kontrak: <b className="text-slate-700">{rupiah(t.nilai_kontrak)}</b>
                      </span>
                      <span className="text-rose-600">
                        Sisa: <b>{rupiah(sisa)}</b>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-slate-400">
                      {pct.toFixed(1)}% terbayar
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between border-t border-slate-200 pt-2.5">
                <span className="text-[11px] text-slate-500">Total Sisa Bayar Tukang</span>
                <span className="text-[12.5px] font-bold text-rose-600">{rupiah(sisaBayar)}</span>
              </div>
            </>
          )}
        </Panel>

        <Panel judul="Transaksi Terakhir" ikon="buku" padat>
          {jurnal.length === 0 ? (
            <Kosong pesan="Belum ada transaksi." />
          ) : (
            <div className="thin-scroll max-h-[420px] overflow-auto">
              <table className="tbl">
                <thead className="sticky top-0">
                  <tr>
                    <th>Tgl</th>
                    <th>Keterangan</th>
                    <th className="text-right">Debet</th>
                    <th className="text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {jurnal.slice(0, 12).map((x, i) => (
                    <tr key={x.id ?? i}>
                      <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {tanggalPendek(x.tgl)}
                      </td>
                      <td className="max-w-[200px] truncate text-slate-600" title={x.ket}>
                        {x.ket || '-'}
                      </td>
                      <td className="num text-rose-600">{x.D > 0 ? fmt(x.D) : '-'}</td>
                      <td className="num text-emerald-600">{x.K > 0 ? fmt(x.K) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="font-mono text-[10px] text-slate-400">
        Rekening proyek: {p.bank} · {p.rek}
      </p>
    </div>
  );
}

/* ─────────────────────────────── Kas Masuk ─────────────────────────────── */

function TabKasMasuk(k: KonteksTab) {
  const [tgl, setTgl] = useState(today());
  const [blok, setBlok] = useState('');
  const [jenis, setJenis] = useState(JENIS_PENERIMAAN[0]);
  const [pembeli, setPembeli] = useState('');
  const [nominal, setNominal] = useState(0);
  const [via, setVia] = useState(k.rekBank);
  const [ket, setKet] = useState('');

  const riwayat = k.jurnal.filter((x) => AKUN_PENDAPATAN.includes(x.akun));

  async function simpan(cetak: boolean) {
    if (!tgl || !nominal) {
      k.toast.galat('Lengkapi tanggal dan nominal!');
      return;
    }
    k.setSibuk('Menyimpan kas masuk…');
    try {
      const no = await nomorDb('KM');
      const akunPend = akunPendapatanProyek(jenis);
      const keterangan = `${jenis}${blok ? ` - Blok ${blok}` : ''}${
        pembeli ? ` a/n ${pembeli}` : ''
      }${ket ? ` (${ket})` : ''}`;
      const rekNama = via === '1-1001' ? 'Kas Tunai' : `Bank ${k.p.bank}`;

      const baris = await sbInsert<JurnalRow>('jurnal', [
        { tgl, no, ket: keterangan, akun: via, nama: rekNama, proyek: k.proyekId, d: nominal, k: 0 },
        { tgl, no, ket: keterangan, akun: akunPend, nama: 'Pendapatan', proyek: k.proyekId, d: 0, k: nominal },
      ]);
      k.setJurnal((arr) => [...normalisasiJurnal(baris), ...(arr ?? [])]);

      k.toast.sukses(`Kas masuk ${rupiah(nominal)} tersimpan!`);

      if (cetak) {
        k.setKwitansi({ no, tgl, jenis, blok, pembeli, nominal, proyek: k.p.nama, ket });
        // Beri React satu siklus render sebelum dialog cetak dibuka.
        setTimeout(() => window.print(), 300);
      }

      setPembeli('');
      setNominal(0);
      setKet('');
    } catch (e) {
      k.toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      k.setSibuk(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,480px)_1fr]">
      <Panel judul={`Input Kas Masuk — ${k.p.nama}`} ikon="kas-masuk">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Tanggal"
            anak={<input type="date" className="input" value={tgl} onChange={(e) => setTgl(e.target.value)} />}
          />
          <Bidang
            label="Pilih Blok / Unit"
            anak={
              <select className="input" value={blok} onChange={(e) => setBlok(e.target.value)}>
                <option value="">— Tidak terkait unit —</option>
                {k.aset.map((a) => (
                  <option key={a.id} value={a.blok}>
                    {a.blok}
                    {a.pembeli ? ` — ${a.pembeli}` : ''}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Jenis Penerimaan"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_PENERIMAAN.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Nama Pembeli"
            anak={
              <input
                className="input"
                placeholder="Nama pembeli atau sumber dana"
                value={pembeli}
                onChange={(e) => setPembeli(e.target.value)}
              />
            }
          />
          <Bidang label="Nominal" anak={<InputRupiah id="km-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Via"
            anak={
              <select className="input" value={via} onChange={(e) => setVia(e.target.value)}>
                <option value={k.rekBank}>Transfer Bank {k.p.bank}</option>
                <option value="1-1001">Tunai</option>
              </select>
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

        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-green flex-1" onClick={() => void simpan(false)}>
            <Icon name="plus" className="h-4 w-4" /> Simpan
          </button>
          <button className="btn-amber flex-1" onClick={() => void simpan(true)}>
            <Icon name="printer" className="h-4 w-4" /> Simpan &amp; Cetak Kwitansi
          </button>
        </div>

        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10.5px] text-emerald-900">
          Nomor transaksi diambil otomatis dari database (RPC <b>next_mkh_no</b>) agar tidak pernah
          dobel antar admin.
        </p>
      </Panel>

      <Panel judul={`Riwayat Kas Masuk (${riwayat.length})`} ikon="buku" padat>
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada kas masuk." />
        ) : (
          <div className="thin-scroll max-h-[70vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Tgl</th>
                  <th>No</th>
                  <th>Keterangan</th>
                  <th className="text-right">Nominal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {riwayat.map((x, i) => (
                  <tr key={x.id ?? i}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(x.tgl)}
                    </td>
                    <td className="font-mono text-[11px] font-semibold text-amber-600">{x.no}</td>
                    <td className="max-w-[220px] truncate text-slate-600" title={x.ket}>
                      {x.ket}
                    </td>
                    <td className="num font-semibold text-emerald-600">Rp {fmt(x.K)}</td>
                    <td>
                      <button
                        className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200"
                        onClick={() => {
                          k.setKwitansi({
                            no: x.no,
                            tgl: x.tgl,
                            jenis: x.ket || '-',
                            blok: '',
                            pembeli: '',
                            nominal: x.K,
                            proyek: k.p.nama,
                            ket: '',
                          });
                          setTimeout(() => window.print(), 300);
                        }}
                      >
                        <Icon name="printer" className="h-3 w-3" />
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

/* ───────────────────────────── Pembelian Bahan ─────────────────────────── */

function TabBahan(k: KonteksTab) {
  const [tgl, setTgl] = useState(today());
  const [jenis, setJenis] = useState(JENIS_BAHAN[0].akun);
  const [supplier, setSupplier] = useState('');
  const [item, setItem] = useState('');
  const [nominal, setNominal] = useState(0);
  const [rek, setRek] = useState(k.rekBank);
  const [ket, setKet] = useState('');

  const riwayat = k.jurnal.filter((x) => AKUN_BAHAN.includes(x.akun));

  async function kirim() {
    if (!tgl || !nominal) {
      k.toast.galat('Lengkapi tanggal dan nominal!');
      return;
    }
    k.setSibuk('Mengirim pengajuan…');
    try {
      const no = await nomorDb('KK');
      const akunNama = JENIS_BAHAN.find((x) => x.akun === jenis)?.nama ?? 'Pembelian Material';
      const rekNama = rek === '1-1001' ? 'Kas Tunai' : `Bank ${k.p.bank}`;
      const keterangan = `${akunNama}${item ? ` - ${item}` : ''}${
        supplier ? ` (${supplier})` : ''
      }${ket ? ` | ${ket}` : ''}`;

      await sbInsert('pengajuan', [
        {
          proyek: k.proyekId,
          tipe: 'bahan',
          status: 'pending',
          created_by: k.email,
          data: {
            tgl, no, jenis, supplier, item, nominal, rek, ket,
            keterangan, akunNama, rekNama, proyek_nama: k.p.nama,
          },
        },
      ]);

      k.toast.sukses(`Pengajuan bahan ${rupiah(nominal)} dikirim! Menunggu verifikasi.`);
      setSupplier('');
      setItem('');
      setNominal(0);
      setKet('');
    } catch (e) {
      k.toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      k.setSibuk(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,480px)_1fr]">
      <Panel judul={`Input Pembelian Bahan — ${k.p.nama}`} ikon="kotak">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Tanggal"
            anak={<input type="date" className="input" value={tgl} onChange={(e) => setTgl(e.target.value)} />}
          />
          <Bidang
            label="Jenis Pembelian"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_BAHAN.map((x) => (
                  <option key={x.akun} value={x.akun}>
                    {x.nama}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Nama Supplier / Toko"
            anak={
              <input
                className="input"
                placeholder="Nama toko atau supplier"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            }
          />
          <Bidang
            label="Nama Bahan / Item"
            anak={
              <input
                className="input"
                placeholder="Semen, pasir, besi, dll"
                value={item}
                onChange={(e) => setItem(e.target.value)}
              />
            }
          />
          <Bidang label="Nominal" anak={<InputRupiah id="bh-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Bayar Via"
            anak={
              <select className="input" value={rek} onChange={(e) => setRek(e.target.value)}>
                <option value={k.rekBank}>Transfer Bank {k.p.bank}</option>
                <option value="1-1001">Tunai</option>
              </select>
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

        <button className="btn-amber mt-4 w-full" onClick={() => void kirim()}>
          <Icon name="kirim" className="h-4 w-4" /> Kirim Pengajuan Bahan
        </button>

        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-900">
          Pembelian bahan masuk sebagai <b>pengajuan</b>, bukan jurnal langsung. Kepala Cabang
          diberi tahu lewat WhatsApp; jurnal terisi setelah Super Admin mengirim bukti transfer.
        </p>
      </Panel>

      <Panel
        judul="Riwayat Pembelian Bahan (yang sudah masuk jurnal)"
        ikon="buku"
        padat
        aksi={<span className="chip bg-sky-100 text-sky-700">Total {rupiah(totalBahan(k.jurnal))}</span>}
      >
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada pembelian bahan yang terbukukan." />
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
                {riwayat.map((x, i) => (
                  <tr key={x.id ?? i}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(x.tgl)}
                    </td>
                    <td className="font-mono text-[11px] text-amber-600">{x.no || '-'}</td>
                    <td className="max-w-[240px] truncate text-slate-600" title={x.ket}>
                      {x.ket || '-'}
                    </td>
                    <td className="num font-semibold text-rose-600">Rp {fmt(x.D)}</td>
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

/* ────────────────────────── Kas Keluar Umum ────────────────────────────── */

function TabKasKeluar(k: KonteksTab) {
  const [tgl, setTgl] = useState(today());
  const [jenis, setJenis] = useState(JENIS_KAS_KELUAR_UMUM[0].akun);
  const [penerima, setPenerima] = useState('');
  const [nominal, setNominal] = useState(0);
  const [rek, setRek] = useState(k.rekBank);
  const [ket, setKet] = useState('');

  const riwayat = k.jurnal.filter((x) => AKUN_KAS_KELUAR_UMUM.includes(x.akun) && x.D > 0);
  const total = riwayat.reduce((s, x) => s + x.D, 0);

  async function kirim() {
    if (!tgl || !nominal) {
      k.toast.galat('Lengkapi tanggal dan nominal!');
      return;
    }
    k.setSibuk('Mengirim pengajuan…');
    try {
      const no = await nomorDb('KK');
      const akunNama =
        JENIS_KAS_KELUAR_UMUM.find((x) => x.akun === jenis)?.nama ?? 'Beban Lain-lain';
      const rekNama = rek === '1-1001' ? 'Kas Tunai' : `Bank ${k.p.bank}`;
      const keterangan = `${akunNama}${penerima ? ` - ${penerima}` : ''}${ket ? ` | ${ket}` : ''}`;

      // Tipe tetap "bahan" — itulah yang dipakai antrian verifikasi untuk
      // seluruh pengeluaran yang diajukan admin proyek (sama seperti versi lama).
      await sbInsert('pengajuan', [
        {
          proyek: k.proyekId,
          tipe: 'bahan',
          status: 'pending',
          created_by: k.email,
          data: {
            tgl, no, jenis, nominal, rek,
            ket: keterangan, keterangan, akunNama, rekNama, supplier: '',
            item: penerima ? `Penerima: ${penerima}` : keterangan,
            proyek_nama: k.p.nama,
          },
        },
      ]);

      k.toast.sukses(`Pengajuan kas keluar ${rupiah(nominal)} dikirim! Menunggu verifikasi.`);
      setPenerima('');
      setNominal(0);
      setKet('');
    } catch (e) {
      k.toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      k.setSibuk(null);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,480px)_1fr]">
      <Panel judul={`Input Kas Keluar Umum — ${k.p.nama}`} ikon="kas-keluar">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Tanggal"
            anak={<input type="date" className="input" value={tgl} onChange={(e) => setTgl(e.target.value)} />}
          />
          <Bidang
            label="Jenis Pengeluaran"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_KAS_KELUAR_UMUM.map((x) => (
                  <option key={x.akun} value={x.akun}>
                    {x.nama}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Penerima / Vendor"
            anak={
              <input
                className="input"
                placeholder="Nama penerima atau vendor"
                value={penerima}
                onChange={(e) => setPenerima(e.target.value)}
              />
            }
          />
          <Bidang label="Nominal" anak={<InputRupiah id="kl-nominal" nilai={nominal} onUbah={setNominal} />} />
          <Bidang
            label="Bayar Via"
            anak={
              <select className="input" value={rek} onChange={(e) => setRek(e.target.value)}>
                <option value={k.rekBank}>Transfer Bank {k.p.bank}</option>
                <option value="1-1001">Tunai</option>
              </select>
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

        <button className="btn-danger mt-4 w-full" onClick={() => void kirim()}>
          <Icon name="kirim" className="h-4 w-4" /> Kirim Pengajuan Kas Keluar
        </button>
      </Panel>

      <Panel
        judul="Riwayat Kas Keluar Umum (yang sudah masuk jurnal)"
        ikon="buku"
        padat
        aksi={<span className="chip bg-rose-100 text-rose-700">Total {rupiah(total)}</span>}
      >
        {riwayat.length === 0 ? (
          <Kosong pesan="Belum ada kas keluar yang terbukukan." />
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
                {riwayat.map((x, i) => (
                  <tr key={x.id ?? i}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(x.tgl)}
                    </td>
                    <td className="font-mono text-[11px] text-amber-600">{x.no || '-'}</td>
                    <td className="max-w-[240px] truncate text-slate-600" title={x.ket}>
                      {x.ket || '-'}
                    </td>
                    <td className="num font-semibold text-rose-600">Rp {fmt(x.D)}</td>
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

/* ──────────────────────────────── Tukang ───────────────────────────────── */

function TabTukang(k: KonteksTab) {
  // Form daftar kontrak
  const [nama, setNama] = useState('');
  const [item, setItem] = useState('');
  const [totalUnit, setTotalUnit] = useState('');
  const [hargaUnit, setHargaUnit] = useState(0);
  const [blok, setBlok] = useState('');
  const [tglMulai, setTglMulai] = useState('');
  const [ketKontrak, setKetKontrak] = useState('');

  const nilaiKontrak = (Number(totalUnit) || 0) * hargaUnit;

  // Form bayar mingguan
  const aktif = k.tukang.filter((t) => t.terbayar < t.nilai_kontrak);
  const [tukangId, setTukangId] = useState('');
  const [minggu, setMinggu] = useState('');
  const [tglBayar, setTglBayar] = useState(today());
  const [unitMinggu, setUnitMinggu] = useState('');
  const [blokSelesai, setBlokSelesai] = useState('');
  const [nominalBayar, setNominalBayar] = useState(0);
  const [rekBayar, setRekBayar] = useState(k.rekBank);

  const dipilih = k.tukang.find((t) => String(t.id) === tukangId);

  // Nominal dihitung otomatis dari unit × harga per unit, tetap bisa ditimpa manual.
  useEffect(() => {
    if (!dipilih) return;
    const unit = Number(unitMinggu) || 0;
    if (unit > 0) setNominalBayar(unit * dipilih.harga_per_unit);
  }, [unitMinggu, dipilih]);

  async function daftar() {
    if (!nama || !Number(totalUnit) || !hargaUnit) {
      k.toast.galat('Lengkapi nama, total unit, dan harga per unit!');
      return;
    }
    k.setSibuk('Mendaftarkan kontrak…');
    try {
      const baris = await sbInsert<TukangBorongan>('tukang_borongan', [
        {
          proyek: k.proyekId,
          nama,
          item,
          blok,
          total_unit: Number(totalUnit),
          harga_per_unit: hargaUnit,
          nilai_kontrak: nilaiKontrak,
          terbayar: 0,
          unit_selesai: 0,
          tgl_mulai: tglMulai || null,
          ket: ketKontrak,
        },
      ]);
      k.setTukang((arr) => [
        ...baris.map((t) => ({
          ...t,
          nilai_kontrak: Number(t.nilai_kontrak) || 0,
          harga_per_unit: Number(t.harga_per_unit) || 0,
          total_unit: Number(t.total_unit) || 0,
          terbayar: Number(t.terbayar) || 0,
          unit_selesai: Number(t.unit_selesai) || 0,
        })),
        ...arr,
      ]);
      k.toast.sukses(`${nama} berhasil didaftarkan! Kontrak ${rupiah(nilaiKontrak)}`);
      setNama('');
      setItem('');
      setTotalUnit('');
      setHargaUnit(0);
      setBlok('');
      setKetKontrak('');
    } catch (e) {
      k.toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      k.setSibuk(null);
    }
  }

  async function bayarMingguan() {
    if (!dipilih || !nominalBayar || !tglBayar) {
      k.toast.galat('Lengkapi tukang, tanggal, dan nominal!');
      return;
    }
    const sisa = dipilih.nilai_kontrak - dipilih.terbayar;
    if (nominalBayar > sisa) {
      k.toast.galat(`Melebihi sisa kontrak ${rupiah(sisa)}!`);
      return;
    }

    k.setSibuk('Mengirim pengajuan…');
    try {
      const no = await nomorDb('TK');
      const unit = Number(unitMinggu) || 0;
      const terbayarBaru = dipilih.terbayar + nominalBayar;
      const unitSelesaiBaru = (dipilih.unit_selesai || 0) + unit;
      const rekNama = rekBayar === '1-1001' ? 'Kas Tunai' : `Bank ${k.p.bank}`;
      const ketJ = `Bayar tukang: ${dipilih.nama}${dipilih.item ? ` (${dipilih.item})` : ''}${
        blokSelesai ? ` Blok ${blokSelesai}` : ''
      }${minggu ? ` — ${minggu}` : ''}`;

      await sbInsert('pengajuan', [
        {
          proyek: k.proyekId,
          tipe: 'tukang',
          status: 'pending',
          created_by: k.email,
          data: {
            tgl: tglBayar, no, nominal: nominalBayar, rek: rekBayar, rekNama, minggu,
            blok_selesai: blokSelesai, unit_minggu: unit,
            tukang_id: dipilih.id, tukang_nama: dipilih.nama,
            terbayarBaru, unitSelesaiBaru, ketJ,
            proyek_nama: k.p.nama,
            sisa_kontrak: dipilih.nilai_kontrak - terbayarBaru,
            sisa_unit: dipilih.total_unit - unitSelesaiBaru,
          },
        },
      ]);

      k.toast.sukses(
        `Pengajuan bayar ${dipilih.nama} ${rupiah(nominalBayar)} dikirim! Menunggu verifikasi.`,
      );
      setUnitMinggu('');
      setBlokSelesai('');
      setNominalBayar(0);
      setMinggu('');
    } catch (e) {
      k.toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      k.setSibuk(null);
    }
  }

  const totalKontrak = k.tukang.reduce((s, t) => s + t.nilai_kontrak, 0);
  const totalTerbayar = k.tukang.reduce((s, t) => s + t.terbayar, 0);
  const totalSisa = k.tukang.reduce((s, t) => s + Math.max(0, t.nilai_kontrak - t.terbayar), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel judul="Daftarkan Tukang / Kontraktor" ikon="palu">
          <div className="grid gap-3 sm:grid-cols-2">
            <Bidang
              label="Nama Tukang"
              anak={
                <input
                  className="input"
                  placeholder="Nama lengkap"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                />
              }
            />
            <Bidang
              label="Jenis Pekerjaan"
              anak={
                <input
                  className="input"
                  placeholder="Pasang keramik, dll"
                  value={item}
                  onChange={(e) => setItem(e.target.value)}
                />
              }
            />
            <Bidang
              label="Total Unit Dikontrak"
              anak={
                <input
                  type="number"
                  className="input"
                  placeholder="50"
                  value={totalUnit}
                  onChange={(e) => setTotalUnit(e.target.value)}
                />
              }
            />
            <Bidang
              label="Harga per Unit"
              anak={<InputRupiah id="tk-harga" nilai={hargaUnit} onUbah={setHargaUnit} />}
            />
            <Bidang
              label="Blok yang Dikerjakan"
              anak={
                <input
                  className="input"
                  placeholder="A1-A10 atau semua blok"
                  value={blok}
                  onChange={(e) => setBlok(e.target.value)}
                />
              }
            />
            <Bidang
              label="Tanggal Mulai"
              anak={
                <input
                  type="date"
                  className="input"
                  value={tglMulai}
                  onChange={(e) => setTglMulai(e.target.value)}
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
                  value={ketKontrak}
                  onChange={(e) => setKetKontrak(e.target.value)}
                />
              }
            />
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-100 px-3.5 py-2.5">
            <span className="text-[12px] font-semibold text-slate-600">Total Nilai Kontrak</span>
            <span className="text-[16px] font-bold text-amber-600">{rupiah(nilaiKontrak)}</span>
          </div>

          <button className="btn-green mt-3 w-full" onClick={() => void daftar()}>
            <Icon name="plus" className="h-4 w-4" /> Daftarkan Kontrak
          </button>
        </Panel>

        <Panel judul="Bayar Mingguan" ikon="dompet">
          {aktif.length === 0 ? (
            <Kosong pesan="Belum ada kontrak aktif." ikon="palu" />
          ) : (
            <>
              <Bidang
                label="Pilih Tukang"
                anak={
                  <select className="input" value={tukangId} onChange={(e) => setTukangId(e.target.value)}>
                    <option value="">— Pilih tukang —</option>
                    {aktif.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.nama} — {t.item || '-'}
                      </option>
                    ))}
                  </select>
                }
              />

              {dipilih ? (
                <div className="mt-3 flex flex-wrap gap-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <div>
                    <div className="label-mono">Sisa Unit</div>
                    <b className="text-amber-700">
                      {dipilih.total_unit - (dipilih.unit_selesai || 0)} unit
                    </b>
                  </div>
                  <div>
                    <div className="label-mono">Sisa Uang</div>
                    <b className="text-rose-600">{rupiah(dipilih.nilai_kontrak - dipilih.terbayar)}</b>
                  </div>
                  <div>
                    <div className="label-mono">Harga/Unit</div>
                    <b className="text-emerald-600">{rupiah(dipilih.harga_per_unit)}</b>
                  </div>
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Bidang
                  label="Periode / Minggu ke"
                  anak={
                    <input
                      className="input"
                      placeholder="Minggu 1, 12-19 Mei"
                      value={minggu}
                      onChange={(e) => setMinggu(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Tanggal Bayar"
                  anak={
                    <input
                      type="date"
                      className="input"
                      value={tglBayar}
                      onChange={(e) => setTglBayar(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Unit Selesai Minggu Ini"
                  bantuan="Nominal terisi otomatis dari unit × harga per unit."
                  anak={
                    <input
                      type="number"
                      className="input"
                      placeholder="0"
                      value={unitMinggu}
                      onChange={(e) => setUnitMinggu(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Blok Selesai"
                  anak={
                    <input
                      className="input"
                      placeholder="A1, A2"
                      value={blokSelesai}
                      onChange={(e) => setBlokSelesai(e.target.value)}
                    />
                  }
                />
                <Bidang
                  label="Nominal"
                  anak={<InputRupiah id="pay-nominal" nilai={nominalBayar} onUbah={setNominalBayar} />}
                />
                <Bidang
                  label="Bayar Via"
                  anak={
                    <select className="input" value={rekBayar} onChange={(e) => setRekBayar(e.target.value)}>
                      <option value={k.rekBank}>Bank {k.p.bank}</option>
                      <option value="1-1001">Tunai</option>
                    </select>
                  }
                />
              </div>

              <button className="btn-primary mt-4 w-full" onClick={() => void bayarMingguan()}>
                <Icon name="ceklis" className="h-4 w-4" /> Catat Pembayaran
              </button>
            </>
          )}
        </Panel>
      </div>

      <Panel
        judul={`Rekap Tukang (${k.tukang.length})`}
        ikon="grafik"
        aksi={
          <button className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => window.print()}>
            <Icon name="printer" className="h-3 w-3" /> Cetak
          </button>
        }
      >
        {k.tukang.length === 0 ? (
          <Kosong pesan="Belum ada tukang terdaftar." ikon="palu" />
        ) : (
          <>
            {k.tukang.map((t) => {
              const sisaUang = t.nilai_kontrak - t.terbayar;
              const unitSelesai = t.unit_selesai || 0;
              const sisaUnit = (t.total_unit || 0) - unitSelesai;
              const pctUang = t.nilai_kontrak > 0 ? Math.min(100, (t.terbayar / t.nilai_kontrak) * 100) : 0;
              const pctUnit = t.total_unit > 0 ? Math.min(100, (unitSelesai / t.total_unit) * 100) : 0;
              const lunas = sisaUang <= 0;
              const riwayat = k.bayar.filter((b) => b.tukang_id === t.id);

              return (
                <div key={t.id} className="mb-4 border-b border-slate-100 pb-4 last:mb-0 last:border-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-bold text-slate-800">{t.nama}</div>
                      <div className="text-[10px] text-slate-400">
                        {t.item || '-'} | Blok: {t.blok || '-'}
                      </div>
                    </div>
                    <span
                      className={`chip ${lunas ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {lunas ? '✓ LUNAS' : 'AKTIF'}
                    </span>
                  </div>

                  <div className="mb-2 grid grid-cols-3 gap-2">
                    {[
                      { l: 'Kontrak', v: t.nilai_kontrak, c: 'text-slate-700' },
                      { l: 'Terbayar', v: t.terbayar, c: 'text-emerald-600' },
                      { l: 'Sisa Uang', v: sisaUang, c: lunas ? 'text-emerald-600' : 'text-rose-600' },
                    ].map((x) => (
                      <div key={x.l} className="rounded-lg bg-slate-50 p-2 text-center">
                        <div className="label-mono">{x.l}</div>
                        <div className={`text-[11.5px] font-bold ${x.c}`}>{rupiah(x.v)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mb-1.5">
                    <div className="mb-0.5 flex justify-between font-mono text-[9px] text-slate-400">
                      <span>Pembayaran</span>
                      <span>{pctUang.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pctUang}%` }} />
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="mb-0.5 flex justify-between font-mono text-[9px] text-slate-400">
                      <span>
                        Volume ({unitSelesai}/{t.total_unit} unit)
                      </span>
                      <span>Sisa {sisaUnit} unit</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-amber-500" style={{ width: `${pctUnit}%` }} />
                    </div>
                  </div>

                  {riwayat.length > 0 ? (
                    <div className="thin-scroll overflow-x-auto">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Periode</th>
                            <th>Blok</th>
                            <th className="text-right">Nominal</th>
                            <th>Tgl</th>
                          </tr>
                        </thead>
                        <tbody>
                          {riwayat.map((b, i) => (
                            <tr key={b.id ?? i}>
                              <td className="text-[11px]">{b.ket ?? '-'}</td>
                              <td className="text-[11px] text-amber-600">{b.blok_selesai ?? '-'}</td>
                              <td className="num text-emerald-600">Rp {fmt(Number(b.nominal) || 0)}</td>
                              <td className="font-mono text-[10.5px] text-slate-400">
                                {tanggalPendek(b.tgl)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div className="flex flex-wrap gap-5 border-t-2 border-slate-200 pt-3">
              {[
                { l: 'Total Kontrak', v: totalKontrak, c: 'text-amber-600' },
                { l: 'Total Terbayar', v: totalTerbayar, c: 'text-emerald-600' },
                { l: 'Total Sisa', v: totalSisa, c: 'text-rose-600' },
              ].map((x) => (
                <div key={x.l}>
                  <div className="label-mono">{x.l}</div>
                  <b className={x.c}>{rupiah(x.v)}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ─────────────────────────────── Laporan ───────────────────────────────── */

function TabLaporan({
  stat,
  jurnal,
  tukang,
  p,
}: {
  stat: { masuk: number; bahan: number; tukang: number; kas: number };
  jurnal: Jurnal[];
  tukang: TukangBorongan[];
  p: ReturnType<typeof getProyek>;
}) {
  const bahanList = jurnal.filter((x) => AKUN_BAHAN.includes(x.akun));
  const totalSisa = tukang.reduce((s, t) => s + Math.max(0, t.nilai_kontrak - t.terbayar), 0);

  return (
    <div className="space-y-4">
      <Panel judul={`Ringkasan Keuangan — ${p.nama}`} ikon="grafik">
        <table className="tbl">
          <tbody>
            <tr>
              <td className="text-slate-500">Total Kas Masuk</td>
              <td className="num font-bold text-emerald-600">{rupiah(stat.masuk)}</td>
            </tr>
            <tr>
              <td className="text-slate-500">Pengeluaran Bahan</td>
              <td className="num text-rose-600">{rupiah(stat.bahan)}</td>
            </tr>
            <tr>
              <td className="text-slate-500">Bayar Tukang / Kontraktor</td>
              <td className="num text-rose-600">{rupiah(stat.tukang)}</td>
            </tr>
            <tr className="border-t-2 border-slate-200">
              <td className="font-bold">Saldo Kas Proyek</td>
              <td className={`num font-bold ${stat.kas >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {rupiah(stat.kas)}
              </td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel judul="Laporan Pembayaran Tukang / Kontraktor" ikon="palu">
        {tukang.length === 0 ? (
          <Kosong pesan="Belum ada data tukang." ikon="palu" />
        ) : (
          <>
            {tukang.map((t) => {
              const sisa = t.nilai_kontrak - t.terbayar;
              const pct = t.nilai_kontrak > 0 ? Math.min(100, (t.terbayar / t.nilai_kontrak) * 100) : 0;
              return (
                <div key={t.id} className="mb-4 border-b border-slate-100 pb-4 last:mb-0 last:border-0">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-bold text-slate-800">{t.nama}</div>
                      <div className="text-[10px] text-slate-400">{t.item || '-'}</div>
                    </div>
                    <span
                      className={`chip ${sisa <= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {sisa <= 0 ? 'LUNAS' : 'AKTIF'}
                    </span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-5 text-[11px]">
                    <div>
                      <div className="label-mono">Kontrak</div>
                      <b>{rupiah(t.nilai_kontrak)}</b>
                    </div>
                    <div>
                      <div className="label-mono">Terbayar</div>
                      <b className="text-emerald-600">{rupiah(t.terbayar)}</b>
                    </div>
                    <div>
                      <div className="label-mono">Sisa</div>
                      <b className={sisa <= 0 ? 'text-emerald-600' : 'text-rose-600'}>{rupiah(sisa)}</b>
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-slate-400">{pct.toFixed(1)}% terbayar</div>
                </div>
              );
            })}
            <div className="flex justify-between border-t border-slate-200 pt-2.5">
              <span className="text-[11px] font-bold">Total Sisa Bayar Semua Tukang</span>
              <span className="text-[12.5px] font-bold text-rose-600">{rupiah(totalSisa)}</span>
            </div>
          </>
        )}
      </Panel>

      <Panel
        judul={`Riwayat Pembelian Bahan (${bahanList.length} transaksi)`}
        ikon="kotak"
        padat
        aksi={<span className="chip bg-sky-100 text-sky-700">Total {rupiah(stat.bahan)}</span>}
      >
        {bahanList.length === 0 ? (
          <Kosong pesan="Belum ada pembelian bahan." />
        ) : (
          <div className="thin-scroll max-h-[60vh] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>Tgl</th>
                  <th>Keterangan</th>
                  <th className="text-right">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {bahanList.map((x, i) => (
                  <tr key={x.id ?? i}>
                    <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                      {tanggalPendek(x.tgl)}
                    </td>
                    <td className="text-slate-600">{x.ket || '-'}</td>
                    <td className="num text-rose-600">Rp {fmt(x.D)}</td>
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
