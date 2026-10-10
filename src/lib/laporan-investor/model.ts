/**
 * Penyusun model Laporan Investor.
 *
 * Satu fungsi murni (`susunModel`) dipakai di tiga tempat — pratinjau di
 * browser, PDF di server, dan permintaan lewat WhatsApp — sehingga angka di
 * ketiganya selalu sama. Data mentah berasal dari RPC `ir_ambil_data`
 * (migrasi 0040) dan selalu terbaru (modul realtime, keputusan owner
 * 2026-10-10).
 *
 * Tidak ada rumus akuntansi baru: semua angka buku besar dihitung dengan
 * fungsi yang sudah dipakai laporan SAK EMKM aplikasi (`susunLaporan`,
 * `ringkasanPeriode`, `hitungSaldo`, `saldoKategori`). Modul ini hanya
 * memilih baris jurnal milik unit bisnis dan menyusun hasilnya per bulan.
 *
 * Tidak ada nama properti yang di-hardcode: semua berasal dari
 * `ir_unit_bisnis`. Menambah properti = menambah baris data.
 */

import { ringkasanPeriode, susunLaporan, type PaketLaporan } from '@/lib/akuntansi/sak-emkm';
import { hitungSaldo, jurnalSampai, normalisasiJurnal, saldoAkun, saldoKategori } from '@/lib/akuntansi/saldo';
import { AKUN_KAS } from '@/lib/master';
import { NAMA_BULAN, NAMA_BULAN_PENDEK, hariTerakhir, type Periode } from '@/lib/periode';
import type { Jurnal, JurnalRow } from '@/types';
import { BAGIAN_LAPORAN, type KunciBagian, type KunciNarasi } from './kontrak';

// ── Bentuk data dari ir_ambil_data ──────────────────────────────────────

export interface UnitBisnis {
  id: number;
  kode: string;
  nama: string;
  jenis: 'operasi_properti' | 'proyek_pembangunan';
  kota: string | null;
  tgl_mulai_operasi: string | null;
  jumlah_unit_total: number | null;
  jumlah_unit_dijual: number | null;
  model_kepemilikan: string | null;
  kode_proyek_jurnal: string[];
  sumber_data: string;
  pakai_tabel_villa_lama: boolean;
  aktif: boolean;
  catatan: string | null;
}

export interface MetrikRow {
  id: number;
  unit_id: number;
  periode: string;
  sumber: string;
  metrik: Record<string, unknown>;
  versi_definisi: string;
  status: 'sementara' | 'final';
  dihitung_pada: string;
  diterima_pada: string;
  revisi: number;
}

export interface DataLaporan {
  peminta: string;
  diambil_pada: string;
  unit_bisnis: UnitBisnis[];
  jurnal: Omit<JurnalRow, 'ket'>[];
  pendapatan_villa: { periode: string; kategori: string; jumlah: number | string; sumber: string; diubah: string }[];
  beban_villa: { periode: string; kategori: string; jumlah: number | string; sumber: string }[];
  utang_bank: { proyek: string; jenis: string | null; bank: string | null; pokok: number | string; terbayar: number | string; tgl_akad: string | null; jt_tempo: string | null }[];
  aset_ringkas: { proyek: string; status: string; jumlah: number; nilai: number | string }[];
  metrik: MetrikRow[];
  narasi: Partial<Record<KunciNarasi, { isi: string; dibuat_pada: string; dibuat_oleh: string }>>;
}

export interface OpsiLaporan {
  /** Kode unit bisnis yang dimasukkan; kosong = semua unit aktif. */
  unit: string[];
  /** 'YYYY-MM' inklusif. */
  dari: string;
  sampai: string;
  bagian: KunciBagian[];
}

// ── Model hasil ─────────────────────────────────────────────────────────

export type StatusBulan = 'lengkap' | 'sebagian' | 'sementara' | 'kosong' | 'belum_mulai';

export interface BulanBukuBesar {
  pendapatan: number;
  hpp: number;
  beban: number;
  laba: number;
  kas: number;
  liabilitas: number;
  gaji: number;
  jumlahTransaksi: number;
}

export interface BulanUnit {
  periode: string;
  label: string;
  status: StatusBulan;
  /** Bulan pertama operasi yang tidak penuh, atau bulan sebelum buka resmi. */
  parsial: boolean;
  praBuka: boolean;
  bukuBesar: BulanBukuBesar | null;
  /** Gabungan metrik kiriman (kunci kontrak → nilai), beserta asal tiap kunci. */
  metrik: Record<string, unknown>;
  asalMetrik: Record<string, string>;
  /** Pendapatan dari tabel lama pendapatan_villa (basis investor + non-kamar). */
  pendapatanLama: { rental: number; nonKamar: number; total: number; sumber: string } | null;
  bebanLama: number | null;
  revisi: number;
  catatan: string[];
}

export interface UnitLaporan {
  unit: UnitBisnis;
  bulan: BulanUnit[];
  total: {
    pendapatan: number | null;
    laba: number | null;
    kasAkhir: number | null;
    liabilitasAkhir: number | null;
    pendapatanBasisInvestor: number | null;
  };
  utangBank: { jenis: string; bank: string; sisa: number; jatuhTempo: string | null }[];
  aset: { status: string; jumlah: number; nilai: number }[];
}

export type TingkatTemuan = 'perhatian' | 'info';

export interface Temuan {
  tingkat: TingkatTemuan;
  unit: string | null;
  teks: string;
}

export interface ModelLaporan {
  opsi: OpsiLaporan;
  dibuatPada: string;
  peminta: string;
  labelRentang: string;
  periode: Periode;
  bulan: string[];
  unit: UnitLaporan[];
  /** Laporan SAK EMKM gabungan unit terpilih (kode proyek jurnal mereka). */
  keuangan: PaketLaporan | null;
  kodeProyekKeuangan: string[];
  /** Tren gabungan per bulan dari buku besar. */
  trenBukuBesar: { periode: string; label: string; pendapatan: number; laba: number; kas: number }[];
  narasi: DataLaporan['narasi'];
  temuan: Temuan[];
  kelengkapan: Record<StatusBulan, number>;
  bagian: Set<KunciBagian>;
}

// ── Bantuan periode ─────────────────────────────────────────────────────

function keIndeks(p: string): number {
  const [t, b] = p.split('-').map(Number);
  return t * 12 + (b - 1);
}

function dariIndeks(i: number): string {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function daftarBulan(dari: string, sampai: string): string[] {
  const a = keIndeks(dari);
  const b = keIndeks(sampai);
  const out: string[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(dariIndeks(i));
  return out;
}

export function labelBulan(p: string, pendek = false): string {
  const [t, b] = p.split('-').map(Number);
  return `${(pendek ? NAMA_BULAN_PENDEK : NAMA_BULAN)[b - 1]} ${t}`;
}

function periodeBulan(p: string): Periode {
  const [t, b] = p.split('-').map(Number);
  return { tahunMulai: t, bulanMulai: b, tahunSelesai: t, bulanSelesai: b };
}

export function bulanIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Bulan paling awal yang punya data apa pun — dipakai untuk "sampai saat ini". */
export function bulanDataPertama(data: DataLaporan): string {
  const kandidat: string[] = [];
  for (const j of data.jurnal) if (j.tgl) kandidat.push(j.tgl.slice(0, 7));
  for (const v of data.pendapatan_villa) kandidat.push(v.periode);
  for (const m of data.metrik) kandidat.push(m.periode);
  for (const u of data.unit_bisnis) if (u.tgl_mulai_operasi) kandidat.push(u.tgl_mulai_operasi.slice(0, 7));
  return kandidat.length ? kandidat.sort()[0] : bulanIni();
}

function angka(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Kunci inti yang menandai satu bulan operasi properti sebagai "lengkap". */
const KUNCI_INTI_OPERASI = ['okupansi_unit_total_pct', 'pendapatan_kotor', 'booking_diakui', 'headcount_total'];

// ── Penyusun utama ──────────────────────────────────────────────────────

export function susunModel(data: DataLaporan, opsi: OpsiLaporan): ModelLaporan {
  const bulan = daftarBulan(opsi.dari, opsi.sampai);
  const periode: Periode = {
    ...periodeBulan(bulan[0]),
    tahunSelesai: periodeBulan(bulan[bulan.length - 1]).tahunSelesai,
    bulanSelesai: periodeBulan(bulan[bulan.length - 1]).bulanSelesai,
  };

  const semuaAktif = data.unit_bisnis.filter((u) => u.aktif);
  const terpilih = opsi.unit.length
    ? data.unit_bisnis.filter((u) => opsi.unit.includes(u.kode))
    : semuaAktif;

  const jurnalSemua: Jurnal[] = normalisasiJurnal(data.jurnal.map((j) => ({ ...j, ket: '' })));
  const temuan: Temuan[] = [];

  // Kode proyek jurnal yang tidak dimiliki unit bisnis mana pun → tidak
  // pernah masuk laporan per unit. Dilaporkan, bukan disembunyikan.
  const kodeTerdaftar = new Set(data.unit_bisnis.flatMap((u) => u.kode_proyek_jurnal));
  const kodeYatim = Array.from(new Set(jurnalSemua.map((j) => j.proyek).filter((p) => p && !kodeTerdaftar.has(p))));
  if (kodeYatim.length) {
    temuan.push({
      tingkat: 'perhatian',
      unit: null,
      teks: `Ada jurnal dengan kode proyek yang belum terdaftar sebagai unit bisnis: ${kodeYatim.join(', ')}. Angkanya ikut laporan keuangan gabungan bila semua unit dipilih, tetapi tidak tampil di portofolio per unit.`,
    });
  }

  const unitLaporan = terpilih.map((u) => susunUnit(u, bulan, data, jurnalSemua, temuan));

  // Laporan keuangan gabungan (SAK EMKM) untuk kode proyek unit terpilih.
  // Bila semua unit aktif dipilih, seluruh jurnal ikut (termasuk kode yatim)
  // agar sama persis dengan Laporan Keuangan perusahaan.
  const semuaDipilih = opsi.unit.length === 0;
  const kodeProyekKeuangan = semuaDipilih
    ? Array.from(new Set(jurnalSemua.map((j) => j.proyek).filter(Boolean)))
    : Array.from(new Set(terpilih.flatMap((u) => u.kode_proyek_jurnal)));
  const jurnalKeuangan = semuaDipilih
    ? jurnalSemua
    : jurnalSemua.filter((j) => kodeProyekKeuangan.includes(j.proyek));
  const keuangan = jurnalKeuangan.length ? susunLaporan(jurnalKeuangan, periode) : null;

  if (keuangan && !keuangan.posisiKeuangan.seimbang) {
    temuan.push({
      tingkat: 'perhatian',
      unit: null,
      teks: `Posisi keuangan tidak seimbang: selisih aset vs liabilitas+ekuitas Rp ${Math.round(keuangan.posisiKeuangan.selisih).toLocaleString('id-ID')}. Ada entri jurnal yang debet ≠ kredit.`,
    });
  }
  if (keuangan && keuangan.akunAsing.length) {
    temuan.push({
      tingkat: 'info',
      unit: null,
      teks: `Akun di luar bagan akun (dikelompokkan dari digit pertama kodenya): ${keuangan.akunAsing.map((a) => `${a.kode} ${a.nama}`).join('; ')}.`,
    });
  }

  const trenBukuBesar = bulan.map((p) => {
    const r = ringkasanPeriode(jurnalKeuangan, periodeBulan(p));
    return { periode: p, label: labelBulan(p, true), pendapatan: r.pendapatan, laba: r.labaBersih, kas: r.kas };
  });

  const kelengkapan: Record<StatusBulan, number> = { lengkap: 0, sebagian: 0, sementara: 0, kosong: 0, belum_mulai: 0 };
  for (const u of unitLaporan) for (const b of u.bulan) kelengkapan[b.status] += 1;

  const bagian = new Set<KunciBagian>(opsi.bagian.length ? opsi.bagian : BAGIAN_LAPORAN.map((b) => b.kunci));

  return {
    opsi,
    dibuatPada: data.diambil_pada,
    peminta: data.peminta,
    labelRentang:
      bulan.length === 1 ? labelBulan(bulan[0]) : `${labelBulan(bulan[0])} – ${labelBulan(bulan[bulan.length - 1])}`,
    periode,
    bulan,
    unit: unitLaporan,
    keuangan,
    kodeProyekKeuangan,
    trenBukuBesar,
    narasi: data.narasi,
    temuan,
    kelengkapan,
    bagian,
  };
}

function susunUnit(
  u: UnitBisnis,
  bulan: string[],
  data: DataLaporan,
  jurnalSemua: Jurnal[],
  temuan: Temuan[],
): UnitLaporan {
  const jurnalUnit = u.kode_proyek_jurnal.length
    ? jurnalSemua.filter((j) => u.kode_proyek_jurnal.includes(j.proyek))
    : [];
  const metrikUnit = data.metrik.filter((m) => m.unit_id === u.id);
  const mulai = u.tgl_mulai_operasi ? u.tgl_mulai_operasi.slice(0, 7) : null;

  const hasilBulan: BulanUnit[] = bulan.map((p) => {
    const catatan: string[] = [];
    const sebelumMulai = mulai !== null && p < mulai;
    const bulanMulai = mulai !== null && p === mulai;
    let parsial = false;
    if (bulanMulai && u.tgl_mulai_operasi) {
      const hari = Number(u.tgl_mulai_operasi.slice(8, 10));
      const [t, b] = p.split('-').map(Number);
      if (hari > 1) {
        parsial = true;
        catatan.push(`Bulan parsial: operasi dimulai ${hari} ${NAMA_BULAN[b - 1]} ${t} (${hariTerakhir(t, b) - hari + 1} hari).`);
      }
    }

    // Buku besar
    let bukuBesar: BulanBukuBesar | null = null;
    if (u.kode_proyek_jurnal.length) {
      const per = periodeBulan(p);
      const r = ringkasanPeriode(jurnalUnit, per);
      const selesai = `${p}-${String(hariTerakhir(per.tahunSelesai, per.bulanSelesai)).padStart(2, '0')}`;
      const kumulatif = hitungSaldo(jurnalSampai(jurnalUnit, selesai));
      const liabilitas = saldoKategori('Liabilitas Lancar', kumulatif) + saldoKategori('Liabilitas Panjang', kumulatif);
      const gaji = saldoAkun('6-1001', r.petaPeriode);
      bukuBesar = {
        pendapatan: r.pendapatan,
        hpp: r.hpp,
        beban: r.opex,
        laba: r.labaBersih,
        kas: r.kas,
        liabilitas,
        gaji,
        jumlahTransaksi: r.jumlahTransaksi,
      };
    }

    // Metrik kiriman: digabung per kunci; bila dua sumber mengirim kunci yang
    // sama, yang terakhir diterima dipakai dan perbedaannya dicatat.
    const metrik: Record<string, unknown> = {};
    const asalMetrik: Record<string, string> = {};
    let revisi = 0;
    let adaSementara = false;
    const baris = metrikUnit.filter((m) => m.periode === p).sort((a, b) => a.diterima_pada.localeCompare(b.diterima_pada));
    for (const m of baris) {
      revisi += m.revisi;
      if (m.status === 'sementara') adaSementara = true;
      for (const [k, v] of Object.entries(m.metrik)) {
        if (k in metrik && JSON.stringify(metrik[k]) !== JSON.stringify(v)) {
          catatan.push(`"${k}" berbeda antara sumber ${asalMetrik[k]} dan ${m.sumber}; dipakai ${m.sumber} (terbaru).`);
        }
        metrik[k] = v;
        asalMetrik[k] = m.sumber;
      }
    }
    if (revisi > 0) catatan.push(`Angka bulan ini sudah direvisi ${revisi}× oleh sumbernya (riwayat tersimpan).`);

    // Tabel lama pendapatan_villa / beban_villa
    let pendapatanLama: BulanUnit['pendapatanLama'] = null;
    let bebanLama: number | null = null;
    if (u.pakai_tabel_villa_lama) {
      const rows = data.pendapatan_villa.filter((v) => v.periode === p);
      if (rows.length) {
        const rental = rows.filter((v) => v.kategori === 'rental').reduce((s, v) => s + Number(v.jumlah), 0);
        const nonKamar = rows.filter((v) => v.kategori !== 'rental').reduce((s, v) => s + Number(v.jumlah), 0);
        pendapatanLama = {
          rental,
          nonKamar,
          total: rental + nonKamar,
          sumber: Array.from(new Set(rows.map((v) => v.sumber))).join(', '),
        };
        const kiriman = angka(metrik.pendapatan_basis_investor);
        if (kiriman !== null && Math.abs(kiriman - rental) >= 1) {
          catatan.push(
            `Pendapatan basis investor tidak sama antara sinkronisasi bulanan (Rp ${Math.round(rental).toLocaleString('id-ID')}) dan snapshot KPI (Rp ${Math.round(kiriman).toLocaleString('id-ID')}). Keduanya ditampilkan apa adanya.`,
          );
        }
      }
      const beban = data.beban_villa.filter((b) => b.periode === p);
      if (beban.length) bebanLama = beban.reduce((s, b) => s + Number(b.jumlah), 0);
    }

    // Gaji: buku besar diutamakan; kiriman MK Connect hanya bila buku besar kosong.
    if (bukuBesar && bukuBesar.gaji > 0 && angka(metrik.total_gaji) !== null) {
      catatan.push('Gaji tersedia di buku besar dan di kiriman MK Connect; yang dipakai buku besar (tidak dijumlahkan).');
    }

    // Status kelengkapan
    let status: StatusBulan;
    if (u.jenis === 'proyek_pembangunan') {
      status = bukuBesar && bukuBesar.jumlahTransaksi > 0 ? 'lengkap' : 'kosong';
    } else if (sebelumMulai && !baris.length && !pendapatanLama) {
      status = 'belum_mulai';
    } else {
      const adaInti = KUNCI_INTI_OPERASI.filter((k) => k in metrik).length;
      if (adaInti === KUNCI_INTI_OPERASI.length) status = adaSementara ? 'sementara' : 'lengkap';
      else if (adaInti > 0 || pendapatanLama) status = 'sebagian';
      else status = 'kosong';
    }
    if (sebelumMulai && (baris.length || pendapatanLama)) {
      catatan.push('Ada data sebelum tanggal buka resmi — ditampilkan terpisah sebagai "pra-buka".');
    }

    return {
      periode: p,
      label: labelBulan(p),
      status,
      parsial,
      praBuka: sebelumMulai,
      bukuBesar,
      metrik,
      asalMetrik,
      pendapatanLama,
      bebanLama,
      revisi,
      catatan,
    };
  });

  // Temuan tingkat unit
  const terakhir = hasilBulan[hasilBulan.length - 1];
  if (terakhir?.bukuBesar && terakhir.bukuBesar.kas < 0) {
    temuan.push({
      tingkat: 'perhatian',
      unit: u.nama,
      teks: `Saldo kas/bank proyek negatif (Rp ${Math.round(terakhir.bukuBesar.kas).toLocaleString('id-ID')}) pada akhir ${terakhir.label}: pengeluaran dibukukan tanpa kas masuk/transfer dana ke proyek ini.`,
    });
  }
  const kosongOperasi = hasilBulan.filter((b) => u.jenis === 'operasi_properti' && !b.praBuka && b.status === 'kosong');
  if (kosongOperasi.length) {
    temuan.push({
      tingkat: 'info',
      unit: u.nama,
      teks: `Belum ada data KPI operasi untuk: ${kosongOperasi.map((b) => b.label).join(', ')}.`,
    });
  }
  if (u.jenis === 'operasi_properti') {
    const tanpaHeadcount = hasilBulan.filter((b) => !b.praBuka && b.status !== 'belum_mulai' && !('headcount_total' in b.metrik));
    if (tanpaHeadcount.length) {
      temuan.push({
        tingkat: 'info',
        unit: u.nama,
        teks: `Headcount belum dikirim MK Connect untuk ${tanpaHeadcount.map((b) => b.label).join(', ')} — rasio unit per karyawan dan gaji % pendapatan bulan itu belum bisa dihitung.`,
      });
    }
    if (u.jumlah_unit_dijual === null && !hasilBulan.some((b) => 'unit_dijual' in b.metrik)) {
      temuan.push({ tingkat: 'info', unit: u.nama, teks: 'Jumlah unit dijual belum tersedia — okupansi hanya bisa dilaporkan atas unit total.' });
    }
  }

  // Ringkasan
  const bb = hasilBulan.map((b) => b.bukuBesar).filter((x): x is BulanBukuBesar => x !== null);
  const pendapatanBasis = hasilBulan
    .map((b) => b.pendapatanLama?.rental ?? angka(b.metrik.pendapatan_basis_investor))
    .filter((x): x is number => x !== null);

  const utangBank = data.utang_bank
    .filter((x) => u.kode_proyek_jurnal.includes(x.proyek))
    .map((x) => ({
      jenis: x.jenis ?? '-',
      bank: x.bank ?? '-',
      sisa: Number(x.pokok) - Number(x.terbayar),
      jatuhTempo: x.jt_tempo,
    }));
  const aset = data.aset_ringkas
    .filter((x) => u.kode_proyek_jurnal.includes(x.proyek))
    .map((x) => ({ status: x.status, jumlah: Number(x.jumlah), nilai: Number(x.nilai) }));

  return {
    unit: u,
    bulan: hasilBulan,
    total: {
      pendapatan: bb.length ? bb.reduce((s, x) => s + x.pendapatan, 0) : null,
      laba: bb.length ? bb.reduce((s, x) => s + x.laba, 0) : null,
      kasAkhir: bb.length ? bb[bb.length - 1].kas : null,
      liabilitasAkhir: bb.length ? bb[bb.length - 1].liabilitas : null,
      pendapatanBasisInvestor: pendapatanBasis.length ? pendapatanBasis.reduce((s, x) => s + x, 0) : null,
    },
    utangBank,
    aset,
  };
}

/** Akun kas yang dipakai — diekspor untuk lampiran. */
export const AKUN_KAS_LAPORAN = AKUN_KAS;

export function nilaiMetrik(b: BulanUnit, kunci: string): number | null {
  return angka(b.metrik[kunci]);
}
