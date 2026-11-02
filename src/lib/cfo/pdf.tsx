/**
 * PDF laporan keuangan AI CFO untuk WhatsApp owner (migrasi 0062):
 *   - Laporan Holding SAK EMKM (laba rugi, posisi keuangan, ekuitas, CaLK)
 *   - Loonars 1 (villa) bulanan
 *   - Loonars 2 (penjualan villa + pembangunan, termasuk Loonars Coffee)
 *
 * Semua angka berasal dari model deterministik yang sama dengan halaman
 * /cfo/* (susunModelCfo, laporanHolding). Tidak ada angka yang dihitung di
 * sini selain format tampilan. Server-side, @react-pdf/renderer (sama dengan
 * Laporan Investor & laporan utang Loonars 2).
 */

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { BarisLr, LaporanHolding } from './holding';
import type { BulanL1 } from './loonars1';
import type { ModelCfo } from './model';
import { labelBulan } from './util';

const WARNA = { teks: '#0f172a', redup: '#64748b', garis: '#cbd5e1', latar: '#f1f5f9', aksen: '#0f766e', merah: '#b91c1c' };

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 48, paddingHorizontal: 36, fontSize: 8.5, color: WARNA.teks, fontFamily: 'Helvetica' },
  kop: { position: 'absolute', top: 18, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.6, borderBottomColor: WARNA.garis, paddingBottom: 5 },
  kopNama: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  kaki: { position: 'absolute', bottom: 18, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: WARNA.redup },
  h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, color: WARNA.aksen },
  h3: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 2 },
  kecil: { fontSize: 7.5, color: WARNA.redup, lineHeight: 1.4, marginBottom: 3 },
  paragraf: { fontSize: 8, lineHeight: 1.45, marginBottom: 2 },
  tabel: { borderTopWidth: 0.6, borderTopColor: WARNA.garis, marginBottom: 6 },
  baris: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: WARNA.garis, paddingVertical: 2.2 },
  barisTotal: { flexDirection: 'row', borderTopWidth: 0.9, borderTopColor: WARNA.teks, paddingVertical: 2.6 },
  barisKepala: { flexDirection: 'row', backgroundColor: WARNA.latar, paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: WARNA.garis },
  kartuBaris: { flexDirection: 'row', marginBottom: 6 },
  kartu: { flex: 1, marginRight: 5, padding: 5, backgroundColor: WARNA.latar, borderRadius: 3 },
  kartuLabel: { fontSize: 7, color: WARNA.redup, marginBottom: 2 },
  kartuNilai: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
});

const idNum = new Intl.NumberFormat('id-ID');
/** Format akuntansi: negatif dalam kurung; null = "—". */
export function rpPdf(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-';
  const r = Math.round(n);
  return r < 0 ? `(${idNum.format(-r)})` : idNum.format(r);
}
const pct = (n: number | null) => (n === null ? '-' : `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
/** Helvetica standar (WinAnsi) tidak punya beberapa simbol Unicode. */
export function aman(t: string): string {
  return t.replace(/[−–]/g, '-').replace(/↔/g, '-').replace(/→/g, '->').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[^\u0000-ÿ—’‘“”•…]/g, '');
}

function Sel({ w, kanan, tebal, children }: { w: string; kanan?: boolean; tebal?: boolean; children: string }) {
  return <Text style={{ width: w, paddingHorizontal: 3, textAlign: kanan ? 'right' : 'left', fontFamily: tebal ? 'Helvetica-Bold' : 'Helvetica' }}>{aman(children)}</Text>;
}

function Kerangka({ judul, sub, dibuat, children }: { judul: string; sub: string; dibuat: string; children: React.ReactNode }) {
  const waktu = new Date(dibuat).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }) + ' WIB';
  return (
    <Document title={judul} author="PT Loonars Mahakarya">
      <Page size="A4" style={s.page}>
        <View style={s.kop} fixed>
          <Text style={s.kopNama}>PT LOONARS MAHAKARYA</Text>
          <Text style={s.kecil}>{aman(sub)}</Text>
        </View>
        <Text style={s.h1}>{aman(judul)}</Text>
        <Text style={s.kecil}>Dibuat {waktu} oleh AI CFO MKH Property. Angka dihitung otomatis dari data sistem saat laporan dibuat (tanpa input manual).</Text>
        {children}
        <View style={s.kaki} fixed>
          <Text>Dokumen internal — {aman(sub)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Hal ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

function Kartu({ isi }: { isi: { label: string; nilai: string }[] }) {
  return (
    <View style={s.kartuBaris}>
      {isi.map((k) => (
        <View key={k.label} style={s.kartu}>
          <Text style={s.kartuLabel}>{aman(k.label)}</Text>
          <Text style={s.kartuNilai}>{aman(k.nilai)}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Holding ─────────────────────────────────────────────────────────────────

function TabelKolom({ baris, total }: { baris: BarisLr[]; total?: BarisLr[] }) {
  const sel = (b: BarisLr, tebal = false) => (
    <>
      <Sel w="40%" tebal={tebal}>{b.label}</Sel>
      <Sel w="15%" kanan tebal={tebal}>{rpPdf(b.L1)}</Sel>
      <Sel w="15%" kanan tebal={tebal}>{rpPdf(b.L2)}</Sel>
      <Sel w="15%" kanan tebal={tebal}>{rpPdf(b.holding)}</Sel>
      <Sel w="15%" kanan tebal>{rpPdf(b.konsolidasi)}</Sel>
    </>
  );
  return (
    <View style={s.tabel}>
      <View style={s.barisKepala}>
        <Sel w="40%" tebal>Akun (Rp)</Sel>
        <Sel w="15%" kanan tebal>Loonars 1</Sel>
        <Sel w="15%" kanan tebal>Loonars 2</Sel>
        <Sel w="15%" kanan tebal>Holding</Sel>
        <Sel w="15%" kanan tebal>Konsolidasi</Sel>
      </View>
      {baris.map((b) => (
        <View key={b.kode} style={s.baris} wrap={false}>{sel(b)}</View>
      ))}
      {(total ?? []).map((b) => (
        <View key={b.kode} style={s.barisTotal} wrap={false}>{sel(b, true)}</View>
      ))}
    </View>
  );
}

export function DokumenHolding({ h, dibuat }: { h: LaporanHolding; dibuat: string }) {
  const lb = h.labaBersih;
  const laba: BarisLr = { kode: '9-99', label: 'LABA (RUGI) BERSIH', L1: lb.L1, L2: lb.L2, holding: lb.holding, konsolidasi: lb.konsolidasi };
  return (
    <Kerangka judul={`Laporan Keuangan Holding — Tahun ${h.tahun}`} sub={`${h.statusPeriode} · SAK EMKM`} dibuat={dibuat}>
      <Kartu
        isi={[
          { label: 'Laba bersih konsolidasi', nilai: rpPdf(lb.konsolidasi) },
          { label: 'Total aset', nilai: rpPdf(h.posisi.totalAset.konsolidasi) },
          { label: 'Total liabilitas', nilai: rpPdf(h.posisi.totalLiabilitas.konsolidasi) },
          { label: 'Ekuitas', nilai: rpPdf(h.posisi.ekuitas.konsolidasi) },
        ]}
      />
      <Text style={s.h2}>1. Laporan Laba Rugi — {h.tahun}</Text>
      <TabelKolom baris={h.labaRugi} total={[laba]} />
      <Text style={s.h2}>2. Laporan Posisi Keuangan — per {h.posisi.perTanggal}</Text>
      <Text style={s.h3}>Aset</Text>
      <TabelKolom baris={h.posisi.aset} total={[h.posisi.totalAset]} />
      <Text style={s.h3}>Liabilitas</Text>
      <TabelKolom baris={h.posisi.liabilitas} total={[h.posisi.totalLiabilitas]} />
      <Text style={s.h3}>Ekuitas</Text>
      <TabelKolom baris={h.posisi.komponenEkuitas} total={[h.posisi.ekuitas]} />

      <Text style={s.h2}>3. Beban gaji holding per cabang ({h.tahun})</Text>
      <View style={s.tabel}>
        <View style={s.barisKepala}>
          <Sel w="50%" tebal>Cabang</Sel>
          <Sel w="25%" kanan tebal>Sudah ditransfer</Sel>
          <Sel w="25%" kanan tebal>Belum ditransfer</Sel>
        </View>
        {h.gaji.perCabang.map((c) => (
          <View key={c.cabang} style={s.baris} wrap={false}>
            <Sel w="50%">{c.cabang}</Sel>
            <Sel w="25%" kanan>{rpPdf(c.dibayar)}</Sel>
            <Sel w="25%" kanan>{rpPdf(c.terutang)}</Sel>
          </View>
        ))}
      </View>

      <Text style={s.h2}>4. Rekonsiliasi ke laporan sumber</Text>
      {h.rekonsiliasi.map((r) => (
        <Text key={r.label} style={s.paragraf}>
          {aman(`${r.cocok ? '[cocok]' : '[SELISIH]'} ${r.label}: ${rpPdf(r.kiri)} vs ${rpPdf(r.kanan)}`)}
        </Text>
      ))}

      <Text style={s.h2} break>5. Catatan atas Laporan Keuangan</Text>
      {h.catatan.map((c) => (
        <View key={c.judul} wrap={false}>
          <Text style={s.h3}>{aman(c.judul)}</Text>
          {c.isi.map((x) => (
            <Text key={x} style={s.paragraf}>• {aman(x)}</Text>
          ))}
        </View>
      ))}
    </Kerangka>
  );
}

// ── Loonars 1 bulanan ───────────────────────────────────────────────────────

export function DokumenLoonars1({ m, bulan, dibuat }: { m: ModelCfo; bulan: BulanL1 | null; dibuat: string }) {
  if (!bulan) {
    return (
      <Kerangka judul="Laporan Loonars 1 — Villa" sub="Loonars 1 · Hospitality" dibuat={dibuat}>
        <Text style={s.paragraf}>Laporan villa untuk bulan yang diminta belum tersedia di sistem.</Text>
      </Kerangka>
    );
  }
  const b = bulan;
  const baris: [string, number, boolean?][] = [
    ['Pendapatan kotor (dibayar tamu)', b.revenue],
    ['Komisi OTA', -b.komisiOta],
    ['Pendapatan bersih', b.pendapatanBersih, true],
    ['COGS', -b.cogs],
    ['Laba kotor', b.labaKotor, true],
    ['Gaji staf (payroll)', -b.payroll],
    ['OPEX lain', -b.opexLain],
    ['EBITDA', b.ebitda, true],
    ['Bagi hasil investor (pool 70%)', -b.bagiHasilInvestor],
    ['Top-up jaminan investor', -b.topupJaminan],
    ['Bagian MKH bersih', b.bagianMkhBersih, true],
  ];
  return (
    <Kerangka judul={`Laporan Loonars 1 — Villa · ${labelBulan(b.bulan)}`} sub={`Loonars 1 · Hospitality · status ${b.status}`} dibuat={dibuat}>
      <Kartu
        isi={[
          { label: 'Pendapatan kotor', nilai: rpPdf(b.revenue) },
          { label: 'EBITDA', nilai: rpPdf(b.ebitda) },
          { label: 'Okupansi', nilai: pct(b.okupansiPct) },
          { label: 'ADR / RevPAR', nilai: `${rpPdf(b.adr)} / ${rpPdf(b.revpar)}` },
        ]}
      />
      {b.status !== 'final' && <Text style={s.kecil}>Status laporan bulan ini masih SEMENTARA — angka dapat berubah sampai laporan villa final.</Text>}
      <Text style={s.h2}>Laba rugi villa</Text>
      <View style={s.tabel}>
        {baris.map(([label, n, tebal]) => (
          <View key={label} style={tebal ? s.barisTotal : s.baris} wrap={false}>
            <Sel w="70%" tebal={tebal}>{label}</Sel>
            <Sel w="30%" kanan tebal={tebal}>{rpPdf(n)}</Sel>
          </View>
        ))}
      </View>
      <Text style={s.h2}>Per channel</Text>
      <View style={s.tabel}>
        <View style={s.barisKepala}>
          <Sel w="30%" tebal>Channel</Sel>
          <Sel w="15%" kanan tebal>Malam</Sel>
          <Sel w="20%" kanan tebal>Kotor</Sel>
          <Sel w="15%" kanan tebal>Komisi</Sel>
          <Sel w="20%" kanan tebal>Bersih</Sel>
        </View>
        {b.channel.map((c) => (
          <View key={c.sumber} style={s.baris} wrap={false}>
            <Sel w="30%">{c.sumber}</Sel>
            <Sel w="15%" kanan>{String(c.malam)}</Sel>
            <Sel w="20%" kanan>{rpPdf(c.kotor)}</Sel>
            <Sel w="15%" kanan>{rpPdf(c.komisi)}</Sel>
            <Sel w="20%" kanan>{rpPdf(c.bersih)}</Sel>
          </View>
        ))}
      </View>
      <Text style={s.h2}>Operasional</Text>
      <Text style={s.paragraf}>{aman(`Malam terjual ${b.malamTerjual} dari ${b.malamTersedia} malam tersedia (okupansi ${pct(b.okupansiPct)}). ADR bersih ${rpPdf(b.adrBersih)}.`)}</Text>
      {b.pendapatanLain > 0 && <Text style={s.paragraf}>{aman(`Pendapatan walk-in (kafe/spa) ${rpPdf(b.pendapatanLain)} — di luar laba sesuai laporan sumber.`)}</Text>}
      <Text style={s.h2}>Catatan</Text>
      {m.l1.neraca.catatan.map((c) => (
        <Text key={c} style={s.paragraf}>• {aman(c)}</Text>
      ))}
    </Kerangka>
  );
}

// ── Loonars 2 ───────────────────────────────────────────────────────────────

export function DokumenLoonars2({ m, dibuat }: { m: ModelCfo; dibuat: string }) {
  const l2 = m.l2;
  return (
    <Kerangka judul="Laporan Loonars 2 — Penjualan Villa & Pembangunan" sub="Loonars 2 · Developer Loonars Living + Loonars Coffee" dibuat={dibuat}>
      <Kartu
        isi={[
          { label: `Unit terjual (${l2.unitTerjual}/${l2.jumlahUnit})`, nilai: rpPdf(l2.nilaiKontrak) },
          { label: 'Uang investor diterima', nilai: rpPdf(l2.cashInInvestor) },
          { label: 'Total pengeluaran pembangunan', nilai: rpPdf(l2.belanjaKonstruksiGabungan) },
          { label: 'Sisa utang toko (gabungan)', nilai: rpPdf(l2.utangToko + l2.utangProyekLain) },
        ]}
      />
      <Text style={s.kecil}>Uang investor sebelum serah terima = uang muka (kewajiban), bukan pendapatan. Serah terima unit akhir Desember.</Text>

      <Text style={s.h2}>1. Penjualan & penagihan</Text>
      <View style={s.tabel}>
        <View style={s.barisKepala}>
          <Sel w="16%" tebal>Unit</Sel>
          <Sel w="20%" tebal>Pembeli</Sel>
          <Sel w="12%" tebal>Status</Sel>
          <Sel w="17%" kanan tebal>Harga</Sel>
          <Sel w="17%" kanan tebal>Dibayar</Sel>
          <Sel w="18%" kanan tebal>Sisa tagihan</Sel>
        </View>
        {l2.unit.filter((u) => u.terjual).map((u) => (
          <View key={u.id} style={s.baris} wrap={false}>
            <Sel w="16%">{u.kode}</Sel>
            <Sel w="20%">{u.pembeli ?? '-'}</Sel>
            <Sel w="12%">{u.status}</Sel>
            <Sel w="17%" kanan>{rpPdf(u.harga)}</Sel>
            <Sel w="17%" kanan>{rpPdf(u.dibayar)}</Sel>
            <Sel w="18%" kanan>{rpPdf(u.sisaTagihan)}</Sel>
          </View>
        ))}
      </View>
      <Text style={s.paragraf}>{aman(`Unit belum terjual: ${l2.unitTersedia} (nilai ${rpPdf(l2.nilaiPersediaanTersedia)}). Piutang kontrak: ${rpPdf(l2.piutangKontrak)}.`)}</Text>

      <Text style={s.h2}>2. Saldo rekening</Text>
      <View style={s.tabel}>
        {l2.rekening.map((r) => (
          <View key={r.kode} style={s.baris} wrap={false}>
            <Sel w="60%">{`${r.kode} — ${r.nama}`}</Sel>
            <Sel w="40%" kanan>{rpPdf(r.saldo)}</Sel>
          </View>
        ))}
      </View>
      {l2.danaTalangan > 0 && <Text style={s.paragraf}>{aman(`Dana talangan owner (saldo C negatif): ${rpPdf(l2.danaTalangan)}.`)}</Text>}

      <Text style={s.h2}>3. Pengeluaran pembangunan</Text>
      <View style={s.tabel}>
        <View style={s.barisKepala}>
          <Sel w="16%" tebal>Unit</Sel>
          <Sel w="14%" tebal>Status</Sel>
          <Sel w="18%" kanan tebal>Budget</Sel>
          <Sel w="18%" kanan tebal>Aktual</Sel>
          <Sel w="14%" kanan tebal>Realisasi</Sel>
          <Sel w="20%" kanan tebal>Lewat budget</Sel>
        </View>
        {l2.unit.filter((u) => u.aktual > 0 || u.sedangDibangun).map((u) => (
          <View key={u.id} style={s.baris} wrap={false}>
            <Sel w="16%">{u.kode}</Sel>
            <Sel w="14%">{u.statusBangun}</Sel>
            <Sel w="18%" kanan>{rpPdf(u.budget)}</Sel>
            <Sel w="18%" kanan>{rpPdf(u.aktual)}</Sel>
            <Sel w="14%" kanan>{pct(u.realisasiPct)}</Sel>
            <Sel w="20%" kanan>{u.overBudget > 0 ? rpPdf(u.overBudget) : '-'}</Sel>
          </View>
        ))}
      </View>
      {l2.proyek.map((p) => (
        <View key={p.id} wrap={false}>
          <Text style={s.h3}>{aman(`${p.nama} (dibiayai Loonars 2)`)}</Text>
          <Text style={s.paragraf}>
            {aman(
              `Budget ${rpPdf(p.budgetTotal)} · realisasi ${rpPdf(p.realisasiTotal)} (material ${rpPdf(p.realisasiMaterial)}, tukang/kontraktor ${rpPdf(p.realisasiTenaga)}, lain-lain ${rpPdf(p.realisasiLain)})` +
                (p.selisihBudget !== null ? ` · ${p.selisihBudget > 0 ? `lewat budget ${rpPdf(p.selisihBudget)}` : `sisa budget ${rpPdf(-p.selisihBudget)}`}` : '') +
                ` · utang toko belum lunas ${rpPdf(p.utangBelumLunas)}.`,
            )}
          </Text>
        </View>
      ))}
      <Text style={s.paragraf}>{aman(`Total pengeluaran pembangunan = villa ${rpPdf(l2.biayaKonstruksiKas)} + proyek lain ${rpPdf(l2.biayaProyekLain)} = ${rpPdf(l2.belanjaKonstruksiGabungan)}.`)}</Text>

      <Text style={s.h2}>4. Utang toko bangunan (villa)</Text>
      <View style={s.tabel}>
        {l2.utangTokoPerToko.map((t) => (
          <View key={t.id} style={s.baris} wrap={false}>
            <Sel w="60%">{t.nama}</Sel>
            <Sel w="40%" kanan>{rpPdf(t.sisa)}</Sel>
          </View>
        ))}
        <View style={s.barisTotal} wrap={false}>
          <Sel w="60%" tebal>Total sisa utang toko villa</Sel>
          <Sel w="40%" kanan tebal>{rpPdf(l2.utangToko)}</Sel>
        </View>
      </View>

      <Text style={s.h2}>5. Posisi keuangan Loonars 2</Text>
      <View style={s.tabel}>
        {(
          [
            ['Kas rekening (saldo positif)', l2.neraca.kas],
            ['Persediaan unit dalam pembangunan', l2.neraca.asetDalamPembangunan],
            ['Aset tetap dalam penyelesaian (Loonars Coffee)', l2.neraca.asetProyekLain],
            ['Jumlah aset', l2.neraca.totalAset, true],
            ['Utang toko (villa + proyek lain)', l2.neraca.utangToko + l2.neraca.utangProyekLain],
            ['Uang muka investor', l2.neraca.uangMukaInvestor],
            ['Utang fee marketing', l2.neraca.feeTerutang],
            ['Utang kepada owner (dana talangan)', l2.neraca.utangOwner],
            ['Jumlah liabilitas', l2.neraca.totalLiabilitas, true],
            ['Ekuitas (aset - liabilitas)', l2.neraca.ekuitasTersirat, true],
          ] as [string, number, boolean?][]
        ).map(([label, n, tebal]) => (
          <View key={label} style={tebal ? s.barisTotal : s.baris} wrap={false}>
            <Sel w="70%" tebal={tebal}>{label}</Sel>
            <Sel w="30%" kanan tebal={tebal}>{rpPdf(n)}</Sel>
          </View>
        ))}
      </View>
      <Text style={s.paragraf}>{aman(`Proyeksi proyek (bila semua unit terjual): pendapatan ${rpPdf(l2.proyeksi.pendapatan)}, laba ${rpPdf(l2.proyeksi.laba)} (margin ${pct(l2.proyeksi.marginPct)}).`)}</Text>
    </Kerangka>
  );
}
