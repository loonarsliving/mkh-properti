'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SB_KEY, SB_URL } from './config';
import { getAccessToken, perbaruiToken } from './supabase';

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
 *        - proyek_id "LOONARS2"                  -> peran pelaksana (hanya lihat Loonars 2)
 *        - selain itu                           -> peran admin proyek
 *   4. Tidak terdaftar di `users_proyek`
 *        - ada di allowlist `cfo_users`         -> peran CFO/owner
 *        - tidak ada                            -> sesi dibersihkan, /no-access
 *
 * Pengecekan `users_proyek`/`cfo_users` memakai access token pengguna:
 * sejak migrasi 0036/0037 kedua tabel itu tidak bisa dibaca tanpa login, dan
 * setiap orang hanya bisa melihat barisnya sendiri (kecuali staf).
 */

export type Peran = 'cfo' | 'admin-proyek' | 'verifikator' | 'pelaksana';

export interface Sesi {
  email: string;
  peran: Peran;
  /** proyek_id dari users_proyek; null untuk CFO. */
  proyekId: string | null;
  /**
   * Boleh membuka dashboard Loonars 2 (baca-saja): CFO, pelaksana, atau siapa
   * pun yang punya baris users_proyek 'LOONARS2' di samping perannya sendiri
   * (mis. verifikator). Penegakan sebenarnya ada di RPC loonars2_web_lihat.
   */
  aksesLoonars2: boolean;
}

export interface StatusSesi {
  status: 'memuat' | 'siap' | 'ditolak';
  sesi: Sesi | null;
}

function headerLogin(): Record<string, string> {
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${getAccessToken() ?? SB_KEY}`,
    'Content-Type': 'application/json',
  };
}

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

export interface PenugasanUser {
  /** proyek_id utama (bukan LOONARS2); null bila hanya punya akses Loonars 2 / tidak terdaftar. */
  utama: string | null;
  /** Punya baris users_proyek 'LOONARS2' (akses tambahan dashboard Loonars 2). */
  loonars2: boolean;
}

/** Cari semua penugasan proyek user (satu orang bisa punya >1 baris). */
export async function cariPenugasanUser(email: string): Promise<PenugasanUser> {
  const res = await fetch(
    `${SB_URL}/rest/v1/users_proyek?email=eq.${encodeURIComponent(email)}&select=proyek_id&order=id.asc`,
    { headers: headerLogin(), cache: 'no-store' },
  );
  if (!res.ok) throw new Error('Gagal memeriksa penugasan proyek.');
  const data = (await res.json()) as { proyek_id?: string }[];
  const ids = Array.isArray(data) ? data.map((d) => d.proyek_id).filter((x): x is string => Boolean(x)) : [];
  return {
    utama: ids.find((i) => i !== PROYEK_PELAKSANA_L2) ?? null,
    loonars2: ids.includes(PROYEK_PELAKSANA_L2) || (await punyaAksesWebLoonars2(email)),
  };
}

/**
 * Izin tambahan dashboard Loonars 2 (tabel loonars2_akses_web, migrasi 0046) untuk
 * orang yang sudah punya peran lain. RLS: pemilik email hanya melihat barisnya
 * sendiri. Gagal baca = tidak ada akses tambahan (tidak memblokir login).
 */
async function punyaAksesWebLoonars2(email: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/loonars2_akses_web?email=ilike.${encodeURIComponent(email)}&select=id&limit=1`,
      { headers: headerLogin(), cache: 'no-store' },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as unknown[];
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cari penugasan proyek user. Mengembalikan proyek_id atau null. Peran lain
 * didahulukan; 'LOONARS2' hanya dikembalikan bila itu satu-satunya penugasan.
 */
export async function cariProyekUser(email: string): Promise<string | null> {
  const { utama, loonars2 } = await cariPenugasanUser(email);
  return utama ?? (loonars2 ? PROYEK_PELAKSANA_L2 : null);
}

export async function apakahCfo(email: string): Promise<boolean> {
  const res = await fetch(
    `${SB_URL}/rest/v1/cfo_users?email=eq.${encodeURIComponent(email)}&select=email&limit=1`,
    { headers: headerLogin(), cache: 'no-store' },
  );
  if (!res.ok) throw new Error('Gagal memeriksa allowlist CFO.');
  const data = (await res.json()) as unknown[];
  return Array.isArray(data) && data.length > 0;
}

/** proyek_id khusus di users_proyek untuk pelaksana Loonars 2 (migrasi 0045). */
export const PROYEK_PELAKSANA_L2 = 'LOONARS2';

export function peranDariProyekId(proyekId: string): Peran {
  if (proyekId === PROYEK_PELAKSANA_L2) return 'pelaksana';
  return proyekId === 'MANAGER' || proyekId.startsWith('VERIFIKATOR') ? 'verifikator' : 'admin-proyek';
}

export function rutaUtama(peran: Peran): string {
  if (peran === 'verifikator') return '/verifikasi';
  if (peran === 'admin-proyek') return '/admin-proyek';
  if (peran === 'pelaksana') return '/loonars2';
  return '/';
}

/**
 * Guard halaman. `izinkan` adalah daftar peran yang boleh membuka halaman;
 * peran lain dialihkan ke halaman utamanya masing-masing (bukan ditolak),
 * meniru perilaku redirect halaman HTML lama.
 */
export function useGuard(izinkan: Peran[], izinkanLoonars2 = false): StatusSesi {
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
        // Token kedaluwarsa (default 1 jam) diperbarui dulu lewat refresh
        // token. Tanpa sesi yang sah, data tidak akan terbaca (RLS), jadi
        // tidak lagi jatuh ke email yang tersimpan seperti versi lama.
        let email = await verifikasiToken(token);
        if (!email) {
          const baru = await perbaruiToken();
          email = baru ? await verifikasiToken(baru) : null;
        }
        if (!email) {
          bersihkanSesi();
          router.replace('/login');
          return;
        }
        window.sessionStorage.setItem('sb_user_email', email);

        const { utama, loonars2 } = await cariPenugasanUser(email);
        const proyekId = utama ?? (loonars2 ? PROYEK_PELAKSANA_L2 : null);
        let sesi: Sesi;

        if (proyekId !== null) {
          const peran = peranDariProyekId(proyekId);
          sesi = { email, peran, proyekId, aksesLoonars2: loonars2 || peran === 'pelaksana' };
        } else {
          const cfo = await apakahCfo(email);
          if (!cfo) {
            bersihkanSesi();
            router.replace('/no-access');
            return;
          }
          sesi = { email, peran: 'cfo', proyekId: null, aksesLoonars2: true };
        }

        if (batal) return;

        if (!izinkan.includes(sesi.peran) && !(izinkanLoonars2 && sesi.aksesLoonars2)) {
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
