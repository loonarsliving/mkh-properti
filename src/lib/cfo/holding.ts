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
 * Semua angka dihitung di sini dari model yang sama dengan halaman AI CFO lain
 * (deterministik). Bila suatu bagian tidak bisa dihitung untuk periode yang
 * diminta, nilainya null + catatan — tidak pernah ditebak.
 */
import type { ModelCfo } from './model';
import type { DataCfo } from './tipe';
import { angka, bulat, jumlah, teks } from './util';

export const TAHUN_BUKU_RESMI_PERTAMA = 2027;
export const NAMA_ENTITAS = 'PT Loonars Mahakarya';
/** Cabang MK Connect yang gajinya sudah masuk OPEX laporan villa (Loonars 1). */
export const CABANG_GAJI_VILLA = ['Loonars Private Living'];
/** Tahun di mana seluruh aktivitas Loonars 2 terjadi (dasar kumulatif sah). */
const TAHUN_AWAL_L2 = 2026;

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
    ekuitas: BarisLr;
  };
  gaji: { daftar: GajiHolding[]; perCabang: { cabang: string; dibayar: number; terutang: number }[]; dikecualikanVilla: number };
  eliminasi: { label: string; nilai: number }[];
  rekonsiliasi: { label: string; kiri: number; kanan: number; cocok: boolean }[];
  catatan: { judul: string; isi: string[] }[];
}

const nol = (v: number | null) => v ?? 0;
const tambah = (...v: (number | null)[]) => (v.some((x) => x === null) ? null : bulat(jumlah(v, (x) => x ?? 0)));

function baris(kode: string, label: string, L1: number | null, L2: number | null, holding: number | null, catatan?: string): BarisLr {
  return { kode, label, L1, L2, holding, konsolidasi: tambah(L1, L2, holding), catatan };
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

export function laporanHolding(m: ModelCfo, data: DataCfo, tahun: number = Number(m.hariIni.slice(0, 4))): LaporanHolding {
  const th = String(tahun);
  const { l1, l2 } = m;

  // ── Loonars 1: bulan laporan villa dalam tahun ini ─────────────────────────
  const bulanL1 = l1.bulan.filter((b) => b.bulan.startsWith(th));
  const adaL1 = bulanL1.length > 0;
  const s1 = (f: (b: (typeof bulanL1)[number]) => number) => (adaL1 ? bulat(jumlah(bulanL1, f)) : null);
  const l1Pendapatan = s1((b) => b.revenue);
  const l1Komisi = s1((b) => -b.komisiOta);
  const l1Cogs = s1((b) => -b.cogs);
  const l1Opex = s1((b) => -b.opex);
  const l1BagiHasil = s1((b) => -b.bagiHasilInvestor);
  const l1Topup = s1((b) => -b.topupJaminan);
  const sementara = bulanL1.filter((b) => b.status !== 'final').map((b) => b.bulan);

  // ── Loonars 2: belum ada tanggal serah terima per unit → kumulatif hanya sah
  // untuk tahun awal (seluruh aktivitas L2 terjadi di tahun itu).
  const l2Sah = tahun === TAHUN_AWAL_L2;
  const l2Pendapatan = l2Sah ? l2.pendapatanDiakui : null;
  const l2Hpp = l2Sah ? -l2.hppDiakui : null;
  const l2Fee = l2Sah ? -(l2.fee.terutang + l2.fee.dibayar) : null;

  // ── Holding: gaji tim bersama (akrual per periode gaji) ────────────────────
  const semuaGaji = gajiDariSnapshot(data);
  const gajiTahun = semuaGaji.filter((g) => g.periode.startsWith(th));
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
  const utangGaji = bulat(jumlah(semuaGaji.filter((g) => g.status === 'pending_transfer' && !CABANG_GAJI_VILLA.includes(g.cabang)), (g) => g.nominal));

  const labaRugi: BarisLr[] = [
    baris('4-01', 'Pendapatan sewa kamar villa (kotor)', l1Pendapatan, null, null),
    baris('4-02', 'Pendapatan penjualan unit villa (serah terima)', null, l2Pendapatan, null, l2Sah ? 'Diakui saat serah terima unit.' : undefined),
    baris('5-01', 'Komisi OTA', l1Komisi, null, null),
    baris('5-02', 'Harga pokok kamar (COGS villa)', l1Cogs, null, null),
    baris('5-03', 'Harga pokok unit terjual', null, l2Hpp, null),
    baris('6-01', 'Beban operasional villa (gaji staf villa)', l1Opex, null, null),
    baris('6-02', 'Bagi hasil investor villa (pool 70%)', l1BagiHasil, null, null),
    baris('6-03', 'Top-up jaminan investor villa', l1Topup, null, null),
    baris('6-04', 'Beban fee marketing penjualan unit', null, l2Fee, null),
    baris('6-05', 'Beban gaji tim bersama (holding)', null, null, bebanGaji),
  ];
  const sumLr = (k: 'L1' | 'L2') => bulat(jumlah(labaRugi, (b) => nol(b[k])));
  const labaL1 = adaL1 ? sumLr('L1') : null;
  const labaL2 = l2Sah ? sumLr('L2') : null;
  const labaHolding = bebanGaji;
  const eliminasi: { label: string; nilai: number }[] = [];
  const labaBersih = {
    L1: labaL1,
    L2: labaL2,
    holding: labaHolding,
    konsolidasi: tambah(labaL1, labaL2, labaHolding),
  };

  // ── Posisi keuangan (per hari ini; arsip per tanggal lewat tutup buku) ──────
  const n1 = l1.neraca;
  const n2 = l2.neraca;
  const aset: BarisLr[] = [
    baris('1-01', 'Kas & bank', n1.kas, n2.kas, null, 'Holding belum punya rekening tercatat; gaji holding dibayar dari dana owner.'),
    baris('1-02', 'Piutang settlement OTA', n1.piutangOta, null, null),
    baris('1-03', 'Persediaan unit villa dalam pembangunan', null, n2.asetDalamPembangunan, null),
    baris('1-04', 'Aset tetap dalam penyelesaian (Loonars Coffee)', null, n2.asetProyekLain, null),
  ];
  const liabilitas: BarisLr[] = [
    baris('2-01', 'Utang toko bangunan', null, n2.utangToko + n2.utangProyekLain, null),
    baris('2-02', 'Uang muka investor (penjualan unit)', null, n2.uangMukaInvestor, null),
    baris('2-03', 'Utang fee marketing', null, n2.feeTerutang, null),
    baris('2-04', 'Utang kepada owner (dana talangan)', null, n2.utangOwner, null),
    baris('2-05', 'Utang pajak hotel (PBJT)', n1.pajakHotelTerutang, null, null),
    baris('2-06', 'Utang biaya villa belum dibayar', n1.pengajuanBiayaBelumDibayar, null, null),
    baris('2-07', 'Utang bagi hasil investor bulan berjalan', n1.kewajibanBagiHasilBerjalan, null, null),
    baris('2-08', 'Utang gaji karyawan', null, null, utangGaji),
  ];
  // Kolom dengan komponen "tidak tersedia" (mis. kas villa belum dicatat) → total null, bukan nol.
  const sumKolom = (rows: BarisLr[], k: 'L1' | 'L2' | 'holding') =>
    rows.some((r) => r[k] === null && ((k === 'L1' && r.kode === '1-01') || (k === 'L1' && r.kode === '2-06'))) ? null : bulat(jumlah(rows, (r) => nol(r[k])));
  const totalAset = baris('1-99', 'Jumlah aset', sumKolom(aset, 'L1'), sumKolom(aset, 'L2'), 0);
  const totalLiabilitas = baris('2-99', 'Jumlah liabilitas', sumKolom(liabilitas, 'L1'), sumKolom(liabilitas, 'L2'), sumKolom(liabilitas, 'holding'));
  const ek = (k: 'L1' | 'L2' | 'holding') => (totalAset[k] === null || totalLiabilitas[k] === null ? null : bulat(nol(totalAset[k]) - nol(totalLiabilitas[k])));
  const ekuitas = baris('3-99', 'Ekuitas (aset − liabilitas)', ek('L1'), ek('L2'), ek('holding'));

  // ── Rekonsiliasi ke laporan sumber ─────────────────────────────────────────
  const rekonsiliasi: LaporanHolding['rekonsiliasi'] = [];
  if (adaL1 && labaL1 !== null) {
    const bagianMkh = bulat(jumlah(bulanL1, (b) => b.bagianMkhBersih));
    rekonsiliasi.push({ label: 'Laba L1 di holding = bagian MKH bersih di laporan villa', kiri: labaL1, kanan: bagianMkh, cocok: Math.abs(labaL1 - bagianMkh) <= bulanL1.length });
  }
  rekonsiliasi.push({ label: 'Total aset L2 = neraca modul Loonars 2', kiri: nol(totalAset.L2), kanan: n2.totalAset, cocok: Math.abs(nol(totalAset.L2) - n2.totalAset) <= 1 });

  const resmi = tahun >= TAHUN_BUKU_RESMI_PERTAMA;
  const catatan: LaporanHolding['catatan'] = [
    {
      judul: '1. Entitas & dasar penyusunan',
      isi: [
        `${NAMA_ENTITAS} (sebelumnya PT Maha Karya Haluoleo). Laporan disusun berdasarkan SAK EMKM, basis akrual, konsep biaya historis, mata uang Rupiah.`,
        'Laporan holding menggabungkan dua lini usaha — Loonars 1 (hospitality villa Loonars Private Living, Yogyakarta) dan Loonars 2 (pengembang Loonars Living, termasuk proyek Loonars Coffee) — ditambah biaya bersama tingkat holding.',
        resmi
          ? `Tahun buku ${tahun}.`
          : `Tahun ${tahun} adalah PERIODE PERSIAPAN (bukan laporan resmi). Tahun buku resmi pertama: ${TAHUN_BUKU_RESMI_PERTAMA}; saldo akhir 31 Desember ${TAHUN_BUKU_RESMI_PERTAMA - 1} menjadi saldo awal.`,
      ],
    },
    {
      judul: '2. Kebijakan pendapatan',
      isi: [
        'Pendapatan villa diakui KOTOR penuh saat menginap/dibayar tamu; komisi OTA, bagi hasil investor (pool 70%), dan top-up jaminan investor diakui sebagai beban (keputusan owner 2026-11-02).',
        'Pendapatan walk-in (kafe/spa) belum termasuk karena laporan villa sumber belum memisahkan biayanya.',
        'Pembayaran investor sebelum serah terima unit dicatat sebagai UANG MUKA (liabilitas), bukan pendapatan. Pendapatan & harga pokok unit diakui saat serah terima.',
      ],
    },
    {
      judul: '3. Aset',
      isi: [
        'Biaya pembangunan unit villa dikapitalisasi sebagai persediaan dalam pembangunan sampai serah terima.',
        'Pembangunan Loonars Coffee dicatat sebagai aset tetap dalam penyelesaian (realisasi biaya MK Connect); penyusutan dimulai saat siap digunakan.',
        'Kas Loonars 1 = saldo rekening villa yang dicatat + mutasi sesudahnya; bila belum dicatat, ditampilkan "tidak tersedia".',
      ],
    },
    {
      judul: '4. Biaya holding',
      isi: [
        'Gaji tim bersama (slip gaji MK Connect, cabang selain staf villa) diakui sebagai beban holding pada periode gajinya; yang belum ditransfer = utang gaji.',
        `Slip gaji cabang ${CABANG_GAJI_VILLA.join(', ')} tidak dimasukkan karena sudah termasuk OPEX laporan villa${dikecualikanVilla ? ` (dikecualikan tahun ini: ${dikecualikanVilla.toLocaleString('id-ID')})` : ''}.`,
        'Holding belum memiliki rekening tercatat; pembayaran gaji dianggap dari dana owner sehingga tidak tampil sebagai kas holding.',
      ],
    },
    {
      judul: '5. Eliminasi antar-lini',
      isi: ['Belum ada transaksi antar-lini (L1↔L2↔holding) yang tercatat, sehingga tidak ada eliminasi. Dana talangan owner ke Loonars 2 adalah utang kepada pemilik, bukan transaksi antar-lini.'],
    },
    {
      judul: '6. Keterbatasan yang harus dilengkapi sebelum tahun buku resmi',
      isi: [
        ...(l2Sah ? [] : [`Laba rugi Loonars 2 untuk ${tahun} belum bisa dihitung: tanggal serah terima & tanggal penjualan per unit belum tercatat per periode.`]),
        ...(sementara.length ? [`Laporan villa bulan ${sementara.join(', ')} masih sementara.`] : []),
        'Ekuitas dihitung sebagai selisih aset dan liabilitas (belum ada buku besar ekuitas: modal disetor, laba ditahan, prive). Perlu saldo awal dari akuntan untuk tahun buku resmi.',
        'Penyusutan, bunga, dan PPh badan belum tercatat di sumber.',
        'Utang bank proyek AFP (proyek dikunci 1 Nov 2026) di luar laporan Loonars; perlu keputusan akuntan apakah tetap masuk laporan PT.',
      ],
    },
  ];

  return {
    entitas: NAMA_ENTITAS,
    tahun,
    resmi,
    statusPeriode: resmi ? `Tahun buku ${tahun}` : `Periode persiapan ${tahun} (tahun buku resmi mulai ${TAHUN_BUKU_RESMI_PERTAMA})`,
    labaRugi,
    labaBersih,
    posisi: { perTanggal: m.hariIni, aset, liabilitas, totalAset, totalLiabilitas, ekuitas },
    gaji: {
      daftar: gajiHolding,
      perCabang: [...perCabangMap.entries()].map(([cabang, v]) => ({ cabang, dibayar: bulat(v.dibayar), terutang: bulat(v.terutang) })).sort((a, b) => a.cabang.localeCompare(b.cabang)),
      dikecualikanVilla,
    },
    eliminasi,
    rekonsiliasi,
    catatan,
  };
}

/** Versi ringkas untuk arsip tutup buku (tanpa daftar slip per baris). */
export function holdingUntukArsip(m: ModelCfo, data: DataCfo, periode: string) {
  const h = laporanHolding(m, data, Number(periode.slice(0, 4)));
  return { ...h, gaji: { perCabang: h.gaji.perCabang, dikecualikanVilla: h.gaji.dikecualikanVilla } };
}
