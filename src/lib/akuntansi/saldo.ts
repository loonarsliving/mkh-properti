import { COA, getAkun } from '@/lib/master';
import type { Jurnal, JurnalRow, KategoriAkun, SaldoNormal } from '@/types';

/**
 * Menebak kategori & saldo normal dari digit pertama kode akun.
 *
 * Ini jaring pengaman untuk akun yang muncul di `jurnal` tapi tidak ada di COA
 * aplikasi. Kasus nyatanya: sistem **mkhsistem** mengirim event
 * `construction_expense_submitted` lewat `sync_inbound` dan boleh menentukan
 * sendiri akun debet/kredit lewat payload (`debit_akun`/`credit_akun`, lihat
 * migrasi 0021). Kalau suatu saat mkhsistem memakai kode yang belum terdaftar
 * di sini, tanpa jaring ini baris jurnalnya akan **hilang diam-diam** dari
 * laba rugi dan neraca — angkanya tetap ada di buku besar tapi tidak pernah
 * masuk total, sehingga neraca jadi tidak seimbang tanpa penjelasan.
 *
 * Dengan tebakan berbasis prefix, akun asing tetap masuk kelompok yang benar
 * (1 = aset, 2 = liabilitas, 3 = ekuitas, 4 = pendapatan, 5 = HPP, 6 = beban),
 * jadi neraca tetap seimbang dan selisihnya kelihatan di layar, bukan tersembunyi.
 */
function tebakDariKode(kode: string): { kat: KategoriAkun | ''; tipe: SaldoNormal } {
  switch (kode.trim().charAt(0)) {
    // Akun lancar dipakai sebagai default aset: kode 1-2xxx (aset tetap) tetap
    // dibedakan agar tidak salah masuk ke aset lancar di neraca.
    case '1':
      return { kat: kode.startsWith('1-2') ? 'Aset Tetap' : 'Aset Lancar', tipe: 'D' };
    case '2':
      return { kat: kode.startsWith('2-2') ? 'Liabilitas Panjang' : 'Liabilitas Lancar', tipe: 'K' };
    case '3':
      return { kat: 'Ekuitas', tipe: 'K' };
    case '4':
      return { kat: 'Pendapatan', tipe: 'K' };
    case '5':
      return { kat: 'HPP', tipe: 'D' };
    case '6':
      return { kat: 'Beban Operasional', tipe: 'D' };
    default:
      return { kat: '', tipe: 'D' };
  }
}

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
  tipe: SaldoNormal;
  D: number;
  K: number;
  /** true bila akun tidak ada di COA dan kategorinya ditebak dari kode. */
  diluarCoa?: boolean;
}

export type PetaSaldo = Record<string, SaldoAkun>;

/**
 * Akumulasi debet/kredit per akun.
 *
 * Akun yang muncul di jurnal tapi tidak ada di COA tetap dimasukkan, dan
 * kategorinya ditebak dari prefix kode (lihat `tebakDariKode`) supaya angkanya
 * ikut terhitung di laporan, bukan hanya muncul di neraca saldo. Versi HTML
 * lama memberi kategori kosong, yang membuat baris seperti itu hilang dari
 * total laba rugi dan neraca tanpa peringatan apa pun.
 */
export function hitungSaldo(jurnal: Jurnal[]): PetaSaldo {
  const peta: PetaSaldo = {};
  for (const a of COA) {
    peta[a.kode] = { kode: a.kode, nama: a.nama, namaLaporan: a.namaLaporan, kat: a.kat, tipe: a.tipe, D: 0, K: 0 };
  }
  for (const j of jurnal) {
    let s = peta[j.akun];
    if (!s) {
      const tebakan = tebakDariKode(j.akun ?? '');
      s = {
        kode: j.akun,
        // Nama diambil dari baris jurnal itu sendiri — untuk akun dari
        // mkhsistem, itulah satu-satunya label yang tersedia.
        nama: j.nama || j.akun,
        namaLaporan: j.nama || j.akun,
        kat: tebakan.kat,
        tipe: tebakan.tipe,
        D: 0,
        K: 0,
        diluarCoa: true,
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

/** Akun yang dipakai di jurnal tetapi tidak terdaftar di COA aplikasi. */
export function akunDiluarCoa(peta: PetaSaldo): SaldoAkun[] {
  return Object.values(peta).filter((a) => a.diluarCoa && (a.D !== 0 || a.K !== 0));
}
