/**
 * LINGKUP LAPORAN AI CFO (keputusan owner 2026-11-01).
 *
 * Sejak 1 November 2026 hanya dua lini yang aktif dan dilaporkan:
 *   - Loonars 1 — hospitality villa Yogyakarta;
 *   - Loonars 2 — penjualan villa Loonars Living + pengeluaran pembangunannya,
 *     termasuk Loonars Coffee (proyek jurnal LC) yang memakai keuangan Loonars 2.
 *
 * Proyek/cabang lain dikunci: datanya tetap ada dan bisa dibaca (arsip), tetapi
 * tidak bisa ditambah/diubah (dijaga trigger database, migrasi 0060) dan tidak
 * masuk laporan, kewajiban, maupun forecast AI CFO. Refund pelanggan MK Connect
 * TETAP dilaporkan (permintaan owner).
 *
 * Harus sama dengan tabel `proyek_kunci` (migrasi 0060) dan `PROYEK` di master.ts.
 */
export const TANGGAL_KUNCI = '2026-11-01';
export const PROYEK_DIKUNCI = ['AFP', 'IH', 'GCI', 'GCR', 'KDI'] as const;
/** Kode proyek jurnal yang termasuk Loonars 2. */
export const PROYEK_L2 = ['LL', 'LC'] as const;

export function proyekDikunci(kode: string | null | undefined): boolean {
  return !!kode && (PROYEK_DIKUNCI as readonly string[]).includes(kode.trim().toUpperCase());
}

/**
 * Selisih rekonsiliasi yang sudah dijelaskan owner. Cek dengan id ini tetap
 * ditampilkan (transparan), tetapi berstatus 'dikonfirmasi' — tidak memicu
 * peringatan/tindakan. Hanya untuk penjelasan yang benar-benar diberikan owner.
 */
export const KONFIRMASI_OWNER: Record<string, { tanggal: string; catatan: string }> = {
  'proyek_tenaga:LC': {
    tanggal: '2026-11-01',
    catatan:
      'Owner mengonfirmasi pembayaran kontraktor Loonars Coffee Rp 75.000.000 sudah dibayar dan masuk keuangan Loonars 2. Angka resmi memakai MK Connect; jurnal LC hanya pembanding.',
  },
};
