'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { SB_KEY, SB_URL, PERUSAHAAN } from '@/lib/config';
import {
  apakahCfo,
  cariProyekUser,
  emailTersimpan,
  peranDariProyekId,
  rutaUtama,
  simpanSesi,
  verifikasiToken,
} from '@/lib/auth';

type Mode = 'login' | 'daftar';

/**
 * Terjemahan pesan galat Supabase Auth ke bahasa Indonesia — daftar yang sama
 * dengan `errMap` di login.html lama.
 */
const PESAN_GALAT: Record<string, string> = {
  'Invalid login credentials': 'Email atau password salah.',
  'User already registered': 'Email sudah terdaftar. Silakan masuk.',
  'Email not confirmed': 'Email belum dikonfirmasi. Cek inbox Anda.',
  signup_disabled: 'Pendaftaran saat ini dinonaktifkan.',
  'Password should be at least 6 characters': 'Password minimal 6 karakter.',
};

export function FormLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [lihatPw, setLihatPw] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [sukses, setSukses] = useState('');
  const [cekSesi, setCekSesi] = useState(true);

  /** Tentukan halaman tujuan sesuai peran, sama seperti alur login lama. */
  const arahkan = useCallback(
    async (alamat: string) => {
      try {
        const proyekId = await cariProyekUser(alamat);
        if (proyekId !== null) {
          router.replace(rutaUtama(peranDariProyekId(proyekId)));
          return;
        }
        const cfo = await apakahCfo(alamat);
        router.replace(cfo ? '/' : '/no-access');
      } catch {
        // Jika pengecekan gagal (mis. RLS/tabel bermasalah), jangan langsung
        // melempar ke dashboard CFO — dashboard proyek punya pemeriksaan
        // lanjutan sendiri. Perilaku ini dipertahankan dari versi lama.
        router.replace('/admin-proyek');
      }
    },
    [router],
  );

  // Sudah punya sesi aktif? Langsung arahkan.
  useEffect(() => {
    const token = window.sessionStorage.getItem('sb_access_token');
    if (!token) {
      setCekSesi(false);
      return;
    }
    void (async () => {
      const alamat = (await verifikasiToken(token)) ?? emailTersimpan();
      if (!alamat) {
        window.sessionStorage.clear();
        setCekSesi(false);
        return;
      }
      await arahkan(alamat);
    })();
  }, [arahkan]);

  async function kirim() {
    setGalat('');
    setSukses('');

    const alamat = email.trim();
    if (!alamat || !password) {
      setGalat('Email dan password wajib diisi.');
      return;
    }
    if (password.length < 6) {
      setGalat('Password minimal 6 karakter.');
      return;
    }
    if (mode === 'daftar' && password !== password2) {
      setGalat('Konfirmasi password tidak cocok.');
      return;
    }

    setSibuk(true);
    try {
      const endpoint =
        mode === 'login'
          ? `${SB_URL}/auth/v1/token?grant_type=password`
          : `${SB_URL}/auth/v1/signup`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
        body: JSON.stringify({ email: alamat, password }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        user?: { email?: string };
        error_description?: string;
        msg?: string;
        message?: string;
      };

      if (!res.ok) {
        const asli = data.error_description ?? data.msg ?? data.message ?? 'Terjadi kesalahan.';
        throw new Error(PESAN_GALAT[asli] ?? asli);
      }

      if (mode === 'daftar') {
        setSukses('Akun berhasil dibuat! Cek email untuk konfirmasi, lalu masuk.');
        setMode('login');
        setPassword2('');
        return;
      }

      if (!data.access_token) throw new Error('Token tidak diterima dari server.');
      simpanSesi(data.access_token, data.refresh_token, data.user?.email ?? alamat);
      setSukses('Masuk berhasil! Mengalihkan…');
      await arahkan(data.user?.email ?? alamat);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    } finally {
      setSibuk(false);
    }
  }

  async function resetPassword() {
    const alamat = email.trim();
    if (!alamat) {
      setGalat('Isi email dulu sebelum reset password.');
      return;
    }
    setSibuk(true);
    setGalat('');
    setSukses('');
    try {
      const res = await fetch(`${SB_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
        body: JSON.stringify({ email: alamat }),
      });
      if (!res.ok) throw new Error('Gagal mengirim email reset.');
      setSukses(`Link reset password dikirim ke ${alamat}. Cek inbox Anda.`);
    } catch (e) {
      setGalat(e instanceof Error ? e.message : String(e));
    } finally {
      setSibuk(false);
    }
  }

  if (cekSesi) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-nav-bg">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-slate-700 border-t-brand-amber" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0f18] p-5">
      {/* Latar dekoratif — sama semangatnya dengan login.html lama */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(30,45,64,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(30,45,64,.6) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-brand-amber/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-brand-green/10 blur-3xl" />

      <div className="relative z-10 w-full max-w-[400px] animate-fadeIn">
        <div className="mb-7 flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-amber to-brand-green text-base font-bold text-slate-900 shadow-lg shadow-amber-500/25">
            MK
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">MKH Property</div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">{PERUSAHAAN}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#1e2d40] bg-[#111827] p-6 shadow-2xl">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-[#0d1420] p-1">
            {(['login', 'daftar'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setGalat('');
                  setSukses('');
                }}
                className={`rounded-md py-1.5 text-xs font-semibold transition ${
                  mode === m ? 'bg-brand-amber text-slate-900' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'login' ? 'Masuk' : 'Daftar'}
              </button>
            ))}
          </div>

          <h2 className="text-[17px] font-bold text-slate-100">
            {mode === 'login' ? 'Masuk ke sistem' : 'Buat akun baru'}
          </h2>
          <p className="mb-5 mt-1 font-mono text-[11px] text-slate-500">
            {mode === 'login' ? 'Gunakan email kantor Anda' : 'Akun perlu dikonfirmasi lewat email'}
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void kirim();
            }}
          >
            <div className="mb-4">
              <label htmlFor="email" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-[#1e2d40] bg-[#0d1420] px-3.5 py-2.5 text-[13px] text-slate-200 outline-none transition focus:border-brand-amber focus:ring-2 focus:ring-amber-500/15"
                placeholder="nama@mkh.co.id"
              />
            </div>

            <div className="mb-4">
              <label htmlFor="password" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={lihatPw ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#1e2d40] bg-[#0d1420] px-3.5 py-2.5 pr-11 text-[13px] text-slate-200 outline-none transition focus:border-brand-amber focus:ring-2 focus:ring-amber-500/15"
                  placeholder="••••••"
                />
                <button
                  type="button"
                  onClick={() => setLihatPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-500 hover:text-slate-300"
                  aria-label={lihatPw ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  <Icon name={lihatPw ? 'silang' : 'kunci'} className="h-4 w-4" />
                </button>
              </div>
            </div>

            {mode === 'daftar' ? (
              <div className="mb-4">
                <label htmlFor="password2" className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Ulangi Password
                </label>
                <input
                  id="password2"
                  type="password"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="w-full rounded-lg border border-[#1e2d40] bg-[#0d1420] px-3.5 py-2.5 text-[13px] text-slate-200 outline-none transition focus:border-brand-amber focus:ring-2 focus:ring-amber-500/15"
                  placeholder="••••••"
                />
              </div>
            ) : null}

            {galat ? (
              <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                ⚠ {galat}
              </p>
            ) : null}
            {sukses ? (
              <p className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-300">
                ✓ {sukses}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={sibuk}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-amber py-2.5 text-[13px] font-bold text-slate-900 transition hover:brightness-95 disabled:opacity-60"
            >
              {sibuk ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />
              ) : (
                <>{mode === 'login' ? 'Masuk' : 'Daftar'} →</>
              )}
            </button>
          </form>

          {mode === 'login' ? (
            <button
              type="button"
              onClick={() => void resetPassword()}
              disabled={sibuk}
              className="mt-4 w-full text-center font-mono text-[11px] text-slate-500 transition hover:text-brand-amber"
            >
              Lupa password?
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
