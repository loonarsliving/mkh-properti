/**
 * Konfigurasi Supabase.
 *
 * Nilai default di bawah adalah URL proyek dan **anon/publishable key** yang
 * sebelumnya sudah di-hardcode di setiap halaman HTML lama — anon key memang
 * dirancang untuk terekspos di sisi klien, jadi ini bukan kebocoran rahasia
 * baru. Yang berubah hanya: sekarang nilainya berada di SATU tempat, dan bisa
 * ditimpa lewat environment variable tanpa mengedit kode.
 *
 * Service role key TIDAK PERNAH boleh masuk ke sini — kunci itu hanya hidup di
 * dalam Edge Function (`Deno.env.get`).
 */
export const SB_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://gluoioiimapyhchdasfl.supabase.co';

export const SB_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsdW9pb2lpbWFweWhjaGRhc2ZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNDQ3MjAsImV4cCI6MjA5NTYyMDcyMH0.dHVB0jJBMjUunJKSsqbaM3MGCAq-ZRSWQEqvEyUjIyk';

export const PERUSAHAAN = 'PT. Maha Karya Haluoleo';
export const APP_NAME = 'MKH Property';
