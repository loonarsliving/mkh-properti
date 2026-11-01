import { describe, expect, it } from 'vitest';
import { simulasi, SKENARIO } from './arus-kas';
import { teksBriefingHarian, teksBriefingMingguan, teksPeringatanKritis } from './briefing';
import { bacaNominal, faktaCfo, jawabDeterministik, validasiJawaban } from './chat';
import { prioritaskan, type Kewajiban } from './kewajiban';
import { deteksiAbnormal } from './kontrol';
import { laporanLoonars1 } from './loonars1';
import { laporanLoonars2 } from './loonars2';
import { susunModelCfo } from './model';
import { evaluasiKeputusan, simulasiRestrukturisasi } from './penantang';
import type { DataCfo } from './tipe';

import { HARI, dataProduksi } from './fixture-uji';

describe('Loonars 1 — hospitality', () => {
  const l1 = laporanLoonars1(dataProduksi(), HARI);
  const okt = l1.bulan.find((b) => b.bulan === '2026-10')!;

  it('menyusun laba rugi persis dari laporan villa (EBITDA = bersih − COGS − OPEX)', () => {
    expect(okt.revenue).toBeCloseTo(155_084_925.75, 2);
    expect(okt.costOfRevenue).toBeCloseTo(38_092_576.75 + 27_543_972, 2);
    expect(okt.ebitda).toBe(78_948_377);
    expect(okt.netProfit).toBe(okt.ebitda);
    expect(okt.payroll).toBe(10_500_000);
  });

  it('menghitung ADR & RevPAR dari malam terjual/tersedia', () => {
    expect(okt.adr).toBeCloseTo(155_084_925.75 / 271, 4);
    expect(okt.revpar).toBeCloseTo(155_084_925.75 / 403, 4);
  });

  it('bagian MKH bulan berjalan negatif bila top-up jaminan > bagian pengelola', () => {
    expect(l1.terakhir!.bulan).toBe('2026-11');
    expect(l1.terakhir!.bagianMkhBersih).toBeCloseTo(747_493.8 - 4_865_834.45, 2);
    expect(l1.terakhirFinal!.bulan).toBe('2026-10');
  });

  it('kas villa dinyatakan tidak tersedia, bukan nol', () => {
    expect(l1.neraca.kas).toBeNull();
    expect(l1.neraca.piutangOta).toBeNull();
  });
});

describe('Loonars 2 — developer & konstruksi', () => {
  it('belum ada penjualan: kontrak & cash-in nol, konstruksi dibiayai talangan', () => {
    const l2 = laporanLoonars2(dataProduksi());
    expect(l2.unitTerjual).toBe(0);
    expect(l2.nilaiKontrak).toBe(0);
    expect(l2.cashInInvestor).toBe(0);
    expect(l2.danaTalangan).toBe(123_992_000);
    expect(l2.kasRekeningPositif).toBe(0);
    expect(l2.unit.filter((u) => u.dibangunTanpaPembeli).map((u) => u.kode)).toEqual([
      'AVARA-01', 'AVARA-02', 'AVARA-03', 'AVARA-04', 'AVARA-05', 'AVARA-06', 'BANYU-01',
    ]);
    // utang toko = disetujui − dibayar (cicilan yang masih diproses tetap utang)
    expect(l2.utangToko).toBe(8_978_000 + (134_646_500 - 44_173_000));
  });

  it('pembayaran investor sebelum serah terima = uang muka, bukan pendapatan', () => {
    const d = dataProduksi();
    d.l2_unit[11] = { ...d.l2_unit[11], status: 'dp', nama_pembeli: 'Investor A', total_dibayar: 215_000_000, sisa_pelunasan: 205_000_000, jatuh_tempo: '2026-12-15' };
    d.l2_penerimaan = [
      { id: 1, unit_id: 12, jenis: 'booking', nominal: 5_000_000, tanggal: '2026-10-01', status: 'aktif' },
      { id: 2, unit_id: 12, jenis: 'dp', nominal: 210_000_000, tanggal: '2026-10-05', status: 'aktif' },
      { id: 3, unit_id: 12, jenis: 'dp', nominal: 999, tanggal: '2026-10-06', status: 'batal' },
    ];
    const l2 = laporanLoonars2(d);
    expect(l2.nilaiKontrak).toBe(420_000_000);
    expect(l2.cashInInvestor).toBe(215_000_000);
    expect(l2.piutangKontrak).toBe(205_000_000);
    expect(l2.uangMukaInvestor).toBe(215_000_000);
    expect(l2.pendapatanDiakui).toBe(0);
    expect(l2.neraca.uangMukaInvestor).toBe(215_000_000);

    d.l2_unit[11] = { ...d.l2_unit[11], status: 'lunas', status_bangun: 'serah_terima', terpakai_konstruksi: 118_000_000, sisa_pelunasan: 0 };
    const l2b = laporanLoonars2(d);
    expect(l2b.pendapatanDiakui).toBe(420_000_000);
    expect(l2b.hppDiakui).toBe(118_000_000);
    expect(l2b.uangMukaInvestor).toBe(0);
  });

  it('proyeksi laba proyek memakai biaya terbesar (budget vs aktual), fee, dan sewa tanah', () => {
    const l2 = laporanLoonars2(dataProduksi());
    const pendapatan = 12 * 420_000_000 + 5 * 600_000_000;
    const biaya = 12 * 120_000_000 + 5 * 160_000_000 + 2_768_000;
    const fee = 12 * 33_600_000 + 5 * 48_000_000;
    expect(l2.proyeksi.laba).toBe(pendapatan - biaya - fee - 1_000_000_000);
  });

  it('neraca L2 seimbang (aset = liabilitas + ekuitas tersirat)', () => {
    const n = laporanLoonars2(dataProduksi()).neraca;
    expect(n.totalAset).toBe(n.totalLiabilitas + n.ekuitasTersirat);
  });
});

describe('model konsolidasi & kontrol', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('kas total tidak memasukkan saldo negatif rekening C maupun kas villa yang tidak tersedia', () => {
    const ll = 1_298_000_000 - 71_221_750 + 610_000_000 - 1_027_042_297;
    expect(m.kas.find((k) => k.id === 'll_buku_besar')!.nilai).toBe(ll);
    expect(m.kasTotal).toBe(ll);
    expect(m.kas.find((k) => k.id === 'l1_villa')!.dipakaiDalamTotal).toBe(false);
  });

  it('memisahkan cash-in investor dari pendapatan operasional', () => {
    expect(m.konsolidasi.pendapatanOperasionalBulanIni).toBeCloseTo(5_889_243.15, 2);
    expect(m.konsolidasi.cashInInvestor).toBe(0);
  });

  it('memberi peringatan dana talangan, unit tanpa pembeli, dan utang bank jatuh tempo', () => {
    const ids = m.peringatan.map((p) => p.id);
    expect(ids).toContain('l2_dana_talangan');
    expect(ids.some((i) => i.startsWith('l2_bangun_tanpa_pembeli'))).toBe(true);
    // utang bank fixture milik AFP (dikunci 1 Nov 2026) → tidak diperingatkan
    expect(ids).not.toContain('utang_bank:1');
    expect(ids).toContain('l1_jaminan_rugi:2026-11');
    // urutan: kritis dulu
    const tingkat = m.peringatan.map((p) => p.tingkat);
    expect(tingkat.indexOf('kritis') === -1 || tingkat.indexOf('kritis') < tingkat.indexOf('sedang')).toBe(true);
  });

  it('rekonsiliasi talangan & jurnal cocok; data siteplan belum bisa dicek tanpa snapshot', () => {
    const r = Object.fromEntries(m.rekonsiliasi.map((x) => [x.id, x.status]));
    expect(r.l2_talangan).toBe('cocok');
    expect(r.l1_channel_kotor).toBe('cocok');
    expect(r.l1_channel_bersih).toBe('cocok');
    expect(r.l2_unit_terjual).toBe('tidak_bisa_dicek');
  });

  it('rekonsiliasi mendeteksi unit terjual di siteplan yang belum tercatat di modul Loonars 2', () => {
    const d = dataProduksi();
    d.snapshot = [
      { sumber: 'svcmyb', jenis: 'investor_penjualan', id: 'p1', data: { proyek: 'LNR2', blok: 'BANYU-06', harga: 420_000_000, booking_fee: 5_000_000, dp: 205_000_000, status: 'verified' }, diterima_pada: HARI, sumber_diubah_pada: null },
      { sumber: 'svcmyb', jenis: 'investor_penjualan', id: 'p2', data: { proyek: 'LNR2', blok: 'BANYU-05', harga: 420_000_000, booking_fee: 5_000_000, dp: 210_000_000, status: 'verified' }, diterima_pada: HARI, sumber_diubah_pada: null },
    ];
    d.sync_log = [{ sumber: 'svcmyb', jenis: 'investor_penjualan', jumlah: 2, baru: 2, berubah: 0, sama: 0, nonaktif: 0, lengkap: true, galat: null, diterima_pada: `${HARI}T04:30:00Z` }];
    const mm = susunModelCfo(d, HARI);
    const r = Object.fromEntries(mm.rekonsiliasi.map((x) => [x.id, x]));
    expect(r.l2_unit_terjual.status).toBe('selisih');
    expect(r.l2_unit_terjual.selisih).toBe(2);
    expect(r.l2_nilai_kontrak.selisih).toBe(840_000_000);
    expect(r.l2_cash_in.selisih).toBe(425_000_000);
    expect(mm.peringatan.some((p) => p.id === 'rekon:l2_cash_in')).toBe(true);
  });

  it('kewajiban grup (utang bank, refund) tidak ikut forecast kas Loonars', () => {
    expect(m.arusKas.input.peristiwa.some((p) => p.jenis === 'utang_bank')).toBe(false);
  });

  it('proyek dikunci (AFP): utang banknya keluar dari laporan tetapi tetap tercatat di arsip', () => {
    expect(m.kewajiban.some((k) => k.jenis === 'utang_bank')).toBe(false);
    expect(m.kewajibanDiLuarLingkup.daftar.map((k) => k.id)).toEqual(['bank:1']);
    expect(m.kewajibanDiLuarLingkup.total).toBe(1_490_000_000);
    expect(m.kewajibanDiLuarLingkup.sejak).toBe('2026-11-01');
  });

  it('utang bank proyek aktif tetap dilaporkan & diperingatkan', () => {
    const d = dataProduksi();
    d.utang_bank = d.utang_bank.map((u) => ({ ...u, proyek: 'LL' }));
    const mm = susunModelCfo(d, HARI);
    expect(mm.kewajiban.some((k) => k.id === 'bank:1')).toBe(true);
    expect(mm.peringatan.some((p) => p.id === 'utang_bank:1')).toBe(true);
    expect(mm.kewajibanDiLuarLingkup.daftar).toEqual([]);
  });
});

describe('arus kas & skenario', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('deterministik: masukan sama → hasil sama', () => {
    const a = susunModelCfo(dataProduksi(), HARI);
    expect(a.arusKas.skenario.normal.saldoMin).toBe(m.arusKas.skenario.normal.saldoMin);
    expect(a.arusKas.skenario.normal.mingguan).toEqual(m.arusKas.skenario.normal.mingguan);
  });

  it('pesimis ≤ normal ≤ optimis untuk saldo terendah', () => {
    const s = m.arusKas.skenario;
    expect(s.pesimis.saldoMin).toBeLessThanOrEqual(s.normal.saldoMin);
    expect(s.normal.saldoMin).toBeLessThanOrEqual(s.optimis.saldoMin);
  });

  it('13 minggu, saldo akhir minggu = saldo awal + Σ bersih', () => {
    const n = m.arusKas.skenario.normal;
    expect(n.mingguan).toHaveLength(13);
    const total = n.mingguan.reduce((s, w) => s + w.bersih, 0);
    expect(Math.abs(n.mingguan[12].saldoAkhir - (m.kasTotal + total))).toBeLessThanOrEqual(13);
  });

  it('mendeteksi tanggal & besar defisit', () => {
    const hasil = simulasi(
      { hariIni: HARI, kasAwal: 100, kasMinimum: 50, l1MasukHarian: 0, l1KeluarHarian: 0, konstruksiPerHari: 0, konstruksiSisaBudget: 0,
        peristiwa: [{ tanggal: '2026-11-10', nominal: -300, jenis: 'x', lini: 'L2', ket: 'uji', sumber: { tabel: 'uji' } }] },
      'normal',
    );
    expect(hasil.tanggalDefisit).toBe('2026-11-10');
    expect(hasil.besarDefisit).toBe(200);
    expect(hasil.kebutuhanDana).toBe(250);
  });

  it('pesimis menunda tagihan investor; tunggakan tidak masuk horizon', () => {
    const base = { hariIni: HARI, kasAwal: 0, kasMinimum: 0, l1MasukHarian: 0, l1KeluarHarian: 0, konstruksiPerHari: 0, konstruksiSisaBudget: 0 };
    const tagihan = { nominal: 1000, jenis: 'tagihan_investor', lini: 'L2' as const, ket: 'uji', sumber: { tabel: 'uji' } };
    const r = simulasi({ ...base, peristiwa: [{ ...tagihan, tanggal: '2026-11-05' }] }, 'pesimis');
    expect(r.rincianPeristiwa[0].tanggalEfektif).toBe('2026-12-17');
    const lewat = simulasi({ ...base, peristiwa: [{ ...tagihan, tanggal: '2026-10-01' }] }, 'pesimis');
    expect(lewat.rincianPeristiwa).toHaveLength(0);
    expect(SKENARIO.normal.tunggakanMasukHari).toBe(21);
  });

  it('simulasi restrukturisasi: menunda utang toko tidak memperburuk saldo terendah', () => {
    const r = simulasiRestrukturisasi(m, ['utang_supplier'], 28);
    const n = r.find((x) => x.skenario === 'normal')!;
    expect(n.saldoMinSesudah).toBeGreaterThanOrEqual(n.saldoMinSebelum);
  });
});

describe('prioritas kewajiban', () => {
  it('pajak & bank lewat jatuh tempo didahulukan, talangan owner paling akhir', () => {
    const k = (id: string, jenis: Kewajiban['jenis'], jatuhTempo: string | null, nominal = 1000): Kewajiban => ({
      id, lini: 'L2', jenis, pihak: id, nominal, jatuhTempo, jatuhTempoAsumsi: false, dasar: '', sumber: { tabel: 'uji' },
    });
    const hasil = prioritaskan(
      [k('owner', 'utang_owner', null), k('toko', 'utang_supplier', '2026-11-05'), k('pajak', 'pajak', '2026-11-15'), k('bank', 'utang_bank', '2026-10-20')],
      HARI,
      2500,
    );
    expect(hasil.map((x) => x.id)).toEqual(['bank', 'pajak', 'toko', 'owner']);
    expect(hasil.map((x) => x.tertutupKas)).toEqual([true, true, false, false]);
    expect(hasil[0].status).toBe('lewat');
  });
});

describe('CEO challenger', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('menolak pengeluaran yang membuat kas defisit dan memberi alternatif terhitung', () => {
    const ev = evaluasiKeputusan(m, { nominal: 5_000_000_000, lini: 'Grup', ket: 'Beli tanah baru' });
    expect(ev.putusan).toBe('tolak');
    expect(ev.alternatif.length).toBeGreaterThan(0);
    expect(ev.maksAmanSekarang).toBeLessThan(5_000_000_000);
  });

  it('pengeluaran L2 kecil tetap "waspada" selama konstruksi memakai dana talangan', () => {
    const ev = evaluasiKeputusan(m, { nominal: 1_000_000, lini: 'L2', ket: 'tambah material unit' });
    expect(ev.putusan).not.toBe('aman');
    expect(ev.alasan.join(' ')).toMatch(/talangan/);
  });
});

describe('AI CFO chat', () => {
  const m = susunModelCfo(dataProduksi(), HARI);
  const fakta = faktaCfo(m);

  it('membaca nominal bahasa sehari-hari', () => {
    expect(bacaNominal('mau beli mobil 350 jt')).toBe(350_000_000);
    expect(bacaNominal('ekspansi 1,2 M')).toBe(1_200_000_000);
    expect(bacaNominal('bayar Rp 25.000.000')).toBe(25_000_000);
    expect(bacaNominal('berapa kas?')).toBeNull();
  });

  it('pertanyaan keputusan dijawab dengan evaluasi (CEO challenger)', () => {
    const j = jawabDeterministik('Saya mau beli tanah baru 3 M bulan ini, boleh?', m, fakta);
    expect(j.niat).toBe('evaluasi_keputusan');
    expect(j.evaluasi?.putusan).toBe('tolak');
    expect(j.jawaban).toMatch(/TIDAK MENYARANKAN/);
  });

  it('jawaban data menyertakan rujukan fakta', () => {
    const j = jawabDeterministik('berapa EBITDA villa bulan lalu?', m, fakta);
    expect(j.niat).toBe('loonars1');
    expect(j.jawaban).toMatch(/\[F\d+\]/);
    expect(j.jawaban).toContain('Rp 78.948.377');
  });

  it('menolak jawaban AI yang memuat angka karangan, menerima yang sesuai fakta', () => {
    const dasar = jawabDeterministik('kas', m, fakta);
    const kasTeks = fakta[0].teks;
    expect(validasiJawaban(`Kas Anda ${kasTeks} [F1].`, fakta, dasar)).toBe(true);
    expect(validasiJawaban('Dana talangan sekitar Rp 124 jt [F50].', fakta, dasar)).toBe(true);
    expect(validasiJawaban('Kas Anda Rp 987.654.321.', fakta, dasar)).toBe(false);
    expect(validasiJawaban('Laba bulan depan Rp 5 M.', fakta, dasar)).toBe(false);
  });
});

describe('briefing WhatsApp & deteksi abnormal', () => {
  const m = susunModelCfo(dataProduksi(), HARI);

  it('briefing harian & mingguan ≤ 4000 karakter dan memuat kas', () => {
    const h = teksBriefingHarian(m, 'https://finance.haluoleo.id');
    const w = teksBriefingMingguan(m, 'https://finance.haluoleo.id');
    expect(h.length).toBeLessThanOrEqual(4000);
    expect(w.length).toBeLessThanOrEqual(4000);
    expect(h).toContain('Kas tercatat');
    expect(h).toContain('https://finance.haluoleo.id/cfo');
  });

  it('peringatan kritis punya kunci stabil (anti kirim ganda)', () => {
    const a = teksPeringatanKritis(m, 'u');
    const b = teksPeringatanKritis(susunModelCfo(dataProduksi(), HARI), 'u');
    if (a) {
      expect(a.kunci).toBe(b!.kunci);
      expect(a.kunci).toMatch(/^[A-Za-z0-9:_.-]{1,120}$/);
    }
  });

  it('mendeteksi pengeluaran kembar', () => {
    const d = dataProduksi();
    d.l2_pengeluaran.push({ ...d.l2_pengeluaran[5], id: 999 });
    expect(deteksiAbnormal(d).some((x) => x.id.startsWith('kembar:') && x.id.includes('999'))).toBe(true);
  });
});

describe('kas villa (Loonars 1): saldo tercatat + mutasi sesudahnya', () => {
  function denganSaldo(): DataCfo {
    const d = dataProduksi();
    d.saldo_rekening = [{ lini: 'L1', rekening: 'BTN Villa', saldo: 40_000_000, per_tanggal: '2026-10-28', catatan: null, dicatat_oleh: 'cfo:o@u', dibuat_pada: '2026-10-28T03:00:00Z' }];
    const snap = (jenis: string, id: string, tanggal: string, nominal: number) => ({ sumber: 'svcmyb', jenis, id, data: { tanggal, nominal, jenis: 'ota' }, diterima_pada: HARI, sumber_diubah_pada: null });
    d.snapshot = [
      snap('villa_kas_masuk', 'ota:lama', '2026-10-27', 9_000_000), // sebelum tanggal saldo → sudah termasuk saldo
      snap('villa_kas_masuk', 'ota:1', '2026-10-29', 6_000_000),
      snap('villa_kas_masuk', 'web:2', '2026-10-30', 1_500_000),
      snap('villa_kas_keluar', 'biaya:3', '2026-10-31', 2_000_000),
    ];
    return d;
  }

  it('menghitung kas berjalan tanpa menghitung ulang mutasi sebelum tanggal saldo', () => {
    const l1 = laporanLoonars1(denganSaldo(), HARI);
    expect(l1.kas!.masukSesudah).toBe(7_500_000);
    expect(l1.kas!.keluarSesudah).toBe(2_000_000);
    expect(l1.kas!.kasBerjalan).toBe(45_500_000);
    expect(l1.kas!.umurHari).toBe(4);
    expect(l1.neraca.kas).toBe(45_500_000);
  });

  it('kas villa ikut posisi kas & forecast; tanpa saldo muncul peringatan untuk mencatat', () => {
    const tanpa = susunModelCfo(dataProduksi(), HARI);
    const dengan = susunModelCfo(denganSaldo(), HARI);
    expect(dengan.kasTotal - tanpa.kasTotal).toBe(45_500_000);
    expect(dengan.arusKas.input.kasAwal).toBe(dengan.kasTotal);
    expect(tanpa.peringatan.some((p) => p.id === 'l1_saldo_belum_dicatat')).toBe(true);
    expect(dengan.peringatan.some((p) => p.id === 'l1_saldo_belum_dicatat')).toBe(false);
  });

  it('saldo lebih dari 7 hari memicu peringatan usang', () => {
    const d = denganSaldo();
    d.saldo_rekening![0].per_tanggal = '2026-10-15';
    expect(susunModelCfo(d, HARI).peringatan.some((p) => p.id.startsWith('l1_saldo_usang'))).toBe(true);
  });
});
