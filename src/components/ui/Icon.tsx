/**
 * Ikon garis (stroke) inline — tanpa dependensi eksternal supaya bundle tetap
 * ringan dan tidak ada permintaan jaringan tambahan saat halaman dibuka.
 */
export type NamaIkon =
  | 'dashboard'
  | 'kas-masuk'
  | 'kas-keluar'
  | 'bank'
  | 'transfer'
  | 'dokumen'
  | 'buku'
  | 'grafik'
  | 'rumah'
  | 'orang'
  | 'orang-grup'
  | 'palu'
  | 'ceklis'
  | 'kirim'
  | 'coa'
  | 'kalender'
  | 'filter'
  | 'printer'
  | 'unduh'
  | 'keluar'
  | 'plus'
  | 'sampah'
  | 'pensil'
  | 'panah-kiri'
  | 'panah-kanan'
  | 'peringatan'
  | 'info'
  | 'segar'
  | 'kunci'
  | 'menu'
  | 'silang'
  | 'cari'
  | 'dompet'
  | 'kotak';

const PATHS: Record<NamaIkon, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  'kas-masuk': (
    <>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
      <path d="M4 21h16" />
    </>
  ),
  'kas-keluar': (
    <>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
      <path d="M4 3h16" />
    </>
  ),
  bank: (
    <>
      <path d="m3 10 9-6 9 6" />
      <path d="M5 10v9M19 10v9M9 10v9M15 10v9" />
      <path d="M3 21h18" />
    </>
  ),
  transfer: (
    <>
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </>
  ),
  dokumen: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  buku: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" />
      <path d="M8 7h7M8 11h7" />
    </>
  ),
  grafik: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-5 3 3 5-7" />
    </>
  ),
  rumah: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  orang: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  'orang-grup': (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 7" />
      <path d="M17.5 14.5A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  palu: (
    <>
      <path d="m14 3 7 7-3 3-7-7z" />
      <path d="m11 8-8 8 5 5 8-8" />
    </>
  ),
  ceklis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  kirim: <path d="m4 12 16-8-6 16-2.5-6z" />,
  coa: (
    <>
      <path d="M4 5h16M4 12h16M4 19h10" />
      <circle cx="19" cy="19" r="2" />
    </>
  ),
  kalender: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  printer: (
    <>
      <path d="M7 8V3h10v5" />
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  unduh: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 21h16" />
    </>
  ),
  keluar: (
    <>
      <path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="M10 17 5 12l5-5" />
      <path d="M5 12h11" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sampah: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  pensil: <path d="M4 20h4L20 8l-4-4L4 16z" />,
  'panah-kiri': <path d="M15 5 8 12l7 7" />,
  'panah-kanan': <path d="m9 5 7 7-7 7" />,
  peringatan: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  segar: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 4v7h-7" />
    </>
  ),
  kunci: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  silang: <path d="M6 6l12 12M18 6 6 18" />,
  cari: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  dompet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18" />
      <circle cx="17" cy="14.5" r="1.2" />
    </>
  ),
  kotak: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
};

export function Icon({
  name,
  className = 'h-4 w-4',
  strokeWidth = 1.8,
}: {
  name: NamaIkon;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
