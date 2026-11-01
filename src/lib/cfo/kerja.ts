/**
 * AI CFO BEKERJA — pekerjaan rutin seorang CFO, deterministik:
 *
 *  1. reviuPengajuanL2 / reviuPengajuanMkh — setiap pengajuan yang menunggu
 *     diberi rekomendasi (SETUJUI / TAHAN / CEK DOBEL / …) beserta alasan
 *     berbasis angka: sisa budget unit, unit sudah terjual atau belum, dana
 *     talangan yang bertambah, transaksi kembar, umur antrean.
 *  2. rencanaPembayaran — rencana bayar minggu ini sesuai kas yang ada.
 *  3. susunTindakan — daftar tugas konkret (apa, siapa, tenggat) yang
 *     disinkronkan ke cfo_tindakan; tertutup otomatis bila kondisi teratasi.
 *  4. ringkasBulan / komentarVarians / siapTutupBuku — tutup buku bulanan.
 *
 * Owner tetap memutuskan; AI CFO tidak menyetujui, membayar, atau mengubah
 * transaksi apa pun. Rekomendasi dihitung kode, bukan model bahasa.
 */
import { BOBOT_RISIKO, type JenisKewajiban } from './kewajiban';
import type { ModelCfo } from './model';
import type { Num, Sumber, Tingkat } from './tipe';
import { angka, bulat, jumlah, labelBulan, labelTanggal, median, persen, rp, rpRingkas, selisihHari, tambahBulan, tambahHari } from './util';

// ── Tipe data dari RPC cfo_ambil_kerja (migrasi 0058) ───────────────────────

export interface PengajuanL2 {
  id: number;
  kelompok: string | null;
  kategori: string;
  unit_id: number | null;
  nominal: Num;
  deskripsi: string;
  toko: string | null;
  status: string;
  pakai_buffer: boolean | null;
  melewati_buffer: boolean | null;
  saldo_c_kurang: boolean | null;
  unit_belum_terdanai: boolean | null;
  borongan_id: number | null;
  minggu_ke: number | null;
  retensi: boolean | null;
  diajukan_oleh: string | null;
  dibuat_pada: string;
  diputuskan_pada: string | null;
}

export interface PengajuanMkh {
  id: number;
  proyek: string | null;
  tipe: string;
  nominal_teks: string | null;
  supplier: string | null;
  keterangan: string;
  dibuat_pada: string;
}

export interface AlokasiMenunggu {
  id: number;
  receipt_id: number;
  ke_rekening: string;
  nominal: Num;
  tanggal: string;
  unit: string;
  jenis: string;
}

export interface TindakanDb {
  id: number;
  kunci: string;
  judul: string;
  langkah: string;
  tingkat: Tingkat;
  lini: 'L1' | 'L2' | 'Grup' | 'Data';
  penanggung: string;
  tenggat: string | null;
  nilai: Num;
  sumber: Sumber[];
  status: 'terbuka' | 'selesai' | 'diabaikan';
  dibuat_pada: string;
  terakhir_terdeteksi: string;
  ditutup_pada: string | null;
  ditutup_oleh: string | null;
  alasan: string | null;
}

export interface LaporanBulananDb {
  periode: string;
  komentar: string;
  data: RingkasBulan;
  dibuat_oleh: string;
  dibuat_pada: string;
  hash: string;
}

export interface DataKerja {
  l2_pengajuan: PengajuanL2[];
  mkh_pengajuan: PengajuanMkh[];
  alokasi_menunggu: AlokasiMenunggu[];
  rekening_terisi: Record<string, boolean>;
  tindakan: TindakanDb[];
  laporan_bulanan: LaporanBulananDb[];
}

export const KERJA_KOSONG: DataKerja = {
  l2_pengajuan: [],
  mkh_pengajuan: [],
  alokasi_menunggu: [],
  rekening_terisi: {},
  tindakan: [],
  laporan_bulanan: [],
};

// ── 1a. Reviu pengajuan Loonars 2 (per kelompok) ────────────────────────────

export type PutusanReviu = 'SETUJUI' | 'TAHAN' | 'CEK_DOBEL';

export interface ReviuL2 {
  kelompok: string;
  kategori: string;
  ids: number[];
  total: number;
  unit: string[];
  umurHari: number;
  contoh: string;
  putusan: PutusanReviu;
  alasan: string[];
  butuhTalangan: number;
}

const normal = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function reviuPengajuanL2(m: ModelCfo, k: DataKerja): ReviuL2[] {
  const menunggu = k.l2_pengajuan.filter((p) => p.status === 'menunggu');
  const unitById = new Map(m.l2.unit.map((u) => [u.id, u]));
  const rekC = m.l2.rekening.find((r) => r.kode === 'C');
  // Kas C efektif = saldo + transfer alokasi DP yang sedang menuju C.
  let kasC = rekC ? rekC.saldo + rekC.menungguTransfer : 0;

  const grup = new Map<string, PengajuanL2[]>();
  for (const p of menunggu) {
    const key = p.kelompok ?? `#${p.id}`;
    grup.set(key, [...(grup.get(key) ?? []), p]);
  }

  const hasil: ReviuL2[] = [];
  const urut = [...grup.entries()].sort(([, a], [, b]) => a[0].dibuat_pada.localeCompare(b[0].dibuat_pada));
  for (const [kelompok, items] of urut) {
    const total = jumlah(items, (p) => p.nominal);
    const kategori = [...new Set(items.map((p) => p.kategori))].join('/');
    const umurHari = Math.max(...items.map((p) => selisihHari(p.dibuat_pada.slice(0, 10), m.hariIni)));
    const unitIds = [...new Set(items.map((p) => p.unit_id).filter((x): x is number => x != null))];
    const unit = unitIds.map((id) => unitById.get(id)?.kode ?? `unit ${id}`);
    const alasan: string[] = [];

    const isUpah = items.some((p) => p.kategori === 'tukang' || p.borongan_id != null);
    const isCicilanUtang = items.every((p) => /^\W*cicilan\b/i.test(p.deskripsi.trim()));

    // Transaksi kembar: pengajuan lain (≤30 hari) kategori, toko, unit, nominal sama.
    const dobel = items.filter((p) =>
      k.l2_pengajuan.some(
        (q) =>
          q.id !== p.id &&
          (q.kelompok ?? `#${q.id}`) !== kelompok &&
          ['menunggu', 'disetujui', 'dibayar'].includes(q.status) &&
          q.kategori === p.kategori &&
          q.unit_id === p.unit_id &&
          angka(q.nominal) === angka(p.nominal) &&
          normal(q.toko) === normal(p.toko) &&
          normal(q.deskripsi) === normal(p.deskripsi) &&
          Math.abs(selisihHari(q.dibuat_pada.slice(0, 10), p.dibuat_pada.slice(0, 10))) <= 30,
      ),
    );

    // Budget per unit.
    const lewatBudget: string[] = [];
    for (const id of unitIds) {
      const u = unitById.get(id);
      if (!u) continue;
      const tambah = jumlah(items.filter((p) => p.unit_id === id), (p) => p.nominal);
      if (u.budgetDenganBuffer > 0 && u.aktual + tambah > u.budgetDenganBuffer) {
        lewatBudget.push(`${u.kode} (terpakai ${rpRingkas(u.aktual)} + ${rpRingkas(tambah)} > budget+buffer ${rpRingkas(u.budgetDenganBuffer)})`);
      }
    }
    const belumTerjual = unitIds.map((id) => unitById.get(id)).filter((u) => u && !u.terjual).map((u) => u!.kode);
    const butuhTalangan = Math.max(0, total - Math.max(0, kasC));

    let putusan: PutusanReviu;
    if (dobel.length) {
      putusan = 'CEK_DOBEL';
      alasan.push(`${dobel.length} item identik dengan pengajuan lain ≤30 hari (kategori, toko, unit, nominal, deskripsi sama). Pastikan bukan pengajuan ganda sebelum dibayar.`);
    } else if (lewatBudget.length || items.some((p) => p.melewati_buffer)) {
      putusan = 'TAHAN';
      alasan.push(lewatBudget.length ? `Melewati budget + buffer: ${lewatBudget.join('; ')}.` : 'Pengajuan ditandai melewati buffer unit.');
    } else if (isCicilanUtang) {
      putusan = 'SETUJUI';
      alasan.push('Cicilan utang toko yang sudah disetujui — membayar kewajiban yang sudah ada, bukan belanja baru; menunda berisiko toko menghentikan kredit.');
    } else if (isUpah) {
      putusan = 'SETUJUI';
      alasan.push('Upah tukang/borongan terjadwal — menunda berisiko pekerjaan berhenti.');
    } else if (unitIds.length && belumTerjual.length === unitIds.length) {
      putusan = 'TAHAN';
      alasan.push(`Semua unit (${belumTerjual.join(', ')}) belum terjual/ber-DP — belanja ini menambah dana talangan owner. Prinsip modul 4 rekening: bangun setelah terdanai.`);
    } else {
      putusan = 'SETUJUI';
      alasan.push('Dalam budget unit dan untuk unit yang sudah terdanai.');
    }
    if (butuhTalangan > 0) {
      alasan.push(`Kas rekening C tidak cukup: perlu talangan owner ${rp(butuhTalangan)}.`);
    }
    if (umurHari > 7) alasan.push(`Sudah menunggu ${umurHari} hari — putuskan agar antrean tidak menumpuk.`);
    if (putusan === 'SETUJUI') kasC -= total;

    hasil.push({
      kelompok,
      kategori,
      ids: items.map((p) => p.id),
      total: bulat(total),
      unit,
      umurHari,
      contoh: items[0].deskripsi.replace(/^\W+/, '').slice(0, 90),
      putusan,
      alasan,
      butuhTalangan: bulat(butuhTalangan),
    });
  }
  return hasil;
}

// ── 1b. Reviu antrean pengajuan MKH (semua proyek) ──────────────────────────

export type PutusanMkh = 'PROSES' | 'CEK_DOBEL' | 'NOMINAL_JANGGAL' | 'BASI';

export interface ReviuMkh {
  id: number;
  proyek: string;
  tipe: string;
  nominal: number;
  ringkas: string;
  umurHari: number;
  putusan: PutusanMkh;
  alasan: string[];
  pasangan: number[];
}

export function reviuPengajuanMkh(k: DataKerja, hariIni: string): ReviuMkh[] {
  const items = k.mkh_pengajuan.map((p) => {
    const n = Number(p.nominal_teks);
    return { ...p, nominal: Number.isFinite(n) ? n : 0, kunciTeks: normal(p.keterangan).slice(0, 28), unitFee: p.keterangan.match(/unit\s+([a-z0-9-]+)/i)?.[1]?.toUpperCase() ?? null };
  });
  return items.map((p) => {
    const umurHari = selisihHari(p.dibuat_pada.slice(0, 10), hariIni);
    const alasan: string[] = [];
    const pasangan = items
      .filter(
        (q) =>
          q.id !== p.id &&
          q.proyek === p.proyek &&
          q.tipe === p.tipe &&
          q.nominal === p.nominal &&
          ((p.tipe === 'komisi' && p.unitFee !== null && q.unitFee === p.unitFee) || (p.kunciTeks.length >= 10 && q.kunciTeks === p.kunciTeks)),
      )
      .map((q) => q.id);
    let putusan: PutusanMkh = 'PROSES';
    if (pasangan.length) {
      putusan = 'CEK_DOBEL';
      alasan.push(
        p.tipe === 'komisi' && p.unitFee
          ? `Ada ${pasangan.length + 1} klaim fee untuk unit ${p.unitFee} dengan nominal sama (#${[p.id, ...pasangan].join(', #')}). Pastikan siapa yang berhak sebelum dibayar.`
          : `Identik dengan pengajuan #${pasangan.join(', #')} (proyek, nominal, keterangan sama) — kemungkinan input ganda.`,
      );
    }
    if (!Number.isInteger(p.nominal) || p.nominal < 1000) {
      if (putusan === 'PROSES') putusan = 'NOMINAL_JANGGAL';
      alasan.push(`Nominal "${p.nominal_teks ?? ''}" tidak wajar (pecahan / < Rp 1.000) — kemungkinan salah ketik.`);
    }
    if (umurHari > 30) {
      if (putusan === 'PROSES') putusan = 'BASI';
      alasan.push(`Menunggu ${umurHari} hari. Kemungkinan sudah dibayar di luar sistem atau batal — tolak atau proses supaya laporan utang akurat.`);
    }
    return {
      id: p.id,
      proyek: p.proyek ?? '-',
      tipe: p.tipe,
      nominal: bulat(p.nominal),
      ringkas: p.keterangan.slice(0, 90),
      umurHari,
      putusan,
      alasan: alasan.length ? alasan : ['Tidak ada temuan; proses sesuai alur verifikasi.'],
      pasangan,
    };
  });
}

// ── 2. Rencana pembayaran minggu ini ────────────────────────────────────────

export interface ItemRencana {
  id: string;
  pihak: string;
  nominal: number;
  lini: string;
  skor: number;
  keputusan: 'bayar' | 'tunda';
  alasan: string;
}

export interface RencanaBayar {
  danaTersedia: number;
  bayar: ItemRencana[];
  tunda: ItemRencana[];
  totalBayar: number;
  totalTunda: number;
  sisa: number;
}

export function rencanaPembayaran(m: ModelCfo, reviuL2: ReviuL2[]): RencanaBayar {
  const danaTersedia = Math.max(0, m.kasTotal - m.kasMinimum);
  const kandidat: Omit<ItemRencana, 'keputusan' | 'alasan'>[] = [];
  const tahan = new Map<string, ReviuL2>();
  for (const r of reviuL2) for (const id of r.ids) tahan.set(`l2_pengajuan:${id}`, r);

  for (const k of m.kewajiban) {
    if (k.jenis === 'utang_owner') continue;
    if (k.id.startsWith('l2_pengajuan:')) continue; // diwakili per kelompok di bawah
    if (k.status !== 'lewat' && k.status !== 'minggu_ini') continue;
    kandidat.push({ id: k.id, pihak: k.pihak, nominal: k.nominal, lini: k.lini, skor: k.skor });
  }
  for (const r of reviuL2) {
    const jenis: JenisKewajiban = r.kategori.includes('tukang') ? 'upah_tukang' : 'pengajuan_material';
    kandidat.push({
      id: `kelompok:${r.kelompok}`,
      pihak: `Pengajuan L2 ${r.kelompok} (${r.kategori}${r.unit.length ? `, ${r.unit.length} unit` : ''})`,
      nominal: r.total,
      lini: 'L2',
      skor: BOBOT_RISIKO[jenis].bobot * 20 + 30 + (r.putusan === 'SETUJUI' ? 0 : -1000),
    });
  }
  kandidat.sort((a, b) => b.skor - a.skor || a.nominal - b.nominal);

  let sisa = danaTersedia;
  const bayar: ItemRencana[] = [];
  const tunda: ItemRencana[] = [];
  for (const c of kandidat) {
    const rev = c.id.startsWith('kelompok:') ? reviuL2.find((r) => `kelompok:${r.kelompok}` === c.id) : undefined;
    if (rev && rev.putusan !== 'SETUJUI') {
      tunda.push({ ...c, keputusan: 'tunda', alasan: `Rekomendasi reviu: ${rev.putusan.replace('_', ' ')}` });
    } else if (c.nominal <= sisa) {
      sisa -= c.nominal;
      bayar.push({ ...c, keputusan: 'bayar', alasan: 'Prioritas risiko tertinggi & kas cukup' });
    } else {
      tunda.push({ ...c, keputusan: 'tunda', alasan: `Kas di atas kas minimum tinggal ${rp(sisa)}` });
    }
  }
  return {
    danaTersedia: bulat(danaTersedia),
    bayar,
    tunda,
    totalBayar: bulat(jumlah(bayar, (b) => b.nominal)),
    totalTunda: bulat(jumlah(tunda, (t) => t.nominal)),
    sisa: bulat(sisa),
  };
}

// ── 3. Daftar tindakan ──────────────────────────────────────────────────────

export interface Tindakan {
  kunci: string;
  judul: string;
  langkah: string;
  tingkat: Tingkat;
  lini: 'L1' | 'L2' | 'Grup' | 'Data';
  penanggung: string;
  tenggat: string;
  nilai: number | null;
  sumber: Sumber[];
}

/** Kode yang dikenali perintah WA Loonars 2: "M-27" (kelompok) atau "L2-43" (satu pengajuan). */
export function kodeWa(kelompok: string): string {
  return kelompok.startsWith('#') ? `L2-${kelompok.slice(1)}` : kelompok;
}

const HARI_TENGGAT: Record<Tingkat, number> = { kritis: 1, tinggi: 3, sedang: 7, info: 14 };

export function susunTindakan(m: ModelCfo, k: DataKerja, reviuL2: ReviuL2[], reviuMkh: ReviuMkh[]): Tindakan[] {
  const t: Tindakan[] = [];
  const add = (x: Omit<Tindakan, 'tenggat'> & { tenggat?: string }) =>
    t.push({ ...x, tenggat: x.tenggat ?? tambahHari(m.hariIni, HARI_TENGGAT[x.tingkat]) });

  const kosong = Object.entries(k.rekening_terisi).filter(([, v]) => !v).map(([kode]) => kode);
  if (kosong.length) {
    add({
      kunci: 'l2_rekening_belum_diisi', tingkat: 'tinggi', lini: 'L2', penanggung: 'owner', nilai: null,
      judul: `Isi nomor rekening Loonars 2: ${kosong.join(', ')}`,
      langkah: 'Buka MKH Property → Loonars 2 → Rekening, isi bank, nomor, dan nama pemilik rekening A–D. Instruksi transfer WA saat ini masih menampilkan nomor contoh.',
      sumber: [{ tabel: 'loonars2_accounts', ket: 'nomor_rekening' }],
    });
  }
  if (k.alokasi_menunggu.length) {
    const total = jumlah(k.alokasi_menunggu, (a) => a.nominal);
    const receipt = [...new Set(k.alokasi_menunggu.map((a) => a.receipt_id))];
    add({
      kunci: `l2_konfirmasi_alokasi:${receipt.join('-')}`, tingkat: 'tinggi', lini: 'L2', penanggung: 'owner', nilai: bulat(total),
      judul: `Transfer alokasi DP investor ${rp(total)} dari rekening A`,
      langkah: `${k.alokasi_menunggu.map((a) => `A→${a.ke_rekening} ${rpRingkas(angka(a.nominal))} (${a.jenis} ${a.unit})`).join('; ')}. Setelah ditransfer balas "sudah" pada pesan instruksi di WA agar saldo C/B tercatat.`,
      sumber: [{ tabel: 'loonars2_allocations', ket: `receipt #${receipt.join(', #')}` }],
    });
  }
  const tanpaJatuhTempo = m.l2.unit.filter((u) => u.terjual && u.sisaTagihan > 0 && !u.jatuhTempo);
  if (tanpaJatuhTempo.length) {
    add({
      kunci: `l2_jatuh_tempo_kosong:${tanpaJatuhTempo.map((u) => u.kode).join('-')}`, tingkat: 'tinggi', lini: 'L2', penanggung: 'owner',
      nilai: bulat(jumlah(tanpaJatuhTempo, (u) => u.sisaTagihan)),
      judul: `Tetapkan jatuh tempo pelunasan ${tanpaJatuhTempo.map((u) => u.kode).join(', ')}`,
      langkah: `Sisa tagihan ${rp(jumlah(tanpaJatuhTempo, (u) => u.sisaTagihan))} belum punya tanggal jatuh tempo, jadi forecast tidak bisa menghitung kapan uangnya masuk dan pengingat penagihan tidak berjalan. Isi jatuh tempo pelunasan (atau tanggal serah terima) per unit di Loonars 2.`,
      sumber: [{ tabel: 'loonars2_v_unit', ket: 'jatuh_tempo_efektif kosong' }],
    });
  }
  for (const u of m.l2.unit.filter((x) => x.terjual && x.sisaTagihan > 0 && x.jatuhTempo && selisihHari(m.hariIni, x.jatuhTempo) <= 14)) {
    const lewat = u.jatuhTempo! < m.hariIni;
    add({
      kunci: `l2_tagih:${u.kode}`, tingkat: lewat ? 'kritis' : 'tinggi', lini: 'L2', penanggung: 'sales/finance', nilai: u.sisaTagihan,
      judul: `${lewat ? 'Tagih tunggakan' : 'Siapkan penagihan'} ${u.kode} — ${rp(u.sisaTagihan)}`,
      langkah: `Hubungi ${u.pembeli ?? 'pembeli'}; jatuh tempo ${labelTanggal(u.jatuhTempo!)}. Catat pembayaran di Loonars 2 saat diterima.`,
      sumber: [{ tabel: 'loonars2_v_unit', ket: u.kode }],
    });
  }
  if (!m.l1.kas || m.l1.kas.umurHari > 7) {
    add({
      kunci: 'l1_catat_saldo_villa', tingkat: 'sedang', lini: 'L1', penanggung: 'finance villa', nilai: null,
      judul: m.l1.kas ? `Perbarui saldo rekening villa (terakhir ${m.l1.kas.umurHari} hari lalu)` : 'Catat saldo rekening villa',
      langkah: 'Ambil saldo akhir dari mutasi bank rekening villa, lalu catat di MKH Property → AI CFO → Loonars 1 → Kas & bank villa (beserta tanggal saldonya).',
      sumber: [{ tabel: 'cfo_saldo_rekening' }],
    });
  }
  for (const r of reviuL2.filter((x) => x.putusan !== 'SETUJUI' || x.umurHari > 7)) {
    add({
      kunci: `l2_putuskan:${r.kelompok}`, tingkat: r.putusan === 'CEK_DOBEL' ? 'tinggi' : r.umurHari > 7 ? 'tinggi' : 'sedang', lini: 'L2', penanggung: 'owner',
      nilai: r.total,
      judul: `Putuskan pengajuan ${r.kelompok} (${rp(r.total)}) — rekomendasi CFO: ${r.putusan.replace('_', ' ')}`,
      langkah: `${r.alasan.join(' ')} Balas di WA: "setujui ${kodeWa(r.kelompok)}" atau "tolak ${kodeWa(r.kelompok)} <alasan>".`,
      sumber: [{ tabel: 'loonars2_material_requests', ket: `#${r.ids.slice(0, 8).join(', #')}${r.ids.length > 8 ? ', …' : ''}` }],
    });
  }
  const dobelMkh = reviuMkh.filter((r) => r.putusan === 'CEK_DOBEL');
  if (dobelMkh.length) {
    add({
      kunci: `mkh_cek_dobel:${dobelMkh.map((r) => r.id).join('-')}`, tingkat: 'tinggi', lini: 'Grup', penanggung: 'verifikator', nilai: bulat(jumlah(dobelMkh, (r) => r.nominal)),
      judul: `Periksa ${dobelMkh.length} pengajuan MKH yang tampak ganda`,
      langkah: `${dobelMkh.map((r) => `#${r.id} ${r.proyek} ${rpRingkas(r.nominal)}`).join('; ')}. Tolak yang ganda di halaman Verifikasi sebelum ada yang dibayar dua kali.`,
      sumber: [{ tabel: 'pengajuan', ket: 'status pending' }],
    });
  }
  const basi = reviuMkh.filter((r) => r.umurHari > 30);
  if (basi.length) {
    add({
      kunci: 'mkh_antrean_basi', tingkat: 'sedang', lini: 'Grup', penanggung: 'verifikator', nilai: bulat(jumlah(basi, (r) => r.nominal)),
      judul: `Bersihkan ${basi.length} pengajuan MKH yang menunggu > 30 hari (${rp(jumlah(basi, (r) => r.nominal))})`,
      langkah: 'Untuk setiap pengajuan lama: bila sudah dibayar di luar sistem, catat/tolak dengan keterangan; bila batal, tolak. Antrean basi membuat utang tercatat tidak akurat.',
      sumber: [{ tabel: 'pengajuan', ket: 'pending > 30 hari' }],
    });
  }
  for (const p of m.peringatan) {
    if (p.id.startsWith('utang_bank:')) {
      add({
        kunci: p.id, tingkat: p.tingkat, lini: 'Grup', penanggung: 'owner', nilai: p.nilai ?? null,
        judul: `Siapkan penyelesaian: ${p.judul}`,
        langkah: 'Pilih: lunasi dari penjualan unit, ajukan perpanjangan/restrukturisasi ke bank (mulai negosiasi ≥30 hari sebelum jatuh tempo), atau refinancing. Siapkan dokumen & proyeksi kas untuk bank.',
        sumber: p.sumber,
      });
    } else if (p.id.startsWith('defisit_normal:')) {
      add({
        kunci: 'grup_rencana_pendanaan', tingkat: p.tingkat, lini: 'Grup', penanggung: 'owner', nilai: p.nilai ?? null,
        judul: `Susun rencana pendanaan ${rp(p.nilai ?? 0)} sebelum kas defisit`,
        langkah: `${p.isi} Opsi: percepat penjualan & penagihan unit Loonars 2, tunda belanja unit yang belum terjual, negosiasi termin sewa tanah, dana pinjaman. Uji tiap opsi di CEO Challenger.`,
        sumber: p.sumber,
      });
    } else if (p.id === 'l2_sewa_tanah') {
      add({
        kunci: 'l2_sisih_sewa_tanah', tingkat: p.tingkat, lini: 'L2', penanggung: 'owner', nilai: p.nilai ?? null,
        judul: 'Mulai sisihkan dana sewa tanah ke rekening B',
        langkah: p.isi,
        sumber: p.sumber,
      });
    } else if (p.id === 'l1_pajak_hotel') {
      add({ kunci: 'l1_setor_pajak_hotel', tingkat: 'tinggi', lini: 'L1', penanggung: 'finance villa', nilai: p.nilai ?? null, judul: p.judul, langkah: p.isi, sumber: p.sumber });
    } else if (p.id.startsWith('rekon:')) {
      add({ kunci: p.id, tingkat: p.tingkat, lini: 'Data', penanggung: 'finance', nilai: p.nilai ?? null, judul: p.judul.replace('Rekonsiliasi tidak cocok: ', 'Selesaikan selisih: '), langkah: p.isi, sumber: p.sumber });
    } else if (p.id.startsWith('l1_jaminan_rugi:') && p.id.endsWith(m.l1.terakhirFinal?.bulan ?? '—')) {
      add({ kunci: p.id, tingkat: 'tinggi', lini: 'L1', penanggung: 'owner', nilai: p.nilai ?? null, judul: 'Evaluasi skema jaminan investor villa', langkah: `${p.isi} Pertimbangkan strategi okupansi/harga atau peninjauan skema jaminan saat kontrak diperbarui.`, sumber: p.sumber });
    }
  }
  return t;
}

// ── 4. Tutup buku bulanan ───────────────────────────────────────────────────

export interface RingkasBulan {
  periode: string; // YYYY-MM
  l1: { status: string; revenue: number; ebitda: number; okupansiPct: number | null; adr: number | null; bagianMkhBersih: number } | null;
  l2: { masuk: number; keluarKonstruksi: number; keluarLain: number; nilaiKontrak: number; cashInInvestor: number; biayaKonstruksiKas: number; utangToko: number; danaTalangan: number; unitTerjual: number };
  posisi: { kasTotal: number; kewajibanTotal: number; piutangTotal: number };
  forecast: { saldoMinNormal: number; tanggalDefisitNormal: string | null };
  peringatan: Record<Tingkat, number>;
  catatan: string;
}

export function ringkasBulan(m: ModelCfo, bulan: string): RingkasBulan {
  const b = m.l1.bulan.find((x) => x.bulan === bulan) ?? null;
  const a = m.l2.arusKasBulanan.find((x) => x.bulan === bulan);
  const hitung = (t: Tingkat) => m.peringatan.filter((p) => p.tingkat === t).length;
  return {
    periode: bulan,
    l1: b ? { status: b.status, revenue: bulat(b.revenue), ebitda: bulat(b.ebitda), okupansiPct: b.okupansiPct, adr: b.adr === null ? null : bulat(b.adr), bagianMkhBersih: bulat(b.bagianMkhBersih) } : null,
    l2: {
      masuk: bulat(a?.masuk ?? 0),
      keluarKonstruksi: bulat(a?.keluarKonstruksi ?? 0),
      keluarLain: bulat(a?.keluarLain ?? 0),
      nilaiKontrak: m.l2.nilaiKontrak,
      cashInInvestor: m.l2.cashInInvestor,
      biayaKonstruksiKas: m.l2.biayaKonstruksiKas,
      utangToko: m.l2.utangToko,
      danaTalangan: m.l2.danaTalangan,
      unitTerjual: m.l2.unitTerjual,
    },
    posisi: { kasTotal: m.kasTotal, kewajibanTotal: m.ringkasKewajiban.total, piutangTotal: m.piutang.total },
    forecast: { saldoMinNormal: m.arusKas.skenario.normal.saldoMin, tanggalDefisitNormal: m.arusKas.skenario.normal.tanggalDefisit },
    peringatan: { kritis: hitung('kritis'), tinggi: hitung('tinggi'), sedang: hitung('sedang'), info: hitung('info') },
    catatan: `Arus per bulan = transaksi bertanggal di bulan itu; posisi (kas, kewajiban, piutang, kumulatif L2) = saat tutup buku ${m.hariIni}.`,
  };
}

function ubah(label: string, sekarang: number | null, lalu: number | null, satuan: 'rp' | 'pct' = 'rp'): string | null {
  if (sekarang === null || lalu === null) return null;
  const f = (v: number) => (satuan === 'rp' ? rp(v) : persen(v));
  if (lalu === 0) return `${label}: ${f(sekarang)} (bulan lalu ${f(lalu)}).`;
  const d = ((sekarang - lalu) / Math.abs(lalu)) * 100;
  const arah = Math.abs(d) < 0.5 ? 'stabil' : d > 0 ? `naik ${persen(d)}` : `turun ${persen(-d)}`;
  return `${label} ${arah}: ${f(lalu)} → ${f(sekarang)}.`;
}

/** Komentar varians berbasis angka (bukan AI) untuk laporan tutup buku. */
export function komentarVarians(kini: RingkasBulan, lalu: RingkasBulan | null, tindakanTerbuka: Tindakan[]): string {
  const baris: string[] = [`Tutup buku ${labelBulan(kini.periode)}.`];
  if (kini.l1) {
    if (lalu?.l1) {
      for (const s of [
        ubah('Revenue villa', kini.l1.revenue, lalu.l1.revenue),
        ubah('EBITDA villa', kini.l1.ebitda, lalu.l1.ebitda),
        ubah('Okupansi', kini.l1.okupansiPct, lalu.l1.okupansiPct, 'pct'),
        ubah('Bagian MKH setelah jaminan', kini.l1.bagianMkhBersih, lalu.l1.bagianMkhBersih),
      ]) if (s) baris.push(s);
    } else {
      baris.push(`Villa: revenue ${rp(kini.l1.revenue)}, EBITDA ${rp(kini.l1.ebitda)}, okupansi ${kini.l1.okupansiPct === null ? '-' : persen(kini.l1.okupansiPct)}, bagian MKH ${rp(kini.l1.bagianMkhBersih)} (belum ada bulan pembanding yang ditutup).`);
    }
    if (kini.l1.status !== 'final') baris.push('Catatan: laporan villa bulan ini belum berstatus final saat ditutup.');
  } else {
    baris.push('Villa: tidak ada laporan untuk bulan ini.');
  }
  baris.push(`Loonars 2 bulan ini: cash-in investor ${rp(kini.l2.masuk)}, belanja konstruksi ${rp(kini.l2.keluarKonstruksi)}. Kumulatif: ${kini.l2.unitTerjual} unit terjual (kontrak ${rp(kini.l2.nilaiKontrak)}), utang toko ${rp(kini.l2.utangToko)}, dana talangan owner ${rp(kini.l2.danaTalangan)}.`);
  if (lalu) {
    for (const s of [
      ubah('Kas tercatat', kini.posisi.kasTotal, lalu.posisi.kasTotal),
      ubah('Total kewajiban', kini.posisi.kewajibanTotal, lalu.posisi.kewajibanTotal),
      ubah('Dana talangan owner', kini.l2.danaTalangan, lalu.l2.danaTalangan),
    ]) if (s) baris.push(s);
  }
  baris.push(
    kini.forecast.tanggalDefisitNormal
      ? `Forecast normal: kas defisit mulai ${labelTanggal(kini.forecast.tanggalDefisitNormal)} (terendah ${rp(kini.forecast.saldoMinNormal)}).`
      : `Forecast normal: tidak defisit dalam 182 hari (terendah ${rp(kini.forecast.saldoMinNormal)}).`,
  );
  const top = [...tindakanTerbuka].sort((a, b) => ['kritis', 'tinggi', 'sedang', 'info'].indexOf(a.tingkat) - ['kritis', 'tinggi', 'sedang', 'info'].indexOf(b.tingkat)).slice(0, 3);
  if (top.length) baris.push(`Prioritas bulan depan: ${top.map((x, i) => `${i + 1}) ${x.judul}`).join('; ')}.`);
  return baris.join('\n');
}

/** Periode (YYYY-MM) yang perlu ditutup sekarang, atau null. */
export function siapTutupBuku(m: ModelCfo, k: DataKerja): string | null {
  const bulanLalu = tambahBulan(m.hariIni.slice(0, 7), -1);
  if (k.laporan_bulanan.some((l) => l.periode.slice(0, 7) === bulanLalu)) return null;
  const hari = Number(m.hariIni.slice(8, 10));
  if (hari < 2) return null;
  const l1 = m.l1.bulan.find((b) => b.bulan === bulanLalu);
  // Tunggu laporan villa final (dikirim ulang villa-api tgl 1–5); paling lambat tgl 6 tetap ditutup.
  if (l1 && l1.status !== 'final' && hari < 6) return null;
  return bulanLalu;
}

export function laporanSebelum(k: DataKerja, bulan: string): RingkasBulan | null {
  const lalu = tambahBulan(bulan, -1);
  return k.laporan_bulanan.find((l) => l.periode.slice(0, 7) === lalu)?.data ?? null;
}

// ── Gabungan ────────────────────────────────────────────────────────────────

export type KerjaCfo = ReturnType<typeof susunKerjaCfo>;

export function susunKerjaCfo(m: ModelCfo, k: DataKerja) {
  const reviuL2 = reviuPengajuanL2(m, k);
  const reviuMkh = reviuPengajuanMkh(k, m.hariIni);
  const tindakan = susunTindakan(m, k, reviuL2, reviuMkh);
  const rencana = rencanaPembayaran(m, reviuL2);
  const terbukaDb = k.tindakan.filter((x) => x.status === 'terbuka');
  const lewatTenggat = terbukaDb.filter((x) => x.tenggat && x.tenggat < m.hariIni);
  return {
    reviuL2,
    reviuMkh,
    tindakan,
    rencana,
    tindakanDb: k.tindakan,
    terbukaDb,
    lewatTenggat,
    laporanBulanan: k.laporan_bulanan,
    ringkasReviu: {
      l2Kelompok: reviuL2.length,
      l2Total: bulat(jumlah(reviuL2, (r) => r.total)),
      l2Setujui: reviuL2.filter((r) => r.putusan === 'SETUJUI').length,
      l2Tahan: reviuL2.filter((r) => r.putusan === 'TAHAN').length,
      l2Dobel: reviuL2.filter((r) => r.putusan === 'CEK_DOBEL').length,
      mkhJumlah: reviuMkh.length,
      mkhTotal: bulat(jumlah(reviuMkh, (r) => r.nominal)),
      mkhDobel: reviuMkh.filter((r) => r.putusan === 'CEK_DOBEL').length,
      mkhBasi: reviuMkh.filter((r) => r.umurHari > 30).length,
      medianUmurMkh: median(reviuMkh.map((r) => r.umurHari)),
    },
  };
}
