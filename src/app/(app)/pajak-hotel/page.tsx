'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useSesi } from '@/components/shell/SesiProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Badge, Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { KartuStat } from '@/components/ui/Kartu';
import { Bidang, InputRupiah } from '@/components/ui/Form';
import { fmtAbs, rupiah, tanggalPendek } from '@/lib/format';
import { PERUSAHAAN } from '@/lib/config';
import { sbInsert, sbQuery, sbUpdateWhere } from '@/lib/supabase';
import { labelBulanPeriode } from '@/lib/villa';
import {
  DASAR_PAJAK_BAWAAN,
  LABEL_DASAR,
  TARIF_PAJAK_BAWAAN,
  dasarPengenaan,
  hitungPajak,
  susunBarisPajak,
  type BarisPajak,
  type DasarPajak,
  type LaporanVillaBulanan,
  type PajakHotelVilla,
  type StatusSetoran,
} from '@/lib/villa-laporan';

/**
 * Rekap pajak hotel (PBJT jasa perhotelan) Loonars Villa untuk Dispenda.
 * Angka dasar = laporan keuangan villa apa adanya (kiriman harian villa-api,
 * migrasi 0054). Tarif (bawaan 10%) dan dasar (kotor/bersih) mengikuti
 * aturan Dispenda daerah dan bisa diubah per bulan; tidak ada penyesuaian
 * angka. Setoran dicatat di sini; angka dasarnya dibekukan saat dicatat.
 */
export default function HalamanPajakHotel() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiPajakHotel />
    </GuardHalaman>
  );
}

const NADA_STATUS: Record<StatusSetoran, 'red' | 'amber' | 'green' | 'blue'> = {
  belum: 'red',
  sebagian: 'amber',
  lunas: 'green',
  lebih: 'blue',
};
const LABEL_STATUS: Record<StatusSetoran, string> = {
  belum: 'Belum disetor',
  sebagian: 'Kurang',
  lunas: 'Lunas',
  lebih: 'Lebih setor',
};

function IsiPajakHotel() {
  const sesi = useSesi();
  const toast = useToast();
  const [laporan, setLaporan] = useState<LaporanVillaBulanan[] | null>(null);
  const [pajak, setPajak] = useState<PajakHotelVilla[]>([]);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pilih, setPilih] = useState<string>('');

  const [tarif, setTarif] = useState(TARIF_PAJAK_BAWAAN);
  const [dasar, setDasar] = useState<DasarPajak>(DASAR_PAJAK_BAWAAN);
  const [disetor, setDisetor] = useState(0);
  const [tglSetor, setTglSetor] = useState('');
  const [bukti, setBukti] = useState('');
  const [catatan, setCatatan] = useState('');

  useJudul({
    judul: 'Pajak Hotel (Dispenda)',
    deskripsi: 'Rekap pajak hotel villa dari angka transaksi sebenarnya — dasar & tarif mengikuti aturan Dispenda',
  });

  const muat = useCallback(async () => {
    setGalat(null);
    try {
      const [l, p] = await Promise.all([
        sbQuery<LaporanVillaBulanan>('laporan_villa_bulanan', 'select=*&order=periode.desc&limit=24'),
        sbQuery<PajakHotelVilla>('pajak_hotel_villa', 'select=*'),
      ]);
      setLaporan(l);
      setPajak(p);
      setPilih((s) => s || l[0]?.periode || '');
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  // Isi formulir dari baris pajak bulan terpilih (atau bawaan).
  useEffect(() => {
    const p = pajak.find((x) => x.periode === pilih);
    setTarif(p ? Number(p.tarif_pct) : TARIF_PAJAK_BAWAAN);
    setDasar(p?.dasar ?? DASAR_PAJAK_BAWAAN);
    setDisetor(p?.jumlah_disetor ? Number(p.jumlah_disetor) : 0);
    setTglSetor(p?.tgl_setor ?? '');
    setBukti(p?.bukti_ref ?? '');
    setCatatan(p?.catatan ?? '');
  }, [pilih, pajak]);

  const baris: BarisPajak[] = useMemo(
    () => (laporan ?? []).map((l) => susunBarisPajak(l, pajak.find((p) => p.periode === l.periode) ?? null)),
    [laporan, pajak],
  );
  const totalTerutang = baris.reduce((s, b) => s + b.pajakTerutang, 0);
  const totalDisetor = baris.reduce((s, b) => s + b.disetor, 0);
  const totalKurang = baris.reduce((s, b) => s + b.kurang, 0);

  async function simpan() {
    const lap = (laporan ?? []).find((l) => l.periode === pilih);
    if (!lap) return;
    if (!(tarif >= 0 && tarif <= 100)) {
      toast.galat('Tarif harus antara 0 dan 100%.');
      return;
    }
    setSibuk('Menyimpan pajak hotel…');
    try {
      const dasarAngka = dasarPengenaan(lap, dasar);
      // Angka dibekukan hanya saat setoran dicatat; sebelum itu pajak selalu
      // dihitung ulang dari laporan terbaru.
      const beku = disetor > 0;
      const isi = {
        tarif_pct: tarif,
        dasar,
        dasar_pengenaan: beku ? dasarAngka : null,
        pajak_terutang: beku ? hitungPajak(dasarAngka, tarif) : null,
        jumlah_disetor: beku ? disetor : null,
        tgl_setor: beku && tglSetor ? tglSetor : null,
        bukti_ref: bukti || null,
        catatan: catatan || null,
        dicatat_oleh: sesi.email,
        diperbarui_pada: new Date().toISOString(),
      };
      const ada = pajak.some((p) => p.periode === pilih);
      const [hasil] = ada
        ? await sbUpdateWhere<PajakHotelVilla>('pajak_hotel_villa', `periode=eq.${pilih}`, isi)
        : await sbInsert<PajakHotelVilla>('pajak_hotel_villa', [{ periode: pilih, ...isi }]);
      setPajak((s) => [...s.filter((p) => p.periode !== pilih), hasil]);
      toast.sukses('Tersimpan.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (laporan === null && !galat) return <Memuat pesan="Memuat rekap pajak hotel…" />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat()} />;

  const lapPilih = (laporan ?? []).find((l) => l.periode === pilih);
  const pratinjau = lapPilih ? hitungPajak(dasarPengenaan(lapPilih, dasar), tarif) : 0;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <div className="no-print rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-900">
        Rekap ini memakai <b>angka transaksi villa yang sebenarnya</b> (sama dengan laporan keuangan villa). Tarif
        bawaan <b>10%</b> dan dasar bawaan <b>kotor</b> (total dibayar tamu, sebelum komisi OTA). Dasar dan tarif
        mengikuti Perda daerah — tanyakan ke Dispenda secara tertulis apakah komisi OTA boleh dikurangkan, baru ubah
        dasarnya ke &ldquo;bersih&rdquo;.
      </div>

      <div className="no-print grid gap-3 sm:grid-cols-3">
        <KartuStat label="Pajak terutang (semua bulan)" nilai={rupiah(totalTerutang)} catatan={`${baris.length} bulan`} ikon="kotak" nada="amber" />
        <KartuStat label="Sudah disetor" nilai={rupiah(totalDisetor)} ikon="dompet" nada="emerald" />
        <KartuStat label="Belum disetor" nilai={rupiah(totalKurang)} ikon="kas-keluar" nada={totalKurang > 0 ? 'rose' : 'emerald'} />
      </div>

      {baris.length === 0 ? (
        <Kosong pesan="Belum ada laporan keuangan villa yang diterima. Dikirim otomatis tiap malam dari sistem villa." ikon="kotak" />
      ) : (
        <div className="no-print grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
          <Panel judul={`Catat setoran — ${labelBulanPeriode(pilih)}`} ikon="dompet">
            <div className="grid gap-3 sm:grid-cols-2">
              <Bidang label="Bulan" span anak={
                <select className="input" value={pilih} onChange={(e) => setPilih(e.target.value)}>
                  {(laporan ?? []).map((l) => <option key={l.periode} value={l.periode}>{labelBulanPeriode(l.periode)}{l.status === 'sementara' ? ' (sementara)' : ''}</option>)}
                </select>
              } />
              <Bidang label="Dasar pengenaan" span anak={
                <select className="input" value={dasar} onChange={(e) => setDasar(e.target.value as DasarPajak)}>
                  {(Object.keys(LABEL_DASAR) as DasarPajak[]).map((d) => <option key={d} value={d}>{LABEL_DASAR[d]}</option>)}
                </select>
              } />
              <Bidang label="Tarif (%)" anak={<input type="number" min={0} max={100} step="0.01" className="input" value={tarif} onChange={(e) => setTarif(Number(e.target.value))} />} />
              <Bidang label="Pajak terutang" anak={<div className="input bg-slate-50 font-mono">{rupiah(pratinjau)}</div>} />
              <Bidang label="Jumlah disetor" span anak={<InputRupiah id="ph-disetor" nilai={disetor} onUbah={setDisetor} />} />
              <Bidang label="Tanggal setor" anak={<input type="date" className="input" value={tglSetor} onChange={(e) => setTglSetor(e.target.value)} />} />
              <Bidang label="No. bukti / NTPN" anak={<input className="input" value={bukti} onChange={(e) => setBukti(e.target.value)} />} />
              <Bidang label="Catatan" span anak={<input className="input" placeholder="Opsional…" value={catatan} onChange={(e) => setCatatan(e.target.value)} />} />
            </div>
            <button className="btn-green mt-4 w-full" onClick={() => void simpan()}>
              <Icon name="dompet" className="h-4 w-4" /> Simpan
            </button>
            <p className="mt-3 text-[10.5px] leading-relaxed text-slate-500">
              Angka dasar dan pajak dibekukan saat jumlah disetor diisi, jadi tidak berubah walau laporan bulan itu
              diperbarui lagi.
            </p>
          </Panel>
          <div className="space-y-3">
            <button className="btn-amber" onClick={() => window.print()}>
              <Icon name="printer" className="h-4 w-4" /> Cetak / Simpan PDF
            </button>
          </div>
        </div>
      )}

      {baris.length > 0 && (
        <div className="laporan-paper">
          <div className="page">
            <div className="lh">
              <div className="text-[13pt] font-bold uppercase tracking-wide">{PERUSAHAAN}</div>
              <div className="mt-0.5 text-[12pt] font-bold uppercase">Rekap Pajak Hotel (PBJT Jasa Perhotelan) — Loonars Villa</div>
              <div className="text-[10pt]">(Disajikan dalam Rupiah)</div>
            </div>
            <table className="lt">
              <thead>
                <tr><td>Bulan</td><td>Omzet kotor</td><td>Bersih</td><td>Dasar</td><td>Tarif</td><td>Dasar pengenaan</td><td>Pajak terutang</td><td>Disetor</td><td>Status</td></tr>
              </thead>
              <tbody>
                {baris.map((b) => (
                  <tr key={b.periode} className="cursor-pointer" onClick={() => setPilih(b.periode)}>
                    <td className="indent">{labelBulanPeriode(b.periode)}{b.status === 'sementara' ? '*' : ''}</td>
                    <td>{fmtAbs(b.omzetKotor)}</td>
                    <td>{fmtAbs(b.pendapatanBersih)}</td>
                    <td>{b.dasar}</td>
                    <td>{b.tarifPct}%</td>
                    <td>{fmtAbs(b.dasarPengenaan)}</td>
                    <td>{fmtAbs(b.pajakTerutang)}</td>
                    <td>{b.disetor > 0 ? `${fmtAbs(b.disetor)}${b.tglSetor ? ` (${tanggalPendek(b.tglSetor)})` : ''}` : '-'}</td>
                    <td><span className="no-print"><Badge nada={NADA_STATUS[b.statusSetoran]} anak={LABEL_STATUS[b.statusSetoran]} /></span><span className="hidden print:inline">{LABEL_STATUS[b.statusSetoran]}</span></td>
                  </tr>
                ))}
                <tr className="double-line">
                  <td>Total</td><td /><td /><td /><td /><td />
                  <td>{fmtAbs(totalTerutang)}</td><td>{fmtAbs(totalDisetor)}</td><td>Kurang {fmtAbs(totalKurang)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-6 text-[9.5pt] leading-relaxed text-slate-500">
              * Bulan berjalan: angka sementara. Omzet kotor = total yang dibayar tamu per booking sebelum komisi OTA;
              bersih = diterima setelah komisi OTA. Booking diakui per bulan check-in; menginap gratis tidak dihitung.
              Dasar pengenaan dan tarif mengikuti ketentuan Dispenda daerah.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
