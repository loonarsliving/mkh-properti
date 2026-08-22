import { SB_KEY, SB_URL } from './config';

/**
 * Wrapper PostgREST — pengganti helper `sbGet/sbInsert/sbUpdate/sbDelete`
 * yang dulu di-copy-paste di setiap halaman HTML. Sekarang satu implementasi
 * dipakai seluruh aplikasi, jadi perbaikan di sini berlaku di semua modul.
 *
 * Catatan keamanan: sama seperti versi lama, panggilan tabel memakai anon key.
 * Migrasi `0025` (RLS tightening) mensyaratkan klien mengirim access token
 * user, bukan anon key. `authHeaders()` di bawah menyiapkan jalur itu —
 * lihat catatan di docs/project-memory/CURRENT_STATE.md sebelum menerapkan
 * `0025` ke produksi.
 */

const TOKEN_KEY = 'sb_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_KEY);
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    ...extra,
  };
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
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
    headers: restHeaders({ Prefer: 'return=representation' }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

/** Query bebas tanpa `order=id.asc` otomatis (untuk tabel tanpa kolom `id`). */
export async function sbQuery<T>(table: string, params: string): Promise<T[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, {
    headers: restHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbInsert<T>(table: string, rows: unknown[]): Promise<T[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbUpdate<T>(
  table: string,
  id: string | number,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'PATCH',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

/** PATCH dengan filter bebas, mis. `no=eq.KM-001`. */
export async function sbUpdateWhere<T>(
  table: string,
  filter: string,
  data: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T[];
}

export async function sbDelete(table: string, id: string | number): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: restHeaders(),
  });
  if (!res.ok) throw new Error(await unwrap(res));
}

export async function sbDeleteWhere(table: string, filter: string): Promise<void> {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: restHeaders(),
  });
  if (!res.ok) throw new Error(await unwrap(res));
}

/** Panggil RPC Postgres lewat PostgREST. */
export async function sbRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: restHeaders(),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(await unwrap(res));
  return (await res.json()) as T;
}
