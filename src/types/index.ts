/** Kategori akun pada bagan akun (COA) MKH. */
export type KategoriAkun =
  | 'Aset Lancar'
  | 'Aset Tetap'
  | 'Liabilitas Lancar'
  | 'Liabilitas Panjang'
  | 'Ekuitas'
  | 'Pendapatan'
  | 'HPP'
  | 'Beban Operasional';

/** Saldo normal akun: D = debet, K = kredit. */
export type SaldoNormal = 'D' | 'K';

export interface Akun {
  kode: string;
  /** Nama operasional (dipakai di form input & tabel harian). */
  nama: string;
  /** Nama formal untuk penyajian laporan keuangan SAK EMKM. */
  namaLaporan: string;
  kat: KategoriAkun;
  tipe: SaldoNormal;
  /** Nomor rekening bank, hanya untuk akun bank. */
  rek?: string;
}

export interface Proyek {
  id: string;
  nama: string;
  rek: string;
  bank: string;
  warna: string;
}

export interface Branch {
  id: string;
  nama: string;
  warna: string;
  proyekIds: string[];
}

/** Baris tabel `jurnal` di Supabase (kolom apa adanya, huruf kecil). */
export interface JurnalRow {
  id?: number;
  tgl: string;
  no: string;
  ket: string;
  akun: string;
  nama: string;
  proyek: string;
  d: number | string | null;
  k: number | string | null;
}

/** Baris jurnal yang sudah dinormalisasi (D/K sebagai number). */
export interface Jurnal extends JurnalRow {
  D: number;
  K: number;
}

export interface Aset {
  id?: number;
  proyek: string;
  blok: string;
  tipe?: string | null;
  luas?: number | string | null;
  harga?: number | string | null;
  /** "tersedia" | "dp" | "terjual" */
  status?: string | null;
  pembeli?: string | null;
  tgl_jual?: string | null;
  ket?: string | null;
}

export interface UtangBank {
  id?: number;
  proyek: string;
  bank: string;
  jenis?: string | null;
  no_akad?: string | null;
  pokok: number;
  potongan_per_unit: number;
  terbayar: number;
  tgl_akad?: string | null;
  jt_tempo?: string | null;
  ket?: string | null;
}

export interface UsersProyek {
  id?: number;
  email: string;
  proyek_id: string;
  nama?: string | null;
  role?: string | null;
}

export interface TukangBorongan {
  id?: number;
  proyek: string;
  nama: string;
  /** Jenis pekerjaan borongan. */
  item?: string | null;
  blok?: string | null;
  nilai_kontrak: number;
  harga_per_unit: number;
  total_unit: number;
  unit_selesai: number;
  terbayar: number;
  ket?: string | null;
}

export interface BayarTukang {
  id?: number;
  tukang_id: number;
  tukang_nama?: string | null;
  no?: string | null;
  tgl: string;
  nominal: number | string;
  blok_selesai?: string | null;
  ket?: string | null;
  proyek?: string | null;
}

/** Tipe pengajuan yang dikenal sistem. */
export type TipePengajuan =
  | 'bahan'
  | 'tukang'
  | 'gaji'
  | 'komisi'
  | 'bonus'
  | 'reimbursement'
  | 'hr_lain';

export type StatusPengajuan = 'pending' | 'approved' | 'rejected';

/** Isi kolom `pengajuan.data` (jsonb) — bentuknya berbeda per tipe. */
export interface DataPengajuan {
  tgl?: string;
  no?: string;
  nominal?: number | string;
  jenis?: string;
  akunNama?: string;
  rek?: string;
  rekNama?: string;
  item?: string;
  items?: { nama: string; nilai: number }[];
  supplier?: string;
  ket?: string;
  keterangan?: string;
  proyek_nama?: string;
  paid_at?: string | null;
  // tukang
  tukang_nama?: string;
  minggu?: string | number;
  blok_selesai?: string;
  // sinkronisasi HR / MK Connect
  employee_name?: string;
  employee_code?: string;
  mkc_employee_id?: string | number;
  period_month?: string | number;
  period_year?: string | number;
  base_salary?: number | string;
  sales_name?: string;
  branch_name?: string;
  description?: string;
  sumber?: string;
}

export interface Pengajuan {
  id: number;
  proyek: string;
  tipe: TipePengajuan | string;
  status: StatusPengajuan | string;
  created_by?: string | null;
  verified_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  data?: DataPengajuan | null;
}

/** Baris `crm_payment_receipts` — kas masuk hasil sinkronisasi MK Connect. */
export interface CrmPaymentReceipt {
  id: number;
  proyek?: string | null;
  project_name?: string | null;
  unit_label?: string | null;
  payment_date?: string | null;
  amount?: number | string | null;
  customer_name?: string | null;
  payment_type?: string | null;
  sales_name?: string | null;
  branch_name?: string | null;
  jurnal_no?: string | null;
  reference_number?: string | null;
  status?: string | null;
  confirmed_by?: string | null;
  created_at?: string | null;
}

export interface Karyawan {
  id?: number;
  nama: string;
  proyek?: string | null;
  jabatan?: string | null;
  gaji?: number | string | null;
  status?: string | null;
  [key: string]: unknown;
}
