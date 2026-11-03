/**
 * Penyusun model AI CFO: satu fungsi murni `susunModelCfo(data, hariIni)`
 * yang dipakai bersama oleh dashboard, briefing WhatsApp, dan AI CFO Chat —
 * sehingga ketiganya selalu menyebut angka yang sama.
 */
import { ASUMSI, semuaSkenario, tanggalBulanBerikut, tanggalSatuBulanan, type InputArusKas, type Peristiwa } from './arus-kas';
import { prioritaskan, ringkasKewajiban, type Kewajiban } from './kewajiban';
import { deteksiAbnormal, rekonsiliasi, statusSinkron, susunPeringatan } from './kontrol';
import { laporanLoonars1 } from './loonars1';
import { laporanLoonars2 } from './loonars2';
import { proyekDikunci, TANGGAL_KUNCI } from './lingkup';
import type { DataCfo, Sumber } from './tipe';
import { angka, bulat, hariDalamBulan, jumlah, tambahHari, teks } from './util';

export interface KomponenKas {
  id: string;
  label: string;
  lini: 'L1' | 'L2';
  nilai: number | null; // null = tidak tersedia
  dipakaiDalamTotal: boolean;
  catatan: string;
  sumber: Sumber;
}

export type ModelCfo = ReturnType<typeof susunModelCfo>;

export function susunModelCfo(data: DataCfo, hariIni: string, sekarang: Date = new Date(`${hariIni}T05:00:00Z`)) {
  const l1 = laporanLoonars1(data, hariIni);
  const l2 = laporanLoonars2(data);
  const kasMinimum = angka(data.pengaturan?.kas_minimum ?? 50_000_000);

  // ── Posisi kas ───────────────────────────────────────────────────────────
  const kas: KomponenKas[] = [
    {
      id: 'l2_rekening',
      label: 'Rekening Loonars 2 (A, B, D bersaldo positif)',
      lini: 'L2',
      nilai: l2.kasRekeningPositif,
      dipakaiDalamTotal: true,
      catatan: 'Saldo negatif rekening C tidak dihitung sebagai kas — dicatat sebagai utang dana talangan owner.',
      sumber: { tabel: 'loonars2_v_rekening' },
    },
    {
      id: 'll_buku_besar',
      label: 'Kas & bank buku besar proyek LL (pengembangan Loonars 1)',
      lini: 'L1',
      nilai: l2.bukuBesarLL?.kas ?? null,
      dipakaiDalamTotal: l2.bukuBesarLL !== null,
      catatan: 'Saldo akun kas/bank (1-1001…1-1008) jurnal proyek LL — buku pembangunan & penjualan villa Loonars 1 (keputusan owner D-1, 2026-11-03). Rekening fisiknya berbeda dari rekening A–D Loonars 2. Saldo bank yang negatif di buku ini perlu dicocokkan dengan rekening koran.',
      sumber: { tabel: 'jurnal', ket: 'proyek LL, akun kas/bank' },
    },
    {
      id: 'l1_villa',
      label: 'Kas & bank villa (Loonars 1)',
      lini: 'L1',
      nilai: l1.kas ? l1.kas.kasBerjalan : null,
      dipakaiDalamTotal: l1.kas !== null,
      catatan: l1.kas
        ? `Saldo tercatat ${l1.kas.perTanggal} (${l1.kas.umurHari} hari lalu) + mutasi villa sesudahnya (masuk ${l1.kas.masukSesudah.toLocaleString('id-ID')}, keluar ${l1.kas.keluarSesudah.toLocaleString('id-ID')}).`
        : 'Saldo rekening villa belum dicatat di MKH Property (halaman Loonars 1).',
      sumber: { tabel: 'cfo_saldo_rekening + snapshot villa_kas_masuk/keluar' },
    },
  ];
  const kasTotal = bulat(jumlah(kas.filter((k) => k.dipakaiDalamTotal), (k) => k.nilai));

  // ── Kewajiban ────────────────────────────────────────────────────────────
  const kw: Kewajiban[] = [];
  for (const t of l2.utangTokoPerToko) {
    kw.push({
      id: `toko:${t.id}`, lini: 'L2', jenis: 'utang_supplier', pihak: t.nama, nominal: t.sisa,
      jatuhTempo: tambahHari(hariIni, 7), jatuhTempoAsumsi: true, dasar: 'Utang toko disetujui (nota), dicicil mingguan',
      sumber: { tabel: 'loonars2_v_toko', ket: `toko #${t.id}` },
    });
  }
  for (const p of l2.proyek.filter((x) => x.utangBelumLunas > 0)) {
    kw.push({
      id: `proyek_utang:${p.id}`, lini: 'L2', jenis: 'utang_supplier', pihak: `Utang toko — ${p.nama}`, nominal: p.utangBelumLunas,
      jatuhTempo: tambahHari(hariIni, 7), jatuhTempoAsumsi: true, dasar: `Pembelian utang proyek ${p.nama} belum lunas (MK Connect)`,
      sumber: { tabel: 'snapshot:proyek_konstruksi', ket: p.nama },
    });
  }
  for (const m of data.l2_pengajuan_menunggu) {
    kw.push({
      id: `l2_pengajuan:${m.id}`, lini: 'L2', jenis: m.kategori === 'tukang' ? 'upah_tukang' : 'pengajuan_material',
      pihak: `Pengajuan ${m.kelompok ?? `#${m.id}`} (${m.kategori})`, nominal: angka(m.nominal),
      jatuhTempo: tambahHari(hariIni, 3), jatuhTempoAsumsi: true, dasar: 'Pengajuan pelaksana menunggu keputusan owner',
      sumber: { tabel: 'loonars2_material_requests', ket: `#${m.id}` },
    });
  }
  if (l2.tanah.sisa > 0) {
    kw.push({
      id: 'l2_sewa_tanah', lini: 'L2', jenis: 'sewa_tanah', pihak: 'Pemilik lahan Loonars 2', nominal: l2.tanah.sisa,
      jatuhTempo: l2.tanah.jatuhTempo, jatuhTempoAsumsi: false, dasar: 'Sewa tanah (pengaturan Loonars 2)',
      sumber: { tabel: 'loonars2_settings', ket: 'target_tanah' },
    });
  }
  if (l2.fee.terutang > 0) {
    kw.push({
      id: 'l2_fee', lini: 'L2', jenis: 'fee_marketing', pihak: 'Tim marketing', nominal: l2.fee.terutang,
      jatuhTempo: tambahHari(hariIni, 30), jatuhTempoAsumsi: true, dasar: 'Fee % dari harga unit terjual',
      sumber: { tabel: 'loonars2_v_unit', ket: 'fee unit terjual − fee dibayar' },
    });
  }
  if (l2.danaTalangan > 0) {
    kw.push({
      id: 'l2_talangan', lini: 'L2', jenis: 'utang_owner', pihak: 'Owner (dana talangan)', nominal: l2.danaTalangan,
      jatuhTempo: null, jatuhTempoAsumsi: false, dasar: 'Saldo negatif rekening C',
      sumber: { tabel: 'loonars2_v_rekening' },
    });
  }
  for (const p of data.pengajuan_menunggu.filter((x) => x.proyek === 'LL')) {
    kw.push({
      id: `pengajuan:${p.id}`, lini: 'L2', jenis: p.tipe === 'tukang' ? 'upah_tukang' : 'pengajuan_material',
      pihak: `Pengajuan LL #${p.id} (${p.tipe})`, nominal: angka(p.nominal),
      jatuhTempo: tambahHari(hariIni, 3), jatuhTempoAsumsi: true, dasar: 'Pengajuan MKH Property menunggu verifikasi',
      sumber: { tabel: 'pengajuan', ket: `#${p.id}` },
    });
  }
  const tBerjalan = l1.terakhir;
  if (tBerjalan && tBerjalan.bagiHasilInvestor + tBerjalan.topupJaminan > 0) {
    kw.push({
      id: `l1_bagi_hasil:${tBerjalan.bulan}`, lini: 'L1', jenis: 'bagi_hasil_investor', pihak: 'Investor Loonars 1',
      nominal: bulat(tBerjalan.bagiHasilInvestor + tBerjalan.topupJaminan),
      jatuhTempo: tanggalBulanBerikut(tBerjalan.bulan, 10), jatuhTempoAsumsi: true,
      dasar: `Pool investor 70% + top-up jaminan ${tBerjalan.bulan}${tBerjalan.status === 'sementara' ? ' (sementara)' : ''}`,
      sumber: { tabel: 'laporan_villa_bulanan', ket: `${tBerjalan.bulan} rincian.bagi_hasil` },
    });
  }
  for (const pj of data.l1_pajak) {
    const sisa = angka(pj.pajak_terutang) - angka(pj.jumlah_disetor);
    if (sisa > 0) {
      kw.push({
        id: `l1_pajak:${pj.periode.slice(0, 7)}`, lini: 'L1', jenis: 'pajak', pihak: 'Dispenda (PBJT perhotelan)', nominal: bulat(sisa),
        jatuhTempo: tanggalBulanBerikut(pj.periode.slice(0, 7), 15), jatuhTempoAsumsi: true,
        dasar: `Pajak hotel ${pj.periode.slice(0, 7)} tarif ${angka(pj.tarif_pct)}%`,
        sumber: { tabel: 'pajak_hotel_villa', ket: pj.periode.slice(0, 7) },
      });
    }
  }
  for (const s of data.snapshot.filter((x) => x.jenis === 'pengajuan_biaya_villa' && ['diajukan', 'disetujui'].includes(teks(x.data.status)))) {
    kw.push({
      id: `villa_biaya:${s.id}`, lini: 'L1', jenis: 'biaya_operasional', pihak: `Biaya villa: ${teks(s.data.kategori) || 'lainnya'}`,
      nominal: angka(s.data.nominal as number), jatuhTempo: tambahHari(hariIni, 3), jatuhTempoAsumsi: true,
      dasar: 'Pengajuan biaya villa belum ditransfer', sumber: { tabel: 'snapshot:pengajuan_biaya_villa', ket: s.id },
    });
  }
  // Kewajiban milik proyek yang dikunci (keputusan owner 2026-11-01): tidak masuk
  // laporan, prioritas bayar, maupun forecast — tetapi tetap dicatat di sini agar
  // tidak hilang dari pandangan (kewajibannya secara hukum tetap ada).
  const diLuarLingkup: Kewajiban[] = [];
  for (const s of data.snapshot.filter((x) => x.jenis === 'transfer_tertunda')) {
    if (proyekDikunci(teks(s.data.proyek))) {
      diLuarLingkup.push({
        id: `transfer:${s.id}`, lini: 'Grup', jenis: 'transfer_tertunda',
        pihak: `${teks(s.data.pihak) || 'Transfer'} (${teks(s.data.proyek)}/${teks(s.data.tipe)})`, nominal: angka(s.data.nominal as number),
        jatuhTempo: null, jatuhTempoAsumsi: false, dasar: `Proyek dikunci sejak ${TANGGAL_KUNCI}`,
        sumber: { tabel: 'snapshot:transfer_tertunda', ket: s.id },
      });
      continue;
    }
    kw.push({
      id: `transfer:${s.id}`, lini: teks(s.data.proyek) === 'LL' ? 'L2' : 'Grup', jenis: 'transfer_tertunda',
      pihak: `${teks(s.data.pihak) || 'Transfer'} (${teks(s.data.proyek)}/${teks(s.data.tipe)})`, nominal: angka(s.data.nominal as number),
      jatuhTempo: tambahHari(hariIni, 1), jatuhTempoAsumsi: true, dasar: 'Disetujui, menunggu transfer (MK Connect)',
      sumber: { tabel: 'snapshot:transfer_tertunda', ket: s.id },
    });
  }
  for (const s of data.snapshot.filter((x) => x.jenis === 'refund_customer')) {
    const cicilan = Array.isArray(s.data.cicilan) ? (s.data.cicilan as { bulan: string; nominal: number; lunas: boolean }[]) : [];
    for (const c of cicilan.filter((x) => !x.lunas)) {
      kw.push({
        id: `refund:${s.id}:${c.bulan}`, lini: 'Grup', jenis: 'refund_customer', pihak: `Refund ${teks(s.data.nama)}`,
        nominal: angka(c.nominal), jatuhTempo: c.bulan.slice(0, 10), jatuhTempoAsumsi: false, dasar: 'Termin refund (MK Connect /refund)',
        sumber: { tabel: 'snapshot:refund_customer', ket: s.id },
      });
    }
  }
  for (const u of data.utang_bank) {
    const sisa = angka(u.pokok) - angka(u.terbayar);
    if (sisa > 0) {
      (proyekDikunci(u.proyek) ? diLuarLingkup : kw).push({
        id: `bank:${u.id}`, lini: 'Grup', jenis: 'utang_bank', pihak: `${u.bank} — ${u.jenis} (${u.proyek})`, nominal: bulat(sisa),
        jatuhTempo: u.jt_tempo, jatuhTempoAsumsi: false, dasar: 'Akad kredit', sumber: { tabel: 'utang_bank', ket: `#${u.id}` },
      });
    }
  }
  const kewajiban = prioritaskan(kw, hariIni, kasTotal);
  const ringkasKw = ringkasKewajiban(kw, hariIni);
  const kewajibanLoonars = kw.filter((k) => k.lini !== 'Grup');

  // ── Piutang ──────────────────────────────────────────────────────────────
  const piutang = {
    kontrakL2: l2.piutangKontrak,
    otaL1: l1.neraca.piutangOta,
    total: bulat(l2.piutangKontrak + (l1.neraca.piutangOta ?? 0)),
  };

  // ── Input forecast ───────────────────────────────────────────────────────
  const acuan = l1.terakhirFinal ?? l1.terakhir;
  const hariAcuan = acuan ? hariDalamBulan(acuan.bulan) : 30;
  const peristiwa: Peristiwa[] = [];
  for (const u of l2.unit.filter((x) => x.terjual && x.sisaTagihan > 0 && x.jatuhTempo)) {
    peristiwa.push({
      tanggal: u.jatuhTempo!, nominal: u.sisaTagihan, jenis: 'tagihan_investor', lini: 'L2',
      ket: `Pelunasan ${u.kode}${u.pembeli ? ` (${u.pembeli})` : ''}`, sumber: { tabel: 'loonars2_v_unit', ket: u.kode },
    });
  }
  // Kewajiban Loonars (bukan Grup) yang bertanggal → peristiwa keluar.
  for (const k of kewajibanLoonars) {
    if (k.jenis === 'utang_owner' || k.jenis === 'sewa_tanah' || k.jenis === 'bagi_hasil_investor') continue;
    if (k.jenis === 'utang_supplier') {
      for (let w = 0; w < 4; w++) {
        peristiwa.push({ tanggal: tambahHari(hariIni, 7 * w + 6), nominal: -k.nominal / 4, jenis: k.jenis, lini: k.lini as 'L1' | 'L2', ket: `Cicilan ${k.pihak}`, sumber: k.sumber });
      }
      continue;
    }
    if (k.jatuhTempo) {
      peristiwa.push({ tanggal: k.jatuhTempo, nominal: -k.nominal, jenis: k.jenis, lini: k.lini as 'L1' | 'L2', ket: k.pihak, sumber: k.sumber });
    }
  }
  if (l2.tanah.sisa > 0 && l2.tanah.jatuhTempo) {
    const tgl = tanggalSatuBulanan(hariIni, l2.tanah.jatuhTempo);
    const daftarTgl = tgl.length ? tgl : [l2.tanah.jatuhTempo];
    for (const t of daftarTgl) {
      peristiwa.push({ tanggal: t, nominal: -l2.tanah.sisa / daftarTgl.length, jenis: 'sewa_tanah', lini: 'L2', ket: 'Penyisihan sewa tanah ke rekening B', sumber: { tabel: 'loonars2_settings' } });
    }
  }
  if (acuan) {
    const bh = acuan.bagiHasilInvestor + acuan.topupJaminan;
    // bulan berjalan dibayar bulan depan; seterusnya tiap bulan sebesar acuan.
    let bulan = (l1.terakhir ?? acuan).bulan;
    for (let i = 0; i < 7; i++) {
      const tgl = tanggalBulanBerikut(bulan, 10);
      const nominal = i === 0 && l1.terakhir ? l1.terakhir.bagiHasilInvestor + l1.terakhir.topupJaminan : bh;
      if (nominal > 0) {
        peristiwa.push({ tanggal: tgl, nominal: -nominal, jenis: 'bagi_hasil_investor', lini: 'L1', ket: `Bagi hasil investor ${bulan}`, sumber: { tabel: 'laporan_villa_bulanan' } });
      }
      bulan = tgl.slice(0, 7);
    }
  }
  const batas28 = tambahHari(hariIni, -28);
  const kasKonstruksi28 = jumlah(
    data.l2_pengeluaran.filter((d) => d.tanggal >= batas28 && ['material', 'tukang', 'lain_konstruksi'].includes(d.kategori) && d.cicilan_id == null),
    (d) => d.nominal,
  );
  const inputArusKas: InputArusKas = {
    hariIni,
    kasAwal: kasTotal,
    kasMinimum,
    l1MasukHarian: acuan ? acuan.pendapatanBersih / hariAcuan : 0,
    l1KeluarHarian: acuan ? (acuan.cogs + acuan.opex) / hariAcuan : 0,
    peristiwa,
    konstruksiPerHari: kasKonstruksi28 / 28,
    konstruksiSisaBudget: Math.max(0, l2.budgetUnitAktif - l2.aktualUnitAktif),
  };
  const skenario = semuaSkenario(inputArusKas);

  // ── Modal kerja ──────────────────────────────────────────────────────────
  const asetLancar = kasTotal + (l1.neraca.piutangOta ?? 0);
  const liabLancar = bulat(jumlah(kewajibanLoonars.filter((k) => k.jenis !== 'utang_owner' && k.jenis !== 'sewa_tanah'), (k) => k.nominal));
  const modalKerja = { asetLancar, liabilitasLancar: liabLancar, bersih: bulat(asetLancar - liabLancar) };

  // ── Kontrol ──────────────────────────────────────────────────────────────
  const rekon = rekonsiliasi(data, l1, l2);
  const abnormal = deteksiAbnormal(data);
  const sinkron = statusSinkron(data, sekarang);
  const peringatan = susunPeringatan({
    data, hariIni, l1, l2, kasTotal, kasMinimum, skenario, rekon, abnormal, sinkron,
    kewajibanLewat: ringkasKw.lewatJatuhTempo, kewajiban7Hari: ringkasKw.jatuhTempo7Hari,
  });

  // ── Konsolidasi owner ────────────────────────────────────────────────────
  const bulanIni = hariIni.slice(0, 7);
  const l1BulanIni = l1.bulan.find((b) => b.bulan === bulanIni) ?? null;
  const l2KeluarBulanIni = l2.arusKasBulanan.find((b) => b.bulan === bulanIni);
  const konsolidasi = {
    kasTotal,
    kewajibanTotal: ringkasKw.total,
    kewajibanLoonars: bulat(ringkasKw.L1 + ringkasKw.L2),
    piutangTotal: piutang.total,
    pendapatanOperasionalBulanIni: l1BulanIni?.revenue ?? 0,
    pendapatanOperasionalYtd: l1.ytd?.revenue ?? 0,
    cashInInvestor: l2.cashInInvestor,
    bebanOperasionalBulanIni: l1BulanIni ? bulat(l1BulanIni.cogs + l1BulanIni.opex) : 0,
    belanjaKonstruksiTotal: l2.belanjaKonstruksiGabungan,
    belanjaKonstruksiBulanIni: bulat(l2KeluarBulanIni?.keluarKonstruksi ?? 0),
    kebutuhanDana: { optimis: skenario.optimis.kebutuhanDana, normal: skenario.normal.kebutuhanDana, pesimis: skenario.pesimis.kebutuhanDana },
    jumlahPeringatanKritis: peringatan.filter((x) => x.tingkat === 'kritis').length,
    jumlahPeringatanTinggi: peringatan.filter((x) => x.tingkat === 'tinggi').length,
  };

  return {
    hariIni,
    dibuatPada: data.dibuat_pada,
    kasMinimum,
    l1,
    l2,
    kas,
    kasTotal,
    kewajiban,
    ringkasKewajiban: ringkasKw,
    /** Kewajiban proyek yang dikunci — di luar laporan L1/L2 (lihat lingkup.ts). */
    kewajibanDiLuarLingkup: { daftar: diLuarLingkup, total: bulat(jumlah(diLuarLingkup, (k) => k.nominal)), sejak: TANGGAL_KUNCI },
    piutang,
    arusKas: { input: inputArusKas, skenario, asumsi: ASUMSI },
    modalKerja,
    rekonsiliasi: rekon,
    abnormal,
    sinkron,
    peringatan,
    konsolidasi,
  };
}
