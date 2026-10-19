'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useJudul } from '@/components/shell/JudulProvider';
import { useSesi } from '@/components/shell/SesiProvider';
import { TampilanPelaksana } from './TampilanPelaksana';
import { Icon } from '@/components/ui/Icon';
import { Badge, Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { KartuStat } from '@/components/ui/Kartu';
import { Bidang, InputRupiah } from '@/components/ui/Form';
import { rupiah, tanggalPendek } from '@/lib/format';
import { PanelBorongan, PanelRab, PanelUnitDibangun } from './BoronganRab';
import { sbDelete, sbInsert, sbQuery, sbRpc, sbUpdate, sbUpdateWhere } from '@/lib/supabase';
import {
  KATEGORI_PENGELUARAN,
  LABEL_STATUS_BANGUN,
  LABEL_STATUS_UNIT,
  tokoAda,
  type L2Alokasi,
  type L2Audit,
  type L2Borongan,
  type L2Cicilan,
  type L2Pengajuan,
  type L2Pengaturan,
  type L2Pengeluaran,
  type L2PenggunaWa,
  type L2Rab,
  type L2Receipt,
  type L2Rekening,
  type L2Ringkasan,
  type L2TipeUnit,
  type L2Toko,
  type L2Unit,
  type L2Utang,
} from '@/lib/loonars2';

/**
 * Dashboard Keuangan Loonars 2 (migrasi 0043). Pelengkap WhatsApp: melihat
 * 4 rekening & data, serta mengedit pengaturan/rekening/unit/nomor WA.
 * Semua uang (pembayaran, konfirmasi transfer, pengajuan, pengeluaran)
 * dicatat lewat RPC loonars2_web — hitungannya di database, bukan di sini.
 */
export default function HalamanLoonars2() {
  return (
    <GuardHalaman izinkan={['cfo', 'pelaksana']} atauLoonars2>
      <PilihTampilan />
    </GuardHalaman>
  );
}

/** Owner (CFO) = dashboard penuh; pelaksana = tampilan baca-saja (migrasi 0045). */
function PilihTampilan() {
  const sesi = useSesi();
  return sesi.peran === 'cfo' ? <IsiLoonars2 /> : <TampilanPelaksana />;
}

type Tab = 'ringkasan' | 'unit' | 'pembayaran' | 'pengajuan' | 'borongan' | 'utang' | 'pengeluaran' | 'pengaturan' | 'audit';

const TAB: { id: Tab; label: string }[] = [
  { id: 'ringkasan', label: 'Ringkasan' },
  { id: 'unit', label: 'Unit' },
  { id: 'pembayaran', label: 'Pembayaran' },
  { id: 'pengajuan', label: 'Pengajuan' },
  { id: 'borongan', label: 'Borongan & RAB' },
  { id: 'utang', label: 'Utang Toko' },
  { id: 'pengeluaran', label: 'Pengeluaran' },
  { id: 'pengaturan', label: 'Pengaturan' },
  { id: 'audit', label: 'Audit Log' },
];

interface Data {
  rekening: L2Rekening[];
  unit: L2Unit[];
  tipe: L2TipeUnit[];
  pengaturan: L2Pengaturan;
  receipt: L2Receipt[];
  alokasi: L2Alokasi[];
  pengajuan: L2Pengajuan[];
  pengeluaran: L2Pengeluaran[];
  pengguna: L2PenggunaWa[];
  audit: L2Audit[];
  ringkasan: L2Ringkasan;
  toko: L2Toko[];
  utang: L2Utang[];
  cicilan: L2Cicilan[];
  borongan: L2Borongan[];
  rab: L2Rab[];
  dibangun: { id: number; sedang_dibangun: boolean }[];
}

function pesanGalat(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function IsiLoonars2() {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('ringkasan');

  useJudul({
    judul: 'Keuangan Loonars 2',
    deskripsi: '4 rekening (Penampung, Tanah, Konstruksi & Fee, Profit) — antarmuka utama lewat WhatsApp',
  });

  const muatUlang = useCallback(async () => {
    setGalat(null);
    try {
      const [rekening, unit, tipe, pengaturan, receipt, alokasi, pengajuan, pengeluaran, pengguna, audit, ringkasan, toko, utang, cicilan, borongan, rab, dibangun] =
        await Promise.all([
          sbQuery<L2Rekening>('loonars2_v_rekening', 'select=*&order=kode.asc'),
          sbQuery<L2Unit>('loonars2_v_unit', 'select=*&order=nomor.asc'),
          sbQuery<L2TipeUnit>('loonars2_unit_types', 'select=*&order=id.asc'),
          sbQuery<L2Pengaturan>('loonars2_settings', 'select=*'),
          sbQuery<L2Receipt>('loonars2_receipts', 'select=*&order=id.desc&limit=300'),
          sbQuery<L2Alokasi>('loonars2_allocations', 'select=*&order=id.desc&limit=900'),
          sbQuery<L2Pengajuan>('loonars2_material_requests', 'select=*&order=id.desc&limit=300'),
          sbQuery<L2Pengeluaran>('loonars2_disbursements', 'select=*&order=id.desc&limit=300'),
          sbQuery<L2PenggunaWa>('loonars2_wa_users', 'select=*&order=id.asc'),
          sbQuery<L2Audit>('loonars2_audit_log', 'select=*&order=id.desc&limit=150'),
          sbRpc<L2Ringkasan>('loonars2_web', { p_aksi: 'ringkasan', p_data: {} }),
          sbQuery<L2Toko>('loonars2_v_toko', 'select=*&order=sisa_utang.desc'),
          sbQuery<L2Utang>('loonars2_utang_toko', 'select=*&order=id.desc&limit=300'),
          sbQuery<L2Cicilan>('loonars2_cicilan', 'select=*&order=id.desc&limit=300'),
          sbQuery<L2Borongan>('loonars2_v_borongan', 'select=*&order=id.asc'),
          sbQuery<L2Rab>('loonars2_v_rab_bahan', 'select=*'),
          sbQuery<{ id: number; sedang_dibangun: boolean }>('loonars2_units', 'select=id,sedang_dibangun'),
        ]);
      setData({ rekening, unit, tipe, pengaturan: pengaturan[0], receipt, alokasi, pengajuan, pengeluaran, pengguna, audit, ringkasan, toko, utang, cicilan, borongan, rab, dibangun });
    } catch (e) {
      setGalat(pesanGalat(e));
    }
  }, []);

  useEffect(() => {
    void muatUlang();
  }, [muatUlang]);

  /** Jalankan aksi lalu muat ulang semua data (saldo selalu dari database). */
  async function jalankan(label: string, aksi: () => Promise<unknown>, sukses?: string) {
    setSibuk(label);
    try {
      await aksi();
      if (sukses) toast.sukses(sukses);
      await muatUlang();
    } catch (e) {
      toast.galat(`Gagal: ${pesanGalat(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  const web = (aksi: string, p: Record<string, unknown>) => sbRpc<Record<string, unknown>>('loonars2_web', { p_aksi: aksi, p_data: p });

  if (data === null && !galat) return <Memuat pesan="Memuat keuangan Loonars 2…" />;
  if (galat || !data) return <PesanGalat pesan={galat ?? 'Data tidak tersedia'} onCoba={() => void muatUlang()} />;

  return (
    <div className="space-y-4">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      {data.ringkasan.tertunda > 0 ? <BannerTertunda data={data} jalankan={jalankan} web={web} /> : null}

      <div className="flex flex-wrap gap-1.5">
        {TAB.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn-green px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'pengajuan' && data.pengajuan.some((p) => p.status === 'menunggu') ? (
              <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] text-slate-900">
                {data.pengajuan.filter((p) => p.status === 'menunggu').length}
              </span>
            ) : null}
            {t.id === 'utang' && (data.utang.some((u) => u.status === 'menunggu') || data.cicilan.some((c) => c.status === 'menunggu')) ? (
              <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] text-slate-900">
                {data.utang.filter((u) => u.status === 'menunggu').length + data.cicilan.filter((c) => c.status === 'menunggu').length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'ringkasan' ? <TabRingkasan data={data} /> : null}
      {tab === 'unit' ? <TabUnit data={data} jalankan={jalankan} /> : null}
      {tab === 'pembayaran' ? <TabPembayaran data={data} jalankan={jalankan} web={web} /> : null}
      {tab === 'pengajuan' ? <TabPengajuan data={data} jalankan={jalankan} web={web} /> : null}
      {tab === 'borongan' ? <TabBorongan data={data} /> : null}
      {tab === 'utang' ? <TabUtang data={data} jalankan={jalankan} web={web} /> : null}
      {tab === 'pengeluaran' ? <TabPengeluaran data={data} jalankan={jalankan} web={web} /> : null}
      {tab === 'pengaturan' ? <TabPengaturan data={data} jalankan={jalankan} /> : null}
      {tab === 'audit' ? <TabAudit data={data} /> : null}
    </div>
  );
}

type Jalankan = (label: string, aksi: () => Promise<unknown>, sukses?: string) => Promise<void>;
type Web = (aksi: string, p: Record<string, unknown>) => Promise<Record<string, unknown>>;

function labelUnit(data: Data, id: number | null): string {
  const u = data.unit.find((x) => x.id === id);
  return u ? `${u.nomor}. ${u.kode}` : '-';
}

// ---------------------------------------------------------------------------
// Banner transfer tertunda — selalu di paling atas
// ---------------------------------------------------------------------------
function BannerTertunda({ data, jalankan, web }: { data: Data; jalankan: Jalankan; web: Web }) {
  const menunggu = data.alokasi.filter((a) => a.status === 'menunggu').sort((a, b) => a.id - b.id);
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-red-900">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Icon name="peringatan" className="h-4 w-4" />
        Transfer tertunda: {rupiah(data.ringkasan.tertunda)} masih di rekening A
      </div>
      <p className="mt-1 text-[11px]">
        Selama ini belum dikonfirmasi, pencairan profit diblokir dan setiap pengajuan diberi peringatan.
      </p>
      <table className="tbl mt-2 bg-white/60">
        <tbody>
          {menunggu.map((a) => {
            const re = data.receipt.find((r) => r.id === a.receipt_id);
            return (
              <tr key={a.id}>
                <td className="w-14 font-mono">T{a.id}</td>
                <td>
                  {re ? `${re.jenis.toUpperCase()} unit ${labelUnit(data, re.unit_id)}` : `Receipt #${a.receipt_id}`} — A → {a.ke_rekening}
                </td>
                <td className="w-36 text-right font-mono font-semibold">{rupiah(a.nominal)}</td>
                <td className="w-32 text-right">
                  <button
                    type="button"
                    className="btn-green px-2 py-1 text-[11px]"
                    onClick={() =>
                      void jalankan('Mengonfirmasi transfer…', () => web('konfirmasi', { ids: [a.id] }), `T${a.id} dikonfirmasi`)
                    }
                  >
                    Sudah transfer
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------
function TabRingkasan({ data }: { data: Data }) {
  const p = data.ringkasan.proyeksi_tanah;
  const k = data.ringkasan.kesehatan;
  const terjual = data.unit.filter((u) => u.status === 'dp' || u.status === 'lunas').length;
  const talangan = data.pengeluaran.filter((x) => x.talangan).reduce((s, x) => s + Number(x.nominal), 0);
  const belumTerdanai = data.unit.filter((u) => (u.status === 'dp' || u.status === 'lunas') && !u.terdanai_penuh);
  const nada = { A: 'amber', B: 'emerald', C: 'blue', D: 'violet' } as const;
  const tokoBerutang = data.toko.filter((t) => Number(t.sisa_utang) > 0);
  const totalUtang = tokoBerutang.reduce((s, t) => s + Number(t.sisa_utang), 0);
  const utangMenunggu = data.utang.filter((u) => u.status === 'menunggu').length + data.cicilan.filter((c) => c.status === 'menunggu').length;
  const pengajuanMenunggu = data.pengajuan.filter((x) => x.status === 'menunggu').length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.rekening.map((r) => (
          <KartuStat
            key={r.kode}
            label={`${r.kode} — ${r.nama}`}
            nilai={rupiah(r.saldo)}
            catatan={
              r.kode !== 'A' && r.menunggu_transfer > 0
                ? `+${rupiah(r.menunggu_transfer)} menunggu transfer`
                : r.nomor_rekening
                  ? `${r.bank ?? ''} ${r.nomor_rekening}`
                  : 'Nomor rekening belum diisi'
            }
            ikon={r.kode === 'A' ? 'kotak' : 'bank'}
            nada={nada[r.kode]}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel judul="Dana tanah" ikon="rumah">
          <div className="space-y-1.5 text-[12px] text-slate-700">
            <Baris label="Sudah dialokasikan ke B" nilai={rupiah(p.b_dialokasikan)} />
            <Baris label="Pelunasan terjadwal ke B (sebelum jatuh tempo)" nilai={rupiah(p.pelunasan_terjadwal_ke_b)} />
            <Baris label="Proyeksi" nilai={rupiah(p.proyeksi)} tebal />
            <Baris label="Target" nilai={rupiah(p.target)} />
            <Baris label="Jatuh tempo tanah" nilai={p.jatuh_tempo ? tanggalPendek(p.jatuh_tempo) : 'Belum diisi'} />
          </div>
          {p.kurang > 0 ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
              Proyeksi kurang {rupiah(p.kurang)} — perlu sekitar <b>{p.unit_tambahan} unit tambahan</b> terjual dan lunas sebelum
              jatuh tempo tanah (asumsi: tipe dengan kontribusi ke B terkecil).
            </p>
          ) : (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              Proyeksi mencukupi target tanah.
            </p>
          )}
        </Panel>

        <Panel judul="Kesehatan rekening C" ikon="ceklis">
          <div className="space-y-1.5 text-[12px] text-slate-700">
            <Baris label="Saldo C (terkonfirmasi)" nilai={rupiah(k.saldo_c)} />
            <Baris label="Sisa kebutuhan C unit terjual" nilai={rupiah(k.kebutuhan_sisa)} />
            <Baris label="Masih menunggu transfer A → C" nilai={rupiah(k.menunggu_ke_c)} />
            <Baris label="Dana talangan (dibayar saat saldo C belum cukup)" nilai={rupiah(talangan)} />
            <Baris label="Unit terjual (DP/lunas)" nilai={`${terjual} dari ${data.unit.length}`} />
          </div>
          {k.kurang > 0 ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
              Ada kebocoran: saldo C kurang {rupiah(k.kurang)} untuk menyelesaikan unit yang sudah terjual.
            </p>
          ) : null}
          {belumTerdanai.length > 0 ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Belum terdanai penuh: {belumTerdanai.map((u) => u.kode).join(', ')}
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel judul="Utang toko bangunan" ikon="kotak">
        <div className="space-y-1.5 text-[12px] text-slate-700">
          <Baris label="Sisa utang seluruh toko (dibayar dari C)" nilai={rupiah(totalUtang)} tebal />
          {tokoBerutang.map((t) => (
            <Baris key={t.id} label={`• ${t.nama}`} nilai={rupiah(t.sisa_utang)} />
          ))}
          <Baris label="Utang & cicilan menunggu persetujuan" nilai={`${utangMenunggu}`} />
          <Baris label="Pengajuan material/tukang menunggu" nilai={`${pengajuanMenunggu}`} />
        </div>
        {tokoBerutang.length === 0 ? (
          <p className="mt-3 text-[11px] text-slate-500">Belum ada utang toko yang disetujui. Detail dan persetujuan ada di tab Utang Toko &amp; Pengajuan.</p>
        ) : (
          <p className="mt-3 text-[11px] text-slate-500">Utang yang sudah disetujui sudah memotong budget unit. Detail per toko di tab Utang Toko.</p>
        )}
      </Panel>
    </div>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${tebal ? 'font-bold text-slate-900' : ''}`}>{nilai}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unit
// ---------------------------------------------------------------------------
function TabUnit({ data, jalankan }: { data: Data; jalankan: Jalankan }) {
  const [edit, setEdit] = useState<L2Unit | null>(null);
  return (
    <div className="space-y-4">
      {edit ? <FormUnit unit={edit} onTutup={() => setEdit(null)} jalankan={jalankan} /> : null}
      <Panel judul="17 unit Loonars 2" ikon="rumah" padat>
        <div className="overflow-x-auto">
          <table className="tbl whitespace-nowrap">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Tipe</th>
                <th>Pembeli</th>
                <th>Status</th>
                <th className="text-right">Harga</th>
                <th className="text-right">Dibayar</th>
                <th className="text-right">Sisa</th>
                <th>Jatuh tempo</th>
                <th className="text-right">C terdanai / kebutuhan</th>
                <th className="text-right">Terpakai bangun</th>
                <th>Bangun</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.unit.map((u) => {
                const lewat = u.jatuh_tempo_efektif && u.sisa_pelunasan > 0 && u.status !== 'tersedia' && u.jatuh_tempo_efektif < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={u.id} className={lewat ? 'bg-red-50' : undefined}>
                    <td className="font-mono">
                      {u.nomor}. {u.kode}
                      {u.is_unit_contoh ? <Badge nada="blue" anak="contoh" /> : null}
                    </td>
                    <td>{u.tipe}</td>
                    <td>{u.nama_pembeli ?? '-'}</td>
                    <td>
                      <Badge nada={u.status === 'lunas' ? 'green' : u.status === 'dp' ? 'blue' : u.status === 'booking' ? 'amber' : 'slate'} anak={LABEL_STATUS_UNIT[u.status]} />
                    </td>
                    <td className="text-right font-mono">
                      {rupiah(u.harga_efektif)}
                      {u.harga !== null || u.dp_persen !== null || u.fee_persen !== null ? <span title="Ada override negosiasi"> *</span> : null}
                    </td>
                    <td className="text-right font-mono">{rupiah(u.total_dibayar)}</td>
                    <td className="text-right font-mono">{rupiah(u.sisa_pelunasan)}</td>
                    <td className={lewat ? 'font-bold text-red-700' : undefined}>
                      {u.jatuh_tempo_efektif ? tanggalPendek(u.jatuh_tempo_efektif) : 'Saat serah terima'}
                    </td>
                    <td className={`text-right font-mono ${u.status !== 'tersedia' && !u.terdanai_penuh ? 'text-amber-700' : ''}`}>
                      {rupiah(u.c_dialokasikan)} / {rupiah(u.kebutuhan_c)}
                    </td>
                    <td className="text-right font-mono">
                      {rupiah(u.terpakai_konstruksi)} / {rupiah(u.biaya_bangun)}
                    </td>
                    <td>{LABEL_STATUS_BANGUN[u.status_bangun]}</td>
                    <td>
                      <button type="button" className="btn-ghost px-2 py-1" title="Edit" onClick={() => setEdit(u)}>
                        <Icon name="pensil" className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[10.5px] text-slate-500">
          * harga/DP%/fee% hasil negosiasi (override per unit). Kebutuhan C = biaya bangun + buffer + fee. Status unit
          (booking/DP/lunas) dihitung otomatis dari pembayaran.
        </p>
      </Panel>
    </div>
  );
}

function FormUnit({ unit, onTutup, jalankan }: { unit: L2Unit; onTutup: () => void; jalankan: Jalankan }) {
  const [f, setF] = useState({
    nama_pembeli: unit.nama_pembeli ?? '',
    harga: unit.harga ?? 0,
    dp_persen: unit.dp_persen === null ? '' : String(unit.dp_persen),
    fee_persen: unit.fee_persen === null ? '' : String(unit.fee_persen),
    jatuh_tempo_pelunasan: unit.jatuh_tempo_pelunasan ?? '',
    tanggal_serah_terima: unit.tanggal_serah_terima ?? '',
    status_bangun: unit.status_bangun,
    is_unit_contoh: unit.is_unit_contoh,
    catatan: unit.catatan ?? '',
  });
  const simpan = () =>
    jalankan(
      'Menyimpan unit…',
      () =>
        sbUpdate('loonars2_units', unit.id, {
          nama_pembeli: f.nama_pembeli.trim() || null,
          harga: f.harga || null,
          dp_persen: f.dp_persen === '' ? null : Number(f.dp_persen),
          fee_persen: f.fee_persen === '' ? null : Number(f.fee_persen),
          jatuh_tempo_pelunasan: f.jatuh_tempo_pelunasan || null,
          tanggal_serah_terima: f.tanggal_serah_terima || null,
          status_bangun: f.status_bangun,
          is_unit_contoh: f.is_unit_contoh,
          catatan: f.catatan.trim() || null,
        }).then(onTutup),
      `Unit ${unit.kode} disimpan`,
    );
  return (
    <Panel judul={`Edit ${unit.nomor}. ${unit.kode}`} ikon="pensil" aksi={<button type="button" className="btn-ghost px-2 py-1" onClick={onTutup}><Icon name="silang" className="h-3.5 w-3.5" /></button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Bidang label="Nama pembeli" anak={<input className="input" value={f.nama_pembeli} onChange={(e) => setF({ ...f, nama_pembeli: e.target.value })} />} />
        <Bidang label="Harga (kosong = ikut tipe)" bantuan={`Tipe: ${rupiah(unit.harga_efektif)}`} anak={<InputRupiah id="u-harga" nilai={f.harga} onUbah={(v) => setF({ ...f, harga: v })} />} />
        <Bidang label="DP % (kosong = default)" anak={<input className="input" inputMode="decimal" value={f.dp_persen} onChange={(e) => setF({ ...f, dp_persen: e.target.value })} />} />
        <Bidang label="Fee % (kosong = ikut tipe)" anak={<input className="input" inputMode="decimal" value={f.fee_persen} onChange={(e) => setF({ ...f, fee_persen: e.target.value })} />} />
        <Bidang label="Jatuh tempo pelunasan" bantuan="Kosong = saat serah terima" anak={<input type="date" className="input" value={f.jatuh_tempo_pelunasan} onChange={(e) => setF({ ...f, jatuh_tempo_pelunasan: e.target.value })} />} />
        <Bidang label="Tanggal serah terima" anak={<input type="date" className="input" value={f.tanggal_serah_terima} onChange={(e) => setF({ ...f, tanggal_serah_terima: e.target.value })} />} />
        <Bidang
          label="Status bangun"
          anak={
            <select className="input" value={f.status_bangun} onChange={(e) => setF({ ...f, status_bangun: e.target.value as L2Unit['status_bangun'] })}>
              {Object.entries(LABEL_STATUS_BANGUN).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          }
        />
        <Bidang
          label="Unit contoh"
          bantuan="Boleh menerima pengajuan material walau belum terjual"
          anak={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_unit_contoh} onChange={(e) => setF({ ...f, is_unit_contoh: e.target.checked })} /> Ya</label>}
        />
        <Bidang label="Catatan" anak={<input className="input" value={f.catatan} onChange={(e) => setF({ ...f, catatan: e.target.value })} />} />
      </div>
      <button type="button" className="btn-green mt-4" onClick={() => void simpan()}>Simpan</button>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Pembayaran pembeli (receipt) + alokasi
// ---------------------------------------------------------------------------
function TabPembayaran({ data, jalankan, web }: { data: Data; jalankan: Jalankan; web: Web }) {
  const [unitId, setUnitId] = useState<number>(data.unit[0]?.id ?? 0);
  const [jenis, setJenis] = useState<L2Receipt['jenis']>('dp');
  const [nominal, setNominal] = useState(0);
  const [tanggal, setTanggal] = useState('');
  const [pembeli, setPembeli] = useState('');
  const [bukti, setBukti] = useState('');
  const [pratinjau, setPratinjau] = useState<{ ke_rekening: string; nominal: number }[] | null>(null);
  const unit = data.unit.find((u) => u.id === unitId);

  useEffect(() => {
    setPratinjau(null);
    if (!unitId || nominal <= 0) return;
    const t = setTimeout(() => {
      web('pratinjau_alokasi', { unit_id: unitId, nominal })
        .then((r) => setPratinjau(r.alokasi as { ke_rekening: string; nominal: number }[]))
        .catch(() => setPratinjau(null));
    }, 300);
    return () => clearTimeout(t);
    // web berubah tiap render; pratinjau cukup bergantung pada unit & nominal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, nominal]);

  const alokasiPer = useMemo(() => {
    const m = new Map<number, L2Alokasi[]>();
    for (const a of data.alokasi) m.set(a.receipt_id, [...(m.get(a.receipt_id) ?? []), a]);
    return m;
  }, [data.alokasi]);

  const catat = () => {
    if (!window.confirm(`Catat ${jenis.toUpperCase()} ${unit?.kode} sebesar ${rupiah(nominal)}? Perintah transfer akan dikirim ke owner lewat WA.`)) return;
    void jalankan(
      'Mencatat pembayaran…',
      () => web('catat_receipt', { unit_id: unitId, jenis, nominal, tanggal: tanggal || null, nama_pembeli: pembeli || null, bukti_url: bukti || null }),
      'Pembayaran dicatat. Perintah transfer dikirim ke owner.',
    ).then(() => {
      setNominal(0);
      setBukti('');
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
      <Panel judul="Catat pembayaran pembeli" ikon="kas-masuk">
        <div className="grid gap-3 sm:grid-cols-2">
          <Bidang
            label="Unit"
            span
            anak={
              <select className="input" value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
                {data.unit.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nomor}. {u.kode} — {u.tipe} — sisa {rupiah(u.sisa_pelunasan)}
                  </option>
                ))}
              </select>
            }
          />
          <Bidang
            label="Jenis"
            anak={
              <select className="input" value={jenis} onChange={(e) => setJenis(e.target.value as L2Receipt['jenis'])}>
                <option value="booking">Booking</option>
                <option value="dp">DP</option>
                <option value="pelunasan">Pelunasan</option>
                <option value="cicilan">Cicilan lain</option>
              </select>
            }
          />
          <Bidang label="Tanggal" anak={<input type="date" className="input" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />} />
          <Bidang
            label="Nominal"
            span
            bantuan={unit ? `DP target ${rupiah(unit.dp_target)} · sisa tagihan ${rupiah(unit.sisa_pelunasan)}` : undefined}
            anak={<InputRupiah id="r-nominal" nilai={nominal} onUbah={setNominal} />}
          />
          <Bidang label="Nama pembeli (opsional)" span anak={<input className="input" value={pembeli} placeholder={unit?.nama_pembeli ?? ''} onChange={(e) => setPembeli(e.target.value)} />} />
          <Bidang label="Tautan bukti (opsional)" span anak={<input className="input" value={bukti} onChange={(e) => setBukti(e.target.value)} />} />
        </div>
        {pratinjau ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px]">
            <b>Alokasi:</b>{' '}
            {pratinjau.map((a) => `${a.ke_rekening} ${rupiah(a.nominal)}`).join(' · ') || '-'}
          </div>
        ) : null}
        <button type="button" className="btn-green mt-4 w-full" disabled={!nominal} onClick={catat}>
          <Icon name="kas-masuk" className="h-4 w-4" /> Catat & kirim perintah transfer
        </button>
      </Panel>

      <Panel judul={`Riwayat pembayaran — ${data.receipt.length}`} ikon="buku" padat>
        {data.receipt.length === 0 ? (
          <Kosong pesan="Belum ada pembayaran pembeli." ikon="kas-masuk" />
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tanggal</th>
                  <th>Unit</th>
                  <th>Jenis</th>
                  <th className="text-right">Nominal</th>
                  <th>Alokasi</th>
                  <th>Oleh</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.receipt.map((r) => {
                  const al = (alokasiPer.get(r.id) ?? []).sort((a, b) => a.urutan - b.urutan);
                  const bisaBatal = r.status === 'aktif' && al.every((a) => a.status !== 'terkonfirmasi');
                  return (
                    <tr key={r.id} className={r.status === 'batal' ? 'opacity-50' : undefined}>
                      <td className="font-mono">{r.id}</td>
                      <td>{tanggalPendek(r.tanggal)}</td>
                      <td className="font-mono">{labelUnit(data, r.unit_id)}</td>
                      <td>{r.jenis.toUpperCase()}{r.status === 'batal' ? ' (batal)' : ''}</td>
                      <td className="text-right font-mono">{rupiah(r.nominal)}</td>
                      <td className="text-[11px]">
                        {al.map((a) => (
                          <div key={a.id}>
                            <Badge nada={a.status === 'terkonfirmasi' ? 'green' : a.status === 'batal' ? 'slate' : 'red'} anak={`T${a.id} ${a.ke_rekening}`} />{' '}
                            {rupiah(a.nominal)}
                            {a.dikonfirmasi_pada ? <span className="text-slate-400"> · {tanggalPendek(a.dikonfirmasi_pada)}</span> : null}
                          </div>
                        ))}
                      </td>
                      <td className="text-[11px] text-slate-500">{r.dicatat_oleh}</td>
                      <td>
                        {bisaBatal ? (
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-rose-500"
                            title="Batalkan (salah input)"
                            onClick={() => {
                              const alasan = window.prompt('Alasan pembatalan pembayaran ini?');
                              if (alasan === null) return;
                              void jalankan('Membatalkan…', () => web('batal_receipt', { receipt_id: r.id, alasan }), 'Pembayaran dibatalkan');
                            }}
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

// ---------------------------------------------------------------------------
// Pengajuan material/tukang
// ---------------------------------------------------------------------------
function TabPengajuan({ data, jalankan, web }: { data: Data; jalankan: Jalankan; web: Web }) {
  const putuskan = (p: L2Pengajuan, setuju: boolean) => {
    const buffer = p.pakai_buffer || p.melewati_buffer;
    let alasan: string | null = null;
    if (setuju) {
      const teks = buffer
        ? `L2-${p.id} ${p.melewati_buffer ? 'MELEWATI biaya bangun + buffer' : 'memakai buffer'}. Tetap setujui?`
        : `Setujui L2-${p.id} (${rupiah(p.nominal)})?`;
      if (!window.confirm(teks)) return;
    } else {
      alasan = window.prompt(`Alasan menolak L2-${p.id}?`);
      if (alasan === null) return;
    }
    void jalankan('Menyimpan keputusan…', () => web('putuskan', { id: p.id, setuju, alasan, buffer }), setuju ? 'Disetujui' : 'Ditolak');
  };
  const putuskanKode = (kode: string, setuju: boolean) => {
    let alasan: string | null = null;
    if (setuju) {
      if (!window.confirm(`Setujui semua baris ${kode} yang masih menunggu (termasuk yang memakai buffer)?`)) return;
    } else {
      alasan = window.prompt(`Alasan menolak ${kode}?`);
      if (alasan === null) return;
    }
    void jalankan('Menyimpan keputusan…', () => web('putuskan_kode', { kode, setuju, alasan, buffer: true }), setuju ? `${kode} disetujui` : `${kode} ditolak`);
  };
  const bayarKode = (kode: string) => {
    const bukti = window.prompt(`Tautan bukti transfer ${kode} (boleh kosong):`, '');
    if (bukti === null) return;
    void jalankan('Mencatat pembayaran…', async () => {
      const hasil = await web('bayar_kelompok', { kode, bukti_url: bukti });
      if (typeof hasil.pesan === 'string' && hasil.pesan.startsWith('❌')) throw new Error(hasil.pesan);
    }, `${kode} dibayar dari C`);
  };
  const kelompokAktif = [
    ...new Set([
      ...data.pengajuan.filter((p) => p.kelompok && (p.status === 'menunggu' || p.status === 'disetujui')).map((p) => p.kelompok as string),
      ...data.cicilan.filter((c) => c.status === 'menunggu' || c.status === 'disetujui').map((c) => c.kelompok),
    ]),
  ];
  const bayar = (p: L2Pengajuan) => {
    const bukti = window.prompt(`Tautan bukti transfer L2-${p.id} (boleh kosong):`, '');
    if (bukti === null) return;
    void jalankan('Mencatat pembayaran…', () => web('bayar_pengajuan', { id: p.id, bukti_url: bukti }), `L2-${p.id} dibayar dari C`);
  };
  return (
    <div className="space-y-4">
    {kelompokAktif.length > 0 ? (
      <Panel judul="Pengajuan mingguan aktif" ikon="kalender">
        <div className="space-y-2">
          {kelompokAktif.map((kode) => {
            const baris = data.pengajuan.filter((p) => p.kelompok === kode);
            const cic = data.cicilan.filter((c) => c.kelompok === kode);
            const menunggu = baris.some((p) => p.status === 'menunggu') || cic.some((c) => c.status === 'menunggu');
            const disetujui = baris.some((p) => p.status === 'disetujui') || cic.some((c) => c.status === 'disetujui');
            const aktif = [...baris, ...cic].filter((x) => x.status === 'menunggu' || x.status === 'disetujui');
            const total = aktif.reduce((s, x) => s + Number(x.nominal), 0);
            return (
              <div key={kode} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[12px]">
                <b className="font-mono">{kode}</b>
                <span className="text-slate-500">{aktif.length} baris aktif · {rupiah(total)}</span>
                <span className="ml-auto flex gap-1">
                  {menunggu ? (
                    <>
                      <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => putuskanKode(kode, true)}>Setujui semua</button>
                      <button type="button" className="btn-ghost px-2 py-1 text-[11px] text-rose-600" onClick={() => putuskanKode(kode, false)}>Tolak semua</button>
                    </>
                  ) : null}
                  {disetujui && !menunggu ? (
                    <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => bayarKode(kode)}>Catat dibayar</button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10.5px] text-slate-500">Baris cicilan utang ada di tab Utang Toko. Satu kode dibayar sekaligus dengan satu bukti transfer.</p>
      </Panel>
    ) : null}
    <Panel judul={`Pengajuan material/tukang — ${data.pengajuan.length}`} ikon="dokumen" padat>
      {data.pengajuan.length === 0 ? (
        <Kosong pesan="Belum ada pengajuan. Pelaksana mengajukan lewat WhatsApp (awali dengan &quot;L2&quot;)." ikon="dokumen" />
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Unit</th>
                <th>Rincian</th>
                <th className="text-right">Nominal</th>
                <th>Tanda</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.pengajuan.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono">L2-{p.id}{p.kelompok ? <div className="text-[10px] text-slate-400">{p.kelompok}</div> : null}</td>
                  <td className="font-mono">{labelUnit(data, p.unit_id)}</td>
                  <td className="max-w-[360px] text-[11px]">
                    <b>{p.kategori}</b> — {p.deskripsi}
                    {p.toko ? <div className="text-slate-500">{p.toko}</div> : null}
                    <div className="text-slate-400">{p.diajukan_oleh} · {tanggalPendek(p.dibuat_pada)}</div>
                    {p.nota_url ? <a className="text-blue-600 underline" href={p.nota_url} target="_blank" rel="noreferrer">nota</a> : null}
                  </td>
                  <td className="text-right font-mono">{rupiah(p.nominal)}</td>
                  <td className="space-x-1">
                    {p.melewati_buffer ? <Badge nada="red" anak="melewati buffer" /> : p.pakai_buffer ? <Badge nada="amber" anak="pakai buffer" /> : null}
                    {p.saldo_c_kurang ? <Badge nada="red" anak="saldo C kurang" /> : null}
                    {p.unit_belum_terdanai ? <Badge nada="amber" anak="unit belum terdanai" /> : null}
                  </td>
                  <td>
                    <Badge nada={p.status === 'dibayar' ? 'green' : p.status === 'disetujui' ? 'blue' : p.status === 'ditolak' ? 'slate' : 'amber'} anak={p.status} />
                    {p.alasan_tolak ? <div className="text-[10px] text-slate-500">{p.alasan_tolak}</div> : null}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {p.status === 'menunggu' ? (
                      <>
                        <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => putuskan(p, true)}>Setujui</button>{' '}
                        <button type="button" className="btn-ghost px-2 py-1 text-[11px] text-rose-600" onClick={() => putuskan(p, false)}>Tolak</button>
                      </>
                    ) : p.status === 'disetujui' ? (
                      <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => bayar(p)}>Catat dibayar</button>
                    ) : null}
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

// ---------------------------------------------------------------------------
// Utang toko & cicilan
// ---------------------------------------------------------------------------
function TabBorongan({ data }: { data: Data }) {
  const unit = data.unit.map((u) => ({ id: u.id, nomor: u.nomor, kode: u.kode, sedang_dibangun: data.dibangun.find((d) => d.id === u.id)?.sedang_dibangun ?? false }));
  return (
    <div className="space-y-4">
      <PanelUnitDibangun unit={unit} />
      <PanelBorongan borongan={data.borongan.filter((b) => b.status !== 'batal')} />
      <PanelRab rab={data.rab} unit={unit} />
    </div>
  );
}

function TabUtang({ data, jalankan, web }: { data: Data; jalankan: Jalankan; web: Web }) {
  const namaToko = (id: number) => data.toko.find((t) => t.id === id)?.nama ?? '-';
  const putuskan = (kode: string, setuju: boolean, buffer: boolean) => {
    let alasan: string | null = null;
    if (setuju) {
      if (!window.confirm(`Setujui ${kode}?${buffer ? ' (memakai buffer unit)' : ''}`)) return;
    } else {
      alasan = window.prompt(`Alasan menolak ${kode}?`);
      if (alasan === null) return;
    }
    void jalankan('Menyimpan keputusan…', () => web('putuskan_kode', { kode, setuju, alasan, buffer }), setuju ? `${kode} disetujui` : `${kode} ditolak`);
  };
  const kelompokUtang = [...new Set(data.utang.map((u) => u.kelompok))];
  const totalSisa = data.toko.reduce((s, t) => s + Math.max(Number(t.sisa_utang), 0), 0);
  return (
    <div className="space-y-4">
      <Panel judul={`Sisa utang per toko — total ${rupiah(totalSisa)}`} ikon="kotak" padat>
        {data.toko.length === 0 ? (
          <Kosong pesan='Belum ada utang toko. Pelaksana mencatat lewat WA: "L2 utang <toko> unit <n> <rincian> <nominal>".' ikon="kotak" />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Toko</th><th className="text-right">Utang disetujui</th><th className="text-right">Sudah dicicil</th><th className="text-right">Sisa</th><th className="text-right">Menunggu</th></tr>
            </thead>
            <tbody>
              {data.toko.filter(tokoAda).map((t) => (
                <tr key={t.id}>
                  <td className="font-semibold">{t.nama}</td>
                  <td className="text-right font-mono">{rupiah(t.utang_disetujui)}</td>
                  <td className="text-right font-mono">{rupiah(t.cicilan_dibayar)}</td>
                  <td className="text-right font-mono font-bold">{rupiah(t.sisa_utang)}</td>
                  <td className="text-right text-[11px] text-slate-500">
                    {Number(t.utang_menunggu) > 0 ? `utang ${rupiah(t.utang_menunggu)}` : ''}
                    {Number(t.cicilan_diproses) > 0 ? ` cicilan ${rupiah(t.cicilan_diproses)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel judul={`Pembelian secara utang — ${kelompokUtang.length}`} ikon="dokumen" padat>
        {kelompokUtang.length === 0 ? (
          <Kosong pesan="Belum ada pembelian secara utang." ikon="dokumen" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr><th>Kode</th><th>Toko</th><th>Unit</th><th>Rincian</th><th className="text-right">Nominal</th><th>Tanda</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {kelompokUtang.map((kode) => {
                  const baris = data.utang.filter((u) => u.kelompok === kode);
                  const u0 = baris[0];
                  const buffer = baris.some((u) => u.pakai_buffer || u.melewati_buffer);
                  return (
                    <tr key={kode}>
                      <td className="font-mono">{kode}</td>
                      <td>{namaToko(u0.toko_id)}</td>
                      <td className="font-mono text-[11px]">{baris.map((u) => labelUnit(data, u.unit_id)).join(', ')}</td>
                      <td className="max-w-[320px] text-[11px]">
                        {u0.deskripsi}
                        <div className="text-slate-400">{u0.diajukan_oleh} · {tanggalPendek(u0.tanggal)}</div>
                        {u0.nota_url ? <a className="text-blue-600 underline" href={u0.nota_url} target="_blank" rel="noreferrer">nota</a> : null}
                      </td>
                      <td className="text-right font-mono">{rupiah(baris.reduce((s, u) => s + Number(u.nominal), 0))}</td>
                      <td className="space-x-1">
                        {baris.some((u) => u.melewati_buffer) ? <Badge nada="red" anak="melewati buffer" /> : buffer ? <Badge nada="amber" anak="pakai buffer" /> : null}
                        {baris.some((u) => u.unit_belum_terdanai) ? <Badge nada="amber" anak="unit belum terdanai" /> : null}
                      </td>
                      <td>
                        <Badge nada={u0.status === 'disetujui' ? 'green' : u0.status === 'ditolak' ? 'slate' : 'amber'} anak={u0.status} />
                        {u0.alasan_tolak ? <div className="text-[10px] text-slate-500">{u0.alasan_tolak}</div> : null}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {u0.status === 'menunggu' ? (
                          <>
                            <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => putuskan(kode, true, buffer)}>Setujui</button>{' '}
                            <button type="button" className="btn-ghost px-2 py-1 text-[11px] text-rose-600" onClick={() => putuskan(kode, false, false)}>Tolak</button>
                          </>
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

      <Panel judul={`Cicilan ke toko — ${data.cicilan.length}`} ikon="kas-keluar" padat>
        {data.cicilan.length === 0 ? (
          <Kosong pesan="Belum ada cicilan diajukan." ikon="kas-keluar" />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Kode</th><th>Pengajuan</th><th>Toko</th><th className="text-right">Nominal</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {data.cicilan.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono">C-{c.id}</td>
                  <td className="font-mono">{c.kelompok}</td>
                  <td>{namaToko(c.toko_id)}</td>
                  <td className="text-right font-mono">{rupiah(c.nominal)}</td>
                  <td>
                    <Badge nada={c.status === 'dibayar' ? 'green' : c.status === 'disetujui' ? 'blue' : c.status === 'ditolak' ? 'slate' : 'amber'} anak={c.status} />
                    {c.alasan_tolak ? <div className="text-[10px] text-slate-500">{c.alasan_tolak}</div> : null}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {c.status === 'menunggu' ? (
                      <>
                        <button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={() => putuskan(`C-${c.id}`, true, false)}>Setujui</button>{' '}
                        <button type="button" className="btn-ghost px-2 py-1 text-[11px] text-rose-600" onClick={() => putuskan(`C-${c.id}`, false, false)}>Tolak</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 py-2 text-[10.5px] text-slate-500">
          Cicilan dibayar bersama pengajuan mingguannya (tab Pengajuan → Catat dibayar). Cicilan tidak memotong budget unit lagi — budget sudah
          terpotong saat utangnya disetujui.
        </p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pengeluaran B/C/D
// ---------------------------------------------------------------------------
function TabPengeluaran({ data, jalankan, web }: { data: Data; jalankan: Jalankan; web: Web }) {
  const [kategori, setKategori] = useState(KATEGORI_PENGELUARAN[0].id);
  const [nominal, setNominal] = useState(0);
  const [unitId, setUnitId] = useState<number | ''>('');
  const [penerima, setPenerima] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const [bukti, setBukti] = useState('');
  const k = KATEGORI_PENGELUARAN.find((x) => x.id === kategori)!;

  const catat = () => {
    if (!window.confirm(`Catat pengeluaran ${rupiah(nominal)} dari rekening ${k.dari}?`)) return;
    void jalankan(
      'Mencatat pengeluaran…',
      async () => {
        const hasil = await web('catat_pengeluaran', {
          dari: k.dari, kategori, nominal, unit_id: unitId === '' ? null : unitId,
          penerima: penerima || null, keterangan: keterangan || null, bukti_url: bukti || null,
        });
        // Pencairan profit yang tidak lolos syarat dikembalikan sebagai pesan, bukan galat.
        if (typeof hasil.pesan === 'string' && hasil.pesan.startsWith('❌')) throw new Error(hasil.pesan);
      },
      'Pengeluaran dicatat',
    ).then(() => setNominal(0));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_1fr]">
      <Panel judul="Catat pengeluaran" ikon="kas-keluar">
        <div className="grid gap-3">
          <Bidang
            label="Jenis"
            anak={
              <select className="input" value={kategori} onChange={(e) => setKategori(e.target.value)}>
                {KATEGORI_PENGELUARAN.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            }
          />
          <Bidang label="Nominal" bantuan={`Saldo ${k.dari}: ${rupiah(data.rekening.find((r) => r.kode === k.dari)?.saldo ?? 0)}`} anak={<InputRupiah id="d-nominal" nilai={nominal} onUbah={setNominal} />} />
          {k.dari === 'C' ? (
            <Bidang
              label="Unit (untuk budget per unit)"
              anak={
                <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">—</option>
                  {data.unit.map((u) => (
                    <option key={u.id} value={u.id}>{u.nomor}. {u.kode}</option>
                  ))}
                </select>
              }
            />
          ) : null}
          <Bidang label="Penerima" anak={<input className="input" value={penerima} onChange={(e) => setPenerima(e.target.value)} />} />
          <Bidang label="Keterangan" anak={<input className="input" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />} />
          <Bidang label="Tautan bukti" anak={<input className="input" value={bukti} onChange={(e) => setBukti(e.target.value)} />} />
        </div>
        <p className="mt-3 text-[10.5px] text-slate-500">
          Pembayaran material/tukang dari pengajuan dicatat di tab Pengajuan. Pencairan profit hanya bisa bila syarat milestone
          terpenuhi dan tidak ada transfer tertunda.
        </p>
        <button type="button" className="btn-green mt-3 w-full" disabled={!nominal} onClick={catat}>Catat pengeluaran</button>
      </Panel>

      <Panel judul={`Uang keluar B/C/D — ${data.pengeluaran.length}`} ikon="kas-keluar" padat>
        {data.pengeluaran.length === 0 ? (
          <Kosong pesan="Belum ada pengeluaran." ikon="kas-keluar" />
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Dari</th>
                  <th>Jenis</th>
                  <th>Unit</th>
                  <th>Keterangan</th>
                  <th className="text-right">Nominal</th>
                </tr>
              </thead>
              <tbody>
                {data.pengeluaran.map((d) => (
                  <tr key={d.id}>
                    <td>{tanggalPendek(d.tanggal)}</td>
                    <td className="font-mono">{d.dari_rekening}</td>
                    <td>{d.kategori}{d.material_request_id ? ` (L2-${d.material_request_id})` : ''}</td>
                    <td className="font-mono">{labelUnit(data, d.unit_id)}</td>
                    <td className="text-[11px] text-slate-500">
                      {[d.penerima, d.keterangan].filter(Boolean).join(' — ') || '-'}
                      {d.bukti_url ? <> · <a className="text-blue-600 underline" href={d.bukti_url} target="_blank" rel="noreferrer">bukti</a></> : null}
                    </td>
                    <td className="text-right font-mono">{rupiah(d.nominal)}</td>
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

// ---------------------------------------------------------------------------
// Pengaturan: angka proyek, tipe unit, rekening, nomor WA
// ---------------------------------------------------------------------------
function TabPengaturan({ data, jalankan }: { data: Data; jalankan: Jalankan }) {
  const s = data.pengaturan;
  const [f, setF] = useState({
    target_tanah: Number(s.target_tanah),
    jatuh_tempo_tanah: s.jatuh_tempo_tanah ?? '',
    dp_persen_default: String(s.dp_persen_default),
    jam_mulai_pengingat: String(s.jam_mulai_pengingat),
    jam_selesai_pengingat: String(s.jam_selesai_pengingat),
    interval_pengingat_jam: String(s.interval_pengingat_jam),
    eskalasi_jam: String(s.eskalasi_jam),
    tanah: s.milestone_profit.wajib_target_tanah_terkonfirmasi ?? true,
    terdanai: s.milestone_profit.wajib_unit_terjual_terdanai_penuh ?? true,
    serah: String(s.milestone_profit.min_unit_serah_terima ?? 0),
  });
  const simpanPengaturan = () =>
    jalankan(
      'Menyimpan pengaturan…',
      () =>
        sbUpdate('loonars2_settings', 1, {
          target_tanah: f.target_tanah,
          jatuh_tempo_tanah: f.jatuh_tempo_tanah || null,
          dp_persen_default: Number(f.dp_persen_default),
          jam_mulai_pengingat: Number(f.jam_mulai_pengingat),
          jam_selesai_pengingat: Number(f.jam_selesai_pengingat),
          interval_pengingat_jam: Number(f.interval_pengingat_jam),
          eskalasi_jam: Number(f.eskalasi_jam),
          milestone_profit: { wajib_target_tanah_terkonfirmasi: f.tanah, wajib_unit_terjual_terdanai_penuh: f.terdanai, min_unit_serah_terima: Number(f.serah) || 0 },
        }),
      'Pengaturan disimpan',
    );

  return (
    <div className="space-y-4">
      <Panel judul="Pengaturan proyek" ikon="kunci">
        <div className="grid gap-3 sm:grid-cols-4">
          <Bidang label="Target dana tanah" anak={<InputRupiah id="s-target" nilai={f.target_tanah} onUbah={(v) => setF({ ...f, target_tanah: v })} />} />
          <Bidang label="Jatuh tempo tanah" anak={<input type="date" className="input" value={f.jatuh_tempo_tanah} onChange={(e) => setF({ ...f, jatuh_tempo_tanah: e.target.value })} />} />
          <Bidang label="DP default (%)" anak={<input className="input" inputMode="decimal" value={f.dp_persen_default} onChange={(e) => setF({ ...f, dp_persen_default: e.target.value })} />} />
          <Bidang label="Eskalasi merah (jam)" anak={<input className="input" inputMode="numeric" value={f.eskalasi_jam} onChange={(e) => setF({ ...f, eskalasi_jam: e.target.value })} />} />
          <Bidang label="Jam mulai pengingat (WIB)" anak={<input className="input" inputMode="numeric" value={f.jam_mulai_pengingat} onChange={(e) => setF({ ...f, jam_mulai_pengingat: e.target.value })} />} />
          <Bidang label="Jam selesai pengingat (WIB)" anak={<input className="input" inputMode="numeric" value={f.jam_selesai_pengingat} onChange={(e) => setF({ ...f, jam_selesai_pengingat: e.target.value })} />} />
          <Bidang label="Pengingat transfer tiap (jam)" anak={<input className="input" inputMode="numeric" value={f.interval_pengingat_jam} onChange={(e) => setF({ ...f, interval_pengingat_jam: e.target.value })} />} />
        </div>
        <h3 className="mt-4 text-[11px] font-bold uppercase text-slate-500">Syarat pencairan profit (D)</h3>
        <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-3">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.tanah} onChange={(e) => setF({ ...f, tanah: e.target.checked })} /> Target tanah sudah terkonfirmasi di B</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.terdanai} onChange={(e) => setF({ ...f, terdanai: e.target.checked })} /> Semua unit terjual terdanai penuh di C</label>
          <label className="flex items-center gap-2">Minimal unit serah terima <input className="input w-20" inputMode="numeric" value={f.serah} onChange={(e) => setF({ ...f, serah: e.target.value })} /></label>
        </div>
        <p className="mt-2 text-[10.5px] text-slate-500">Transfer tertunda di A selalu memblokir pencairan profit (aturan tetap).</p>
        <button type="button" className="btn-green mt-3" onClick={() => void simpanPengaturan()}>Simpan pengaturan</button>
      </Panel>

      <TabelTipe data={data} jalankan={jalankan} />
      <TabelRekening data={data} jalankan={jalankan} />
      <TabelPengguna data={data} jalankan={jalankan} />
    </div>
  );
}

function TabelTipe({ data, jalankan }: { data: Data; jalankan: Jalankan }) {
  const [baris, setBaris] = useState(data.tipe);
  const ubah = (id: number, kunci: keyof L2TipeUnit, nilai: number) =>
    setBaris((b) => b.map((t) => (t.id === id ? { ...t, [kunci]: nilai } : t)));
  return (
    <Panel judul="Tipe unit" ikon="rumah" padat>
      <table className="tbl">
        <thead>
          <tr>
            <th>Tipe</th><th>Harga jual</th><th>Biaya bangun (incl. infra)</th><th>Buffer %</th><th>Fee %</th><th>Jumlah unit</th><th>Kebutuhan C</th><th />
          </tr>
        </thead>
        <tbody>
          {baris.map((t) => (
            <tr key={t.id}>
              <td className="font-semibold">{t.nama}</td>
              <td><InputRupiah id={`t-h-${t.id}`} nilai={Number(t.harga)} onUbah={(v) => ubah(t.id, 'harga', v)} /></td>
              <td><InputRupiah id={`t-b-${t.id}`} nilai={Number(t.biaya_bangun)} onUbah={(v) => ubah(t.id, 'biaya_bangun', v)} /></td>
              <td><input className="input w-20" inputMode="decimal" value={t.buffer_persen} onChange={(e) => ubah(t.id, 'buffer_persen', Number(e.target.value))} /></td>
              <td><input className="input w-20" inputMode="decimal" value={t.fee_persen} onChange={(e) => ubah(t.id, 'fee_persen', Number(e.target.value))} /></td>
              <td><input className="input w-20" inputMode="numeric" value={t.jumlah_unit} onChange={(e) => ubah(t.id, 'jumlah_unit', Number(e.target.value))} /></td>
              <td className="font-mono">
                {rupiah(Number(t.biaya_bangun) + Math.round((Number(t.biaya_bangun) * Number(t.buffer_persen)) / 100) + Math.round((Number(t.harga) * Number(t.fee_persen)) / 100))}
              </td>
              <td>
                <button
                  type="button"
                  className="btn-green px-2 py-1 text-[11px]"
                  onClick={() =>
                    void jalankan('Menyimpan tipe…', () =>
                      sbUpdate('loonars2_unit_types', t.id, {
                        harga: t.harga, biaya_bangun: t.biaya_bangun, buffer_persen: t.buffer_persen, fee_persen: t.fee_persen, jumlah_unit: t.jumlah_unit,
                      }), `Tipe ${t.nama} disimpan`)
                  }
                >
                  Simpan
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[10.5px] text-slate-500">
        Kolom kebutuhan C hanya pratinjau tampilan; angka resmi dihitung database. Perubahan berlaku untuk alokasi berikutnya.
      </p>
    </Panel>
  );
}

function TabelRekening({ data, jalankan }: { data: Data; jalankan: Jalankan }) {
  const [baris, setBaris] = useState(data.rekening);
  const ubah = (kode: string, kunci: 'bank' | 'nomor_rekening' | 'nama_pemilik', nilai: string) =>
    setBaris((b) => b.map((r) => (r.kode === kode ? { ...r, [kunci]: nilai } : r)));
  return (
    <Panel judul="Rekening A/B/C/D" ikon="bank" padat>
      <table className="tbl">
        <thead>
          <tr><th>Kode</th><th>Fungsi</th><th>Bank</th><th>Nomor rekening</th><th>Atas nama</th><th /></tr>
        </thead>
        <tbody>
          {baris.map((r) => (
            <tr key={r.kode}>
              <td className="font-mono font-bold">{r.kode} — {r.nama}</td>
              <td className="max-w-[260px] text-[11px] text-slate-500">{r.fungsi}</td>
              <td><input className="input" value={r.bank ?? ''} onChange={(e) => ubah(r.kode, 'bank', e.target.value)} /></td>
              <td><input className="input font-mono" value={r.nomor_rekening ?? ''} onChange={(e) => ubah(r.kode, 'nomor_rekening', e.target.value)} /></td>
              <td><input className="input" value={r.nama_pemilik ?? ''} onChange={(e) => ubah(r.kode, 'nama_pemilik', e.target.value)} /></td>
              <td>
                <button
                  type="button"
                  className="btn-green px-2 py-1 text-[11px]"
                  onClick={() => {
                    if (!window.confirm(`Simpan rekening ${r.kode}: ${r.bank ?? ''} ${r.nomor_rekening ?? ''} a.n. ${r.nama_pemilik ?? ''}?`)) return;
                    void jalankan('Menyimpan rekening…', () =>
                      sbUpdateWhere('loonars2_accounts', `kode=eq.${r.kode}`, {
                        bank: r.bank?.trim() || null,
                        nomor_rekening: r.nomor_rekening?.replace(/[^0-9]/g, '') || null,
                        nama_pemilik: r.nama_pemilik?.trim() || null,
                      }), `Rekening ${r.kode} disimpan`);
                  }}
                >
                  Simpan
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function TabelPengguna({ data, jalankan }: { data: Data; jalankan: Jalankan }) {
  const [nomor, setNomor] = useState('');
  const [nama, setNama] = useState('');
  const [peran, setPeran] = useState<'owner' | 'pelaksana'>('owner');
  const tambah = () => {
    const n = nomor.replace(/\D/g, '').replace(/^0/, '62').replace(/^8/, '628');
    if (!/^62\d{8,14}$/.test(n) || nama.trim().length < 2) {
      window.alert('Isi nomor WA (mis. 0812…) dan nama.');
      return;
    }
    void jalankan('Menambah nomor…', () => sbInsert('loonars2_wa_users', [{ nomor: n, nama: nama.trim(), peran }]), 'Nomor ditambahkan').then(() => {
      setNomor('');
      setNama('');
    });
  };
  return (
    <Panel judul="Nomor WhatsApp yang boleh berinteraksi" ikon="orang-grup" padat>
      <table className="tbl">
        <thead>
          <tr><th>Nomor</th><th>Nama</th><th>Peran</th><th>Aktif</th><th /></tr>
        </thead>
        <tbody>
          {data.pengguna.map((u) => (
            <tr key={u.id}>
              <td className="font-mono">{u.nomor}</td>
              <td>{u.nama}</td>
              <td>{u.peran === 'owner' ? 'Owner' : 'Pelaksana'}</td>
              <td>
                <input
                  type="checkbox"
                  checked={u.aktif}
                  onChange={(e) => void jalankan('Menyimpan…', () => sbUpdate('loonars2_wa_users', u.id, { aktif: e.target.checked }))}
                />
              </td>
              <td className="text-right">
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-rose-500"
                  onClick={() => {
                    if (window.confirm(`Hapus ${u.nama} (${u.nomor})?`)) void jalankan('Menghapus…', () => sbDelete('loonars2_wa_users', u.id), 'Dihapus');
                  }}
                >
                  <Icon name="sampah" className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td><input className="input font-mono" placeholder="0812…" value={nomor} onChange={(e) => setNomor(e.target.value)} /></td>
            <td><input className="input" placeholder="Nama" value={nama} onChange={(e) => setNama(e.target.value)} /></td>
            <td>
              <select className="input" value={peran} onChange={(e) => setPeran(e.target.value as 'owner' | 'pelaksana')}>
                <option value="owner">Owner</option>
                <option value="pelaksana">Pelaksana</option>
              </select>
            </td>
            <td />
            <td className="text-right"><button type="button" className="btn-green px-2 py-1 text-[11px]" onClick={tambah}><Icon name="plus" className="h-3.5 w-3.5" /> Tambah</button></td>
          </tr>
        </tbody>
      </table>
      <p className="px-4 py-2 text-[10.5px] text-slate-500">
        Nomor yang tidak terdaftar diabaikan modul ini dan dicatat di log. Owner menerima perintah transfer, pengingat, dan
        laporan; pelaksana mengajukan material/tukang.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
function TabAudit({ data }: { data: Data }) {
  return (
    <Panel judul="Audit log (150 terakhir)" ikon="buku" padat>
      <div className="max-h-[680px] overflow-auto">
        <table className="tbl">
          <thead>
            <tr><th>Waktu</th><th>Tabel</th><th>Aksi</th><th>Oleh</th><th>Perubahan</th></tr>
          </thead>
          <tbody>
            {data.audit.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-[11px]">{new Date(a.dibuat_pada).toLocaleString('id-ID')}</td>
                <td className="text-[11px]">{a.tabel.replace('loonars2_', '')} #{a.baris_id}</td>
                <td className="text-[11px]">{a.aksi}</td>
                <td className="text-[11px]">
                  <Badge nada={a.sumber === 'wa' ? 'green' : a.sumber === 'web' ? 'blue' : 'slate'} anak={a.sumber} /> {a.aktor}
                </td>
                <td className="font-mono text-[10px] text-slate-600">{ringkasPerubahan(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ringkasPerubahan(a: L2Audit): string {
  if (a.aksi !== 'UPDATE' || !a.nilai_lama || !a.nilai_baru) return a.aksi === 'INSERT' ? 'baris baru' : 'dihapus';
  const lama = a.nilai_lama;
  const baru = a.nilai_baru;
  return Object.keys(baru)
    .filter((k) => k !== 'diubah_pada' && JSON.stringify(lama[k]) !== JSON.stringify(baru[k]))
    .map((k) => `${k}: ${JSON.stringify(lama[k])} → ${JSON.stringify(baru[k])}`)
    .join('; ');
}
