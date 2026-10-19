/**
 * Dokumen PDF "Laporan Pembayaran Utang Toko — Loonars 2" (server-side,
 * @react-pdf/renderer, sama dengan Laporan Investor). Isi sepenuhnya dari
 * data RPC loonars2_laporan_utang_data (migrasi 0053); tidak ada angka yang
 * dihitung di sini.
 */

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PERUSAHAAN } from '@/lib/config';

export interface LaporanUtangPembayaran {
  kode: string;
  tanggal: string | null;
  nominal: number;
  keterangan: string | null;
  ada_bukti: boolean;
  talangan: boolean;
}

export interface LaporanUtangRincian {
  kode: string;
  tanggal: string;
  rincian: string | null;
  nominal: number;
  status: string;
  oleh: string | null;
}

export interface LaporanUtangToko {
  nama: string;
  utang_disetujui: number;
  cicilan_dibayar: number;
  sisa: number;
  utang: LaporanUtangRincian[];
  pembayaran: LaporanUtangPembayaran[];
}

export interface LaporanUtangData {
  dibuat_pada: string;
  ringkasan: { total_utang: number; total_dibayar: number; total_sisa: number };
  toko: LaporanUtangToko[];
}

const WARNA = { teks: '#0f172a', redup: '#64748b', garis: '#cbd5e1', latar: '#f1f5f9', aksen: '#0f766e', merah: '#b91c1c' };

const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 48, paddingHorizontal: 40, fontSize: 9, color: WARNA.teks, fontFamily: 'Helvetica' },
  kop: { position: 'absolute', top: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.6, borderBottomColor: WARNA.garis, paddingBottom: 5 },
  kopNama: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  kaki: { position: 'absolute', bottom: 18, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: WARNA.redup },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  h2: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, color: WARNA.aksen },
  h3: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 3 },
  kecil: { fontSize: 7.5, color: WARNA.redup, lineHeight: 1.4, marginBottom: 4 },
  tabel: { borderTopWidth: 0.6, borderTopColor: WARNA.garis, marginBottom: 6 },
  baris: { flexDirection: 'row', borderBottomWidth: 0.4, borderBottomColor: WARNA.garis, paddingVertical: 2.5 },
  barisKepala: { flexDirection: 'row', backgroundColor: WARNA.latar, paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: WARNA.garis },
  tebal: { fontFamily: 'Helvetica-Bold' },
  kartuBaris: { flexDirection: 'row', marginBottom: 6 },
  kartu: { flex: 1, marginRight: 6, padding: 6, backgroundColor: WARNA.latar, borderRadius: 3 },
  kartuLabel: { fontSize: 7.5, color: WARNA.redup, marginBottom: 2 },
  kartuNilai: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
});

const idNum = new Intl.NumberFormat('id-ID');
const rp = (n: number) => `Rp ${idNum.format(Math.round(n))}`;
const tgl = (t: string | null) =>
  t ? new Date(`${t.slice(0, 10)}T00:00:00+07:00`).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const waktu = (iso: string) => new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long', timeStyle: 'short' }) + ' WIB';

function Sel({ w, kanan, tebal, children }: { w: number | string; kanan?: boolean; tebal?: boolean; children: string }) {
  return (
    <Text style={{ width: w as number, paddingHorizontal: 3, textAlign: kanan ? 'right' : 'left', fontFamily: tebal ? 'Helvetica-Bold' : 'Helvetica' }}>{children}</Text>
  );
}

export function DokumenLaporanUtang({ data }: { data: LaporanUtangData }) {
  const { ringkasan, toko } = data;
  return (
    <Document title="Laporan Pembayaran Utang Toko — Loonars 2" author={PERUSAHAAN}>
      <Page size="A4" style={s.page}>
        <View style={s.kop} fixed>
          <View>
            <Text style={s.kopNama}>{PERUSAHAAN.toUpperCase()}</Text>
            <Text style={s.kecil}>Loonars 2 · Laporan Pembayaran Utang Toko</Text>
          </View>
        </View>

        <Text style={s.h1}>Laporan Pembayaran Utang Toko — Loonars 2</Text>
        <Text style={s.kecil}>Dibuat {waktu(data.dibuat_pada)}. Seluruh angka dari catatan MKH Property saat laporan dibuat.</Text>

        <View style={s.kartuBaris}>
          <View style={s.kartu}>
            <Text style={s.kartuLabel}>Total utang tercatat</Text>
            <Text style={s.kartuNilai}>{rp(ringkasan.total_utang)}</Text>
          </View>
          <View style={s.kartu}>
            <Text style={s.kartuLabel}>Sudah dibayar</Text>
            <Text style={s.kartuNilai}>{rp(ringkasan.total_dibayar)}</Text>
          </View>
          <View style={s.kartu}>
            <Text style={s.kartuLabel}>Sisa utang</Text>
            <Text style={s.kartuNilai}>{rp(ringkasan.total_sisa)}</Text>
          </View>
        </View>

        <Text style={s.h2}>Ringkasan per toko</Text>
        {toko.length === 0 ? (
          <Text style={s.kecil}>Belum ada utang toko yang tercatat.</Text>
        ) : (
          <View style={s.tabel}>
            <View style={s.barisKepala}>
              <Sel w="40%" tebal>Toko</Sel>
              <Sel w="20%" kanan tebal>Utang</Sel>
              <Sel w="20%" kanan tebal>Dibayar</Sel>
              <Sel w="20%" kanan tebal>Sisa</Sel>
            </View>
            {toko.map((t) => (
              <View key={t.nama} style={s.baris} wrap={false}>
                <Sel w="40%">{t.nama}</Sel>
                <Sel w="20%" kanan>{rp(t.utang_disetujui)}</Sel>
                <Sel w="20%" kanan>{rp(t.cicilan_dibayar)}</Sel>
                <Sel w="20%" kanan tebal>{rp(t.sisa)}</Sel>
              </View>
            ))}
          </View>
        )}

        {toko.map((t) => (
          <View key={`d-${t.nama}`}>
            <Text style={s.h2}>{t.nama}</Text>
            <Text style={s.kecil}>
              Utang {rp(t.utang_disetujui)} · dibayar {rp(t.cicilan_dibayar)} · sisa {rp(t.sisa)}
            </Text>

            <Text style={s.h3}>Pembayaran</Text>
            {t.pembayaran.length === 0 ? (
              <Text style={s.kecil}>Belum ada pembayaran.</Text>
            ) : (
              <View style={s.tabel}>
                <View style={s.barisKepala}>
                  <Sel w="12%" tebal>Tanggal</Sel>
                  <Sel w="9%" tebal>Kode</Sel>
                  <Sel w="19%" kanan tebal>Nominal</Sel>
                  <Sel w="50%" tebal>Keterangan</Sel>
                  <Sel w="10%" tebal>Bukti</Sel>
                </View>
                {t.pembayaran.map((p, i) => (
                  <View key={`${p.kode}-${i}`} style={s.baris} wrap={false}>
                    <Sel w="12%">{tgl(p.tanggal)}</Sel>
                    <Sel w="9%">{p.kode}</Sel>
                    <Sel w="19%" kanan>{rp(p.nominal)}</Sel>
                    <Sel w="50%">{`${p.keterangan ?? '-'}${p.talangan ? ' (dana talangan owner)' : ''}`}</Sel>
                    <Sel w="10%">{p.ada_bukti ? 'ada' : '-'}</Sel>
                  </View>
                ))}
              </View>
            )}

            <Text style={s.h3}>Utang tercatat</Text>
            <View style={s.tabel}>
              <View style={s.barisKepala}>
                <Sel w="12%" tebal>Tanggal</Sel>
                <Sel w="9%" tebal>Kode</Sel>
                <Sel w="19%" kanan tebal>Nominal</Sel>
                <Sel w="60%" tebal>Rincian</Sel>
              </View>
              {t.utang.map((u) => (
                <View key={u.kode} style={s.baris} wrap={false}>
                  <Sel w="12%">{tgl(u.tanggal)}</Sel>
                  <Sel w="9%">{u.kode}</Sel>
                  <Sel w="19%" kanan>{rp(u.nominal)}</Sel>
                  <Sel w="60%">{`${u.rincian ?? '-'}${u.oleh ? ` — ${u.oleh}` : ''}`}</Sel>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={s.kaki} fixed>
          <Text>{PERUSAHAAN} — laporan internal.</Text>
          <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
