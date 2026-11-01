/**
 * FINANCIAL CONTROLLER — rekonsiliasi otomatis, deteksi transaksi abnormal,
 * pemantauan kesegaran sinkronisasi, dan aturan peringatan risiko.
 *
 * Semua aturan berbasis angka & ambang tertulis; AI tidak memutuskan apakah
 * sesuatu "berisiko" — ia hanya menjelaskan peringatan yang dihasilkan di sini.
 */
import type { HasilSkenario, NamaSkenario } from './arus-kas';
import type { LaporanL1 } from './loonars1';
import type { LaporanL2 } from './loonars2';
import type { DataCfo, Peringatan } from './tipe';
import { KONFIRMASI_OWNER, proyekDikunci } from './lingkup';
import { angka, jamSejak, jumlah, labelTanggal, median, persen, rp, selisihHari, teks } from './util';

// ── Rekonsiliasi ────────────────────────────────────────────────────────────

export interface CekRekonsiliasi {
  id: string;
  judul: string;
  /** 'dikonfirmasi' = ada selisih, tetapi sudah dijelaskan owner (KONFIRMASI_OWNER). */
  status: 'cocok' | 'selisih' | 'tidak_bisa_dicek' | 'dikonfirmasi';
  kiri: { label: string; nilai: number | null };
  kanan: { label: string; nilai: number | null };
  selisih: number | null;
  catatan: string;
}

const TOLERANSI = 1; // rupiah (pembulatan)

function cek(
  id: string,
  judul: string,
  kiri: CekRekonsiliasi['kiri'],
  kanan: CekRekonsiliasi['kanan'],
  catatan: string,
): CekRekonsiliasi {
  if (kiri.nilai === null || kanan.nilai === null) {
    return { id, judul, status: 'tidak_bisa_dicek', kiri, kanan, selisih: null, catatan };
  }
  const selisih = kiri.nilai - kanan.nilai;
  if (Math.abs(selisih) <= TOLERANSI) return { id, judul, status: 'cocok', kiri, kanan, selisih, catatan };
  const konf = KONFIRMASI_OWNER[id];
  if (konf) return { id, judul, status: 'dikonfirmasi', kiri, kanan, selisih, catatan: `${konf.catatan} (konfirmasi owner ${konf.tanggal})` };
  return { id, judul, status: 'selisih', kiri, kanan, selisih, catatan };
}

export function rekonsiliasi(data: DataCfo, l1: LaporanL1, l2: LaporanL2): CekRekonsiliasi[] {
  const hasil: CekRekonsiliasi[] = [];

  // 1. Penjualan Loonars 2: siteplan MK Connect vs modul 4 rekening.
  const jual = data.snapshot.filter(
    (s) => s.jenis === 'investor_penjualan' && teks(s.data.proyek).toUpperCase() === 'LNR2' && teks(s.data.status) !== 'rejected',
  );
  const adaSnapshot = data.sync_log.some((x) => x.jenis === 'investor_penjualan');
  hasil.push(
    cek(
      'l2_unit_terjual',
      'Jumlah unit Loonars 2 terjual: siteplan MK Connect vs modul Keuangan Loonars 2',
      { label: 'Siteplan MK Connect', nilai: adaSnapshot ? jual.length : null },
      { label: 'Modul 4 rekening', nilai: l2.unitTerjual },
      'Unit yang sudah diverifikasi terjual di siteplan harus juga ditandai terjual (dengan nama pembeli & harga) di modul Loonars 2, agar tagihan & alokasi DP berjalan.',
    ),
  );
  hasil.push(
    cek(
      'l2_nilai_kontrak',
      'Nilai kontrak Loonars 2: siteplan MK Connect vs modul Keuangan Loonars 2',
      { label: 'Siteplan MK Connect', nilai: adaSnapshot ? jumlah(jual, (s) => s.data.harga as number) : null },
      { label: 'Modul 4 rekening', nilai: l2.nilaiKontrak },
      'Selisih berarti harga/unit terjual belum disamakan di kedua sistem.',
    ),
  );
  hasil.push(
    cek(
      'l2_cash_in',
      'Cash-in investor Loonars 2: booking fee + DP terverifikasi (MK Connect) vs penerimaan tercatat (rekening A)',
      {
        label: 'MK Connect (BF + DP terverifikasi)',
        nilai: adaSnapshot
          ? jumlah(
              jual.filter((s) => teks(s.data.status) === 'verified'),
              (s) => angka(s.data.booking_fee as number) + angka(s.data.dp as number),
            )
          : null,
      },
      { label: 'loonars2_receipts', nilai: l2.cashInInvestor },
      'Uang investor yang sudah diverifikasi sales/finance di MK Connect harus dicatat sebagai penerimaan di rekening A (Loonars 2) — tanpa itu alokasi C/B/D dan saldo tidak akurat.',
    ),
  );

  // 1b. Proyek yang dibiayai Loonars 2 (Loonars Coffee): MK Connect vs jurnal MKH.
  for (const p of l2.proyek.filter((x) => x.sumber === 'mk_connect' && x.jurnal)) {
    const kode = p.kodeJurnal ?? '-';
    hasil.push(
      cek(
        `proyek_biaya:${kode}`,
        `${p.nama}: biaya material + lain-lain di MK Connect vs jurnal proyek ${kode}`,
        { label: 'MK Connect (posted)', nilai: p.realisasiMaterial + p.realisasiLain },
        { label: `Jurnal ${kode} (akun 5- & 6-, tanpa upah)`, nilai: p.jurnal!.biaya - p.jurnal!.tenaga },
        'Selisih berarti ada biaya yang dijurnal tanpa pengajuan MK Connect, atau sebaliknya.',
      ),
    );
    hasil.push(
      cek(
        `proyek_tenaga:${kode}`,
        `${p.nama}: pembayaran tukang/kontraktor di MK Connect vs jurnal proyek ${kode}`,
        { label: 'MK Connect (paid)', nilai: p.realisasiTenaga },
        { label: `Jurnal ${kode} (5-1003/5-1004)`, nilai: p.jurnal!.tenaga },
        'Pembayaran kontraktor yang tidak dijurnal membuat biaya proyek dan arus kas Loonars 2 tampak lebih kecil dari sebenarnya.',
      ),
    );
    hasil.push(
      cek(
        `proyek_utang:${kode}`,
        `${p.nama}: utang toko belum lunas di MK Connect vs saldo utang toko jurnal ${kode}`,
        { label: 'MK Connect (belum lunas)', nilai: p.utangBelumLunas },
        { label: `Jurnal ${kode} (2-1003)`, nilai: p.jurnal!.utangToko },
        'Bila MK Connect sudah lunas tetapi jurnal masih utang, pelunasan ke toko belum dijurnal.',
      ),
    );
  }

  // 2. Laporan villa: total per channel = total laporan (konsistensi internal).
  if (l1.terakhirFinal && l1.terakhirFinal.channel.length) {
    const b = l1.terakhirFinal;
    hasil.push(
      cek(
        'l1_channel_kotor',
        `Laporan villa ${b.bulan}: jumlah per channel = pendapatan kotor`,
        { label: 'Σ channel', nilai: Math.round(jumlah(b.channel, (c) => c.kotor)) },
        { label: 'Pendapatan kotor', nilai: Math.round(b.revenue) },
        'Selisih menandakan booking yang tidak terpetakan ke channel di villa-api.',
      ),
    );
    hasil.push(
      cek(
        'l1_channel_bersih',
        `Laporan villa ${b.bulan}: jumlah bersih per channel = pendapatan bersih`,
        { label: 'Σ channel', nilai: Math.round(jumlah(b.channel, (c) => c.bersih)) },
        { label: 'Pendapatan bersih', nilai: Math.round(b.pendapatanBersih) },
        'Selisih menandakan perhitungan komisi OTA tidak konsisten.',
      ),
    );
  }

  // 3. Buku besar: debet = kredit per proyek (proyek yang dikunci = arsip, tidak dicek lagi).
  const perProyek = new Map<string, { d: number; k: number }>();
  for (const j of data.jurnal_bulanan.filter((x) => !proyekDikunci(x.proyek))) {
    const key = j.proyek ?? '(tanpa proyek)';
    const v = perProyek.get(key) ?? { d: 0, k: 0 };
    v.d += angka(j.d);
    v.k += angka(j.k);
    perProyek.set(key, v);
  }
  for (const [proyek, v] of [...perProyek.entries()].sort()) {
    hasil.push(
      cek(
        `jurnal_seimbang_${proyek}`,
        `Jurnal proyek ${proyek}: total debet = total kredit`,
        { label: 'Debet', nilai: Math.round(v.d) },
        { label: 'Kredit', nilai: Math.round(v.k) },
        'Jurnal tidak seimbang berarti ada entri setengah jadi; neraca proyek tidak bisa dipercaya sampai diperbaiki.',
      ),
    );
  }

  // 4. Utang toko: disetujui − dibayar − diproses = sisa (konsistensi view).
  hasil.push(
    cek(
      'l2_utang_toko',
      'Utang toko: disetujui − cicilan dibayar − cicilan diproses = sisa utang',
      {
        label: 'Dihitung',
        nilai: Math.round(
          jumlah(data.l2_toko, (t) => angka(t.utang_disetujui) - angka(t.cicilan_dibayar) - angka(t.cicilan_diproses)),
        ),
      },
      { label: 'loonars2_v_toko.sisa_utang', nilai: Math.round(jumlah(data.l2_toko, (t) => t.sisa_utang)) },
      'Selisih menandakan cicilan yang tercatat ganda atau belum terhubung ke toko.',
    ),
  );

  // 5. Dana talangan: saldo negatif rekening = pengeluaran bertanda talangan.
  const talanganTercatat = jumlah(data.l2_pengeluaran.filter((d) => d.talangan), (d) => d.nominal);
  hasil.push(
    cek(
      'l2_talangan',
      'Dana talangan owner: saldo negatif rekening vs pengeluaran bertanda talangan',
      { label: 'Saldo negatif rekening', nilai: l2.danaTalangan },
      { label: 'Pengeluaran talangan', nilai: Math.round(talanganTercatat) },
      'Selisih berarti ada pengeluaran yang melewati saldo tanpa ditandai talangan, atau talangan yang sudah tertutup penerimaan.',
    ),
  );

  return hasil;
}

// ── Transaksi abnormal ──────────────────────────────────────────────────────

export interface TransaksiAbnormal {
  id: string;
  alasan: string;
  nominal: number;
  tanggal: string;
  sumber: string;
}

export function deteksiAbnormal(data: DataCfo): TransaksiAbnormal[] {
  const hasil: TransaksiAbnormal[] = [];
  const perKategori = new Map<string, number[]>();
  for (const d of data.l2_pengeluaran) {
    const arr = perKategori.get(d.kategori) ?? [];
    arr.push(angka(d.nominal));
    perKategori.set(d.kategori, arr);
  }
  for (const d of data.l2_pengeluaran) {
    const xs = perKategori.get(d.kategori) ?? [];
    const med = median(xs);
    const n = angka(d.nominal);
    if (xs.length >= 5 && med > 0 && n > med * 4 && n >= 5_000_000) {
      hasil.push({
        id: `besar:${d.id}`,
        alasan: `Nominal ${(n / med).toFixed(1).replace('.', ',')}× median kategori ${d.kategori} (${rp(med)})`,
        nominal: n,
        tanggal: d.tanggal,
        sumber: `loonars2_disbursements#${d.id}`,
      });
    }
  }
  // Kembar: kategori, nominal, tanggal, toko, unit sama.
  const kunci = new Map<string, number[]>();
  for (const d of data.l2_pengeluaran) {
    const k = [d.kategori, angka(d.nominal), d.tanggal, d.toko_id ?? '', d.unit_id ?? '', d.cicilan_id ?? ''].join('|');
    kunci.set(k, [...(kunci.get(k) ?? []), d.id]);
  }
  for (const [k, ids] of kunci) {
    if (ids.length > 1) {
      const [kategori, nominal, tanggal] = k.split('|');
      hasil.push({
        id: `kembar:${ids.join('-')}`,
        alasan: `${ids.length} pengeluaran ${kategori} identik (nominal, tanggal, toko, unit sama) — periksa kemungkinan dobel`,
        nominal: Number(nominal) * ids.length,
        tanggal,
        sumber: `loonars2_disbursements#${ids.join(',')}`,
      });
    }
  }
  return hasil.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
}

// ── Kesegaran sinkronisasi ──────────────────────────────────────────────────

export interface StatusSinkron {
  id: string;
  nama: string;
  asal: string;
  terakhir: string | null;
  batasJam: number;
  status: 'segar' | 'terlambat' | 'belum_pernah';
  catatan: string;
}

export function statusSinkron(data: DataCfo, sekarang: Date): StatusSinkron[] {
  const k = data.kesegaran;
  const log = (jenis: string) =>
    data.sync_log.filter((x) => x.jenis === jenis).sort((a, b) => b.diterima_pada.localeCompare(a.diterima_pada))[0];
  const daftar: Omit<StatusSinkron, 'status'>[] = [
    { id: 'l1_laporan', nama: 'Laporan keuangan villa (Loonars 1)', asal: 'villa-api → laporan_villa_bulanan (harian 00.40 WIB)', terakhir: k.l1_laporan ?? null, batasJam: 36, catatan: 'Revenue, OTA, COGS, OPEX, laba per bulan' },
    { id: 'l1_metrik', nama: 'KPI villa (okupansi, ADR)', asal: 'villa-api → ir_metrik_bulanan', terakhir: k.l1_metrik ?? null, batasJam: 24 * 35, catatan: 'Dikirim bulanan' },
    { id: 'jurnal_mk_connect', nama: 'Jurnal dari MK Connect', asal: 'MK Connect → sync_inbound → jurnal', terakhir: k.jurnal_mk_connect ?? null, batasJam: 24 * 7, catatan: 'Biaya konstruksi, gaji, komisi lintas cabang' },
    { id: 'l2_pengeluaran', nama: 'Pengeluaran Loonars 2 (rekening C)', asal: 'WA pelaksana/owner → loonars2_disbursements', terakhir: k.l2_pengeluaran ?? null, batasJam: 24 * 7, catatan: 'Data asli modul Loonars 2 di database ini' },
    { id: 'l2_penerimaan', nama: 'Penerimaan investor Loonars 2 (rekening A)', asal: 'WA owner → loonars2_receipts', terakhir: k.l2_penerimaan ?? null, batasJam: 24 * 30, catatan: 'Kosong = belum ada pembayaran investor yang dicatat' },
    ...(['investor_penjualan', 'refund_customer', 'transfer_tertunda', 'ota_settlement', 'pengajuan_biaya_villa', 'villa_kas_masuk', 'villa_kas_keluar'] as const).map((j) => ({
      id: `snapshot_${j}`,
      nama: {
        investor_penjualan: 'Penjualan unit ke investor (siteplan)',
        refund_customer: 'Refund customer',
        transfer_tertunda: 'Transfer tertunda (MK Connect)',
        ota_settlement: 'Settlement OTA villa',
        pengajuan_biaya_villa: 'Pengajuan biaya villa',
        villa_kas_masuk: 'Mutasi kas masuk villa (OTA cair, website, walk-in)',
        villa_kas_keluar: 'Mutasi kas keluar villa (biaya ditransfer)',
      }[j],
      asal: 'Database MK Connect + villa → cfo_sumber_terima (pg_cron 30 menit)',
      terakhir: log(j)?.diterima_pada ?? null,
      batasJam: 2,
      catatan: log(j) ? `${log(j)!.jumlah} baris; baru ${log(j)!.baru}, berubah ${log(j)!.berubah}, nonaktif ${log(j)!.nonaktif}` : 'Pengirim di database MK Connect belum aktif',
    })),
  ];
  return daftar.map((d) => {
    const jam = jamSejak(d.terakhir, sekarang);
    return { ...d, status: !Number.isFinite(jam) ? 'belum_pernah' : jam > d.batasJam ? 'terlambat' : 'segar' };
  });
}

// ── Aturan peringatan ───────────────────────────────────────────────────────

export interface KonteksPeringatan {
  data: DataCfo;
  hariIni: string;
  l1: LaporanL1;
  l2: LaporanL2;
  kasTotal: number;
  kasMinimum: number;
  skenario: Record<NamaSkenario, HasilSkenario>;
  rekon: CekRekonsiliasi[];
  abnormal: TransaksiAbnormal[];
  sinkron: StatusSinkron[];
  kewajibanLewat: number;
  kewajiban7Hari: number;
}

const URUT: Record<Peringatan['tingkat'], number> = { kritis: 0, tinggi: 1, sedang: 2, info: 3 };

export function susunPeringatan(c: KonteksPeringatan): Peringatan[] {
  const p: Peringatan[] = [];
  const { l1, l2, skenario } = c;

  // Kas & forecast
  const n = skenario.normal;
  if (n.tanggalDefisit) {
    const hari = selisihHari(c.hariIni, n.tanggalDefisit);
    p.push({
      id: `defisit_normal:${n.tanggalDefisit}`,
      tingkat: hari <= 28 ? 'kritis' : 'tinggi',
      lini: 'Grup',
      judul: `Proyeksi DEFISIT kas ${labelTanggal(n.tanggalDefisit)} (skenario normal)`,
      isi: `Saldo kas diproyeksikan negatif dalam ${hari} hari, terendah ${rp(n.saldoMin)} pada ${labelTanggal(n.tanggalSaldoMin)}. Kebutuhan dana agar tetap di atas kas minimum: ${rp(n.kebutuhanDana)}.`,
      nilai: n.kebutuhanDana,
      sumber: [{ tabel: 'forecast', ket: 'skenario normal, 182 hari' }],
    });
  } else if (skenario.pesimis.tanggalDefisit) {
    p.push({
      id: `defisit_pesimis:${skenario.pesimis.tanggalDefisit}`,
      tingkat: 'sedang',
      lini: 'Grup',
      judul: `Skenario pesimis: kas negatif ${labelTanggal(skenario.pesimis.tanggalDefisit)}`,
      isi: `Bila pendapatan villa turun 25%, tagihan investor mundur 6 minggu, dan biaya konstruksi naik 10%, kas negatif dengan kekurangan ${rp(skenario.pesimis.besarDefisit)}.`,
      nilai: skenario.pesimis.besarDefisit,
      sumber: [{ tabel: 'forecast', ket: 'skenario pesimis' }],
    });
  }
  if (c.kasTotal < c.kasMinimum) {
    p.push({
      id: 'kas_di_bawah_minimum',
      tingkat: 'tinggi',
      lini: 'Grup',
      judul: 'Kas di bawah batas minimum',
      isi: `Posisi kas tercatat ${rp(c.kasTotal)}, di bawah kas minimum ${rp(c.kasMinimum)}.`,
      nilai: c.kasTotal,
      sumber: [{ tabel: 'loonars2_v_rekening' }, { tabel: 'jurnal', ket: 'akun kas/bank proyek LL' }],
    });
  }

  // Loonars 2
  if (l2.danaTalangan > 0) {
    p.push({
      id: 'l2_dana_talangan',
      tingkat: 'tinggi',
      lini: 'L2',
      judul: `Konstruksi Loonars 2 dibiayai dana talangan owner ${rp(l2.danaTalangan)}`,
      isi: `Rekening C (konstruksi) bersaldo negatif karena belum ada pembayaran investor yang masuk ke rekening A. Semua belanja konstruksi saat ini memakai uang owner; ini utang proyek kepada owner, bukan modal.`,
      nilai: l2.danaTalangan,
      sumber: [{ tabel: 'loonars2_v_rekening', ket: 'rekening C' }, { tabel: 'loonars2_disbursements', ket: 'talangan = true' }],
    });
  }
  const tanpaPembeli = l2.unit.filter((u) => u.dibangunTanpaPembeli);
  if (tanpaPembeli.length) {
    const biaya = jumlah(tanpaPembeli, (u) => u.aktual);
    p.push({
      id: `l2_bangun_tanpa_pembeli:${tanpaPembeli.length}`,
      tingkat: biaya >= 50_000_000 ? 'tinggi' : 'sedang',
      lini: 'L2',
      judul: `${tanpaPembeli.length} unit Loonars 2 dibangun tanpa pembeli`,
      isi: `${tanpaPembeli.map((u) => u.kode).join(', ')} sudah menyerap ${rp(biaya)} padahal belum ada pembeli/DP. Prinsip modul 4 rekening: unit dibangun setelah terdanai.`,
      nilai: biaya,
      sumber: [{ tabel: 'loonars2_v_unit' }],
    });
  }
  for (const u of l2.unit.filter((x) => x.overBudget > 0)) {
    p.push({
      id: `l2_over_budget:${u.kode}`,
      tingkat: 'tinggi',
      lini: 'L2',
      judul: `${u.kode} melewati budget + buffer`,
      isi: `Terpakai ${rp(u.aktual)} vs budget ${rp(u.budget)} (+buffer ${rp(u.budgetDenganBuffer - u.budget)}); lebih ${rp(u.overBudget)}.`,
      nilai: u.overBudget,
      sumber: [{ tabel: 'loonars2_v_unit', ket: u.kode }],
    });
  }
  const telat = l2.unit.filter((u) => u.terjual && u.sisaTagihan > 0 && u.jatuhTempo && u.jatuhTempo < c.hariIni);
  if (telat.length) {
    p.push({
      id: `l2_tagihan_lewat:${telat.map((u) => u.kode).join(',')}`,
      tingkat: 'tinggi',
      lini: 'L2',
      judul: `Tagihan investor lewat jatuh tempo: ${rp(jumlah(telat, (u) => u.sisaTagihan))}`,
      isi: telat.map((u) => `${u.kode} (${u.pembeli ?? 'tanpa nama'}) ${rp(u.sisaTagihan)}, jatuh tempo ${labelTanggal(u.jatuhTempo!)}`).join('; '),
      nilai: jumlah(telat, (u) => u.sisaTagihan),
      sumber: [{ tabel: 'loonars2_v_unit', ket: 'sisa_pelunasan, jatuh_tempo_efektif' }],
    });
  }
  for (const pr of l2.proyek) {
    if (pr.selisihBudget !== null && pr.selisihBudget > 0) {
      p.push({
        id: `l2_proyek_over:${pr.kodeJurnal ?? pr.id}`,
        tingkat: pr.realisasiPct !== null && pr.realisasiPct >= 120 ? 'tinggi' : 'sedang',
        lini: 'L2',
        judul: `${pr.nama} melewati budget ${rp(pr.selisihBudget)} (${persen(pr.realisasiPct ?? 0, 0)} dari budget)`,
        isi: `Budget ${rp(pr.budgetTotal ?? 0)}, realisasi ${rp(pr.realisasiTotal)}: material ${rp(pr.realisasiMaterial)}${pr.materialPct !== null ? ` (${persen(pr.materialPct, 0)} dari budget material ${rp(pr.budgetMaterial ?? 0)})` : ''}, tukang/kontraktor ${rp(pr.realisasiTenaga)}, lain-lain ${rp(pr.realisasiLain)} (tanpa pos budget). Dibiayai keuangan Loonars 2.`,
        nilai: pr.selisihBudget,
        sumber: [{ tabel: 'snapshot:proyek_konstruksi', ket: pr.nama }],
      });
    }
  }
  if (l2.tanah.target > 0 && l2.tanah.jatuhTempo) {
    const hari = selisihHari(c.hariIni, l2.tanah.jatuhTempo);
    const bulanSisa = Math.max(1, Math.ceil(hari / 30));
    if (l2.tanah.sisa > 0 && hari <= 365) {
      p.push({
        id: 'l2_sewa_tanah',
        tingkat: hari <= 90 ? 'tinggi' : 'sedang',
        lini: 'L2',
        judul: `Sisa sewa tanah ${rp(l2.tanah.sisa)} jatuh tempo ${labelTanggal(l2.tanah.jatuhTempo)}`,
        isi: `Perlu menyisihkan ±${rp(l2.tanah.sisa / bulanSisa)} per bulan ke rekening B selama ${bulanSisa} bulan. Terbayar saat ini ${rp(l2.tanah.dibayar)} dari ${rp(l2.tanah.target)}.`,
        nilai: l2.tanah.sisa,
        sumber: [{ tabel: 'loonars2_settings', ket: 'target_tanah, jatuh_tempo_tanah' }, { tabel: 'loonars2_disbursements', ket: 'kategori tanah' }],
      });
    }
  }
  if (l2.utangToko > 0) {
    p.push({
      id: 'l2_utang_toko',
      tingkat: l2.utangToko > 100_000_000 ? 'tinggi' : 'sedang',
      lini: 'L2',
      judul: `Utang toko bangunan ${rp(l2.utangToko)}`,
      isi: `Terbesar: ${l2.utangTokoPerToko.slice(0, 3).map((t) => `${t.nama} ${rp(t.sisa)}`).join(', ')}.`,
      nilai: l2.utangToko,
      sumber: [{ tabel: 'loonars2_v_toko' }],
    });
  }

  // Loonars 1
  const t = l1.terakhir;
  if (t && t.bagianMkhBersih < 0) {
    p.push({
      id: `l1_jaminan_rugi:${t.bulan}`,
      tingkat: 'tinggi',
      lini: 'L1',
      judul: `Villa ${t.bulan}: bagian MKH negatif karena top-up jaminan investor`,
      isi: `Laba operasi ${rp(t.ebitda)}; bagian pengelola ${rp(t.bagianPengelola)} tidak menutup top-up jaminan investor ${rp(t.topupJaminan)} → MKH menanggung ${rp(-t.bagianMkhBersih)}${t.status === 'sementara' ? ' (bulan berjalan, angka sementara)' : ''}.`,
      nilai: t.bagianMkhBersih,
      sumber: [{ tabel: 'laporan_villa_bulanan', ket: `${t.bulan} rincian.bagi_hasil` }],
    });
  }
  if (t && t.status === 'sementara' && t.okupansiPct !== null) {
    const f = l1.terakhirFinal;
    if (f && f.okupansiPct !== null && t.okupansiPct < f.okupansiPct * 0.5) {
      p.push({
        id: `l1_okupansi_turun:${t.bulan}`,
        tingkat: 'sedang',
        lini: 'L1',
        judul: `Okupansi villa bulan berjalan ${persen(t.okupansiPct)} vs ${persen(f.okupansiPct)} bulan lalu`,
        isi: 'Angka bulan berjalan masih sementara (dihitung dari booking check-in bulan ini). Pantau pickup booking & harga.',
        nilai: t.okupansiPct,
        sumber: [{ tabel: 'laporan_villa_bulanan', ket: `${f.bulan} vs ${t.bulan}` }],
      });
    }
  }
  if (!l1.kas) {
    p.push({
      id: 'l1_saldo_belum_dicatat',
      tingkat: 'sedang',
      lini: 'L1',
      judul: 'Saldo rekening villa belum dicatat',
      isi: 'Kas Loonars 1 belum ikut posisi kas & forecast. Catat saldo rekening villa (dari mutasi bank) di halaman Loonars 1; setelah itu kas berjalan dihitung otomatis dari mutasi villa.',
      sumber: [{ tabel: 'cfo_saldo_rekening' }],
    });
  } else if (l1.kas.umurHari > 7) {
    p.push({
      id: `l1_saldo_usang:${l1.kas.perTanggal}`,
      tingkat: 'sedang',
      lini: 'L1',
      judul: `Saldo rekening villa terakhir dicatat ${l1.kas.umurHari} hari lalu`,
      isi: 'Gaji staf, bagi hasil investor, dan biaya di luar sistem villa tidak terbaca otomatis. Perbarui saldo dari mutasi bank agar kas berjalan akurat.',
      nilai: l1.kas.kasBerjalan,
      sumber: [{ tabel: 'cfo_saldo_rekening', ket: l1.kas.perTanggal }],
    });
  }
  if (l1.neraca.pajakHotelTerutang > 0) {
    p.push({
      id: 'l1_pajak_hotel',
      tingkat: 'sedang',
      lini: 'L1',
      judul: `Pajak hotel terutang belum disetor ${rp(l1.neraca.pajakHotelTerutang)}`,
      isi: 'Setor ke Dispenda dan catat bukti setor di halaman Pajak Hotel.',
      nilai: l1.neraca.pajakHotelTerutang,
      sumber: [{ tabel: 'pajak_hotel_villa' }],
    });
  }

  // Grup: utang bank (proyek yang dikunci tidak dilaporkan lagi — lihat lingkup.ts)
  for (const u of c.data.utang_bank.filter((x) => !proyekDikunci(x.proyek))) {
    const sisa = angka(u.pokok) - angka(u.terbayar);
    if (sisa > 0 && u.jt_tempo) {
      const hari = selisihHari(c.hariIni, u.jt_tempo);
      if (hari <= 90) {
        p.push({
          id: `utang_bank:${u.id}`,
          tingkat: hari <= 30 ? 'kritis' : 'tinggi',
          lini: 'Grup',
          judul: `Utang bank ${u.bank} (${u.proyek}) ${rp(sisa)} jatuh tempo ${labelTanggal(u.jt_tempo)}`,
          isi: `${u.jenis}; ${hari < 0 ? `sudah lewat ${-hari} hari` : `${hari} hari lagi`}. Terbayar ${rp(angka(u.terbayar))} dari pokok ${rp(angka(u.pokok))}. Di luar Loonars, tetapi menekan kas grup.`,
          nilai: sisa,
          sumber: [{ tabel: 'utang_bank', ket: `id ${u.id}` }],
        });
      }
    }
  }
  if (c.kewajibanLewat > 0) {
    p.push({
      id: 'kewajiban_lewat',
      tingkat: 'tinggi',
      lini: 'Grup',
      judul: `Kewajiban lewat jatuh tempo ${rp(c.kewajibanLewat)}`,
      isi: 'Lihat Debt & Liability Center untuk rincian dan urutan bayar yang disarankan.',
      nilai: c.kewajibanLewat,
      sumber: [{ tabel: 'kewajiban', ket: 'gabungan' }],
    });
  }

  // Data & kontrol
  for (const r of c.rekon.filter((x) => x.status === 'selisih')) {
    p.push({
      id: `rekon:${r.id}`,
      tingkat: r.id.startsWith('l2_') ? 'tinggi' : 'sedang',
      lini: 'Data',
      judul: `Rekonsiliasi tidak cocok: ${r.judul}`,
      isi: `${r.kiri.label} ${rp(r.kiri.nilai ?? 0)} vs ${r.kanan.label} ${rp(r.kanan.nilai ?? 0)} (selisih ${rp(r.selisih ?? 0)}). ${r.catatan}`,
      nilai: r.selisih ?? undefined,
      sumber: [{ tabel: 'rekonsiliasi', ket: r.id }],
    });
  }
  for (const a of c.abnormal.slice(0, 5)) {
    p.push({
      id: `abnormal:${a.id}`,
      tingkat: 'sedang',
      lini: 'L2',
      judul: `Transaksi perlu diperiksa: ${rp(a.nominal)} (${labelTanggal(a.tanggal)})`,
      isi: a.alasan,
      nilai: a.nominal,
      sumber: [{ tabel: a.sumber }],
    });
  }
  for (const s of c.sinkron.filter((x) => x.status !== 'segar' && !x.id.startsWith('snapshot_') && x.id !== 'l2_penerimaan')) {
    p.push({
      id: `sinkron:${s.id}`,
      tingkat: 'sedang',
      lini: 'Data',
      judul: `Data terlambat: ${s.nama}`,
      isi: `${s.status === 'belum_pernah' ? 'Belum pernah diterima' : `Terakhir diterima ${s.terakhir ? new Date(s.terakhir).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-'}`} (batas ${s.batasJam} jam). Angka terkait bisa usang.`,
      sumber: [{ tabel: s.asal }],
    });
  }
  if (c.sinkron.filter((x) => x.id.startsWith('snapshot_')).every((x) => x.status === 'belum_pernah')) {
    p.push({
      id: 'sinkron:snapshot_belum_aktif',
      tingkat: 'info',
      lini: 'Data',
      judul: 'Data MK Connect (penjualan investor, refund, settlement OTA) belum tersambung',
      isi: 'Pengirim snapshot di database MK Connect belum aktif, jadi rekonsiliasi penjualan Loonars 2 dan refund customer belum bisa dihitung otomatis.',
      sumber: [{ tabel: 'cfo_sync_log' }],
    });
  }

  return p.sort((a, b) => URUT[a.tingkat] - URUT[b.tingkat] || (b.nilai ?? 0) - (a.nilai ?? 0));
}
