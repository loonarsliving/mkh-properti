'use client';

import { useCallback, useEffect, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Badge, Kosong, Memuat, Panel, PesanGalat } from '@/components/ui/Umum';
import { rupiah, tanggalPendek } from '@/lib/format';
import { sbRpc } from '@/lib/supabase';
import { LABEL_STATUS_BANGUN, LABEL_STATUS_UNIT, tokoAda, type L2Pelaksana, type L2PelaksanaUnit } from '@/lib/loonars2';
import { PanelBorongan, PanelRab, PanelUnitDibangun } from './BoronganRab';

/**
 * Tampilan BACA-SAJA Loonars 2 untuk pelaksana (Vando). Semua data datang dari
 * satu RPC (loonars2_web_lihat, migrasi 0045) yang sengaja tidak mengembalikan
 * saldo rekening, pembeli, harga, atau audit. Tidak ada tombol aksi di sini:
 * pengajuan & input utang tetap lewat WhatsApp.
 */

type Tab = 'proyeksi' | 'budget' | 'borongan' | 'utang' | 'pengajuan' | 'panduan';

const TAB: { id: Tab; label: string }[] = [
  { id: 'proyeksi', label: 'Proyeksi Tanah' },
  { id: 'budget', label: 'Budget Unit' },
  { id: 'borongan', label: 'Borongan & RAB' },
  { id: 'utang', label: 'Utang Toko' },
  { id: 'pengajuan', label: 'Pengajuan Saya' },
  { id: 'panduan', label: 'Cara Mengajukan' },
];

function pesanGalat(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const NADA_STATUS = { menunggu: 'amber', disetujui: 'blue', dibayar: 'green', ditolak: 'red' } as const;

export function TampilanPelaksana() {
  const [data, setData] = useState<L2Pelaksana | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('proyeksi');

  useJudul({
    judul: 'Loonars 2 — Pelaksana',
    deskripsi: 'Hanya lihat: proyeksi, budget unit, utang toko, dan status pengajuan',
    tampilkanFilter: false,
  });

  const muat = useCallback(async () => {
    setGalat(null);
    try {
      setData(await sbRpc<L2Pelaksana>('loonars2_web_lihat', {}));
    } catch (e) {
      setGalat(pesanGalat(e));
    }
  }, []);

  useEffect(() => {
    void muat();
  }, [muat]);

  if (data === null && !galat) return <Memuat pesan="Memuat Loonars 2…" />;
  if (galat || !data) return <PesanGalat pesan={galat ?? 'Data tidak tersedia'} onCoba={() => void muat()} />;

  const menunggu = data.pengajuan.filter((p) => p.status === 'menunggu').length + data.cicilan.filter((c) => c.status === 'menunggu').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TAB.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'btn-green px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'pengajuan' && menunggu > 0 ? (
              <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] text-slate-900">{menunggu}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'proyeksi' ? <TabProyeksi data={data} /> : null}
      {tab === 'budget' ? <TabBudget unit={data.unit} /> : null}
      {tab === 'borongan' ? (
        <div className="space-y-4">
          <PanelUnitDibangun unit={data.unit} />
          <PanelBorongan borongan={data.borongan} />
          <PanelRab rab={data.rab} unit={data.unit} />
        </div>
      ) : null}
      {tab === 'utang' ? <TabUtangToko data={data} /> : null}
      {tab === 'pengajuan' ? <TabPengajuanSaya data={data} /> : null}
      {tab === 'panduan' ? <TabPanduan /> : null}
    </div>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className={`font-mono ${tebal ? 'font-bold text-slate-900' : ''}`}>{nilai}</span>
    </div>
  );
}

function TabProyeksi({ data }: { data: L2Pelaksana }) {
  const p = data.proyeksi_tanah;
  const terjual = data.unit.filter((u) => u.status === 'dp' || u.status === 'lunas');
  const belumTerjual = data.unit.length - terjual.length;
  const totalUtang = data.toko.reduce((s, t) => s + Math.max(Number(t.sisa_utang), 0), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel judul="Dana tanah" ikon="rumah">
        <div className="space-y-1.5 text-[12px] text-slate-700">
          <Baris label="Sudah dialokasikan ke B" nilai={rupiah(p.b_dialokasikan)} />
          <Baris label="Pelunasan terjadwal ke B (sebelum jatuh tempo)" nilai={rupiah(p.pelunasan_terjadwal_ke_b)} />
          <Baris label="Proyeksi" nilai={rupiah(p.proyeksi)} tebal />
          <Baris label="Target" nilai={rupiah(p.target)} />
          <Baris label="Jatuh tempo tanah" nilai={p.jatuh_tempo ? tanggalPendek(p.jatuh_tempo) : 'Belum diisi'} />
        </div>
        {p.kurang > 0 ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
            Proyeksi kurang {rupiah(p.kurang)} — perlu sekitar <b>{p.unit_tambahan} unit tambahan</b> terjual dan lunas sebelum jatuh
            tempo tanah.
          </p>
        ) : (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
            Proyeksi mencukupi target tanah.
          </p>
        )}
      </Panel>

      <Panel judul="Cara membaca proyeksi" ikon="info">
        <ol className="list-decimal space-y-2 pl-4 text-[12px] leading-relaxed text-slate-700">
          <li>
            Setiap uang masuk dari pembeli dibagi otomatis: dahulukan <b>C</b> (konstruksi &amp; fee) sampai kebutuhan unit itu penuh,
            lalu <b>B</b> (tanah) sampai target, sisanya <b>D</b> (profit).
          </li>
          <li>
            <b>Proyeksi</b> = yang sudah masuk ke B + bagian B dari pelunasan unit yang dijadwalkan lunas <i>sebelum jatuh tempo tanah</i>.
          </li>
          <li>
            Makin cepat unit terjual dan lunas, makin cepat B terpenuhi. Unit yang belum terjual ({belumTerjual} dari {data.unit.length}) tidak
            dihitung.
          </li>
          <li>
            Uang C dipakai untuk biaya bangun. Utang toko yang sudah disetujui ikut memotong budget unit walau belum lunas, jadi total
            utang berjalan saat ini <b>{rupiah(totalUtang)}</b> sudah “terpakai”.
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-slate-500">
          {terjual.length} unit sudah terjual (DP/lunas). Saldo rekening hanya dilihat owner.
        </p>
      </Panel>
    </div>
  );
}

function TabBudget({ unit }: { unit: L2PelaksanaUnit[] }) {
  return (
    <Panel judul="Budget bangun per unit" ikon="kotak" padat>
      <div className="overflow-x-auto">
        <table className="tbl whitespace-nowrap">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Tipe</th>
              <th>Status</th>
              <th>Bangun</th>
              <th className="text-right">Biaya bangun</th>
              <th className="text-right">Terpakai</th>
              <th className="text-right">Sisa budget</th>
              <th className="text-right">Buffer</th>
              <th className="text-right">Utang toko</th>
            </tr>
          </thead>
          <tbody>
            {unit.map((u) => {
              const terjual = u.status === 'dp' || u.status === 'lunas' || u.is_unit_contoh;
              const sisa = Number(u.biaya_bangun) - Number(u.terpakai_konstruksi);
              const lewatBuffer = Number(u.terpakai_konstruksi) > Number(u.biaya_bangun) + Number(u.buffer);
              return (
                <tr key={u.id} className={!terjual ? 'opacity-50' : lewatBuffer ? 'bg-red-50' : undefined}>
                  <td className="font-mono">
                    {u.nomor}. {u.kode}
                    {u.is_unit_contoh ? <Badge nada="blue" anak="contoh" /> : null}
                  </td>
                  <td>{u.tipe}</td>
                  <td>
                    <Badge nada={u.status === 'lunas' ? 'green' : u.status === 'dp' ? 'blue' : u.status === 'booking' ? 'amber' : 'slate'} anak={LABEL_STATUS_UNIT[u.status]} />
                  </td>
                  <td>{LABEL_STATUS_BANGUN[u.status_bangun]}</td>
                  <td className="text-right font-mono">{rupiah(u.biaya_bangun)}</td>
                  <td className="text-right font-mono">{rupiah(u.terpakai_konstruksi)}</td>
                  <td className={`text-right font-mono ${sisa < 0 ? 'font-bold text-amber-700' : ''}`}>
                    {sisa < 0 ? `−${rupiah(-sisa)} (pakai buffer)` : rupiah(sisa)}
                  </td>
                  <td className="text-right font-mono">{rupiah(u.buffer)}</td>
                  <td className="text-right font-mono">{Number(u.utang_disetujui) > 0 ? rupiah(u.utang_disetujui) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[10.5px] text-slate-500">
        Terpakai = pembayaran tunai + material yang diambil secara utang (sudah disetujui). Melewati biaya bangun berarti memakai buffer dan
        butuh persetujuan khusus owner; melewati buffer ditandai merah. Hanya unit yang sudah DP/lunas (atau unit contoh) yang bisa diajukan.
      </p>
    </Panel>
  );
}

function TabUtangToko({ data }: { data: L2Pelaksana }) {
  const namaToko = (id: number) => data.toko.find((t) => t.id === id)?.nama ?? '-';
  const unit = (id: number) => data.unit.find((u) => u.id === id)?.kode ?? `#${id}`;
  const totalSisa = data.toko.reduce((s, t) => s + Math.max(Number(t.sisa_utang), 0), 0);
  return (
    <div className="space-y-4">
      <Panel judul={`Sisa utang per toko — total ${rupiah(totalSisa)}`} ikon="kotak" padat>
        {data.toko.length === 0 ? (
          <Kosong pesan='Belum ada utang toko. Catat lewat WA: "L2 utang <toko> unit <n> <rincian> <nominal>".' ikon="kotak" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Toko</th>
                  <th className="text-right">Utang disetujui</th>
                  <th className="text-right">Sudah dicicil</th>
                  <th className="text-right">Sisa</th>
                  <th className="text-right">Menunggu</th>
                </tr>
              </thead>
              <tbody>
                {data.toko.filter(tokoAda).map((t) => (
                  <tr key={t.id}>
                    <td className="font-semibold">{t.nama}</td>
                    <td className="text-right font-mono">{rupiah(t.utang_disetujui)}</td>
                    <td className="text-right font-mono">{rupiah(t.cicilan_dibayar)}</td>
                    <td className="text-right font-mono font-bold">{rupiah(t.sisa_utang)}</td>
                    <td className="text-right text-[11px] text-slate-500">
                      {Number(t.utang_menunggu) > 0 ? `utang ${rupiah(t.utang_menunggu)}` : ''}
                      {Number(t.cicilan_diproses) > 0 ? ` cicilan ${rupiah(t.cicilan_diproses)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel judul="Pembelian utang terakhir" ikon="dokumen" padat>
        {data.utang.length === 0 ? (
          <Kosong pesan="Belum ada utang tercatat." ikon="dokumen" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl whitespace-nowrap">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Tanggal</th>
                  <th>Toko</th>
                  <th>Unit</th>
                  <th>Rincian</th>
                  <th className="text-right">Nominal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.utang.slice(0, 50).map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono">{u.kelompok}</td>
                    <td>{tanggalPendek(u.tanggal)}</td>
                    <td>{namaToko(u.toko_id)}</td>
                    <td className="font-mono">{unit(u.unit_id)}</td>
                    <td className="max-w-[260px] truncate" title={u.deskripsi}>{u.deskripsi}</td>
                    <td className="text-right font-mono">{rupiah(u.nominal)}</td>
                    <td>
                      <Badge nada={NADA_STATUS[u.status]} anak={u.status} />
                      {u.pakai_buffer || u.melewati_buffer ? <Badge nada="amber" anak="buffer" /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function TabPengajuanSaya({ data }: { data: L2Pelaksana }) {
  const unit = (id: number) => data.unit.find((u) => u.id === id)?.kode ?? `#${id}`;
  const namaToko = (id: number) => data.toko.find((t) => t.id === id)?.nama ?? '-';
  return (
    <div className="space-y-4">
      <Panel judul="Pengajuan pembayaran" ikon="ceklis" padat>
        {data.pengajuan.length === 0 ? (
          <Kosong pesan="Belum ada pengajuan." ikon="ceklis" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl whitespace-nowrap">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Tanggal</th>
                  <th>Unit</th>
                  <th>Kategori</th>
                  <th>Rincian</th>
                  <th className="text-right">Nominal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.pengajuan.slice(0, 80).map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono">{p.kelompok ?? `L2-${p.id}`}</td>
                    <td>{tanggalPendek(p.dibuat_pada)}</td>
                    <td className="font-mono">{unit(p.unit_id)}</td>
                    <td>{p.kategori}</td>
                    <td className="max-w-[260px] truncate" title={p.deskripsi}>{p.deskripsi}{p.toko ? ` · ${p.toko}` : ''}</td>
                    <td className="text-right font-mono">{rupiah(p.nominal)}</td>
                    <td>
                      <Badge nada={NADA_STATUS[p.status]} anak={p.status} />
                      {p.status === 'ditolak' && p.alasan_tolak ? <span className="ml-1 text-[11px] text-slate-500">{p.alasan_tolak}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel judul="Cicilan toko" ikon="kotak" padat>
        {data.cicilan.length === 0 ? (
          <Kosong pesan="Belum ada cicilan." ikon="kotak" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl whitespace-nowrap">
              <thead>
                <tr><th>Kode</th><th>Tanggal</th><th>Toko</th><th className="text-right">Nominal</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.cicilan.slice(0, 50).map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono">{c.kelompok}</td>
                    <td>{tanggalPendek(c.dibuat_pada)}</td>
                    <td>{namaToko(c.toko_id)}</td>
                    <td className="text-right font-mono">{rupiah(c.nominal)}</td>
                    <td>
                      <Badge nada={NADA_STATUS[c.status]} anak={c.status} />
                      {c.status === 'ditolak' && c.alasan_tolak ? <span className="ml-1 text-[11px] text-slate-500">{c.alasan_tolak}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Perintah({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800">{children}</pre>;
}

function TabPanduan() {
  return (
    <Panel judul="Cara mengajukan lewat WhatsApp (awali selalu dengan L2)" ikon="info">
      <div className="space-y-4 text-[12px] leading-relaxed text-slate-700">
        <div>
          <p className="mb-1 font-semibold">1. Minta upah tukang borongan tiap minggu</p>
          <Perintah>{'L2 tukang minggu ini'}</Perintah>
          <p className="mt-1 text-[11px] text-slate-500">
            Tidak perlu menulis nominal. Sistem menghitung (jumlah unit × (35 jt − retensi 9 jt) ÷ 12 minggu; 6 unit = 13 jt/minggu), menentukan minggu
            ke-berapa, dan membagi rata ke unit. Unit baru yang mulai dibangun otomatis dibuatkan borongannya. Retensi diajukan setelah unit selesai:
            L2 retensi unit 3
          </p>
        </div>
        <div>
          <p className="mb-1 font-semibold">2. Catat utang material di toko</p>
          <Perintah>{'L2 utang TB Maju semen 50 sak 6.500.000'}</Perintah>
          <p className="mt-1 text-[11px] text-slate-500">
            Lampirkan foto nota. Tidak perlu menyebut unit: sistem membagi ke unit yang sedang dibangun. Beli tunai (bukan utang): L2 bahan TB Maju semen 100
            sak, pasir 12 rit 8,5 juta
          </p>
        </div>
        <div>
          <p className="mb-1 font-semibold">3. Bayar cicilan utang material per toko</p>
          <Perintah>{`L2 cicilan TB Maju 3 juta
L2 cicilan TB Maju lunas`}</Perintah>
          <p className="mt-1 text-[11px] text-slate-500">&quot;lunas&quot; memakai seluruh sisa utang toko itu. Cek sisa utang tiap toko: L2 utang (sama dengan tab Utang Toko).</p>
        </div>
        <div>
          <p className="mb-1 font-semibold">4. Ajukan pembayaran lain-lain</p>
          <Perintah>{`L2 lain listrik proyek 600 rb
L2 bensin 200 rb
L2 sewa alat 1,5 juta`}</Perintah>
          <p className="mt-1 text-[11px] text-slate-500">Dibagi rata ke unit yang sedang dibangun; tulis &quot;unit 5&quot; bila khusus satu unit.</p>
        </div>
        <div>
          <p className="mb-1 font-semibold">Semua sekaligus dalam satu pesan (satu baris per pembayaran)</p>
          <Perintah>{`L2 pengajuan minggu ini
- tukang minggu ini
- cicilan TB Maju 3 juta
- lain listrik proyek 600 rb
- material pasir 2 rit 1,6 juta TB Sinar`}</Perintah>
          <p className="mt-1 text-[11px] text-slate-500">Dapat kode, mis. M-4. Owner menyetujui, lalu setelah dibayar kirim foto bukti dengan keterangan: L2 bayar M-4</p>
        </div>
        <div>
          <p className="mb-1 font-semibold">Sistem akan bertanya &quot;unit mana yang sedang dibangun?&quot;</p>
          <p>
            Balas <b>YA</b> bila daftarnya benar, atau kirim yang terbaru: <span className="font-mono">L2 unit 1-7</span>. Unit yang dibangun tidak harus
            yang sudah laku. Salah bagi? <span className="font-mono">L2 koreksi M-7 semen unit 1,2,3</span>
          </p>
        </div>
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Kalau budget unit hampir habis, pengajuan tetap diteruskan tapi ditandai &quot;pakai buffer&quot; dan butuh persetujuan khusus owner. Halaman ini hanya
          untuk melihat; semua pengajuan tetap lewat WhatsApp.
        </p>
      </div>
    </Panel>
  );
}
