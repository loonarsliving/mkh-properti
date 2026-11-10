/**
 * PETA JALAN KESIAPAN INVESTASI (permintaan owner 2026-11-10): "buat sistemnya
 * terus mempelajari cara keuangan dikelola hingga nanti bisa memberikan data
 * yang membuat kita siap menerima investasi."
 *
 * Menerjemahkan pemeriksaan Data Quality (`kualitas-data.ts`) ke daftar yang
 * biasa diminta investor saat due diligence, lalu menyusun langkah berikutnya.
 * Dihitung ulang dari data setiap kali dibuka / setiap laporan mingguan, jadi
 * kemajuannya terlihat begitu datanya dilengkapi.
 *
 * Aturan yang dipegang:
 *  - TIDAK ada skor "siap investasi" (keputusan owner 2026-11-02): yang
 *    ditampilkan hanya status per butir dan apa yang masih kurang.
 *  - Status diturunkan dari pemeriksaan data; butir yang memang tidak dicatat
 *    sistem (mis. dokumen legal) ditandai "di luar sistem", bukan dikarang.
 *  - Angka tidak dibuat oleh model bahasa.
 */
import type { ModelCfo } from '@/lib/cfo/model';
import type { DataCfo } from '@/lib/cfo/tipe';
import { cekKualitasData, type CekKualitas } from './kualitas-data';
import type { Kelengkapan } from './status';

export type KelompokKesiapan = 'laporan' | 'kontrol' | 'kinerja' | 'rencana' | 'struktur' | 'kepatuhan';

export const LABEL_KELOMPOK: Record<KelompokKesiapan, string> = {
  laporan: 'Laporan keuangan',
  kontrol: 'Kontrol & jejak audit',
  kinerja: 'Kinerja usaha',
  rencana: 'Rencana & kebutuhan dana',
  struktur: 'Struktur investasi',
  kepatuhan: 'Legal & pajak',
};

/** Siapa yang harus bergerak agar butir ini selesai. */
export type Pelaksana = 'sistem' | 'owner' | 'data';

export const LABEL_PELAKSANA: Record<Pelaksana, string> = {
  sistem: 'Dibangun di sistem',
  owner: 'Perlu keputusan / dokumen owner',
  data: 'Menunggu data berjalan',
};

export interface ButirKesiapan {
  id: string;
  kelompok: KelompokKesiapan;
  /** apa yang biasanya diminta investor */
  diminta: string;
  status: Kelengkapan;
  /** apa yang sudah ada sekarang (dari data) */
  posisi: string;
  /** langkah berikutnya agar Complete */
  langkah: string;
  pelaksana: Pelaksana;
  /** tahap rencana institutional reporting (docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md §6) */
  tahap?: string;
  /** halaman tempat buktinya bisa dilihat */
  bukti?: { label: string; href: string };
  /** pemeriksaan Data Quality yang menentukan status */
  cek: CekKualitas[];
  /** butir di luar sistem: status tidak dihitung dari data */
  diLuarSistem?: boolean;
}

export interface RingkasanKesiapan {
  butir: ButirKesiapan[];
  jumlah: Record<Kelengkapan, number>;
  /** maks. 5 langkah paling berdampak, urut */
  langkahBerikutnya: ButirKesiapan[];
  /** bahan yang sudah bisa dibagikan ke calon investor hari ini */
  siapDibagikan: ButirKesiapan[];
  bulanFinal: number;
}

const TINGKAT: Record<Kelengkapan, number> = { lengkap: 0, perlu_verifikasi: 1, tidak_lengkap: 2 };
const URUT_TAHAP = ['2a', '2b', '2c', '3', '4', '5', '6', '7', '8'];

function terburuk(cek: CekKualitas[], awal: Kelengkapan): Kelengkapan {
  return cek.reduce<Kelengkapan>((a, c) => (TINGKAT[c.status] > TINGKAT[a] ? c.status : a), awal);
}

export function kesiapanInvestasi(m: ModelCfo, data: DataCfo): RingkasanKesiapan {
  const kualitas = cekKualitasData(m, data).cek;
  const ambil = (...pola: string[]) => kualitas.filter((c) => pola.some((p) => (p.endsWith(':') ? c.id.startsWith(p) : c.id === p)));
  const bulanFinal = m.l1.bulan.filter((b) => b.status === 'final').length;
  const butir: ButirKesiapan[] = [];
  const tambah = (b: Omit<ButirKesiapan, 'status'> & { status?: Kelengkapan }) =>
    butir.push({ ...b, status: b.diLuarSistem ? (b.status ?? 'tidak_lengkap') : terburuk(b.cek, b.status ?? 'lengkap') });

  // ── Laporan keuangan ───────────────────────────────────────────────────
  {
    const cek = ambil('opex_belum_tercatat', 'villa_sementara', 'penjualan_unit_l1', 'anggaran');
    tambah({
      id: 'laba_rugi',
      kelompok: 'laporan',
      diminta: 'Laba rugi bulanan per bisnis dan gabungan, minimal 12 bulan terakhir',
      status: bulanFinal >= 12 ? 'lengkap' : 'perlu_verifikasi',
      posisi: `P&L institusional tersedia (Loonars 1, Loonars 2, holding, konsolidasi). Laporan villa final: ${bulanFinal} bulan${bulanFinal < 12 ? ' — investor umumnya meminta 12 bulan atau lebih' : ''}. ${cek.filter((c) => c.status !== 'lengkap').length} pos masih kurang/perlu verifikasi.`,
      langkah: 'Catat OPEX aktual per kategori dan lengkapi penjualan unit Loonars 1; riwayat 12 bulan terkumpul dengan sendirinya setiap tutup buku.',
      pelaksana: 'sistem',
      tahap: '2b',
      bukti: { label: 'P&L Institusional', href: '/cfo/laba-rugi' },
      cek,
    });
  }
  {
    const cek = ambil('ekuitas_plug', 'aset_tetap', 'kas_villa', 'kas_negatif:');
    tambah({
      id: 'neraca',
      kelompok: 'laporan',
      diminta: 'Neraca (posisi keuangan) yang seimbang tanpa angka penyeimbang',
      posisi: 'Laporan Holding menyajikan posisi keuangan, tetapi ekuitas masih dihitung sebagai sisa (aset − liabilitas) sehingga belum menguji kelengkapan data.',
      langkah: 'Buku besar tunggal dengan saldo awal, setoran modal, dan register aset tetap.',
      pelaksana: 'sistem',
      tahap: '2a',
      bukti: { label: 'Laporan Holding', href: '/cfo/holding' },
      cek,
    });
  }
  {
    const cek = ambil('arus_kas_indirect');
    tambah({
      id: 'arus_kas',
      kelompok: 'laporan',
      diminta: 'Laporan arus kas historis dan proyeksi kas',
      posisi: 'Proyeksi kas 13 minggu (3 skenario) tersedia; laporan arus kas historis metode tidak langsung belum bisa disusun.',
      langkah: 'Disusun otomatis setelah neraca dari buku besar tunggal tersedia.',
      pelaksana: 'sistem',
      tahap: '3',
      bukti: { label: 'Cash Flow Forecast', href: '/cfo/arus-kas' },
      cek,
    });
  }

  // ── Kontrol & jejak audit ──────────────────────────────────────────────
  {
    const cek = ambil('kunci_periode', 'jurnal_seimbang', 'akun_di_luar_coa');
    tambah({
      id: 'tutup_buku',
      kelompok: 'kontrol',
      diminta: 'Tutup buku bulanan yang terkunci — angka yang sudah dilaporkan tidak berubah diam-diam',
      posisi: 'Jurnal diperiksa debit = kredit dan akun COA setiap hari; arsip tutup buku AI CFO membekukan ringkasan, tetapi buku besar belum dikunci per periode.',
      langkah: 'Kunci periode buku besar + laporan beku per bulan.',
      pelaksana: 'sistem',
      tahap: '2a',
      bukti: { label: 'Meja Kerja CFO', href: '/cfo/kerja' },
      cek,
    });
  }
  {
    const cek = ambil('rekon:', 'sinkron:');
    tambah({
      id: 'rekonsiliasi',
      kelompok: 'kontrol',
      diminta: 'Angka antarsistem cocok (rekonsiliasi) dan data diperbarui rutin',
      posisi: cek.length ? `${cek.length} rekonsiliasi/sinkronisasi belum beres.` : 'Seluruh rekonsiliasi lintas sumber cocok dan sinkronisasi segar.',
      langkah: cek.length ? 'Jelaskan atau koreksi selisih di sumbernya; periksa jalur sinkronisasi yang terlambat.' : '—',
      pelaksana: cek.length ? 'owner' : 'data',
      bukti: { label: 'Data Quality', href: '/cfo/kualitas-data' },
      cek,
    });
  }
  {
    const cek = ambil('biaya_standar_villa');
    tambah({
      id: 'bukti_biaya',
      kelompok: 'kontrol',
      diminta: 'Biaya berdasarkan tagihan/nota aktual, bukan angka standar',
      posisi: 'Biaya villa memakai biaya standar (dasar bagi hasil). Pengajuan Loonars 2 kini dicek otomatis: nota wajib untuk belanja Rp 1 juta ke atas, pengajuan dobel ditahan, harga janggal ditandai, DP/pelunasan dicatat sebagai kontrak.',
      langkah: 'Catat biaya aktual villa berdampingan dengan biaya standar (rumus bagi hasil tidak diubah).',
      pelaksana: 'sistem',
      tahap: '2b',
      bukti: { label: 'Keuangan Loonars 2', href: '/loonars2' },
      cek,
    });
  }

  // ── Kinerja usaha ──────────────────────────────────────────────────────
  {
    const cek = ambil('inventaris_kamar', 'kpi_booking');
    tambah({
      id: 'unit_ekonomi',
      kelompok: 'kinerja',
      diminta: 'KPI hospitality: okupansi, ADR, RevPAR, GOPPAR, biaya per malam, channel',
      posisi: 'KPI dihitung dari laporan villa; penyebut kamar tersedia masih unit × hari, lead time & tamu berulang belum dikirim.',
      langkah: 'Kirim inventaris kamar harian & KPI booking dari sistem villa.',
      pelaksana: 'sistem',
      tahap: '2c',
      bukti: { label: 'Hospitality Unit Economics', href: '/cfo/unit-economics' },
      cek,
    });
  }
  tambah({
    id: 'riwayat',
    kelompok: 'kinerja',
    diminta: 'Riwayat kinerja yang konsisten (idealnya 12–24 bulan)',
    status: bulanFinal >= 12 ? 'lengkap' : bulanFinal > 0 ? 'perlu_verifikasi' : 'tidak_lengkap',
    posisi: `${bulanFinal} bulan laporan villa final tercatat.`,
    langkah: bulanFinal >= 12 ? '—' : `Bertambah otomatis tiap bulan; ${12 - bulanFinal} bulan lagi untuk 12 bulan.`,
    pelaksana: 'data',
    bukti: { label: 'Loonars 1', href: '/cfo/loonars-1' },
    cek: [],
  });

  // ── Rencana & kebutuhan dana ───────────────────────────────────────────
  {
    const cek = ambil('anggaran');
    tambah({
      id: 'anggaran',
      kelompok: 'rencana',
      diminta: 'Anggaran tahunan per bisnis dan perbandingan anggaran vs aktual',
      posisi: 'Belum ada anggaran laba rugi; kolom Budget di P&L masih kosong.',
      langkah: 'Fitur anggaran per properti/bulan; angka anggarannya ditentukan owner.',
      pelaksana: 'sistem',
      tahap: '3',
      cek,
    });
  }
  tambah({
    id: 'proyeksi',
    kelompok: 'rencana',
    diminta: 'Proyeksi 3 tahun, titik impas, dan rencana penggunaan dana investasi',
    status: 'tidak_lengkap',
    posisi: `Kebutuhan dana 13 minggu tersedia (normal ${Math.round(m.konsolidasi.kebutuhanDana.normal).toLocaleString('id-ID')}); proyeksi 12/24/36 bulan dan rencana penggunaan dana belum dibangun.`,
    langkah: 'Proyeksi 12/24/36 bulan × 3 skenario dari data aktual; owner menetapkan rencana ekspansi & penggunaan dana.',
    pelaksana: 'sistem',
    tahap: '7',
    bukti: { label: 'Cash Flow Forecast', href: '/cfo/arus-kas' },
    cek: [],
    diLuarSistem: true,
  });

  // ── Struktur investasi ─────────────────────────────────────────────────
  {
    const cek = ambil('skema_bagi_hasil_investor', 'bagi_hasil_unit_pt');
    tambah({
      id: 'struktur_investor',
      kelompok: 'struktur',
      diminta: 'Struktur investor yang sudah ada dan hak-haknya',
      posisi: 'Skema investor properti: 70% dari profit (keputusan D-6). Status 5 unit villa yang belum terjual masih perlu dipastikan.',
      langkah: 'Konfirmasi pemilik 5 unit villa yang belum terjual.',
      pelaksana: 'owner',
      bukti: { label: 'Data Quality', href: '/cfo/kualitas-data' },
      cek,
    });
  }

  // ── Legal & pajak (di luar sistem) ─────────────────────────────────────
  tambah({
    id: 'legal',
    kelompok: 'kepatuhan',
    diminta: 'Dokumen perusahaan: akta & perubahan, NIB/izin usaha, NPWP, sertifikat tanah/IMB-PBG, perjanjian investor',
    posisi: 'Tidak dicatat di sistem ini.',
    langkah: 'Kumpulkan salinan terbaru di satu folder data room; sistem hanya mencatat bahwa dokumen ini perlu disiapkan.',
    pelaksana: 'owner',
    cek: [],
    diLuarSistem: true,
  });
  tambah({
    id: 'pajak',
    kelompok: 'kepatuhan',
    diminta: 'Kepatuhan pajak: SPT dan bukti setor PPh (final 2,5% penjualan bangunan, PPh badan)',
    status: 'perlu_verifikasi',
    posisi: 'PPh dihitung sebagai estimasi di Laporan Holding; SPT dan bukti setor belum tercatat di sistem.',
    langkah: 'Cocokkan estimasi dengan SPT/bukti setor dari konsultan pajak.',
    pelaksana: 'owner',
    bukti: { label: 'Laporan Holding', href: '/cfo/holding' },
    cek: [],
    diLuarSistem: true,
  });

  const jumlah: Record<Kelengkapan, number> = {
    lengkap: butir.filter((b) => b.status === 'lengkap').length,
    perlu_verifikasi: butir.filter((b) => b.status === 'perlu_verifikasi').length,
    tidak_lengkap: butir.filter((b) => b.status === 'tidak_lengkap').length,
  };
  const tahapKe = (t?: string) => (t ? URUT_TAHAP.indexOf(t) : URUT_TAHAP.length);
  // Langkah berikutnya: yang belum lengkap; keputusan/dokumen owner yang tidak perlu dibangun dulu, lalu urutan tahap pembangunan.
  const cepat = (b: ButirKesiapan) => (b.pelaksana === 'owner' && !b.tahap ? 0 : 1);
  const langkahBerikutnya = butir
    .filter((b) => b.status !== 'lengkap' && b.pelaksana !== 'data')
    .sort((a, z) =>
      cepat(a) - cepat(z) ||
      tahapKe(a.tahap) - tahapKe(z.tahap) ||
      TINGKAT[z.status] - TINGKAT[a.status],
    )
    .slice(0, 5);
  const siapDibagikan = butir.filter((b) => b.bukti && b.status !== 'tidak_lengkap');
  return { butir, jumlah, langkahBerikutnya, siapDibagikan, bulanFinal };
}

/** Bagian ringkas untuk laporan mingguan WA owner (≤ ~700 karakter). */
export function barisKesiapanWa(r: RingkasanKesiapan, url: string): string[] {
  return [
    '',
    '📈 *Kesiapan investasi*',
    `${r.jumlah.lengkap} lengkap · ${r.jumlah.perlu_verifikasi} perlu verifikasi · ${r.jumlah.tidak_lengkap} belum ada (dari ${r.butir.length} butir yang biasa diminta investor)`,
    'Langkah berikutnya:',
    ...r.langkahBerikutnya.slice(0, 3).map((b, i) => `   ${i + 1}. ${b.langkah}${b.pelaksana === 'owner' ? ' (perlu Bapak)' : ''}`),
    `Detail: ${url}/cfo/kesiapan-investasi`,
  ];
}
