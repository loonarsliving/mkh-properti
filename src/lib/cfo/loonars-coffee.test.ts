import { describe, expect, it } from 'vitest';
import { teksBriefingHarian } from './briefing';
import { faktaCfo, jawabDeterministik } from './chat';
import { HARI, dataProduksi } from './fixture-uji';
import { KERJA_KOSONG, susunKerjaCfo } from './kerja';
import { laporanLoonars2 } from './loonars2';
import { susunModelCfo } from './model';
import type { DataCfo } from './tipe';

/** Produksi 2026-11-01: jurnal LC + snapshot proyek Loonars Coffee dari MK Connect. */
function dataDenganCoffee(snapshot = true): DataCfo {
  const d = dataProduksi();
  d.jurnal_bulanan.push(
    { proyek: 'LC', akun: '5-1001', bulan: '2026-10', d: 90_871_950, k: 0, n: 22 },
    { proyek: 'LC', akun: '6-1007', bulan: '2026-09', d: 30_409_000, k: 0, n: 12 },
    { proyek: 'LC', akun: '2-1003', bulan: '2026-10', d: 0, k: 121_280_950, n: 34 },
  );
  if (snapshot) {
    d.snapshot.push({
      sumber: 'svcmyb', jenis: 'proyek_konstruksi', id: 'ffd640ae',
      data: {
        nama: 'Loonars Coffee — Yogyakarta (8.5m x 6m, 51m²)', cabang: 'Loonars Coffee', status: 'active',
        budget_total: 133_387_454, budget_material: 58_387_454, budget_tenaga: 75_000_000,
        realisasi: { material_purchase: 74_513_950, other_expense: 34_889_000, contractor_payment: 75_000_000 },
        komitmen: {}, utang_belum_lunas: 6_657_850, utang_lunas: 102_745_100, biaya_terakhir: '2026-10-14',
      },
      diterima_pada: HARI, sumber_diubah_pada: null,
    });
    d.sync_log.push({ sumber: 'svcmyb', jenis: 'proyek_konstruksi', jumlah: 1, baru: 1, berubah: 0, sama: 0, nonaktif: 0, lengkap: true, galat: null, diterima_pada: `${HARI}T04:00:00Z` });
  }
  return d;
}

describe('Loonars Coffee dibiayai Loonars 2', () => {
  it('masuk laporan Loonars 2: budget vs realisasi dari MK Connect', () => {
    const l2 = laporanLoonars2(dataDenganCoffee());
    expect(l2.proyek).toHaveLength(1);
    const p = l2.proyek[0];
    expect(p.nama).toBe('Loonars Coffee');
    expect(p.kodeJurnal).toBe('LC');
    expect(p.realisasiTotal).toBe(184_402_950);
    expect(p.realisasiMaterial).toBe(74_513_950);
    expect(p.realisasiTenaga).toBe(75_000_000);
    expect(p.realisasiLain).toBe(34_889_000);
    expect(p.selisihBudget).toBe(184_402_950 - 133_387_454);
    expect(Math.round(p.materialPct!)).toBe(128);
    expect(p.jurnal).toEqual({ biaya: 121_280_950, tenaga: 0, utangToko: 121_280_950, baris: 68 });
  });

  it('ikut belanja konstruksi gabungan, neraca (aset & utang), dan tetap seimbang', () => {
    const tanpa = laporanLoonars2(dataProduksi());
    const l2 = laporanLoonars2(dataDenganCoffee());
    expect(l2.belanjaKonstruksiGabungan).toBe(tanpa.biayaKonstruksiKas + 184_402_950);
    expect(l2.neraca.asetProyekLain).toBe(184_402_950);
    expect(l2.neraca.utangProyekLain).toBe(6_657_850);
    expect(l2.neraca.totalAset).toBe(l2.neraca.totalLiabilitas + l2.neraca.ekuitasTersirat);
    expect(l2.neraca.totalAset - tanpa.neraca.totalAset).toBe(184_402_950);
  });

  it('konsolidasi, kewajiban, peringatan lewat budget, tindakan, dan rekonsiliasi jurnal', () => {
    const m = susunModelCfo(dataDenganCoffee(), HARI);
    expect(m.konsolidasi.belanjaKonstruksiTotal).toBe(m.l2.belanjaKonstruksiGabungan);
    expect(m.kewajiban.some((k) => k.id === 'proyek_utang:ffd640ae' && k.nominal === 6_657_850 && k.lini === 'L2')).toBe(true);
    const over = m.peringatan.find((p) => p.id === 'l2_proyek_over:LC')!;
    expect(over.tingkat).toBe('tinggi');
    expect(over.judul).toMatch(/Loonars Coffee melewati budget Rp 51\.015\.496 \(138%/);
    const r = Object.fromEntries(m.rekonsiliasi.map((x) => [x.id, x]));
    expect(r['proyek_biaya:LC'].selisih).toBe(109_402_950 - 121_280_950);
    expect(r['proyek_tenaga:LC'].selisih).toBe(75_000_000);
    expect(r['proyek_utang:LC'].selisih).toBe(6_657_850 - 121_280_950);
    const kerja = susunKerjaCfo(m, KERJA_KOSONG);
    expect(kerja.tindakan.some((t) => t.kunci === 'l2_proyek_over:LC')).toBe(true);
    expect(kerja.tindakan.some((t) => t.kunci === 'rekon:proyek_tenaga:LC')).toBe(true);
  });

  it('briefing & chat menyebut Loonars Coffee', () => {
    const m = susunModelCfo(dataDenganCoffee(), HARI);
    expect(teksBriefingHarian(m, 'u')).toMatch(/Loonars Coffee \(dibiayai L2\): realisasi Rp 184,4 jt dari budget Rp 133,4 jt — ⚠️ lewat Rp 51,0 jt/);
    const j = jawabDeterministik('berapa biaya loonars coffee?', m, faktaCfo(m));
    expect(j.niat).toBe('loonars2');
    expect(j.jawaban).toContain('Loonars Coffee: realisasi');
  });

  it('tanpa snapshot MK Connect tetap tampil dari jurnal LC (tidak hilang dari laporan)', () => {
    const l2 = laporanLoonars2(dataDenganCoffee(false));
    expect(l2.proyek).toHaveLength(1);
    expect(l2.proyek[0].sumber).toBe('jurnal');
    expect(l2.proyek[0].realisasiTotal).toBe(121_280_950);
    expect(l2.proyek[0].budgetTotal).toBeNull();
    expect(l2.neraca.utangProyekLain).toBe(121_280_950);
  });
});
