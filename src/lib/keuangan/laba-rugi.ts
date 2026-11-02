/**
 * LAPORAN LABA RUGI INSTITUSIONAL (Tahap 3 awal, tanpa perubahan skema).
 *
 * Struktur mengikuti permintaan owner 2026-11-02 (Gross Revenue → … → Net
 * Profit). Setiap sel membawa status: aktual / estimasi / belum tercatat /
 * tidak tersedia / tidak berlaku / nol karena kebijakan — data kosong TIDAK
 * PERNAH dianggap nol. Subtotal menjumlah pos yang tercatat dan menandai
 * kelengkapannya (Complete / Needs Verification / Incomplete).
 *
 * Sumber angka = model AI CFO yang sama dengan laporan holding (`susunModelCfo`
 * + `laporanHolding`), jadi laba bersih konsolidasi tahunan sama persis dengan
 * Laporan Holding (diuji di laba-rugi.test.ts). Kebijakan yang dipakai adalah
 * keputusan owner yang sudah tercatat di holding.ts:
 *   - pendapatan villa kotor penuh; bagi hasil investor (pool 70%) + top-up
 *     jaminan = beban (ditampilkan sebagai baris tersendiri);
 *   - pendapatan, HPP & fee unit Loonars 2 diakui 31 Desember (serah terima);
 *   - gaji tim bersama (slip MK Connect, selain cabang villa) = beban holding;
 *   - bunga 0 (tidak ada pinjaman bank); penyusutan bangunan Loonars Coffee
 *     garis lurus 20 tahun.
 *
 * Batas yang dinyatakan apa adanya (lihat docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md):
 *   - COGS & gaji villa = biaya STANDAR (dasar bagi hasil investor), bukan
 *     tagihan aktual → status "estimasi".
 *   - Listrik & air, laundry, maintenance, marketing, software, administrasi
 *     villa/holding belum dicatat per kategori di sistem mana pun → "belum
 *     tercatat". Biaya standar yang sudah memuat sebagian pos ini TIDAK dipecah
 *     ulang agar tidak terhitung dua kali.
 *   - Jurnal proyek LL belum dipetakan ke properti (temuan F-1) → tidak
 *     dijumlahkan; nilainya disebut di catatan.
 */
import { CABANG_GAJI_VILLA, gajiDariSnapshot, jadwalPenyusutan, laporanHolding, NAMA_ENTITAS, penyusutanBulan, type ArsipHolding, type LaporanHolding } from '@/lib/cfo/holding';
import type { ModelCfo } from '@/lib/cfo/model';
import type { DataCfo, Sumber } from '@/lib/cfo/tipe';
import { angka, bulat, jumlah, labelBulan, rp } from '@/lib/cfo/util';
import { bulanBerjalan, periodeSebelumnya, type PeriodeLaporan } from './periode';
import { belumTercatat, jumlahSel, kelengkapanDari, sel, tidakBerlaku, type Kelengkapan, type Sel, type StatusAngka } from './status';

export type Kolom = 'L1' | 'L2' | 'holding';
export const KOLOM: { id: Kolom; label: string; ket: string }[] = [
  { id: 'L1', label: 'Loonars 1', ket: 'Hospitality villa (Yogyakarta)' },
  { id: 'L2', label: 'Loonars 2', ket: 'Developer Loonars Living + Loonars Coffee' },
  { id: 'holding', label: 'Holding', ket: 'Biaya bersama tingkat perusahaan' },
];

export interface BarisPl {
  kode: string;
  label: string;
  jenis: 'pos' | 'subtotal' | 'memo';
  sel: Record<Kolom, Sel>;
  konsolidasi: Sel;
  kelengkapan: Kelengkapan;
}

export interface LabaRugiInstitusional {
  entitas: string;
  periode: PeriodeLaporan;
  /** Bulan periode yang sudah berjalan per hari ini. */
  bulanDihitung: string[];
  baris: BarisPl[];
  cakupanL1: { tersedia: string[]; tidakAda: string[]; sementara: string[] };
  kelengkapan: Kelengkapan;
  catatan: string[];
}

const S_VILLA: Sumber = { tabel: 'laporan_villa_bulanan', ket: 'kiriman villa-api' };
const S_GAJI: Sumber = { tabel: 'snapshot:gaji_karyawan', ket: 'slip gaji MK Connect' };
const S_L2: Sumber = { tabel: 'loonars2_v_unit', ket: 'diakui 31 Des (laporanHolding)' };
const S_PROYEK: Sumber = { tabel: 'snapshot:proyek_konstruksi', ket: 'realisasi MK Connect' };
const S_KEBIJAKAN: Sumber = { tabel: 'kebijakan owner 2026-11-02', ket: 'holding.ts KEBIJAKAN' };

/** Urutan & definisi baris. `tanda` hanya dokumentasi: pendapatan +, beban −. */
const POS = {
  pendapatanKotor: { kode: 'PL-01', label: 'Gross Revenue' },
  diskon: { kode: 'PL-02', label: 'Discount' },
  komisiOta: { kode: 'PL-03', label: 'OTA Commission' },
  hpp: { kode: 'PL-05', label: 'Cost of Goods Sold' },
  gaji: { kode: 'PL-07', label: 'Payroll' },
  listrikAir: { kode: 'PL-08', label: 'Electricity & Water' },
  laundry: { kode: 'PL-09', label: 'Laundry' },
  pemeliharaan: { kode: 'PL-10', label: 'Maintenance' },
  pemasaran: { kode: 'PL-11', label: 'Marketing & Advertising' },
  teknologi: { kode: 'PL-12', label: 'Software & Technology' },
  administrasi: { kode: 'PL-13', label: 'Administration' },
  bagiHasil: { kode: 'PL-14', label: 'Investor Profit Share (property contracts)' },
  lain: { kode: 'PL-15', label: 'Other Operating Expenses' },
  penyusutan: { kode: 'PL-17', label: 'Depreciation & Amortization' },
  bunga: { kode: 'PL-19', label: 'Interest Expense' },
  pajak: { kode: 'PL-21', label: 'Corporate Income Tax' },
} as const;
type KunciPos = keyof typeof POS;

function baris(kode: string, label: string, jenis: BarisPl['jenis'], s: Record<Kolom, Sel>, komponen?: Sel[]): BarisPl {
  const konsolidasi = jumlahSel([s.L1, s.L2, s.holding]);
  const status: StatusAngka[] = komponen ? komponen.map((k) => k.status) : [s.L1.status, s.L2.status, s.holding.status];
  return { kode, label, jenis, sel: s, konsolidasi, kelengkapan: kelengkapanDari(status) };
}

export function labaRugiInstitusional(m: ModelCfo, data: DataCfo, periode: PeriodeLaporan, arsip?: ArsipHolding[]): LabaRugiInstitusional {
  const hariIni = m.hariIni;
  const tahunIni = Number(hariIni.slice(0, 4));
  const bulanDihitung = bulanBerjalan(periode, hariIni);

  // ── Loonars 1 ─────────────────────────────────────────────────────────────
  const blnL1 = m.l1.bulan.filter((b) => periode.bulan.includes(b.bulan));
  const tidakAdaL1 = bulanDihitung.filter((b) => !blnL1.some((x) => x.bulan === b));
  const sementaraL1 = blnL1.filter((b) => b.status !== 'final').map((b) => b.bulan);
  const selL1 = (f: (b: (typeof blnL1)[number]) => number, dasar: 'aktual' | 'estimasi', catatan: string): Sel => {
    if (!blnL1.length) return sel(null, 'tidak_tersedia', [S_VILLA], 'Tidak ada laporan villa untuk periode ini.');
    let status: StatusAngka = dasar;
    const cat = [catatan];
    if (sementaraL1.length && status === 'aktual') {
      status = 'estimasi';
      cat.push(`laporan villa ${sementaraL1.map(labelBulan).join(', ')} masih sementara`);
    }
    if (tidakAdaL1.length) {
      status = 'sebagian';
      cat.push(`tidak ada laporan villa untuk ${tidakAdaL1.map(labelBulan).join(', ')}`);
    }
    return sel(bulat(jumlah(blnL1, f)), status, [S_VILLA], cat.filter(Boolean).join('; '));
  };
  const opexLainL1 = bulat(jumlah(blnL1, (b) => b.opexLain));

  // ── Holding: gaji tim bersama ─────────────────────────────────────────────
  const gaji = gajiDariSnapshot(data).filter((g) => periode.bulan.includes(g.periode) && !CABANG_GAJI_VILLA.includes(g.cabang));
  const bulanGaji = [...new Set(gaji.map((g) => g.periode))];
  const tanpaGaji = bulanDihitung.filter((b) => !bulanGaji.includes(b));
  const gajiHolding: Sel = !gaji.length
    ? sel(null, 'tidak_tersedia', [S_GAJI], 'Belum ada slip gaji MK Connect untuk periode ini.')
    : sel(
        -bulat(jumlah(gaji, (g) => g.nominal)),
        tanpaGaji.length ? 'sebagian' : 'aktual',
        [S_GAJI],
        [`Slip cabang ${CABANG_GAJI_VILLA.join(', ')} dikecualikan (sudah di OPEX villa)`, tanpaGaji.length ? `tidak ada slip untuk ${tanpaGaji.map(labelBulan).join(', ')}` : ''].filter(Boolean).join('; '),
      );

  // ── Loonars 2: diakui 31 Desember ─────────────────────────────────────────
  const desember = periode.bulan.find((b) => b.endsWith('-12'));
  const tahunDes = desember ? Number(desember.slice(0, 4)) : null;
  const hDes: LaporanHolding | null = tahunDes === tahunIni ? laporanHolding(m, data, tahunIni, arsip) : null;
  const ambilHolding = (h: LaporanHolding | null, kode: string, k: 'L2' | 'holding') => h?.labaRugi.find((b) => b.kode === kode)?.[k] ?? null;
  const selL2Tahunan = (kode: string, label: string): Sel => {
    if (!desember) return sel(0, 'nol_kebijakan', [S_KEBIJAKAN], `${label} unit diakui 31 Desember saat serah terima (kebijakan owner 2026-11-02).`);
    if (tahunDes !== tahunIni) return sel(null, 'tidak_tersedia', [S_L2], `Untuk tahun selain ${tahunIni}, angka Loonars 2 diambil dari arsip tutup buku Desember — belum tersedia di laporan ini.`);
    const v = ambilHolding(hDes, kode, 'L2');
    if (v === null) return sel(null, 'tidak_tersedia', [S_L2], 'Tidak dapat dihitung (lihat Laporan Holding).');
    return sel(v, 'estimasi', [S_L2], `Diakui 31 Des ${tahunDes}; dihitung dari kontrak & biaya per ${hariIni} — berubah sampai serah terima.`);
  };

  // ── Jurnal LL belum dipetakan (F-1) ───────────────────────────────────────
  const bebanLL = bulat(
    jumlah(
      data.jurnal_bulanan.filter((j) => j.proyek === 'LL' && (j.akun ?? '').startsWith('6-') && periode.bulan.includes(j.bulan)),
      (j) => angka(j.d) - angka(j.k),
    ),
  );
  const pendapatanLL = bulat(
    jumlah(
      data.jurnal_bulanan.filter((j) => j.proyek === 'LL' && (j.akun ?? '').startsWith('4-') && periode.bulan.includes(j.bulan)),
      (j) => angka(j.k) - angka(j.d),
    ),
  );

  // ── Penyusutan ────────────────────────────────────────────────────────────
  const jadwal = jadwalPenyusutan(m, data);
  const adaAsetSusut = jadwal.some((j) => j.mulaiKe !== null);
  const susut = penyusutanBulan(jadwal, periode.bulan, hariIni);

  // ── Pajak ─────────────────────────────────────────────────────────────────
  const tahunan = periode.jenis === 'tahunan' && Number(periode.kode) === tahunIni;
  const hTahun = tahunan ? (hDes ?? laporanHolding(m, data, tahunIni, arsip)) : null;

  const CAT_STANDAR = 'Termasuk sebagian dalam COGS standar villa (listrik kamar & resepsionis, laundry, internet, Cloudbeds) — tidak dipecah ulang agar tidak terhitung dua kali.';
  const pos: Record<KunciPos, Record<Kolom, Sel>> = {
    pendapatanKotor: {
      L1: selL1((b) => b.revenue, 'aktual', 'Total dibayar tamu (sudah setelah diskon/voucher); diakui per bulan check-in.'),
      L2: selL2Tahunan('4-02', 'Pendapatan penjualan'),
      holding: tidakBerlaku(),
    },
    diskon: {
      L1: belumTercatat('Nilai diskon/voucher tidak dikirim sistem villa; Gross Revenue sudah setelah diskon.'),
      L2: tidakBerlaku('Harga unit = harga kontrak.'),
      holding: tidakBerlaku(),
    },
    komisiOta: { L1: selL1((b) => -b.komisiOta, 'aktual', 'Komisi per channel (Cloudbeds).'), L2: tidakBerlaku(), holding: tidakBerlaku() },
    hpp: {
      L1: selL1((b) => -b.cogs, 'estimasi', 'COGS STANDAR per malam terisi (dasar bagi hasil investor), bukan tagihan aktual.'),
      L2: selL2Tahunan('5-03', 'Harga pokok'),
      holding: tidakBerlaku(),
    },
    gaji: {
      L1: selL1((b) => -b.payroll, 'estimasi', 'Gaji staf villa = jumlah staf × gaji standar (laporan villa), bukan slip aktual.'),
      L2: tidakBerlaku('Upah konstruksi dikapitalisasi ke persediaan unit.'),
      holding: gajiHolding,
    },
    listrikAir: { L1: belumTercatat(`Tagihan PLN/PDAM aktual villa belum tercatat. ${CAT_STANDAR}`), L2: tidakBerlaku(), holding: belumTercatat('Belum ada pencatatan biaya kantor holding.') },
    laundry: { L1: belumTercatat(`Laundry aktual ada di pengajuan biaya villa tetapi belum dipetakan. ${CAT_STANDAR}`), L2: tidakBerlaku(), holding: tidakBerlaku() },
    pemeliharaan: { L1: belumTercatat('Biaya maintenance villa belum tercatat.'), L2: tidakBerlaku('Masih tahap pembangunan.'), holding: tidakBerlaku() },
    pemasaran: {
      L1: belumTercatat('Biaya iklan/promosi villa belum tercatat (komisi OTA disajikan terpisah).'),
      L2: selL2Tahunan('6-04', 'Fee marketing'),
      holding: belumTercatat('Belum ada pencatatan biaya pemasaran holding.'),
    },
    teknologi: { L1: belumTercatat(`Langganan software villa belum tercatat per kategori. ${CAT_STANDAR}`), L2: tidakBerlaku(), holding: belumTercatat('Belum ada pencatatan biaya software holding.') },
    administrasi: { L1: belumTercatat('Biaya administrasi villa belum tercatat.'), L2: belumTercatat('Biaya administrasi proyek belum dipetakan.'), holding: belumTercatat('Belum ada pencatatan biaya administrasi holding.') },
    bagiHasil: {
      L1: selL1((b) => -(b.bagiHasilInvestor + b.topupJaminan), 'aktual', 'Pool investor 70% + top-up jaminan, dihitung sistem villa sesuai kontrak (rumus beku). Belum ada catatan pembayarannya.'),
      L2: tidakBerlaku('Pembeli unit Loonars 2 = kontrak jual beli, bukan bagi hasil.'),
      holding: tidakBerlaku(),
    },
    lain: {
      L1: opexLainL1 !== 0 ? selL1((b) => -b.opexLain, 'estimasi', 'OPEX villa di luar gaji (laporan villa).') : belumTercatat('Tidak ada pos OPEX lain di laporan villa.'),
      L2: belumTercatat(
        bebanLL > 0
          ? `Beban jurnal proyek LL periode ini ${rp(bebanLL)} belum dipetakan ke properti (temuan F-1, menunggu keputusan owner D-1) — tidak dijumlahkan.`
          : 'Beban operasional proyek belum dipetakan ke properti (temuan F-1).',
      ),
      holding: belumTercatat('Belum ada pencatatan biaya lain holding.'),
    },
    penyusutan: {
      L1: sel(0, 'nol_kebijakan', [S_KEBIJAKAN], 'Villa Loonars 1 milik investor, tidak disusutkan PT (kebijakan owner 2026-11-02; lihat temuan F-1).'),
      L2: adaAsetSusut
        ? sel(-susut, 'estimasi', [S_PROYEK, S_KEBIJAKAN], 'Bangunan Loonars Coffee, garis lurus 20 th sejak bulan setelah selesai. Biaya perolehan belum direkonsiliasi dengan jurnal LC (F-6).')
        : sel(0, 'nol_kebijakan', [S_PROYEK], 'Bangunan masih dalam pembangunan — belum disusutkan.'),
      holding: belumTercatat('Register aset tetap holding belum ada.'),
    },
    bunga: {
      L1: sel(0, 'nol_kebijakan', [S_KEBIJAKAN], 'Tidak ada pinjaman bank.'),
      L2: sel(0, 'nol_kebijakan', [S_KEBIJAKAN], 'Tidak ada pinjaman bank; talangan owner tanpa bunga.'),
      holding: sel(0, 'nol_kebijakan', [S_KEBIJAKAN], 'Tidak ada pinjaman bank.'),
    },
    pajak: {
      L1: tidakBerlaku('PPh badan atas laba villa dihitung di tingkat holding.'),
      L2: !desember
        ? sel(0, 'nol_kebijakan', [S_KEBIJAKAN], 'PPh final 2,5% terutang saat pengalihan unit (31 Des).')
        : (() => {
            const v = ambilHolding(hDes, '8-01', 'L2');
            return v === null ? sel(null, 'tidak_tersedia', [S_L2], 'Tidak dapat dihitung untuk periode ini.') : sel(v, 'estimasi', [S_KEBIJAKAN], 'PPh final 2,5% (PP 34/2016) — estimasi, konfirmasi konsultan pajak.');
          })(),
      holding: hTahun
        ? sel(ambilHolding(hTahun, '8-02', 'holding'), 'estimasi', [S_KEBIJAKAN], 'PPh badan 22% fasilitas Pasal 31E atas laba villa + holding − penyusutan; estimasi tahunan s.d. hari ini, koreksi fiskal belum dihitung.')
        : sel(null, 'tidak_tersedia', [S_KEBIJAKAN], 'PPh badan dihitung tahunan — pilih periode tahunan berjalan.'),
    },
  };

  const b = (k: KunciPos) => baris(POS[k].kode, POS[k].label, 'pos', pos[k]);
  const sub = (kode: string, label: string, kunci: KunciPos[], jenis: BarisPl['jenis'] = 'subtotal'): BarisPl => {
    const s = Object.fromEntries((['L1', 'L2', 'holding'] as Kolom[]).map((k) => [k, jumlahSel(kunci.map((x) => pos[x][k]))])) as Record<Kolom, Sel>;
    return baris(kode, label, jenis, s, kunci.flatMap((x) => [pos[x].L1, pos[x].L2, pos[x].holding]));
  };
  const kNet: KunciPos[] = ['pendapatanKotor', 'diskon', 'komisiOta'];
  const kGp: KunciPos[] = [...kNet, 'hpp'];
  const kOpex: KunciPos[] = ['gaji', 'listrikAir', 'laundry', 'pemeliharaan', 'pemasaran', 'teknologi', 'administrasi', 'bagiHasil', 'lain'];
  const kEbitda: KunciPos[] = [...kGp, ...kOpex];
  const kEbit: KunciPos[] = [...kEbitda, 'penyusutan'];
  const kEbt: KunciPos[] = [...kEbit, 'bunga'];
  const kNetProfit: KunciPos[] = [...kEbt, 'pajak'];

  const daftar: BarisPl[] = [
    b('pendapatanKotor'),
    b('diskon'),
    b('komisiOta'),
    sub('PL-04', 'Net Revenue', kNet),
    b('hpp'),
    sub('PL-06', 'Gross Profit', kGp),
    ...kOpex.map(b),
    sub('PL-16', 'EBITDA', kEbitda),
    b('penyusutan'),
    sub('PL-18', 'EBIT', kEbit),
    b('bunga'),
    sub('PL-20', 'EBT', kEbt),
    b('pajak'),
    sub('PL-22', 'Net Profit', kNetProfit),
    sub('PL-M1', 'Memo: EBITDA before investor profit share', kEbitda.filter((x) => x !== 'bagiHasil'), 'memo'),
  ];

  const catatan = [
    `${NAMA_ENTITAS}. Satu entitas legal; kolom = lini usaha/properti. Konsolidasi = jumlah kolom (belum ada transaksi antar-lini yang tercatat, sehingga tidak ada eliminasi).`,
    'Subtotal menjumlah pos yang tercatat saja. Pos "Belum tercatat" bukan nol — subtotal yang memuatnya ditandai Incomplete.',
    'Biaya villa adalah biaya STANDAR yang juga menjadi dasar bagi hasil investor; rumus bagi hasil tidak diubah oleh laporan ini.',
  ];
  if (pendapatanLL !== 0) {
    catatan.push(`Jurnal proyek LL mencatat pendapatan ${rp(pendapatanLL)} pada periode ini (penjualan unit villa) yang TIDAK dimasukkan — menunggu keputusan owner D-1 (temuan F-1).`);
  }
  if (periode.bulan.length > bulanDihitung.length) {
    catatan.push(`Periode belum selesai: dihitung ${bulanDihitung.length} dari ${periode.bulan.length} bulan.`);
  }

  const net = daftar.find((x) => x.kode === 'PL-22')!;
  return {
    entitas: NAMA_ENTITAS,
    periode,
    bulanDihitung,
    baris: daftar,
    cakupanL1: { tersedia: blnL1.map((x) => x.bulan), tidakAda: tidakAdaL1, sementara: sementaraL1 },
    kelengkapan: net.kelengkapan,
    catatan,
  };
}

export type Cakupan = Kolom | 'konsolidasi';

export interface BarisBanding {
  kode: string;
  label: string;
  jenis: BarisPl['jenis'];
  aktual: Sel;
  lalu: Sel;
  /** aktual − periode lalu (null bila salah satu tidak bernilai) */
  selisih: number | null;
  selisihPct: number | null;
  anggaran: Sel;
  kelengkapan: Kelengkapan;
}

export interface BandingLabaRugi {
  cakupan: Cakupan;
  aktual: LabaRugiInstitusional;
  lalu: LabaRugiInstitusional;
  baris: BarisBanding[];
}

/** Aktual vs periode sebelumnya vs anggaran untuk satu kolom/konsolidasi. */
export function bandingLabaRugi(m: ModelCfo, data: DataCfo, periode: PeriodeLaporan, cakupan: Cakupan, arsip?: ArsipHolding[]): BandingLabaRugi {
  const aktual = labaRugiInstitusional(m, data, periode, arsip);
  const lalu = labaRugiInstitusional(m, data, periodeSebelumnya(periode), arsip);
  const ambil = (r: BarisPl) => (cakupan === 'konsolidasi' ? r.konsolidasi : r.sel[cakupan]);
  const anggaran = belumTercatat('Anggaran laba rugi belum ada di sistem (rencana Tahap 3: tabel fin_anggaran).');
  return {
    cakupan,
    aktual,
    lalu,
    baris: aktual.baris.map((r, i) => {
      const a = ambil(r);
      const l = ambil(lalu.baris[i]);
      const selisih = a.nilai !== null && l.nilai !== null ? bulat(a.nilai - l.nilai) : null;
      return {
        kode: r.kode,
        label: r.label,
        jenis: r.jenis,
        aktual: a,
        lalu: l,
        selisih,
        selisihPct: selisih !== null && l.nilai ? (selisih / Math.abs(l.nilai)) * 100 : null,
        anggaran,
        kelengkapan: r.kelengkapan,
      };
    }),
  };
}
