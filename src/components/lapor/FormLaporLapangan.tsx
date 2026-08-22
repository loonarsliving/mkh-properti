'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { OverlaySimpan, Toast, useToast } from '@/components/ui/Umum';
import { InputRupiah } from '@/components/ui/Form';
import { PERUSAHAAN } from '@/lib/config';
import { rupiah, today } from '@/lib/format';
import { sbInsert, sbRpc } from '@/lib/supabase';

/**
 * Form lapor pengeluaran untuk staf lapangan — TANPA LOGIN.
 *
 * Ketiga varian (Endy/Loonars material & kontraktor, Rebecca/Loonars biaya
 * lain, Syafiq/Introvert House biaya lain) memakai komponen yang sama dan
 * hanya berbeda konfigurasi. Di versi lama ketiganya adalah file HTML terpisah
 * dengan kode yang nyaris identik.
 *
 * Proyek, kategori akun, dan nama pelapor sengaja terkunci di konfigurasi —
 * pelapor tidak bisa memilih proyek lain, sama seperti sebelumnya.
 */

export interface KonfigLapor {
  /** Kode proyek di database, mis. "LL". */
  proyekId: string;
  proyekNama: string;
  bank: string;
  /** Kode akun kas/bank proyek. */
  rekKode: string;
  /** Nama pelapor yang terkunci. */
  namaPelapor: string;
  /** Label field nama: "Nama Pengawas" atau "Nama Pelapor". */
  labelNama: string;
  /** Prefix created_by, mis. "Pengawas" atau "Pelapor". */
  prefixPelapor: string;
  judul: string;
  penjelasan: React.ReactNode;
  /** Kategori pengeluaran yang boleh dipilih. */
  jenis: { akun: string; nama: string; label: string }[];
  /** Teks bantuan di bawah field rekening. */
  bantuanRekening: string;
}

interface Baris {
  key: number;
  nama: string;
  nilai: number;
}

export function FormLaporLapangan({ konfig }: { konfig: KonfigLapor }) {
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [terkirim, setTerkirim] = useState<number | null>(null);

  const [tgl, setTgl] = useState(today());
  const [jenis, setJenis] = useState(konfig.jenis[0].akun);
  const [rek, setRek] = useState(konfig.rekKode);
  const [rekening, setRekening] = useState('');
  const [catatan, setCatatan] = useState('');
  const [items, setItems] = useState<Baris[]>([{ key: 1, nama: '', nilai: 0 }]);
  const [seq, setSeq] = useState(1);

  const total = useMemo(() => items.reduce((s, it) => s + it.nilai, 0), [items]);

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

  function ubahItem(key: number, patch: Partial<Baris>) {
    setItems((arr) => arr.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  async function kirim() {
    const terisi = items.filter((it) => it.nama.trim() && it.nilai > 0);
    const jumlah = terisi.reduce((s, it) => s + it.nilai, 0);

    if (!tgl) return toast.galat('Tanggal wajib diisi!');
    if (terisi.length === 0) return toast.galat('Isi minimal satu item beserta nilainya!');
    if (jumlah <= 0) return toast.galat('Total pengeluaran harus lebih dari 0!');
    if (!rekening.trim()) return toast.galat('Nomor rekening tujuan wajib diisi!');

    setSibuk('Mengirim laporan…');
    try {
      const jenisOpt = konfig.jenis.find((j) => j.akun === jenis) ?? konfig.jenis[0];
      const rekNama = rek === '1-1001' ? 'Kas Tunai' : `Bank ${konfig.bank}`;
      const itemText = terisi.map((it) => `${it.nama} (${rupiah(it.nilai)})`).join('; ');
      const keterangan = `${rekening}${catatan ? ` | ${catatan}` : ''}`;

      let no = `KK-${Date.now().toString().slice(-4)}`;
      try {
        const seqNo = await sbRpc<number | string>('next_mkh_no', { p_prefix: 'KK' });
        no = `KK-${String(seqNo).padStart(3, '0')}`;
      } catch {
        /* pakai nomor cadangan */
      }

      await sbInsert('pengajuan', [
        {
          proyek: konfig.proyekId,
          tipe: 'bahan',
          status: 'pending',
          created_by: `${konfig.prefixPelapor}: ${konfig.namaPelapor}`,
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
            proyek_nama: konfig.proyekNama,
            pengawas: konfig.namaPelapor,
          },
        },
      ]);

      setTerkirim(jumlah);
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-6">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-green text-sm font-bold text-slate-900">
            MK
          </div>
          <div>
            <div className="text-[13px] font-bold text-slate-800">{konfig.judul}</div>
            <div className="font-mono text-[10px] text-slate-500">{PERUSAHAAN}</div>
          </div>
        </div>

        {terkirim !== null ? (
          <div className="card-pad text-center">
            <div className="mb-3 text-[40px]">✅</div>
            <div className="text-[14px] font-bold text-emerald-600">Laporan Terkirim</div>
            <p className="mx-auto mt-2 max-w-[380px] text-[11.5px] leading-relaxed text-slate-500">
              Total <b className="text-slate-700">{rupiah(terkirim)}</b> untuk proyek{' '}
              <b className="text-slate-700">{konfig.proyekNama}</b> telah dikirim. Menunggu
              verifikasi Kepala Cabang lewat WhatsApp.
            </p>
            <button
              className="btn-ghost mt-5"
              onClick={() => {
                setTerkirim(null);
                setItems([{ key: 1, nama: '', nilai: 0 }]);
                setSeq(1);
                setRekening('');
                setCatatan('');
                setTgl(today());
              }}
            >
              <Icon name="plus" className="h-4 w-4" /> Lapor Pengeluaran Lain
            </button>
          </div>
        ) : (
          <div className="card-pad">
            <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-900">
              {konfig.penjelasan}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label">{konfig.labelNama}</label>
                <input className="input" value={konfig.namaPelapor} readOnly disabled />
              </div>
              <div>
                <label className="field-label" htmlFor="pl-tgl">
                  Tanggal
                </label>
                <input
                  id="pl-tgl"
                  type="date"
                  className="input"
                  value={tgl}
                  onChange={(e) => setTgl(e.target.value)}
                />
              </div>

              {konfig.jenis.length > 1 ? (
                <div>
                  <label className="field-label" htmlFor="pl-jenis">
                    Jenis Pengeluaran
                  </label>
                  <select
                    id="pl-jenis"
                    className="input"
                    value={jenis}
                    onChange={(e) => setJenis(e.target.value)}
                  >
                    {konfig.jenis.map((j) => (
                      <option key={j.akun} value={j.akun}>
                        {j.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="field-label">Jenis Pengeluaran</label>
                  <input className="input" value={konfig.jenis[0].label} readOnly disabled />
                </div>
              )}

              <div>
                <label className="field-label" htmlFor="pl-rek">
                  Bayar Via
                </label>
                <select id="pl-rek" className="input" value={rek} onChange={(e) => setRek(e.target.value)}>
                  <option value={konfig.rekKode}>Transfer Bank {konfig.bank}</option>
                  <option value="1-1001">Tunai</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="field-label mb-0">Rincian Pengeluaran</span>
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
                    <div className="w-[150px]">
                      <InputRupiah
                        id={`item-${it.key}`}
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

              <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">
                Ketik angka saja (contoh: 1500000), otomatis jadi &quot;1.500.000&quot; — cek titik
                ribuannya sebelum kirim.
              </p>

              <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-100 px-3.5 py-2.5">
                <span className="text-[12px] font-semibold text-slate-600">Total</span>
                <span className="text-[17px] font-bold text-slate-800">{rupiah(total)}</span>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label className="field-label" htmlFor="pl-rekening">
                  Rekening Tujuan Transfer
                </label>
                <input
                  id="pl-rekening"
                  className="input"
                  placeholder="Mis: BSI 1234567890 a.n. Toko Jaya"
                  value={rekening}
                  onChange={(e) => setRekening(e.target.value)}
                />
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  {konfig.bantuanRekening}
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="pl-catatan">
                  Catatan Tambahan
                </label>
                <input
                  id="pl-catatan"
                  className="input"
                  placeholder="Opsional…"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                />
              </div>
            </div>

            <button className="btn-primary mt-4 w-full" onClick={() => void kirim()}>
              <Icon name="kirim" className="h-4 w-4" /> Kirim Laporan
            </button>
          </div>
        )}

        <p className="mt-4 text-center font-mono text-[9.5px] text-slate-400">
          Tanpa login · Laporan diverifikasi Kepala Cabang sebelum ditransfer
        </p>
      </div>
    </div>
  );
}
