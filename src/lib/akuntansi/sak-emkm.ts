/**
 * Penyusun laporan keuangan berbasis SAK EMKM.
 *
 * SAK EMKM (Standar Akuntansi Keuangan Entitas Mikro, Kecil, dan Menengah —
 * IAI, efektif 1 Januari 2018) mewajibkan MINIMAL tiga laporan:
 *   1. Laporan Posisi Keuangan (neraca) pada akhir periode
 *   2. Laporan Laba Rugi selama periode
 *   3. Catatan atas Laporan Keuangan (CALK)
 *
 * Laporan Arus Kas dan Laporan Perubahan Ekuitas TIDAK diwajibkan SAK EMKM
 * (keduanya syarat SAK ETAP / SAK Umum). Keduanya tetap disusun di sini karena
 * versi HTML lama sudah menyediakannya dan berguna secara manajerial, tetapi
 * di UI ditandai eksplisit sebagai "laporan tambahan di luar syarat minimum
 * SAK EMKM" agar penyajiannya tidak menyesatkan.
 *
 * Perbedaan penting dari versi HTML lama:
 * - Neraca sekarang kumulatif sejak awal berdiri s.d. akhir periode (sebelumnya
 *   hanya menjumlah mutasi satu tahun, yang membuat neraca tidak pernah benar).
 * - Saldo laba dipecah menjadi "saldo awal periode" (akumulasi laba sebelum
 *   periode) dan "laba periode berjalan", sehingga Aset = Liabilitas + Ekuitas
 *   selalu seimbang selama setiap entri jurnal seimbang.
 * - Arus kas memakai metode langsung dengan klasifikasi per nomor transaksi,
 *   bukan taksiran kasar dari total debet/kredit.
 */

import { AKUN_KAS, COA, getAkun } from '@/lib/master';
import type { Periode } from '@/lib/periode';
import { labelPeriodeLaporan, labelTanggalPosisi, rentang } from '@/lib/periode';
import type { Jurnal, KategoriAkun } from '@/types';
import {
  akunDiluarCoa,
  hitungSaldo,
  jurnalDalamRentang,
  jurnalSampai,
  jurnalSebelum,
  labaBersihDari,
  saldoAkun,
  saldoKategori,
  totalKas,
  type PetaSaldo,
} from './saldo';

export interface BarisPos {
  kode: string;
  nama: string;
  nilai: number;
}

export interface KelompokPos {
  judul: string;
  baris: BarisPos[];
  total: number;
}

export interface LaporanLabaRugi {
  pendapatan: KelompokPos;
  bebanPokok: KelompokPos;
  labaKotor: number;
  bebanOperasional: KelompokPos;
  labaSebelumPajak: number;
  /** SAK EMKM mensyaratkan pos beban pajak penghasilan disajikan terpisah. */
  bebanPajak: number;
  labaBersih: number;
}

export interface LaporanPosisiKeuangan {
  asetLancar: KelompokPos;
  asetTetap: KelompokPos;
  totalAset: number;
  liabilitasLancar: KelompokPos;
  liabilitasPanjang: KelompokPos;
  totalLiabilitas: number;
  modal: number;
  saldoLabaAwal: number;
  labaPeriodeBerjalan: number;
  saldoLabaAkhir: number;
  totalEkuitas: number;
  totalLiabilitasEkuitas: number;
  selisih: number;
  seimbang: boolean;
}

export interface LaporanPerubahanEkuitas {
  modalAwal: number;
  saldoLabaAwal: number;
  totalAwal: number;
  tambahanModal: number;
  labaPeriodeBerjalan: number;
  modalAkhir: number;
  saldoLabaAkhir: number;
  totalAkhir: number;
}

export interface KomponenArusKas {
  judul: string;
  baris: BarisPos[];
  total: number;
}

export interface LaporanArusKas {
  operasi: KomponenArusKas;
  investasi: KomponenArusKas;
  pendanaan: KomponenArusKas;
  kenaikanBersih: number;
  kasAwal: number;
  kasAkhir: number;
  /** Selisih antara kas akhir hasil klasifikasi dan saldo buku besar kas. */
  selisih: number;
}

export interface BarisNeracaSaldo {
  kode: string;
  nama: string;
  kat: KategoriAkun | '';
  D: number;
  K: number;
  saldo: number;
}

export interface PaketLaporan {
  periode: Periode;
  rentang: { mulai: string; selesai: string };
  labelPeriode: string;
  labelTanggalPosisi: string;
  labaRugi: LaporanLabaRugi;
  posisiKeuangan: LaporanPosisiKeuangan;
  perubahanEkuitas: LaporanPerubahanEkuitas;
  arusKas: LaporanArusKas;
  neracaSaldo: BarisNeracaSaldo[];
  totalNeracaSaldoD: number;
  totalNeracaSaldoK: number;
  rincianKas: BarisPos[];
  jumlahTransaksi: number;
  /**
   * Akun yang dipakai di jurnal tapi tidak terdaftar di COA aplikasi.
   * Biasanya berasal dari sistem lain (mkhsistem) lewat sync_inbound.
   * Nilainya tetap ikut dihitung, tapi perlu ditampilkan agar bisa
   * ditindaklanjuti — idealnya kode itu didaftarkan ke `src/lib/master.ts`.
   */
  akunAsing: { kode: string; nama: string }[];
  /** Peta saldo kumulatif s.d. akhir periode (dipakai neraca & CALK). */
  petaKumulatif: PetaSaldo;
  /** Peta saldo mutasi dalam periode (dipakai laba rugi). */
  petaPeriode: PetaSaldo;
}

const URUT_KATEGORI: KategoriAkun[] = [
  'Aset Lancar',
  'Aset Tetap',
  'Liabilitas Lancar',
  'Liabilitas Panjang',
  'Ekuitas',
  'Pendapatan',
  'HPP',
  'Beban Operasional',
];

function kelompok(
  judul: string,
  kat: KategoriAkun,
  peta: PetaSaldo,
  opsi: { sembunyikanNol?: boolean } = {},
): KelompokPos {
  const baris = COA.filter((a) => a.kat === kat).map((a) => ({
    kode: a.kode,
    nama: a.namaLaporan,
    nilai: saldoAkun(a.kode, peta),
  }));

  // Akun yang dipakai jurnal tapi tidak ada di COA aplikasi — mis. kode akun
  // yang dikirim mkhsistem lewat sync_inbound. Tanpa baris ini nilainya tidak
  // akan pernah masuk total kelompok, dan neraca jadi timpang tanpa jejak.
  const tambahan = Object.values(peta)
    .filter((a) => a.diluarCoa && a.kat === kat)
    .map((a) => ({ kode: a.kode, nama: `${a.namaLaporan} (di luar COA)`, nilai: saldoAkun(a.kode, peta) }));

  const semua = [...baris, ...tambahan].filter((b) =>
    opsi.sembunyikanNol ? Math.abs(b.nilai) > 0.5 : true,
  );
  return { judul, baris: semua, total: semua.reduce((s, b) => s + b.nilai, 0) };
}

/**
 * Klasifikasi arus kas metode langsung.
 *
 * Setiap nomor transaksi (`jurnal.no`) diperlakukan sebagai satu jurnal
 * majemuk: mutasi kas bersihnya dihitung dari akun kas, lalu diklasifikasikan
 * berdasarkan akun lawan (non-kas) di transaksi yang sama.
 */
type Klasifikasi = 'operasi' | 'investasi' | 'pendanaan';

function klasifikasiAkun(kode: string): Klasifikasi {
  const akun = getAkun(kode);
  if (!akun) return 'operasi';
  if (akun.kat === 'Aset Tetap') return 'investasi';
  if (akun.kat === 'Ekuitas') return 'pendanaan';
  if (akun.kat === 'Liabilitas Panjang') return 'pendanaan';
  if (kode === '2-1004') return 'pendanaan'; // Utang bank jangka pendek
  return 'operasi';
}

function susunArusKas(jurnalPeriode: Jurnal[], kasAwal: number, kasAkhirBuku: number): LaporanArusKas {
  const setKas = new Set(AKUN_KAS);

  // Kelompokkan per nomor transaksi; transaksi tanpa nomor berdiri sendiri.
  const perTransaksi = new Map<string, Jurnal[]>();
  jurnalPeriode.forEach((j, i) => {
    const key = j.no ? `no:${j.no}` : `row:${j.id ?? i}`;
    const arr = perTransaksi.get(key);
    if (arr) arr.push(j);
    else perTransaksi.set(key, [j]);
  });

  const akumulasi: Record<Klasifikasi, Map<string, number>> = {
    operasi: new Map(),
    investasi: new Map(),
    pendanaan: new Map(),
  };

  for (const baris of perTransaksi.values()) {
    const mutasiKas = baris
      .filter((j) => setKas.has(j.akun))
      .reduce((s, j) => s + j.D - j.K, 0);
    if (Math.abs(mutasiKas) < 0.5) continue; // transaksi non-kas (mis. akrual)

    const lawan = baris.filter((j) => !setKas.has(j.akun));
    if (lawan.length === 0) continue; // mutasi antar rekening kas — bukan arus kas keluar/masuk perusahaan

    const totalLawan = lawan.reduce((s, j) => s + Math.abs(j.D - j.K), 0) || 1;
    for (const j of lawan) {
      const bobot = Math.abs(j.D - j.K) / totalLawan;
      const kls = klasifikasiAkun(j.akun);
      const map = akumulasi[kls];
      map.set(j.akun, (map.get(j.akun) ?? 0) + mutasiKas * bobot);
    }
  }

  const bangun = (judul: string, kls: Klasifikasi): KomponenArusKas => {
    const baris = [...akumulasi[kls].entries()]
      .map(([kode, nilai]) => ({
        kode,
        nama: getAkun(kode)?.namaLaporan ?? kode,
        nilai,
      }))
      .filter((b) => Math.abs(b.nilai) > 0.5)
      .sort((a, b) => a.kode.localeCompare(b.kode));
    return { judul, baris, total: baris.reduce((s, b) => s + b.nilai, 0) };
  };

  const operasi = bangun('Arus Kas dari Aktivitas Operasi', 'operasi');
  const investasi = bangun('Arus Kas dari Aktivitas Investasi', 'investasi');
  const pendanaan = bangun('Arus Kas dari Aktivitas Pendanaan', 'pendanaan');
  const kenaikanBersih = operasi.total + investasi.total + pendanaan.total;

  return {
    operasi,
    investasi,
    pendanaan,
    kenaikanBersih,
    kasAwal,
    kasAkhir: kasAwal + kenaikanBersih,
    selisih: kasAkhirBuku - (kasAwal + kenaikanBersih),
  };
}

/**
 * Susun seluruh paket laporan untuk satu periode.
 *
 * @param jurnal Seluruh jurnal (tidak difilter periode) — pemfilteran dilakukan
 *   di dalam, karena neraca butuh data sejak awal berdiri sedangkan laba rugi
 *   hanya butuh mutasi periode.
 * @param bebanPajak Beban pajak penghasilan periode berjalan, diisi manual oleh
 *   pengguna. Tidak ada akun pajak di COA, jadi nilai ini tidak diambil dari
 *   jurnal dan default-nya 0.
 */
export function susunLaporan(
  jurnal: Jurnal[],
  periode: Periode,
  opsi: { bebanPajak?: number } = {},
): PaketLaporan {
  const r = rentang(periode);
  const bebanPajak = opsi.bebanPajak ?? 0;

  const jurnalPeriode = jurnalDalamRentang(jurnal, r.mulai, r.selesai);
  const jurnalKumulatif = jurnalSampai(jurnal, r.selesai);
  const jurnalAwal = jurnalSebelum(jurnal, r.mulai);

  const petaPeriode = hitungSaldo(jurnalPeriode);
  const petaKumulatif = hitungSaldo(jurnalKumulatif);
  const petaAwal = hitungSaldo(jurnalAwal);

  // ── Laba rugi (mutasi dalam periode) ──────────────────────────────
  const pendapatan = kelompok('Pendapatan', 'Pendapatan', petaPeriode, { sembunyikanNol: true });
  const bebanPokok = kelompok('Beban Pokok Pendapatan', 'HPP', petaPeriode, { sembunyikanNol: true });
  const bebanOperasional = kelompok('Beban Operasional', 'Beban Operasional', petaPeriode, { sembunyikanNol: true });
  const labaKotor = pendapatan.total - bebanPokok.total;
  const labaSebelumPajak = labaKotor - bebanOperasional.total;
  const labaBersih = labaSebelumPajak - bebanPajak;

  const labaRugi: LaporanLabaRugi = {
    pendapatan,
    bebanPokok,
    labaKotor,
    bebanOperasional,
    labaSebelumPajak,
    bebanPajak,
    labaBersih,
  };

  // ── Posisi keuangan (kumulatif s.d. akhir periode) ────────────────
  const asetLancar = kelompok('Aset Lancar', 'Aset Lancar', petaKumulatif);
  const asetTetap = kelompok('Aset Tetap', 'Aset Tetap', petaKumulatif);
  const liabilitasLancar = kelompok('Liabilitas Jangka Pendek', 'Liabilitas Lancar', petaKumulatif);
  const liabilitasPanjang = kelompok('Liabilitas Jangka Panjang', 'Liabilitas Panjang', petaKumulatif);

  // Beban pajak penghasilan diisi manual (tidak ada akun pajak di COA dan tidak
  // ada jurnalnya). Agar Aset tetap sama dengan Liabilitas + Ekuitas, taksiran
  // pajak yang mengurangi laba juga harus muncul sebagai utang pajak. Baris ini
  // murni penyajian — tidak ada baris jurnal yang dibuat atau diubah.
  if (bebanPajak > 0) {
    liabilitasLancar.baris.push({
      kode: '2-1005',
      nama: 'Utang Pajak Penghasilan (taksiran)',
      nilai: bebanPajak,
    });
    liabilitasLancar.total += bebanPajak;
  }

  const totalAset = asetLancar.total + asetTetap.total;
  const totalLiabilitas = liabilitasLancar.total + liabilitasPanjang.total;

  const modal = saldoAkun('3-1001', petaKumulatif);
  // Saldo laba awal = saldo akun laba ditahan sebelum periode + akumulasi laba
  // seluruh periode sebelumnya (perusahaan belum melakukan jurnal penutup).
  const saldoLabaAwal = saldoAkun('3-1002', petaAwal) + labaBersihDari(jurnalAwal);
  // Mutasi akun laba ditahan yang terjadi di dalam periode ikut diperhitungkan.
  const mutasiLabaDitahanPeriode = saldoAkun('3-1002', petaPeriode);
  const saldoLabaAkhir = saldoLabaAwal + mutasiLabaDitahanPeriode + labaBersih;
  const totalEkuitas = modal + saldoLabaAkhir;
  const totalLiabilitasEkuitas = totalLiabilitas + totalEkuitas;
  const selisih = totalAset - totalLiabilitasEkuitas;

  const posisiKeuangan: LaporanPosisiKeuangan = {
    asetLancar,
    asetTetap,
    totalAset,
    liabilitasLancar,
    liabilitasPanjang,
    totalLiabilitas,
    modal,
    saldoLabaAwal,
    labaPeriodeBerjalan: labaBersih + mutasiLabaDitahanPeriode,
    saldoLabaAkhir,
    totalEkuitas,
    totalLiabilitasEkuitas,
    selisih,
    seimbang: Math.abs(selisih) < 1,
  };

  // ── Perubahan ekuitas ─────────────────────────────────────────────
  const modalAwal = saldoAkun('3-1001', petaAwal);
  const perubahanEkuitas: LaporanPerubahanEkuitas = {
    modalAwal,
    saldoLabaAwal,
    totalAwal: modalAwal + saldoLabaAwal,
    tambahanModal: saldoAkun('3-1001', petaPeriode),
    labaPeriodeBerjalan: labaBersih + mutasiLabaDitahanPeriode,
    modalAkhir: modal,
    saldoLabaAkhir,
    totalAkhir: totalEkuitas,
  };

  // ── Arus kas ──────────────────────────────────────────────────────
  const kasAwal = totalKas(petaAwal, AKUN_KAS);
  const kasAkhirBuku = totalKas(petaKumulatif, AKUN_KAS);
  const arusKas = susunArusKas(jurnalPeriode, kasAwal, kasAkhirBuku);

  // ── Neraca saldo (mutasi periode, urut kategori lalu kode) ────────
  const neracaSaldo: BarisNeracaSaldo[] = Object.values(petaPeriode)
    .filter((a) => a.D !== 0 || a.K !== 0)
    .sort((a, b) => {
      const ka = URUT_KATEGORI.indexOf(a.kat as KategoriAkun);
      const kb = URUT_KATEGORI.indexOf(b.kat as KategoriAkun);
      if (ka !== kb) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
      return a.kode.localeCompare(b.kode);
    })
    .map((a) => ({
      kode: a.kode,
      nama: a.namaLaporan,
      kat: a.kat,
      D: a.D,
      K: a.K,
      saldo: saldoAkun(a.kode, petaPeriode),
    }));

  const rincianKas: BarisPos[] = AKUN_KAS.map((kode) => ({
    kode,
    nama: getAkun(kode)?.namaLaporan ?? kode,
    nilai: saldoAkun(kode, petaKumulatif),
  }));

  return {
    periode,
    rentang: r,
    labelPeriode: labelPeriodeLaporan(periode),
    labelTanggalPosisi: labelTanggalPosisi(periode),
    labaRugi,
    posisiKeuangan,
    perubahanEkuitas,
    arusKas,
    neracaSaldo,
    totalNeracaSaldoD: neracaSaldo.reduce((s, b) => s + b.D, 0),
    totalNeracaSaldoK: neracaSaldo.reduce((s, b) => s + b.K, 0),
    rincianKas,
    jumlahTransaksi: jurnalPeriode.length,
    akunAsing: akunDiluarCoa(petaKumulatif).map((a) => ({ kode: a.kode, nama: a.nama })),
    petaKumulatif,
    petaPeriode,
  };
}

/** Ringkasan angka untuk kartu KPI dashboard. */
export function ringkasanPeriode(jurnal: Jurnal[], periode: Periode) {
  const r = rentang(periode);
  const dalam = jurnalDalamRentang(jurnal, r.mulai, r.selesai);
  const kumulatif = hitungSaldo(jurnalSampai(jurnal, r.selesai));
  const peta = hitungSaldo(dalam);

  const pendapatan = saldoKategori('Pendapatan', peta);
  const hpp = saldoKategori('HPP', peta);
  const opex = saldoKategori('Beban Operasional', peta);
  const labaKotor = pendapatan - hpp;
  const labaBersih = labaKotor - opex;

  return {
    pendapatan,
    hpp,
    opex,
    labaKotor,
    labaBersih,
    marginKotor: pendapatan > 0 ? (labaKotor / pendapatan) * 100 : 0,
    marginBersih: pendapatan > 0 ? (labaBersih / pendapatan) * 100 : 0,
    kas: totalKas(kumulatif, AKUN_KAS),
    piutang: saldoAkun('1-1007', kumulatif) + saldoAkun('1-1006', kumulatif),
    utang:
      saldoAkun('2-1001', kumulatif) +
      saldoAkun('2-1002', kumulatif) +
      saldoAkun('2-1004', kumulatif),
    utangJangkaPanjang: saldoAkun('2-2001', kumulatif),
    asetTetap: saldoKategori('Aset Tetap', kumulatif),
    uangMuka: saldoAkun('2-1003', kumulatif),
    jumlahTransaksi: new Set(dalam.map((j) => j.no).filter(Boolean)).size,
    petaKumulatif: kumulatif,
    petaPeriode: peta,
  };
}

export type Ringkasan = ReturnType<typeof ringkasanPeriode>;
