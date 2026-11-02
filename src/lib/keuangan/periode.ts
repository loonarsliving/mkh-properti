/** Periode laporan institusional: bulanan / kuartalan / tahunan (kalender). */
import { labelBulan, tambahBulan } from '@/lib/cfo/util';

export type JenisPeriode = 'bulanan' | 'kuartalan' | 'tahunan';

export interface PeriodeLaporan {
  jenis: JenisPeriode;
  /** '2026-10' | '2026-Q4' | '2026' */
  kode: string;
  label: string;
  /** daftar bulan YYYY-MM di dalam periode, berurutan */
  bulan: string[];
}

function rangkaBulan(awal: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => tambahBulan(awal, i));
}

/** Periode yang memuat `bulan` (YYYY-MM). */
export function periodeMemuat(jenis: JenisPeriode, bulan: string): PeriodeLaporan {
  const tahun = bulan.slice(0, 4);
  if (jenis === 'bulanan') return { jenis, kode: bulan, label: labelBulan(bulan), bulan: [bulan] };
  if (jenis === 'kuartalan') {
    const q = Math.floor((Number(bulan.slice(5, 7)) - 1) / 3) + 1;
    const awal = `${tahun}-${String((q - 1) * 3 + 1).padStart(2, '0')}`;
    return { jenis, kode: `${tahun}-Q${q}`, label: `Q${q} ${tahun}`, bulan: rangkaBulan(awal, 3) };
  }
  return { jenis, kode: tahun, label: `Tahun ${tahun}`, bulan: rangkaBulan(`${tahun}-01`, 12) };
}

export function periodeSebelumnya(p: PeriodeLaporan): PeriodeLaporan {
  return periodeMemuat(p.jenis, tambahBulan(p.bulan[0], -1));
}

/** n periode terakhir s.d. periode yang memuat `hariIni`, terbaru dulu. */
export function daftarPeriode(jenis: JenisPeriode, hariIni: string, n: number): PeriodeLaporan[] {
  const hasil: PeriodeLaporan[] = [];
  let p = periodeMemuat(jenis, hariIni.slice(0, 7));
  for (let i = 0; i < n; i++) {
    hasil.push(p);
    p = periodeSebelumnya(p);
  }
  return hasil;
}

/** Bulan dalam periode yang sudah dimulai per `hariIni` (bulan masa depan dikeluarkan). */
export function bulanBerjalan(p: PeriodeLaporan, hariIni: string): string[] {
  return p.bulan.filter((b) => b <= hariIni.slice(0, 7));
}
