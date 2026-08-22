/**
 * Periode laporan.
 *
 * Kebutuhan: user bisa memilih laporan keuangan dari bulan berapa ke bulan
 * berapa, dan juga untuk tahun berapa. Satu tipe `Periode` melayani keduanya —
 * "setahun penuh" hanyalah rentang Januari–Desember.
 */

export const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const NAMA_BULAN_PENDEK = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

export interface Periode {
  /** Tahun awal. */
  tahunMulai: number;
  /** Bulan awal, 1-12. */
  bulanMulai: number;
  tahunSelesai: number;
  /** Bulan akhir, 1-12 (inklusif). */
  bulanSelesai: number;
}

export interface RentangTanggal {
  /** ISO yyyy-mm-dd, inklusif. */
  mulai: string;
  /** ISO yyyy-mm-dd, inklusif (hari terakhir bulan akhir). */
  selesai: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function hariTerakhir(tahun: number, bulan: number): number {
  return new Date(tahun, bulan, 0).getDate();
}

export function periodeTahun(tahun: number): Periode {
  return { tahunMulai: tahun, bulanMulai: 1, tahunSelesai: tahun, bulanSelesai: 12 };
}

export function periodeBulanIni(): Periode {
  const now = new Date();
  const t = now.getFullYear();
  const b = now.getMonth() + 1;
  return { tahunMulai: t, bulanMulai: b, tahunSelesai: t, bulanSelesai: b };
}

export function periodeBerjalan(): Periode {
  const now = new Date();
  return {
    tahunMulai: now.getFullYear(),
    bulanMulai: 1,
    tahunSelesai: now.getFullYear(),
    bulanSelesai: now.getMonth() + 1,
  };
}

/** Normalkan periode agar akhir tidak mendahului awal. */
export function normalisasi(p: Periode): Periode {
  const awal = p.tahunMulai * 12 + p.bulanMulai;
  const akhir = p.tahunSelesai * 12 + p.bulanSelesai;
  if (akhir < awal) {
    return { tahunMulai: p.tahunSelesai, bulanMulai: p.bulanSelesai, tahunSelesai: p.tahunMulai, bulanSelesai: p.bulanMulai };
  }
  return p;
}

export function rentang(p: Periode): RentangTanggal {
  const n = normalisasi(p);
  return {
    mulai: `${n.tahunMulai}-${pad(n.bulanMulai)}-01`,
    selesai: `${n.tahunSelesai}-${pad(n.bulanSelesai)}-${pad(hariTerakhir(n.tahunSelesai, n.bulanSelesai))}`,
  };
}

/** Apakah periode ini persis satu tahun kalender penuh? */
export function isSetahunPenuh(p: Periode): boolean {
  const n = normalisasi(p);
  return n.tahunMulai === n.tahunSelesai && n.bulanMulai === 1 && n.bulanSelesai === 12;
}

export function jumlahBulan(p: Periode): number {
  const n = normalisasi(p);
  return n.tahunSelesai * 12 + n.bulanSelesai - (n.tahunMulai * 12 + n.bulanMulai) + 1;
}

/** "Untuk Tahun yang Berakhir pada 31 Desember 2026" / "Untuk Periode 1 Januari s.d. 31 Maret 2026" */
export function labelPeriodeLaporan(p: Periode): string {
  const n = normalisasi(p);
  if (isSetahunPenuh(n)) {
    return `Untuk Tahun yang Berakhir pada 31 Desember ${n.tahunSelesai}`;
  }
  const r = rentang(n);
  const dMulai = Number(r.mulai.slice(8, 10));
  const dSelesai = Number(r.selesai.slice(8, 10));
  if (n.tahunMulai === n.tahunSelesai) {
    return `Untuk Periode ${dMulai} ${NAMA_BULAN[n.bulanMulai - 1]} s.d. ${dSelesai} ${NAMA_BULAN[n.bulanSelesai - 1]} ${n.tahunSelesai}`;
  }
  return `Untuk Periode ${dMulai} ${NAMA_BULAN[n.bulanMulai - 1]} ${n.tahunMulai} s.d. ${dSelesai} ${NAMA_BULAN[n.bulanSelesai - 1]} ${n.tahunSelesai}`;
}

/** Tanggal posisi keuangan: "31 Desember 2026". */
export function labelTanggalPosisi(p: Periode): string {
  const n = normalisasi(p);
  const hari = hariTerakhir(n.tahunSelesai, n.bulanSelesai);
  return `${hari} ${NAMA_BULAN[n.bulanSelesai - 1]} ${n.tahunSelesai}`;
}

/** Label ringkas untuk chip di topbar: "Agustus 2026" / "Jan–Mar 2026". */
export function labelPeriodeRingkas(p: Periode): string {
  const n = normalisasi(p);
  if (isSetahunPenuh(n)) return `Tahun ${n.tahunSelesai}`;
  if (n.tahunMulai === n.tahunSelesai && n.bulanMulai === n.bulanSelesai) {
    return `${NAMA_BULAN[n.bulanMulai - 1]} ${n.tahunMulai}`;
  }
  if (n.tahunMulai === n.tahunSelesai) {
    return `${NAMA_BULAN_PENDEK[n.bulanMulai - 1]}–${NAMA_BULAN_PENDEK[n.bulanSelesai - 1]} ${n.tahunSelesai}`;
  }
  return `${NAMA_BULAN_PENDEK[n.bulanMulai - 1]} ${n.tahunMulai}–${NAMA_BULAN_PENDEK[n.bulanSelesai - 1]} ${n.tahunSelesai}`;
}

/** Periode sebelumnya dengan durasi sama — untuk pembanding di dashboard. */
export function periodeSebelumnya(p: Periode): Periode {
  const n = normalisasi(p);
  const durasi = jumlahBulan(n);
  const idxMulai = n.tahunMulai * 12 + (n.bulanMulai - 1) - durasi;
  const idxSelesai = n.tahunSelesai * 12 + (n.bulanSelesai - 1) - durasi;
  return {
    tahunMulai: Math.floor(idxMulai / 12),
    bulanMulai: (idxMulai % 12) + 1,
    tahunSelesai: Math.floor(idxSelesai / 12),
    bulanSelesai: (idxSelesai % 12) + 1,
  };
}

/** Daftar tahun untuk dropdown: dari tahun paling awal di data s.d. tahun ini + 1. */
export function daftarTahun(tanggalTerawal?: string): number[] {
  const tahunIni = new Date().getFullYear();
  const awal = tanggalTerawal ? Number(tanggalTerawal.slice(0, 4)) : tahunIni - 2;
  const mulai = Number.isFinite(awal) && awal > 1990 ? awal : tahunIni - 2;
  const out: number[] = [];
  for (let t = tahunIni + 1; t >= mulai; t--) out.push(t);
  return out;
}

/** Serialisasi ke query string agar periode bisa dibagikan lewat URL. */
export function periodeKeParam(p: Periode): string {
  const n = normalisasi(p);
  return `${n.tahunMulai}-${pad(n.bulanMulai)}_${n.tahunSelesai}-${pad(n.bulanSelesai)}`;
}

export function periodeDariParam(s: string | null): Periode | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})_(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  const p: Periode = {
    tahunMulai: Number(m[1]),
    bulanMulai: Number(m[2]),
    tahunSelesai: Number(m[3]),
    bulanSelesai: Number(m[4]),
  };
  if (p.bulanMulai < 1 || p.bulanMulai > 12 || p.bulanSelesai < 1 || p.bulanSelesai > 12) return null;
  return normalisasi(p);
}
