'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { useSesi } from '@/components/shell/SesiProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, InputRupiah } from '@/components/ui/Form';
import { REK_COA, getProyek } from '@/lib/master';
import { fmt, rupiah, today } from '@/lib/format';
import { sbInsert, sbQuery, sbRpc } from '@/lib/supabase';
import type { Pengajuan } from '@/types';

/**
 * Jenis pengeluaran yang boleh diajukan admin proyek — daftar dan pemetaan
 * akunnya sama persis dengan `JENIS_OPTIONS` di pengeluaran.html.
 */
const JENIS_OPTIONS = [
  { akun: '5-1001', nama: 'Pembelian Material' },
  { akun: '5-1002', nama: 'Bayar Distributor' },
  { akun: '5-1004', nama: 'Biaya Subkontraktor' },
  { akun: '5-1005', nama: 'Biaya Overhead Proyek' },
  { akun: '6-1004', nama: 'Transportasi' },
  { akun: '6-1003', nama: 'Listrik & Air' },
  { akun: '6-1001', nama: 'Gaji Staf' },
  { akun: '6-1002', nama: 'Sewa Kantor' },
  { akun: '6-1005', nama: 'Perizinan & Notaris' },
  { akun: '6-1006', nama: 'Biaya Pemasaran' },
  { akun: '6-1007', nama: 'Beban Lain-lain' },
];

interface ItemBaris {
  key: number;
  nama: string;
  nilai: number;
}

export default function HalamanPengeluaran() {
  return (
    <GuardHalaman izinkan={['cfo', 'admin-proyek']}>
      <IsiPengeluaran />
    </GuardHalaman>
  );
}

function IsiPengeluaran() {
  const sesi = useSesi();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<Pengajuan[] | null>(null);
  const [galatRiwayat, setGalatRiwayat] = useState<string | null>(null);

  // CFO bisa mengajukan atas nama proyek mana pun; admin proyek terkunci
  // pada proyek yang di-assign ke akunnya.
  const proyekTerkunci = sesi.peran === 'admin-proyek' ? sesi.proyekId : null;
  const [proyek, setProyek] = useState(proyekTerkunci ?? 'AFP');
  const info = getProyek(proyek);

  useJudul({
    judul: 'Input Pengeluaran',
    deskripsi: `Pengajuan biaya proyek ${info.nama} — menunggu verifikasi Kepala Cabang`,
    tampilkanFilter: false,
  });

  const [tgl, setTgl] = useState(today());
  const [jenis, setJenis] = useState(JENIS_OPTIONS[0].akun);
  const [rek, setRek] = useState(REK_COA[proyek] ?? '1-1001');
  const [rekening, setRekening] = useState('');
  const [catatan, setCatatan] = useState('');
  const [items, setItems] = useState<ItemBaris[]>([{ key: 1, nama: '', nilai: 0 }]);
  const [seq, setSeq] = useState(1);

  const total = useMemo(() => items.reduce((s, it) => s + it.nilai, 0), [items]);

  const muatRiwayat = useCallback(async (pid: string) => {
    setGalatRiwayat(null);
    try {
      const rows = await sbQuery<Pengajuan>(
        'pengajuan',
        `proyek=eq.${encodeURIComponent(pid)}&tipe=eq.bahan&select=*&order=id.desc&limit=10`,
      );
      setRiwayat(rows);
    } catch (e) {
      setGalatRiwayat(e instanceof Error ? e.message : String(e));
      setRiwayat([]);
    }
  }, []);

  useEffect(() => {
    setRek(REK_COA[proyek] ?? '1-1001');
    void muatRiwayat(proyek);
  }, [proyek, muatRiwayat]);

  function tambahItem() {
    setSeq((s) => s + 1);
    setItems((arr) => [...arr, { key: seq + 1, nama: '', nilai: 0 }]);
  }

  function hapusItem(key: number) {
    if (items.length <= 1) {
      toast.galat('Minimal satu item pengeluaran.');
      return;
    }
    setItems((arr) => arr.filter((it) => it.key !== key));
  }

  function ubahItem(key: number, patch: Partial<ItemBaris>) {
    setItems((arr) => arr.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function reset() {
    setSeq(1);
    setItems([{ key: 1, nama: '', nilai: 0 }]);
    setRekening('');
    setCatatan('');
    setTgl(today());
  }

  async function kirim() {
    const terisi = items.filter((it) => it.nama.trim() && it.nilai > 0);
    const jumlah = terisi.reduce((s, it) => s + it.nilai, 0);

    if (!tgl) return toast.galat('Tanggal wajib diisi!');
    if (terisi.length === 0) return toast.galat('Isi minimal satu item beserta nilainya!');
    if (jumlah <= 0) return toast.galat('Total pengeluaran harus lebih dari 0!');
    if (!rekening.trim()) return toast.galat('Nomor rekening tujuan wajib diisi!');

    setSibuk('Mengirim pengajuan…');
    try {
      const jenisOpt =
        JENIS_OPTIONS.find((j) => j.akun === jenis) ?? JENIS_OPTIONS[JENIS_OPTIONS.length - 1];
      const rekNama = rek === '1-1001' ? 'Kas Tunai' : `Bank ${info.bank}`;
      const itemText = terisi.map((it) => `${it.nama} (${rupiah(it.nilai)})`).join('; ');
      const keterangan = `${rekening}${catatan ? ` | ${catatan}` : ''}`;

      // Nomor transaksi diambil dari RPC next_mkh_no agar seragam dengan
      // sistem lain; kalau RPC gagal, pakai cadangan berbasis timestamp
      // seperti versi lama supaya pengajuan tetap bisa terkirim.
      let no = `KK-${Date.now().toString().slice(-4)}`;
      try {
        const seqNo = await sbRpc<number | string>('next_mkh_no', { p_prefix: 'KK' });
        no = `KK-${String(seqNo).padStart(3, '0')}`;
      } catch {
        /* pakai nomor cadangan */
      }

      await sbInsert('pengajuan', [
        {
          proyek,
          tipe: 'bahan',
          status: 'pending',
          created_by: sesi.email,
          data: {
            tgl,
            no,
            jenis: jenisOpt.akun,
            akunNama: jenisOpt.nama,
            rek,
            rekNama,
            item: itemText,
            items: terisi.map((it) => ({ nama: it.nama, nilai: it.nilai })),
            nominal: jumlah,
            ket: keterangan,
            keterangan,
            proyek_nama: info.nama,
          },
        },
      ]);

      toast.sukses(`Pengajuan ${rupiah(jumlah)} dikirim! Menunggu verifikasi Kepala Cabang.`);
      reset();
      await muatRiwayat(proyek);
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (sesi.peran === 'admin-proyek' && !proyekTerkunci) {
    return (
      <PesanGalat pesan={`Akun ${sesi.email} belum di-assign ke proyek mana pun.`} />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,600px)_1fr]">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel judul="Form Pengajuan Pengeluaran" ikon="dokumen">
        <div className="grid gap-3 sm:grid-cols-2">
          {sesi.peran === 'cfo' ? (
            <Bidang
              label="Proyek"
              anak={
                <select className="input" value={proyek} onChange={(e) => setProyek(e.target.value)}>
                  {Object.keys(REK_COA).map((id) => (
                    <option key={id} value={id}>
                      {getProyek(id).nama}
                    </option>
                  ))}
                </select>
              }
            />
          ) : (
            <Bidang
              label="Proyek"
              anak={<input className="input" value={info.nama} disabled readOnly />}
            />
          )}
          <Bidang
            label="Tanggal"
            anak={<input type="date" className="input" value={tgl} onChange={(e) => setTgl(e.target.value)} />}
          />
          <Bidang
            label="Jenis Pengeluaran"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value)}>
                {JENIS_OPTIONS.map((j) => (
                  <option key={j.akun} value={j.akun}>
                    {j.nama}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Bayar Via"
            anak={
              <select className="input" value={rek} onChange={(e) => setRek(e.target.value)}>
                <option value={REK_COA[proyek] ?? '1-1001'}>Transfer Bank {info.bank}</option>
                <option value="1-1001">Tunai</option>
              </select>
            }
          />
          <Bidang
            label="No. Rekening / Nama Penerima"
            span
            anak={
              <input
                className="input"
                placeholder="Mis: 1234567890 a.n. Toko Bangunan Jaya"
                value={rekening}
                onChange={(e) => setRekening(e.target.value)}
              />
            }
          />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="field-label mb-0">Rincian Item</span>
            <button className="btn-xs bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={tambahItem}>
              <Icon name="plus" className="h-3 w-3" /> Tambah Item
            </button>
          </div>

          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.key} className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Nama item / keperluan"
                  value={it.nama}
                  onChange={(e) => ubahItem(it.key, { nama: e.target.value })}
                />
                <div className="w-[160px]">
                  <InputRupiah
                    id={`item-nilai-${it.key}`}
                    nilai={it.nilai}
                    onUbah={(v) => ubahItem(it.key, { nilai: v })}
                  />
                </div>
                <button
                  onClick={() => hapusItem(it.key)}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                  aria-label="Hapus item"
                >
                  <Icon name="sampah" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-100 px-3.5 py-2.5">
            <span className="text-[12px] font-semibold text-slate-600">Total Pengajuan</span>
            <span className="text-[16px] font-bold text-slate-800">{rupiah(total)}</span>
          </div>
        </div>

        <div className="mt-3">
          <Bidang
            label="Catatan Tambahan"
            anak={
              <input
                className="input"
                placeholder="Opsional…"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-primary mt-4 w-full" onClick={() => void kirim()}>
          <Icon name="kirim" className="h-4 w-4" /> Kirim Pengajuan
        </button>

        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-900">
          Pengajuan tidak langsung masuk jurnal. Setelah disetujui Kepala Cabang, jurnal baru terisi
          otomatis ketika Super Admin melakukan transfer dan mengirim bukti transfer via WhatsApp.
        </p>
      </Panel>

      <Panel judul="Riwayat Pengajuan Terakhir" ikon="buku" padat>
        {riwayat === null ? (
          <Memuat pesan="Memuat riwayat…" />
        ) : galatRiwayat ? (
          <div className="p-4">
            <PesanGalat pesan={galatRiwayat} onCoba={() => void muatRiwayat(proyek)} />
          </div>
        ) : riwayat.length === 0 ? (
          <Kosong pesan="Belum ada pengajuan." />
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tgl</th>
                  <th>Item</th>
                  <th className="text-right">Nominal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => {
                  const d = r.data ?? {};
                  const nada =
                    r.status === 'pending'
                      ? 'bg-amber-100 text-amber-700'
                      : r.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-rose-100 text-rose-700';
                  const label =
                    r.status === 'pending'
                      ? 'Menunggu'
                      : r.status === 'approved'
                        ? 'Disetujui'
                        : r.status === 'rejected'
                          ? 'Ditolak'
                          : r.status;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {d.tgl ?? '-'}
                      </td>
                      <td className="max-w-[240px] truncate text-slate-600" title={d.item ?? d.keterangan}>
                        {d.item ?? d.keterangan ?? '-'}
                      </td>
                      <td className="num font-semibold">Rp {fmt(d.nominal)}</td>
                      <td>
                        <span className={`chip ${nada}`}>{label}</span>
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
