/**
 * LOONARS 2 — DEVELOPER & KONSTRUKSI.
 *
 * Sumber utama: modul Keuangan Loonars 2 (4 rekening, migrasi 0043–0056) yang
 * sudah berjalan di MKH Property, ditambah snapshot penjualan unit dari
 * siteplan MK Connect (loonars_unit_purchases) untuk rekonsiliasi.
 *
 * Perlakuan akuntansi (SAK EMKM / prinsip PSAK 72 untuk penjualan properti):
 *  - Pembayaran investor sebelum serah terima = UANG MUKA (liabilitas
 *    kontrak), BUKAN pendapatan. Pendapatan diakui saat unit serah terima.
 *  - Nilai kontrak yang belum dibayar = piutang kontrak di luar neraca
 *    (belum ada hak tagih tanpa syarat sebelum progres/serah terima).
 *  - Biaya konstruksi diakumulasi sebagai aset dalam pembangunan (persediaan
 *    real estat) dan baru menjadi HPP saat serah terima.
 *  - Hospitality Loonars 2 BELUM beroperasi → tidak ada pendapatan sewa.
 *  - Pengeluaran rekening C yang dibayar dengan dana talangan owner dicatat
 *    sebagai utang ke owner, bukan modal.
 */
import { AKUN_KAS } from '@/lib/master';
import type { DataCfo, L2Unit, Sumber } from './tipe';
import { angka, bulat, jumlah, teks } from './util';

export const KATEGORI_KONSTRUKSI = ['material', 'tukang', 'lain_konstruksi'] as const;

export interface UnitL2 {
  id: number;
  kode: string;
  tipe: string;
  pembeli: string | null;
  terjual: boolean;
  status: string;
  statusBangun: string;
  sedangDibangun: boolean;
  harga: number;
  dibayar: number;
  sisaTagihan: number;
  jatuhTempo: string | null;
  budget: number; // biaya bangun
  budgetDenganBuffer: number;
  aktual: number; // terpakai konstruksi (termasuk utang toko disetujui)
  realisasiPct: number | null;
  overBudget: number; // > budget + buffer
  dibangunTanpaPembeli: boolean;
  fee: number;
  proyeksiLaba: number;
}

/**
 * Proyek konstruksi lain yang DIBIAYAI keuangan Loonars 2 (keputusan owner
 * 2026-11-01: Loonars Coffee memakai keuangan Loonars 2). Sumber budget &
 * realisasi: MK Connect (snapshot 'proyek_konstruksi'); pembanding: jurnal
 * MKH proyeknya (mis. LC). Bila snapshot belum ada, dipakai jurnal saja.
 */
export interface ProyekL2 {
  id: string;
  nama: string;
  kodeJurnal: string | null;
  sumber: 'mk_connect' | 'jurnal';
  budgetTotal: number | null;
  budgetMaterial: number | null;
  budgetTenaga: number | null;
  realisasiMaterial: number;
  realisasiTenaga: number;
  realisasiLain: number;
  realisasiTotal: number;
  komitmen: number;
  selisihBudget: number | null; // + = lewat budget
  realisasiPct: number | null;
  materialPct: number | null;
  utangBelumLunas: number;
  utangLunas: number;
  biayaTerakhir: string | null;
  jurnal: { biaya: number; tenaga: number; utangToko: number; baris: number } | null;
}

/** Pemetaan proyek MK Connect → kode proyek jurnal MKH. */
export const PETA_PROYEK_JURNAL: { cocok: RegExp; kode: string; nama: string }[] = [
  { cocok: /coffee/i, kode: 'LC', nama: 'Loonars Coffee' },
];

export function proyekLoonars2(data: DataCfo): ProyekL2[] {
  const ringkasJurnal = (kode: string) => {
    const j = data.jurnal_bulanan.filter((x) => x.proyek === kode);
    if (!j.length) return null;
    const net = (pred: (a: string) => boolean, debet: boolean) =>
      jumlah(j.filter((x) => x.akun && pred(x.akun)), (x) => (debet ? angka(x.d) - angka(x.k) : angka(x.k) - angka(x.d)));
    return {
      biaya: bulat(net((a) => a.startsWith('5-') || a.startsWith('6-'), true)),
      tenaga: bulat(net((a) => a === '5-1003' || a === '5-1004', true)),
      utangToko: bulat(net((a) => a === '2-1003' || a === '2-1001', false)),
      baris: jumlah(j, (x) => x.n),
    };
  };
  const hasil: ProyekL2[] = [];
  const kodeTerpakai = new Set<string>();
  for (const s of data.snapshot.filter((x) => x.jenis === 'proyek_konstruksi')) {
    const d = s.data as Record<string, unknown>;
    const nama = teks(d.nama);
    const peta = PETA_PROYEK_JURNAL.find((x) => x.cocok.test(nama) || x.cocok.test(teks(d.cabang)));
    const r = (d.realisasi ?? {}) as Record<string, number>;
    const material = angka(r.material_purchase);
    const tenaga = angka(r.contractor_payment) + angka(r.labor_payment) + angka(r.tukang_payment);
    const total = jumlah(Object.values(r), (v) => v);
    const lain = total - material - tenaga;
    const bt = d.budget_total == null ? null : angka(d.budget_total as number);
    const bm = d.budget_material == null ? null : angka(d.budget_material as number);
    if (peta) kodeTerpakai.add(peta.kode);
    hasil.push({
      id: s.id,
      nama: peta?.nama ?? nama,
      kodeJurnal: peta?.kode ?? null,
      sumber: 'mk_connect',
      budgetTotal: bt,
      budgetMaterial: bm,
      budgetTenaga: d.budget_tenaga == null ? null : angka(d.budget_tenaga as number),
      realisasiMaterial: bulat(material),
      realisasiTenaga: bulat(tenaga),
      realisasiLain: bulat(lain),
      realisasiTotal: bulat(total),
      komitmen: bulat(jumlah(Object.values((d.komitmen ?? {}) as Record<string, number>), (v) => v)),
      selisihBudget: bt ? bulat(total - bt) : null,
      realisasiPct: bt ? (total / bt) * 100 : null,
      materialPct: bm ? (material / bm) * 100 : null,
      utangBelumLunas: bulat(angka(d.utang_belum_lunas as number)),
      utangLunas: bulat(angka(d.utang_lunas as number)),
      biayaTerakhir: teks(d.biaya_terakhir) || null,
      jurnal: peta ? ringkasJurnal(peta.kode) : null,
    });
  }
  // Belum ada snapshot: tetap tampilkan dari jurnal agar biayanya tidak hilang dari laporan.
  for (const peta of PETA_PROYEK_JURNAL.filter((x) => !kodeTerpakai.has(x.kode))) {
    const j = ringkasJurnal(peta.kode);
    if (!j) continue;
    hasil.push({
      id: `jurnal:${peta.kode}`, nama: peta.nama, kodeJurnal: peta.kode, sumber: 'jurnal',
      budgetTotal: null, budgetMaterial: null, budgetTenaga: null,
      realisasiMaterial: 0, realisasiTenaga: j.tenaga, realisasiLain: j.biaya - j.tenaga, realisasiTotal: j.biaya,
      komitmen: 0, selisihBudget: null, realisasiPct: null, materialPct: null,
      utangBelumLunas: Math.max(0, j.utangToko), utangLunas: 0, biayaTerakhir: null, jurnal: j,
    });
  }
  return hasil;
}

export interface LaporanL2 {
  unit: UnitL2[];
  jumlahUnit: number;
  unitTerjual: number;
  unitTersedia: number;
  nilaiKontrak: number; // Sales Contract Value (unit terjual)
  nilaiPersediaanTersedia: number; // harga unit belum terjual
  cashInInvestor: number;
  cashInPerJenis: Record<string, number>;
  piutangKontrak: number; // outstanding receivables (di luar neraca)
  biayaKonstruksiAkrual: number; // terpakai per unit + pengeluaran tanpa unit
  biayaKonstruksiTanpaUnit: number;
  biayaKonstruksiKas: number; // kas keluar konstruksi (termasuk cicilan utang)
  budgetTotal: number; // biaya bangun semua unit
  budgetUnitAktif: number; // unit yang sudah mulai dibangun
  aktualUnitAktif: number;
  utangToko: number;
  utangTokoPerToko: { id: number; nama: string; sisa: number }[];
  cicilanMenunggu: number;
  pengajuanMenunggu: number;
  danaTalangan: number; // saldo negatif rekening = dana owner yang dipakai
  rekening: { kode: string; nama: string; saldo: number; menungguTransfer: number }[];
  kasRekeningPositif: number;
  tanah: { target: number; dibayar: number; sisa: number; jatuhTempo: string | null };
  fee: { terutang: number; dibayar: number };
  pendapatanDiakui: number; // unit serah terima
  hppDiakui: number;
  uangMukaInvestor: number;
  proyeksi: { pendapatan: number; biayaBangun: number; fee: number; tanah: number; laba: number; marginPct: number | null };
  arusKasBulanan: { bulan: string; masuk: number; keluar: number; keluarKonstruksi: number; keluarLain: number; bersih: number }[];
  neraca: {
    kas: number;
    asetDalamPembangunan: number;
    asetProyekLain: number;
    totalAset: number;
    utangToko: number;
    utangProyekLain: number;
    utangOwner: number;
    uangMukaInvestor: number;
    feeTerutang: number;
    totalLiabilitas: number;
    ekuitasTersirat: number;
    diLuarNeraca: { piutangKontrak: number; sisaSewaTanah: number };
  };
  bukuBesarLL: { kas: number; pendapatan: number; hpp: number; beban: number; jumlahBaris: number } | null;
  /** Proyek lain yang dibiayai Loonars 2 (Loonars Coffee). */
  proyek: ProyekL2[];
  biayaProyekLain: number;
  utangProyekLain: number;
  /** Belanja konstruksi gabungan: villa Loonars 2 (kas) + proyek lain (realisasi). */
  belanjaKonstruksiGabungan: number;
  sumber: Sumber[];
}

function terjual(u: L2Unit): boolean {
  return ['booking', 'dp', 'lunas'].includes(u.status);
}

export function laporanLoonars2(data: DataCfo): LaporanL2 {
  const set = data.l2_pengaturan;
  const targetTanah = angka(set?.target_tanah);
  const nUnit = data.l2_unit.length || 1;
  const tanahPerUnit = targetTanah / nUnit;

  const unit: UnitL2[] = data.l2_unit.map((u) => {
    const harga = angka(u.harga);
    const budget = angka(u.biaya_bangun);
    const buffer = angka(u.buffer);
    const aktual = angka(u.terpakai_konstruksi);
    const fee = angka(u.fee);
    const sudahMulai = aktual > 0 || u.status_bangun !== 'belum' || Boolean(u.sedang_dibangun);
    return {
      id: u.id,
      kode: u.kode,
      tipe: u.tipe,
      pembeli: u.nama_pembeli,
      terjual: terjual(u),
      status: u.status,
      statusBangun: u.status_bangun,
      sedangDibangun: Boolean(u.sedang_dibangun),
      harga,
      dibayar: angka(u.total_dibayar),
      sisaTagihan: terjual(u) ? angka(u.sisa_pelunasan) : 0,
      jatuhTempo: u.jatuh_tempo,
      budget,
      budgetDenganBuffer: budget + buffer,
      aktual,
      realisasiPct: budget > 0 ? (aktual / budget) * 100 : null,
      overBudget: Math.max(0, aktual - (budget + buffer)),
      dibangunTanpaPembeli: sudahMulai && !terjual(u) && !u.is_unit_contoh,
      fee,
      proyeksiLaba: harga - Math.max(budget, aktual) - fee - tanahPerUnit,
    };
  });

  const sold = unit.filter((u) => u.terjual);
  const penerimaan = data.l2_penerimaan.filter((r) => r.status !== 'batal');
  const cashInPerJenis: Record<string, number> = {};
  for (const r of penerimaan) cashInPerJenis[r.jenis] = (cashInPerJenis[r.jenis] ?? 0) + angka(r.nominal);
  const cashInInvestor = jumlah(penerimaan, (r) => r.nominal);

  const keluar = data.l2_pengeluaran;
  const konstruksi = keluar.filter((d) => (KATEGORI_KONSTRUKSI as readonly string[]).includes(d.kategori));
  const biayaKonstruksiKas = jumlah(konstruksi, (d) => d.nominal);
  const biayaKonstruksiTanpaUnit = jumlah(
    konstruksi.filter((d) => d.unit_id == null && d.cicilan_id == null),
    (d) => d.nominal,
  );
  const biayaKonstruksiAkrual = jumlah(unit, (u) => u.aktual) + biayaKonstruksiTanpaUnit;

  const aktif = unit.filter((u) => u.aktual > 0 || u.statusBangun !== 'belum' || u.sedangDibangun);
  const utangTokoPerToko = data.l2_toko
    .map((t) => ({ id: t.id, nama: t.nama, sisa: Math.max(0, angka(t.utang_disetujui) - angka(t.cicilan_dibayar)) }))
    .filter((t) => t.sisa > 0)
    .sort((a, b) => b.sisa - a.sisa);
  const utangToko = jumlah(utangTokoPerToko, (t) => t.sisa);

  const rekening = data.l2_rekening.map((r) => ({
    kode: r.kode,
    nama: r.nama,
    saldo: angka(r.saldo),
    menungguTransfer: angka(r.menunggu_transfer),
  }));
  const danaTalangan = jumlah(rekening.filter((r) => r.saldo < 0), (r) => -r.saldo);
  const kasRekeningPositif = jumlah(rekening.filter((r) => r.saldo > 0), (r) => r.saldo);

  const tanahDibayar = jumlah(keluar.filter((d) => d.kategori === 'tanah'), (d) => d.nominal);
  const feeDibayar = jumlah(keluar.filter((d) => d.kategori === 'fee_marketing'), (d) => d.nominal);
  const feeTerutang = Math.max(0, jumlah(sold, (u) => u.fee) - feeDibayar);

  const diserahkan = unit.filter((u) => u.statusBangun === 'serah_terima' && u.terjual);
  const pendapatanDiakui = jumlah(diserahkan, (u) => u.harga);
  const hppDiakui = jumlah(diserahkan, (u) => u.aktual);
  const idDiserahkan = new Set(diserahkan.map((u) => u.id));
  const uangMukaInvestor = jumlah(penerimaan.filter((r) => !idDiserahkan.has(r.unit_id)), (r) => r.nominal);

  const proyPendapatan = jumlah(unit, (u) => u.harga);
  const proyBiaya = jumlah(unit, (u) => Math.max(u.budget, u.aktual)) + biayaKonstruksiTanpaUnit;
  const proyFee = jumlah(unit, (u) => u.fee);
  const proyLaba = proyPendapatan - proyBiaya - proyFee - targetTanah;

  // Arus kas bulanan dari buku besar 4 rekening.
  const perBulan = new Map<string, { masuk: number; keluarKonstruksi: number; keluarLain: number }>();
  const slot = (b: string) => {
    if (!perBulan.has(b)) perBulan.set(b, { masuk: 0, keluarKonstruksi: 0, keluarLain: 0 });
    return perBulan.get(b)!;
  };
  for (const r of penerimaan) slot(r.tanggal.slice(0, 7)).masuk += angka(r.nominal);
  for (const d of keluar) {
    const s = slot(d.tanggal.slice(0, 7));
    if ((KATEGORI_KONSTRUKSI as readonly string[]).includes(d.kategori)) s.keluarKonstruksi += angka(d.nominal);
    else s.keluarLain += angka(d.nominal);
  }
  const arusKasBulanan = [...perBulan.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bulan, v]) => ({
      bulan,
      masuk: v.masuk,
      keluar: v.keluarKonstruksi + v.keluarLain,
      keluarKonstruksi: v.keluarKonstruksi,
      keluarLain: v.keluarLain,
      bersih: v.masuk - v.keluarKonstruksi - v.keluarLain,
    }));

  const proyek = proyekLoonars2(data);
  const biayaProyekLain = jumlah(proyek, (x) => x.realisasiTotal);
  const utangProyekLain = jumlah(proyek, (x) => x.utangBelumLunas);

  const asetDalamPembangunan = biayaKonstruksiAkrual - hppDiakui;
  // Bangunan Loonars Coffee = aset tetap dalam penyelesaian milik lini Loonars 2.
  const totalAset = kasRekeningPositif + asetDalamPembangunan + biayaProyekLain;
  const totalLiabilitas = utangToko + utangProyekLain + danaTalangan + uangMukaInvestor + feeTerutang;

  // Buku besar MKH proyek LL (Loonars Living) — ditampilkan TERPISAH, tidak
  // dijumlahkan ke angka modul 4 rekening agar tidak terhitung ganda.
  const ll = data.jurnal_bulanan.filter((j) => j.proyek === 'LL');
  const saldo = (pred: (akun: string) => boolean, debet: boolean) =>
    jumlah(ll.filter((j) => j.akun && pred(j.akun)), (j) => (debet ? angka(j.d) - angka(j.k) : angka(j.k) - angka(j.d)));

  return {
    unit,
    jumlahUnit: unit.length,
    unitTerjual: sold.length,
    unitTersedia: unit.length - sold.length,
    nilaiKontrak: bulat(jumlah(sold, (u) => u.harga)),
    nilaiPersediaanTersedia: bulat(jumlah(unit.filter((u) => !u.terjual), (u) => u.harga)),
    cashInInvestor: bulat(cashInInvestor),
    cashInPerJenis,
    piutangKontrak: bulat(jumlah(sold, (u) => u.sisaTagihan)),
    biayaKonstruksiAkrual: bulat(biayaKonstruksiAkrual),
    biayaKonstruksiTanpaUnit: bulat(biayaKonstruksiTanpaUnit),
    biayaKonstruksiKas: bulat(biayaKonstruksiKas),
    budgetTotal: bulat(jumlah(unit, (u) => u.budget)),
    budgetUnitAktif: bulat(jumlah(aktif, (u) => u.budget)),
    aktualUnitAktif: bulat(jumlah(aktif, (u) => u.aktual)),
    utangToko: bulat(utangToko),
    utangTokoPerToko,
    cicilanMenunggu: bulat(jumlah(data.l2_cicilan.filter((c) => c.status === 'menunggu'), (c) => c.nominal)),
    pengajuanMenunggu: bulat(jumlah(data.l2_pengajuan_menunggu, (m) => m.nominal)),
    danaTalangan: bulat(danaTalangan),
    rekening,
    kasRekeningPositif: bulat(kasRekeningPositif),
    tanah: {
      target: targetTanah,
      dibayar: bulat(tanahDibayar),
      sisa: bulat(Math.max(0, targetTanah - tanahDibayar)),
      jatuhTempo: set?.jatuh_tempo_tanah ?? null,
    },
    fee: { terutang: bulat(feeTerutang), dibayar: bulat(feeDibayar) },
    pendapatanDiakui: bulat(pendapatanDiakui),
    hppDiakui: bulat(hppDiakui),
    uangMukaInvestor: bulat(uangMukaInvestor),
    proyeksi: {
      pendapatan: bulat(proyPendapatan),
      biayaBangun: bulat(proyBiaya),
      fee: bulat(proyFee),
      tanah: bulat(targetTanah),
      laba: bulat(proyLaba),
      marginPct: proyPendapatan > 0 ? (proyLaba / proyPendapatan) * 100 : null,
    },
    arusKasBulanan,
    neraca: {
      kas: bulat(kasRekeningPositif),
      asetDalamPembangunan: bulat(asetDalamPembangunan),
      asetProyekLain: bulat(biayaProyekLain),
      totalAset: bulat(totalAset),
      utangToko: bulat(utangToko),
      utangProyekLain: bulat(utangProyekLain),
      utangOwner: bulat(danaTalangan),
      uangMukaInvestor: bulat(uangMukaInvestor),
      feeTerutang: bulat(feeTerutang),
      totalLiabilitas: bulat(totalLiabilitas),
      ekuitasTersirat: bulat(totalAset - totalLiabilitas),
      diLuarNeraca: {
        piutangKontrak: bulat(jumlah(sold, (u) => u.sisaTagihan)),
        sisaSewaTanah: bulat(Math.max(0, targetTanah - tanahDibayar)),
      },
    },
    bukuBesarLL: ll.length
      ? {
          kas: bulat(saldo((a) => AKUN_KAS.includes(a), true)),
          pendapatan: bulat(saldo((a) => a.startsWith('4-'), false)),
          hpp: bulat(saldo((a) => a.startsWith('5-'), true)),
          beban: bulat(saldo((a) => a.startsWith('6-'), true)),
          jumlahBaris: jumlah(ll, (j) => j.n),
        }
      : null,
    proyek,
    biayaProyekLain: bulat(biayaProyekLain),
    utangProyekLain: bulat(utangProyekLain),
    belanjaKonstruksiGabungan: bulat(biayaKonstruksiKas + biayaProyekLain),
    sumber: [
      { tabel: 'loonars2_v_unit', ket: 'harga efektif, terpakai konstruksi per unit' },
      { tabel: 'snapshot:proyek_konstruksi', ket: 'Loonars Coffee — budget & realisasi MK Connect' },
      { tabel: 'jurnal', ket: 'proyek LC (pembanding)' },
      { tabel: 'loonars2_v_rekening', ket: 'saldo 4 rekening dari buku besar' },
      { tabel: 'loonars2_receipts' },
      { tabel: 'loonars2_disbursements' },
      { tabel: 'loonars2_v_toko', ket: 'utang toko bangunan' },
      { tabel: 'jurnal', ket: 'proyek LL (ditampilkan terpisah)' },
    ],
  };
}
