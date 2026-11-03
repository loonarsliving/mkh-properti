/**
 * PENGEMBANGAN LOONARS 1 — buku besar MKH proyek LL.
 *
 * Keputusan owner 2026-11-03 (D-1): penjualan unit villa Loonars 1 kepada
 * investor = PENDAPATAN PT (PT membangun lalu menjual unit; investor kemudian
 * menerima bagi hasil sewa). Audit data 2026-11-03: seluruh baris jurnal proyek
 * `LL` (Mei–Okt 2026) adalah proyek pembangunan & penjualan villa Loonars 1
 * (Blok A/B/C) — tidak ada belanja Loonars 2 (AVARA/BANYU/LUNARA) di dalamnya,
 * karena Loonars 2 memakai modul 4 rekening sendiri.
 *
 * Maka jurnal LL dipetakan ke kolom Loonars 1:
 *   4-*  → penjualan unit villa (diakui pada tanggal jurnal closing)
 *   5-*  → harga pokok pembangunan unit
 *   6-*  → beban proyek, dipilah per kategori laporan institusional
 *   1-/2-* → posisi keuangan (kas & bank buku besar, piutang, utang)
 * Baris jurnal TIDAK diubah; ini hanya pemetaan saat laporan disusun.
 *
 * Batas yang diketahui (Data Quality): B1 tercatat terjual Rp 0; B2 baru DP;
 * rekening bank 1-1004 di buku besar LL bersaldo negatif.
 */
import { AKUN_KAS } from '@/lib/master';
import type { DataCfo, JurnalBulanan } from './tipe';
import { angka, bulat } from './util';

export const PROYEK_PENGEMBANGAN_L1 = 'LL';
export const KEPUTUSAN_D1 = 'Keputusan owner 2026-11-03 (D-1): penjualan unit villa Loonars 1 = pendapatan PT.';

export type KategoriL1 = 'penjualan' | 'hpp' | 'gaji' | 'listrikAir' | 'pemasaran' | 'administrasi' | 'lain';

/** Kategori laba rugi untuk akun jurnal (null = akun posisi keuangan). */
export function kategoriAkun(akun: string): KategoriL1 | null {
  if (akun.startsWith('4-')) return 'penjualan';
  if (akun.startsWith('5-')) return 'hpp';
  if (!akun.startsWith('6-')) return null;
  if (akun === '6-1001' || akun === '6-1009') return 'gaji';
  if (akun === '6-1003') return 'listrikAir';
  if (akun === '6-1006' || akun === '6-1008') return 'pemasaran';
  if (akun === '6-1002' || akun === '6-1004' || akun === '6-1005') return 'administrasi';
  return 'lain';
}

const barisLL = (data: DataCfo): JurnalBulanan[] => data.jurnal_bulanan.filter((j) => j.proyek === PROYEK_PENGEMBANGAN_L1 && !!j.akun);

export interface NilaiKategori {
  /** penjualan: kredit − debet; biaya: debet − kredit (positif = beban) */
  nilai: number;
  jumlahBaris: number;
}

/** Laba rugi jurnal LL untuk sekumpulan bulan (YYYY-MM). Kategori tanpa baris jurnal tidak muncul. */
export function labaRugiPengembanganL1(data: DataCfo, bulan: string[]): Partial<Record<KategoriL1, NilaiKategori>> {
  const hasil: Partial<Record<KategoriL1, NilaiKategori>> = {};
  for (const j of barisLL(data)) {
    if (!bulan.includes(j.bulan)) continue;
    const k = kategoriAkun(j.akun!);
    if (!k) continue;
    const v = k === 'penjualan' ? angka(j.k) - angka(j.d) : angka(j.d) - angka(j.k);
    const cur = hasil[k] ?? { nilai: 0, jumlahBaris: 0 };
    cur.nilai += v;
    cur.jumlahBaris += j.n;
    hasil[k] = cur;
  }
  for (const k of Object.keys(hasil) as KategoriL1[]) hasil[k]!.nilai = bulat(hasil[k]!.nilai);
  return hasil;
}

export interface NeracaPengembanganL1 {
  kas: number;
  piutangAntarProyek: number;
  piutangLain: number;
  asetTetap: number;
  utang: number;
  /** akun kas/bank dengan saldo kumulatif negatif (tidak mungkin untuk rekening nyata) */
  kasNegatif: { akun: string; saldo: number }[];
}

/** Saldo kumulatif akun posisi keuangan buku besar LL s.d. data terakhir. */
export function neracaPengembanganL1(data: DataCfo): NeracaPengembanganL1 | null {
  const ll = barisLL(data);
  if (!ll.length) return null;
  const saldoDebet = new Map<string, number>();
  for (const j of ll) saldoDebet.set(j.akun!, (saldoDebet.get(j.akun!) ?? 0) + angka(j.d) - angka(j.k));
  const sum = (pred: (a: string) => boolean) => bulat([...saldoDebet.entries()].filter(([a]) => pred(a)).reduce((s, [, v]) => s + v, 0));
  return {
    kas: sum((a) => AKUN_KAS.includes(a)),
    piutangAntarProyek: sum((a) => a === '1-1006'),
    piutangLain: sum((a) => a.startsWith('1-1') && !AKUN_KAS.includes(a) && a !== '1-1006'),
    asetTetap: sum((a) => a.startsWith('1-2')),
    utang: -sum((a) => a.startsWith('2-')),
    kasNegatif: [...saldoDebet.entries()].filter(([a, v]) => AKUN_KAS.includes(a) && v < -1).map(([akun, v]) => ({ akun, saldo: bulat(v) })),
  };
}
