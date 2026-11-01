/**
 * STRATEGIC CFO ADVISOR + CEO CHALLENGER.
 *
 * Menguji rencana pengeluaran/keputusan owner terhadap forecast kas yang sama
 * dengan dashboard. Putusan (aman / waspada / tolak) dan alternatifnya
 * DIHITUNG di sini — AI hanya boleh menjelaskannya, tidak boleh mengubahnya.
 * Owner tetap pemegang keputusan akhir; AI CFO tidak bisa mengeksekusi apa pun.
 */
import { semuaSkenario, simulasi, type InputArusKas, type Peristiwa } from './arus-kas';
import type { ModelCfo } from './model';
import { bulat, labelTanggal, rp, tambahHari } from './util';

export interface RencanaKeputusan {
  nominal: number; // rupiah, positif = uang keluar
  tanggal?: string; // default hari ini
  lini: 'L1' | 'L2' | 'Grup';
  ket: string;
  /** dicicil N kali per bulan (default 1 = sekaligus) */
  cicilan?: number;
}

export type Putusan = 'aman' | 'waspada' | 'tolak';

export interface HasilEvaluasi {
  putusan: Putusan;
  ringkas: string;
  alasan: string[];
  dampak: {
    skenario: 'optimis' | 'normal' | 'pesimis';
    saldoMinSebelum: number;
    saldoMinSesudah: number;
    tanggalDefisitSesudah: string | null;
    kebutuhanDanaSesudah: number;
  }[];
  alternatif: string[];
  maksAmanSekarang: number;
  tundaAmanHari: number | null;
}

function peristiwaRencana(r: RencanaKeputusan, hariIni: string, geserHari = 0): Peristiwa[] {
  const n = Math.max(1, Math.min(24, Math.floor(r.cicilan ?? 1)));
  const mulai = tambahHari(r.tanggal && r.tanggal > hariIni ? r.tanggal : hariIni, geserHari);
  return Array.from({ length: n }, (_, i) => ({
    tanggal: tambahHari(mulai, 30 * i),
    nominal: -r.nominal / n,
    jenis: 'keputusan_owner',
    lini: r.lini,
    ket: r.ket,
    sumber: { tabel: 'simulasi', ket: 'rencana owner' },
  }));
}

function aman(input: InputArusKas, tambahan: Peristiwa[]): boolean {
  return simulasi(input, 'normal', { tambahan }).saldoMin >= input.kasMinimum;
}

export function evaluasiKeputusan(model: ModelCfo, r: RencanaKeputusan): HasilEvaluasi {
  const input = model.arusKas.input;
  const hariIni = model.hariIni;
  const sebelum = model.arusKas.skenario;
  const sesudah = semuaSkenario(input, { tambahan: peristiwaRencana(r, hariIni) });

  const dampak = (['optimis', 'normal', 'pesimis'] as const).map((s) => ({
    skenario: s,
    saldoMinSebelum: sebelum[s].saldoMin,
    saldoMinSesudah: sesudah[s].saldoMin,
    tanggalDefisitSesudah: sesudah[s].tanggalDefisit,
    kebutuhanDanaSesudah: sesudah[s].kebutuhanDana,
  }));

  const alasan: string[] = [];
  let putusan: Putusan = 'aman';
  if (sebelum.normal.tanggalDefisit) {
    alasan.push(
      `Catatan: BAHKAN TANPA keputusan ini, kas skenario normal sudah diproyeksikan negatif mulai ${labelTanggal(sebelum.normal.tanggalDefisit)} (kebutuhan dana ${rp(sebelum.normal.kebutuhanDana)}). Setiap pengeluaran baru memperbesar kekurangan itu.`,
    );
  }
  const n = sesudah.normal;
  const p = sesudah.pesimis;

  if (n.tanggalDefisit) {
    putusan = 'tolak';
    alasan.push(
      `Dengan pengeluaran ini kas skenario normal menjadi NEGATIF pada ${labelTanggal(n.tanggalDefisit)} (terendah ${rp(n.saldoMin)}). Perlu tambahan dana ${rp(n.kebutuhanDana)}.`,
    );
  } else if (n.saldoMin < input.kasMinimum) {
    putusan = 'tolak';
    alasan.push(`Kas skenario normal turun ke ${rp(n.saldoMin)}, di bawah kas minimum ${rp(input.kasMinimum)}.`);
  } else if (p.tanggalDefisit) {
    putusan = 'waspada';
    alasan.push(`Aman di skenario normal, tetapi di skenario pesimis kas negatif pada ${labelTanggal(p.tanggalDefisit)} (kekurangan ${rp(p.besarDefisit)}).`);
  } else {
    alasan.push(`Kas terendah skenario normal tetap ${rp(n.saldoMin)} (di atas kas minimum ${rp(input.kasMinimum)}).`);
  }

  // Aturan disiplin yang tidak bergantung kas.
  const l2 = model.l2;
  if (r.lini === 'L2' && l2.danaTalangan > 0) {
    if (putusan === 'aman') putusan = 'waspada';
    alasan.push(`Loonars 2 sudah memakai dana talangan owner ${rp(l2.danaTalangan)} karena belum ada pembayaran investor tercatat. Pengeluaran L2 baru menambah utang proyek ke owner.`);
  }
  const tanpaPembeli = l2.unit.filter((u) => u.dibangunTanpaPembeli);
  if (r.lini === 'L2' && tanpaPembeli.length && /bangun|unit|material|tukang|konstruksi/i.test(r.ket)) {
    if (putusan === 'aman') putusan = 'waspada';
    alasan.push(`${tanpaPembeli.length} unit sudah dibangun tanpa pembeli (${rp(tanpaPembeli.reduce((s, u) => s + u.aktual, 0))}). Prioritaskan penjualan/DP sebelum menambah belanja konstruksi.`);
  }
  if (model.peringatan.some((x) => x.tingkat === 'kritis')) {
    if (putusan === 'aman') putusan = 'waspada';
    alasan.push('Masih ada peringatan KRITIS yang belum ditangani (lihat Financial Alerts).');
  }

  // Alternatif yang dihitung.
  let lo = 0;
  let hi = Math.max(0, r.nominal);
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (aman(input, peristiwaRencana({ ...r, nominal: mid, cicilan: 1 }, hariIni))) lo = mid;
    else hi = mid;
  }
  const maksAmanSekarang = bulat(Math.floor(lo / 100_000) * 100_000);

  let tundaAmanHari: number | null = null;
  for (let h = 7; h <= 120; h += 7) {
    if (aman(input, peristiwaRencana(r, hariIni, h))) {
      tundaAmanHari = h;
      break;
    }
  }
  const alternatif: string[] = [];
  if (putusan !== 'aman') {
    if (maksAmanSekarang > 0 && maksAmanSekarang < r.nominal) {
      alternatif.push(`Batasi ke ${rp(maksAmanSekarang)} sekarang (maksimum yang menjaga kas ≥ kas minimum di skenario normal).`);
    }
    if (tundaAmanHari !== null) alternatif.push(`Tunda ${tundaAmanHari} hari (sampai ${labelTanggal(tambahHari(hariIni, tundaAmanHari))}) — kas tetap di atas minimum.`);
    for (const k of [3, 6]) {
      if (aman(input, peristiwaRencana({ ...r, cicilan: k }, hariIni))) {
        alternatif.push(`Cicil ${k}× bulanan (${rp(r.nominal / k)}/bulan) — aman di skenario normal.`);
        break;
      }
    }
    const tagihan = l2.unit.filter((u) => u.terjual && u.sisaTagihan > 0);
    if (tagihan.length) alternatif.push(`Percepat penagihan investor (${rp(tagihan.reduce((s, u) => s + u.sisaTagihan, 0))} belum dibayar) sebelum mengeluarkan dana ini.`);
    if (l2.unitTersedia > 0) alternatif.push(`Danai dari penjualan unit: ${l2.unitTersedia} unit Loonars 2 masih tersedia (${rp(l2.nilaiPersediaanTersedia)}).`);
    if (!alternatif.length) alternatif.push('Cari sumber dana tambahan sebelum menjalankan keputusan ini.');
  }

  const ringkas =
    putusan === 'aman'
      ? `AMAN secara kas: ${r.ket} ${rp(r.nominal)}.`
      : putusan === 'waspada'
        ? `WASPADA: ${r.ket} ${rp(r.nominal)} bisa dijalankan, tetapi ada risiko yang harus Anda terima secara sadar.`
        : `SAYA TIDAK MENYARANKAN ${r.ket} ${rp(r.nominal)} saat ini.`;

  return { putusan, ringkas, alasan, dampak, alternatif, maksAmanSekarang, tundaAmanHari };
}

/** Simulasi restrukturisasi: tunda kewajiban jenis tertentu N hari, lihat dampaknya. */
export function simulasiRestrukturisasi(model: ModelCfo, jenis: string[], hari: number) {
  const input = model.arusKas.input;
  const hasil = semuaSkenario(input, { tunda: { jenis, hari } });
  return (['optimis', 'normal', 'pesimis'] as const).map((s) => ({
    skenario: s,
    saldoMinSebelum: model.arusKas.skenario[s].saldoMin,
    saldoMinSesudah: hasil[s].saldoMin,
    tanggalDefisitSebelum: model.arusKas.skenario[s].tanggalDefisit,
    tanggalDefisitSesudah: hasil[s].tanggalDefisit,
    kebutuhanDanaSesudah: hasil[s].kebutuhanDana,
  }));
}
