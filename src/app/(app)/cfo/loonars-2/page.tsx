'use client';

import { useJudul } from '@/components/shell/JudulProvider';
import { Panel } from '@/components/ui/Umum';
import { Catatan, DenganModel, DaftarSumber, Kpi, TabelAngka, Uang } from '@/components/cfo/Ui';
import { labelBulan, labelTanggal, persen, rp } from '@/lib/cfo/util';

/** 3. Loonars 2 — Developer & Construction Financial Report. */
export default function HalamanCfoL2() {
  useJudul({ judul: 'Loonars 2 — Developer Finance', deskripsi: 'Penjualan ke investor, piutang, konstruksi, budget vs actual, utang, profitabilitas', tampilkanFilter: false });
  return (
    <DenganModel>
      {(m) => {
        const l2 = m.l2;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Sales contract value" nilai={l2.nilaiKontrak} ikon="dokumen" nada="blue" catatan={`${l2.unitTerjual}/${l2.jumlahUnit} unit terjual`} />
              <Kpi label="Investor cash-in" nilai={l2.cashInInvestor} ikon="kas-masuk" nada="emerald" catatan="Dicatat sebagai uang muka (liabilitas) sampai serah terima" />
              <Kpi label="Outstanding receivables" nilai={l2.piutangKontrak} ikon="kalender" nada="violet" catatan="Sisa nilai kontrak (di luar neraca)" />
              <Kpi label="Construction expenses" nilai={l2.belanjaKonstruksiGabungan} ikon="palu" nada="slate" catatan={`Villa (kas) ${rp(l2.biayaKonstruksiKas)}${l2.proyek.map((x) => ` + ${x.nama} ${rp(x.realisasiTotal)}`).join('')}`} />
              <Kpi label="Accounts payable (toko)" nilai={l2.utangToko} ikon="kas-keluar" nada="amber" />
              <Kpi label="Dana talangan owner" nilai={l2.danaTalangan} ikon="peringatan" nada={l2.danaTalangan > 0 ? 'rose' : 'emerald'} catatan="Saldo negatif rekening = utang proyek ke owner" />
              <Kpi label="Proyeksi laba proyek" nilai={l2.proyeksi.laba} ikon="grafik" nada={l2.proyeksi.laba >= 0 ? 'emerald' : 'rose'} catatan={l2.proyeksi.marginPct === null ? undefined : `margin ${persen(l2.proyeksi.marginPct)} bila semua unit terjual`} />
              <Kpi label="Sisa sewa tanah" nilai={l2.tanah.sisa} ikon="rumah" nada="amber" catatan={l2.tanah.jatuhTempo ? `jatuh tempo ${labelTanggal(l2.tanah.jatuhTempo)}` : undefined} />
            </div>

            <Panel judul="Per unit: penjualan, budget vs actual, biaya per villa" ikon="rumah" padat>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Unit</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Pembeli</th>
                      <th className="px-3 py-2 text-right">Harga</th><th className="px-3 py-2 text-right">Dibayar</th><th className="px-3 py-2 text-right">Sisa tagihan</th>
                      <th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2 text-right">Aktual</th><th className="px-3 py-2 text-right">Realisasi</th><th className="px-3 py-2 text-right">Proyeksi laba</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l2.unit.map((u) => (
                      <tr key={u.id} className={`border-b border-slate-100 ${u.dibangunTanpaPembeli ? 'bg-amber-50/60' : ''} ${u.overBudget > 0 ? 'bg-rose-50' : ''}`}>
                        <td className="px-3 py-1.5 font-semibold">{u.kode}<div className="text-[10px] font-normal text-slate-400">{u.tipe}</div></td>
                        <td className="px-3 py-1.5">{u.status}<div className="text-[10px] text-slate-400">bangun: {u.statusBangun}{u.sedangDibangun ? ' (aktif)' : ''}</div></td>
                        <td className="px-3 py-1.5">{u.pembeli ?? <span className="text-slate-400">—</span>}{u.dibangunTanpaPembeli && <div className="text-[10px] text-amber-700">dibangun tanpa pembeli</div>}</td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.harga} /></td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.dibayar} /></td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.sisaTagihan} />{u.jatuhTempo && u.sisaTagihan > 0 && <div className="text-[10px] text-slate-400">{labelTanggal(u.jatuhTempo)}</div>}</td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.budget} /></td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.aktual} /></td>
                        <td className="px-3 py-1.5 text-right font-mono">{u.realisasiPct === null ? '-' : persen(u.realisasiPct, 0)}</td>
                        <td className="px-3 py-1.5 text-right font-mono"><Uang n={u.proyeksiLaba} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2">
                <Catatan>
                  Aktual = pengeluaran rekening C + utang toko disetujui per unit. Biaya konstruksi tanpa unit: {rp(l2.biayaKonstruksiTanpaUnit)}. Proyeksi laba per unit = harga − max(budget, aktual) − fee − porsi sewa tanah. <DaftarSumber sumber={l2.sumber} />
                </Catatan>
              </div>
            </Panel>

            {l2.proyek.map((pr) => (
              <Panel key={pr.id} judul={`Proyek dibiayai Loonars 2 — ${pr.nama}`} ikon="palu">
                <div className="grid gap-4 lg:grid-cols-2">
                  <TabelAngka
                    baris={[
                      { label: 'Budget total', nilai: pr.budgetTotal, catatan: pr.sumber === 'jurnal' ? 'Budget belum diterima dari MK Connect' : 'MK Connect (RAB / control baseline)' },
                      { label: 'Material', nilai: pr.realisasiMaterial, indent: true, catatan: pr.budgetMaterial !== null ? `budget ${pr.budgetMaterial.toLocaleString('id-ID')}${pr.materialPct !== null ? ` · ${persen(pr.materialPct, 0)}` : ''}` : undefined },
                      { label: 'Tukang / kontraktor', nilai: pr.realisasiTenaga, indent: true, catatan: pr.budgetTenaga !== null ? `budget ${pr.budgetTenaga.toLocaleString('id-ID')}` : undefined },
                      { label: 'Lain-lain (tanpa pos budget)', nilai: pr.realisasiLain, indent: true },
                      { label: 'Realisasi total', nilai: pr.realisasiTotal, tebal: true, catatan: pr.realisasiPct !== null ? `${persen(pr.realisasiPct, 0)} dari budget` : undefined },
                      { label: pr.selisihBudget !== null && pr.selisihBudget > 0 ? 'LEWAT BUDGET' : 'Sisa budget', nilai: pr.selisihBudget === null ? null : Math.abs(pr.selisihBudget), tebal: true },
                      { label: 'Komitmen (disetujui, belum dibayar)', nilai: pr.komitmen },
                    ]}
                  />
                  <div>
                    <TabelAngka
                      baris={[
                        { label: 'Utang toko belum lunas (MK Connect)', nilai: pr.utangBelumLunas },
                        { label: 'Utang toko sudah lunas (MK Connect)', nilai: pr.utangLunas },
                        ...(pr.jurnal
                          ? [
                              { label: `Jurnal ${pr.kodeJurnal}: biaya tercatat`, nilai: pr.jurnal.biaya },
                              { label: `Jurnal ${pr.kodeJurnal}: upah/kontraktor tercatat`, nilai: pr.jurnal.tenaga, indent: true },
                              { label: `Jurnal ${pr.kodeJurnal}: saldo utang toko`, nilai: pr.jurnal.utangToko },
                            ]
                          : []),
                      ]}
                    />
                    <Catatan>
                      Proyek ini memakai keuangan Loonars 2: biayanya masuk belanja konstruksi gabungan, bangunannya dicatat sebagai aset dalam penyelesaian, dan utang tokonya masuk kewajiban Loonars 2.
                      {pr.biayaTerakhir ? ` Biaya terakhir ${labelTanggal(pr.biayaTerakhir)}.` : ''} Selisih dengan jurnal ada di Integration &amp; Sync → Rekonsiliasi.
                    </Catatan>
                  </div>
                </div>
              </Panel>
            ))}

            <div className="grid gap-4 xl:grid-cols-3">
              <Panel judul="Neraca Loonars 2" ikon="kotak">
                <TabelAngka
                  baris={[
                    { label: 'Kas di rekening (A/B/D positif)', nilai: l2.neraca.kas },
                    { label: 'Aset dalam pembangunan (persediaan villa)', nilai: l2.neraca.asetDalamPembangunan },
                    ...(l2.proyek.length ? [{ label: `Aset tetap dalam penyelesaian (${l2.proyek.map((x) => x.nama).join(', ')})`, nilai: l2.neraca.asetProyekLain }] : []),
                    { label: 'Total aset', nilai: l2.neraca.totalAset, tebal: true },
                    { label: 'Utang toko bangunan (villa)', nilai: l2.neraca.utangToko },
                    ...(l2.proyek.length ? [{ label: `Utang toko ${l2.proyek.map((x) => x.nama).join(', ')}`, nilai: l2.neraca.utangProyekLain }] : []),
                    { label: 'Utang ke owner (dana talangan)', nilai: l2.neraca.utangOwner },
                    { label: 'Uang muka investor', nilai: l2.neraca.uangMukaInvestor },
                    { label: 'Fee marketing terutang', nilai: l2.neraca.feeTerutang },
                    { label: 'Total liabilitas', nilai: l2.neraca.totalLiabilitas, tebal: true },
                    { label: 'Ekuitas (defisit) tersirat', nilai: l2.neraca.ekuitasTersirat, tebal: true },
                  ]}
                />
                <Catatan>Di luar neraca: piutang kontrak {rp(l2.neraca.diLuarNeraca.piutangKontrak)}, komitmen sisa sewa tanah {rp(l2.neraca.diLuarNeraca.sisaSewaTanah)}.</Catatan>
              </Panel>
              <Panel judul="Profitabilitas proyek (proyeksi)" ikon="grafik">
                <TabelAngka
                  baris={[
                    { label: 'Pendapatan bila 17 unit terjual', nilai: l2.proyeksi.pendapatan },
                    { label: 'Biaya bangun (max budget/aktual)', nilai: -l2.proyeksi.biayaBangun },
                    { label: 'Fee marketing', nilai: -l2.proyeksi.fee },
                    { label: 'Sewa tanah', nilai: -l2.proyeksi.tanah },
                    { label: 'Laba proyek', nilai: l2.proyeksi.laba, tebal: true },
                    { label: 'Pendapatan diakui (serah terima)', nilai: l2.pendapatanDiakui },
                    { label: 'HPP diakui', nilai: -l2.hppDiakui },
                  ]}
                />
              </Panel>
              <Panel judul="Rekening & utang toko" ikon="bank">
                <TabelAngka baris={l2.rekening.map((r) => ({ label: `Rekening ${r.kode} — ${r.nama}`, nilai: r.saldo }))} />
                <div className="mt-3 text-[11px] font-semibold uppercase text-slate-500">Utang per toko</div>
                <TabelAngka baris={l2.utangTokoPerToko.slice(0, 8).map((t) => ({ label: t.nama, nilai: t.sisa }))} />
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel judul="Arus kas Loonars 2 per bulan" ikon="transfer" padat>
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Bulan</th><th className="px-3 py-2 text-right">Cash-in investor</th><th className="px-3 py-2 text-right">Konstruksi</th><th className="px-3 py-2 text-right">Lain (tanah/fee)</th><th className="px-3 py-2 text-right">Bersih</th></tr></thead>
                  <tbody className="font-mono">
                    {l2.arusKasBulanan.map((a) => (
                      <tr key={a.bulan} className="border-b border-slate-100"><td className="px-3 py-1.5 font-sans">{labelBulan(a.bulan)}</td><td className="px-3 py-1.5 text-right"><Uang n={a.masuk} /></td><td className="px-3 py-1.5 text-right"><Uang n={-a.keluarKonstruksi} /></td><td className="px-3 py-1.5 text-right"><Uang n={-a.keluarLain} /></td><td className="px-3 py-1.5 text-right font-bold"><Uang n={a.bersih} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel judul="Buku besar MKH proyek LL (terpisah)" ikon="buku">
                {l2.bukuBesarLL ? (
                  <>
                    <TabelAngka baris={[
                      { label: 'Kas & bank (akun 1-1001…1-1008)', nilai: l2.bukuBesarLL.kas },
                      { label: 'Pendapatan (akun 4-)', nilai: l2.bukuBesarLL.pendapatan },
                      { label: 'HPP / biaya proyek (akun 5-)', nilai: l2.bukuBesarLL.hpp },
                      { label: 'Beban (akun 6-)', nilai: l2.bukuBesarLL.beban },
                    ]} />
                    <Catatan>{l2.bukuBesarLL.jumlahBaris} baris jurnal. Tidak dijumlahkan ke angka modul 4 rekening agar tidak terhitung ganda; hubungan kedua buku belum dipastikan.</Catatan>
                  </>
                ) : <Catatan>Tidak ada jurnal proyek LL.</Catatan>}
              </Panel>
            </div>
          </div>
        );
      }}
    </DenganModel>
  );
}
