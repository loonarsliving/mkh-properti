'use client';

import { PERUSAHAAN } from '@/lib/config';
import { fmtAbs, rupiah, tanggalPanjang } from '@/lib/format';
import { labelPeriodeLaporan, labelTanggalPosisi } from '@/lib/periode';
import type { KelompokPos, PaketLaporan } from '@/lib/akuntansi/sak-emkm';

/** Laporan mana saja yang disertakan di berkas cetak. */
export interface PilihanLaporan {
  posisiKeuangan: boolean;
  labaRugi: boolean;
  calk: boolean;
  perubahanEkuitas: boolean;
  arusKas: boolean;
}

/** Angka laporan: negatif dalam kurung, nol sebagai strip. */
function n(v: number): string {
  if (Math.abs(v) < 0.5) return '-';
  return v < 0 ? `(${fmtAbs(v)})` : fmtAbs(v);
}

function KopLaporan({
  judul,
  subJudul,
  lingkupProyek,
}: {
  judul: string;
  subJudul: string;
  lingkupProyek: string | null;
}) {
  return (
    <div className="lh">
      <div className="text-[13pt] font-bold uppercase tracking-wide">{PERUSAHAAN}</div>
      <div className="mt-0.5 text-[12pt] font-bold uppercase">{judul}</div>
      <div className="mt-0.5 text-[10pt]">{subJudul}</div>
      {lingkupProyek ? (
        <div className="text-[10pt]">Lingkup: proyek {lingkupProyek}</div>
      ) : null}
      <div className="text-[10pt]">(Disajikan dalam Rupiah, kecuali dinyatakan lain)</div>
    </div>
  );
}

function BlokTandaTangan({
  kota,
  direktur,
  akuntan,
}: {
  kota: string;
  direktur: string;
  akuntan: string;
}) {
  const tgl = tanggalPanjang(new Date());
  return (
    <div className="mt-10 flex justify-between">
      {[
        { peran: 'Disetujui oleh,', nama: direktur || '_______________', jabatan: 'Direktur Utama' },
        { peran: 'Disiapkan oleh,', nama: akuntan || '_______________', jabatan: 'Akuntan Perusahaan' },
      ].map((s) => (
        <div key={s.jabatan} className="w-[220px] text-center text-[10pt]">
          <div>
            {kota}, {tgl}
          </div>
          <div>{s.peran}</div>
          <div className="mt-14 border-t border-slate-700 pt-1">
            <b>{s.nama}</b>
            <br />
            {s.jabatan}
          </div>
        </div>
      ))}
    </div>
  );
}

function BarisKelompok({ kelompok, sembunyikanNol }: { kelompok: KelompokPos; sembunyikanNol?: boolean }) {
  const baris = sembunyikanNol ? kelompok.baris.filter((b) => Math.abs(b.nilai) > 0.5) : kelompok.baris;
  return (
    <table className="lt">
      <tbody>
        {baris.length === 0 ? (
          <tr>
            <td className="indent italic">Nihil</td>
            <td>-</td>
          </tr>
        ) : (
          baris.map((b) => (
            <tr key={b.kode}>
              <td className="indent">{b.nama}</td>
              <td>{n(b.nilai)}</td>
            </tr>
          ))
        )}
        <tr className="subtotal">
          <td>Jumlah {kelompok.judul}</td>
          <td>{n(kelompok.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function LembarLaporan({
  laporan,
  pilihan,
  direktur,
  akuntan,
  kota,
  lingkupProyek,
}: {
  laporan: PaketLaporan;
  pilihan: PilihanLaporan;
  direktur: string;
  akuntan: string;
  kota: string;
  lingkupProyek: string | null;
}) {
  const { labaRugi: lr, posisiKeuangan: pk, perubahanEkuitas: pe, arusKas: ak } = laporan;
  const periodeLabel = labelPeriodeLaporan(laporan.periode);
  const tanggalPosisi = labelTanggalPosisi(laporan.periode);
  const ttd = { kota, direktur, akuntan };

  return (
    <div className="laporan-paper">
      {/* ── LAPORAN POSISI KEUANGAN ─────────────────────────────── */}
      {pilihan.posisiKeuangan ? (
        <div className="page">
          <KopLaporan
            judul="Laporan Posisi Keuangan"
            subJudul={`Per ${tanggalPosisi}`}
            lingkupProyek={lingkupProyek}
          />

          <div className="sec-title">Aset</div>
          <div className="mb-1 text-[10pt] font-bold">Aset Lancar</div>
          <BarisKelompok kelompok={pk.asetLancar} />
          <div className="mb-1 mt-3 text-[10pt] font-bold">Aset Tetap</div>
          <BarisKelompok kelompok={pk.asetTetap} />

          <table className="lt mt-2">
            <tbody>
              <tr className="double-line">
                <td>JUMLAH ASET</td>
                <td>{n(pk.totalAset)}</td>
              </tr>
            </tbody>
          </table>

          <div className="sec-title mt-5">Liabilitas dan Ekuitas</div>
          <div className="mb-1 text-[10pt] font-bold">Liabilitas Jangka Pendek</div>
          <BarisKelompok kelompok={pk.liabilitasLancar} />
          <div className="mb-1 mt-3 text-[10pt] font-bold">Liabilitas Jangka Panjang</div>
          <BarisKelompok kelompok={pk.liabilitasPanjang} />

          <div className="mb-1 mt-3 text-[10pt] font-bold">Ekuitas</div>
          <table className="lt">
            <tbody>
              <tr>
                <td className="indent">Modal Disetor</td>
                <td>{n(pk.modal)}</td>
              </tr>
              <tr>
                <td className="indent">Saldo Laba Awal Periode</td>
                <td>{n(pk.saldoLabaAwal)}</td>
              </tr>
              <tr>
                <td className="indent">Laba (Rugi) Periode Berjalan</td>
                <td>{n(pk.labaPeriodeBerjalan)}</td>
              </tr>
              <tr className="subtotal">
                <td>Jumlah Ekuitas</td>
                <td>{n(pk.totalEkuitas)}</td>
              </tr>
            </tbody>
          </table>

          <table className="lt mt-2">
            <tbody>
              <tr className="double-line">
                <td>JUMLAH LIABILITAS DAN EKUITAS</td>
                <td>{n(pk.totalLiabilitasEkuitas)}</td>
              </tr>
            </tbody>
          </table>

          <p
            className="mt-2 text-[9pt] font-bold"
            style={{ color: pk.seimbang ? '#16a34a' : '#dc2626' }}
          >
            {pk.seimbang
              ? '✓ Neraca seimbang'
              : `⚠ Neraca tidak seimbang — selisih ${rupiah(pk.selisih)}. Periksa jurnal yang debet ≠ kredit.`}
          </p>

          <BlokTandaTangan {...ttd} />
        </div>
      ) : null}

      {/* ── LAPORAN LABA RUGI ───────────────────────────────────── */}
      {pilihan.labaRugi ? (
        <div className="page">
          <KopLaporan judul="Laporan Laba Rugi" subJudul={periodeLabel} lingkupProyek={lingkupProyek} />

          <div className="sec-title">A. Pendapatan</div>
          <BarisKelompok kelompok={lr.pendapatan} sembunyikanNol />

          <div className="sec-title">B. Beban Pokok Pendapatan</div>
          <BarisKelompok kelompok={lr.bebanPokok} sembunyikanNol />

          <table className="lt my-2">
            <tbody>
              <tr className="total-line">
                <td className="text-[11pt]">LABA KOTOR</td>
                <td className="text-[11pt]">{n(lr.labaKotor)}</td>
              </tr>
            </tbody>
          </table>

          <div className="sec-title">C. Beban Operasional</div>
          <BarisKelompok kelompok={lr.bebanOperasional} sembunyikanNol />

          <table className="lt mt-3">
            <tbody>
              <tr className="total-line">
                <td>LABA (RUGI) SEBELUM PAJAK PENGHASILAN</td>
                <td>{n(lr.labaSebelumPajak)}</td>
              </tr>
              <tr>
                <td className="indent">Beban Pajak Penghasilan</td>
                <td>{lr.bebanPajak > 0 ? `(${fmtAbs(lr.bebanPajak)})` : '-'}</td>
              </tr>
              <tr className="double-line">
                <td className="text-[12pt]">LABA (RUGI) BERSIH PERIODE BERJALAN</td>
                <td className="text-[12pt]">{n(lr.labaBersih)}</td>
              </tr>
            </tbody>
          </table>

          <p className="mt-4 text-[9.5pt] italic text-slate-600">
            * Tidak terdapat penghasilan komprehensif lain pada periode ini.
          </p>

          <BlokTandaTangan {...ttd} />
        </div>
      ) : null}

      {/* ── LAPORAN PERUBAHAN EKUITAS (tambahan) ────────────────── */}
      {pilihan.perubahanEkuitas ? (
        <div className="page">
          <KopLaporan
            judul="Laporan Perubahan Ekuitas"
            subJudul={periodeLabel}
            lingkupProyek={lingkupProyek}
          />
          <p className="mb-3 text-[9pt] italic text-slate-600">
            Laporan ini bukan bagian dari syarat minimum SAK EMKM; disajikan sebagai informasi
            tambahan.
          </p>

          <table className="lt">
            <thead>
              <tr style={{ borderBottom: '2px solid #111' }}>
                <th className="py-1 text-left text-[10pt]">Keterangan</th>
                <th className="w-[150px] py-1 text-right text-[10pt]">Modal Disetor</th>
                <th className="w-[150px] py-1 text-right text-[10pt]">Saldo Laba</th>
                <th className="w-[150px] py-1 text-right text-[10pt]">Total Ekuitas</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Saldo Awal Periode</td>
                <td className="text-right">{n(pe.modalAwal)}</td>
                <td className="text-right">{n(pe.saldoLabaAwal)}</td>
                <td className="text-right">{n(pe.totalAwal)}</td>
              </tr>
              <tr>
                <td className="indent">Penambahan / Pengurangan Modal</td>
                <td className="text-right">{n(pe.tambahanModal)}</td>
                <td className="text-right">-</td>
                <td className="text-right">{n(pe.tambahanModal)}</td>
              </tr>
              <tr>
                <td className="indent">Laba (Rugi) Periode Berjalan</td>
                <td className="text-right">-</td>
                <td className="text-right">{n(pe.labaPeriodeBerjalan)}</td>
                <td className="text-right">{n(pe.labaPeriodeBerjalan)}</td>
              </tr>
              <tr className="double-line">
                <td>Saldo Akhir per {tanggalPosisi}</td>
                <td className="text-right">{n(pe.modalAkhir)}</td>
                <td className="text-right">{n(pe.saldoLabaAkhir)}</td>
                <td className="text-right">{n(pe.totalAkhir)}</td>
              </tr>
            </tbody>
          </table>

          <BlokTandaTangan {...ttd} />
        </div>
      ) : null}

      {/* ── LAPORAN ARUS KAS (tambahan) ─────────────────────────── */}
      {pilihan.arusKas ? (
        <div className="page">
          <KopLaporan judul="Laporan Arus Kas" subJudul={periodeLabel} lingkupProyek={lingkupProyek} />
          <p className="mb-3 text-[9pt] italic text-slate-600">
            Disusun dengan metode langsung. Laporan ini bukan bagian dari syarat minimum SAK EMKM;
            disajikan sebagai informasi tambahan. Setiap nomor transaksi diklasifikasikan menurut
            akun lawan dari mutasi kasnya.
          </p>

          {[ak.operasi, ak.investasi, ak.pendanaan].map((k, i) => (
            <div key={k.judul}>
              <div className="sec-title">
                {['I', 'II', 'III'][i]}. {k.judul}
              </div>
              <table className="lt">
                <tbody>
                  {k.baris.length === 0 ? (
                    <tr>
                      <td className="indent italic">Tidak ada arus kas pada kelompok ini</td>
                      <td>-</td>
                    </tr>
                  ) : (
                    k.baris.map((b) => (
                      <tr key={b.kode}>
                        <td className="indent">{b.nama}</td>
                        <td>{n(b.nilai)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="subtotal">
                    <td>Arus Kas Bersih dari {k.judul.replace('Arus Kas dari ', '')}</td>
                    <td>{n(k.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          <table className="lt mt-4">
            <tbody>
              <tr className="total-line">
                <td>Kenaikan (Penurunan) Bersih Kas dan Setara Kas</td>
                <td>{n(ak.kenaikanBersih)}</td>
              </tr>
              <tr>
                <td>Kas dan Setara Kas Awal Periode</td>
                <td>{n(ak.kasAwal)}</td>
              </tr>
              <tr className="double-line">
                <td>KAS DAN SETARA KAS AKHIR PERIODE</td>
                <td>{n(ak.kasAkhir)}</td>
              </tr>
            </tbody>
          </table>

          {Math.abs(ak.selisih) >= 1 ? (
            <p className="mt-2 text-[9pt] font-bold" style={{ color: '#dc2626' }}>
              ⚠ Selisih {rupiah(ak.selisih)} terhadap saldo buku besar kas — biasanya karena ada
              transaksi kas tanpa akun lawan yang jelas. Periksa jurnal periode ini.
            </p>
          ) : null}

          <BlokTandaTangan {...ttd} />
        </div>
      ) : null}

      {/* ── CATATAN ATAS LAPORAN KEUANGAN ───────────────────────── */}
      {pilihan.calk ? (
        <div className="page">
          <KopLaporan
            judul="Catatan atas Laporan Keuangan"
            subJudul={`Per ${tanggalPosisi} dan ${periodeLabel}`}
            lingkupProyek={lingkupProyek}
          />

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">1. UMUM</div>
            <div className="text-justify text-[10.5pt] leading-relaxed">
              <p className="mb-1.5">
                <b>a. Pendirian Perusahaan</b>
                <br />
                {PERUSAHAAN} (selanjutnya disebut &quot;Perusahaan&quot;) adalah perseroan terbatas
                yang bergerak di bidang properti dan kontraktor, berdomisili di Kendari, Sulawesi
                Tenggara, Indonesia.
              </p>
              <p>
                <b>b. Kegiatan Usaha</b>
                <br />
                Kegiatan utama Perusahaan meliputi pengembangan properti (developer) dan jasa
                konstruksi. Proyek yang berjalan meliputi Al Fath Puuwatu, Introvert House, Loonars
                Living, Griya Cariu Indah, dan Green Cibarusah Residence.
              </p>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">2. PERNYATAAN KEPATUHAN</div>
            <div className="text-justify text-[10.5pt] leading-relaxed">
              Laporan keuangan ini disusun sesuai dengan Standar Akuntansi Keuangan Entitas Mikro,
              Kecil, dan Menengah (SAK EMKM) yang ditetapkan oleh Ikatan Akuntan Indonesia dan
              berlaku efektif sejak 1 Januari 2018.
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">3. IKHTISAR KEBIJAKAN AKUNTANSI</div>
            <div className="text-justify text-[10.5pt] leading-relaxed">
              <p className="mb-1.5">
                <b>a. Dasar Penyusunan</b> — Laporan keuangan disusun atas dasar akrual dan konsep
                biaya historis, dengan asumsi kelangsungan usaha.
              </p>
              <p className="mb-1.5">
                <b>b. Kas dan Setara Kas</b> — Terdiri dari kas tunai dan simpanan bank yang tidak
                dibatasi penggunaannya.
              </p>
              <p className="mb-1.5">
                <b>c. Piutang</b> — Diakui sebesar jumlah tagihan.
              </p>
              <p className="mb-1.5">
                <b>d. Aset Tetap</b> — Diakui sebesar biaya perolehan. Penyusutan dihitung dengan
                metode garis lurus selama estimasi masa manfaat aset.
              </p>
              <p>
                <b>e. Pengakuan Pendapatan</b> — Pendapatan penjualan unit properti diakui saat
                risiko dan manfaat kepemilikan berpindah kepada pembeli.
              </p>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">4. KAS DAN SETARA KAS</div>
            <table className="calk-table">
              <thead>
                <tr>
                  <th>Keterangan</th>
                  <th>Per {tanggalPosisi}</th>
                </tr>
              </thead>
              <tbody>
                {laporan.rincianKas.map((b) => (
                  <tr key={b.kode}>
                    <td>{b.nama}</td>
                    <td>{n(b.nilai)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Jumlah</td>
                  <td>{n(laporan.rincianKas.reduce((s, b) => s + b.nilai, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">5. IKHTISAR LAPORAN KEUANGAN</div>
            <table className="calk-table">
              <thead>
                <tr>
                  <th>Pos</th>
                  <th>Nilai</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Total Aset', pk.totalAset],
                  ['Total Liabilitas', pk.totalLiabilitas],
                  ['Total Ekuitas', pk.totalEkuitas],
                  ['Total Pendapatan', lr.pendapatan.total],
                  ['Total Beban Pokok Pendapatan', lr.bebanPokok.total],
                  ['Laba Kotor', lr.labaKotor],
                  ['Total Beban Operasional', lr.bebanOperasional.total],
                ].map(([label, nilai]) => (
                  <tr key={String(label)}>
                    <td>{label}</td>
                    <td>{n(nilai as number)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Laba (Rugi) Bersih Periode Berjalan</td>
                  <td>{n(lr.labaBersih)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mb-5">
            <div className="mb-1.5 text-[11pt] font-bold">6. KEJADIAN SETELAH PERIODE PELAPORAN</div>
            <div className="text-justify text-[10.5pt] leading-relaxed">
              Tidak terdapat kejadian material setelah tanggal laporan posisi keuangan sampai dengan
              tanggal penyelesaian laporan keuangan ini yang memerlukan penyesuaian atau
              pengungkapan.
            </div>
          </div>

          <BlokTandaTangan {...ttd} />
        </div>
      ) : null}
    </div>
  );
}
