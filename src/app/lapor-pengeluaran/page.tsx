import type { Metadata } from 'next';
import { FormLaporLapangan, type KonfigLapor } from '@/components/lapor/FormLaporLapangan';

export const metadata: Metadata = { title: 'Lapor Pengeluaran — Loonars Living' };

/**
 * Khusus Endy (Loonars Living): hanya boleh melaporkan pembelian material dan
 * pembayaran kontraktor. Batasan kategori ini disengaja.
 */
const KONFIG: KonfigLapor = {
  proyekId: 'LL',
  proyekNama: 'Loonars Living',
  bank: 'BSI',
  rekKode: '1-1004',
  namaPelapor: 'Endy',
  labelNama: 'Nama Pengawas',
  prefixPelapor: 'Pengawas',
  judul: 'Lapor Pengeluaran Proyek',
  penjelasan: (
    <>
      Khusus proyek <b>Loonars Living</b> — untuk laporan <b>pembelian material</b> atau{' '}
      <b>pembayaran kontraktor</b> saja. Link ini khusus untuk <b>Endy</b>. Laporan langsung dikirim
      ke <b>Kepala Cabang</b> lewat WhatsApp untuk diverifikasi sebelum diteruskan ke Super Admin
      untuk transfer. Tidak perlu login.
    </>
  ),
  jenis: [
    { akun: '5-1001', nama: 'Pembelian Material', label: 'Pembelian Material' },
    { akun: '5-1004', nama: 'Biaya Subkontraktor', label: 'Pembayaran Kontraktor' },
  ],
  bantuanRekening: 'Isi bank, nomor rekening, dan nama pemilik rekening tujuan transfer.',
};

export default function HalamanLaporPengeluaran() {
  return <FormLaporLapangan konfig={KONFIG} />;
}
