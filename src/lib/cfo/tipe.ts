/**
 * Tipe data AI CFO.
 *
 * `DataCfo` = bentuk persis keluaran RPC `cfo_ambil_data` (migrasi 0057).
 * Angka dari PostgREST bisa datang sebagai string (numeric) — selalu lewat
 * `angka()` sebelum dihitung.
 */

export type Num = number | string | null | undefined;

export interface L1Laporan {
  periode: string; // YYYY-MM-01
  status: 'sementara' | 'final' | string;
  omzet_kotor: Num;
  komisi_ota: Num;
  pendapatan_bersih: Num;
  pendapatan_walkin: Num;
  malam_terjual: Num;
  malam_gratis: Num;
  malam_tersedia: Num;
  okupansi_pct: Num;
  cogs: Num;
  gross_profit: Num;
  opex: Num;
  net_profit: Num;
  channel?: { sumber: string; booking: number; malam: number; kotor: Num; komisi: Num; bersih: Num }[] | null;
  bagi_hasil?: {
    per_unit?: Num;
    pengelola?: Num;
    jaminan_aktif?: boolean;
    jaminan_topup?: Num;
    pool_investor?: Num;
    investor_count?: number;
  } | null;
  opex_rincian?: { peran: string; orang: number; periode: Num; per_bulan: Num }[] | null;
  diterima_pada: string;
}

export interface L1Pajak {
  periode: string;
  tarif_pct: Num;
  dasar: string;
  pajak_terutang: Num;
  jumlah_disetor: Num;
  tgl_setor: string | null;
}

export interface L2Unit {
  id: number;
  kode: string;
  tipe: string;
  nama_pembeli: string | null;
  status: 'tersedia' | 'booking' | 'dp' | 'lunas' | string;
  status_bangun: 'belum' | 'proses' | 'selesai' | 'serah_terima' | string;
  sedang_dibangun: boolean | null;
  harga: Num;
  biaya_bangun: Num;
  buffer: Num;
  fee: Num;
  kebutuhan_c: Num;
  dp_target: Num;
  total_dibayar: Num;
  sisa_pelunasan: Num;
  terpakai_konstruksi: Num;
  utang_disetujui: Num;
  keluar_c: Num;
  jatuh_tempo: string | null;
  is_unit_contoh: boolean | null;
}

export interface L2Rekening {
  kode: 'A' | 'B' | 'C' | 'D' | string;
  nama: string;
  saldo_awal: Num;
  saldo: Num;
  menunggu_transfer: Num;
}

export interface L2Penerimaan {
  id: number;
  unit_id: number;
  jenis: 'booking' | 'dp' | 'pelunasan' | 'cicilan' | string;
  nominal: Num;
  tanggal: string;
  status: 'aktif' | 'batal' | string;
}

export interface L2Pengeluaran {
  id: number;
  dari: string;
  kategori: string;
  unit_id: number | null;
  nominal: Num;
  tanggal: string;
  talangan: boolean | null;
  toko_id: number | null;
  cicilan_id: number | null;
}

export interface L2Toko {
  id: number;
  nama: string;
  utang_disetujui: Num;
  utang_menunggu: Num;
  cicilan_dibayar: Num;
  cicilan_diproses: Num;
  sisa_utang: Num;
}

export interface L2Cicilan {
  id: number;
  kelompok: string;
  toko_id: number;
  nominal: Num;
  status: string;
  dibuat_pada: string;
}

export interface L2PengajuanMenunggu {
  id: number;
  kategori: string;
  unit_id: number | null;
  nominal: Num;
  kelompok: string | null;
  dibuat_pada: string;
}

export interface JurnalBulanan {
  proyek: string | null;
  akun: string | null;
  bulan: string; // YYYY-MM
  d: Num;
  k: Num;
  n: number;
}

export interface PengajuanMenunggu {
  id: number;
  proyek: string | null;
  tipe: string;
  nominal: Num;
  dibuat_pada: string;
}

export interface UtangBank {
  id: number;
  proyek: string;
  jenis: string;
  bank: string;
  pokok: Num;
  terbayar: Num;
  jt_tempo: string | null;
}

export type JenisSnapshot =
  | 'investor_penjualan'
  | 'refund_customer'
  | 'transfer_tertunda'
  | 'ota_settlement'
  | 'pengajuan_biaya_villa'
  | 'villa_kas_masuk'
  | 'villa_kas_keluar'
  | 'proyek_konstruksi'
  | 'gaji_karyawan';

export interface Snapshot {
  sumber: string;
  jenis: JenisSnapshot | string;
  id: string;
  data: Record<string, unknown>;
  diterima_pada: string;
  sumber_diubah_pada: string | null;
}

export interface SaldoRekening {
  lini: 'L1' | 'L2' | string;
  rekening: string;
  saldo: Num;
  per_tanggal: string;
  catatan: string | null;
  dicatat_oleh: string;
  dibuat_pada: string;
}

export interface SyncLog {
  sumber: string;
  jenis: string;
  jumlah: number;
  baru: number;
  berubah: number;
  sama: number;
  nonaktif: number;
  lengkap: boolean;
  galat: string | null;
  diterima_pada: string;
}

export interface PengaturanCfo {
  url_aplikasi: string;
  kas_minimum: Num;
  briefing_harian: boolean;
  briefing_mingguan: boolean;
  peringatan_otomatis: boolean;
  diubah_pada: string;
}

export interface DataCfo {
  versi: number;
  dibuat_pada: string;
  akses: 'cfo' | 'wa' | 'sistem' | string;
  pengaturan: PengaturanCfo | null;
  l1_laporan: L1Laporan[];
  l1_metrik: { periode: string; status: string; metrik: Record<string, unknown>; diterima_pada: string }[];
  l1_pajak: L1Pajak[];
  l2_pengaturan: { target_tanah: Num; jatuh_tempo_tanah: string | null; dp_persen_default: Num } | null;
  l2_unit: L2Unit[];
  l2_rekening: L2Rekening[];
  l2_penerimaan: L2Penerimaan[];
  l2_pengeluaran: L2Pengeluaran[];
  l2_toko: L2Toko[];
  l2_cicilan: L2Cicilan[];
  l2_pengajuan_menunggu: L2PengajuanMenunggu[];
  jurnal_bulanan: JurnalBulanan[];
  pengajuan_menunggu: PengajuanMenunggu[];
  utang_bank: UtangBank[];
  /** saldo rekening tercatat terbaru per (lini, rekening) — cfo_saldo_rekening */
  saldo_rekening?: SaldoRekening[];
  /** status kunci periode buku besar (migrasi 0069); tidak ada sebelum migrasi diterapkan */
  fin_periode?: { periode: string; status: 'buka' | 'ditutup'; ditutup_pada: string | null }[];
  snapshot: Snapshot[];
  kesegaran: Record<string, string | null>;
  sync_log: SyncLog[];
}

/**
 * Rujukan sumber — setiap angka yang ditampilkan/dijawab AI CFO bisa
 * ditelusuri ke tabel/RPC asalnya.
 */
export interface Sumber {
  /** mis. 'laporan_villa_bulanan', 'loonars2_v_unit', 'snapshot:investor_penjualan' */
  tabel: string;
  /** keterangan singkat: periode, filter, id */
  ket?: string;
}

export type Tingkat = 'kritis' | 'tinggi' | 'sedang' | 'info';

export interface Peringatan {
  id: string;
  tingkat: Tingkat;
  lini: 'L1' | 'L2' | 'Grup' | 'Data';
  judul: string;
  isi: string;
  nilai?: number;
  sumber: Sumber[];
}
