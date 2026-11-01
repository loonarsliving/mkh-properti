/**
 * LOONARS 1 — HOSPITALITY (Loonars Private Living, sumber: villa-api).
 *
 * Tidak membuat ulang sistem finance villa: angka dasar adalah laporan bulanan
 * yang dikirim villa-api tiap malam (laporan_villa_bulanan, migrasi 0054) —
 * rumusnya sama dengan halaman Finance villa. Di sini hanya disusun ulang ke
 * format laporan manajemen (Revenue → Cost of Revenue → OPEX → EBITDA →
 * Net Profit), ditambah ADR/RevPAR dan pembagian hasil investor.
 *
 * Batas data yang jujur dinyatakan (bukan ditebak):
 *  - Depresiasi, bunga, dan PPh belum tercatat di sumber → Net Profit = EBITDA.
 *  - Sistem villa tidak bisa membaca bank. Kas Loonars 1 = saldo rekening villa
 *    terakhir yang DICATAT CFO (cfo_saldo_rekening, bertanggal) + mutasi villa
 *    sesudah tanggal itu (settlement OTA diterima, booking website & walk-in
 *    lunas, biaya villa ditransfer). Tanpa saldo tercatat → "tidak tersedia".
 *  - COGS = COGS standar per malam (bukan mutasi riil), OPEX = gaji staf.
 */
import type { DataCfo, L1Laporan, Sumber } from './tipe';
import { angka, bulat, jumlah, selisihHari, tambahHari, teks } from './util';

export interface BulanL1 {
  bulan: string; // YYYY-MM
  status: string;
  revenue: number; // omzet kotor (dibayar tamu)
  komisiOta: number;
  pendapatanBersih: number;
  cogs: number;
  costOfRevenue: number; // komisi OTA + COGS
  labaKotor: number; // pendapatan bersih − COGS
  payroll: number;
  opexLain: number;
  opex: number;
  ebitda: number;
  netProfit: number;
  marginEbitdaPct: number | null; // terhadap pendapatan bersih
  pendapatanLain: number; // walk-in (cafe/spa), di luar laba sesuai sumber
  malamTerjual: number;
  malamTersedia: number;
  okupansiPct: number | null;
  adr: number | null; // kotor / malam terjual
  adrBersih: number | null;
  revpar: number | null; // kotor / malam tersedia
  bagiHasilInvestor: number; // pool 70%
  topupJaminan: number; // ditanggung pengelola agar jaminan investor terpenuhi
  bagianPengelola: number; // 30%
  bagianMkhBersih: number; // pengelola − topup jaminan
  channel: { sumber: string; kotor: number; komisi: number; bersih: number; malam: number }[];
  diterimaPada: string;
}

export interface LaporanL1 {
  bulan: BulanL1[];
  terakhir: BulanL1 | null; // bulan berjalan (bisa sementara)
  terakhirFinal: BulanL1 | null;
  ytd: { revenue: number; ebitda: number; netProfit: number; bagianMkhBersih: number; tahun: string } | null;
  arusKasEstimasi: {
    bulan: string;
    masukBersih: number;
    keluarCogs: number;
    keluarOpex: number;
    keluarBagiHasil: number;
    bersih: number;
  }[];
  kas: KasL1 | null;
  neraca: {
    piutangOta: number | null;
    piutangOtaJatuhTempo7Hari: number | null;
    kas: number | null;
    pajakHotelTerutang: number;
    pengajuanBiayaBelumDibayar: number | null;
    kewajibanBagiHasilBerjalan: number;
    catatan: string[];
  };
  sumber: Sumber[];
}

export interface KasL1 {
  rekening: { rekening: string; saldo: number; perTanggal: string; dicatatOleh: string }[];
  saldoTercatat: number;
  perTanggal: string; // tanggal saldo terbaru
  umurHari: number;
  masukSesudah: number;
  keluarSesudah: number;
  mutasiSesudah: { tanggal: string; nominal: number; jenis: string; ket: string }[];
  kasBerjalan: number;
}

/** Kas villa = saldo tercatat + mutasi sesudah tanggal saldo (deterministik). */
export function kasLoonars1(data: DataCfo, hariIni: string): KasL1 | null {
  const saldo = (data.saldo_rekening ?? []).filter((s) => s.lini === 'L1');
  if (!saldo.length) return null;
  const perTanggal = saldo.map((s) => s.per_tanggal.slice(0, 10)).sort().at(-1)!;
  const mutasi = data.snapshot
    .filter((s) => s.jenis === 'villa_kas_masuk' || s.jenis === 'villa_kas_keluar')
    .map((s) => ({
      tanggal: teks(s.data.tanggal).slice(0, 10),
      nominal: (s.jenis === 'villa_kas_masuk' ? 1 : -1) * Math.abs(angka(s.data.nominal as number)),
      jenis: teks(s.data.jenis) || s.jenis,
      ket: teks(s.data.ket),
    }))
    .filter((m) => m.tanggal > perTanggal && m.tanggal <= hariIni)
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const saldoTercatat = jumlah(saldo, (s) => s.saldo);
  const masukSesudah = jumlah(mutasi.filter((m) => m.nominal > 0), (m) => m.nominal);
  const keluarSesudah = -jumlah(mutasi.filter((m) => m.nominal < 0), (m) => m.nominal);
  return {
    rekening: saldo.map((s) => ({ rekening: s.rekening, saldo: angka(s.saldo), perTanggal: s.per_tanggal.slice(0, 10), dicatatOleh: s.dicatat_oleh })),
    saldoTercatat: bulat(saldoTercatat),
    perTanggal,
    umurHari: selisihHari(perTanggal, hariIni),
    masukSesudah: bulat(masukSesudah),
    keluarSesudah: bulat(keluarSesudah),
    mutasiSesudah: mutasi,
    kasBerjalan: bulat(saldoTercatat + masukSesudah - keluarSesudah),
  };
}

function susunBulan(l: L1Laporan): BulanL1 {
  const revenue = angka(l.omzet_kotor);
  const komisiOta = angka(l.komisi_ota);
  const pendapatanBersih = angka(l.pendapatan_bersih);
  const cogs = angka(l.cogs);
  const opex = angka(l.opex);
  const payrollRinci = jumlah(l.opex_rincian ?? [], (o) => o.periode);
  const payroll = payrollRinci > 0 ? Math.min(payrollRinci, opex) : opex;
  const labaKotor = pendapatanBersih - cogs;
  const ebitda = labaKotor - opex;
  const malamTerjual = angka(l.malam_terjual);
  const malamTersedia = angka(l.malam_tersedia);
  const bh = l.bagi_hasil ?? {};
  const pool = angka(bh.pool_investor);
  const topup = bh.jaminan_aktif ? angka(bh.jaminan_topup) : 0;
  const pengelola = angka(bh.pengelola);
  return {
    bulan: l.periode.slice(0, 7),
    status: l.status,
    revenue,
    komisiOta,
    pendapatanBersih,
    cogs,
    costOfRevenue: komisiOta + cogs,
    labaKotor,
    payroll,
    opexLain: opex - payroll,
    opex,
    ebitda,
    netProfit: ebitda,
    marginEbitdaPct: pendapatanBersih > 0 ? (ebitda / pendapatanBersih) * 100 : null,
    pendapatanLain: angka(l.pendapatan_walkin),
    malamTerjual,
    malamTersedia,
    okupansiPct: l.okupansi_pct == null ? null : angka(l.okupansi_pct),
    adr: malamTerjual > 0 ? revenue / malamTerjual : null,
    adrBersih: malamTerjual > 0 ? pendapatanBersih / malamTerjual : null,
    revpar: malamTersedia > 0 ? revenue / malamTersedia : null,
    bagiHasilInvestor: pool,
    topupJaminan: topup,
    bagianPengelola: pengelola,
    bagianMkhBersih: pengelola - topup,
    channel: (l.channel ?? []).map((c) => ({
      sumber: c.sumber,
      kotor: angka(c.kotor),
      komisi: angka(c.komisi),
      bersih: angka(c.bersih),
      malam: angka(c.malam),
    })),
    diterimaPada: l.diterima_pada,
  };
}

export function laporanLoonars1(data: DataCfo, hariIni: string): LaporanL1 {
  const bulan = [...data.l1_laporan].sort((a, b) => a.periode.localeCompare(b.periode)).map(susunBulan);
  const terakhir = bulan.at(-1) ?? null;
  const terakhirFinal = [...bulan].reverse().find((b) => b.status === 'final') ?? null;
  const tahun = hariIni.slice(0, 4);
  const bulanTahunIni = bulan.filter((b) => b.bulan.startsWith(tahun));
  const ytd = bulanTahunIni.length
    ? {
        tahun,
        revenue: jumlah(bulanTahunIni, (b) => b.revenue),
        ebitda: jumlah(bulanTahunIni, (b) => b.ebitda),
        netProfit: jumlah(bulanTahunIni, (b) => b.netProfit),
        bagianMkhBersih: jumlah(bulanTahunIni, (b) => b.bagianMkhBersih),
      }
    : null;

  const arusKasEstimasi = bulan.map((b) => {
    const keluarBagiHasil = b.bagiHasilInvestor + b.topupJaminan;
    return {
      bulan: b.bulan,
      masukBersih: b.pendapatanBersih,
      keluarCogs: b.cogs,
      keluarOpex: b.opex,
      keluarBagiHasil,
      bersih: b.pendapatanBersih - b.cogs - b.opex - keluarBagiHasil,
    };
  });

  // Neraca parsial — hanya pos yang benar-benar ada datanya.
  const ota = data.snapshot.filter((s) => s.jenis === 'ota_settlement');
  const otaTerbuka = ota.filter((s) => String(s.data.status ?? '').toUpperCase() !== 'RECEIVED');
  const batas7 = tambahHari(hariIni, 7);
  const pengajuanVilla = data.snapshot.filter((s) => s.jenis === 'pengajuan_biaya_villa');
  const pajakTerutang = jumlah(data.l1_pajak, (p) => angka(p.pajak_terutang) - angka(p.jumlah_disetor));

  const kas = kasLoonars1(data, hariIni);
  const catatan: string[] = [
    kas
      ? `Kas villa = saldo tercatat ${kas.perTanggal} + mutasi sesudahnya. Gaji staf & bagi hasil investor belum tercatat sebagai mutasi di sistem villa — catat saldo baru setelah membayarnya.`
      : 'Saldo rekening villa belum dicatat — kas Loonars 1 ditampilkan "tidak tersedia", bukan nol. Catat di halaman Loonars 1.',
    'Depresiasi, bunga, dan PPh belum tercatat di sumber, sehingga Net Profit = EBITDA.',
  ];
  if (!ota.length) catatan.push('Piutang settlement OTA belum dikirim dari database villa (snapshot ota_settlement kosong).');

  return {
    bulan,
    terakhir,
    terakhirFinal,
    ytd,
    arusKasEstimasi,
    kas,
    neraca: {
      piutangOta: ota.length ? bulat(jumlah(otaTerbuka, (s) => s.data.nominal as number)) : null,
      piutangOtaJatuhTempo7Hari: ota.length
        ? bulat(
            jumlah(
              otaTerbuka.filter((s) => String(s.data.tanggal_estimasi ?? '9999') <= batas7),
              (s) => s.data.nominal as number,
            ),
          )
        : null,
      kas: kas ? kas.kasBerjalan : null,
      pajakHotelTerutang: bulat(Math.max(0, pajakTerutang)),
      pengajuanBiayaBelumDibayar: pengajuanVilla.length
        ? bulat(
            jumlah(
              pengajuanVilla.filter((s) => ['diajukan', 'disetujui'].includes(String(s.data.status))),
              (s) => s.data.nominal as number,
            ),
          )
        : null,
      kewajibanBagiHasilBerjalan: terakhir ? bulat(terakhir.bagiHasilInvestor + terakhir.topupJaminan) : 0,
      catatan,
    },
    sumber: [
      { tabel: 'laporan_villa_bulanan', ket: 'kiriman harian villa-api (migrasi 0054)' },
      { tabel: 'pajak_hotel_villa' },
      { tabel: 'snapshot:ota_settlement' },
    ],
  };
}
