'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, DenganModel } from '@/components/cfo/Ui';
import type { ModelCfo } from '@/lib/cfo/model';
import { angka, labelBulan, rp } from '@/lib/cfo/util';
import { sbQuery, sbRpc } from '@/lib/supabase';

/**
 * Buku besar & periode (Tahap 2a, migrasi 0069): pemetaan proyek → properti,
 * bagan akun di database, dan tutup/buka periode bulanan.
 */
export default function HalamanBukuBesar() {
  useJudul({ judul: 'Buku Besar & Periode', deskripsi: 'Dimensi properti, bagan akun, dan kunci periode bulanan', tampilkanFilter: false });
  return <DenganModel>{(m) => <Isi m={m} />}</DenganModel>;
}

interface Pemetaan { proyek: string; properti_kode: string; dasar: string; disetujui_oleh: string | null }
interface Properti { kode: string; nama: string; lini: string; status: string }
interface Akun { kode: string; asal: 'coa_lama' | 'baru' }

function Isi({ m }: { m: ModelCfo }) {
  const { data, muatUlang } = useCfo();
  const [master, setMaster] = useState<{ pemetaan: Pemetaan[]; properti: Properti[]; akun: Akun[] } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const muatMaster = useCallback(async () => {
    try {
      const [pemetaan, properti, akun] = await Promise.all([
        sbQuery<Pemetaan>('fin_pemetaan_proyek', 'select=proyek,properti_kode,dasar,disetujui_oleh&order=proyek'),
        sbQuery<Properti>('fin_properti', 'select=kode,nama,lini,status&order=kode'),
        sbQuery<Akun>('fin_akun', 'select=kode,asal'),
      ]);
      setMaster({ pemetaan, properti, akun });
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => void muatMaster(), [muatMaster]);

  const bulan = useMemo(() => {
    const g = new Map<string, { d: number; k: number; n: number }>();
    for (const j of data?.jurnal_bulanan ?? []) {
      const x = g.get(j.bulan) ?? { d: 0, k: 0, n: 0 };
      x.d += angka(j.d);
      x.k += angka(j.k);
      x.n += angka(j.n);
      g.set(j.bulan, x);
    }
    const status = new Map((data?.fin_periode ?? []).map((p) => [p.periode, p]));
    return [...g.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([b, x]) => ({ bulan: b, ...x, seimbang: Math.abs(x.d - x.k) <= 1, periode: status.get(b) ?? null, berjalan: b >= m.hariIni.slice(0, 7) }));
  }, [data, m.hariIni]);

  const proyekJurnal = useMemo(() => [...new Set((data?.jurnal_bulanan ?? []).map((j) => (j.proyek ?? '').toUpperCase().trim()).filter(Boolean))], [data]);

  if (!data?.fin_periode || galat) {
    return (
      <Panel judul="Struktur buku besar belum aktif" ikon="peringatan">
        <p className="text-[12px] text-slate-600">
          Tabel buku besar berdimensi dan kunci periode (migrasi 0069) belum diterapkan di database{galat ? ` (${galat})` : ''}.
        </p>
      </Panel>
    );
  }

  async function tutup(b: string) {
    if (!window.confirm(`Tutup periode ${labelBulan(b)}? Setelah ditutup, jurnal bertanggal di bulan ini tidak bisa ditambah, diubah, atau dihapus; koreksi dicatat sebagai jurnal penyesuaian di bulan yang masih buka.`)) return;
    setSibuk(b);
    setPesan(null);
    try {
      const r = await sbRpc<{ status: string }>('fin_tutup_periode', { p_periode: `${b}-01`, p_catatan: null });
      setPesan(r.status === 'ditutup' ? `${labelBulan(b)} ditutup.` : `${labelBulan(b)} sudah ditutup sebelumnya.`);
      muatUlang();
    } catch (e) {
      setPesan(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function buka(b: string) {
    const alasan = window.prompt(`Alasan membuka kembali ${labelBulan(b)} (tercatat di audit log):`);
    if (!alasan) return;
    setSibuk(b);
    setPesan(null);
    try {
      await sbRpc('fin_buka_periode', { p_periode: `${b}-01`, p_alasan: alasan });
      setPesan(`${labelBulan(b)} dibuka kembali.`);
      muatUlang();
    } catch (e) {
      setPesan(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  const belumDitutup = bulan.filter((b) => !b.berjalan && b.periode?.status !== 'ditutup').length;
  const tanpaPemetaan = master ? proyekJurnal.filter((p) => !master.pemetaan.some((x) => x.proyek === p)) : [];

  return (
    <div className="space-y-4">
      <Panel judul={`Periode bulanan${belumDitutup ? ` — ${belumDitutup} bulan lampau belum ditutup` : ''}`} ikon="kalender" padat>
        {pesan ? <p className="px-4 pt-3 text-[12px] text-slate-700">{pesan}</p> : null}
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Bulan</th>
                <th className="text-right">Baris jurnal</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Kredit</th>
                <th>Seimbang</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bulan.map((b) => (
                <tr key={b.bulan}>
                  <td>{labelBulan(b.bulan)}</td>
                  <td className="text-right font-mono">{b.n}</td>
                  <td className="text-right font-mono">{rp(b.d)}</td>
                  <td className="text-right font-mono">{rp(b.k)}</td>
                  <td>{b.seimbang ? '✓' : <span className="text-rose-600">selisih {rp(b.d - b.k)}</span>}</td>
                  <td>{b.berjalan ? 'Berjalan' : b.periode?.status === 'ditutup' ? <span className="font-semibold text-emerald-700">Ditutup</span> : 'Buka'}</td>
                  <td className="text-right">
                    {!b.berjalan && b.periode?.status !== 'ditutup' ? (
                      <button className="btn-green px-2 py-1 text-[11px]" disabled={!b.seimbang || sibuk !== null} onClick={() => void tutup(b.bulan)} title={b.seimbang ? '' : 'Debit dan kredit harus seimbang dulu'}>
                        Tutup
                      </button>
                    ) : null}
                    {b.periode?.status === 'ditutup' ? (
                      <button className="btn-ghost px-2 py-1 text-[11px]" disabled={sibuk !== null} onClick={() => void buka(b.bulan)}>Buka kembali</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3 pt-2">
          <Catatan>
            Menutup bulan membuat angkanya tidak bisa berubah diam-diam — syarat yang biasa diminta investor dan auditor. Hanya bulan lampau yang debit = kredit yang bisa ditutup.
            Membuka kembali hanya oleh owner, wajib alasan, dan tercatat di audit log.
          </Catatan>
        </div>
      </Panel>

      {master ? (
        <>
          <Panel judul="Pemetaan proyek jurnal → properti" ikon="rumah" padat>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>Proyek jurnal</th><th>Properti</th><th>Dasar</th><th>Disetujui</th></tr>
                </thead>
                <tbody>
                  {master.pemetaan.map((p) => (
                    <tr key={p.proyek}>
                      <td className="font-mono">{p.proyek}</td>
                      <td>{master.properti.find((x) => x.kode === p.properti_kode)?.nama ?? p.properti_kode}</td>
                      <td className="text-[11.5px] text-slate-600">{p.dasar}</td>
                      <td className="text-[11.5px]">{p.disetujui_oleh ?? <span className="text-amber-600">belum</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tanpaPemetaan.length ? (
              <p className="px-4 py-2 text-[12px] text-rose-600">Proyek di jurnal tanpa pemetaan: {tanpaPemetaan.join(', ')}.</p>
            ) : null}
          </Panel>
          <Panel judul="Bagan akun (database)" ikon="buku">
            <p className="text-[12px] text-slate-600">
              {master.akun.filter((a) => a.asal === 'coa_lama').length} akun lama (kode & nama sama persis dengan COA aplikasi) +{' '}
              {master.akun.filter((a) => a.asal === 'baru').length} akun baru untuk laporan institusional (piutang OTA, persediaan unit, akrual, utang pajak,
              pendapatan kamar, OPEX hospitality per kategori, penyusutan, bunga, PPh). Akun baru mulai dipakai saat mesin posting (Tahap 2b) aktif.
            </p>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
