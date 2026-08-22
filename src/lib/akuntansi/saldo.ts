import { COA, getAkun } from '@/lib/master';
import type { Jurnal, JurnalRow, KategoriAkun } from '@/types';

/** Ubah baris mentah PostgREST menjadi baris jurnal ternormalisasi. */
export function normalisasiJurnal(rows: JurnalRow[]): Jurnal[] {
  return rows.map((j) => ({
    ...j,
    D: Number(j.d) || 0,
    K: Number(j.k) || 0,
  }));
}

export interface SaldoAkun {
  kode: string;
  nama: string;
  namaLaporan: string;
  kat: KategoriAkun | '';
  tipe: 'D' | 'K';
  D: number;
  K: number;
}

export type PetaSaldo = Record<string, SaldoAkun>;

/**
 * Akumulasi debet/kredit per akun.
 *
 * Akun yang muncul di jurnal tapi tidak ada di COA tetap dimasukkan (dengan
 * kategori kosong) supaya angka tidak diam-diam hilang dari neraca saldo —
 * perilaku ini sama seperti versi HTML lama.
 */
export function hitungSaldo(jurnal: Jurnal[]): PetaSaldo {
  const peta: PetaSaldo = {};
  for (const a of COA) {
    peta[a.kode] = { kode: a.kode, nama: a.nama, namaLaporan: a.namaLaporan, kat: a.kat, tipe: a.tipe, D: 0, K: 0 };
  }
  for (const j of jurnal) {
    let s = peta[j.akun];
    if (!s) {
      s = {
        kode: j.akun,
        nama: j.nama || j.akun,
        namaLaporan: j.nama || j.akun,
        kat: '',
        tipe: 'D',
        D: 0,
        K: 0,
      };
      peta[j.akun] = s;
    }
    s.D += j.D;
    s.K += j.K;
  }
  return peta;
}

/** Saldo bertanda sesuai saldo normal akun. */
export function saldoAkun(kode: string, peta: PetaSaldo): number {
  const a = peta[kode];
  if (!a) return 0;
  return a.tipe === 'D' ? a.D - a.K : a.K - a.D;
}

export function saldoKategori(kat: KategoriAkun, peta: PetaSaldo): number {
  return Object.values(peta)
    .filter((a) => a.kat === kat)
    .reduce((s, a) => s + saldoAkun(a.kode, peta), 0);
}

/** Filter jurnal berdasarkan rentang tanggal inklusif (yyyy-mm-dd). */
export function jurnalDalamRentang(jurnal: Jurnal[], mulai: string, selesai: string): Jurnal[] {
  return jurnal.filter((j) => !!j.tgl && j.tgl >= mulai && j.tgl <= selesai);
}

/** Semua jurnal sampai dengan tanggal tertentu (untuk saldo kumulatif neraca). */
export function jurnalSampai(jurnal: Jurnal[], selesai: string): Jurnal[] {
  return jurnal.filter((j) => !!j.tgl && j.tgl <= selesai);
}

/** Semua jurnal sebelum tanggal tertentu (untuk saldo awal periode). */
export function jurnalSebelum(jurnal: Jurnal[], mulai: string): Jurnal[] {
  return jurnal.filter((j) => !!j.tgl && j.tgl < mulai);
}

export function filterProyek(jurnal: Jurnal[], proyek: string): Jurnal[] {
  return proyek === 'ALL' ? jurnal : jurnal.filter((j) => j.proyek === proyek);
}

/** Laba bersih dari sekumpulan baris jurnal: pendapatan - HPP - beban operasional. */
export function labaBersihDari(jurnal: Jurnal[]): number {
  const peta = hitungSaldo(jurnal);
  return (
    saldoKategori('Pendapatan', peta) -
    saldoKategori('HPP', peta) -
    saldoKategori('Beban Operasional', peta)
  );
}

/** Total kas & bank dari peta saldo. */
export function totalKas(peta: PetaSaldo, akunKas: string[]): number {
  return akunKas.reduce((s, k) => s + saldoAkun(k, peta), 0);
}

/** Apakah akun termasuk pos laba rugi? */
export function isAkunLabaRugi(kode: string): boolean {
  const kat = getAkun(kode)?.kat;
  return kat === 'Pendapatan' || kat === 'HPP' || kat === 'Beban Operasional';
}
