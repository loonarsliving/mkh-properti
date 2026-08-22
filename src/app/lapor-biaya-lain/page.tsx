import type { Metadata } from 'next';
import { FormLaporLapangan, type KonfigLapor } from '@/components/lapor/FormLaporLapangan';

export const metadata: Metadata = { title: 'Lapor Biaya Lain-lain — Loonars Living' };

/** Khusus Rebecca (Loonars Living): pengeluaran di luar material & kontraktor. */
const KONFIG: KonfigLapor = {
  proyekId: 'LL',
  proyekNama: 'Loonars Living',
  bank: 'BSI',
  rekKode: '1-1004',
  namaPelapor: 'Rebecca',
  labelNama: 'Nama Pelapor',
  prefixPelapor: 'Pelapor',
  judul: 'Lapor Biaya Lain-lain',
  penjelasan: (
    <>
      Khusus proyek <b>Loonars Living</b> — untuk pengeluaran <b>di luar material &amp; kontraktor</b>{' '}
      (mis. transportasi, konsumsi, perlengkapan, biaya tak terduga, dll). Link ini khusus untuk{' '}
      <b>Rebecca</b>. Laporan langsung dikirim ke <b>Kepala Cabang</b> lewat WhatsApp untuk
      diverifikasi sebelum diteruskan ke Super Admin untuk transfer. Tidak perlu login.
    </>
  ),
  jenis: [{ akun: '6-1007', nama: 'Beban Lain-lain', label: 'Beban Lain-lain' }],
  bantuanRekening:
    'Isi bank, nomor rekening, dan nama pemilik rekening tujuan transfer. Kosongkan jika sudah dibayar tunai di lapangan.',
};

export default function HalamanLaporBiayaLain() {
  return <FormLaporLapangan konfig={KONFIG} />;
}
