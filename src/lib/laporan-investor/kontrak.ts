/**
 * Kontrak KPI Laporan Investor — versi definisi `v1`.
 *
 * Satu-satunya tempat definisi tiap angka ditulis. Dipakai oleh:
 *   - halaman /laporan-investor (label & tooltip),
 *   - PDF (lampiran "Definisi dan Sumber"),
 *   - validasi sisi database (`ir_kunci_metrik_v1()` di migrasi 0040 memuat
 *     daftar kunci yang sama — ubah keduanya bersamaan dan naikkan versinya).
 *
 * Aturan kejujuran data (dari brief owner): angka yang tidak ada ditulis
 * "data belum tersedia", tidak pernah 0; tiap metrik menyebut sumbernya.
 */

export const VERSI_DEFINISI = 'v1';

export type Satuan = 'rupiah' | 'persen' | 'angka' | 'malam' | 'orang' | 'hari' | 'teks' | 'rincian';

export interface DefinisiMetrik {
  kunci: string;
  label: string;
  satuan: Satuan;
  definisi: string;
  /** Sumber yang diharapkan mengirim angka ini. */
  sumber: string;
}

export const DEFINISI_METRIK: DefinisiMetrik[] = [
  { kunci: 'hari_operasi', label: 'Hari operasi', satuan: 'hari', sumber: 'Sistem operasi properti',
    definisi: 'Jumlah hari dalam bulan sejak tanggal mulai operasi properti (bulan pertama bisa parsial).' },
  { kunci: 'unit_total', label: 'Unit total', satuan: 'angka', sumber: 'Sistem operasi properti',
    definisi: 'Seluruh unit/kamar yang dikelola, termasuk yang sengaja tidak dijual.' },
  { kunci: 'unit_dijual', label: 'Unit dijual', satuan: 'angka', sumber: 'Sistem operasi properti',
    definisi: 'Rata-rata unit yang dibuka untuk dijual (tidak ditutup di channel manager / maintenance).' },
  { kunci: 'malam_tersedia_total', label: 'Malam tersedia (unit total)', satuan: 'malam', sumber: 'Sistem operasi properti',
    definisi: 'Unit total × hari operasi.' },
  { kunci: 'malam_tersedia_dijual', label: 'Malam tersedia (unit dijual)', satuan: 'malam', sumber: 'Sistem operasi properti',
    definisi: 'Jumlah malam-unit yang benar-benar dibuka untuk dijual.' },
  { kunci: 'malam_terjual', label: 'Malam terjual', satuan: 'malam', sumber: 'Sistem operasi properti',
    definisi: 'Malam-unit terisi dari booking yang diakui (status terjadwal/check-in/check-out, check-in ≤ hari ini).' },
  { kunci: 'okupansi_unit_total_pct', label: 'Okupansi atas unit total', satuan: 'persen', sumber: 'Sistem operasi properti',
    definisi: 'Malam terjual ÷ malam tersedia (unit total) × 100.' },
  { kunci: 'okupansi_unit_dijual_pct', label: 'Okupansi atas unit dijual', satuan: 'persen', sumber: 'Sistem operasi properti',
    definisi: 'Malam terjual ÷ malam tersedia (unit dijual) × 100. Lebih tinggi dari okupansi unit total bila ada unit yang ditutup.' },
  { kunci: 'pendapatan_kotor', label: 'Pendapatan kamar kotor', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Grand Total booking yang diakui per tanggal check-in, termasuk fee OTA yang ditambahkan channel manager.' },
  { kunci: 'pendapatan_basis_investor', label: 'Pendapatan basis investor', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Dasar perhitungan bagi hasil investor (rumus beku sistem villa). Untuk booking OTA memakai subtotal Cloudbeds sejak 5 Okt 2026; sebelumnya harga kotor.' },
  { kunci: 'pendapatan_bersih', label: 'Pendapatan kamar bersih (finance)', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Deposit Amount (subtotal Cloudbeds) dikurangi komisi tiap channel yang sudah diketahui dari bukti pembayaran. Komisi yang belum diketahui dihitung 0 dan ditandai.' },
  { kunci: 'pendapatan_walkin', label: 'Pendapatan non-kamar', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Kafe, spa, dan lain-lain yang lunas dalam bulan itu. Tidak termasuk dalam bagi hasil investor.' },
  { kunci: 'adr_kotor', label: 'ADR kotor', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kamar kotor ÷ malam terjual.' },
  { kunci: 'adr_bersih', label: 'ADR bersih', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kamar bersih ÷ malam terjual.' },
  { kunci: 'revpar_kotor', label: 'RevPAR kotor', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kamar kotor ÷ malam tersedia (unit total).' },
  { kunci: 'revpar_bersih', label: 'RevPAR bersih', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kamar bersih ÷ malam tersedia (unit total).' },
  { kunci: 'booking_diakui', label: 'Booking diakui', satuan: 'angka', sumber: 'Sistem operasi properti',
    definisi: 'Jumlah booking yang pendapatannya diakui pada bulan itu (dihitung dari tabel booking, bukan tabel tamu).' },
  { kunci: 'booking_batal', label: 'Booking batal', satuan: 'angka', sumber: 'Sistem operasi properti',
    definisi: 'Booking berstatus batal dengan tanggal check-in di bulan itu.' },
  { kunci: 'booking_pra_buka', label: 'Booking pra-buka', satuan: 'angka', sumber: 'Sistem operasi properti',
    definisi: 'Booking sebelum tanggal buka resmi; dilaporkan terpisah dan berlabel "pra-buka".' },
  { kunci: 'channel', label: 'Rincian per channel', satuan: 'rincian', sumber: 'Sistem operasi properti',
    definisi: 'Per channel (OTA tertentu / langsung): jumlah booking, malam, pendapatan kotor.' },
  { kunci: 'porsi_ota_pct', label: 'Porsi OTA', satuan: 'persen', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kotor dari OTA ÷ pendapatan kotor total × 100.' },
  { kunci: 'porsi_langsung_pct', label: 'Porsi langsung', satuan: 'persen', sumber: 'Sistem operasi properti',
    definisi: 'Pendapatan kotor dari website/walk-in/langsung ÷ pendapatan kotor total × 100.' },
  { kunci: 'headcount', label: 'Headcount per divisi', satuan: 'rincian', sumber: 'MK Connect (SDM)',
    definisi: 'Jumlah karyawan aktif per divisi pada akhir bulan. Hanya agregat — tanpa nama dan gaji individu.' },
  { kunci: 'headcount_total', label: 'Headcount total', satuan: 'orang', sumber: 'MK Connect (SDM)',
    definisi: 'Jumlah karyawan internal aktif pada akhir bulan. Tidak termasuk fungsi yang dikerjakan pihak luar.' },
  { kunci: 'fungsi_outsourcing', label: 'Fungsi outsourcing', satuan: 'teks', sumber: 'Owner / MK Connect',
    definisi: 'Fungsi yang dikerjakan pihak luar (mis. housekeeping) — tidak dihitung sebagai headcount.' },
  { kunci: 'total_gaji', label: 'Total gaji', satuan: 'rupiah', sumber: 'Buku besar (akun 6-1001) atau MK Connect',
    definisi: 'Bila buku besar memuat gaji untuk unit & bulan itu, angka buku besar yang dipakai; angka kiriman MK Connect hanya dipakai bila buku besar kosong, dan diberi label "di luar buku besar". Tidak pernah dijumlahkan keduanya.' },
  { kunci: 'jumlah_penerima_gaji', label: 'Jumlah penerima gaji', satuan: 'orang', sumber: 'MK Connect',
    definisi: 'Jumlah karyawan yang diinput gajinya untuk bulan itu.' },
  { kunci: 'biaya_hr', label: 'Biaya HR lain', satuan: 'rupiah', sumber: 'Buku besar / MK Connect',
    definisi: 'Bonus, reimbursement, dan biaya HR lain yang disetujui.' },
  { kunci: 'biaya_operasional', label: 'Biaya operasional aktual', satuan: 'rupiah', sumber: 'Buku besar / input CFO',
    definisi: 'Biaya operasi yang benar-benar terjadi (bukan persentase asumsi rumus dividen).' },
  { kunci: 'biaya_vendor_outsourcing', label: 'Biaya vendor outsourcing', satuan: 'rupiah', sumber: 'Buku besar / input CFO',
    definisi: 'Pembayaran ke pihak luar untuk fungsi outsourcing (mis. housekeeping).' },
  { kunci: 'kewajiban_investor_tetap', label: 'Kewajiban tetap ke investor unit', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Pembayaran tetap per bulan sesuai kontrak investor (passive tetap). Disajikan sebagai baris kewajiban tersendiri, tidak dicampur biaya operasional.' },
  { kunci: 'kewajiban_investor_jaminan', label: 'Top-up jaminan minimum investor', satuan: 'rupiah', sumber: 'Sistem operasi properti',
    definisi: 'Selisih yang harus ditambahkan agar bagian investor mencapai jaminan minimum per unit (rumus beku sistem villa).' },
  { kunci: 'kas', label: 'Kas', satuan: 'rupiah', sumber: 'Buku besar / sistem operasi',
    definisi: 'Saldo kas & bank pada akhir bulan.' },
  { kunci: 'utang', label: 'Utang', satuan: 'rupiah', sumber: 'Buku besar / sistem operasi',
    definisi: 'Saldo liabilitas pada akhir bulan.' },
  { kunci: 'anggaran_total', label: 'Anggaran proyek', satuan: 'rupiah', sumber: 'MK Connect (konstruksi)',
    definisi: 'Total anggaran proyek pembangunan (RAB).' },
  { kunci: 'realisasi_biaya', label: 'Realisasi biaya (MK Connect)', satuan: 'rupiah', sumber: 'MK Connect (konstruksi)',
    definisi: 'Total biaya pembangunan yang disetujui di MK Connect s.d. akhir bulan — pembanding untuk HPP di buku besar.' },
  { kunci: 'progres_fisik_pct', label: 'Progres fisik', satuan: 'persen', sumber: 'MK Connect (konstruksi)',
    definisi: 'Persentase progres fisik hasil penilaian lapangan.' },
  { kunci: 'catatan_sumber', label: 'Catatan sumber', satuan: 'teks', sumber: 'Pengirim data',
    definisi: 'Catatan pengirim tentang keterbatasan data bulan itu.' },
];

export const INDEKS_METRIK = new Map(DEFINISI_METRIK.map((d) => [d.kunci, d]));

/** Definisi angka yang dihitung modul ini dari buku besar (bukan kiriman). */
export const DEFINISI_BUKU_BESAR: { label: string; definisi: string }[] = [
  { label: 'Pendapatan (buku besar)', definisi: 'Saldo kredit akun berawalan 4 dalam bulan, untuk kode proyek milik unit — mesin laporan SAK EMKM aplikasi (tidak ada rumus baru).' },
  { label: 'HPP / Beban pokok', definisi: 'Saldo debet akun berawalan 5 (material, upah tukang, subkontraktor, dll.).' },
  { label: 'Beban operasional', definisi: 'Saldo debet akun berawalan 6.' },
  { label: 'Laba operasional', definisi: 'Pendapatan − HPP − beban operasional. Belum dikurangi pajak (tidak ada akun pajak di COA).' },
  { label: 'Kas & bank', definisi: 'Saldo kumulatif akun kas/bank (1-1001…1-1008) sejak awal pembukuan s.d. akhir bulan.' },
  { label: 'Liabilitas', definisi: 'Saldo kumulatif akun liabilitas jangka pendek dan panjang s.d. akhir bulan.' },
  { label: 'Utang bank', definisi: 'Pokok − terbayar dari daftar utang bank (menu Utang Bank).' },
  { label: 'Unit terjual', definisi: 'Jumlah aset berstatus terjual/DP per proyek dari menu Aset (tanpa nama pembeli).' },
  { label: 'Unit per karyawan', definisi: 'Unit total ÷ headcount internal. Fungsi outsourcing tidak masuk penyebut.' },
  { label: 'Gaji % pendapatan', definisi: 'Total gaji ÷ pendapatan basis investor × 100 (untuk operasi properti).' },
];

export const BAGIAN_LAPORAN = [
  { kunci: 'sampul', label: 'Sampul' },
  { kunci: 'ringkasan', label: 'Ringkasan eksekutif' },
  { kunci: 'tren', label: 'Tren bulanan' },
  { kunci: 'channel', label: 'Channel & unit economics' },
  { kunci: 'tim', label: 'Tim & efisiensi operasional' },
  { kunci: 'teknologi', label: 'Teknologi sistem' },
  { kunci: 'keuangan', label: 'Keuangan (laba rugi, arus kas, kewajiban)' },
  { kunci: 'portofolio', label: 'Portofolio per unit bisnis' },
  { kunci: 'risiko', label: 'Risiko & mitigasi' },
  { kunci: 'lampiran', label: 'Lampiran definisi & sumber' },
] as const;

export type KunciBagian = (typeof BAGIAN_LAPORAN)[number]['kunci'];

export const BAGIAN_NARASI = [
  { kunci: 'ringkasan', label: 'Ringkasan / pesan utama' },
  { kunci: 'strategi', label: 'Strategi' },
  { kunci: 'teknologi', label: 'Teknologi sistem' },
  { kunci: 'risiko', label: 'Risiko' },
  { kunci: 'mitigasi', label: 'Mitigasi' },
  { kunci: 'catatan', label: 'Catatan tambahan' },
] as const;

export type KunciNarasi = (typeof BAGIAN_NARASI)[number]['kunci'];

export const LABEL_JENIS: Record<string, string> = {
  operasi_properti: 'Operasi properti',
  proyek_pembangunan: 'Proyek pembangunan',
};

export const LABEL_MODEL: Record<string, string> = {
  milik_sendiri: 'Milik sendiri',
  sewa: 'Sewa',
  kontrak_manajemen: 'Kontrak manajemen',
};

export const DATA_BELUM_TERSEDIA = 'data belum tersedia';
