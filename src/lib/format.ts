const idNumber = new Intl.NumberFormat('id-ID');

/**
 * Angka dengan pemisah ribuan, dibulatkan, TANDA DIPERTAHANKAN.
 *
 * Catatan penting: fungsi `fmt()` di versi HTML lama memakai `Math.abs()`,
 * sehingga saldo negatif dan kerugian tampil seolah-olah positif — mis. rugi
 * bersih Rp 50 juta muncul sebagai "Rp 50.000.000" tanpa tanda apa pun. Itu
 * salah dan berbahaya untuk laporan keuangan, jadi di sini tanda minus
 * dipertahankan. Bila memang butuh nilai absolut (mis. untuk menampilkan angka
 * dalam kurung), pakai `fmtAbs()`.
 */
export function fmt(n: number | string | null | undefined): string {
  return idNumber.format(Math.round(Number(n) || 0));
}

/** Nilai absolut — dipakai saat tanda disampaikan lewat kurung atau label. */
export function fmtAbs(n: number | string | null | undefined): string {
  return idNumber.format(Math.round(Math.abs(Number(n) || 0)));
}

/** "Rp 1.234.567" / "Rp -1.234.567" */
export function rupiah(n: number | string | null | undefined): string {
  return `Rp ${fmt(n)}`;
}

/** Konvensi laporan keuangan: negatif ditulis dalam kurung, mis. "(1.234.567)". */
export function fmtSigned(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  return v < 0 ? `(${fmtAbs(v)})` : fmtAbs(v);
}

/** Versi ringkas untuk kartu KPI: 15.000.000 -> "15,0 Jt". */
export function fmtRingkas(n: number | string | null | undefined): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace('.', ',')} M`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} Jt`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)} Rb`;
  return `${sign}${idNumber.format(abs)}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function tanggalPanjang(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function tanggalPendek(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Angka dari input bergaya "1.500.000" atau "1500000". */
export function parseAngka(v: string): number {
  const bersih = v.replace(/[^\d,-]/g, '').replace(',', '.');
  return Number(bersih) || 0;
}

/** Format input nominal sambil diketik: 1500000 -> "1.500.000". */
export function formatInputAngka(v: string): string {
  const digits = v.replace(/\D/g, '');
  if (!digits) return '';
  return idNumber.format(Number(digits));
}

export function salamWaktu(): string {
  const jam = new Date().getHours();
  if (jam < 11) return 'Selamat pagi';
  if (jam < 15) return 'Selamat siang';
  if (jam < 19) return 'Selamat sore';
  return 'Selamat malam';
}
