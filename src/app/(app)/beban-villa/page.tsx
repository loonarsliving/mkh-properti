'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useSesi } from '@/components/shell/SesiProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Badge, Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { KartuStat } from '@/components/ui/Kartu';
import { Bidang, InputRupiah } from '@/components/ui/Form';
import { rupiah, today } from '@/lib/format';
import { sbDelete, sbInsert, sbQuery } from '@/lib/supabase';
import {
  KATEGORI_BEBAN_VILLA,
  bulanKePeriode,
  labelBulanPeriode,
  labelKategoriBebanVilla,
  ringkasBebanVilla,
} from '@/lib/villa';
import type { BebanVilla, KategoriBebanVilla } from '@/types';

export default function HalamanBebanVilla() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiBebanVilla />
    </GuardHalaman>
  );
}

function bulanIni(): string {
  return today().slice(0, 7);
}

function IsiBebanVilla() {
  const sesi = useSesi();
  const toast = useToast();
  const [data, setData] = useState<BebanVilla[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);

  useJudul({
    judul: 'Beban Villa',
    deskripsi: 'Beban Loonars Villa (opex & marketing sesuai akad) — pasangan Pendapatan Villa untuk laporan laba-rugi',
  });

  const [bulan, setBulan] = useState(bulanIni());
  const [kategori, setKategori] = useState<KategoriBebanVilla>('opex');
  const [jumlah, setJumlah] = useState(0);
  const [keterangan, setKeterangan] = useState('');

  const muatUlang = useCallback(async () => {
    setGalat(null);
    try {
      const baris = await sbQuery<BebanVilla>('beban_villa', 'select=*&order=periode.desc,kategori.asc');
      setData(baris);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  const bulanTerpilihRingkasan = useMemo(() => {
    if (!data) return null;
    const periode = bulanKePeriode(bulan);
    return ringkasBebanVilla(data.filter((b) => b.periode === periode));
  }, [data, bulan]);

  const totalTahunBerjalan = useMemo(() => {
    if (!data) return 0;
    const tahun = bulan.slice(0, 4);
    return data
      .filter((b) => b.periode.slice(0, 4) === tahun)
      .reduce((s, b) => s + (Number(b.jumlah) || 0), 0);
  }, [data, bulan]);

  const perBulan = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, BebanVilla[]>();
    for (const b of data) {
      const arr = map.get(b.periode) ?? [];
      arr.push(b);
      map.set(b.periode, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [data]);

  async function simpan() {
    if (!bulan || !jumlah) {
      toast.galat('Lengkapi bulan dan jumlah beban!');
      return;
    }
    setSibuk('Menyimpan beban villa…');
    try {
      const baris = await sbInsert<BebanVilla>('beban_villa', [
        {
          periode: bulanKePeriode(bulan),
          kategori,
          jumlah,
          keterangan: keterangan || null,
          sumber: 'manual',
          created_by: sesi.email,
        },
      ]);
      setData((sebelum) => [...(sebelum ?? []), ...baris]);
      toast.sukses(`Beban villa ${rupiah(jumlah)} berhasil dicatat!`);
      setJumlah(0);
      setKeterangan('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function hapus(id: number | undefined) {
    if (id === undefined) return;
    if (!window.confirm('Hapus baris beban villa ini?')) return;
    setSibuk('Menghapus…');
    try {
      await sbDelete('beban_villa', id);
      setData((sebelum) => (sebelum ?? []).filter((b) => b.id !== id));
      toast.sukses('Baris dihapus.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (data === null && !galat) return <Memuat pesan="Memuat beban villa…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
        Kategori <b>Opex</b> dan <b>Marketing</b> di sini mengikuti model akad villa sendiri — dihitung
        sebagai persentase tetap dari omzet kotor (villa sudah berhenti mencatat opex secara rincian
        aktual bulanan), bukan rincian biaya satuan. Gunakan <b>Lainnya</b> untuk biaya di luar itu.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {KATEGORI_BEBAN_VILLA.map((k) => (
          <KartuStat
            key={k.id}
            label={k.label}
            nilai={rupiah(bulanTerpilihRingkasan?.perKategori[k.id] ?? 0)}
            catatan={labelBulanPeriode(bulanKePeriode(bulan))}
            ikon="kas-keluar"
            nada={k.id === 'lainnya' ? 'slate' : 'amber'}
          />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
        <Panel judul="Input Beban Villa" ikon="kas-keluar">
          <div className="grid gap-3 sm:grid-cols-2">
            <Bidang
              label="Bulan"
              htmlFor="bv-bulan"
              anak={
                <input
                  id="bv-bulan"
                  type="month"
                  className="input"
                  value={bulan}
                  onChange={(e) => setBulan(e.target.value)}
                />
              }
            />
            <Bidang
              label="Kategori"
              anak={
                <select
                  className="input"
                  value={kategori}
                  onChange={(e) => setKategori(e.target.value as KategoriBebanVilla)}
                >
                  {KATEGORI_BEBAN_VILLA.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              }
            />
            <Bidang label="Jumlah" span anak={<InputRupiah id="bv-jumlah" nilai={jumlah} onUbah={setJumlah} />} />
            <Bidang
              label="Keterangan"
              span
              anak={
                <input
                  className="input"
                  placeholder="Opsional…"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                />
              }
            />
          </div>

          <button className="btn-amber mt-4 w-full" onClick={() => void simpan()}>
            <Icon name="kas-keluar" className="h-4 w-4" /> Simpan Beban Villa
          </button>

          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10.5px] leading-relaxed text-slate-500">
            Total tahun {bulan.slice(0, 4)} berjalan (semua kategori):{' '}
            <b className="text-slate-700">{rupiah(totalTahunBerjalan)}</b>
          </p>
        </Panel>

        <Panel judul={`Riwayat Beban Villa — ${data?.length ?? 0} baris`} ikon="buku" padat>
          {!data || data.length === 0 ? (
            <Kosong pesan="Belum ada beban villa tercatat." ikon="kas-keluar" />
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {perBulan.map(([periode, baris]) => {
                const ringkas = ringkasBebanVilla(baris);
                return (
                  <div key={periode} className="border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between bg-slate-50/70 px-4 py-1.5">
                      <span className="text-[11px] font-bold text-slate-600">
                        {labelBulanPeriode(periode)}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        {rupiah(ringkas.total)}
                      </span>
                    </div>
                    <table className="tbl">
                      <tbody>
                        {baris.map((b) => (
                          <tr key={b.id}>
                            <td className="w-28">
                              <Badge nada="amber" anak={labelKategoriBebanVilla(b.kategori)} />
                            </td>
                            <td className="text-slate-500">{b.keterangan || '-'}</td>
                            <td className="w-24">
                              <Badge
                                nada={b.sumber === 'manual' ? 'slate' : 'blue'}
                                anak={b.sumber === 'manual' ? 'Manual' : 'Sinkronisasi'}
                              />
                            </td>
                            <td className="w-32 text-right font-mono font-semibold text-slate-700">
                              {rupiah(b.jumlah)}
                            </td>
                            <td className="w-10 text-right">
                              <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-rose-500"
                                title="Hapus"
                                onClick={() => void hapus(b.id)}
                              >
                                <Icon name="sampah" className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
