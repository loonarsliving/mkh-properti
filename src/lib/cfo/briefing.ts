/**
 * Teks briefing WhatsApp untuk owner — disusun dari ModelCfo (angka
 * deterministik), bukan oleh AI. Dikirim lewat antrean WA yang sudah ada
 * (loonars2_outbox → MK Connect → Whacenter). Maks 4000 karakter (batas outbox).
 */
import type { ModelCfo } from './model';
import type { Peringatan } from './tipe';
import { labelBulan, labelTanggal, persen, rp, rpRingkas } from './util';

const IKON: Record<Peringatan['tingkat'], string> = { kritis: '🔴', tinggi: '🟠', sedang: '🟡', info: 'ℹ️' };
const MAKS = 3900;

function potong(s: string): string {
  return s.length <= MAKS ? s : `${s.slice(0, MAKS - 20)}\n…(dipotong)`;
}

function barisPeringatan(m: ModelCfo, maks: number, filter?: (p: Peringatan) => boolean): string[] {
  return m.peringatan
    .filter(filter ?? ((p) => p.tingkat === 'kritis' || p.tingkat === 'tinggi'))
    .slice(0, maks)
    .map((p) => `${IKON[p.tingkat]} ${p.judul}`);
}

function barisKas(m: ModelCfo): string[] {
  const n = m.arusKas.skenario.normal;
  const pes = m.arusKas.skenario.pesimis;
  return [
    `💰 *Kas tercatat:* ${rp(m.kasTotal)}`,
    `   (rekening L2 + buku besar LL; kas villa belum tersambung)`,
    `📉 *Forecast 13 minggu (normal):* terendah ${rpRingkas(n.saldoMin)} (${labelTanggal(n.tanggalSaldoMin)})${n.tanggalDefisit ? ` — ⚠️ DEFISIT mulai ${labelTanggal(n.tanggalDefisit)}` : ''}`,
    `   Pesimis: ${pes.tanggalDefisit ? `defisit ${labelTanggal(pes.tanggalDefisit)}, kurang ${rpRingkas(pes.besarDefisit)}` : `terendah ${rpRingkas(pes.saldoMin)}`}`,
  ];
}

function barisL1(m: ModelCfo): string[] {
  const f = m.l1.terakhirFinal;
  const t = m.l1.terakhir;
  const out = ['', '🏨 *Loonars 1 — Hospitality*'];
  if (f) {
    out.push(
      `${labelBulan(f.bulan)} (final): revenue ${rpRingkas(f.revenue)}, EBITDA ${rpRingkas(f.ebitda)}, okupansi ${f.okupansiPct === null ? '-' : persen(f.okupansiPct)}`,
      `   Bagian MKH setelah bagi hasil & jaminan: ${rpRingkas(f.bagianMkhBersih)}`,
    );
  }
  if (t && t !== f) {
    out.push(`${labelBulan(t.bulan)} (berjalan): revenue ${rpRingkas(t.revenue)}, EBITDA ${rpRingkas(t.ebitda)}, okupansi ${t.okupansiPct === null ? '-' : persen(t.okupansiPct)}`);
  }
  if (!f && !t) out.push('Belum ada kiriman laporan dari villa-api.');
  return out;
}

function barisL2(m: ModelCfo): string[] {
  const l2 = m.l2;
  return [
    '',
    '🏗 *Loonars 2 — Developer & Konstruksi*',
    `Terjual ${l2.unitTerjual}/${l2.jumlahUnit} unit, nilai kontrak ${rpRingkas(l2.nilaiKontrak)}, cash-in investor ${rpRingkas(l2.cashInInvestor)}`,
    `Belanja konstruksi ${rpRingkas(l2.biayaKonstruksiKas)} (kas) · utang toko ${rpRingkas(l2.utangToko)} · dana talangan owner ${rpRingkas(l2.danaTalangan)}`,
  ];
}

export function teksBriefingHarian(m: ModelCfo, url: string): string {
  const pr = barisPeringatan(m, 6);
  const top = m.kewajiban.filter((k) => k.status === 'lewat' || k.status === 'minggu_ini').slice(0, 4);
  return potong(
    [
      `*AI CFO — Briefing Harian* (${labelTanggal(m.hariIni)})`,
      '',
      ...barisKas(m),
      ...barisL1(m),
      ...barisL2(m),
      '',
      `🧾 *Jatuh tempo ≤7 hari:* ${rp(m.ringkasKewajiban.jatuhTempo7Hari)}${m.ringkasKewajiban.lewatJatuhTempo > 0 ? ` (lewat: ${rp(m.ringkasKewajiban.lewatJatuhTempo)})` : ''}`,
      ...top.map((k) => `   ${k.urutan}. ${k.pihak} ${rpRingkas(k.nominal)}`),
      '',
      pr.length ? '⚠️ *Peringatan utama:*' : '✅ Tidak ada peringatan kritis/tinggi.',
      ...pr,
      '',
      `Detail & tanya AI CFO: ${url}/cfo`,
      '_Angka dihitung otomatis dari data sistem; AI CFO tidak memindahkan uang._',
    ].join('\n'),
  );
}

export function teksBriefingMingguan(m: ModelCfo, url: string): string {
  const n = m.arusKas.skenario.normal;
  const minggu = n.mingguan.slice(0, 4).map((w) => `   ${w.label} (${labelTanggal(w.mulai)}): masuk ${rpRingkas(w.masuk)}, keluar ${rpRingkas(w.keluar)}, saldo ${rpRingkas(w.saldoAkhir)}`);
  const unit = m.l2.unit
    .filter((u) => u.aktual > 0)
    .sort((a, b) => (b.realisasiPct ?? 0) - (a.realisasiPct ?? 0))
    .slice(0, 5)
    .map((u) => `   ${u.kode}: ${rpRingkas(u.aktual)} / ${rpRingkas(u.budget)} (${u.realisasiPct === null ? '-' : persen(u.realisasiPct, 0)})${u.pembeli ? '' : ' — belum ada pembeli'}`);
  const selisih = m.rekonsiliasi.filter((r) => r.status === 'selisih').slice(0, 4).map((r) => `   ❗ ${r.judul}: selisih ${rp(r.selisih ?? 0)}`);
  const prioritas = m.kewajiban.slice(0, 5).map((k) => `   ${k.urutan}. ${k.pihak} ${rpRingkas(k.nominal)} — ${k.alasanPrioritas}`);
  return potong(
    [
      `*AI CFO — Laporan Mingguan* (${labelTanggal(m.hariIni)})`,
      '',
      ...barisKas(m),
      '',
      '📅 *Arus kas 4 minggu ke depan (normal):*',
      ...minggu,
      `Kebutuhan dana — optimis ${rpRingkas(m.konsolidasi.kebutuhanDana.optimis)}, normal ${rpRingkas(m.konsolidasi.kebutuhanDana.normal)}, pesimis ${rpRingkas(m.konsolidasi.kebutuhanDana.pesimis)}`,
      ...barisL1(m),
      ...barisL2(m),
      ...(unit.length ? ['📐 *Budget vs aktual per unit:*', ...unit] : []),
      '',
      '🧾 *Urutan bayar yang disarankan:*',
      ...prioritas,
      ...(selisih.length ? ['', '🔎 *Rekonsiliasi belum cocok:*', ...selisih] : []),
      '',
      '⚠️ *Peringatan:*',
      ...barisPeringatan(m, 8, (p) => p.tingkat !== 'info'),
      '',
      `Detail: ${url}/cfo`,
    ].join('\n'),
  );
}

/** Peringatan otomatis: hanya yang KRITIS. null = tidak ada yang perlu dikirim. */
export function teksPeringatanKritis(m: ModelCfo, url: string): { teks: string; kunci: string } | null {
  const kritis = m.peringatan.filter((p) => p.tingkat === 'kritis');
  if (!kritis.length) return null;
  const kunci = `peringatan:${m.hariIni}:${kritis.map((p) => p.id).sort().join('|')}`.replace(/[^A-Za-z0-9:_.-]/g, '_').slice(0, 110);
  return {
    kunci,
    teks: potong(
      [
        `🔴 *AI CFO — Peringatan Kritis* (${labelTanggal(m.hariIni)})`,
        '',
        ...kritis.map((p) => `• *${p.judul}*\n  ${p.isi}`),
        '',
        `Tindak lanjut & simulasi: ${url}/cfo/peringatan`,
      ].join('\n'),
    ),
  };
}
