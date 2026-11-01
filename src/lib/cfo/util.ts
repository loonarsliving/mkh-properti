import type { Num } from './tipe';

/** Angka aman dari PostgREST (numeric bisa berupa string). NaN → 0. */
export function angka(v: Num): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Pembulatan rupiah (half away from zero) — semua total disajikan bulat. */
export function bulat(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function jumlah<T>(arr: readonly T[], f: (x: T) => Num): number {
  let s = 0;
  for (const x of arr) s += angka(f(x));
  return s;
}

/** Tanggal ISO (YYYY-MM-DD) hari ini di zona Asia/Jakarta. */
export function hariIniJakarta(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d);
}

const MS_HARI = 86_400_000;

export function keTanggal(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function tambahHari(iso: string, n: number): string {
  return new Date(keTanggal(iso).getTime() + n * MS_HARI).toISOString().slice(0, 10);
}

export function selisihHari(dari: string, ke: string): number {
  return Math.round((keTanggal(ke).getTime() - keTanggal(dari).getTime()) / MS_HARI);
}

export function bulanDari(iso: string): string {
  return iso.slice(0, 7);
}

export function tambahBulan(bulan: string, n: number): string {
  const [t, b] = bulan.split('-').map(Number);
  const total = t * 12 + (b - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function hariDalamBulan(bulan: string): number {
  const [t, b] = bulan.split('-').map(Number);
  return new Date(Date.UTC(t, b, 0)).getUTCDate();
}

/** Jam sejak timestamp (null → Infinity = belum pernah). */
export function jamSejak(ts: string | null | undefined, sekarang: Date): number {
  if (!ts) return Number.POSITIVE_INFINITY;
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (sekarang.getTime() - t) / 3_600_000;
}

const fmtId = new Intl.NumberFormat('id-ID');

/** "Rp 1.234.567" / "-Rp 1.234.567" — dipakai di teks WA & jawaban chat. */
export function rp(n: number): string {
  const r = bulat(n);
  return `${r < 0 ? '-' : ''}Rp ${fmtId.format(Math.abs(r))}`;
}

/** Ringkas: "Rp 1,2 M", "Rp 15,3 jt". */
export function rpRingkas(n: number): string {
  const abs = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${s}Rp ${(abs / 1e9).toFixed(2).replace('.', ',')} M`;
  if (abs >= 1e6) return `${s}Rp ${(abs / 1e6).toFixed(1).replace('.', ',')} jt`;
  return `${s}Rp ${fmtId.format(Math.round(abs))}`;
}

export function persen(n: number, desimal = 1): string {
  return `${n.toFixed(desimal).replace('.', ',')}%`;
}

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function labelBulan(bulan: string): string {
  const [t, b] = bulan.split('-').map(Number);
  return `${NAMA_BULAN[b - 1]} ${t}`;
}

export function labelTanggal(iso: string): string {
  const [t, b, h] = iso.slice(0, 10).split('-').map(Number);
  return `${h} ${NAMA_BULAN[b - 1]} ${t}`;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function teks(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
