/**
 * Dokumen PDF Laporan Investor (server-side, @react-pdf/renderer — tanpa
 * Chromium, jalan di Vercel serverless).
 *
 * Isi sepenuhnya dari `ModelLaporan` (lihat model.ts). Tidak ada angka yang
 * dihitung di sini selain pembagian sederhana untuk tampilan grafik; nilai
 * yang tidak ada ditulis "data belum tersedia", tidak pernah 0.
 */

import { Document, Line, Page, Path, Rect, StyleSheet, Svg, Text, View, Text as SvgText } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { PERUSAHAAN } from '@/lib/config';
import {
  DATA_BELUM_TERSEDIA,
  DEFINISI_BUKU_BESAR,
  DEFINISI_METRIK,
  LABEL_JENIS,
  LABEL_MODEL,
  VERSI_DEFINISI,
} from './kontrak';
import { nilaiMetrik, type BulanUnit, type ModelLaporan, type UnitLaporan } from './model';

const WARNA = {
  teks: '#0f172a',
  redup: '#64748b',
  garis: '#cbd5e1',
  latar: '#f1f5f9',
  aksen: '#0f766e',
  aksen2: '#b45309',
  merah: '#b91c1c',
};

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, color: WARNA.teks, fontFamily: 'Helvetica' },
  kop: { position: 'absolute', top: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.6, borderBottomColor: WARNA.garis, paddingBottom: 5 },
  kopNama: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  rahasia: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: WARNA.merah, borderWidth: 0.8, borderColor: WARNA.merah, paddingHorizontal: 4, paddingVertical: 1 },
  kaki: { position: 'absolute', bottom: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: WARNA.redup },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  h2: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 5, color: WARNA.aksen },
  h3: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 7, marginBottom: 3 },
  p: { lineHeight: 1.45, marginBottom: 4 },
  kecil: { fontSize: 7.5, color: WARNA.redup, lineHeight: 1.4 },
  tabel: { borderTopWidth: 0.6, borderTopColor: WARNA.garis, marginBottom: 6 },
  baris: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: WARNA.garis, paddingVertical: 2.5 },
  barisKepala: { flexDirection: 'row', backgroundColor: WARNA.latar, paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: WARNA.garis },
  sel: { flex: 1, paddingHorizontal: 3 },
  selKanan: { flex: 1, paddingHorizontal: 3, textAlign: 'right' },
  tebal: { fontFamily: 'Helvetica-Bold' },
  kartuBaris: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  kartu: { width: '31%', marginRight: '2%', marginBottom: 6, padding: 6, backgroundColor: WARNA.latar, borderRadius: 3 },
  kartuLabel: { fontSize: 7.5, color: WARNA.redup, marginBottom: 2 },
  kartuNilai: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  kartuCatatan: { fontSize: 6.8, color: WARNA.redup, marginTop: 2 },
  label: { fontSize: 7, paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2, color: '#fff', alignSelf: 'flex-start' },
});

// ── Format ──────────────────────────────────────────────────────────────

const idNum = new Intl.NumberFormat('id-ID');
const idDes = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function rp(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DATA_BELUM_TERSEDIA;
  return n < 0 ? `(Rp ${idNum.format(Math.round(-n))})` : `Rp ${idNum.format(Math.round(n))}`;
}
function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DATA_BELUM_TERSEDIA;
  return `${idDes.format(n)}%`;
}
function num(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DATA_BELUM_TERSEDIA;
  return idNum.format(Math.round(n));
}
function tanggalWaktu(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }) + ' WIB';
}

const LABEL_STATUS: Record<BulanUnit['status'], { teks: string; warna: string }> = {
  lengkap: { teks: 'lengkap', warna: '#15803d' },
  sementara: { teks: 'sementara', warna: '#b45309' },
  sebagian: { teks: 'sebagian', warna: '#b45309' },
  kosong: { teks: 'kosong', warna: '#b91c1c' },
  belum_mulai: { teks: 'belum mulai', warna: '#64748b' },
};

// ── Komponen kecil ──────────────────────────────────────────────────────

function Halaman({ model, children }: { model: ModelLaporan; children: ReactNode }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.kop} fixed>
        <View>
          <Text style={s.kopNama}>{PERUSAHAAN.toUpperCase()}</Text>
          <Text style={s.kecil}>Laporan Investor & Track Record · {model.labelRentang}</Text>
        </View>
        <Text style={s.rahasia}>RAHASIA</Text>
      </View>
      {children}
      <View style={s.kaki} fixed>
        <Text>Rahasia — hanya untuk penerima yang dituju. Dilarang menggandakan tanpa izin {PERUSAHAAN}.</Text>
        <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

function Tabel({
  kolom,
  baris,
  lebar,
  teks,
}: {
  kolom: string[];
  baris: (string | number)[][];
  lebar?: number[];
  /** Semua kolom rata kiri (tabel berisi teks, bukan angka). */
  teks?: boolean;
}) {
  return (
    <View style={s.tabel}>
      <View style={s.barisKepala} wrap={false}>
        {kolom.map((k, i) => (
          <Text key={k + i} style={[i === 0 || teks ? s.sel : s.selKanan, s.tebal, lebar ? { flex: lebar[i] } : {}]}>{k}</Text>
        ))}
      </View>
      {baris.map((r, ri) => (
        <View key={ri} style={s.baris} wrap={false}>
          {r.map((c, i) => (
            <Text key={i} style={[i === 0 || teks ? s.sel : s.selKanan, lebar ? { flex: lebar[i] } : {}]}>{String(c)}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Kartu({ label, nilai, catatan }: { label: string; nilai: string; catatan?: string }) {
  return (
    <View style={s.kartu} wrap={false}>
      <Text style={s.kartuLabel}>{label}</Text>
      <Text style={s.kartuNilai}>{nilai}</Text>
      {catatan ? <Text style={s.kartuCatatan}>{catatan}</Text> : null}
    </View>
  );
}

function Narasi({ model, bagian, kosong }: { model: ModelLaporan; bagian: keyof ModelLaporan['narasi']; kosong: string }) {
  const n = model.narasi[bagian];
  if (!n || !n.isi.trim()) return <Text style={[s.p, { color: WARNA.redup }]}>{kosong}</Text>;
  return (
    <View>
      {n.isi.split(/\n{2,}/).map((para, i) => (
        <Text key={i} style={s.p}>{para.trim()}</Text>
      ))}
      <Text style={s.kecil}>Narasi manual, versi {tanggalWaktu(n.dibuat_pada)} oleh {n.dibuat_oleh}.</Text>
    </View>
  );
}

/** Grafik batang (pendapatan) + garis (laba) per bulan, SVG murni. */
function GrafikTren({ data }: { data: { label: string; pendapatan: number; laba: number }[] }) {
  const W = 515;
  const H = 150;
  const pad = { l: 8, r: 8, t: 10, b: 22 };
  const nilai = data.flatMap((d) => [d.pendapatan, d.laba, 0]);
  const maks = Math.max(...nilai);
  const min = Math.min(...nilai);
  const rentangY = maks - min || 1;
  const y = (v: number) => pad.t + ((maks - v) / rentangY) * (H - pad.t - pad.b);
  const lebarKolom = (W - pad.l - pad.r) / Math.max(data.length, 1);
  const x = (i: number) => pad.l + i * lebarKolom + lebarKolom / 2;
  const garis = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.laba).toFixed(1)}`).join(' ');

  return (
    <Svg width={W} height={H}>
      <Line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={WARNA.garis} strokeWidth={0.8} />
      {data.map((d, i) => {
        const atas = Math.min(y(d.pendapatan), y(0));
        const tinggi = Math.abs(y(0) - y(d.pendapatan));
        return <Rect key={i} x={x(i) - lebarKolom * 0.3} y={atas} width={lebarKolom * 0.6} height={Math.max(tinggi, 0.5)} fill={WARNA.aksen} opacity={0.8} />;
      })}
      {data.length > 1 ? <Path d={garis} stroke={WARNA.aksen2} strokeWidth={1.6} fill="none" /> : null}
      {data.map((d, i) => (
        <SvgText key={`l${i}`} x={x(i) - 12} y={H - 6} style={{ fontSize: 6.5 }} fill={WARNA.redup}>
          {d.label}
        </SvgText>
      ))}
    </Svg>
  );
}

// ── Bagian ──────────────────────────────────────────────────────────────

function unitOperasi(model: ModelLaporan): UnitLaporan[] {
  return model.unit.filter((u) => u.unit.jenis === 'operasi_properti');
}

function bulanTerakhirBerdata(u: UnitLaporan): BulanUnit | null {
  for (let i = u.bulan.length - 1; i >= 0; i--) {
    const b = u.bulan[i];
    if (Object.keys(b.metrik).length || b.pendapatanLama) return b;
  }
  return null;
}

function Sampul({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <View style={{ marginTop: 110 }}>
        <Text style={[s.rahasia, { alignSelf: 'flex-start', fontSize: 10, marginBottom: 18 }]}>RAHASIA</Text>
        <Text style={{ fontSize: 24, fontFamily: 'Helvetica-Bold', marginBottom: 8 }}>Laporan Investor & Track Record</Text>
        <Text style={{ fontSize: 13, marginBottom: 24 }}>{PERUSAHAAN}</Text>
        <Text style={s.p}>Periode: {model.labelRentang}</Text>
        <Text style={s.p}>Data diambil: {tanggalWaktu(model.dibuatPada)} (realtime dari buku besar dan sistem sumber)</Text>
        <Text style={s.p}>Cakupan: {model.unit.map((u) => u.unit.nama).join(', ') || DATA_BELUM_TERSEDIA}</Text>
        <Text style={[s.kecil, { marginTop: 24 }]}>
          Model bisnis: mengoperasikan properti tanpa harus memiliki asetnya, serta mengembangkan proyek properti.
          Semua angka berasal dari sistem; bagian yang belum ada datanya ditulis &quot;{DATA_BELUM_TERSEDIA}&quot;.
          Definisi dan sumber setiap angka ada di lampiran (versi definisi {VERSI_DEFINISI}).
        </Text>
      </View>
    </Halaman>
  );
}

function Ringkasan({ model }: { model: ModelLaporan }) {
  const k = model.keuangan;
  const operasi = unitOperasi(model);
  const nProyek = model.unit.filter((u) => u.unit.jenis === 'proyek_pembangunan').length;
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Ringkasan Eksekutif</Text>
      <Narasi model={model} bagian="ringkasan" kosong="Narasi ringkasan belum diisi." />
      <Text style={s.h2}>Angka utama (buku besar, {model.labelRentang})</Text>
      <View style={s.kartuBaris}>
        <Kartu label="Pendapatan" nilai={rp(k?.labaRugi.pendapatan.total ?? null)} />
        <Kartu label="Laba operasional" nilai={rp(k?.labaRugi.labaSebelumPajak ?? null)} catatan="Sebelum pajak" />
        <Kartu label="Kas & bank akhir periode" nilai={rp(k ? k.rincianKas.reduce((a, b) => a + b.nilai, 0) : null)} />
        <Kartu label="Total liabilitas" nilai={rp(k?.posisiKeuangan.totalLiabilitas ?? null)} />
        <Kartu label="Total aset" nilai={rp(k?.posisiKeuangan.totalAset ?? null)} />
        <Kartu label="Unit bisnis" nilai={`${operasi.length} operasi · ${nProyek} proyek`} />
      </View>
      {operasi.map((u) => {
        const b = bulanTerakhirBerdata(u);
        return (
          <View key={u.unit.kode} wrap={false}>
            <Text style={s.h3}>{u.unit.nama} — {b ? b.label : 'belum ada data'}</Text>
            <View style={s.kartuBaris}>
              <Kartu label="Pendapatan basis investor" nilai={rp(b ? b.pendapatanLama?.rental ?? nilaiMetrik(b, 'pendapatan_basis_investor') : null)} />
              <Kartu label="Okupansi (unit total)" nilai={pct(b ? nilaiMetrik(b, 'okupansi_unit_total_pct') : null)} />
              <Kartu label="Okupansi (unit dijual)" nilai={pct(b ? nilaiMetrik(b, 'okupansi_unit_dijual_pct') : null)} />
            </View>
            {b?.parsial ? <Text style={s.kecil}>Bulan parsial: {b.catatan.find((c) => c.startsWith('Bulan parsial')) ?? ''}</Text> : null}
          </View>
        );
      })}
      <Text style={s.h2}>Kelengkapan data</Text>
      <Text style={s.p}>
        Dari {Object.values(model.kelengkapan).reduce((a, b) => a + b, 0)} unit-bulan: {model.kelengkapan.lengkap} lengkap,{' '}
        {model.kelengkapan.sementara} sementara, {model.kelengkapan.sebagian} sebagian, {model.kelengkapan.kosong} kosong,{' '}
        {model.kelengkapan.belum_mulai} sebelum operasi. Rincian per bulan ada di lampiran.
      </Text>
    </Halaman>
  );
}

function Tren({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Tren Bulanan</Text>
      <Text style={s.kecil}>Batang hijau = pendapatan; garis jingga = laba operasional. Gabungan unit terpilih, dari buku besar.</Text>
      <GrafikTren data={model.trenBukuBesar} />
      <Tabel
        kolom={['Bulan', 'Pendapatan', 'Laba operasional', 'Kas & bank akhir']}
        baris={model.trenBukuBesar.map((t) => [t.label, rp(t.pendapatan), rp(t.laba), rp(t.kas)])}
      />
      {unitOperasi(model).map((u) => (
        <View key={u.unit.kode}>
          <Text style={s.h3}>{u.unit.nama}</Text>
          <Tabel
            kolom={['Bulan', 'Status', 'Basis investor', 'Non-kamar', 'Okupansi total', 'Okupansi dijual']}
            lebar={[1.2, 0.8, 1.3, 1, 1, 1]}
            baris={u.bulan.map((b) => [
              b.label + (b.praBuka && b.status !== 'belum_mulai' ? ' (pra-buka)' : b.parsial ? ' (parsial)' : ''),
              LABEL_STATUS[b.status].teks,
              rp(b.pendapatanLama?.rental ?? nilaiMetrik(b, 'pendapatan_basis_investor')),
              rp(b.pendapatanLama?.nonKamar ?? nilaiMetrik(b, 'pendapatan_walkin')),
              pct(nilaiMetrik(b, 'okupansi_unit_total_pct')),
              pct(nilaiMetrik(b, 'okupansi_unit_dijual_pct')),
            ])}
          />
        </View>
      ))}
    </Halaman>
  );
}

function Channel({ model }: { model: ModelLaporan }) {
  const operasi = unitOperasi(model);
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Channel & Unit Economics</Text>
      {operasi.length === 0 ? <Text style={s.p}>Tidak ada unit operasi properti dalam cakupan laporan.</Text> : null}
      {operasi.map((u) => {
        const b = bulanTerakhirBerdata(u);
        const channel = (b?.metrik.channel ?? null) as Record<string, { booking?: number; malam?: number; pendapatan_kotor?: number }> | null;
        return (
          <View key={u.unit.kode}>
            <Text style={s.h2}>{u.unit.nama}</Text>
            <Tabel
              kolom={['Bulan', 'ADR kotor', 'ADR bersih', 'RevPAR kotor', 'Booking diakui', 'Batal', 'Porsi OTA']}
              lebar={[1.2, 1, 1, 1, 0.8, 0.6, 0.8]}
              baris={u.bulan.filter((x) => x.status !== 'belum_mulai').map((x) => [
                x.label,
                rp(nilaiMetrik(x, 'adr_kotor')),
                rp(nilaiMetrik(x, 'adr_bersih')),
                rp(nilaiMetrik(x, 'revpar_kotor')),
                num(nilaiMetrik(x, 'booking_diakui')),
                num(nilaiMetrik(x, 'booking_batal')),
                pct(nilaiMetrik(x, 'porsi_ota_pct')),
              ])}
            />
            <Text style={s.h3}>Rincian channel — {b ? b.label : DATA_BELUM_TERSEDIA}</Text>
            {channel && typeof channel === 'object' ? (
              <Tabel
                kolom={['Channel', 'Booking', 'Malam', 'Pendapatan kotor']}
                baris={Object.entries(channel).map(([nama, c]) => [nama, num(c?.booking ?? null), num(c?.malam ?? null), rp(c?.pendapatan_kotor ?? null)])}
              />
            ) : (
              <Text style={s.p}>{DATA_BELUM_TERSEDIA}</Text>
            )}
          </View>
        );
      })}
    </Halaman>
  );
}

function Tim({ model }: { model: ModelLaporan }) {
  const operasi = unitOperasi(model);
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Tim & Efisiensi Operasional</Text>
      <Text style={s.kecil}>Hanya agregat — tanpa nama atau gaji per orang. Fungsi yang dikerjakan pihak luar tidak dihitung sebagai headcount.</Text>
      {operasi.map((u) => (
        <View key={u.unit.kode}>
          <Text style={s.h2}>{u.unit.nama}</Text>
          <Tabel
            kolom={['Bulan', 'Headcount', 'Unit / karyawan', 'Total gaji', 'Gaji % pendapatan', 'Outsourcing']}
            lebar={[1.1, 0.8, 0.9, 1.1, 0.9, 1.2]}
            baris={u.bulan.filter((x) => x.status !== 'belum_mulai').map((x) => {
              const hc = nilaiMetrik(x, 'headcount_total');
              const unitTotal = nilaiMetrik(x, 'unit_total') ?? u.unit.jumlah_unit_total;
              const gajiBuku = x.bukuBesar && x.bukuBesar.gaji > 0 ? x.bukuBesar.gaji : null;
              const gaji = gajiBuku ?? nilaiMetrik(x, 'total_gaji');
              const basis = x.pendapatanLama?.rental ?? nilaiMetrik(x, 'pendapatan_basis_investor');
              const outs = x.metrik.fungsi_outsourcing;
              return [
                x.label,
                num(hc),
                hc && unitTotal ? idDes.format(unitTotal / hc) : DATA_BELUM_TERSEDIA,
                gaji === null ? DATA_BELUM_TERSEDIA : rp(gaji) + (gajiBuku ? '' : ' *'),
                gaji !== null && basis ? pct((gaji / basis) * 100) : DATA_BELUM_TERSEDIA,
                Array.isArray(outs) ? outs.join(', ') : typeof outs === 'string' ? outs : DATA_BELUM_TERSEDIA,
              ];
            })}
          />
          <Text style={s.kecil}>* angka kiriman MK Connect, di luar buku besar.</Text>
        </View>
      ))}
    </Halaman>
  );
}

function Teknologi({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Teknologi Sistem</Text>
      <Narasi model={model} bagian="teknologi" kosong="Narasi teknologi belum diisi." />
      <Text style={s.h3}>Sumber data yang dipakai laporan ini</Text>
      <Tabel
        teks
        kolom={['Unit bisnis', 'Jenis', 'Sumber data', 'Kode buku besar']}
        baris={model.unit.map((u) => [u.unit.nama, LABEL_JENIS[u.unit.jenis] ?? u.unit.jenis, u.unit.sumber_data, u.unit.kode_proyek_jurnal.join(', ') || '-'])}
      />
    </Halaman>
  );
}

function Keuangan({ model }: { model: ModelLaporan }) {
  const k = model.keuangan;
  if (!k) {
    return (
      <Halaman model={model}>
        <Text style={s.h1}>Keuangan</Text>
        <Text style={s.p}>Buku besar untuk unit terpilih: {DATA_BELUM_TERSEDIA}.</Text>
      </Halaman>
    );
  }
  const lr = k.labaRugi;
  const pk = k.posisiKeuangan;
  const ak = k.arusKas;
  const kewajibanInvestor = unitOperasi(model).flatMap((u) =>
    u.bulan
      .filter((b) => nilaiMetrik(b, 'kewajiban_investor_tetap') !== null || nilaiMetrik(b, 'kewajiban_investor_jaminan') !== null)
      .map((b) => [`${u.unit.nama} — ${b.label}`, rp(nilaiMetrik(b, 'kewajiban_investor_tetap')), rp(nilaiMetrik(b, 'kewajiban_investor_jaminan'))]),
  );
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Keuangan</Text>
      <Text style={s.kecil}>
        Disusun dengan mesin laporan SAK EMKM aplikasi untuk kode proyek: {model.kodeProyekKeuangan.join(', ')}. {k.labelPeriode}.
      </Text>
      <Text style={s.h2}>Laba rugi</Text>
      <Tabel
        kolom={['Pos', 'Jumlah']}
        lebar={[3, 1.2]}
        baris={[
          ...lr.pendapatan.baris.map((b) => [`  ${b.nama}`, rp(b.nilai)]),
          ['Total pendapatan', rp(lr.pendapatan.total)],
          ...lr.bebanPokok.baris.map((b) => [`  ${b.nama}`, rp(b.nilai)]),
          ['Total beban pokok', rp(lr.bebanPokok.total)],
          ['Laba kotor', rp(lr.labaKotor)],
          ...lr.bebanOperasional.baris.map((b) => [`  ${b.nama}`, rp(b.nilai)]),
          ['Total beban operasional', rp(lr.bebanOperasional.total)],
          ['Laba operasional (sebelum pajak)', rp(lr.labaSebelumPajak)],
        ]}
      />
      <Text style={s.h2}>Arus kas (metode langsung)</Text>
      <Tabel
        kolom={['Aktivitas', 'Jumlah']}
        lebar={[3, 1.2]}
        baris={[
          ['Kas awal periode', rp(ak.kasAwal)],
          [ak.operasi.judul, rp(ak.operasi.total)],
          [ak.investasi.judul, rp(ak.investasi.total)],
          [ak.pendanaan.judul, rp(ak.pendanaan.total)],
          ['Kas akhir periode', rp(ak.kasAkhir)],
        ]}
      />
      <Text style={s.h2}>Posisi keuangan & kewajiban ({k.labelTanggalPosisi})</Text>
      <Tabel
        kolom={['Pos', 'Jumlah']}
        lebar={[3, 1.2]}
        baris={[
          ['Total aset', rp(pk.totalAset)],
          ...pk.liabilitasLancar.baris.filter((b) => b.nilai !== 0).map((b) => [`  ${b.nama}`, rp(b.nilai)]),
          ...pk.liabilitasPanjang.baris.filter((b) => b.nilai !== 0).map((b) => [`  ${b.nama}`, rp(b.nilai)]),
          ['Total liabilitas', rp(pk.totalLiabilitas)],
          ['Total ekuitas', rp(pk.totalEkuitas)],
          ['Seimbang', pk.seimbang ? 'ya' : `tidak (selisih ${rp(pk.selisih)})`],
        ]}
      />
      <Text style={s.h3}>Utang bank</Text>
      {model.unit.some((u) => u.utangBank.length) ? (
        <Tabel
          kolom={['Unit', 'Jenis', 'Bank', 'Sisa pokok', 'Jatuh tempo']}
          baris={model.unit.flatMap((u) => u.utangBank.map((x) => [u.unit.nama, x.jenis, x.bank, rp(x.sisa), x.jatuhTempo ?? '-']))}
        />
      ) : (
        <Text style={s.p}>Tidak ada utang bank tercatat untuk unit terpilih.</Text>
      )}
      <Text style={s.h3}>Kewajiban tetap ke investor unit (baris tersendiri, bukan biaya operasional)</Text>
      {kewajibanInvestor.length ? (
        <Tabel kolom={['Unit — bulan', 'Pembayaran tetap', 'Top-up jaminan']} baris={kewajibanInvestor} />
      ) : (
        <Text style={s.p}>{DATA_BELUM_TERSEDIA} (belum dikirim sistem operasi properti).</Text>
      )}
    </Halaman>
  );
}

function Portofolio({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Portofolio per Unit Bisnis</Text>
      <Tabel
        kolom={['Unit', 'Jenis', 'Kota', 'Mulai', 'Unit', 'Pendapatan', 'Laba op.', 'Kas akhir', 'Liabilitas']}
        lebar={[1.5, 1, 0.8, 0.8, 0.5, 1.1, 1.1, 1.1, 1.1]}
        baris={model.unit.map((u) => [
          u.unit.nama,
          LABEL_JENIS[u.unit.jenis] ?? u.unit.jenis,
          u.unit.kota ?? '-',
          u.unit.tgl_mulai_operasi ?? '-',
          u.unit.jumlah_unit_total ?? '-',
          u.unit.jenis === 'operasi_properti' ? rp(u.total.pendapatanBasisInvestor) : rp(u.total.pendapatan),
          rp(u.total.laba),
          rp(u.total.kasAkhir),
          rp(u.total.liabilitasAkhir),
        ])}
      />
      <Text style={s.kecil}>Operasi properti: kolom pendapatan = basis investor. Proyek pembangunan: dari buku besar.</Text>
      {model.unit.map((u) => (
        <View key={u.unit.kode} wrap={false}>
          <Text style={s.h3}>{u.unit.nama}</Text>
          <Text style={s.kecil}>
            {LABEL_JENIS[u.unit.jenis]} · model: {u.unit.model_kepemilikan ? LABEL_MODEL[u.unit.model_kepemilikan] : 'belum diisi'} · unit
            dijual: {u.unit.jumlah_unit_dijual ?? 'belum diisi'}
            {u.unit.catatan ? ` · ${u.unit.catatan}` : ''}
          </Text>
          {u.aset.length ? (
            <Text style={s.kecil}>
              Aset/unit: {u.aset.map((a) => `${a.status} ${a.jumlah} (${rp(a.nilai)})`).join(' · ')}
            </Text>
          ) : null}
        </View>
      ))}
    </Halaman>
  );
}

function Risiko({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Risiko & Mitigasi</Text>
      <Text style={s.h2}>Risiko</Text>
      <Narasi model={model} bagian="risiko" kosong="Narasi risiko belum diisi." />
      <Text style={s.h2}>Mitigasi</Text>
      <Narasi model={model} bagian="mitigasi" kosong="Narasi mitigasi belum diisi." />
      <Text style={s.h2}>Temuan otomatis dari pemeriksaan data</Text>
      <Text style={s.kecil}>Dilaporkan apa adanya, tidak dihaluskan.</Text>
      {model.temuan.length ? (
        model.temuan.map((t, i) => (
          <Text key={i} style={[s.p, t.tingkat === 'perhatian' ? { color: WARNA.merah } : {}]}>
            • {t.unit ? `[${t.unit}] ` : ''}
            {t.teks}
          </Text>
        ))
      ) : (
        <Text style={s.p}>Tidak ada temuan.</Text>
      )}
      <Text style={s.h3}>Catatan</Text>
      <Narasi model={model} bagian="catatan" kosong="—" />
      <Text style={[s.kecil, { marginTop: 8 }]}>
        Laporan ini tidak memuat proyeksi. Bila proyeksi ditambahkan lewat narasi, itu adalah perkiraan manajemen dan bukan data aktual.
      </Text>
    </Halaman>
  );
}

function Lampiran({ model }: { model: ModelLaporan }) {
  return (
    <Halaman model={model}>
      <Text style={s.h1}>Lampiran: Definisi dan Sumber</Text>
      <Text style={s.h2}>Angka dari buku besar</Text>
      <Tabel teks kolom={['Angka', 'Definisi']} lebar={[1, 3]} baris={DEFINISI_BUKU_BESAR.map((d) => [d.label, d.definisi])} />
      <Text style={s.h2}>Kontrak KPI kiriman sistem ({VERSI_DEFINISI})</Text>
      <Tabel
        teks
        kolom={['Kunci', 'Angka', 'Definisi', 'Sumber']}
        lebar={[1.1, 1.1, 3, 1.1]}
        baris={DEFINISI_METRIK.map((d) => [d.kunci, d.label, d.definisi, d.sumber])}
      />
      <Text style={s.h2}>Kelengkapan & asal data per bulan</Text>
      {model.unit.map((u) => (
        <View key={u.unit.kode}>
          <Text style={s.h3}>{u.unit.nama}</Text>
          <Tabel
            teks
            kolom={['Bulan', 'Status', 'Sumber', 'Catatan']}
            lebar={[0.9, 0.7, 1.3, 3]}
            baris={u.bulan.map((b) => [
              b.label,
              LABEL_STATUS[b.status].teks,
              [
                b.bukuBesar ? `jurnal (${b.bukuBesar.jumlahTransaksi} transaksi)` : null,
                ...Array.from(new Set(Object.values(b.asalMetrik))),
                b.pendapatanLama ? `pendapatan_villa (${b.pendapatanLama.sumber})` : null,
              ]
                .filter(Boolean)
                .join(', ') || '-',
              b.catatan.join(' ') || '-',
            ])}
          />
        </View>
      ))}
      <Text style={s.kecil}>
        Dibuat {tanggalWaktu(model.dibuatPada)} untuk {model.peminta}. Laporan dihitung ulang dari data terbaru setiap kali dibuat;
        angka kiriman sistem yang pernah direvisi ditandai di kolom catatan dan riwayatnya tersimpan.
      </Text>
    </Halaman>
  );
}

export function DokumenLaporan({ model }: { model: ModelLaporan }) {
  const b = model.bagian;
  return (
    <Document title={`Laporan Investor ${model.labelRentang}`} author={PERUSAHAAN} subject="Rahasia" creator="MKH Property">
      {b.has('sampul') ? <Sampul model={model} /> : null}
      {b.has('ringkasan') ? <Ringkasan model={model} /> : null}
      {b.has('tren') ? <Tren model={model} /> : null}
      {b.has('channel') ? <Channel model={model} /> : null}
      {b.has('tim') ? <Tim model={model} /> : null}
      {b.has('teknologi') ? <Teknologi model={model} /> : null}
      {b.has('keuangan') ? <Keuangan model={model} /> : null}
      {b.has('portofolio') ? <Portofolio model={model} /> : null}
      {b.has('risiko') ? <Risiko model={model} /> : null}
      {b.has('lampiran') ? <Lampiran model={model} /> : null}
    </Document>
  );
}
