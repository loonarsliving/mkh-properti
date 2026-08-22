/**
 * Logika penulisan transaksi ke `jurnal` dan tabel pendukungnya.
 *
 * Semua aturan di sini dipindahkan apa adanya dari index.html — pasangan akun,
 * prefix nomor transaksi, dan pemotongan utang otomatis tidak diubah, supaya
 * data yang sudah ada dan yang baru tetap konsisten satu format.
 */

import { COA, REK_COA, getAkun, getProyek } from './master';
import { sbInsert, sbUpdate } from './supabase';
import { today } from './format';
import type { Jurnal, JurnalRow, UtangBank } from '@/types';

/** Nomor transaksi berikutnya untuk sebuah prefix (KM, KK, PAP, …). */
export function nomorBerikutnya(jurnal: Jurnal[], prefix: string): string {
  const angka = jurnal
    .filter((j) => j.no?.startsWith(`${prefix}-`))
    .map((j) => Number.parseInt(j.no.split('-')[1] ?? '0', 10) || 0);
  const berikut = (angka.length ? Math.max(...angka) : 0) + 1;
  return `${prefix}-${String(berikut).padStart(3, '0')}`;
}

function namaAkun(kode: string): string {
  return getAkun(kode)?.nama ?? kode;
}

/** Akun pendapatan sesuai jenis pemasukan — pemetaan dari `simpanKM()` lama. */
export function akunPendapatan(jenis: string): string {
  if (jenis === 'Penjualan Rumah') return '4-1001';
  if (jenis === 'Uang Muka / DP') return '4-1002';
  return '4-1003';
}

/** Akun beban sesuai jenis pengeluaran — pemetaan dari `simpanKK()` lama. */
export function akunBeban(jenis: string): string {
  if (jenis === 'Pembelian Material') return '5-1001';
  if (jenis === 'Bayar Distributor') return '5-1002';
  if (jenis === 'Upah Tukang') return '5-1003';
  if (jenis === 'Biaya Subkon') return '5-1004';
  return '6-1007';
}

export const JENIS_KAS_MASUK = [
  'Penjualan Rumah',
  'Uang Muka / DP',
  'Pelunasan KPR',
  'Pendapatan Lain',
];

export const JENIS_KAS_KELUAR = [
  'Pembelian Material',
  'Bayar Distributor',
  'Upah Tukang',
  'Biaya Subkon',
  'Biaya Operasional',
  'Lainnya',
];

export interface HasilKasMasuk {
  baris: JurnalRow[];
  /** Pesan potongan utang otomatis, jika ada. */
  potongan: { bank: string; potong: number; sisa: number }[];
  utangDiperbarui: { id: number; terbayar: number }[];
}

export async function simpanKasMasuk(input: {
  tgl: string;
  no: string;
  proyek: string;
  rekening: string;
  jenis: string;
  pembeli: string;
  unitId: string;
  namaUnit: string;
  nominal: number;
  ket: string;
  utangBank: UtangBank[];
}): Promise<HasilKasMasuk> {
  const akunPend = akunPendapatan(input.jenis);
  const keterangan = [
    input.jenis,
    input.namaUnit ? ` - ${input.namaUnit}` : '',
    input.pembeli ? ` (${input.pembeli})` : '',
    input.ket ? ` - ${input.ket}` : '',
  ].join('');

  const baris = await sbInsert<JurnalRow>('jurnal', [
    {
      tgl: input.tgl,
      no: input.no,
      ket: keterangan,
      akun: input.rekening,
      nama: namaAkun(input.rekening),
      proyek: input.proyek,
      d: input.nominal,
      k: 0,
    },
    {
      tgl: input.tgl,
      no: input.no,
      ket: keterangan,
      akun: akunPend,
      nama: namaAkun(akunPend),
      proyek: input.proyek,
      d: 0,
      k: input.nominal,
    },
  ]);

  const potongan: HasilKasMasuk['potongan'] = [];
  const utangDiperbarui: HasilKasMasuk['utangDiperbarui'] = [];

  // Pemotongan utang bank otomatis — hanya untuk penjualan rumah, sama seperti
  // aturan lama. Tiap utang aktif proyek dipotong sebesar `potongan_per_unit`.
  if (input.jenis === 'Penjualan Rumah') {
    const aktif = input.utangBank.filter(
      (u) => u.proyek === input.proyek && (u.terbayar || 0) < u.pokok && (u.potongan_per_unit || 0) > 0,
    );

    for (const ub of aktif) {
      const sisa = ub.pokok - (ub.terbayar || 0);
      const potong = Math.min(ub.potongan_per_unit, sisa);
      if (potong <= 0 || ub.id === undefined) continue;

      const terbayarBaru = (ub.terbayar || 0) + potong;
      await sbUpdate('utang_bank', ub.id, { terbayar: terbayarBaru });
      utangDiperbarui.push({ id: ub.id, terbayar: terbayarBaru });

      const noAuto = `APT-${input.no}`;
      const ketAuto = `[AUTO] Potongan utang ${ub.jenis ?? ''} ${ub.bank} dari penjualan${
        input.namaUnit ? ` unit ${input.namaUnit}` : ''
      }`;
      const rekAuto = REK_COA[input.proyek] ?? '1-1001';

      const barisAuto = await sbInsert<JurnalRow>('jurnal', [
        {
          tgl: input.tgl,
          no: noAuto,
          ket: ketAuto,
          akun: '2-2001',
          nama: namaAkun('2-2001'),
          proyek: input.proyek,
          d: potong,
          k: 0,
        },
        {
          tgl: input.tgl,
          no: noAuto,
          ket: ketAuto,
          akun: rekAuto,
          nama: namaAkun(rekAuto),
          proyek: input.proyek,
          d: 0,
          k: potong,
        },
      ]);
      baris.push(...barisAuto);
      potongan.push({ bank: ub.bank, potong, sisa: ub.pokok - terbayarBaru });
    }
  }

  return { baris, potongan, utangDiperbarui };
}

export async function simpanKasKeluar(input: {
  tgl: string;
  no: string;
  proyek: string;
  rekening: string;
  jenis: string;
  supplier: string;
  nominal: number;
  ket: string;
}): Promise<JurnalRow[]> {
  const akunBbn = akunBeban(input.jenis);
  const keterangan = [
    input.jenis,
    input.supplier ? ` - ${input.supplier}` : '',
    input.ket ? ` - ${input.ket}` : '',
  ].join('');

  return sbInsert<JurnalRow>('jurnal', [
    {
      tgl: input.tgl,
      no: input.no,
      ket: keterangan,
      akun: akunBbn,
      nama: namaAkun(akunBbn),
      proyek: input.proyek,
      d: input.nominal,
      k: 0,
    },
    {
      tgl: input.tgl,
      no: input.no,
      ket: keterangan,
      akun: input.rekening,
      nama: namaAkun(input.rekening),
      proyek: input.proyek,
      d: 0,
      k: input.nominal,
    },
  ]);
}

/**
 * Pinjaman antar proyek: empat baris jurnal sekaligus — piutang di pemberi,
 * utang di penerima, dan mutasi kas di kedua sisi.
 */
export async function simpanPinjamAntarProyek(input: {
  tgl: string;
  no: string;
  dari: string;
  ke: string;
  nominal: number;
  ket: string;
}): Promise<JurnalRow[]> {
  const nmDari = getProyek(input.dari).nama;
  const nmKe = getProyek(input.ke).nama;
  const keterangan = `Pinjam antar proyek: ${nmDari} → ${nmKe}${input.ket ? ` (${input.ket})` : ''}`;
  const rekDari = REK_COA[input.dari] ?? '1-1001';
  const rekKe = REK_COA[input.ke] ?? '1-1001';

  return sbInsert<JurnalRow>('jurnal', [
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: '1-1006', nama: namaAkun('1-1006'), proyek: input.dari, d: input.nominal, k: 0 },
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: rekDari, nama: `Bank ${nmDari}`, proyek: input.dari, d: 0, k: input.nominal },
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: rekKe, nama: `Bank ${nmKe}`, proyek: input.ke, d: input.nominal, k: 0 },
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: '2-1002', nama: namaAkun('2-1002'), proyek: input.ke, d: 0, k: input.nominal },
  ]);
}

export async function simpanUtangBank(input: {
  proyek: string;
  jenis: string;
  bank: string;
  noAkad: string;
  pokok: number;
  potonganPerUnit: number;
  tglAkad: string;
  jatuhTempo: string;
  ket: string;
  jumlahUtangSaatIni: number;
}): Promise<{ utang: UtangBank[]; baris: JurnalRow[] }> {
  const utang = await sbInsert<UtangBank>('utang_bank', [
    {
      proyek: input.proyek,
      jenis: input.jenis,
      bank: input.bank,
      no_akad: input.noAkad,
      pokok: input.pokok,
      potongan_per_unit: input.potonganPerUnit,
      tgl_akad: input.tglAkad || null,
      jt_tempo: input.jatuhTempo || null,
      terbayar: 0,
      ket: input.ket,
    },
  ]);

  const rek = REK_COA[input.proyek] ?? '1-1001';
  const no = `UTG-${String(input.jumlahUtangSaatIni + 1).padStart(3, '0')}`;
  const tgl = input.tglAkad || today();
  const keterangan = `Penerimaan utang ${input.jenis} — ${input.bank}${
    input.noAkad ? ` (${input.noAkad})` : ''
  }`;

  const baris = await sbInsert<JurnalRow>('jurnal', [
    { tgl, no, ket: keterangan, akun: rek, nama: namaAkun(rek), proyek: input.proyek, d: input.pokok, k: 0 },
    { tgl, no, ket: keterangan, akun: '2-2001', nama: namaAkun('2-2001'), proyek: input.proyek, d: 0, k: input.pokok },
  ]);

  return { utang, baris };
}

export async function bayarUtangBank(input: {
  utang: UtangBank;
  tgl: string;
  no: string;
  nominal: number;
  rekening: string;
  ket: string;
}): Promise<JurnalRow[]> {
  const { utang } = input;
  if (utang.id === undefined) throw new Error('Data utang tidak punya id.');

  const terbayarBaru = (utang.terbayar || 0) + input.nominal;
  await sbUpdate('utang_bank', utang.id, { terbayar: terbayarBaru });

  const keterangan = `Pembayaran utang ${utang.jenis ?? ''} — ${utang.bank}${
    input.ket ? ` (${input.ket})` : ''
  }`;

  return sbInsert<JurnalRow>('jurnal', [
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: '2-2001', nama: namaAkun('2-2001'), proyek: utang.proyek, d: input.nominal, k: 0 },
    { tgl: input.tgl, no: input.no, ket: keterangan, akun: input.rekening, nama: namaAkun(input.rekening), proyek: utang.proyek, d: 0, k: input.nominal },
  ]);
}

export const TIPE_PROPERTI = [
  'Rumah Tipe 36',
  'Rumah Tipe 45',
  'Rumah Tipe 54',
  'Rumah Tipe 60',
  'Rumah Tipe 70',
  'Kavling',
  'Ruko',
  'Lainnya',
];

export const JENIS_UTANG = [
  'Kredit Konstruksi',
  'Utang Tanah',
  'Utang Modal Kerja',
  'Lainnya',
];

/** Semua kode akun kas/bank, dipakai untuk validasi form. */
export const KODE_KAS = COA.filter((a) => a.kode.startsWith('1-100') && a.kode !== '1-1006' && a.kode !== '1-1007').map(
  (a) => a.kode,
);
