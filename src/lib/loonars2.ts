/**
 * Tipe & label modul Keuangan Loonars 2 (migrasi 0043). Semua hitungan uang
 * (alokasi C → B → D, saldo, proyeksi tanah, syarat profit) ada di database
 * — file ini hanya bentuk data untuk tampilan, tanpa rumus keuangan.
 */

/** Aksi yang boleh diteruskan /api/loonars2/wa ke RPC loonars2_wa. */
export const AKSI_WA_LOONARS2 = [
  'saldo',
  'tagihan',
  'receipt',
  'konfirmasi_transfer',
  'ubah_rekening',
  'putuskan',
  'cairkan_profit',
  'ajukan',
  'bayar_pengajuan',
  'utang',
  'daftar_utang',
  'ajukan_mingguan',
  'putuskan_kode',
  'bayar_kelompok',
  'unit_dibangun',
  'borongan',
  'daftar_borongan',
  'bahan',
  'koreksi_bahan',
  'rab',
  'bukti_kandidat',
  'bukti_transfer',
  'ya',
  'batal',
  'outbox_ambil',
  'outbox_selesai',
] as const;

export type KodeRekening = 'A' | 'B' | 'C' | 'D';

export interface L2Rekening {
  kode: KodeRekening;
  nama: string;
  fungsi: string;
  bank: string | null;
  nomor_rekening: string | null;
  nama_pemilik: string | null;
  saldo_awal: number;
  saldo: number;
  menunggu_transfer: number;
}

export interface L2Unit {
  id: number;
  nomor: number;
  kode: string;
  tipe_id: number;
  tipe: string;
  nama_pembeli: string | null;
  harga: number | null;
  dp_persen: number | null;
  fee_persen: number | null;
  status: 'tersedia' | 'booking' | 'dp' | 'lunas';
  jatuh_tempo_pelunasan: string | null;
  tanggal_serah_terima: string | null;
  status_bangun: 'belum' | 'proses' | 'selesai' | 'serah_terima';
  is_unit_contoh: boolean;
  catatan: string | null;
  harga_efektif: number;
  dp_persen_efektif: number;
  fee_persen_efektif: number;
  biaya_bangun: number;
  buffer: number;
  fee: number;
  kebutuhan_c: number;
  dp_target: number;
  total_dibayar: number;
  sisa_pelunasan: number;
  c_dialokasikan: number;
  c_terkonfirmasi: number;
  terpakai_konstruksi: number;
  komitmen_disetujui: number;
  terdanai_penuh: boolean;
  jatuh_tempo_efektif: string | null;
  utang_disetujui: number;
}

export interface L2TipeUnit {
  id: number;
  nama: string;
  harga: number;
  biaya_bangun: number;
  buffer_persen: number;
  fee_persen: number;
  jumlah_unit: number;
}

export interface L2Pengaturan {
  id: number;
  target_tanah: number;
  jatuh_tempo_tanah: string | null;
  dp_persen_default: number;
  jam_mulai_pengingat: number;
  jam_selesai_pengingat: number;
  interval_pengingat_jam: number;
  eskalasi_jam: number;
  milestone_profit: {
    wajib_target_tanah_terkonfirmasi?: boolean;
    wajib_unit_terjual_terdanai_penuh?: boolean;
    min_unit_serah_terima?: number;
  };
}

export interface L2Receipt {
  id: number;
  unit_id: number;
  jenis: 'booking' | 'dp' | 'pelunasan' | 'cicilan';
  nominal: number;
  tanggal: string;
  bukti_url: string | null;
  status: 'aktif' | 'batal';
  sumber: 'wa' | 'web';
  dicatat_oleh: string;
  dibuat_pada: string;
}

export interface L2Alokasi {
  id: number;
  receipt_id: number;
  urutan: number;
  ke_rekening: 'B' | 'C' | 'D';
  nominal: number;
  status: 'menunggu' | 'terkonfirmasi' | 'batal';
  dikonfirmasi_pada: string | null;
  dikonfirmasi_oleh: string | null;
  bukti_url: string | null;
}

export interface L2Pengajuan {
  id: number;
  unit_id: number;
  kategori: 'material' | 'tukang' | 'lain';
  deskripsi: string;
  toko: string | null;
  nominal: number;
  nota_url: string | null;
  diajukan_oleh: string;
  pakai_buffer: boolean;
  melewati_buffer: boolean;
  saldo_c_kurang: boolean;
  unit_belum_terdanai: boolean;
  status: 'menunggu' | 'disetujui' | 'ditolak' | 'dibayar';
  alasan_tolak: string | null;
  diputuskan_oleh: string | null;
  dibuat_pada: string;
  kelompok: string | null;
  borongan_id: number | null;
  minggu_ke: number | null;
  retensi: boolean;
  pesanan_id: number | null;
}

export interface L2Toko {
  id: number;
  nama: string;
  catatan: string | null;
  utang_disetujui: number;
  utang_menunggu: number;
  cicilan_dibayar: number;
  cicilan_diproses: number;
  sisa_utang: number;
}

/** Toko tanpa utang/cicilan sama sekali (sisa nama ganda yang sudah digabung) tidak ditampilkan. */
export function tokoAda(t: L2Toko): boolean {
  return Number(t.utang_disetujui) !== 0 || Number(t.utang_menunggu) !== 0 || Number(t.cicilan_dibayar) !== 0 || Number(t.cicilan_diproses) !== 0;
}

export interface L2Utang {
  id: number;
  kelompok: string;
  toko_id: number;
  unit_id: number;
  deskripsi: string;
  nominal: number;
  tanggal: string;
  nota_url: string | null;
  diajukan_oleh: string;
  pakai_buffer: boolean;
  melewati_buffer: boolean;
  unit_belum_terdanai: boolean;
  status: 'menunggu' | 'disetujui' | 'ditolak';
  alasan_tolak: string | null;
}

export interface L2Cicilan {
  id: number;
  kelompok: string;
  toko_id: number;
  nominal: number;
  catatan: string | null;
  diajukan_oleh: string;
  status: 'menunggu' | 'disetujui' | 'ditolak' | 'dibayar';
  alasan_tolak: string | null;
  dibuat_pada: string;
}

export interface L2Pengeluaran {
  id: number;
  dari_rekening: 'B' | 'C' | 'D';
  kategori: string;
  unit_id: number | null;
  material_request_id: number | null;
  nominal: number;
  tanggal: string;
  penerima: string | null;
  keterangan: string | null;
  bukti_url: string | null;
  dicatat_oleh: string;
  /** Dibayar saat saldo C belum cukup (bukti transfer owner): dana talangan, menunggu tertutup dari penjualan. */
  talangan: boolean;
}

export interface L2PenggunaWa {
  id: number;
  nomor: string;
  nama: string;
  peran: 'owner' | 'pelaksana';
  aktif: boolean;
}

export interface L2Audit {
  id: number;
  tabel: string;
  baris_id: string;
  aksi: string;
  nilai_lama: Record<string, unknown> | null;
  nilai_baru: Record<string, unknown> | null;
  aktor: string;
  sumber: string;
  dibuat_pada: string;
}

export interface L2Ringkasan {
  tertunda: number;
  teks_tertunda: string | null;
  proyeksi_tanah: {
    b_dialokasikan: number;
    pelunasan_terjadwal_ke_b: number;
    proyeksi: number;
    target: number;
    kurang: number;
    unit_tambahan: number;
    jatuh_tempo: string | null;
  };
  kesehatan: { saldo_c: number; menunggu_ke_c: number; kebutuhan_sisa: number; kurang: number };
}

/**
 * Data baca-saja untuk pelaksana (RPC loonars2_web_lihat, migrasi 0045).
 * Sengaja tanpa saldo rekening, nomor rekening, pembeli, harga, dan audit.
 */
export interface L2PelaksanaUnit {
  id: number;
  nomor: number;
  kode: string;
  tipe: string;
  status: L2Unit['status'];
  status_bangun: L2Unit['status_bangun'];
  is_unit_contoh: boolean;
  jatuh_tempo_efektif: string | null;
  biaya_bangun: number;
  buffer: number;
  terpakai_konstruksi: number;
  utang_disetujui: number;
  komitmen_disetujui: number;
  sedang_dibangun: boolean;
}

/** Ringkasan borongan tukang (view loonars2_v_borongan, migrasi 0047). */
export interface L2Borongan {
  id: number;
  nama: string;
  nilai_per_unit: number;
  retensi_per_unit: number;
  jumlah_minggu: number;
  tanggal_mulai: string | null;
  status: 'aktif' | 'selesai' | 'batal';
  jumlah_unit: number;
  total_mingguan: number;
  total_retensi: number;
  minggu_diajukan: number;
  minggu_dibayar: number;
  nominal_diajukan: number;
  nominal_dibayar: number;
  retensi_diajukan: number;
  retensi_dibayar: number;
}

/** RAB pemakaian bahan per unit (view loonars2_v_rab_bahan). */
export interface L2Rab {
  unit_id: number;
  item: string;
  satuan: string | null;
  qty: number | null;
  nominal: number;
}

export interface L2Pelaksana {
  proyeksi_tanah: L2Ringkasan['proyeksi_tanah'];
  unit: L2PelaksanaUnit[];
  toko: L2Toko[];
  utang: Pick<L2Utang, 'id' | 'kelompok' | 'toko_id' | 'unit_id' | 'deskripsi' | 'nominal' | 'tanggal' | 'pakai_buffer' | 'melewati_buffer' | 'status' | 'alasan_tolak'>[];
  cicilan: Pick<L2Cicilan, 'id' | 'kelompok' | 'toko_id' | 'nominal' | 'catatan' | 'status' | 'alasan_tolak' | 'dibuat_pada'>[];
  pengajuan: Pick<L2Pengajuan, 'id' | 'kelompok' | 'unit_id' | 'kategori' | 'deskripsi' | 'toko' | 'nominal' | 'pakai_buffer' | 'melewati_buffer' | 'status' | 'alasan_tolak' | 'dibuat_pada' | 'borongan_id' | 'minggu_ke' | 'retensi'>[];
  borongan: L2Borongan[];
  rab: L2Rab[];
}

export const LABEL_STATUS_UNIT: Record<L2Unit['status'], string> = {
  tersedia: 'Tersedia',
  booking: 'Booking',
  dp: 'DP',
  lunas: 'Lunas',
};

export const LABEL_STATUS_BANGUN: Record<L2Unit['status_bangun'], string> = {
  belum: 'Belum',
  proses: 'Proses',
  selesai: 'Selesai',
  serah_terima: 'Serah terima',
};

export const KATEGORI_PENGELUARAN: { id: string; label: string; dari: 'B' | 'C' | 'D' }[] = [
  { id: 'tanah', label: 'Pembayaran tanah (B)', dari: 'B' },
  { id: 'fee_marketing', label: 'Fee marketing (C)', dari: 'C' },
  { id: 'material', label: 'Material tanpa pengajuan (C)', dari: 'C' },
  { id: 'tukang', label: 'Tukang tanpa pengajuan (C)', dari: 'C' },
  { id: 'lain_konstruksi', label: 'Lain-lain konstruksi (C)', dari: 'C' },
  { id: 'profit', label: 'Pencairan profit (D)', dari: 'D' },
];
