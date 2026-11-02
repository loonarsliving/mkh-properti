import { describe, expect, it } from 'vitest';
import { HARI, dataProduksi } from '@/lib/cfo/fixture-uji';
import { laporanHolding } from '@/lib/cfo/holding';
import { susunModelCfo } from '@/lib/cfo/model';
import type { DataCfo } from '@/lib/cfo/tipe';
import { cekKualitasData } from './kualitas-data';
import { bandingLabaRugi, labaRugiInstitusional, type BarisPl } from './laba-rugi';
import { daftarPeriode, periodeMemuat, periodeSebelumnya } from './periode';
import { jumlahSel, kelengkapanDari, sel } from './status';
import { unitEkonomiLoonars1 } from './unit-ekonomi';

function dataLengkap(): DataCfo {
  const d = dataProduksi();
  const g = (id: string, cabang: string, periode: string, nominal: number, status: string) => ({
    sumber: 'svcmyb', jenis: 'gaji_karyawan', id, data: { cabang, periode, nominal, status }, diterima_pada: HARI, sumber_diubah_pada: null,
  });
  d.snapshot.push(
    g('1', 'Jogja', '2026-10', 6_000_000, 'transferred'),
    g('2', 'Jogja', '2026-11', 6_500_000, 'pending_transfer'),
    g('3', 'Loonars Private Living', '2026-10', 2_000_000, 'transferred'),
    {
      sumber: 'svcmyb', jenis: 'proyek_konstruksi', id: 'lc1',
      data: {
        nama: 'Loonars Coffee', cabang: 'Loonars Coffee', status: 'completed', budget_total: 133_387_454, budget_material: 58_387_454, budget_tenaga: 75_000_000,
        realisasi: { material_purchase: 74_513_950, other_expense: 34_889_000, contractor_payment: 75_000_000 }, komitmen: {}, utang_belum_lunas: 0, utang_lunas: 0,
      },
      diterima_pada: HARI, sumber_diubah_pada: '2026-03-15T00:00:00Z',
    },
  );
  return d;
}

const cari = (b: BarisPl[], kode: string) => b.find((x) => x.kode === kode)!;

describe('status angka', () => {
  it('belum tercatat tidak pernah bernilai nol', () => {
    expect(sel(0, 'belum_tercatat').nilai).toBeNull();
    expect(sel(5, 'tidak_berlaku').nilai).toBeNull();
    expect(sel(0, 'nol_kebijakan').nilai).toBe(0);
  });
  it('jumlah sel menjumlah yang tercatat dan menandai sebagian', () => {
    const j = jumlahSel([sel(100, 'aktual'), sel(null, 'belum_tercatat'), sel(null, 'tidak_berlaku')]);
    expect(j.nilai).toBe(100);
    expect(j.status).toBe('sebagian');
    expect(jumlahSel([sel(null, 'belum_tercatat')]).nilai).toBeNull();
    // nol-kebijakan tidak menutupi data hilang
    expect(jumlahSel([sel(0, 'nol_kebijakan'), sel(null, 'tidak_tersedia')])).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
    expect(jumlahSel([sel(0, 'nol_kebijakan'), sel(null, 'belum_tercatat')])).toMatchObject({ nilai: null, status: 'belum_tercatat' });
    expect(jumlahSel([sel(0, 'nol_kebijakan'), sel(10, 'aktual'), sel(null, 'belum_tercatat')])).toMatchObject({ nilai: 10, status: 'sebagian' });
    expect(kelengkapanDari(['aktual', 'estimasi'])).toBe('perlu_verifikasi');
    expect(kelengkapanDari(['aktual', 'tidak_berlaku'])).toBe('lengkap');
  });
});

describe('periode laporan', () => {
  it('bulanan, kuartalan, tahunan', () => {
    expect(periodeMemuat('kuartalan', '2026-11').bulan).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(periodeSebelumnya(periodeMemuat('kuartalan', '2026-02')).kode).toBe('2025-Q4');
    expect(periodeSebelumnya(periodeMemuat('bulanan', '2026-01')).kode).toBe('2025-12');
    expect(daftarPeriode('tahunan', HARI, 2).map((p) => p.kode)).toEqual(['2026', '2025']);
  });
});

describe('laba rugi institusional', () => {
  const data = dataLengkap();
  const m = susunModelCfo(data, HARI);

  it('Oktober 2026: angka villa sama dengan laporan villa, pos kosong tidak dianggap nol', () => {
    const lr = labaRugiInstitusional(m, data, periodeMemuat('bulanan', '2026-10'));
    const okt = m.l1.bulan.find((b) => b.bulan === '2026-10')!;
    expect(cari(lr.baris, 'PL-01').sel.L1.nilai).toBe(155_084_926);
    expect(cari(lr.baris, 'PL-01').sel.L1.status).toBe('aktual');
    expect(cari(lr.baris, 'PL-03').sel.L1.nilai).toBe(-38_092_577);
    expect(cari(lr.baris, 'PL-05').sel.L1.status).toBe('estimasi');
    expect(cari(lr.baris, 'PL-02').sel.L1).toMatchObject({ nilai: null, status: 'belum_tercatat' });
    expect(cari(lr.baris, 'PL-08').sel.L1).toMatchObject({ nilai: null, status: 'belum_tercatat' });
    // memo EBITDA sebelum bagi hasil = EBITDA laporan villa
    expect(cari(lr.baris, 'PL-M1').sel.L1.nilai).toBe(Math.round(okt.ebitda));
    // EBITDA setelah bagi hasil = bagian MKH bersih
    expect(cari(lr.baris, 'PL-16').sel.L1.nilai).toBe(Math.round(okt.ebitda - okt.bagiHasilInvestor - okt.topupJaminan));
    // Loonars 2 diakui 31 Des → Oktober nol karena kebijakan, bukan "kosong"
    expect(cari(lr.baris, 'PL-01').sel.L2).toMatchObject({ nilai: 0, status: 'nol_kebijakan' });
    // gaji holding: slip cabang villa dikecualikan
    expect(cari(lr.baris, 'PL-07').sel.holding.nilai).toBe(-6_000_000);
    expect(cari(lr.baris, 'PL-22').kelengkapan).toBe('tidak_lengkap');
  });

  it('pendapatan jurnal LL (F-1) disebut di catatan, tidak dijumlahkan', () => {
    const agu = labaRugiInstitusional(m, data, periodeMemuat('bulanan', '2026-08'));
    expect(agu.catatan.join(' ')).toMatch(/1\.908\.000\.000/);
    // L1 tidak tersedia + L2 nol-kebijakan → konsolidasi tidak tersedia, BUKAN 0
    expect(cari(agu.baris, 'PL-01').konsolidasi).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
    expect(cari(agu.baris, 'PL-15').sel.L2.catatan).toMatch(/F-1/);
  });

  it('tidak ada sel "belum tercatat" / "tidak tersedia" yang bernilai', () => {
    for (const kode of ['2026-09', '2026-10', '2026-11']) {
      const lr = labaRugiInstitusional(m, data, periodeMemuat('bulanan', kode));
      for (const b of lr.baris) {
        for (const s of [b.sel.L1, b.sel.L2, b.sel.holding, b.konsolidasi]) {
          if (['belum_tercatat', 'tidak_tersedia', 'tidak_berlaku'].includes(s.status)) expect(s.nilai).toBeNull();
        }
      }
    }
  });

  it('bulan tanpa laporan villa = tidak tersedia, bukan nol', () => {
    const lr = labaRugiInstitusional(m, data, periodeMemuat('bulanan', '2026-09'));
    expect(cari(lr.baris, 'PL-01').sel.L1).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
  });

  it('tahunan 2026: laba bersih konsolidasi = Laporan Holding (rekonsiliasi)', () => {
    const lr = labaRugiInstitusional(m, data, periodeMemuat('tahunan', '2026'));
    const h = laporanHolding(m, data, 2026);
    expect(h.labaBersih.konsolidasi).not.toBeNull();
    expect(cari(lr.baris, 'PL-22').konsolidasi.nilai).toBe(h.labaBersih.konsolidasi);
    expect(cari(lr.baris, 'PL-22').sel.L1.nilai).toBe(h.labaBersih.L1);
    expect(cari(lr.baris, 'PL-22').sel.L2.nilai).toBe(h.labaBersih.L2);
    expect(cari(lr.baris, 'PL-22').sel.holding.nilai).toBe(h.labaBersih.holding);
    // penyusutan LC: selesai Maret → mulai April, Apr–Nov = 8 bulan
    expect(cari(lr.baris, 'PL-17').sel.L2.nilai).toBe(-Math.round((184_402_950 / 240) * 8));
    expect(cari(lr.baris, 'PL-17').sel.L2.nilai).toBe(h.labaRugi.find((b) => b.kode === '7-01')!.L2);
    // L1 hanya Okt–Nov → sebagian
    expect(cari(lr.baris, 'PL-01').sel.L1.status).toBe('sebagian');
  });

  it('banding aktual vs bulan lalu vs anggaran', () => {
    const b = bandingLabaRugi(m, data, periodeMemuat('bulanan', '2026-11'), 'L1');
    const pendapatan = b.baris.find((x) => x.kode === 'PL-01')!;
    expect(b.lalu.periode.kode).toBe('2026-10');
    expect(pendapatan.selisih).toBe(5_889_243 - 155_084_926);
    expect(pendapatan.anggaran).toMatchObject({ nilai: null, status: 'belum_tercatat' });
  });
});

describe('unit economics Loonars 1', () => {
  const data = dataProduksi();
  const m = susunModelCfo(data, HARI);
  const okt = unitEkonomiLoonars1(m, data).find((b) => b.bulan === '2026-10')!;
  const kpi = (k: string) => okt.kpi.find((x) => x.kode === k)!.sel;

  it('rumus sesuai definisi', () => {
    expect(okt.jumlahKamar).toBe(13);
    expect(kpi('OCC').nilai).toBeCloseTo((271 / 403) * 100, 6);
    expect(kpi('OCC').status).toBe('estimasi'); // penyebut statis (F-3)
    expect(kpi('ADR').nilai).toBeCloseTo(155_084_925.75 / 271, 4);
    expect(kpi('ADR').status).toBe('aktual');
    expect(kpi('REVPAR').nilai).toBeCloseTo(155_084_925.75 / 403, 4);
    expect(kpi('GOPPAR').nilai).toBeCloseTo((116_992_349 - 27_543_972 - 10_500_000) / 403, 4);
  });

  it('channel: rasio komisi OTA & booking langsung', () => {
    const kotorOta = 97_459_975.75 + 28_648_762 + 11_909_396 + 5_462_500;
    const komisiOta = 32_267_386.75 + 0 + 4_295_192 + 1_529_998;
    expect(kpi('OTA_RATIO').nilai).toBeCloseTo((komisiOta / kotorOta) * 100, 6);
    expect(kpi('DIRECT_REV').nilai).toBeCloseTo((11_604_292 / (kotorOta + 11_604_292)) * 100, 6);
    expect(kpi('ALOS').nilai).toBeCloseTo(272 / 235, 6);
    expect(okt.channel[0].sumber).toBe('booking.com');
  });

  it('data yang belum dikirim = tidak tersedia', () => {
    expect(kpi('LEAD')).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
    expect(kpi('REPEAT')).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
    expect(kpi('CANCEL')).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
  });

  it('cancellation rate dari KPI villa bila tersedia', () => {
    const d = dataProduksi();
    d.l1_metrik.push({ periode: '2026-10', status: 'final', metrik: { booking_diakui: 235, booking_batal: 37 }, diterima_pada: HARI });
    const okt2 = unitEkonomiLoonars1(susunModelCfo(d, HARI), d).find((b) => b.bulan === '2026-10')!;
    expect(okt2.kpi.find((x) => x.kode === 'CANCEL')!.sel.nilai).toBeCloseTo((37 / 272) * 100, 6);
  });
});

describe('kualitas data', () => {
  const data = dataProduksi();
  const m = susunModelCfo(data, HARI);
  const r = cekKualitasData(m, data);
  const id = (x: string) => r.cek.find((c) => c.id === x);

  it('mendeteksi pendapatan jurnal LL yang belum dipetakan (F-1)', () => {
    expect(id('jurnal_ll_belum_dipetakan')).toMatchObject({ status: 'perlu_verifikasi', nilai: 1_908_000_000 });
  });

  it('validasi debit = kredit', () => {
    const d = dataProduksi();
    d.jurnal_bulanan = [
      { proyek: 'LL', akun: '1-1001', bulan: '2026-10', d: 100, k: 0, n: 1 },
      { proyek: 'LL', akun: '6-1007', bulan: '2026-10', d: 0, k: 100, n: 1 },
      { proyek: 'LC', akun: '1-1001', bulan: '2026-10', d: 500, k: 0, n: 1 },
    ];
    const r2 = cekKualitasData(susunModelCfo(d, HARI), d);
    expect(r2.cek.find((c) => c.id === 'jurnal_seimbang')!.status).toBe('tidak_lengkap');
    expect(r2.cek.find((c) => c.id === 'jurnal_seimbang')!.isi).toMatch(/LC 2026-10/);
  });

  it('kas villa belum dicatat & ekuitas plug = Incomplete; tanpa skor kesiapan', () => {
    expect(id('kas_villa')!.status).toBe('tidak_lengkap');
    expect(id('ekuitas_plug')!.status).toBe('tidak_lengkap');
    expect(r.perArea.find((a) => a.area === 'neraca')!.status).toBe('tidak_lengkap');
    expect(Object.keys(r)).not.toContain('skor');
    // urutan: Incomplete dulu
    expect(r.cek[0].status).toBe('tidak_lengkap');
  });
});
