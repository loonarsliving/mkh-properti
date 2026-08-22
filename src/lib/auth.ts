'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SB_KEY, SB_URL } from './config';

/**
 * Autentikasi & otorisasi terpusat.
 *
 * Menggantikan blok `authGuard()` yang sebelumnya di-copy-paste di index.html,
 * admin-proyek.html, verifikasi.html, pengeluaran.html, dan
 * laporan-keuangan.html. Aturan yang dipakai persis sama dengan versi lama:
 *
 *   1. Tidak ada token di sessionStorage        -> /login
 *   2. Token ditolak Supabase Auth              -> sesi dibersihkan, /login
 *   3. Terdaftar di `users_proyek`
 *        - proyek_id "MANAGER" / "VERIFIKATOR*" -> peran verifikator
 *        - selain itu                           -> peran admin proyek
 *   4. Tidak terdaftar di `users_proyek`
 *        - ada di allowlist `cfo_users`         -> peran CFO/owner
 *        - tidak ada                            -> sesi dibersihkan, /no-access
 *
 * Catatan: pengecekan `users_proyek`/`cfo_users` sengaja memakai anon key,
 * bukan access token user — sama seperti perilaku lama. Mengubahnya menjadi
 * access token adalah prasyarat migrasi 0025 dan HARUS dilakukan bersamaan
 * dengan penerapan migrasi itu (lihat docs/project-memory/CURRENT_STATE.md).
 */

export type Peran = 'cfo' | 'admin-proyek' | 'verifikator';

export interface Sesi {
  email: string;
  peran: Peran;
  /** proyek_id dari users_proyek; null untuk CFO. */
  proyekId: string | null;
}

export interface StatusSesi {
  status: 'memuat' | 'siap' | 'ditolak';
  sesi: Sesi | null;
}

const ANON_HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

export function bersihkanSesi(): void {
  if (typeof window !== 'undefined') window.sessionStorage.clear();
}

export function emailTersimpan(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem('sb_user_email') ?? '';
}

export function simpanSesi(token: string, refreshToken: string | undefined, email: string): void {
  window.sessionStorage.setItem('sb_access_token', token);
  if (refreshToken) window.sessionStorage.setItem('sb_refresh_token', refreshToken);
  window.sessionStorage.setItem('sb_user_email', email);
}

/** Verifikasi token ke Supabase Auth; mengembalikan email terverifikasi. */
export async function verifikasiToken(token: string): Promise<string | null> {
  const res = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { email?: string };
  return user.email ?? null;
}

/** Cari penugasan proyek user. Mengembalikan proyek_id atau null. */
export async function cariProyekUser(email: string): Promise<string | null> {
  const res = await fetch(
    `${SB_URL}/rest/v1/users_proyek?email=eq.${encodeURIComponent(email)}&select=proyek_id&limit=1`,
    { headers: ANON_HEADERS, cache: 'no-store' },
  );
  if (!res.ok) throw new Error('Gagal memeriksa penugasan proyek.');
  const data = (await res.json()) as { proyek_id?: string }[];
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0].proyek_id ?? null;
}

export async function apakahCfo(email: string): Promise<boolean> {
  const res = await fetch(
    `${SB_URL}/rest/v1/cfo_users?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
    { headers: ANON_HEADERS, cache: 'no-store' },
  );
  if (!res.ok) throw new Error('Gagal memeriksa allowlist CFO.');
  const data = (await res.json()) as unknown[];
  return Array.isArray(data) && data.length > 0;
}

export function peranDariProyekId(proyekId: string): Peran {
  return proyekId === 'MANAGER' || proyekId.startsWith('VERIFIKATOR') ? 'verifikator' : 'admin-proyek';
}

export function rutaUtama(peran: Peran): string {
  if (peran === 'verifikator') return '/verifikasi';
  if (peran === 'admin-proyek') return '/admin-proyek';
  return '/';
}

/**
 * Guard halaman. `izinkan` adalah daftar peran yang boleh membuka halaman;
 * peran lain dialihkan ke halaman utamanya masing-masing (bukan ditolak),
 * meniru perilaku redirect halaman HTML lama.
 */
export function useGuard(izinkan: Peran[]): StatusSesi {
  const router = useRouter();
  const [state, setState] = useState<StatusSesi>({ status: 'memuat', sesi: null });

  useEffect(() => {
    let batal = false;

    (async () => {
      const token = window.sessionStorage.getItem('sb_access_token');
      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const email = (await verifikasiToken(token)) ?? emailTersimpan();
        if (!email) {
          bersihkanSesi();
          router.replace('/login');
          return;
        }
        window.sessionStorage.setItem('sb_user_email', email);

        const proyekId = await cariProyekUser(email);
        let sesi: Sesi;

        if (proyekId !== null) {
          sesi = { email, peran: peranDariProyekId(proyekId), proyekId };
        } else {
          const cfo = await apakahCfo(email);
          if (!cfo) {
            bersihkanSesi();
            router.replace('/no-access');
            return;
          }
          sesi = { email, peran: 'cfo', proyekId: null };
        }

        if (batal) return;

        if (!izinkan.includes(sesi.peran)) {
          router.replace(rutaUtama(sesi.peran));
          setState({ status: 'ditolak', sesi });
          return;
        }

        setState({ status: 'siap', sesi });
      } catch {
        if (batal) return;
        bersihkanSesi();
        router.replace('/no-access');
      }
    })();

    return () => {
      batal = true;
    };
    // `izinkan` sengaja tidak masuk dependency: pemanggil selalu memberi
    // literal array baru tiap render, yang akan memicu loop guard tak berujung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return state;
}

export function logout(): void {
  bersihkanSesi();
  window.location.href = '/login';
}
