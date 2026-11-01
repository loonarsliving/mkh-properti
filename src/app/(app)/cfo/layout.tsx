'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CfoProvider, useCfo } from '@/components/cfo/CfoProvider';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { Icon } from '@/components/ui/Icon';

/**
 * Kerangka AI CFO (khusus CFO/owner). Data dimuat SEKALI untuk sepuluh
 * tampilan; tombol "Muat ulang" mengambil ulang dari database.
 */
const MENU_CFO = [
  { href: '/cfo', label: 'Owner Overview' },
  { href: '/cfo/loonars-1', label: 'Loonars 1 Hospitality' },
  { href: '/cfo/loonars-2', label: 'Loonars 2 Developer' },
  { href: '/cfo/arus-kas', label: 'Cash Flow Forecast' },
  { href: '/cfo/kewajiban', label: 'Debt & Liability' },
  { href: '/cfo/anggaran', label: 'Budget & Expense' },
  { href: '/cfo/peringatan', label: 'Alerts & CEO Challenger' },
  { href: '/cfo/chat', label: 'AI CFO Chat' },
  { href: '/cfo/laporan', label: 'Financial Reports' },
  { href: '/cfo/sinkronisasi', label: 'Integration & Sync' },
];

function NavCfo() {
  const path = usePathname();
  const { muatUlang, memuat, model } = useCfo();
  return (
    <div className="no-print flex flex-wrap items-center gap-1.5">
      {MENU_CFO.map((m) => {
        const aktif = path === m.href;
        return (
          <Link
            key={m.href}
            href={m.href}
            className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold ${aktif ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}
          >
            {m.label}
          </Link>
        );
      })}
      <button onClick={muatUlang} disabled={memuat} className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11.5px] text-slate-600">
        <Icon name="segar" className="h-3.5 w-3.5" /> {memuat ? 'Memuat…' : 'Muat ulang'}
      </button>
      {model ? (
        <span className="w-full font-mono text-[10px] text-slate-400">
          Data per {new Date(model.dibuatPada).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB · semua angka dihitung deterministik di sistem; AI hanya menjelaskan · AI CFO tidak dapat memindahkan uang
        </span>
      ) : null}
    </div>
  );
}

export default function LayoutCfo({ children }: { children: React.ReactNode }) {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <CfoProvider>
        <div className="space-y-4">
          <NavCfo />
          {children}
        </div>
      </CfoProvider>
    </GuardHalaman>
  );
}
