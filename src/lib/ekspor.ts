/**
 * Unduh data sebagai CSV.
 *
 * Versi HTML lama mengekspor XLSX lewat pustaka SheetJS yang dimuat dari CDN.
 * CSV dipilih di sini karena tidak butuh dependensi eksternal sama sekali,
 * tetap terbuka di Excel/Google Sheets, dan tidak menambah ukuran bundle.
 */

type Sel = string | number | null | undefined;

function selKeCsv(v: Sel): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Awalan =, +, -, @ bisa dieksekusi Excel sebagai rumus (CSV injection).
  const aman = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${aman.replace(/"/g, '""')}"`;
}

export function keCsv(header: string[], baris: Sel[][]): string {
  const isi = [header.map(selKeCsv).join(';'), ...baris.map((r) => r.map(selKeCsv).join(';'))];
  // BOM agar Excel mengenali UTF-8 (nama proyek/tukang bisa mengandung aksen).
  return `﻿${isi.join('\r\n')}`;
}

export function unduhCsv(namaBerkas: string, header: string[], baris: Sel[][]): void {
  const blob = new Blob([keCsv(header, baris)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
