/**
 * LAPORAN KEUANGAN HOLDING — PT Loonars Mahakarya (nama baru PT Maha Karya
 * Haluoleo), format SAK EMKM: Laporan Posisi Keuangan, Laporan Laba Rugi,
 * Catatan atas Laporan Keuangan. Keputusan owner 2026-11-02:
 *
 *   - Holding = Loonars 1 (hospitality villa) + Loonars 2 (developer Loonars
 *     Living + Loonars Coffee) + tingkat holding (biaya bersama).
 *   - Pendapatan villa dicatat KOTOR penuh; bagi hasil investor (pool 70%) dan
 *     top-up jaminan investor = BEBAN.
 *   - Gaji tim bersama (slip gaji MK Connect: Jogja, Head Office, dll.) = BEBAN
 *     HOLDING. Gaji staf villa sudah ada di OPEX laporan villa → slip cabang
 *     villa dikecualikan agar tidak terhitung dua kali.
 *   - Tahun buku resmi pertama: 2027. Tahun sebelumnya = periode persiapan.
 *
 * Keputusan owner 2026-11-02 (lanjutan):
 *   - Serah terima unit Loonars 2 akhir Desember → pendapatan & HPP unit
 *     diakui 31 Desember tahun serah terima.
 *   - Modal disetor ditetapkan dari posisi bisnis yang berjalan.
 *   - Utang bank proyek AFP milik PT Maha Karya — TIDAK masuk laporan ini.
 *   - Penyusutan, bunga, PPh diatur di laporan; tidak ada pinjaman bank →
 *     beban bunga 0.
 *
 * Semua angka dihitung di sini dari model yang sama dengan halaman AI CFO lain
 * (deterministik). Bila suatu bagian tidak bisa dihitung untuk periode yang
 * diminta, nilainya null + catatan — tidak pernah ditebak.
 */
import type { ModelCfo } from './model';
import { KEPUTUSAN_D1, labaRugiPengembanganL1, neracaPengembanganL1 } from './pengembangan-l1';
import type { DataCfo } from './tipe';
import { angka, bulat, jumlah, teks } from './util';

export const TAHUN_BUKU_RESMI_PERTAMA = 2027;
export const NAMA_ENTITAS = 'PT Loonars Mahakarya';
/** Cabang MK Connect yang gajinya sudah masuk OPEX laporan villa (Loonars 1). */
export const CABANG_GAJI_VILLA = ['Loonars Private Living'];
/** Tahun di mana seluruh aktivitas Loonars 2 terjadi (dasar kumulatif sah). */
const TAHUN_AWAL_L2 = 2026;

/**
 * Kebijakan akuntansi & pajak (keputusan owner 2026-11-02). Tarif pajak =
 * ketentuan umum yang berlaku (UU HPP: PPh badan 22%, fasilitas Pasal 31E;
 * PP 34/2016: PPh final pengalihan hak atas tanah/bangunan 2,5%) — ESTIMASI,
 * wajib dikonfirmasi konsultan pajak sebelum SPT.
 */
export const KEBIJAKAN = {
  tanggalSerahTerima: '12-31',
  penyusutanBangunanTahun: 20,
  bebanBungaTahunan: 0,
  pphFinalBangunanPct: 2.5,
  pphBadanPct: 22,
  batasOmzetFasilitas31E: 4_800_000_000,
  batasOmzetMaks31E: 50_000_000_000,
} as const;

/** Arsip tutup buku (cfo_laporan_bulanan) — dipakai sebagai saldo awal tahun berikutnya. */
export interface ArsipHolding {
  periode: string;
  data: unknown;
}

/**
 * PPh badan terutang (estimasi) dengan fasilitas Pasal 31E UU PPh: omzet ≤
 * Rp 4,8 M → tarif 50% × 22% untuk seluruh PKP; omzet ≤ Rp 50 M → bagian PKP
 * dari omzet s.d. Rp 4,8 M mendapat 50%; di atas itu tarif penuh.
 */
export function pphBadan(pkp: number, omzet: number): number {
  if (pkp <= 0) return 0;
  const t = KEBIJAKAN.pphBadanPct / 100;
  if (omzet <= KEBIJAKAN.batasOmzetFasilitas31E) return bulat(pkp * t * 0.5);
  if (omzet <= KEBIJAKAN.batasOmzetMaks31E) {
    const porsi = KEBIJAKAN.batasOmzetFasilitas31E / omzet;
    return bulat(pkp * porsi * t * 0.5 + pkp * (1 - porsi) * t);
  }
  return bulat(pkp * t);
}

function bulanKe(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

/** Jadwal penyusutan satu bangunan proyek L2 (dipakai laporan holding & laba rugi institusional). */
export interface JadwalPenyusutan {
  nama: string;
  biaya: number;
  /** Tanggal proyek berstatus 'completed' (null = masih dibangun → belum disusutkan). */
  tglSelesai: string | null;
  /** Indeks bulan (tahun×12 + bulan−1) mulai disusutkan = bulan setelah selesai. */
  mulaiKe: number | null;
  perBulan: number;
}

/** Garis lurus bangunan proyek L2 yang sudah 'completed', mulai bulan berikutnya. */
export function jadwalPenyusutan(m: ModelCfo, data: DataCfo): JadwalPenyusutan[] {
  return m.l2.proyek.map((p) => {
    const snap = data.snapshot.find((s) => s.jenis === 'proyek_konstruksi' && s.id === p.id);
    const selesai = snap && teks(snap.data.status) === 'completed';
    const tglSelesai = selesai ? (snap!.sumber_diubah_pada ?? snap!.diterima_pada).slice(0, 10) : null;
    return {
      nama: p.nama,
      biaya: p.realisasiTotal,
      tglSelesai,
      mulaiKe: tglSelesai ? bulanKe(tglSelesai) + 1 : null,
      perBulan: p.realisasiTotal / (KEBIJAKAN.penyusutanBangunanTahun * 12),
    };
  });
}

/**
 * Penyusutan untuk sekumpulan bulan (YYYY-MM). Bulan sesudah bulan `hariIni`
 * tidak dihitung (belum terjadi) — sama dengan batas `akhirData` laporan holding.
 */
export function penyusutanBulan(jadwal: JadwalPenyusutan[], bulan: string[], hariIni: string): number {
  const akhirData = bulanKe(hariIni);
  const umur = KEBIJAKAN.penyusutanBangunanTahun * 12;
  let total = 0;
  for (const j of jadwal) {
    if (j.mulaiKe === null) continue;
    const n = bulan.map((b) => bulanKe(`${b}-01`)).filter((k) => k >= j.mulaiKe! && k < j.mulaiKe! + umur && k <= akhirData).length;
    total += bulat(j.perBulan * n);
  }
  return bulat(total);
}

/** Penyusutan garis lurus bangunan proyek L2 yang sudah 'completed' (mulai bulan berikutnya). */
function penyusutanProyek(m: ModelCfo, data: DataCfo, tahun: number) {
  const hari = m.hariIni;
  let tahunIni = 0;
  let akumulasi = 0;
  const rincian: { nama: string; biaya: number; mulai: string | null; tahunIni: number; akumulasi: number }[] = [];
  for (const j of jadwalPenyusutan(m, data)) {
    const p = { nama: j.nama, realisasiTotal: j.biaya };
    const tglSelesai = j.tglSelesai;
    if (!tglSelesai || j.mulaiKe === null) {
      rincian.push({ nama: p.nama, biaya: p.realisasiTotal, mulai: null, tahunIni: 0, akumulasi: 0 });
      continue;
    }
    const perBulan = j.perBulan;
    const mulai = j.mulaiKe;
    const akhirData = bulanKe(hari);
    const bulanTahun = Math.max(0, Math.min(akhirData, tahun * 12 + 11) - Math.max(mulai, tahun * 12) + 1);
    const bulanAkum = Math.max(0, Math.min(akhirData - mulai + 1, KEBIJAKAN.penyusutanBangunanTahun * 12));
    const a = bulat(Math.min(perBulan * bulanAkum, p.realisasiTotal));
    const t = bulat(perBulan * bulanTahun);
    tahunIni += t;
    akumulasi += a;
    rincian.push({ nama: p.nama, biaya: p.realisasiTotal, mulai: tglSelesai, tahunIni: t, akumulasi: a });
  }
  return { tahunIni: bulat(tahunIni), akumulasi: bulat(akumulasi), rincian };
}

interface ArsipData {
  holding?: { kumulatifL2?: { pendapatan: number; hpp: number; fee: number }; ekuitasAkhir?: { L1: number | null; L2: number | null; holding: number | null } };
}

function arsipAkhirTahun(arsip: ArsipHolding[] | undefined, tahun: number): ArsipData['holding'] | null {
  const a = (arsip ?? []).find((x) => x.periode.slice(0, 7) === `${tahun}-12`);
  return a ? ((a.data as ArsipData)?.holding ?? null) : null;
}

export interface BarisLr {
  kode: string;
  label: string;
  L1: number | null;
  L2: number | null;
  holding: number | null;
  /** Pendapatan positif, beban negatif. Konsolidasi = jumlah kolom − eliminasi. */
  konsolidasi: number | null;
  catatan?: string;
}

export interface GajiHolding {
  periode: string;
  cabang: string;
  nominal: number;
  status: 'transferred' | 'pending_transfer' | string;
}

export interface LaporanHolding {
  entitas: string;
  tahun: number;
  resmi: boolean;
  statusPeriode: string;
  labaRugi: BarisLr[];
  labaBersih: { L1: number | null; L2: number | null; holding: number; konsolidasi: number | null };
  posisi: {
    perTanggal: string;
    aset: BarisLr[];
    liabilitas: BarisLr[];
    totalAset: BarisLr;
    totalLiabilitas: BarisLr;
    komponenEkuitas: BarisLr[];
    ekuitas: BarisLr;
  };
  pajak: { pphFinal: number | null; pphBadan: number; pkp: number; omzetNonFinal: number };
  /** Untuk arsip tutup buku Desember → saldo awal tahun berikutnya. */
  kumulatifL2: { pendapatan: number; hpp: number; fee: number };
  ekuitasAkhir: { L1: number | null; L2: number | null; holding: number | null };
  gaji: { daftar: GajiHolding[]; perCabang: { cabang: string; dibayar: number; terutang: number }[]; dikecualikanVilla: number };
  eliminasi: { label: string; nilai: number }[];
  rekonsiliasi: { label: string; kiri: number; kanan: number; cocok: boolean }[];
  catatan: { judul: string; isi: string[] }[];
}

const nol = (v: number | null) => v ?? 0;
const tambah = (...v: (number | null)[]) => (v.some((x) => x === null) ? null : bulat(jumlah(v, (x) => x ?? 0)));

const tanpaMinNol = (v: number | null) => (v === 0 ? 0 : v);

/**
 * null di kolom = "tidak berlaku untuk lini ini" → konsolidasi menjumlah kolom
 * yang berisi. Bila suatu kolom berarti "data TIDAK TERSEDIA" (mis. kas villa
 * belum dicatat), sebutkan di `tidakTersedia` → konsolidasi ikut null.
 */
function baris(
  kode: string,
  label: string,
  L1: number | null,
  L2: number | null,
  holding: number | null,
  catatan?: string,
  tidakTersedia = false,
): BarisLr {
  const [a, b, c] = [tanpaMinNol(L1), tanpaMinNol(L2), tanpaMinNol(holding)];
  const isi = [a, b, c].filter((x): x is number => x !== null);
  const konsolidasi = tidakTersedia || isi.length === 0 ? null : tanpaMinNol(bulat(jumlah(isi, (x) => x)));
  return { kode, label, L1: a, L2: b, holding: c, konsolidasi, catatan };
}

export function gajiDariSnapshot(data: DataCfo): GajiHolding[] {
  return data.snapshot
    .filter((s) => s.jenis === 'gaji_karyawan')
    .map((s) => ({
      periode: teks(s.data.periode),
      cabang: teks(s.data.cabang) || '(tanpa cabang)',
      nominal: bulat(angka(s.data.nominal as number)),
      status: teks(s.data.status),
    }))
    .filter((g) => /^\d{4}-\d{2}$/.test(g.periode));
}

interface HasilTahun {
  labaRugi: BarisLr[];
  labaBersih: { L1: number | null; L2: number | null; holding: number; konsolidasi: number | null };
  pphFinal: number | null;
  /** PPh final atas penjualan unit villa Loonars 1 (jurnal LL, keputusan D-1). */
  pphFinalL1: number;
  /** Laba operasional villa L1 (tanpa pengembangan/penjualan unit) — dasar rekonsiliasi ke laporan villa. */
  labaL1Operasi: number | null;
  pengembanganL1: { penjualan: number; hpp: number; beban: number } | null;
  pphBadan: number;
  pkp: number;
  omzetNonFinal: number;
  penyusutan: ReturnType<typeof penyusutanProyek>;
  bulanL1: ModelCfo['l1']['bulan'];
  sementara: string[];
  l2Sah: boolean;
  gaji: { daftar: GajiHolding[]; perCabang: { cabang: string; dibayar: number; terutang: number }[]; dikecualikanVilla: number };
}

function hitungTahun(m: ModelCfo, data: DataCfo, tahun: number, arsip?: ArsipHolding[]): HasilTahun {
  const th = String(tahun);
  const { l1, l2 } = m;

  // ── Loonars 1: bulan laporan villa dalam tahun ini ─────────────────────────
  const bulanL1 = l1.bulan.filter((b) => b.bulan.startsWith(th));
  const adaL1 = bulanL1.length > 0;
  const s1 = (f: (b: (typeof bulanL1)[number]) => number) => (adaL1 ? bulat(jumlah(bulanL1, f)) : null);
  const l1Pendapatan = s1((b) => b.revenue);
  const sementara = bulanL1.filter((b) => b.status !== 'final').map((b) => b.bulan);

  // ── Loonars 2: diakui 31 Desember (serah terima akhir Desember). Nilai tahun
  // = kumulatif sekarang − kumulatif akhir tahun lalu (arsip tutup buku Des).
  const kum = { pendapatan: l2.pendapatanDiakui, hpp: l2.hppDiakui, fee: l2.fee.terutang + l2.fee.dibayar };
  const dasar = tahun === TAHUN_AWAL_L2 ? { pendapatan: 0, hpp: 0, fee: 0 } : (arsipAkhirTahun(arsip, tahun - 1)?.kumulatifL2 ?? null);
  const l2Sah = tahun >= TAHUN_AWAL_L2 && dasar !== null;
  const l2Pendapatan = l2Sah ? bulat(kum.pendapatan - dasar!.pendapatan) : null;
  const l2Hpp = l2Sah ? -bulat(kum.hpp - dasar!.hpp) : null;
  const l2Fee = l2Sah ? -bulat(kum.fee - dasar!.fee) : null;

  // ── Holding: gaji tim bersama (akrual per periode gaji) ────────────────────
  const gajiTahun = gajiDariSnapshot(data).filter((g) => g.periode.startsWith(th));
  const gajiHolding = gajiTahun.filter((g) => !CABANG_GAJI_VILLA.includes(g.cabang));
  const dikecualikanVilla = bulat(jumlah(gajiTahun.filter((g) => CABANG_GAJI_VILLA.includes(g.cabang)), (g) => g.nominal));
  const bebanGaji = -bulat(jumlah(gajiHolding, (g) => g.nominal));
  const perCabangMap = new Map<string, { dibayar: number; terutang: number }>();
  for (const g of gajiHolding) {
    const v = perCabangMap.get(g.cabang) ?? { dibayar: 0, terutang: 0 };
    if (g.status === 'transferred') v.dibayar += g.nominal;
    else v.terutang += g.nominal;
    perCabangMap.set(g.cabang, v);
  }

  // ── Loonars 1: pengembangan & penjualan unit villa (jurnal LL, D-1) ───────
  const bulanTahun = Array.from({ length: 12 }, (_, i) => `${th}-${String(i + 1).padStart(2, '0')}`);
  const dev = labaRugiPengembanganL1(data, bulanTahun);
  const adaDev = Object.keys(dev).length > 0;
  const devV = (k: keyof typeof dev) => dev[k]?.nilai ?? 0;
  const devBeban = devV('gaji') + devV('listrikAir') + devV('pemasaran') + devV('administrasi') + devV('lain');

  // ── Penyusutan & bunga ─────────────────────────────────────────────────────
  const penyusutan = penyusutanProyek(m, data, tahun);

  const sebelumPajak: BarisLr[] = [
    baris('4-01', 'Pendapatan sewa kamar villa (kotor)', l1Pendapatan, null, null),
    baris('4-02', 'Pendapatan penjualan unit villa (serah terima 31 Desember)', null, l2Pendapatan, null),
    baris('4-03', 'Pendapatan penjualan unit villa Loonars 1 (jurnal proyek LL)', adaDev ? devV('penjualan') : null, null, null),
    baris('5-01', 'Komisi OTA', s1((b) => -b.komisiOta), null, null),
    baris('5-02', 'Harga pokok kamar (COGS villa)', s1((b) => -b.cogs), null, null),
    baris('5-03', 'Harga pokok unit terjual', null, l2Hpp, null),
    baris('5-04', 'Harga pokok pembangunan unit villa Loonars 1 (jurnal LL)', adaDev ? -devV('hpp') : null, null, null),
    baris('6-01', 'Beban operasional villa (gaji staf villa)', s1((b) => -b.opex), null, null),
    baris('6-02', 'Bagi hasil investor villa (pool 70%)', s1((b) => -b.bagiHasilInvestor), null, null),
    baris('6-03', 'Top-up jaminan investor villa', s1((b) => -b.topupJaminan), null, null),
    baris('6-04', 'Beban fee marketing penjualan unit', null, l2Fee, null),
    baris('6-05', 'Beban gaji tim bersama (holding)', null, null, bebanGaji),
    baris('6-06', 'Beban proyek pengembangan Loonars 1 (jurnal LL)', adaDev ? -devBeban : null, null, null),
    baris('7-01', `Beban penyusutan (garis lurus ${KEBIJAKAN.penyusutanBangunanTahun} th)`, null, -penyusutan.tahunIni, null),
    baris('7-02', 'Beban bunga (tidak ada pinjaman bank)', 0, 0, 0),
  ];
  const sum = (rows: BarisLr[], k: 'L1' | 'L2' | 'holding') => bulat(jumlah(rows, (b) => nol(b[k])));

  // ── PPh ────────────────────────────────────────────────────────────────────
  // Final 2,5% atas penjualan unit (pengalihan bangunan); laba penjualan unit
  // tidak ikut PPh badan. PKP non-final = laba L1 + holding − penyusutan.
  // Penjualan unit villa L1 (D-1) juga PPh final; laba & bebannya keluar dari PKP.
  const pphFinal = l2Pendapatan === null ? null : bulat((l2Pendapatan * KEBIJAKAN.pphFinalBangunanPct) / 100);
  const pphFinalL1 = adaDev && devV('penjualan') > 0 ? bulat((devV('penjualan') * KEBIJAKAN.pphFinalBangunanPct) / 100) : 0;
  const KODE_DEV = ['4-03', '5-04', '6-06'];
  const labaL1Operasi = adaL1 ? sum(sebelumPajak.filter((b) => !KODE_DEV.includes(b.kode)), 'L1') : null;
  const pkp = Math.max(0, bulat(nol(labaL1Operasi) + sum(sebelumPajak, 'holding') - penyusutan.tahunIni));
  const omzetNonFinal = nol(l1Pendapatan);
  const pph = pphBadan(pkp, omzetNonFinal);
  const labaRugi: BarisLr[] = [
    ...sebelumPajak,
    baris('8-01', `Beban PPh final ${KEBIJAKAN.pphFinalBangunanPct}% penjualan unit (estimasi)`, pphFinalL1 ? -pphFinalL1 : null, pphFinal === null ? null : -pphFinal, null),
    baris('8-02', 'Beban PPh badan — Pasal 31E (estimasi, konsolidasi)', null, null, -pph),
  ];
  const labaL1 = adaL1 || adaDev ? sum(labaRugi, 'L1') : null;
  const labaL2 = l2Sah ? sum(labaRugi, 'L2') : null;
  const labaHolding = sum(labaRugi, 'holding');

  return {
    labaRugi,
    labaBersih: { L1: labaL1, L2: labaL2, holding: labaHolding, konsolidasi: tambah(labaL1, labaL2, labaHolding) },
    pphFinal,
    pphFinalL1,
    labaL1Operasi,
    pengembanganL1: adaDev ? { penjualan: devV('penjualan'), hpp: devV('hpp'), beban: bulat(devBeban) } : null,
    pphBadan: pph,
    pkp,
    omzetNonFinal,
    penyusutan,
    bulanL1,
    sementara,
    l2Sah,
    gaji: {
      daftar: gajiHolding,
      perCabang: [...perCabangMap.entries()].map(([cabang, v]) => ({ cabang, dibayar: bulat(v.dibayar), terutang: bulat(v.terutang) })).sort((a, b) => a.cabang.localeCompare(b.cabang)),
      dikecualikanVilla,
    },
  };
}

export function laporanHolding(
  m: ModelCfo,
  data: DataCfo,
  tahun: number = Number(m.hariIni.slice(0, 4)),
  arsip?: ArsipHolding[],
): LaporanHolding {
  const { l1, l2 } = m;
  const tahunIni = Number(m.hariIni.slice(0, 4));
  const h = hitungTahun(m, data, tahun, arsip);
  // Posisi keuangan selalu per hari ini → komponen tahun berjalan dari tahun ini.
  const hIni = tahun === tahunIni ? h : hitungTahun(m, data, tahunIni, arsip);

  // ── Posisi keuangan (per hari ini; arsip per tanggal lewat tutup buku) ──────
  const n1 = l1.neraca;
  const n2 = l2.neraca;
  const nd = neracaPengembanganL1(data);
  const utangGaji = bulat(jumlah(gajiDariSnapshot(data).filter((g) => g.status === 'pending_transfer' && !CABANG_GAJI_VILLA.includes(g.cabang)), (g) => g.nominal));
  const aset: BarisLr[] = [
    baris('1-01', 'Kas & bank', n1.kas, n2.kas, null, n1.kas === null ? 'Kas villa belum dicatat (AI CFO → Loonars 1). Rekening holding menyusul dari owner.' : 'Rekening holding akan ditambahkan owner; sementara gaji holding dibayar dari dana owner.', n1.kas === null),
    baris('1-02', 'Piutang settlement OTA', n1.piutangOta, null, null),
    baris('1-03', 'Persediaan unit villa dalam pembangunan', null, n2.asetDalamPembangunan, null),
    baris('1-04', 'Aset tetap — bangunan Loonars Coffee (biaya perolehan)', null, n2.asetProyekLain, null),
    baris('1-05', 'Akumulasi penyusutan', null, -hIni.penyusutan.akumulasi, null),
    ...(nd
      ? [
          baris(
            '1-06',
            'Kas & bank — buku besar proyek LL (pengembangan Loonars 1)',
            nd.kas,
            null,
            null,
            nd.kasNegatif.length
              ? `PERLU VERIFIKASI: ${nd.kasNegatif.map((k) => `akun ${k.akun} bersaldo Rp ${k.saldo.toLocaleString('id-ID')}`).join('; ')} — rekening nyata tidak bisa negatif; cocokkan dengan rekening koran.`
              : 'Saldo kumulatif akun kas/bank jurnal proyek LL.',
          ),
          ...(nd.piutangAntarProyek ? [baris('1-07', 'Piutang antar proyek (ke proyek arsip PT)', nd.piutangAntarProyek, null, null, 'Pinjaman jurnal LL ke proyek arsip yang dikunci — satu badan hukum; perlu keputusan penyelesaian.')] : []),
          ...(nd.piutangLain ? [baris('1-08', 'Piutang lain — buku besar proyek LL', nd.piutangLain, null, null)] : []),
          ...(nd.asetTetap ? [baris('1-09', 'Aset tetap — buku besar proyek LL', nd.asetTetap, null, null)] : []),
        ]
      : []),
  ];
  const liabilitas: BarisLr[] = [
    baris('2-01', 'Utang toko bangunan', null, n2.utangToko + n2.utangProyekLain, null),
    baris('2-02', 'Uang muka investor (penjualan unit)', null, n2.uangMukaInvestor, null),
    baris('2-03', 'Utang fee marketing', null, n2.feeTerutang, null),
    baris('2-04', 'Utang kepada owner (dana talangan)', null, n2.utangOwner, null),
    baris('2-05', 'Utang pajak hotel (PBJT)', n1.pajakHotelTerutang, null, null),
    baris('2-06', 'Utang biaya villa belum dibayar', n1.pengajuanBiayaBelumDibayar, null, null, undefined, n1.pengajuanBiayaBelumDibayar === null),
    baris('2-07', 'Utang bagi hasil investor bulan berjalan', n1.kewajibanBagiHasilBerjalan, null, null),
    baris('2-08', 'Utang gaji karyawan', null, null, utangGaji),
    baris('2-09', `Utang PPh ${tahunIni} (estimasi, belum disetor)`, hIni.pphFinalL1 || null, nol(hIni.pphFinal), hIni.pphBadan),
    ...(nd && nd.utang ? [baris('2-10', 'Utang — buku besar proyek LL', nd.utang, null, null)] : []),
  ];
  // Kolom dengan komponen "tidak tersedia" (mis. kas villa belum dicatat) → total null, bukan nol.
  const sumKolom = (rows: BarisLr[], k: 'L1' | 'L2' | 'holding') =>
    rows.some((r) => r[k] === null && k === 'L1' && (r.kode === '1-01' || r.kode === '2-06')) ? null : bulat(jumlah(rows, (r) => nol(r[k])));
  const total = (kode: string, label: string, rows: BarisLr[]) => {
    const [a, b, c] = [sumKolom(rows, 'L1'), sumKolom(rows, 'L2'), sumKolom(rows, 'holding')];
    return baris(kode, label, a, b, c, undefined, a === null || b === null || c === null);
  };
  const totalAset = total('1-99', 'Jumlah aset', aset);
  const totalLiabilitas = total('2-99', 'Jumlah liabilitas', liabilitas);
  const ek = (k: 'L1' | 'L2' | 'holding') => (totalAset[k] === null || totalLiabilitas[k] === null ? null : bulat(nol(totalAset[k]) - nol(totalLiabilitas[k])));
  const ekuitas = baris('3-99', 'Jumlah ekuitas', ek('L1'), ek('L2'), ek('holding'), undefined, ek('L1') === null || ek('L2') === null || ek('holding') === null);

  // Ekuitas: modal disetor ditetapkan dari posisi bisnis berjalan (keputusan
  // owner). Tahun persiapan: modal = ekuitas − laba tahun berjalan. Tahun buku
  // resmi: modal = ekuitas akhir tahun lalu (arsip tutup buku Desember).
  const lbIni = hIni.labaBersih;
  const awal = tahunIni > TAHUN_AWAL_L2 ? (arsipAkhirTahun(arsip, tahunIni - 1)?.ekuitasAkhir ?? null) : null;
  const kol = ['L1', 'L2', 'holding'] as const;
  const modal = Object.fromEntries(
    kol.map((k) => [k, ekuitas[k] === null ? null : awal ? awal[k] : bulat(nol(ekuitas[k]) - nol(lbIni[k]))]),
  ) as Record<(typeof kol)[number], number | null>;
  const selisih = Object.fromEntries(
    kol.map((k) => [k, ekuitas[k] === null || modal[k] === null ? null : bulat(nol(ekuitas[k]) - nol(modal[k]) - nol(lbIni[k]))]),
  ) as Record<(typeof kol)[number], number | null>;
  const komponenEkuitas: BarisLr[] = [
    baris('3-01', awal ? `Modal disetor (ekuitas akhir ${tahunIni - 1})` : 'Modal disetor (ditetapkan dari posisi bisnis berjalan)', modal.L1, modal.L2, modal.holding, undefined, ekuitas.konsolidasi === null),
    baris('3-02', `Laba (rugi) tahun berjalan ${tahunIni}`, lbIni.L1, lbIni.L2, lbIni.holding, undefined, lbIni.konsolidasi === null),
    ...(awal ? [baris('3-03', 'Setoran / (penarikan) owner — selisih', selisih.L1, selisih.L2, selisih.holding, undefined, ekuitas.konsolidasi === null)] : []),
  ];

  // ── Rekonsiliasi ke laporan sumber ─────────────────────────────────────────
  const rekonsiliasi: LaporanHolding['rekonsiliasi'] = [];
  if (h.labaL1Operasi !== null) {
    const bagianMkh = bulat(jumlah(h.bulanL1, (b) => b.bagianMkhBersih));
    rekonsiliasi.push({ label: 'Laba operasional villa L1 (sebelum pajak, tanpa penjualan unit) = bagian MKH bersih di laporan villa', kiri: bulat(h.labaL1Operasi), kanan: bagianMkh, cocok: Math.abs(h.labaL1Operasi - bagianMkh) <= h.bulanL1.length });
  }
  rekonsiliasi.push({ label: 'Aset L2 (sebelum akumulasi penyusutan) = neraca modul Loonars 2', kiri: bulat(nol(totalAset.L2) + hIni.penyusutan.akumulasi), kanan: n2.totalAset, cocok: Math.abs(nol(totalAset.L2) + hIni.penyusutan.akumulasi - n2.totalAset) <= 1 });

  const resmi = tahun >= TAHUN_BUKU_RESMI_PERTAMA;
  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;
  const catatan: LaporanHolding['catatan'] = [
    {
      judul: '1. Entitas & dasar penyusunan',
      isi: [
        `${NAMA_ENTITAS} (sebelumnya PT Maha Karya Haluoleo). Laporan disusun berdasarkan SAK EMKM, basis akrual, konsep biaya historis, mata uang Rupiah.`,
        'Laporan holding menggabungkan dua lini usaha — Loonars 1 (hospitality villa Loonars Private Living, Yogyakarta) dan Loonars 2 (pengembang Loonars Living, termasuk proyek Loonars Coffee) — ditambah biaya bersama tingkat holding.',
        'Proyek lama PT Maha Karya (AFP, IH, GCI, GCR, KDI) beserta utang bank proyek AFP tidak termasuk laporan ini.',
        resmi
          ? `Tahun buku ${tahun}.`
          : `Tahun ${tahun} adalah PERIODE PERSIAPAN (bukan laporan resmi). Tahun buku resmi pertama: ${TAHUN_BUKU_RESMI_PERTAMA}; posisi akhir 31 Desember ${TAHUN_BUKU_RESMI_PERTAMA - 1} (arsip tutup buku) menjadi saldo awal.`,
      ],
    },
    {
      judul: '2. Kebijakan pendapatan',
      isi: [
        'Pendapatan villa diakui KOTOR penuh saat menginap/dibayar tamu; komisi OTA, bagi hasil investor (pool 70%), dan top-up jaminan investor diakui sebagai beban.',
        'Pendapatan walk-in (kafe/spa) belum termasuk karena laporan villa sumber belum memisahkan biayanya.',
        'Pembayaran investor sebelum serah terima unit dicatat sebagai UANG MUKA (liabilitas). Unit diserahterimakan akhir Desember; pendapatan, harga pokok, dan fee marketing unit diakui pada 31 Desember tahun serah terima.',
        `${KEPUTUSAN_D1} Penjualan unit villa Loonars 1 diakui pada tanggal closing di jurnal proyek LL; harga pokoknya = biaya pembangunan yang tercatat di jurnal LL; beban proyek LL disajikan terpisah.${h.pengembanganL1 ? ` Tahun ${tahun}: penjualan ${rp(h.pengembanganL1.penjualan)}, harga pokok ${rp(h.pengembanganL1.hpp)}, beban proyek ${rp(h.pengembanganL1.beban)}.` : ''}`,
        'Keterbatasan penjualan unit Loonars 1 (perlu verifikasi): unit B1 tercatat terjual dengan nilai Rp 0, unit B2 baru tercatat uang muka padahal sistem villa menyatakan lunas, dan 5 unit (A1, A3, B4, C1, C4) belum tercatat terjual. Harga pokok mencakup pembangunan seluruh 13 unit, sehingga margin penjualan belum mencerminkan unit yang terjual saja.',
      ],
    },
    {
      judul: '3. Aset tetap & penyusutan',
      isi: [
        'Biaya pembangunan unit villa dikapitalisasi sebagai persediaan dalam pembangunan sampai serah terima (tidak disusutkan).',
        `Bangunan Loonars Coffee dicatat sebesar biaya perolehan (realisasi MK Connect) dan disusutkan garis lurus ${KEBIJAKAN.penyusutanBangunanTahun} tahun tanpa nilai sisa, mulai bulan setelah proyek berstatus selesai (completed).`,
        ...h.penyusutan.rincian.map((r) => (r.mulai ? `${r.nama}: biaya ${rp(r.biaya)}, siap pakai ${r.mulai}, penyusutan tahun ${tahun} ${rp(r.tahunIni)}.` : `${r.nama}: masih dalam pembangunan — belum disusutkan.`)),
        'Unit villa Loonars 1 yang sudah dijual milik investor, sehingga tidak disusutkan di laporan ini. Unit yang belum terjual belum dipisahkan sebagai persediaan (biaya pembangunannya sudah dibebankan sebagai harga pokok di jurnal LL).',
      ],
    },
    {
      judul: '4. Bunga & pendanaan',
      isi: ['Perusahaan tidak memiliki pinjaman bank, sehingga beban bunga = 0. Dana talangan owner ke Loonars 2 tanpa bunga dan dicatat sebagai utang kepada pemilik.'],
    },
    {
      judul: '5. Pajak penghasilan (estimasi)',
      isi: [
        `Penjualan unit villa (Loonars 1 dan Loonars 2): PPh final ${KEBIJAKAN.pphFinalBangunanPct}% dari nilai penjualan (pengalihan hak atas bangunan, PP 34/2016); laba dan beban penjualan unit tidak ikut dihitung PPh badan.${h.pphFinalL1 ? ` PPh final Loonars 1 tahun ${tahun}: ${rp(h.pphFinalL1)}.` : ''}`,
        `Penghasilan lainnya (villa + holding): PPh badan ${KEBIJAKAN.pphBadanPct}% dengan fasilitas Pasal 31E (pengurangan 50% untuk bagian omzet s.d. Rp 4,8 M). Tahun ${tahun}: omzet non-final ${rp(h.omzetNonFinal)}, PKP ${rp(h.pkp)}, PPh badan ${rp(h.pphBadan)}.`,
        'PBJT (pajak hotel) dicatat terpisah sebagai utang pajak daerah, bukan PPh.',
        'Angka pajak adalah ESTIMASI berdasarkan ketentuan umum dan wajib dikonfirmasi konsultan pajak sebelum SPT; koreksi fiskal (beban yang tidak boleh dikurangkan) belum dihitung.',
      ],
    },
    {
      judul: '6. Ekuitas',
      isi: [
        awal
          ? `Modal disetor = ekuitas akhir ${tahunIni - 1} dari arsip tutup buku; selisih terhadap laba berjalan dicatat sebagai setoran/(penarikan) owner.`
          : 'Modal disetor ditetapkan dari posisi bisnis yang berjalan (keputusan owner): ekuitas per tanggal laporan dikurangi laba tahun berjalan.',
      ],
    },
    {
      judul: '7. Biaya holding & eliminasi',
      isi: [
        'Gaji tim bersama (slip gaji MK Connect, cabang selain staf villa) diakui sebagai beban holding pada periode gajinya; yang belum ditransfer = utang gaji.',
        `Slip gaji cabang ${CABANG_GAJI_VILLA.join(', ')} tidak dimasukkan karena sudah termasuk OPEX laporan villa${h.gaji.dikecualikanVilla ? ` (dikecualikan tahun ini: ${rp(h.gaji.dikecualikanVilla)})` : ''}.`,
        'Belum ada transaksi antar-lini (L1↔L2↔holding) yang tercatat, sehingga tidak ada eliminasi.',
      ],
    },
    ...(h.l2Sah && !h.sementara.length
      ? []
      : [
          {
            judul: '8. Yang masih harus dilengkapi',
            isi: [
              ...(h.l2Sah ? [] : [`Laba rugi Loonars 2 untuk ${tahun} membutuhkan arsip tutup buku Desember ${tahun - 1} (saldo awal kumulatif).`]),
              ...(h.sementara.length ? [`Laporan villa bulan ${h.sementara.join(', ')} masih sementara.`] : []),
            ],
          },
        ]),
  ];

  return {
    entitas: NAMA_ENTITAS,
    tahun,
    resmi,
    statusPeriode: resmi ? `Tahun buku ${tahun}` : `Periode persiapan ${tahun} (tahun buku resmi mulai ${TAHUN_BUKU_RESMI_PERTAMA})`,
    labaRugi: h.labaRugi,
    labaBersih: h.labaBersih,
    posisi: { perTanggal: m.hariIni, aset, liabilitas, totalAset, totalLiabilitas, komponenEkuitas, ekuitas },
    gaji: h.gaji,
    pajak: { pphFinal: h.pphFinal, pphBadan: h.pphBadan, pkp: h.pkp, omzetNonFinal: h.omzetNonFinal },
    eliminasi: [],
    rekonsiliasi,
    catatan,
    kumulatifL2: { pendapatan: l2.pendapatanDiakui, hpp: l2.hppDiakui, fee: l2.fee.terutang + l2.fee.dibayar },
    ekuitasAkhir: { L1: ekuitas.L1, L2: ekuitas.L2, holding: ekuitas.holding },
  };
}

/** Versi ringkas untuk arsip tutup buku (tanpa daftar slip per baris). */
export function holdingUntukArsip(m: ModelCfo, data: DataCfo, periode: string, arsip?: ArsipHolding[]) {
  const h = laporanHolding(m, data, Number(periode.slice(0, 4)), arsip);
  return { ...h, gaji: { perCabang: h.gaji.perCabang, dikecualikanVilla: h.gaji.dikecualikanVilla } };
}
