'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Badge, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { rupiah } from '@/lib/format';
import { hariTerakhir } from '@/lib/periode';
import { getAccessToken, perbaruiToken, sbInsert, sbRpc, sbUpdate } from '@/lib/supabase';
import {
  BAGIAN_LAPORAN,
  BAGIAN_NARASI,
  DATA_BELUM_TERSEDIA,
  DEFINISI_METRIK,
  LABEL_JENIS,
  LABEL_MODEL,
  VERSI_DEFINISI,
  type KunciBagian,
  type KunciNarasi,
} from '@/lib/laporan-investor/kontrak';
import {
  bulanDataPertama,
  bulanIni,
  nilaiMetrik,
  susunModel,
  type DataLaporan,
  type MetrikRow,
  type StatusBulan,
  type UnitBisnis,
} from '@/lib/laporan-investor/model';

/**
 * Laporan Investor — pratinjau & unduh PDF (CFO/owner saja).
 *
 * Data diambil realtime lewat RPC ir_ambil_data (migrasi 0040); PDF dibuat di
 * server (/api/laporan-investor/pdf) dari model yang SAMA dengan pratinjau
 * ini (src/lib/laporan-investor/model.ts), jadi angkanya identik.
 */
export default function HalamanLaporanInvestor() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiLaporanInvestor />
    </GuardHalaman>
  );
}

const NADA_STATUS: Record<StatusBulan, { label: string; nada: 'green' | 'amber' | 'red' | 'slate' }> = {
  lengkap: { label: 'lengkap', nada: 'green' },
  sementara: { label: 'sementara', nada: 'amber' },
  sebagian: { label: 'sebagian', nada: 'amber' },
  kosong: { label: 'kosong', nada: 'red' },
  belum_mulai: { label: 'belum mulai', nada: 'slate' },
};

function akhirBulan(p: string): string {
  const [t, b] = p.split('-').map(Number);
  return `${p}-${String(hariTerakhir(t, b)).padStart(2, '0')}`;
}

function rpAtauKosong(n: number | null | undefined): string {
  return n === null || n === undefined ? DATA_BELUM_TERSEDIA : rupiah(n);
}

function IsiLaporanInvestor() {
  useJudul({
    judul: 'Laporan Investor',
    deskripsi: 'Track record seluruh unit bisnis — realtime, siap diunduh sebagai PDF bertanda Rahasia',
  });

  const toast = useToast();
  const [data, setData] = useState<DataLaporan | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const [sampai, setSampai] = useState(bulanIni());
  const [dari, setDari] = useState<string | null>(null);
  const [unitDipilih, setUnitDipilih] = useState<string[] | null>(null);
  const [bagian, setBagian] = useState<KunciBagian[]>(BAGIAN_LAPORAN.map((b) => b.kunci));

  const muat = useCallback(async (bulanSampai: string) => {
    setGalat(null);
    try {
      const d = await sbRpc<DataLaporan>('ir_ambil_data', { p_sampai: akhirBulan(bulanSampai), p_peminta_wa: null });
      setData(d);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void muat(sampai);
  }, [muat, sampai]);

  const dariEfektif = useMemo(() => {
    if (dari) return dari;
    return data ? bulanDataPertama(data) : sampai;
  }, [dari, data, sampai]);

  const unitAktif = useMemo(() => (data?.unit_bisnis ?? []).filter((u) => u.aktif), [data]);
  const kodeTerpilih = unitDipilih ?? unitAktif.map((u) => u.kode);
  const semuaDipilih = unitDipilih === null;

  const model = useMemo(() => {
    if (!data) return null;
    return susunModel(data, {
      unit: semuaDipilih ? [] : kodeTerpilih,
      dari: dariEfektif <= sampai ? dariEfektif : sampai,
      sampai,
      bagian,
    });
  }, [data, semuaDipilih, kodeTerpilih, dariEfektif, sampai, bagian]);

  async function unduhPdf() {
    if (!model) return;
    setSibuk('Membuat PDF di server…');
    try {
      const body = JSON.stringify({
        dari: model.opsi.dari,
        sampai: model.opsi.sampai,
        unit: model.opsi.unit,
        bagian: model.opsi.bagian,
      });
      const kirim = (token: string | null) =>
        fetch('/api/laporan-investor/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
          body,
        });
      let res = await kirim(getAccessToken());
      if (res.status === 401 || res.status === 403) {
        const baru = await perbaruiToken();
        if (baru) res = await kirim(baru);
      }
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const nama = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'Laporan-Investor.pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nama;
      a.click();
      URL.revokeObjectURL(url);
      toast.sukses('PDF diunduh. Unduhan tercatat di log.');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (!data) {
    if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat(sampai)} />;
    return <Memuat pesan="Mengambil data seluruh unit bisnis…" />;
  }
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muat(sampai)} />;
  if (!model) return null;

  const total = Object.values(model.kelengkapan).reduce((a, b) => a + b, 0);
  const k = model.keuangan;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel
        judul="Pengaturan laporan"
        ikon="filter"
        aksi={
          <button className="btn-primary" onClick={() => void unduhPdf()}>
            <Icon name="unduh" className="h-4 w-4" /> Unduh PDF
          </button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="field-label">Rentang periode</div>
            <div className="flex items-center gap-2">
              <input
                type="month"
                className="input"
                value={dariEfektif}
                onChange={(e) => setDari(e.target.value || null)}
                aria-label="Dari bulan"
              />
              <span className="text-slate-400">s.d.</span>
              <input
                type="month"
                className="input"
                value={sampai}
                onChange={(e) => e.target.value && setSampai(e.target.value)}
                aria-label="Sampai bulan"
              />
            </div>
            <p className="mt-1 text-[10.5px] text-slate-500">
              Default: dari bulan data pertama sampai bulan ini (&quot;sampai saat ini&quot;).{' '}
              {dari ? (
                <button className="underline" onClick={() => setDari(null)}>
                  Kembalikan
                </button>
              ) : null}
            </p>
          </div>

          <div>
            <div className="field-label">Unit bisnis</div>
            <label className="mb-1 flex items-center gap-2 text-[12px] font-semibold">
              <input type="checkbox" checked={semuaDipilih} onChange={() => setUnitDipilih(semuaDipilih ? [] : null)} />
              Gabungan seluruh unit aktif
            </label>
            <div className="max-h-36 space-y-0.5 overflow-auto rounded border border-slate-200 p-2">
              {unitAktif.map((u) => (
                <label key={u.kode} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={kodeTerpilih.includes(u.kode)}
                    onChange={(e) => {
                      const dasar = unitDipilih ?? unitAktif.map((x) => x.kode);
                      setUnitDipilih(e.target.checked ? [...dasar, u.kode] : dasar.filter((x) => x !== u.kode));
                    }}
                  />
                  {u.nama} <span className="text-slate-400">· {LABEL_JENIS[u.jenis]}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="field-label">Bagian yang dimasukkan</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {BAGIAN_LAPORAN.map((b) => (
                <label key={b.kunci} className="flex items-center gap-1.5 text-[11.5px]">
                  <input
                    type="checkbox"
                    checked={bagian.includes(b.kunci)}
                    onChange={(e) =>
                      setBagian((x) => (e.target.checked ? [...x, b.kunci] : x.filter((y) => y !== b.kunci)))
                    }
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <Panel judul={`Pratinjau — ${model.labelRentang}`} ikon="grafik">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Angka label="Pendapatan (buku besar)" nilai={rpAtauKosong(k?.labaRugi.pendapatan.total)} />
          <Angka label="Laba operasional" nilai={rpAtauKosong(k?.labaRugi.labaSebelumPajak)} />
          <Angka label="Kas & bank akhir" nilai={rpAtauKosong(k ? k.rincianKas.reduce((a, b) => a + b.nilai, 0) : null)} />
          <Angka label="Total liabilitas" nilai={rpAtauKosong(k?.posisiKeuangan.totalLiabilitas)} />
        </div>
        <p className="mt-2 text-[10.5px] text-slate-500">
          Dihitung dengan mesin laporan SAK EMKM aplikasi untuk kode proyek {model.kodeProyekKeuangan.join(', ') || '-'}. Data
          diambil {new Date(model.dibuatPada).toLocaleString('id-ID')}.
        </p>

        <h3 className="mt-4 text-[12px] font-bold text-slate-700">
          Kelengkapan data ({model.kelengkapan.lengkap}/{total} unit-bulan lengkap)
        </h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2">Unit</th>
                {model.bulan.map((b) => (
                  <th key={b} className="px-1 py-1">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.unit.map((u) => (
                <tr key={u.unit.kode} className="border-t border-slate-100">
                  <td className="py-1 pr-2 font-semibold">{u.unit.nama}</td>
                  {u.bulan.map((b) => (
                    <td key={b.periode} className="px-1 py-1" title={b.catatan.join(' ')}>
                      <Badge anak={NADA_STATUS[b.status].label + (b.parsial ? '*' : '')} nada={NADA_STATUS[b.status].nada} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">* bulan parsial. Arahkan kursor ke status untuk melihat catatan.</p>
        </div>

        {model.temuan.length ? (
          <>
            <h3 className="mt-4 text-[12px] font-bold text-slate-700">Temuan pemeriksaan data (ikut tercetak di PDF)</h3>
            <ul className="mt-1 space-y-1 text-[11.5px]">
              {model.temuan.map((t, i) => (
                <li key={i} className={t.tingkat === 'perhatian' ? 'text-red-700' : 'text-slate-600'}>
                  • {t.unit ? <b>[{t.unit}] </b> : null}
                  {t.teks}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h3 className="mt-4 text-[12px] font-bold text-slate-700">Portofolio</h3>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Unit</th>
                <th>Jenis</th>
                <th className="text-right">Pendapatan</th>
                <th className="text-right">Laba op.</th>
                <th className="text-right">Kas akhir</th>
                <th className="text-right">Okupansi terakhir</th>
              </tr>
            </thead>
            <tbody>
              {model.unit.map((u) => {
                const terakhir = [...u.bulan].reverse().find((b) => nilaiMetrik(b, 'okupansi_unit_total_pct') !== null);
                return (
                  <tr key={u.unit.kode} className="border-t border-slate-100">
                    <td className="py-1 font-semibold">{u.unit.nama}</td>
                    <td>{LABEL_JENIS[u.unit.jenis]}</td>
                    <td className="text-right">
                      {u.unit.jenis === 'operasi_properti'
                        ? rpAtauKosong(u.total.pendapatanBasisInvestor)
                        : rpAtauKosong(u.total.pendapatan)}
                    </td>
                    <td className="text-right">{rpAtauKosong(u.total.laba)}</td>
                    <td className="text-right">{rpAtauKosong(u.total.kasAkhir)}</td>
                    <td className="text-right">
                      {u.unit.jenis === 'operasi_properti'
                        ? terakhir
                          ? `${nilaiMetrik(terakhir, 'okupansi_unit_total_pct')}% (${terakhir.label})`
                          : DATA_BELUM_TERSEDIA
                        : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <PanelNarasi data={data} onTersimpan={() => void muat(sampai)} toast={toast} />
      <PanelUnitBisnis units={data.unit_bisnis} onTersimpan={() => void muat(sampai)} toast={toast} />
      <PanelMetrikManual units={unitAktif} metrik={data.metrik} onTersimpan={() => void muat(sampai)} toast={toast} />
    </div>
  );
}

function Angka({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-[10.5px] text-slate-500">{label}</div>
      <div className="text-[15px] font-bold text-slate-800">{nilai}</div>
    </div>
  );
}

type Toaster = ReturnType<typeof useToast>;

function PanelNarasi({ data, onTersimpan, toast }: { data: DataLaporan; onTersimpan: () => void; toast: Toaster }) {
  const [bagian, setBagian] = useState<KunciNarasi>('ringkasan');
  const [isi, setIsi] = useState('');
  const versi = data.narasi[bagian];

  useEffect(() => {
    setIsi(data.narasi[bagian]?.isi ?? '');
  }, [bagian, data.narasi]);

  async function simpan() {
    try {
      await sbInsert('ir_narasi', [{ bagian, isi }]);
      toast.sukses('Narasi disimpan sebagai versi baru.');
      onTersimpan();
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Panel judul="Narasi manual (berversi)" ikon="pensil">
      <div className="flex flex-wrap gap-2">
        {BAGIAN_NARASI.map((b) => (
          <button
            key={b.kunci}
            className={`btn-xs ${bagian === b.kunci ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            onClick={() => setBagian(b.kunci)}
          >
            {b.label}
          </button>
        ))}
      </div>
      <textarea
        className="input mt-2 min-h-[140px] w-full"
        value={isi}
        onChange={(e) => setIsi(e.target.value)}
        placeholder="Tulis narasi. Pisahkan paragraf dengan baris kosong. Proyeksi harus diberi label sebagai perkiraan."
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10.5px] text-slate-500">
          {versi
            ? `Versi terakhir: ${new Date(versi.dibuat_pada).toLocaleString('id-ID')} oleh ${versi.dibuat_oleh}. Menyimpan membuat versi baru; versi lama tetap tersimpan.`
            : 'Belum ada versi tersimpan.'}
        </span>
        <button className="btn-primary" onClick={() => void simpan()} disabled={!isi.trim()}>
          Simpan versi baru
        </button>
      </div>
    </Panel>
  );
}

function PanelUnitBisnis({ units, onTersimpan, toast }: { units: UnitBisnis[]; onTersimpan: () => void; toast: Toaster }) {
  const kosong = {
    kode: '',
    nama: '',
    jenis: 'operasi_properti' as UnitBisnis['jenis'],
    kota: '',
    tgl_mulai_operasi: '',
    jumlah_unit_total: '',
    jumlah_unit_dijual: '',
    model_kepemilikan: '',
    kode_proyek_jurnal: '',
    sumber_data: 'manual',
  };
  const [f, setF] = useState(kosong);

  async function tambah() {
    try {
      await sbInsert('ir_unit_bisnis', [
        {
          kode: f.kode.trim().toLowerCase(),
          nama: f.nama.trim(),
          jenis: f.jenis,
          kota: f.kota.trim() || null,
          tgl_mulai_operasi: f.tgl_mulai_operasi || null,
          jumlah_unit_total: f.jumlah_unit_total ? Number(f.jumlah_unit_total) : null,
          jumlah_unit_dijual: f.jumlah_unit_dijual ? Number(f.jumlah_unit_dijual) : null,
          model_kepemilikan: f.model_kepemilikan || null,
          kode_proyek_jurnal: f.kode_proyek_jurnal
            .split(',')
            .map((x) => x.trim().toUpperCase())
            .filter(Boolean),
          sumber_data: f.sumber_data.trim() || 'manual',
        },
      ]);
      toast.sukses(`Unit "${f.nama}" ditambahkan — langsung ikut laporan.`);
      setF(kosong);
      onTersimpan();
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function ubahAktif(u: UnitBisnis) {
    try {
      await sbUpdate('ir_unit_bisnis', u.id, { aktif: !u.aktif, diubah_pada: new Date().toISOString() });
      onTersimpan();
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Panel judul="Unit bisnis (properti & proyek)" ikon="rumah">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1">Kode</th>
            <th>Nama</th>
            <th>Jenis</th>
            <th>Kota</th>
            <th>Mulai</th>
            <th>Unit total / dijual</th>
            <th>Model</th>
            <th>Kode jurnal</th>
            <th>Sumber</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id} className={`border-t border-slate-100 ${u.aktif ? '' : 'opacity-50'}`}>
              <td className="py-1 font-mono">{u.kode}</td>
              <td className="font-semibold">{u.nama}</td>
              <td>{LABEL_JENIS[u.jenis]}</td>
              <td>{u.kota ?? '-'}</td>
              <td>{u.tgl_mulai_operasi ?? '-'}</td>
              <td>
                {u.jumlah_unit_total ?? '-'} / {u.jumlah_unit_dijual ?? 'belum diisi'}
              </td>
              <td>{u.model_kepemilikan ? LABEL_MODEL[u.model_kepemilikan] : 'belum diisi'}</td>
              <td className="font-mono">{u.kode_proyek_jurnal.join(', ') || '-'}</td>
              <td>{u.sumber_data}</td>
              <td>
                <button className="btn-xs bg-slate-100 text-slate-600" onClick={() => void ubahAktif(u)}>
                  {u.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mt-4 text-[12px] font-bold text-slate-700">Tambah properti / proyek baru</h3>
      <p className="text-[10.5px] text-slate-500">
        Cukup satu baris ini. Angka buku besar otomatis diambil dari kode jurnal; KPI operasi dikirim sistem properti lewat RPC{' '}
        <code>ir_metrik_terima</code> (kontrak {VERSI_DEFINISI}) atau diisi manual di panel bawah. Kode modul tidak perlu diubah.
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-5">
        <input className="input" placeholder="kode (mis. villa-2)" value={f.kode} onChange={(e) => setF({ ...f, kode: e.target.value })} />
        <input className="input" placeholder="Nama" value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} />
        <select className="input" value={f.jenis} onChange={(e) => setF({ ...f, jenis: e.target.value as UnitBisnis['jenis'] })}>
          <option value="operasi_properti">Operasi properti</option>
          <option value="proyek_pembangunan">Proyek pembangunan</option>
        </select>
        <input className="input" placeholder="Kota" value={f.kota} onChange={(e) => setF({ ...f, kota: e.target.value })} />
        <input
          className="input"
          type="date"
          value={f.tgl_mulai_operasi}
          onChange={(e) => setF({ ...f, tgl_mulai_operasi: e.target.value })}
          aria-label="Tanggal mulai operasi"
        />
        <input className="input" type="number" min={0} placeholder="Unit total" value={f.jumlah_unit_total} onChange={(e) => setF({ ...f, jumlah_unit_total: e.target.value })} />
        <input className="input" type="number" min={0} placeholder="Unit dijual" value={f.jumlah_unit_dijual} onChange={(e) => setF({ ...f, jumlah_unit_dijual: e.target.value })} />
        <select className="input" value={f.model_kepemilikan} onChange={(e) => setF({ ...f, model_kepemilikan: e.target.value })}>
          <option value="">Model kepemilikan…</option>
          <option value="milik_sendiri">Milik sendiri</option>
          <option value="sewa">Sewa</option>
          <option value="kontrak_manajemen">Kontrak manajemen</option>
        </select>
        <input className="input" placeholder="Kode jurnal (mis. LL, LC)" value={f.kode_proyek_jurnal} onChange={(e) => setF({ ...f, kode_proyek_jurnal: e.target.value })} />
        <input className="input" placeholder="Sumber data" value={f.sumber_data} onChange={(e) => setF({ ...f, sumber_data: e.target.value })} />
      </div>
      <button className="btn-primary mt-2" onClick={() => void tambah()} disabled={!f.kode.trim() || !f.nama.trim()}>
        <Icon name="plus" className="h-4 w-4" /> Tambah unit bisnis
      </button>
    </Panel>
  );
}

const KUNCI_ANGKA = DEFINISI_METRIK.filter((d) => d.satuan !== 'rincian' && d.satuan !== 'teks');

function PanelMetrikManual({
  units,
  metrik,
  onTersimpan,
  toast,
}: {
  units: UnitBisnis[];
  metrik: MetrikRow[];
  onTersimpan: () => void;
  toast: Toaster;
}) {
  const [unitId, setUnitId] = useState<number | ''>('');
  const [periode, setPeriode] = useState(bulanIni());
  const [kunci, setKunci] = useState(KUNCI_ANGKA[0].kunci);
  const [nilai, setNilai] = useState('');
  const SUMBER = 'manual-cfo';

  async function simpan() {
    if (unitId === '' || nilai === '' || !Number.isFinite(Number(nilai))) return;
    try {
      const ada = metrik.find((m) => m.unit_id === unitId && m.periode === periode && m.sumber === SUMBER);
      if (ada) {
        await sbUpdate('ir_metrik_bulanan', ada.id, {
          metrik: { ...ada.metrik, [kunci]: Number(nilai) },
          versi_definisi: VERSI_DEFINISI,
          diterima_pada: new Date().toISOString(),
        });
      } else {
        await sbInsert('ir_metrik_bulanan', [
          { unit_id: unitId, periode, sumber: SUMBER, metrik: { [kunci]: Number(nilai) }, versi_definisi: VERSI_DEFINISI, status: 'sementara' },
        ]);
      }
      toast.sukses('Metrik tersimpan (sumber: manual-cfo). Perubahan tercatat di riwayat.');
      setNilai('');
      onTersimpan();
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <Panel judul="Input metrik manual (untuk properti tanpa sistem)" ikon="dokumen">
      <p className="text-[10.5px] text-slate-500">
        Dipakai bila sebuah properti belum punya sistem yang mengirim KPI. Tercatat sebagai sumber &quot;manual-cfo&quot; berstatus
        sementara dan ditandai di lampiran PDF.
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-5">
        <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Unit…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nama}
            </option>
          ))}
        </select>
        <input className="input" type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} aria-label="Periode" />
        <select className="input" value={kunci} onChange={(e) => setKunci(e.target.value)}>
          {KUNCI_ANGKA.map((d) => (
            <option key={d.kunci} value={d.kunci}>
              {d.label}
            </option>
          ))}
        </select>
        <input className="input" type="number" placeholder="Nilai" value={nilai} onChange={(e) => setNilai(e.target.value)} />
        <button className="btn-primary" onClick={() => void simpan()} disabled={unitId === '' || nilai === ''}>
          Simpan
        </button>
      </div>
    </Panel>
  );
}
