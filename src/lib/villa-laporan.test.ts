import { describe, expect, it } from 'vitest';
import { dasarPengenaan, hitungPajak, susunBarisPajak, type LaporanVillaBulanan, type PajakHotelVilla } from './villa-laporan';

const lap = {
  periode: '2026-10-01',
  status: 'sementara',
  omzet_kotor: '100000000.00',
  komisi_ota: '12000000.00',
  pendapatan_bersih: '88000000.00',
} as unknown as LaporanVillaBulanan;

function pajak(o: Partial<PajakHotelVilla>): PajakHotelVilla {
  return {
    periode: '2026-10-01',
    tarif_pct: 10,
    dasar: 'kotor',
    dasar_pengenaan: null,
    pajak_terutang: null,
    jumlah_disetor: null,
    tgl_setor: null,
    bukti_ref: null,
    catatan: null,
    dicatat_oleh: null,
    diperbarui_pada: '2026-10-20T00:00:00Z',
    ...o,
  };
}

describe('dasar dan tarif pajak', () => {
  it('dasar kotor memakai omzet kotor, bersih memakai pendapatan setelah komisi OTA', () => {
    expect(dasarPengenaan(lap, 'kotor')).toBe(100_000_000);
    expect(dasarPengenaan(lap, 'bersih')).toBe(88_000_000);
  });

  it('pajak = dasar x tarif, dibulatkan ke rupiah', () => {
    expect(hitungPajak(100_000_000, 10)).toBe(10_000_000);
    expect(hitungPajak(88_333_333, 10)).toBe(8_833_333);
  });
});

describe('susunBarisPajak', () => {
  it('tanpa baris pajak: bawaan kotor 10%, belum disetor, tidak dibekukan', () => {
    const b = susunBarisPajak(lap, null);
    expect(b).toMatchObject({ dasar: 'kotor', tarifPct: 10, dasarPengenaan: 100_000_000, pajakTerutang: 10_000_000, disetor: 0, kurang: 10_000_000, statusSetoran: 'belum', dibekukan: false });
  });

  it('dasar bersih mengikuti pengaturan bulan itu', () => {
    const b = susunBarisPajak(lap, pajak({ dasar: 'bersih' }));
    expect(b.pajakTerutang).toBe(8_800_000);
  });

  it('setoran sebagian dan lunas', () => {
    expect(susunBarisPajak(lap, pajak({ jumlah_disetor: 4_000_000 })).statusSetoran).toBe('sebagian');
    expect(susunBarisPajak(lap, pajak({ jumlah_disetor: 4_000_000 })).kurang).toBe(6_000_000);
    expect(susunBarisPajak(lap, pajak({ jumlah_disetor: 10_000_000 })).statusSetoran).toBe('lunas');
    expect(susunBarisPajak(lap, pajak({ jumlah_disetor: 10_500_000 })).statusSetoran).toBe('lebih');
  });

  it('angka yang dibekukan saat setoran tidak ikut berubah bila laporan berubah', () => {
    const berubah = { ...lap, omzet_kotor: '120000000.00' } as unknown as LaporanVillaBulanan;
    const b = susunBarisPajak(berubah, pajak({ dasar_pengenaan: 100_000_000, pajak_terutang: 10_000_000, jumlah_disetor: 10_000_000 }));
    expect(b.dibekukan).toBe(true);
    expect(b.pajakTerutang).toBe(10_000_000);
    expect(b.statusSetoran).toBe('lunas');
  });
});
