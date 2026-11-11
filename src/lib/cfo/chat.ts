/**
 * AI CFO Chat — lapisan jawaban.
 *
 * Alur: pertanyaan → (1) jawaban DETERMINISTIK dari ModelCfo (selalu ada,
 * tanpa AI) → (2) opsional, model bahasa menarasikan ulang HANYA dari daftar
 * fakta bernomor → (3) validasi: setiap angka rupiah di jawaban AI harus ada
 * di daftar fakta; bila tidak, jawaban AI ditolak dan jawaban deterministik
 * yang dipakai. Jadi AI tidak pernah bisa mengarang angka.
 */
import type { LaporanHolding } from './holding';
import { evaluasiKeputusan, type HasilEvaluasi } from './penantang';
import { kodeWa, type KerjaCfo } from './kerja';
import type { ModelCfo } from './model';
import { bulat, labelBulan, labelTanggal, persen, rp } from './util';

export interface Fakta {
  id: string; // F1, F2, …
  label: string;
  nilai: number | null;
  teks: string;
  sumber: string;
}

export function faktaCfo(m: ModelCfo, kerja?: KerjaCfo, holding?: LaporanHolding): Fakta[] {
  const f: Fakta[] = [];
  const add = (label: string, nilai: number | null, sumber: string, teks?: string) =>
    f.push({ id: `F${f.length + 1}`, label, nilai, teks: teks ?? (nilai === null ? 'tidak tersedia' : rp(nilai)), sumber });

  add('Kas tercatat (total yang dipakai)', m.kasTotal, 'loonars2_v_rekening + jurnal LL');
  for (const k of m.kas) add(`Kas — ${k.label}`, k.nilai, k.sumber.tabel);
  add('Kas minimum (pengaturan)', m.kasMinimum, 'cfo_pengaturan');
  for (const s of ['optimis', 'normal', 'pesimis'] as const) {
    const h = m.arusKas.skenario[s];
    add(`Forecast ${s}: saldo terendah 182 hari`, h.saldoMin, 'forecast', `${rp(h.saldoMin)} pada ${labelTanggal(h.tanggalSaldoMin)}`);
    add(`Forecast ${s}: tanggal defisit pertama`, null, 'forecast', h.tanggalDefisit ? labelTanggal(h.tanggalDefisit) : 'tidak ada defisit dalam 182 hari');
    add(`Forecast ${s}: kebutuhan dana`, h.kebutuhanDana, 'forecast');
  }
  add('Total kewajiban (semua lini + grup)', m.ringkasKewajiban.total, 'kewajiban');
  add('Kewajiban Loonars 1', m.ringkasKewajiban.L1, 'kewajiban');
  add('Kewajiban Loonars 2', m.ringkasKewajiban.L2, 'kewajiban');
  add('Kewajiban grup MKH di luar Loonars (refund customer)', m.ringkasKewajiban.Grup, 'kewajiban');
  add('Kewajiban jatuh tempo ≤7 hari', m.ringkasKewajiban.jatuhTempo7Hari, 'kewajiban');
  add('Kewajiban lewat jatuh tempo', m.ringkasKewajiban.lewatJatuhTempo, 'kewajiban');
  add('Total piutang', m.piutang.total, 'loonars2_v_unit + snapshot ota_settlement');
  add('Modal kerja bersih Loonars', m.modalKerja.bersih, 'kas + piutang OTA − liabilitas lancar');

  const l1f = m.l1.terakhirFinal;
  const l1t = m.l1.terakhir;
  for (const b of [l1f, l1t !== l1f ? l1t : null]) {
    if (!b) continue;
    const tag = `Loonars 1 ${labelBulan(b.bulan)} (${b.status})`;
    add(`${tag}: revenue (omzet kotor)`, b.revenue, 'laporan_villa_bulanan');
    add(`${tag}: komisi OTA`, b.komisiOta, 'laporan_villa_bulanan');
    add(`${tag}: pendapatan bersih`, b.pendapatanBersih, 'laporan_villa_bulanan');
    add(`${tag}: COGS`, b.cogs, 'laporan_villa_bulanan');
    add(`${tag}: OPEX (gaji staf)`, b.opex, 'laporan_villa_bulanan');
    add(`${tag}: EBITDA (= net profit, D&A/bunga/pajak belum tercatat)`, b.ebitda, 'laporan_villa_bulanan');
    add(`${tag}: okupansi`, b.okupansiPct, 'laporan_villa_bulanan', b.okupansiPct === null ? 'tidak tersedia' : persen(b.okupansiPct));
    add(`${tag}: ADR`, b.adr === null ? null : Math.round(b.adr), 'laporan_villa_bulanan');
    add(`${tag}: RevPAR`, b.revpar === null ? null : Math.round(b.revpar), 'laporan_villa_bulanan');
    add(`${tag}: bagi hasil investor (70%)`, b.bagiHasilInvestor, 'laporan_villa_bulanan');
    add(`${tag}: top-up jaminan investor`, b.topupJaminan, 'laporan_villa_bulanan');
    add(`${tag}: bagian MKH bersih (pengelola − top-up)`, b.bagianMkhBersih, 'laporan_villa_bulanan');
  }
  const l2 = m.l2;
  if (holding) {
    const h = holding;
    const tag = `Holding ${h.entitas} ${h.tahun}${h.resmi ? '' : ' (persiapan)'}`;
    add(`${tag}: laba (rugi) bersih konsolidasi`, h.labaBersih.konsolidasi, 'laporan holding SAK EMKM');
    add(`${tag}: laba (rugi) Loonars 1`, h.labaBersih.L1, 'laporan holding SAK EMKM');
    add(`${tag}: laba (rugi) Loonars 2`, h.labaBersih.L2, 'laporan holding SAK EMKM');
    add(`${tag}: beban holding (gaji tim bersama)`, h.labaBersih.holding, 'snapshot:gaji_karyawan');
    for (const c of h.gaji.perCabang) {
      add(`${tag}: gaji cabang ${c.cabang} (sudah ditransfer)`, c.dibayar, 'snapshot:gaji_karyawan');
      if (c.terutang) add(`${tag}: gaji cabang ${c.cabang} belum ditransfer (utang)`, c.terutang, 'snapshot:gaji_karyawan');
    }
    add(`${tag}: total aset konsolidasi (per ${h.posisi.perTanggal})`, h.posisi.totalAset.konsolidasi, 'laporan holding SAK EMKM');
    add(`${tag}: total liabilitas konsolidasi`, h.posisi.totalLiabilitas.konsolidasi, 'laporan holding SAK EMKM');
    add(`${tag}: ekuitas konsolidasi`, h.posisi.ekuitas.konsolidasi, 'laporan holding SAK EMKM');
    add(`${tag}: PPh badan Pasal 31E (estimasi)`, h.pajak.pphBadan, 'laporan holding SAK EMKM', `${rp(h.pajak.pphBadan)} (PKP ${rp(h.pajak.pkp)}, omzet non-final ${rp(h.pajak.omzetNonFinal)}; konfirmasi konsultan pajak)`);
    add(`${tag}: PPh final 2,5% penjualan unit (estimasi)`, h.pajak.pphFinal, 'laporan holding SAK EMKM');
    add(`${tag}: kebijakan`, null, 'keputusan owner 2026-11-02',
      'Pendapatan villa kotor penuh; bagi hasil & top-up investor = beban; gaji tim bersama (Jogja, Head Office, dll.) = beban holding, bukan Loonars 1/2; gaji staf villa ada di OPEX Loonars 1; serah terima unit Loonars 2 akhir Desember (diakui 31 Desember); bunga 0 (tanpa pinjaman bank); penyusutan bangunan Loonars Coffee garis lurus 20 tahun setelah selesai; utang bank AFP milik PT Maha Karya, bukan laporan ini; tahun buku resmi pertama 2027.');
  }
  const namaProyekLain = l2.proyek.map((p) => p.nama).join(', ') || 'proyek lain';
  add('Loonars 2: TOTAL pengeluaran pembangunan (villa Loonars Living + ' + namaProyekLain + ')', l2.belanjaKonstruksiGabungan,
    'loonars2_disbursements + snapshot:proyek_konstruksi',
    `${rp(l2.belanjaKonstruksiGabungan)} = villa Loonars Living ${rp(l2.biayaKonstruksiKas)} (kas keluar konstruksi, termasuk cicilan utang toko) + ${namaProyekLain} ${rp(l2.biayaProyekLain)} (realisasi MK Connect)`);
  add('Loonars 2: TOTAL sisa utang toko (villa Loonars Living + ' + namaProyekLain + ')', bulat(l2.utangToko + l2.utangProyekLain),
    'loonars2_v_toko + snapshot:proyek_konstruksi',
    `${rp(l2.utangToko + l2.utangProyekLain)} = villa ${rp(l2.utangToko)} + ${namaProyekLain} ${rp(l2.utangProyekLain)}`);
  // Pembayaran kontraktor/tukang (owner 2026-11-11: "total keseluruhan pembayaran
  // kontraktor L2" sempat dijawab "tidak tersedia" karena fakta ini belum dikirim).
  const k = l2.kontraktor;
  const tenagaProyek = bulat(l2.proyek.reduce((a, p) => a + p.realisasiTenaga, 0));
  add('Loonars 2: TOTAL pembayaran kontraktor/tukang (villa Loonars Living + ' + namaProyekLain + ')', bulat(k.total + tenagaProyek),
    'loonars2_disbursements (kategori tukang) + snapshot:proyek_konstruksi',
    `${rp(k.total + tenagaProyek)} = kontraktor villa Loonars Living ${rp(k.total)} + tukang/kontraktor ${namaProyekLain} ${rp(tenagaProyek)}`
      + (k.tukangL1.total ? `; di luar itu tukang Loonars 1 ${rp(k.tukangL1.total)} dibayar dari rekening C (piutang ke Loonars 1)` : ''));
  add('Loonars 2: pembayaran kontraktor villa Loonars Living (sejak awal)', k.total, 'loonars2_disbursements (kategori tukang)',
    k.total
      ? `${rp(k.total)} dalam ${k.jumlahMinggu} minggu pembayaran (pembayaran pertama ${labelTanggal(k.minggu[0].tanggalBayar[0])}, terakhir ${labelTanggal(k.terakhir!)})`
      : 'belum ada pembayaran kontraktor tercatat');
  for (const w of k.minggu.slice(-6)) {
    add(`Loonars 2: kontraktor villa minggu ${labelTanggal(w.mulai)}–${labelTanggal(w.selesai)}`, w.nominal, 'loonars2_disbursements (kategori tukang)',
      `${rp(w.nominal)} (dibayar ${w.tanggalBayar.map(labelTanggal).join(', ')})`);
  }
  if (k.mingguTanpaBayar.length) {
    add('Loonars 2: minggu tanpa pembayaran kontraktor villa', k.mingguTanpaBayar.length, 'loonars2_disbursements (kategori tukang)',
      k.mingguTanpaBayar.map((w) => `${labelTanggal(w.mulai)}–${labelTanggal(w.selesai)}`).join('; '));
  }
  if (k.tukangL1.total) {
    add('Loonars 2: tukang Loonars 1 dibayar dari rekening C (piutang ke Loonars 1, bukan biaya villa)', k.tukangL1.total, 'loonars2_disbursements (kategori tukang)',
      `${rp(k.tukangL1.total)} (${k.tukangL1.pembayaran.map((p) => `${labelTanggal(p.tanggal)} ${rp(p.nominal)}`).join('; ')})`);
  }
  for (const p of l2.proyek) {
    add(`Loonars 2 — ${p.nama}: pembayaran tukang/kontraktor`, p.realisasiTenaga, 'snapshot:proyek_konstruksi');
  }
  add('Loonars 2: unit terjual', l2.unitTerjual, 'loonars2_v_unit', `${l2.unitTerjual} dari ${l2.jumlahUnit} unit`);
  add('Loonars 2: nilai kontrak penjualan', l2.nilaiKontrak, 'loonars2_v_unit');
  add('Loonars 2: cash-in investor tercatat', l2.cashInInvestor, 'loonars2_receipts');
  add('Loonars 2: piutang kontrak (belum dibayar investor)', l2.piutangKontrak, 'loonars2_v_unit');
  add('Loonars 2: belanja konstruksi (kas)', l2.biayaKonstruksiKas, 'loonars2_disbursements');
  add('Loonars 2: biaya konstruksi akrual (termasuk utang toko)', l2.biayaKonstruksiAkrual, 'loonars2_v_unit');
  add('Loonars 2: budget unit yang sudah dibangun', l2.budgetUnitAktif, 'loonars2_v_unit');
  add('Loonars 2: aktual unit yang sudah dibangun', l2.aktualUnitAktif, 'loonars2_v_unit');
  add('Loonars 2: utang toko bangunan', l2.utangToko, 'loonars2_v_toko');
  add('Loonars 2: belanja konstruksi gabungan (villa + proyek lain)', l2.belanjaKonstruksiGabungan, 'loonars2_disbursements + snapshot:proyek_konstruksi');
  for (const p of l2.proyek) {
    add(`Loonars 2 — ${p.nama}: budget`, p.budgetTotal, 'snapshot:proyek_konstruksi');
    add(`Loonars 2 — ${p.nama}: realisasi`, p.realisasiTotal, 'snapshot:proyek_konstruksi',
      `${rp(p.realisasiTotal)} (material ${rp(p.realisasiMaterial)}, tukang/kontraktor ${rp(p.realisasiTenaga)}, lain-lain ${rp(p.realisasiLain)})`);
    add(`Loonars 2 — ${p.nama}: selisih budget`, p.selisihBudget, 'snapshot:proyek_konstruksi',
      p.selisihBudget === null ? 'budget tidak tersedia' : p.selisihBudget > 0 ? `lewat budget ${rp(p.selisihBudget)}` : `sisa budget ${rp(-p.selisihBudget)}`);
    add(`Loonars 2 — ${p.nama}: utang toko belum lunas`, p.utangBelumLunas, 'snapshot:proyek_konstruksi');
  }
  add('Loonars 2: dana talangan owner', l2.danaTalangan, 'loonars2_v_rekening');
  add('Loonars 2: sisa sewa tanah', l2.tanah.sisa, 'loonars2_settings', `${rp(l2.tanah.sisa)}${l2.tanah.jatuhTempo ? `, jatuh tempo ${labelTanggal(l2.tanah.jatuhTempo)}` : ''}`);
  add('Loonars 2: proyeksi laba proyek', l2.proyeksi.laba, 'loonars2_v_unit + settings');
  add('Loonars 2: unit dibangun tanpa pembeli', l2.unit.filter((u) => u.dibangunTanpaPembeli).length, 'loonars2_v_unit',
    l2.unit.filter((u) => u.dibangunTanpaPembeli).map((u) => u.kode).join(', ') || 'tidak ada');
  for (const k of m.kewajiban.slice(0, 5)) add(`Prioritas bayar #${k.urutan}: ${k.pihak}`, k.nominal, k.sumber.tabel, `${rp(k.nominal)} — ${k.alasanPrioritas}`);
  for (const p of m.peringatan.slice(0, 8)) add(`Peringatan ${p.tingkat}: ${p.judul}`, p.nilai ?? null, p.sumber.map((s) => s.tabel).join(', '), p.isi);
  if (kerja) {
    const rv = kerja.ringkasReviu;
    add('Reviu pengajuan Loonars 2: jumlah kelompok menunggu', rv.l2Kelompok, 'loonars2_material_requests',
      `${rv.l2Kelompok} kelompok (${rp(rv.l2Total)}): setujui ${rv.l2Setujui}, tahan ${rv.l2Tahan}, cek dobel ${rv.l2Dobel}`);
    for (const r of kerja.reviuL2.slice(0, 8)) {
      add(`Reviu pengajuan ${kodeWa(r.kelompok)} (${r.kategori})`, r.total, 'loonars2_material_requests', `${rp(r.total)} → ${r.putusan.replace('_', ' ')}: ${r.alasan.join(' ')}`);
    }
    add('Reviu pengajuan MKH: menunggu', rv.mkhJumlah, 'pengajuan', `${rv.mkhJumlah} pengajuan (${rp(rv.mkhTotal)}), ${rv.mkhDobel} tampak ganda, ${rv.mkhBasi} menunggu > 30 hari`);
    for (const r of kerja.reviuMkh.filter((x) => x.putusan !== 'PROSES').slice(0, 6)) {
      add(`Reviu pengajuan MKH #${r.id} (${r.proyek})`, r.nominal, 'pengajuan', `${rp(r.nominal)} → ${r.putusan.replace('_', ' ')}: ${r.alasan.join(' ')}`);
    }
    const rb = kerja.rencana;
    add('Rencana bayar minggu ini: dana di atas kas minimum', rb.danaTersedia, 'kas − kas minimum');
    add('Rencana bayar minggu ini: total dibayar', rb.totalBayar, 'rencana', rb.bayar.map((b) => `${b.pihak} ${rp(b.nominal)}`).join('; ') || 'tidak ada');
    add('Rencana bayar minggu ini: total ditunda', rb.totalTunda, 'rencana', rb.tunda.slice(0, 5).map((b) => `${b.pihak} ${rp(b.nominal)} (${b.alasan})`).join('; ') || 'tidak ada');
    const daftar = kerja.terbukaDb.length ? kerja.terbukaDb : kerja.tindakan;
    add('Tindakan CFO terbuka', daftar.length, 'cfo_tindakan', `${daftar.length} tindakan, ${kerja.lewatTenggat.length} lewat tenggat`);
    for (const t of daftar.slice(0, 8)) {
      add(`Tindakan: ${t.judul}`, t.nilai === null || t.nilai === undefined ? null : Number(t.nilai), 'cfo_tindakan',
        `${t.langkah} (penanggung: ${t.penanggung}${t.tenggat ? `, tenggat ${labelTanggal(t.tenggat)}` : ''})`);
    }
  }
  for (const r of m.rekonsiliasi.filter((x) => x.status !== 'cocok').slice(0, 5)) {
    add(`Rekonsiliasi ${r.status}: ${r.judul}`, r.selisih, 'rekonsiliasi', `${r.kiri.label}: ${r.kiri.nilai === null ? 'n/a' : rp(r.kiri.nilai)}; ${r.kanan.label}: ${r.kanan.nilai === null ? 'n/a' : rp(r.kanan.nilai)}`);
  }
  return f;
}

// ── Deteksi niat & jawaban deterministik ────────────────────────────────────

const SATUAN: Record<string, number> = { rb: 1e3, ribu: 1e3, k: 1e3, jt: 1e6, juta: 1e6, m: 1e9, miliar: 1e9, milyar: 1e9, b: 1e9 };

/** "150 jt", "1,2 M", "Rp 25.000.000" → rupiah. null bila tidak ada. */
export function bacaNominal(t: string): number | null {
  const m = t.toLowerCase().match(/(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|miliar|milyar|m|b)?\b/);
  if (!m) return null;
  const [, raw, sat] = m;
  let n: number;
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw) && !sat) n = Number(raw.replace(/[.,]/g, ''));
  else n = Number(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const hasil = sat ? n * SATUAN[sat] : n;
  return hasil >= 10_000 ? Math.round(hasil) : null;
}

const KATA_KEPUTUSAN = /\b(beli|membeli|bayar|keluarkan|mengeluarkan|investasi|ekspansi|bangun|membangun|pakai|transfer|tarik|ambil|renovasi|tambah|rekrut|sewa|pinjam|cairkan|bolehkah|boleh)\b/i;

export interface JawabanCfo {
  jawaban: string;
  fakta: string[];
  niat: string;
  evaluasi?: HasilEvaluasi;
}

function pakai(fakta: Fakta[], pred: (f: Fakta) => boolean): Fakta[] {
  return fakta.filter(pred);
}

export function jawabDeterministik(pertanyaan: string, m: ModelCfo, fakta: Fakta[] = faktaCfo(m)): JawabanCfo {
  const q = pertanyaan.toLowerCase();
  const nominal = bacaNominal(pertanyaan);

  if (nominal && KATA_KEPUTUSAN.test(q)) {
    const lini: 'L1' | 'L2' | 'Grup' = /villa|loonars ?1|hotel|kamar/.test(q) ? 'L1' : /loonars ?2|unit|konstruksi|bangun|tukang|material|tanah/.test(q) ? 'L2' : 'Grup';
    const cicilan = Number(q.match(/cicil\w*\s*(\d{1,2})/)?.[1] ?? 1);
    const ev = evaluasiKeputusan(m, { nominal, lini, ket: pertanyaan.trim().slice(0, 120), cicilan });
    const n = ev.dampak.find((d) => d.skenario === 'normal')!;
    const p = ev.dampak.find((d) => d.skenario === 'pesimis')!;
    const jawaban = [
      ev.ringkas,
      '',
      ...ev.alasan.map((a) => `• ${a}`),
      '',
      `Dampak ke kas terendah — normal: ${rp(n.saldoMinSebelum)} → ${rp(n.saldoMinSesudah)}; pesimis: ${rp(p.saldoMinSebelum)} → ${rp(p.saldoMinSesudah)}.`,
      ...(ev.alternatif.length ? ['', 'Alternatif yang lebih aman:', ...ev.alternatif.map((a) => `• ${a}`)] : []),
      '',
      'Keputusan akhir tetap di tangan Anda; AI CFO tidak mengeksekusi pembayaran.',
    ].join('\n');
    return { jawaban, fakta: ['F1', 'F5'], niat: 'evaluasi_keputusan', evaluasi: ev };
  }

  const ambil = (pred: (f: Fakta) => boolean, judul: string, niat: string): JawabanCfo => {
    const dipakai = pakai(fakta, pred);
    return {
      jawaban: [judul, ...dipakai.map((f) => `• ${f.label}: ${f.teks} [${f.id}]`)].join('\n'),
      fakta: dipakai.map((f) => f.id),
      niat,
    };
  };

  if (/holding|konsolidasi|sak ?emkm|laba rugi|neraca|posisi keuangan|laporan tahunan|gaji|payroll/.test(q)) {
    const h = fakta.filter((f) => f.label.startsWith('Holding'));
    if (h.length) return ambil((f) => f.label.startsWith('Holding'), 'Laporan holding (Loonars 1 + Loonars 2 + biaya holding):', 'holding');
  }
  if (/kontraktor|tukang|mandor|borongan|upah/.test(q) && !/\bl1\b|loonars ?1/.test(q)) {
    return ambil(
      (f) => f.label.includes('kontraktor') || f.label.startsWith('Loonars 2: tukang Loonars 1'),
      'Pembayaran kontraktor/tukang Loonars 2 (villa Loonars Living + Loonars Coffee):',
      'kontraktor_l2',
    );
  }
  if (/pengeluaran|belanja|biaya|spending|keluar/.test(q) && !/villa|loonars ?1|\bl1\b|hotel/.test(q)) {
    return ambil(
      (f) => f.label.startsWith('Loonars 2: TOTAL') || f.label === 'Loonars 2: belanja konstruksi (kas)' || f.label.includes(': realisasi') || f.label.includes('selisih budget') || f.label.includes('utang toko belum lunas') || f.label === 'Loonars 2: utang toko bangunan',
      'Pengeluaran Loonars 2 (villa Loonars Living + Loonars Coffee, digabung):',
      'pengeluaran_l2',
    );
  }
  if (/rencana bayar|bayar minggu ini|apa yang (harus )?dibayar/.test(q)) {
    return ambil((f) => f.label.startsWith('Rencana bayar'), 'Rencana pembayaran minggu ini (sesuai kas di atas kas minimum):', 'rencana_bayar');
  }
  if (/pengajuan|reviu|review|approve|disetujui|ditolak|antrean/.test(q)) {
    return ambil((f) => f.label.startsWith('Reviu'), 'Reviu pengajuan oleh AI CFO (keputusan tetap di Anda):', 'reviu');
  }
  if (/tindakan|tugas|to.?do|harus (saya )?(lakukan|kerjakan)|kerjakan|langkah/.test(q)) {
    return ambil((f) => f.label.startsWith('Tindakan'), 'Tindakan CFO yang perlu dikerjakan:', 'tindakan');
  }
  if (/defisit|forecast|proyeksi|arus kas|cash ?flow|13 minggu|runway|kebutuhan dana|pendanaan/.test(q)) {
    return ambil((f) => f.label.startsWith('Forecast') || f.label.startsWith('Kas tercatat') || f.label.startsWith('Kas minimum'), 'Proyeksi arus kas (182 hari, 3 skenario):', 'forecast');
  }
  if (/utang|hutang|kewajiban|jatuh tempo|prioritas|bayar dulu|supplier|toko|refund|bank/.test(q)) {
    return ambil((f) => f.label.startsWith('Prioritas bayar') || f.label.startsWith('Kewajiban') || f.label.startsWith('Total kewajiban') || f.label.includes('utang toko') || f.label.includes('talangan'), 'Kewajiban & urutan bayar yang disarankan:', 'kewajiban');
  }
  if (/piutang|tagihan|investor|cash.?in|dp\b|pelunasan/.test(q) && !/villa|loonars ?1/.test(q)) {
    return ambil((f) => f.label.includes('piutang') || f.label.includes('Total piutang') || f.label.includes('cash-in') || f.label.includes('nilai kontrak') || f.label.includes('unit terjual') || f.label.includes('Rekonsiliasi'), 'Investor & piutang:', 'piutang');
  }
  if (/villa|loonars ?1|\bl1\b|hotel|okupansi|occupancy|adr|revpar|ota|hospitality|ebitda|kamar/.test(q)) {
    return ambil((f) => f.label.startsWith('Loonars 1'), 'Loonars 1 — Hospitality:', 'loonars1');
  }
  if (/loonars ?2|\bl2\b|konstruksi|budget|anggaran|proyek|unit|tanah|bangun|coffee|kopi|kafe|cafe/.test(q)) {
    return ambil((f) => f.label.startsWith('Loonars 2'), 'Loonars 2 — Developer & Konstruksi:', 'loonars2');
  }
  if (/peringatan|risiko|bahaya|alert|masalah|bocor|kebocoran|abnormal/.test(q)) {
    return ambil((f) => f.label.startsWith('Peringatan'), 'Peringatan risiko keuangan:', 'peringatan');
  }
  if (/rekonsiliasi|selisih|sinkron|cocok/.test(q)) {
    return ambil((f) => f.label.startsWith('Rekonsiliasi'), 'Hasil rekonsiliasi yang belum cocok:', 'rekonsiliasi');
  }
  if (/kas|saldo|uang|cash/.test(q)) {
    return ambil((f) => f.label.startsWith('Kas') || f.label.startsWith('Modal kerja'), 'Posisi kas:', 'kas');
  }
  return ambil(
    (f) => ['F1'].includes(f.id) || f.label.startsWith('Forecast normal') || f.label === 'Total kewajiban (semua lini + grup)' || f.label.startsWith('Peringatan'),
    'Ringkasan kondisi keuangan Loonars:',
    'ringkasan',
  );
}

// ── Prompt & validasi untuk model bahasa ────────────────────────────────────

/**
 * Rujukan aturan AI CFO. Salinan yang BERLAKU ada di MK Connect
 * (Mkhsistem app/api/mkh-property/ai-cfo/narasi, SISTEM_AI_CFO) — system prompt
 * tidak dikirim lewat jaringan.
 */
export function promptSistem(): string {
  return [
    'Anda adalah AI CFO / Financial Manager untuk Loonars (PT Maha Karya Haluoleo).',
    'Loonars 1 = hospitality yang sudah beroperasi. Loonars 2 = developer & konstruksi (penjualan villa ke investor + pembangunan); hospitality Loonars 2 BELUM beroperasi.',
    'ATURAN MUTLAK:',
    '1. Gunakan HANYA angka dari DAFTAR FAKTA. Jangan menghitung angka baru, jangan menjumlahkan, jangan memperkirakan. Bila angka yang ditanya tidak ada, katakan "data tidak tersedia".',
    '2. Setiap angka wajib diikuti rujukan fakta, mis. "Rp 123.992.000 [F42]".',
    '3. Jangan mencampur cash-in investor dengan pendapatan operasional.',
    '4. Anda boleh menganalisis, merekomendasikan, dan menegur owner/CEO dengan tegas bila keputusan berisiko — selalu dengan data dan alternatif yang lebih aman. Jangan sekadar menyetujui.',
    '5. Anda TIDAK BISA memindahkan uang, membayar, atau mengubah transaksi. Owner pemegang keputusan akhir.',
    '6. Bila ada JAWABAN DASAR berisi putusan (AMAN/WASPADA/TIDAK MENYARANKAN), pertahankan putusan itu.',
    '7. Bahasa Indonesia, ringkas (maks ±200 kata), langsung ke inti.',
  ].join('\n');
}

export function promptPengguna(pertanyaan: string, fakta: Fakta[], dasar: JawabanCfo, riwayat: { peran: 'owner' | 'cfo'; isi: string }[] = []): string {
  return [
    'DAFTAR FAKTA:',
    ...fakta.map((f) => `[${f.id}] ${f.label}: ${f.teks} (sumber: ${f.sumber})`),
    '',
    'JAWABAN DASAR (dihitung sistem, jangan ubah angkanya):',
    dasar.jawaban,
    '',
    ...(riwayat.length ? ['RIWAYAT SINGKAT:', ...riwayat.slice(-6).map((r) => `${r.peran === 'owner' ? 'Owner' : 'AI CFO'}: ${r.isi.slice(0, 400)}`), ''] : []),
    `PERTANYAAN OWNER: ${pertanyaan}`,
  ].join('\n');
}

/** Ambil semua nominal rupiah yang disebut dalam teks. */
export function nominalDalamTeks(t: string): { nilai: number; ringkas: boolean }[] {
  const hasil: { nilai: number; ringkas: boolean }[] = [];
  const re = /rp\.?\s*-?\s*(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*(rb|ribu|jt|juta|m|miliar|milyar)?\b/gi;
  for (const m of t.matchAll(re)) {
    const [, raw, sat] = m;
    const s = sat?.toLowerCase();
    if (/^\d{1,3}(\.\d{3})+$/.test(raw) && !s) hasil.push({ nilai: Number(raw.replace(/\./g, '')), ringkas: false });
    else {
      const n = Number(raw.replace(/\./g, '').replace(',', '.'));
      hasil.push({ nilai: s ? n * SATUAN[s] : n, ringkas: Boolean(s) });
    }
  }
  return hasil;
}

/**
 * true bila setiap nominal rupiah di jawaban AI cocok dengan salah satu fakta
 * (persis ±1 untuk angka penuh; ±2% untuk bentuk ringkas "jt"/"M"), atau
 * dengan angka di jawaban dasar.
 */
export function validasiJawaban(teks: string, fakta: Fakta[], dasar: JawabanCfo): boolean {
  const acuan = [
    ...fakta.flatMap((f) => (f.nilai === null ? [] : [Math.abs(f.nilai)])),
    ...nominalDalamTeks(fakta.map((f) => f.teks).join(' ')).map((x) => Math.abs(x.nilai)),
    ...nominalDalamTeks(dasar.jawaban).map((x) => Math.abs(x.nilai)),
  ];
  return nominalDalamTeks(teks).every(({ nilai, ringkas }) => {
    const a = Math.abs(nilai);
    return acuan.some((r) => (ringkas ? Math.abs(a - r) <= Math.max(0.02 * r, 50_000) : Math.abs(a - r) <= 1));
  });
}

export function ringkasUntukLog(j: JawabanCfo): Record<string, unknown> {
  return { niat: j.niat, fakta: j.fakta.slice(0, 30), putusan: j.evaluasi?.putusan ?? null };
}

