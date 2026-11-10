import { describe, expect, it } from 'vitest';
import { HARI, dataProduksi } from '@/lib/cfo/fixture-uji';
import { laporanHolding } from '@/lib/cfo/holding';
import { susunModelCfo } from '@/lib/cfo/model';
import type { DataCfo } from '@/lib/cfo/tipe';
import { cekKualitasData } from './kualitas-data';
import { barisKesiapanWa, kesiapanInvestasi } from './kesiapan-investasi';
import { teksBriefingMingguan } from '@/lib/cfo/briefing';
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
    expect(cari(lr.baris, 'PL-01B').sel.L2).toMatchObject({ nilai: 0, status: 'nol_kebijakan' });
    expect(cari(lr.baris, 'PL-01').sel.L2.status).toBe('tidak_berlaku');
    // gaji holding: slip cabang villa dikecualikan
    expect(cari(lr.baris, 'PL-07').sel.holding.nilai).toBe(-6_000_000);
    expect(cari(lr.baris, 'PL-22').kelengkapan).toBe('tidak_lengkap');
  });

  it('D-1: penjualan unit villa L1 (jurnal LL) masuk kolom Loonars 1', () => {
    const agu = labaRugiInstitusional(m, data, periodeMemuat('bulanan', '2026-08'));
    expect(cari(agu.baris, 'PL-01B').sel.L1).toMatchObject({ nilai: 1_908_000_000, status: 'aktual' });
    expect(cari(agu.baris, 'PL-01B').konsolidasi.nilai).toBe(1_908_000_000);
    expect(cari(agu.baris, 'PL-21').sel.L1.nilai).toBe(-47_700_000); // PPh final 2,5%
    // bulan tanpa laporan villa: pendapatan kamar tetap tidak tersedia, BUKAN 0
    expect(cari(agu.baris, 'PL-01').konsolidasi).toMatchObject({ nilai: null, status: 'tidak_tersedia' });
    const sep = labaRugiInstitusional(m, data, periodeMemuat('bulanan', '2026-09'));
    expect(cari(sep.baris, 'PL-05B').sel.L1.nilai).toBe(-(499_828_028 + 316_854_000));
    expect(cari(sep.baris, 'PL-08').sel.L1).toMatchObject({ nilai: -1_021_750, status: 'sebagian' }); // LL tercatat, tagihan villa belum
    expect(cari(sep.baris, 'PL-15').sel.L1.nilai).toBe(-140_863_691);
    expect(agu.catatan.join(' ')).toMatch(/D-1/);
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

  it('D-1: kelengkapan penjualan unit L1 & saldo bank negatif buku besar LL ditandai', () => {
    expect(id('jurnal_ll_belum_dipetakan')).toBeUndefined();
    expect(id('penjualan_unit_l1')!.status).toBe('perlu_verifikasi');
    expect(id('kas_negatif:1-1004')).toMatchObject({ status: 'perlu_verifikasi', nilai: 610_000_000 - 1_027_042_297 });
    expect(id('bagi_hasil_unit_pt')!.status).toBe('perlu_verifikasi');
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
    // D-6: investor reporting cukup skema 70% dari profit
    expect(id('skema_bagi_hasil_investor')).toMatchObject({ status: 'lengkap', judul: expect.stringMatching(/70%/) });
    expect(id('register_investor')).toBeUndefined();
    expect(Object.keys(r)).not.toContain('skor');
    // urutan: Incomplete dulu
    expect(r.cek[0].status).toBe('tidak_lengkap');
  });
});

describe('kesiapan investasi', () => {
  const data = dataLengkap();
  const m = susunModelCfo(data, HARI);
  const r = kesiapanInvestasi(m, data);

  it('setiap butir punya status; jumlah = total; tanpa skor', () => {
    expect(r.butir.length).toBeGreaterThanOrEqual(12);
    expect(r.jumlah.lengkap + r.jumlah.perlu_verifikasi + r.jumlah.tidak_lengkap).toBe(r.butir.length);
    expect(JSON.stringify(r)).not.toMatch(/skor|score/i);
  });

  it('status mengikuti pemeriksaan Data Quality terburuk', () => {
    const neraca = r.butir.find((b) => b.id === 'neraca')!;
    expect(neraca.cek.some((c) => c.id === 'ekuitas_plug')).toBe(true);
    expect(neraca.status).toBe('tidak_lengkap');
    const tutup = r.butir.find((b) => b.id === 'tutup_buku')!;
    expect(tutup.status).not.toBe('lengkap');
  });

  it('butir di luar sistem tidak pernah Complete dari data', () => {
    for (const id of ['legal', 'proyeksi']) expect(r.butir.find((b) => b.id === id)!.status).toBe('tidak_lengkap');
  });

  it('langkah berikutnya: hanya yang belum lengkap, maks 5, keputusan owner didahulukan', () => {
    expect(r.langkahBerikutnya.length).toBeLessThanOrEqual(5);
    expect(r.langkahBerikutnya.every((b) => b.status !== 'lengkap')).toBe(true);
    const iOwner = r.langkahBerikutnya.findIndex((b) => b.pelaksana === 'owner');
    const iSistem = r.langkahBerikutnya.findIndex((b) => b.pelaksana === 'sistem');
    if (iOwner >= 0 && iSistem >= 0) expect(iOwner).toBeLessThan(iSistem);
  });

  it('laporan mingguan WA memuat bagian kesiapan dan tetap ≤ 4000 karakter', () => {
    const w = teksBriefingMingguan(m, 'https://finance.haluoleo.id', undefined, r);
    expect(w).toContain('Kesiapan investasi');
    expect(w).toContain('https://finance.haluoleo.id/cfo/kesiapan-investasi');
    expect(w.length).toBeLessThanOrEqual(4000);
    expect(barisKesiapanWa(r, 'u').join('\n')).not.toContain('Pak Avi');
  });
});

describe('kunci periode (Tahap 2a)', () => {
  it('tanpa data fin_periode: teks lama; dengan data: bulan lampau belum ditutup terdaftar', () => {
    const d = dataLengkap();
    const m = susunModelCfo(d, HARI);
    expect(cekKualitasData(m, d).cek.find((c) => c.id === 'kunci_periode')!.isi).toContain('Belum ada kunci periode');
    const bulanJurnal = [...new Set(d.jurnal_bulanan.map((j) => j.bulan))].filter((b) => b < HARI.slice(0, 7)).sort();
    const d2 = { ...d, fin_periode: [] };
    const c2 = cekKualitasData(m, d2).cek.find((c) => c.id === 'kunci_periode')!;
    expect(c2.status).toBe(bulanJurnal.length ? 'perlu_verifikasi' : 'lengkap');
    const d3 = { ...d, fin_periode: bulanJurnal.map((periode) => ({ periode, status: 'ditutup' as const, ditutup_pada: null })) };
    expect(cekKualitasData(m, d3).cek.find((c) => c.id === 'kunci_periode')!.status).toBe('lengkap');
    const t = kesiapanInvestasi(m, d3).butir.find((b) => b.id === 'tutup_buku')!;
    expect(t.bukti?.href).toBe('/cfo/buku-besar');
  });
});
