const SATUAN = [
  '', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas',
  'enam belas', 'tujuh belas', 'delapan belas', 'sembilan belas',
];

const PULUHAN = [
  '', '', 'dua puluh', 'tiga puluh', 'empat puluh', 'lima puluh',
  'enam puluh', 'tujuh puluh', 'delapan puluh', 'sembilan puluh',
];

/** Bilangan menjadi kata untuk kwitansi. Sama persis dengan versi lama. */
export function terbilang(n: number): string {
  const v = Math.round(Math.abs(n));
  if (v === 0) return 'nol';
  if (v < 20) return SATUAN[v];
  if (v < 100) return PULUHAN[Math.floor(v / 10)] + (v % 10 ? ` ${SATUAN[v % 10]}` : '');
  if (v < 1000) {
    const ratus = v === 100 ? 'seratus' : `${SATUAN[Math.floor(v / 100)]} ratus`;
    return ratus + (v % 100 ? ` ${terbilang(v % 100)}` : '');
  }
  if (v < 1_000_000) {
    return `${terbilang(Math.floor(v / 1000))} ribu${v % 1000 ? ` ${terbilang(v % 1000)}` : ''}`;
  }
  if (v < 1_000_000_000) {
    return `${terbilang(Math.floor(v / 1_000_000))} juta${v % 1_000_000 ? ` ${terbilang(v % 1_000_000)}` : ''}`;
  }
  return `${terbilang(Math.floor(v / 1_000_000_000))} miliar${
    v % 1_000_000_000 ? ` ${terbilang(v % 1_000_000_000)}` : ''
  }`;
}
