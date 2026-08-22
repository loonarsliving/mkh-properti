import type { Metadata } from 'next';
import { FormLaporLapangan, type KonfigLapor } from '@/components/lapor/FormLaporLapangan';

export const metadata: Metadata = { title: 'Lapor Biaya Lain-lain — Introvert House' };

/**
 * Khusus Muhammad Syafiq (Introvert House / Makassar). Laporannya diverifikasi
 * Kepala Cabang Jogja — bukan Kepala Cabang Makassar — supaya tidak ada yang
 * menyetujui pengajuannya sendiri.
 */
const KONFIG: KonfigLapor = {
  proyekId: 'IH',
  proyekNama: 'Introvert House',
  bank: 'BSI',
  rekKode: '1-1003',
  namaPelapor: 'Muhammad Syafiq',
  labelNama: 'Nama Pelapor',
  prefixPelapor: 'Pelapor',
  judul: 'Lapor Biaya Lain-lain (Makassar)',
  penjelasan: (
    <>
      Khusus proyek <b>Introvert House (Makassar)</b> — untuk pengeluaran{' '}
      <b>operasional di luar material &amp; kontraktor</b> (mis. transportasi, konsumsi,
      perlengkapan, biaya tak terduga, dll). Link ini khusus untuk <b>Muhammad Syafiq</b> — laporan
      diteruskan ke Kepala Cabang Jogja untuk diverifikasi (bukan Kepala Cabang Makassar), supaya
      tidak ada yang menyetujui pengajuannya sendiri. Tidak perlu login.
    </>
  ),
  jenis: [{ akun: '6-1007', nama: 'Beban Lain-lain', label: 'Beban Lain-lain' }],
  bantuanRekening:
    'Isi bank, nomor rekening, dan nama pemilik rekening tujuan transfer. Kosongkan jika sudah dibayar tunai di lapangan.',
};

export default function HalamanLaporBiayaLainMakassar() {
  return <FormLaporLapangan konfig={KONFIG} />;
}
