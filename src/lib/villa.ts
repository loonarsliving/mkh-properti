import type { BebanVilla, KategoriBebanVilla, KategoriPendapatanVilla, PendapatanVilla } from '@/types';

/**
 * Pendapatan Loonars Villa — lihat migrasi 0032 untuk alasan tabel ini
 * terpisah dari `jurnal`: sistem villa (rental/booking/investor) berjalan di
 * project Supabase lain (svcmybsziaelwwdrnzcv), belum tersambung otomatis ke
 * project ini. Kategori di sini sengaja dibuat sama dengan pemisahan yang
 * sudah dipakai sistem villa sendiri (`GET /report`'s gross_revenue rental
 * vs `walkin_income` cafe/spa/lainnya), supaya kalau sinkronisasi otomatis
 * dibangun nanti, tidak perlu pemetaan kategori baru.
 */
export const KATEGORI_PENDAPATAN_VILLA: { id: KategoriPendapatanVilla; label: string }[] = [
  { id: 'rental', label: 'Sewa Villa (Booking)' },
  { id: 'cafe', label: 'Cafe (Walk-in)' },
  { id: 'spa', label: 'Spa (Walk-in)' },
  { id: 'lainnya', label: 'Lainnya' },
];

export function labelKategoriVilla(kategori: string): string {
  return KATEGORI_PENDAPATAN_VILLA.find((k) => k.id === kategori)?.label ?? kategori;
}

/** input type="month" ("2026-09") -> kolom `periode` ("2026-09-01"). */
export function bulanKePeriode(bulan: string): string {
  return `${bulan}-01`;
}

export function labelBulanPeriode(periode: string): string {
  const d = new Date(`${periode}T00:00:00`);
  if (Number.isNaN(d.getTime())) return periode;
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

export interface RingkasanPendapatanVilla {
  perKategori: Record<KategoriPendapatanVilla, number>;
  total: number;
}

export function ringkasPendapatanVilla(baris: PendapatanVilla[]): RingkasanPendapatanVilla {
  const perKategori: Record<KategoriPendapatanVilla, number> = {
    rental: 0,
    cafe: 0,
    spa: 0,
    lainnya: 0,
  };
  let total = 0;
  for (const b of baris) {
    const jumlah = Number(b.jumlah) || 0;
    perKategori[b.kategori] = (perKategori[b.kategori] ?? 0) + jumlah;
    total += jumlah;
  }
  return { perKategori, total };
}

/**
 * Beban Loonars Villa — lihat migrasi 0034. Kategori mengikuti model akad
 * villa sendiri: opex & marketing dihitung sebagai persentase tetap dari
 * omzet kotor (bukan rincian aktual bulanan — villa sendiri sudah berhenti
 * mencatat opex secara itemized, lihat komentar migrasi), "lainnya" untuk
 * biaya lain yang ingin dicatat di laporan ini.
 */
export const KATEGORI_BEBAN_VILLA: { id: KategoriBebanVilla; label: string }[] = [
  { id: 'opex', label: 'Opex Properti (% omzet, sesuai akad)' },
  { id: 'marketing', label: 'Marketing (% omzet, sesuai akad)' },
  { id: 'lainnya', label: 'Lainnya' },
];

export function labelKategoriBebanVilla(kategori: string): string {
  return KATEGORI_BEBAN_VILLA.find((k) => k.id === kategori)?.label ?? kategori;
}

export interface RingkasanBebanVilla {
  perKategori: Record<KategoriBebanVilla, number>;
  total: number;
}

export function ringkasBebanVilla(baris: BebanVilla[]): RingkasanBebanVilla {
  const perKategori: Record<KategoriBebanVilla, number> = {
    opex: 0,
    marketing: 0,
    lainnya: 0,
  };
  let total = 0;
  for (const b of baris) {
    const jumlah = Number(b.jumlah) || 0;
    perKategori[b.kategori] = (perKategori[b.kategori] ?? 0) + jumlah;
    total += jumlah;
  }
  return { perKategori, total };
}
