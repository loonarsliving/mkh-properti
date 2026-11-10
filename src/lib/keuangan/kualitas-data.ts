/**
 * FINANCIAL REPORTING COMPLETENESS & DATA QUALITY WARNINGS.
 *
 * Indikator per area laporan: Complete / Incomplete / Needs Verification.
 * Sengaja TIDAK ada skor "siap investasi" — indikator ini hanya menunjukkan
 * apa yang sudah dan belum bisa dipertanggungjawabkan (permintaan owner).
 *
 * Pemeriksaan dihitung dari data (bukan teks tetap) bila datanya ada di
 * `cfo_ambil_data`; pemeriksaan struktural (mis. belum ada kunci periode)
 * merujuk temuan audit 2026-11-02 (docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md).
 */
import { COA } from '@/lib/master';
import type { ModelCfo } from '@/lib/cfo/model';
import type { DataCfo, Sumber } from '@/lib/cfo/tipe';
import { angka, bulat, hariDalamBulan, labelBulan, rp } from '@/lib/cfo/util';
import { neracaPengembanganL1 } from '@/lib/cfo/pengembangan-l1';
import type { Kelengkapan } from './status';

export type AreaLaporan = 'laba_rugi' | 'neraca' | 'arus_kas' | 'unit_ekonomi' | 'investor' | 'konsolidasi' | 'kontrol';

export const LABEL_AREA: Record<AreaLaporan, string> = {
  laba_rugi: 'Profit & Loss',
  neraca: 'Balance Sheet',
  arus_kas: 'Cash Flow',
  unit_ekonomi: 'Hospitality Unit Economics',
  investor: 'Investor Reporting',
  konsolidasi: 'Consolidation',
  kontrol: 'Controls & Integrity',
};

export interface CekKualitas {
  id: string;
  area: AreaLaporan;
  status: Kelengkapan;
  judul: string;
  isi: string;
  /** apa yang harus dilakukan agar menjadi Complete */
  tindakan: string;
  nilai?: number;
  /** rujukan temuan audit (F-n) / keputusan owner (D-n) */
  rujukan?: string;
  sumber: Sumber[];
}

export interface RingkasanKualitas {
  cek: CekKualitas[];
  perArea: { area: AreaLaporan; status: Kelengkapan; lengkap: number; verifikasi: number; tidakLengkap: number }[];
  jumlah: Record<Kelengkapan, number>;
}

const TINGKAT: Record<Kelengkapan, number> = { lengkap: 0, perlu_verifikasi: 1, tidak_lengkap: 2 };

export function cekKualitasData(m: ModelCfo, data: DataCfo): RingkasanKualitas {
  const cek: CekKualitas[] = [];
  const tambah = (c: CekKualitas) => cek.push(c);

  // ── Kontrol: debit = kredit per proyek per bulan (jurnal) ────────────────
  const grup = new Map<string, { d: number; k: number }>();
  for (const j of data.jurnal_bulanan) {
    const key = `${j.proyek ?? '-'}|${j.bulan}`;
    const g = grup.get(key) ?? { d: 0, k: 0 };
    g.d += angka(j.d);
    g.k += angka(j.k);
    grup.set(key, g);
  }
  const timpang = [...grup.entries()].filter(([, g]) => Math.abs(g.d - g.k) > 1);
  tambah({
    id: 'jurnal_seimbang',
    area: 'kontrol',
    status: timpang.length ? 'tidak_lengkap' : 'lengkap',
    judul: 'Validasi debit = kredit buku besar',
    isi: timpang.length
      ? `${timpang.length} kombinasi proyek/bulan tidak seimbang: ${timpang.slice(0, 5).map(([key, g]) => `${key.replace('|', ' ')} (selisih ${rp(g.d - g.k)})`).join('; ')}.`
      : `Seluruh ${grup.size} kombinasi proyek/bulan di jurnal seimbang (debit = kredit).`,
    tindakan: timpang.length ? 'Telusuri nomor transaksi yang tidak seimbang di Jurnal Umum.' : '—',
    sumber: [{ tabel: 'jurnal', ket: 'agregat per proyek/akun/bulan' }],
  });

  const coa = new Set(COA.map((a) => a.kode));
  const asing = [...new Set(data.jurnal_bulanan.map((j) => j.akun ?? '').filter((a) => a && !coa.has(a)))];
  tambah({
    id: 'akun_di_luar_coa',
    area: 'kontrol',
    status: asing.length ? 'perlu_verifikasi' : 'lengkap',
    judul: 'Akun jurnal terdaftar di COA',
    isi: asing.length ? `Akun di luar COA: ${asing.join(', ')}.` : 'Semua akun jurnal terdaftar di COA.',
    tindakan: asing.length ? 'Daftarkan atau petakan akun tersebut.' : '—',
    sumber: [{ tabel: 'jurnal' }],
  });

  // Kunci periode (Tahap 2a, migrasi 0069): bulan lampau yang berisi jurnal harus sudah ditutup.
  if (data.fin_periode) {
    const ditutup = new Set(data.fin_periode.filter((p) => p.status === 'ditutup').map((p) => p.periode));
    const bulanIni = m.hariIni.slice(0, 7);
    const belum = [...new Set(data.jurnal_bulanan.map((j) => j.bulan))].filter((b) => b < bulanIni && !ditutup.has(b)).sort();
    tambah({
      id: 'kunci_periode',
      area: 'kontrol',
      status: belum.length ? 'perlu_verifikasi' : 'lengkap',
      judul: 'Kunci periode & reproducibility laporan',
      isi: belum.length
        ? `Kunci periode buku besar sudah tersedia, tetapi ${belum.length} bulan berisi jurnal belum ditutup: ${belum.map(labelBulan).join(', ')}. Selama belum ditutup, transaksi bertanggal di bulan itu masih bisa ditambah/diubah.`
        : 'Semua bulan lampau yang berisi jurnal sudah ditutup; koreksi hanya lewat jurnal penyesuaian di periode berjalan.',
      tindakan: belum.length ? 'Tutup bulan yang sudah final di AI CFO → Buku Besar & Periode (syarat: debit = kredit).' : '—',
      rujukan: 'F-12',
      sumber: [{ tabel: 'fin_periode' }, { tabel: 'jurnal', ket: 'bulan berisi transaksi' }],
    });
  } else {
    tambah({
      id: 'kunci_periode',
      area: 'kontrol',
      status: 'perlu_verifikasi',
      judul: 'Kunci periode & reproducibility laporan',
      isi: 'Belum ada kunci periode pada buku besar: transaksi bertanggal lampau masih bisa ditambah setelah laporan dibagikan. Arsip tutup buku membekukan ringkasan AI CFO, bukan buku besar.',
      tindakan: 'Tahap 2a: tabel fin_periode + fin_laporan_beku (perlu persetujuan skema).',
      rujukan: 'F-12',
      sumber: [{ tabel: 'cfo_laporan_bulanan' }],
    });
  }

  // ── Laba rugi ────────────────────────────────────────────────────────────
  // D-1 (2026-11-03): jurnal LL = pengembangan & penjualan villa Loonars 1 → kolom L1.
  const nd = neracaPengembanganL1(data);
  if (nd) {
    tambah({
      id: 'penjualan_unit_l1',
      area: 'laba_rugi',
      status: 'perlu_verifikasi',
      judul: 'Kelengkapan penjualan unit villa Loonars 1',
      isi: 'Sistem villa menyatakan 8 unit lunas (A2, A4, A5, B1, B2, B3, C2, C3) dan 5 unit belum terjual (A1, A3, B4, C1, C4). Di jurnal LL, B1 tercatat terjual dengan nilai Rp 0 dan B2 baru tercatat uang muka Rp 145 jt. Harga pokok di jurnal LL mencakup pembangunan 13 unit.',
      tindakan: 'Lengkapi nilai penjualan B1 dan pelunasan B2 di jurnal LL; tetapkan perlakuan 5 unit yang belum terjual (persediaan milik PT).',
      rujukan: 'D-1 / audit 2026-11-03',
      sumber: [{ tabel: 'jurnal', ket: 'proyek LL, akun 4-*' }, { tabel: 'villa units', ket: 'lunas_pembayaran (svcmyb)' }],
    });
    for (const k of nd.kasNegatif) {
      tambah({
        id: `kas_negatif:${k.akun}`,
        area: 'neraca',
        status: 'perlu_verifikasi',
        judul: `Saldo bank negatif di buku besar proyek LL (akun ${k.akun})`,
        isi: `Saldo kumulatif ${rp(k.saldo)}. Rekening bank nyata tidak bisa negatif — kemungkinan ada penerimaan yang tidak dijurnal ke akun ini, atau pengeluaran yang dijurnal dari rekening yang salah.`,
        tindakan: 'Cocokkan dengan rekening koran dan koreksi lewat jurnal penyesuaian (bukan mengubah baris lama).',
        nilai: k.saldo,
        sumber: [{ tabel: 'jurnal', ket: `proyek LL, akun ${k.akun}` }],
      });
    }
  }
  tambah({
    id: 'bagi_hasil_unit_pt',
    area: 'laba_rugi',
    status: 'perlu_verifikasi',
    judul: 'Bagi hasil villa dibagi ke 13 unit, 5 unit belum terjual',
    isi: 'Pool bagi hasil investor (70%) dihitung untuk 13 unit. Bila 5 unit yang belum terjual masih milik PT, porsi bagi hasilnya kembali ke PT, sehingga beban bagi hasil di laporan lebih besar dari yang benar-benar dibayar ke investor.',
    tindakan: 'Konfirmasi pemilik 5 unit tersebut; rumus bagi hasil di sistem villa TIDAK diubah otomatis.',
    sumber: [{ tabel: 'laporan_villa_bulanan', ket: 'rincian.bagi_hasil.investor_count' }],
  });

  tambah({
    id: 'biaya_standar_villa',
    area: 'laba_rugi',
    status: 'perlu_verifikasi',
    judul: 'COGS & gaji villa = biaya standar, bukan aktual',
    isi: 'COGS villa = biaya standar per malam (listrik, laundry, amenities + alokasi internet, listrik resepsionis, Cloudbeds); gaji = jumlah staf × gaji standar. Angka ini dasar bagi hasil investor, tetapi bukan tagihan aktual.',
    tindakan: 'Keputusan owner D-5 (2026-11-03): laporan tetap memakai biaya standar dan ditandai estimasi. Pertimbangkan ulang sebelum due diligence PE — investor biasanya meminta biaya aktual.',
    rujukan: 'F-4 / D-5',
    sumber: [{ tabel: 'laporan_villa_bulanan', ket: 'rincian.cogs_standar, opex_rincian' }],
  });

  tambah({
    id: 'opex_belum_tercatat',
    area: 'laba_rugi',
    status: 'tidak_lengkap',
    judul: 'Pos OPEX yang belum tercatat',
    isi: 'Diskon, listrik & air aktual, laundry aktual, maintenance, marketing, software, administrasi (villa & holding) belum dicatat per kategori di sistem mana pun. Laporan menampilkannya sebagai "Belum tercatat", bukan nol.',
    tindakan: 'Tahap 2b: kategori akun OPEX hospitality + posting pengajuan biaya villa.',
    sumber: [],
  });

  tambah({
    id: 'anggaran',
    area: 'laba_rugi',
    status: 'tidak_lengkap',
    judul: 'Anggaran laba rugi',
    isi: 'Belum ada anggaran (budget) laba rugi per properti/bulan; kolom Budget kosong.',
    tindakan: 'Tahap 3: tabel fin_anggaran + input anggaran.',
    sumber: [],
  });

  const sementara = m.l1.bulan.filter((b) => b.status !== 'final');
  if (sementara.length) {
    tambah({
      id: 'villa_sementara',
      area: 'laba_rugi',
      status: 'perlu_verifikasi',
      judul: 'Laporan villa masih sementara',
      isi: `Bulan ${sementara.map((b) => labelBulan(b.bulan)).join(', ')} masih sementara (final dikirim tanggal 1–5 bulan berikutnya).`,
      tindakan: 'Tunggu kiriman final dari villa-api.',
      sumber: [{ tabel: 'laporan_villa_bulanan' }],
    });
  }

  // ── Unit economics ───────────────────────────────────────────────────────
  const statis = m.l1.bulan.filter((b) => b.malamTersedia > 0 && Number.isInteger(b.malamTersedia / hariDalamBulan(b.bulan)));
  tambah({
    id: 'inventaris_kamar',
    area: 'unit_ekonomi',
    status: m.l1.bulan.length ? 'perlu_verifikasi' : 'tidak_lengkap',
    judul: 'Available Room Nights belum per tanggal',
    isi: statis.length
      ? `Malam tersedia = unit × hari (mis. ${labelBulan(statis[0].bulan)}: ${statis[0].malamTersedia} = ${statis[0].malamTersedia / hariDalamBulan(statis[0].bulan)} × ${hariDalamBulan(statis[0].bulan)}). Kamar ditutup maintenance ikut dihitung tersedia, dan periode lama bisa berubah bila jumlah unit berubah. Sistem villa sudah punya snapshot inventaris harian & data penutupan kamar.`
      : 'Belum ada laporan villa.',
    tindakan: 'Tahap 2c: kirim villa_daily_inventory_snapshot + villa_room_maintenance → inventaris kamar historis.',
    rujukan: 'F-3',
    sumber: [{ tabel: 'laporan_villa_bulanan', ket: 'malam_tersedia' }],
  });
  tambah({
    id: 'kpi_booking',
    area: 'unit_ekonomi',
    status: 'tidak_lengkap',
    judul: 'Lead time & repeat guest belum dikirim',
    isi: 'Data booking (tanggal booking, tamu berulang) ada di sistem villa tetapi belum dikirim ke MKH Property.',
    tindakan: 'Tahap 2c: snapshot agregat KPI booking (tanpa data pribadi).',
    sumber: [],
  });

  // ── Neraca ───────────────────────────────────────────────────────────────
  tambah({
    id: 'ekuitas_plug',
    area: 'neraca',
    status: 'tidak_lengkap',
    judul: 'Ekuitas dihitung sebagai sisa (plug)',
    isi: 'Laporan holding menghitung ekuitas = aset − liabilitas dan modal disetor dari posisi berjalan, sehingga persamaan neraca tidak menguji kelengkapan data. Belum ada catatan setoran modal & saldo laba.',
    tindakan: 'Tahap 2a (disetujui owner D-2/D-4): buku besar tunggal + saldo awal dari data per tanggal penetapan.',
    rujukan: 'F-2',
    sumber: [{ tabel: 'laporanHolding()' }],
  });
  tambah({
    id: 'kas_villa',
    area: 'neraca',
    status: m.l1.kas ? (m.l1.kas.umurHari > 7 ? 'perlu_verifikasi' : 'lengkap') : 'tidak_lengkap',
    judul: 'Saldo kas & bank villa (Loonars 1)',
    isi: m.l1.kas
      ? `Saldo tercatat per ${m.l1.kas.perTanggal} (${m.l1.kas.umurHari} hari lalu).`
      : 'Saldo rekening villa belum pernah dicatat — kas Loonars 1 dan total aset konsolidasi "tidak tersedia".',
    tindakan: 'Catat saldo rekening villa di AI CFO → Loonars 1.',
    sumber: [{ tabel: 'cfo_saldo_rekening' }],
  });
  tambah({
    id: 'aset_tetap',
    area: 'neraca',
    status: 'tidak_lengkap',
    judul: 'Register aset tetap, persediaan, biaya dibayar dimuka',
    isi: 'Belum ada register aset tetap/renovasi, persediaan barang, maupun biaya dibayar dimuka. Penyusutan hanya untuk bangunan Loonars Coffee.',
    tindakan: 'Tahap 3: tabel fin_aset_tetap.',
    sumber: [],
  });

  // ── Arus kas ─────────────────────────────────────────────────────────────
  tambah({
    id: 'arus_kas_indirect',
    area: 'arus_kas',
    status: 'tidak_lengkap',
    judul: 'Laporan arus kas metode tidak langsung',
    isi: 'Membutuhkan neraca dua tanggal yang lengkap (perubahan piutang, utang, persediaan). Saat ini tersedia forecast kas metode langsung (Cash Flow Forecast).',
    tindakan: 'Setelah neraca dari buku besar tunggal tersedia (Tahap 3).',
    sumber: [],
  });

  // ── Investor ─────────────────────────────────────────────────────────────
  tambah({
    id: 'skema_bagi_hasil_investor',
    area: 'investor',
    status: 'lengkap',
    judul: 'Skema bagi hasil investor: 70% dari profit',
    isi: 'Keputusan owner D-6 (2026-11-03): investor reporting cukup menyatakan skema pembagian — investor properti menerima 70% dari profit (Loonars 1, dihitung sistem villa per bulan; top-up jaminan bila berlaku). Register investor per nama, dokumen perjanjian, dan riwayat pembayaran tidak dimasukkan ke sistem ini.',
    tindakan: '—',
    rujukan: 'D-6',
    sumber: [{ tabel: 'laporan_villa_bulanan', ket: 'rincian.bagi_hasil (pool 70%)' }],
  });

  // ── Konsolidasi: rekonsiliasi lintas sumber ──────────────────────────────
  for (const r of m.rekonsiliasi) {
    if (r.status === 'cocok') continue;
    tambah({
      id: `rekon:${r.id}`,
      area: 'konsolidasi',
      status: r.status === 'tidak_bisa_dicek' ? 'tidak_lengkap' : 'perlu_verifikasi',
      judul: r.judul,
      isi: `${r.kiri.label}: ${r.kiri.nilai === null ? 'tidak tersedia' : r.kiri.nilai.toLocaleString('id-ID')} · ${r.kanan.label}: ${r.kanan.nilai === null ? 'tidak tersedia' : r.kanan.nilai.toLocaleString('id-ID')}${r.status === 'dikonfirmasi' ? ' · selisih sudah dijelaskan owner' : ''}. ${r.catatan}`,
      tindakan: r.status === 'dikonfirmasi' ? 'Dokumentasikan bukti konfirmasi owner.' : 'Jelaskan atau koreksi selisih di sumbernya.',
      nilai: r.selisih ?? undefined,
      sumber: [{ tabel: 'rekonsiliasi AI CFO', ket: r.id }],
    });
  }
  const sinkronBermasalah = m.sinkron.filter((s) => s.status !== 'segar');
  for (const s of sinkronBermasalah) {
    tambah({
      id: `sinkron:${s.id}`,
      area: 'konsolidasi',
      status: 'perlu_verifikasi',
      judul: `Sinkronisasi: ${s.nama}`,
      isi: s.status === 'belum_pernah' ? `Belum pernah diterima (${s.asal}).` : `Terlambat — terakhir ${s.terakhir} (batas ${s.batasJam} jam).`,
      tindakan: 'Periksa jalur sinkronisasi di AI CFO → Integration & Sync.',
      sumber: [{ tabel: 'cfo_sync_log', ket: s.id }],
    });
  }

  const areaUrut: AreaLaporan[] = ['laba_rugi', 'neraca', 'arus_kas', 'unit_ekonomi', 'investor', 'konsolidasi', 'kontrol'];
  const perArea = areaUrut.map((area) => {
    const c = cek.filter((x) => x.area === area);
    const terburuk = c.reduce<Kelengkapan>((a, x) => (TINGKAT[x.status] > TINGKAT[a] ? x.status : a), 'lengkap');
    return {
      area,
      status: terburuk,
      lengkap: c.filter((x) => x.status === 'lengkap').length,
      verifikasi: c.filter((x) => x.status === 'perlu_verifikasi').length,
      tidakLengkap: c.filter((x) => x.status === 'tidak_lengkap').length,
    };
  });
  cek.sort((a, z) => TINGKAT[z.status] - TINGKAT[a.status] || areaUrut.indexOf(a.area) - areaUrut.indexOf(z.area));
  return {
    cek,
    perArea,
    jumlah: {
      lengkap: cek.filter((x) => x.status === 'lengkap').length,
      perlu_verifikasi: cek.filter((x) => x.status === 'perlu_verifikasi').length,
      tidak_lengkap: cek.filter((x) => x.status === 'tidak_lengkap').length,
    },
  };
}
