'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { rutaUtama, type Peran } from '@/lib/auth';
import { useSesi } from './SesiProvider';

/**
 * Pembatas per-halaman. Layout `(app)` sudah memastikan user login dan
 * mengetahui perannya; komponen ini hanya menolak peran yang tidak berhak dan
 * mengalihkannya ke halaman utamanya — sama seperti redirect di halaman HTML
 * lama (mis. admin proyek yang membuka laporan keuangan langsung dilempar ke
 * dashboard proyeknya).
 */
export function GuardHalaman({
  izinkan,
  children,
}: {
  izinkan: Peran[];
  children: React.ReactNode;
}) {
  const sesi = useSesi();
  const router = useRouter();
  const boleh = izinkan.includes(sesi.peran);

  useEffect(() => {
    if (!boleh) router.replace(rutaUtama(sesi.peran));
  }, [boleh, router, sesi.peran]);

  if (!boleh) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="font-mono text-xs text-slate-500">Mengalihkan ke halaman Anda…</p>
      </div>
    );
  }

  return <>{children}</>;
}
