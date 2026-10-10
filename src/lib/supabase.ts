import { SB_KEY, SB_URL } from './config';

/**
 * Wrapper PostgREST — pengganti helper `sbGet/sbInsert/sbUpdate/sbDelete`
 * yang dulu di-copy-paste di setiap halaman HTML. Sekarang satu implementasi
 * dipakai seluruh aplikasi, jadi perbaikan di sini berlaku di semua modul.
 *
 * Keamanan: setiap panggilan mengirim ACCESS TOKEN pengguna yang login, bukan
 * anon key. Database (migrasi 0036/0037) hanya memberi akses tabel keuangan
 * kepada staf yang login; anon key saja tidak lagi bisa membaca apa pun.
 * Halaman tanpa login (form lapor lapangan) tidak punya token dan otomatis
 * memakai anon key — mereka hanya boleh memanggil RPC lapor_lapangan_kirim.
 *
 * Token Supabase kedaluwarsa (default 1 jam). Bila server menjawab 401,
 * token diperbarui sekali lewat refresh token lalu permintaan diulang.
 */

const TOKEN_KEY = 'sb_access_token';
const REFRESH_KEY = 'sb_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

let refreshBerjalan: Promise<string | null> | null = null;

/**
 * Perbarui access token memakai refresh token. Beberapa permintaan yang gagal
 * bersamaan berbagi satu proses refresh (refresh token Supabase hanya sekali
 * pakai). Mengembalikan token baru, atau null bila sesi sudah tidak sah.
 */
export function perbaruiToken(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (refreshBerjalan) return refreshBerjalan;

  const refreshToken = window.sessionStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return Promise.resolve(null);

  refreshBerjalan = (async () => {
    try {
      const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!data.access_token) return null;
      window.sessionStorage.setItem(TOKEN_KEY, data.access_token);
      if (data.refresh_token) window.sessionStorage.setItem(REFRESH_KEY, data.refresh_token);
      return data.access_token;
    } catch {
      return null;
    } finally {
      refreshBerjalan = null;
    }
  })();
  return refreshBerjalan;
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${getAccessToken() ?? SB_KEY}`,
    ...extra,
  };
}

/**
 * fetch ke PostgREST dengan token pengguna; satu kali coba ulang setelah
 * refresh bila token kedaluwarsa. Header dibangun ulang tiap percobaan agar
 * token baru ikut terkirim.
 */
async function sbFetch(url: string, init: RequestInit, extra?: Record<string, string>): Promise<Response> {
  const res = await fetch(url, { ...init, headers: restHeaders(extra) });
  if (res.status !== 401 || !getAccessToken()) return res;
  const baru = await perbaruiToken();
  if (!baru) return res;
  return fetch(url, { ...init, headers: restHeaders(extra) });
}

/** Header untuk endpoint yang memang butuh identitas user (Auth, Edge Function). */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${token ?? SB_KEY}`,
    ...extra,
  };
}

async function unwrap(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { message?: string; hint?: string };
    return parsed.message ?? parsed.hint ?? text;
  } catch {
    return text;
  }
}

export async function sbGet<T>(table: string, params = ''): Promise<T[]> {
  const query = params ? `${params}&order=id.asc` : 'select=*&order=id.asc';
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    cache: 'no-store',
  }, { Prefer: 'return=representation' });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

/** Query bebas tanpa `order=id.asc` otomatis (untuk tabel tanpa kolom `id`). */
export async function sbQuery<T>(table: string, params: string): Promise<T[]> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?${params}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbInsert<T>(table: string, rows: unknown[]): Promise<T[]> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    body: JSON.stringify(rows),
  }, { Prefer: 'return=representation' });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbUpdate<T>(
  table: string,
  id: string | number,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, { Prefer: 'return=representation' });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

/** PATCH dengan filter bebas, mis. `no=eq.KM-001`. */
export async function sbUpdateWhere<T>(
  table: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }, { Prefer: 'return=representation' });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbDelete(table: string, id: string | number): Promise<void> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await unwrap(res));
}

export async function sbDeleteWhere(table: string, filter: string): Promise<void> {
  const res = await sbFetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await unwrap(res));
}

/** Panggil RPC Postgres lewat PostgREST. */
export async function sbRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await sbFetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T;
}
