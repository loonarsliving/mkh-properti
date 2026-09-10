import type { KategoriPendapatanVilla, PendapatanVilla } from '@/types';

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
