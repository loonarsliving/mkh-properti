import type { Metadata } from 'next';
import { TombolKembali } from './TombolKembali';

export const metadata: Metadata = { title: 'Akses Ditolak' };

export default function HalamanTanpaAkses() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0f18] p-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-[#1e2d40] bg-[#111827] p-7 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/15 text-2xl">
          🔒
        </div>
        <h1 className="text-[17px] font-bold text-slate-100">Akses Ditolak</h1>
        <p className="mx-auto mt-2 max-w-[320px] text-[13px] leading-relaxed text-slate-400">
          Akun Anda belum terdaftar sebagai pengguna yang berhak membuka halaman ini. Hubungi
          administrator sistem untuk meminta akses.
        </p>
        <TombolKembali />
      </div>
    </div>
  );
}
