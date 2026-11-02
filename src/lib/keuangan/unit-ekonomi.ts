/**
 * HOSPITALITY UNIT ECONOMICS — Loonars 1 (Tahap 4 awal, tanpa perubahan skema).
 *
 * Rumus (permintaan owner 2026-11-02):
 *   Occupancy = Sold Room Nights / Available Room Nights
 *   ADR       = Room Revenue / Sold Room Nights
 *   RevPAR    = Room Revenue / Available Room Nights
 *   GOPPAR    = Gross Operating Profit / Available Room Nights
 *
 * Room Revenue = omzet kotor kamar (laporan villa; walk-in kafe/spa terpisah).
 * GOP = pendapatan bersih (setelah komisi OTA) − COGS − OPEX villa, sebelum
 * bagi hasil investor — memakai biaya STANDAR villa, jadi berstatus estimasi.
 *
 * Penyebut "Available Room Nights" saat ini = jumlah unit × hari (dikirim villa),
 * BELUM mengurangi kamar yang ditutup maintenance per tanggal (temuan F-3).
 * Semua KPI yang memakai penyebut itu berstatus "estimasi" sampai inventaris
 * kamar historis per tanggal tersambung (Tahap 2c).
 *
 * Booking lead time & repeat guest ratio: datanya ada di sistem villa tetapi
 * belum dikirim ke MKH Property → "tidak tersedia", bukan nol.
 */
import type { ModelCfo } from '@/lib/cfo/model';
import type { DataCfo, Sumber } from '@/lib/cfo/tipe';
import { angka, hariDalamBulan } from '@/lib/cfo/util';
import { sel, type Sel } from './status';

/** Pemetaan channel langsung — sama dengan normalizedChannel() di villa-api. */
export const CHANNEL_LANGSUNG = ['walk-in', 'website', 'whatsapp', 'google', 'late-night', 'investor', 'kol'];
export const adalahLangsung = (sumber: string) => CHANNEL_LANGSUNG.includes(sumber.trim().toLowerCase());

const S_VILLA: Sumber = { tabel: 'laporan_villa_bulanan' };
const S_METRIK: Sumber = { tabel: 'ir_metrik_bulanan', ket: 'unit loonars-1' };
const CAT_PENYEBUT = 'Penyebut = unit × hari; kamar ditutup maintenance belum dikurangkan (F-3).';

export interface KpiHospitality {
  kode: string;
  label: string;
  satuan: 'pct' | 'rp' | 'malam' | 'hari';
  rumus: string;
  sel: Sel;
}

export interface ChannelBulan {
  sumber: string;
  langsung: boolean;
  booking: number;
  malam: number;
  kotor: number;
  komisi: number;
  bersih: number;
  porsiKotorPct: number | null;
  rasioKomisiPct: number | null;
}

export interface UnitEkonomiBulan {
  bulan: string;
  status: string;
  jumlahKamar: number | null;
  malamTersedia: number;
  malamTerjual: number;
  kpi: KpiHospitality[];
  channel: ChannelBulan[];
}

const bagi = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

function k(kode: string, label: string, satuan: KpiHospitality['satuan'], rumus: string, nilai: number | null, status: 'aktual' | 'estimasi', sumber: Sumber[], catatan?: string, alasanKosong?: string): KpiHospitality {
  return {
    kode, label, satuan, rumus,
    sel: nilai === null ? sel(null, 'tidak_tersedia', sumber, alasanKosong ?? 'Pembagi nol / data belum ada.') : sel(nilai, status, sumber, catatan),
  };
}

export function unitEkonomiLoonars1(m: ModelCfo, data: DataCfo): UnitEkonomiBulan[] {
  return m.l1.bulan.map((b) => {
    const sementara = b.status !== 'final';
    const stAktual = sementara ? 'estimasi' : 'aktual';
    const catSementara = sementara ? 'Laporan villa bulan ini masih sementara.' : undefined;
    const hari = hariDalamBulan(b.bulan);
    const kamar = b.malamTersedia > 0 ? b.malamTersedia / hari : null;
    const gop = b.pendapatanBersih - b.cogs - b.opex;
    const totalKotor = b.channel.reduce((a, c) => a + c.kotor, 0);
    const ota = b.channel.filter((c) => !adalahLangsung(c.sumber));
    const langsung = b.channel.filter((c) => adalahLangsung(c.sumber));
    const kotorOta = ota.reduce((a, c) => a + c.kotor, 0);
    const komisiOta = ota.reduce((a, c) => a + c.komisi, 0);
    const malamCh = b.channel.reduce((a, c) => a + c.malam, 0);
    const bookingCh = b.channel.reduce((a, c) => a + c.booking, 0);
    const metrik = data.l1_metrik.find((x) => x.periode.slice(0, 7) === b.bulan)?.metrik ?? null;
    const diakui = metrik ? angka(metrik.booking_diakui as number) : 0;
    const batal = metrik ? angka(metrik.booking_batal as number) : 0;
    const adaBatal = metrik !== null && metrik.booking_batal !== undefined;

    const kpi: KpiHospitality[] = [
      k('OCC', 'Occupancy Rate', 'pct', 'Sold Room Nights ÷ Available Room Nights', pct(b.malamTerjual, b.malamTersedia), 'estimasi', [S_VILLA], CAT_PENYEBUT),
      k('ADR', 'ADR', 'rp', 'Room Revenue ÷ Sold Room Nights', bagi(b.revenue, b.malamTerjual), stAktual, [S_VILLA], catSementara),
      k('REVPAR', 'RevPAR', 'rp', 'Room Revenue ÷ Available Room Nights', bagi(b.revenue, b.malamTersedia), 'estimasi', [S_VILLA], CAT_PENYEBUT),
      k('GOPPAR', 'GOPPAR', 'rp', 'Gross Operating Profit ÷ Available Room Nights', bagi(gop, b.malamTersedia), 'estimasi', [S_VILLA], `GOP = pendapatan bersih − COGS standar − OPEX standar, sebelum bagi hasil. ${CAT_PENYEBUT}`),
      k('REV_KAMAR', 'Gross Revenue per Room', 'rp', 'Gross Revenue ÷ jumlah kamar', kamar ? b.revenue / kamar : null, 'estimasi', [S_VILLA], 'Jumlah kamar = malam tersedia ÷ hari.'),
      k('NET_KAMAR', 'Net Revenue per Room', 'rp', 'Net Revenue ÷ jumlah kamar', kamar ? b.pendapatanBersih / kamar : null, 'estimasi', [S_VILLA], 'Jumlah kamar = malam tersedia ÷ hari.'),
      k('COST_PAR', 'Operating Cost per Available Room Night', 'rp', '(COGS + OPEX) ÷ Available Room Nights', bagi(b.cogs + b.opex, b.malamTersedia), 'estimasi', [S_VILLA], `Biaya standar villa. ${CAT_PENYEBUT}`),
      k('OTA_RATIO', 'OTA Commission Ratio', 'pct', 'Komisi OTA ÷ Gross Revenue OTA', pct(komisiOta, kotorOta), stAktual, [S_VILLA], catSementara),
      k('DIRECT_REV', 'Direct Booking Ratio (revenue)', 'pct', 'Gross Revenue channel langsung ÷ Gross Revenue semua channel', pct(langsung.reduce((a, c) => a + c.kotor, 0), totalKotor), stAktual, [S_VILLA], 'Channel langsung: website, walk-in, WhatsApp, Google, late-night, investor, KOL.'),
      k('DIRECT_RN', 'Direct Booking Ratio (room nights)', 'pct', 'Malam channel langsung ÷ malam semua channel', pct(langsung.reduce((a, c) => a + c.malam, 0), malamCh), stAktual, [S_VILLA]),
      k('ALOS', 'Average Length of Stay', 'malam', 'Room nights ÷ jumlah booking', bagi(malamCh, bookingCh), stAktual, [S_VILLA], 'Dari rincian per channel (booking diakui per bulan check-in).'),
      k('CANCEL', 'Cancellation Rate', 'pct', 'Booking batal ÷ (diakui + batal)', adaBatal ? pct(batal, diakui + batal) : null, stAktual, [S_METRIK], undefined, 'KPI villa (ir_metrik_bulanan) untuk bulan ini belum dikirim.'),
      k('LEAD', 'Booking Lead Time', 'hari', 'rata-rata (check-in − tanggal booking)', null, 'aktual', [{ tabel: 'villa bookings' }], undefined, 'Data ada di sistem villa tetapi belum dikirim ke MKH Property (Tahap 2c).'),
      k('REPEAT', 'Repeat Guest Ratio', 'pct', 'Tamu dengan >1 booking ÷ total tamu', null, 'aktual', [{ tabel: 'villa bookings' }], undefined, 'Data ada di sistem villa tetapi belum dikirim ke MKH Property (Tahap 2c).'),
    ];

    const channel: ChannelBulan[] = b.channel
      .map((c) => ({
        sumber: c.sumber,
        langsung: adalahLangsung(c.sumber),
        booking: c.booking,
        malam: c.malam,
        kotor: c.kotor,
        komisi: c.komisi,
        bersih: c.bersih,
        porsiKotorPct: pct(c.kotor, totalKotor),
        rasioKomisiPct: pct(c.komisi, c.kotor),
      }))
      .sort((a, z) => z.kotor - a.kotor);

    return { bulan: b.bulan, status: b.status, jumlahKamar: kamar, malamTersedia: b.malamTersedia, malamTerjual: b.malamTerjual, kpi, channel };
  });
}
