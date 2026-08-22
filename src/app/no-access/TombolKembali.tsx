'use client';

export function TombolKembali() {
  return (
    <button
      type="button"
      onClick={() => {
        window.sessionStorage.clear();
        window.location.href = '/login';
      }}
      className="mt-6 w-full rounded-lg bg-brand-amber py-2.5 text-[13px] font-bold text-slate-900 transition hover:brightness-95"
    >
      Kembali ke Login
    </button>
  );
}
