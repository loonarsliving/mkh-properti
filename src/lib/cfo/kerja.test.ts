import { describe, expect, it } from 'vitest';
import { teksBriefingHarian, teksBriefingMingguan, teksTutupBuku } from './briefing';
import { faktaCfo, jawabDeterministik } from './chat';
import { HARI, dataProduksi } from './fixture-uji';
import {
  KERJA_KOSONG,
  komentarVarians,
  kodeWa,
  rencanaPembayaran,
  reviuPengajuanL2,
  reviuPengajuanMkh,
  ringkasBulan,
  siapTutupBuku,
  susunKerjaCfo,
  type DataKerja,
  type PengajuanL2,
} from './kerja';
import { susunModelCfo } from './model';
import type { DataCfo } from './tipe';

function p(id: number, over: Partial<PengajuanL2>): PengajuanL2 {
  return {
    id, kelompok: null, kategori: 'material', unit_id: 1, nominal: 1_000_000, deskripsi: 'Semen 10 sak', toko: 'TB Maju',
    status: 'menunggu', pakai_buffer: false, melewati_buffer: false, saldo_c_kurang: true, unit_belum_terdanai: true,
    borongan_id: null, minggu_ke: null, retensi: false, diajukan_oleh: 'Vando', dibuat_pada: '2026-10-17T03:00:00Z', diputuskan_pada: null,
    ...over,
  };
}

/** Data produksi + 2 unit sudah terjual (BANYU-06, AVARA-06) tanpa jatuh tempo, seperti di produksi. */
function dataDenganPenjualan(): DataCfo {
  const d = dataProduksi();
  d.l2_unit[5] = { ...d.l2_unit[5], status: 'dp', nama_pembeli: 'Adijana', total_dibayar: 215_000_000, sisa_pelunasan: 205_000_000, jatuh_tempo: null };
  d.l2_unit[11] = { ...d.l2_unit[11], status: 'dp', nama_pembeli: 'Susanto August Satria', total_dibayar: 210_000_000, sisa_pelunasan: 210_000_000, jatuh_tempo: null };
  return d;
}

function kerjaProduksi(): DataKerja {
  return {
    ...KERJA_KOSONG,
    rekening_terisi: { A: false, B: false, C: false, D: false },
    alokasi_menunggu: [
      { id: 3, receipt_id: 2, ke_rekening: 'B', nominal: 38_400_000, tanggal: '2026-09-15', unit: 'BANYU-06', jenis: 'dp' },
      { id: 5, receipt_id: 4, ke_rekening: 'C', nominal: 166_600_000, tanggal: '2026-10-27', unit: 'AVARA-06', jenis: 'dp' },
    ],
    l2_pengajuan: [
      // M-27: cicilan utang toko yang sudah disetujui, dibagi ke unit 1–6
      ...[1, 2, 3, 4, 5, 6].map((u) => p(40 + u, { kelompok: 'M-27', unit_id: u, nominal: 1_528_833, deskripsi: '⁠Cicilan TB Sedia Nurut — bahan kolektif, bagian unit ini', toko: 'TB Sedia Nurut 9.173.000' })),
      // M-30: belanja baru untuk AVARA-01 (belum terjual)
      p(60, { kelompok: 'M-30', unit_id: 1, nominal: 4_000_000, deskripsi: 'Keramik 20 dus', dibuat_pada: '2026-10-30T03:00:00Z' }),
      // M-31: upah borongan minggu ke-4
      p(61, { kelompok: 'M-31', kategori: 'tukang', unit_id: 2, nominal: 3_285_714, deskripsi: 'Upah minggu 4', toko: null, borongan_id: 1, minggu_ke: 4, dibuat_pada: '2026-10-31T03:00:00Z' }),
      // M-32 & M-33: dua pengajuan identik (input ganda)
      p(62, { kelompok: 'M-32', unit_id: 6, nominal: 2_500_000, deskripsi: 'Besi 10mm 20 btg', dibuat_pada: '2026-10-30T03:00:00Z' }),
      p(63, { kelompok: 'M-33', unit_id: 6, nominal: 2_500_000, deskripsi: 'Besi 10mm 20 btg', dibuat_pada: '2026-10-31T03:00:00Z' }),
      // M-34: melewati budget AVARA-06 (terjual) — terpakai 36,8 jt + 110 jt > budget+buffer 138 jt
      p(64, { kelompok: 'M-34', unit_id: 6, nominal: 110_000_000, deskripsi: 'Atap & rangka', dibuat_pada: '2026-10-31T03:00:00Z' }),
    ],
    mkh_pengajuan: [
      { id: 5, proyek: 'HO', tipe: 'bahan', nominal_teks: '1000000', supplier: null, keterangan: 'Beban Lain-lain - heksanto Ricky Sulaiman No Rek BNI : ••••', dibuat_pada: '2026-06-18T00:00:00Z' },
      { id: 6, proyek: 'HO', tipe: 'bahan', nominal_teks: '1000000', supplier: null, keterangan: 'Beban Lain-lain - Heksanto Ricky Sulaiman No Rek Bni : ••••', dibuat_pada: '2026-06-18T00:00:00Z' },
      { id: 110, proyek: 'HO', tipe: 'bahan', nominal_teks: '260.85', supplier: null, keterangan: 'Beban Lain-lain - id pelanggan indihome', dibuat_pada: '2026-10-25T00:00:00Z' },
      { id: 142, proyek: 'LL', tipe: 'komisi', nominal_teks: '23920000', supplier: null, keterangan: 'Fee marketing — Unit C3 — B', dibuat_pada: '2026-10-20T00:00:00Z' },
      { id: 173, proyek: 'LL', tipe: 'komisi', nominal_teks: '23920000', supplier: null, keterangan: 'Fee marketing — Unit C3 — S', dibuat_pada: '2026-10-21T00:00:00Z' },
      { id: 301, proyek: 'GCI', tipe: 'bahan', nominal_teks: '2500000', supplier: null, keterangan: 'Semen 50 sak', dibuat_pada: '2026-07-01T00:00:00Z' },
      { id: 302, proyek: 'AFP', tipe: 'bahan', nominal_teks: '1500000', supplier: null, keterangan: 'Pasir', dibuat_pada: '2026-07-02T00:00:00Z' },
      { id: 197, proyek: 'LL', tipe: 'bahan', nominal_teks: '3360000', supplier: null, keterangan: '•••• Bank jago A/N Yudha', dibuat_pada: '2026-10-28T00:00:00Z' },
    ],
  };
}

describe('reviu pengajuan Loonars 2', () => {
  const m = susunModelCfo(dataDenganPenjualan(), HARI);
  const r = Object.fromEntries(reviuPengajuanL2(m, kerjaProduksi()).map((x) => [x.kelompok, x]));

  it('cicilan utang toko yang sudah disetujui → SETUJUI walau unit belum terjual', () => {
    expect(r['M-27'].putusan).toBe('SETUJUI');
    expect(r['M-27'].total).toBe(6 * 1_528_833);
    expect(r['M-27'].umurHari).toBe(15);
    expect(r['M-27'].alasan.join(' ')).toMatch(/menunggu 15 hari/);
  });

  it('belanja baru untuk unit belum terjual → TAHAN (menambah talangan)', () => {
    expect(r['M-30'].putusan).toBe('TAHAN');
    expect(r['M-30'].alasan[0]).toMatch(/belum terjual/);
  });

  it('upah borongan terjadwal → SETUJUI', () => {
    expect(r['M-31'].putusan).toBe('SETUJUI');
  });

  it('pengajuan identik → CEK DOBEL di kedua kelompok', () => {
    expect(r['M-32'].putusan).toBe('CEK_DOBEL');
    expect(r['M-33'].putusan).toBe('CEK_DOBEL');
  });

  it('melewati budget + buffer → TAHAN dengan rincian angka', () => {
    expect(r['M-34'].putusan).toBe('TAHAN');
    expect(r['M-34'].alasan[0]).toMatch(/AVARA-06/);
  });

  it('kas C tidak cukup → disebut kebutuhan talangan', () => {
    expect(r['M-27'].butuhTalangan).toBeGreaterThan(0);
    expect(kodeWa('M-27')).toBe('M-27');
    expect(kodeWa('#43')).toBe('L2-43');
  });
});

describe('reviu antrean pengajuan MKH', () => {
  const r = Object.fromEntries(reviuPengajuanMkh(kerjaProduksi(), HARI).map((x) => [x.id, x]));

  it('mendeteksi input ganda & dua klaim fee unit yang sama', () => {
    expect(r[5].putusan).toBe('CEK_DOBEL');
    expect(r[5].pasangan).toEqual([6]);
    expect(r[142].putusan).toBe('CEK_DOBEL');
    expect(r[142].alasan[0]).toMatch(/unit C3/);
  });

  it('nominal pecahan ditandai; antrean > 30 hari ditandai basi', () => {
    expect(r[110].putusan).toBe('NOMINAL_JANGGAL');
    expect(r[5].alasan.join(' ')).toMatch(/Menunggu 136 hari/);
    expect(r[197].putusan).toBe('PROSES');
  });

  it('pengajuan proyek yang dikunci (1 Nov 2026) → DIKUNCI, bukan basi', () => {
    expect(r[301].putusan).toBe('DIKUNCI');
    expect(r[302].putusan).toBe('DIKUNCI');
    expect(r[301].alasan[0]).toMatch(/GCI dikunci sejak 1 Nov 2026/);
  });
});

describe('daftar tindakan CFO', () => {
  const m = susunModelCfo(dataDenganPenjualan(), HARI);
  const kerja = susunKerjaCfo(m, kerjaProduksi());
  const kunci = kerja.tindakan.map((t) => t.kunci);

  it('menghasilkan tugas konkret untuk temuan produksi', () => {
    expect(kunci).toContain('l2_rekening_belum_diisi');
    expect(kunci).toContain('l2_konfirmasi_alokasi:2-4');
    expect(kunci).toContain('l2_jatuh_tempo_kosong:AVARA-06-BANYU-06');
    expect(kunci).toContain('l2_putuskan:M-30');
    expect(kunci).toContain('l1_catat_saldo_villa');
    // utang bank AFP: proyek dikunci → di luar lingkup, tidak jadi tindakan
    expect(kunci).not.toContain('utang_bank:1');
    expect(kunci).toContain('mkh_pengajuan_proyek_dikunci');
    expect(kerja.tindakan.find((t) => t.kunci === 'mkh_pengajuan_proyek_dikunci')!.nilai).toBe(4_000_000);
    expect(kunci.some((k) => k.startsWith('mkh_cek_dobel:'))).toBe(true);
    expect(kunci).toContain('mkh_antrean_basi');
  });

  it('kunci unik, tenggat sesuai tingkat, instruksi WA memakai kode yang dikenali', () => {
    expect(new Set(kunci).size).toBe(kunci.length);
    const rek = kerja.tindakan.find((t) => t.kunci === 'l2_rekening_belum_diisi')!;
    expect(rek.tenggat).toBe('2026-11-04');
    const m30 = kerja.tindakan.find((t) => t.kunci === 'l2_putuskan:M-30')!;
    expect(m30.langkah).toContain('"setujui M-30"');
  });

  it('kondisi teratasi → tindakan tidak lagi dihasilkan (akan ditutup otomatis oleh sinkron)', () => {
    const k = kerjaProduksi();
    k.rekening_terisi = { A: true, B: true, C: true, D: true };
    k.alokasi_menunggu = [];
    const kunci2 = susunKerjaCfo(m, k).tindakan.map((t) => t.kunci);
    expect(kunci2).not.toContain('l2_rekening_belum_diisi');
    expect(kunci2.some((x) => x.startsWith('l2_konfirmasi_alokasi'))).toBe(false);
  });
});

describe('rencana pembayaran minggu ini', () => {
  const m = susunModelCfo(dataDenganPenjualan(), HARI);
  const reviu = reviuPengajuanL2(m, kerjaProduksi());
  const r = rencanaPembayaran(m, reviu);

  it('tidak melebihi kas di atas kas minimum', () => {
    expect(r.danaTersedia).toBe(Math.max(0, m.kasTotal - m.kasMinimum));
    expect(r.totalBayar).toBeLessThanOrEqual(r.danaTersedia);
    expect(r.sisa).toBe(r.danaTersedia - r.totalBayar);
  });

  it('pengajuan TAHAN / CEK DOBEL tidak dijadwalkan bayar', () => {
    const ditunda = r.tunda.map((t) => t.id);
    expect(ditunda).toContain('kelompok:M-30');
    expect(ditunda).toContain('kelompok:M-32');
    expect(r.bayar.map((b) => b.id)).toContain('kelompok:M-31');
  });
});

describe('tutup buku bulanan', () => {
  it('menunggu tanggal 2 dan laporan villa final; tidak menutup dua kali', () => {
    const m1 = susunModelCfo(dataProduksi(), '2026-11-01');
    expect(siapTutupBuku(m1, KERJA_KOSONG)).toBeNull();
    const m2 = susunModelCfo(dataProduksi(), '2026-11-02');
    expect(siapTutupBuku(m2, KERJA_KOSONG)).toBe('2026-10');
    const sudah: DataKerja = { ...KERJA_KOSONG, laporan_bulanan: [{ periode: '2026-10-01', komentar: 'x', data: ringkasBulan(m2, '2026-10'), dibuat_oleh: 'sistem', dibuat_pada: '', hash: '' }] };
    expect(siapTutupBuku(m2, sudah)).toBeNull();
    const d = dataProduksi();
    d.l1_laporan[0].status = 'sementara';
    expect(siapTutupBuku(susunModelCfo(d, '2026-11-03'), KERJA_KOSONG)).toBeNull();
    expect(siapTutupBuku(susunModelCfo(d, '2026-11-06'), KERJA_KOSONG)).toBe('2026-10');
  });

  it('ringkasan memakai angka bulan itu & komentar varians membandingkan bulan lalu', () => {
    const m = susunModelCfo(dataProduksi(), '2026-11-02');
    const okt = ringkasBulan(m, '2026-10');
    expect(okt.l1!.revenue).toBe(155_084_926);
    expect(okt.l1!.ebitda).toBe(78_948_377);
    const sep = { ...okt, periode: '2026-09', l1: { ...okt.l1!, revenue: 100_000_000 } };
    const k = komentarVarians(okt, sep, []);
    expect(k).toMatch(/Revenue villa naik 55,1%/);
    expect(komentarVarians(okt, null, [])).toMatch(/belum ada bulan pembanding/);
    expect(teksTutupBuku(okt, k, 'https://finance.haluoleo.id').length).toBeLessThanOrEqual(4000);
  });
});

describe('briefing & chat memakai hasil kerja CFO', () => {
  const m = susunModelCfo(dataDenganPenjualan(), HARI);
  const kerja = susunKerjaCfo(m, kerjaProduksi());

  it('briefing harian memuat reviu & tindakan; mingguan memuat rencana bayar', () => {
    const h = teksBriefingHarian(m, 'https://finance.haluoleo.id', kerja);
    expect(h).toContain('Reviu pengajuan oleh AI CFO');
    expect(h).toContain('Tindakan CFO terbuka');
    expect(h.length).toBeLessThanOrEqual(4000);
    const w = teksBriefingMingguan(m, 'https://finance.haluoleo.id', kerja);
    expect(w).toContain('Rencana bayar minggu ini');
    expect(w.length).toBeLessThanOrEqual(4000);
  });

  it('chat menjawab pertanyaan pengajuan & tugas dari hasil kerja', () => {
    const fakta = faktaCfo(m, kerja);
    expect(jawabDeterministik('pengajuan mana yang sebaiknya disetujui?', m, fakta).niat).toBe('reviu');
    const t = jawabDeterministik('apa yang harus saya kerjakan hari ini?', m, fakta);
    expect(t.niat).toBe('tindakan');
    expect(t.jawaban).toMatch(/rekening/i);
    expect(jawabDeterministik('rencana bayar minggu ini?', m, fakta).niat).toBe('rencana_bayar');
  });
});
