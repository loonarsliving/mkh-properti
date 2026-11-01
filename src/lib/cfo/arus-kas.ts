/**
 * CASH FLOW MANAGER — forecast harian, mingguan (13 minggu), dan bulanan
 * dengan skenario optimis / normal / pesimis. Murni deterministik: masukan
 * yang sama selalu menghasilkan angka yang sama (diuji vitest).
 *
 * Model simulasi harian:
 *   saldo[h] = saldo[h-1] + arus operasi villa per hari
 *              + peristiwa terjadwal (tagihan investor, utang, pajak, …)
 *              − laju belanja konstruksi per hari (sampai sisa budget habis)
 *
 * Setiap asumsi tertulis di `ASUMSI` dan ditampilkan di UI — tidak ada angka
 * tersembunyi.
 */
import type { Sumber } from './tipe';
import { bulat, hariDalamBulan, tambahHari } from './util';

export type NamaSkenario = 'optimis' | 'normal' | 'pesimis';

export interface ParameterSkenario {
  /** Pengali pendapatan bersih villa. */
  pendapatanL1: number;
  /** Penagihan investor mundur N hari dari jatuh tempo. */
  investorTelatHari: number;
  /** Pengali biaya konstruksi (laju belanja). */
  biayaKonstruksi: number;
  /** Tagihan investor yang sudah lewat jatuh tempo dianggap masuk setelah N hari (null = tidak masuk dalam horizon). */
  tunggakanMasukHari: number | null;
}

export const SKENARIO: Record<NamaSkenario, ParameterSkenario> = {
  optimis: { pendapatanL1: 1.1, investorTelatHari: 0, biayaKonstruksi: 1.0, tunggakanMasukHari: 7 },
  normal: { pendapatanL1: 1.0, investorTelatHari: 0, biayaKonstruksi: 1.0, tunggakanMasukHari: 21 },
  pesimis: { pendapatanL1: 0.75, investorTelatHari: 42, biayaKonstruksi: 1.1, tunggakanMasukHari: null },
};

export const ASUMSI = [
  'Arus operasi villa per hari = (pendapatan bersih − COGS − OPEX) bulan final terakhir ÷ jumlah hari bulan itu.',
  'Bagi hasil investor Loonars 1 (pool 70% + top-up jaminan) dibayar tanggal 10 bulan berikutnya, sebesar bulan final terakhir.',
  'Sisa tagihan investor Loonars 2 masuk pada jatuh tempo unit; yang sudah lewat jatuh tempo masuk sesuai skenario.',
  'Utang toko bangunan dicicil rata 4 minggu; pengajuan yang menunggu dibayar dalam 3 hari.',
  'Laju belanja konstruksi = rata-rata kas keluar konstruksi 28 hari terakhir, berhenti saat sisa budget unit yang sedang dibangun habis.',
  'Sisa sewa tanah dibayar rata per bulan (tanggal 1) sampai jatuh tempo.',
  'Pajak hotel terutang disetor tanggal 15 bulan berikutnya; fee marketing terutang dibayar dalam 30 hari.',
  'Kas Loonars 1 = saldo rekening villa terakhir yang dicatat + mutasi villa sesudahnya; bila belum dicatat, tidak ikut saldo awal.',
  'Kewajiban grup MKH di luar Loonars (utang bank proyek lain, refund customer) tidak masuk forecast kas Loonars — lihat Debt & Liability Center.',
  'Saldo awal = rekening Loonars 2 bersaldo positif + kas/bank buku besar proyek LL + kas villa (bila tercatat).',
];

export interface Peristiwa {
  tanggal: string;
  /** + masuk, − keluar */
  nominal: number;
  jenis: string; // mis. 'tagihan_investor', 'utang_toko', 'sewa_tanah'
  lini: 'L1' | 'L2' | 'Grup';
  ket: string;
  sumber: Sumber;
}

export interface InputArusKas {
  hariIni: string;
  kasAwal: number;
  kasMinimum: number;
  /** arus bersih operasi villa per hari (sebelum skenario) */
  l1MasukHarian: number;
  l1KeluarHarian: number;
  /** peristiwa terjadwal. Tagihan investor ditandai jenis 'tagihan_investor'. */
  peristiwa: Peristiwa[];
  /** laju belanja konstruksi per hari & sisa budget yang boleh dibelanjakan */
  konstruksiPerHari: number;
  konstruksiSisaBudget: number;
}

export interface HariSim {
  tanggal: string;
  masuk: number;
  keluar: number;
  saldo: number;
}

export interface BucketSim {
  label: string;
  mulai: string;
  selesai: string;
  masuk: number;
  keluar: number;
  bersih: number;
  saldoAkhir: number;
}

export interface HasilSkenario {
  nama: NamaSkenario;
  harian: HariSim[];
  mingguan: BucketSim[]; // 13 minggu
  bulanan: BucketSim[]; // 6 bulan
  saldoMin: number;
  tanggalSaldoMin: string;
  tanggalDefisit: string | null; // saldo < 0 pertama
  besarDefisit: number; // saldo terendah bila negatif (positif = besar kekurangan)
  tanggalDiBawahMinimum: string | null;
  kebutuhanDana: number; // agar saldo tidak pernah < kas minimum
  rincianPeristiwa: (Peristiwa & { tanggalEfektif: string })[];
}

export const HORIZON_HARI = 182;

export interface OpsiSimulasi {
  /** Peristiwa tambahan (mis. keputusan CEO yang diuji). */
  tambahan?: Peristiwa[];
  /** Tunda peristiwa keluar dengan jenis tertentu sebanyak N hari (simulasi restrukturisasi). */
  tunda?: { jenis: string[]; hari: number };
}

export function simulasi(input: InputArusKas, nama: NamaSkenario, opsi: OpsiSimulasi = {}): HasilSkenario {
  const p = SKENARIO[nama];
  const akhir = tambahHari(input.hariIni, HORIZON_HARI - 1);

  const efektif: (Peristiwa & { tanggalEfektif: string })[] = [];
  for (const e of [...input.peristiwa, ...(opsi.tambahan ?? [])]) {
    let tgl = e.tanggal < input.hariIni ? input.hariIni : e.tanggal;
    const nominal = e.nominal;
    if (e.jenis === 'tagihan_investor') {
      if (e.tanggal < input.hariIni) {
        if (p.tunggakanMasukHari === null) continue;
        tgl = tambahHari(input.hariIni, p.tunggakanMasukHari);
      } else {
        tgl = tambahHari(e.tanggal, p.investorTelatHari);
      }
    }
    if (e.nominal < 0 && opsi.tunda && opsi.tunda.jenis.includes(e.jenis)) {
      tgl = tambahHari(tgl, opsi.tunda.hari);
    }
    if (tgl > akhir) continue;
    efektif.push({ ...e, nominal, tanggalEfektif: tgl });
  }
  efektif.sort((a, b) => a.tanggalEfektif.localeCompare(b.tanggalEfektif));

  const perTanggal = new Map<string, number[]>();
  for (const e of efektif) {
    const arr = perTanggal.get(e.tanggalEfektif) ?? [];
    arr.push(e.nominal);
    perTanggal.set(e.tanggalEfektif, arr);
  }

  const harian: HariSim[] = [];
  let saldo = input.kasAwal;
  let sisaBudget = input.konstruksiSisaBudget * p.biayaKonstruksi;
  const lajuKonstruksi = input.konstruksiPerHari * p.biayaKonstruksi;
  let saldoMin = saldo;
  let tanggalSaldoMin = input.hariIni;
  let tanggalDefisit: string | null = null;
  let tanggalDiBawahMinimum: string | null = null;

  for (let i = 0; i < HORIZON_HARI; i++) {
    const tgl = tambahHari(input.hariIni, i);
    let masuk = input.l1MasukHarian * p.pendapatanL1;
    let keluar = input.l1KeluarHarian;
    for (const n of perTanggal.get(tgl) ?? []) {
      if (n >= 0) masuk += n;
      else keluar += -n;
    }
    if (sisaBudget > 0 && lajuKonstruksi > 0) {
      const k = Math.min(lajuKonstruksi, sisaBudget);
      keluar += k;
      sisaBudget -= k;
    }
    saldo += masuk - keluar;
    harian.push({ tanggal: tgl, masuk, keluar, saldo });
    if (saldo < saldoMin) {
      saldoMin = saldo;
      tanggalSaldoMin = tgl;
    }
    if (tanggalDefisit === null && saldo < 0) tanggalDefisit = tgl;
    if (tanggalDiBawahMinimum === null && saldo < input.kasMinimum) tanggalDiBawahMinimum = tgl;
  }

  const mingguan: BucketSim[] = [];
  for (let w = 0; w < 13; w++) {
    const potong = harian.slice(w * 7, w * 7 + 7);
    mingguan.push(bucket(`M${w + 1}`, potong));
  }

  const bulanan: BucketSim[] = [];
  const perBulan = new Map<string, HariSim[]>();
  for (const h of harian) {
    const b = h.tanggal.slice(0, 7);
    perBulan.set(b, [...(perBulan.get(b) ?? []), h]);
  }
  for (const [b, hs] of [...perBulan.entries()].slice(0, 6)) bulanan.push(bucket(b, hs));

  return {
    nama,
    harian,
    mingguan,
    bulanan,
    saldoMin: bulat(saldoMin),
    tanggalSaldoMin,
    tanggalDefisit,
    besarDefisit: bulat(Math.max(0, -saldoMin)),
    tanggalDiBawahMinimum,
    kebutuhanDana: bulat(Math.max(0, input.kasMinimum - saldoMin)),
    rincianPeristiwa: efektif,
  };
}

function bucket(label: string, hs: HariSim[]): BucketSim {
  const masuk = hs.reduce((s, h) => s + h.masuk, 0);
  const keluar = hs.reduce((s, h) => s + h.keluar, 0);
  return {
    label,
    mulai: hs[0]?.tanggal ?? '',
    selesai: hs.at(-1)?.tanggal ?? '',
    masuk: bulat(masuk),
    keluar: bulat(keluar),
    bersih: bulat(masuk - keluar),
    saldoAkhir: bulat(hs.at(-1)?.saldo ?? 0),
  };
}

export function semuaSkenario(input: InputArusKas, opsi: OpsiSimulasi = {}): Record<NamaSkenario, HasilSkenario> {
  return {
    optimis: simulasi(input, 'optimis', opsi),
    normal: simulasi(input, 'normal', opsi),
    pesimis: simulasi(input, 'pesimis', opsi),
  };
}

/** Tanggal 1 bulan-bulan antara (dari, sampai], untuk cicilan bulanan. */
export function tanggalSatuBulanan(dari: string, sampai: string): string[] {
  const hasil: string[] = [];
  let [t, b] = dari.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 60; i++) {
    b += 1;
    if (b > 12) {
      b = 1;
      t += 1;
    }
    const tgl = `${t}-${String(b).padStart(2, '0')}-01`;
    if (tgl > sampai) break;
    hasil.push(tgl);
  }
  return hasil;
}

/** Tanggal ke-N bulan berikutnya dari periode YYYY-MM. */
export function tanggalBulanBerikut(bulan: string, hari: number): string {
  let [t, b] = bulan.split('-').map(Number);
  b += 1;
  if (b > 12) {
    b = 1;
    t += 1;
  }
  const bb = `${t}-${String(b).padStart(2, '0')}`;
  return `${bb}-${String(Math.min(hari, hariDalamBulan(bb))).padStart(2, '0')}`;
}
