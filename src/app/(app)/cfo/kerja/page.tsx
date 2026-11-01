'use client';

import { useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { KartuStat } from '@/components/ui/Kartu';
import { Badge, Panel } from '@/components/ui/Umum';
import { useCfo } from '@/components/cfo/CfoProvider';
import { Catatan, ChipTingkat, DenganModel, Kpi, Uang } from '@/components/cfo/Ui';
import { kodeWa, type KerjaCfo, type TindakanDb } from '@/lib/cfo/kerja';
import type { ModelCfo } from '@/lib/cfo/model';
import { labelBulan, labelTanggal } from '@/lib/cfo/util';
import { getAccessToken, perbaruiToken, sbRpc } from '@/lib/supabase';

/**
 * Meja Kerja CFO — pekerjaan rutin AI CFO: tindakan (apa, siapa, tenggat),
 * reviu setiap pengajuan, rencana bayar minggu ini, dan tutup buku bulanan.
 * AI CFO merekomendasikan; owner yang memutuskan dan membayar.
 */
export default function HalamanMejaKerja() {
  useJudul({ judul: 'Meja Kerja CFO', deskripsi: 'Tindakan, reviu pengajuan, rencana bayar, dan tutup buku — dikerjakan AI CFO setiap hari', tampilkanFilter: false });
  const { kerja } = useCfo();
  return <DenganModel>{(m) => (kerja ? <Isi m={m} k={kerja} /> : null)}</DenganModel>;
}

async function jalankan(jenis: 'tindakan' | 'tutup_buku'): Promise<Record<string, unknown>> {
  const panggil = (t: string | null) =>
    fetch('/api/cfo/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t ?? ''}` }, body: JSON.stringify({ jenis }) });
  let res = await panggil(getAccessToken());
  if (res.status === 401) {
    const baru = await perbaruiToken();
    if (baru) res = await panggil(baru);
  }
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(j.error ?? res.status));
  return j;
}

const NADA_PUTUSAN = { SETUJUI: 'green', TAHAN: 'amber', CEK_DOBEL: 'red', PROSES: 'slate', BASI: 'amber', NOMINAL_JANGGAL: 'red', DIKUNCI: 'slate' } as const;

function Isi({ m, k }: { m: ModelCfo; k: KerjaCfo }) {
  const { muatUlang } = useCfo();
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [lihatTutup, setLihatTutup] = useState(false);

  // Bila tindakan belum pernah disinkron (tabel kosong), tampilkan hasil hitung terkini.
  const dariDb = k.tindakanDb.length > 0;
  const terbuka: (TindakanDb | (typeof k.tindakan)[number])[] = dariDb ? k.terbukaDb : k.tindakan;
  const selesai = k.tindakanDb.filter((t) => t.status !== 'terbuka');
  const lewat = new Set(k.lewatTenggat.map((t) => t.kunci));

  async function aksi(fn: () => Promise<unknown>, ok: string) {
    setSibuk(true);
    setPesan(null);
    try {
      await fn();
      setPesan(ok);
      muatUlang();
    } catch (e) {
      setPesan(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(false);
    }
  }

  const ubah = (t: TindakanDb, status: 'selesai' | 'diabaikan' | 'terbuka') => {
    let alasan: string | null = null;
    if (status === 'diabaikan') {
      alasan = window.prompt('Alasan mengabaikan tindakan ini (wajib, tercatat di audit):');
      if (!alasan || alasan.trim().length < 5) return;
    }
    void aksi(() => sbRpc('cfo_tindakan_ubah', { p_id: t.id, p_status: status, p_alasan: alasan }), 'Status tindakan diperbarui.');
  };

  const rv = k.ringkasReviu;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KartuStat label="Tindakan terbuka" nilai={`${terbuka.length} tindakan`} ikon="ceklis" nada={k.lewatTenggat.length ? 'rose' : terbuka.length ? 'amber' : 'emerald'} catatan={`${k.lewatTenggat.length} lewat tenggat`} />
        <Kpi label="Pengajuan Loonars 2 menunggu" nilai={rv.l2Total} ikon="dokumen" nada="blue" catatan={`${rv.l2Kelompok} kelompok: setujui ${rv.l2Setujui}, tahan ${rv.l2Tahan}, cek dobel ${rv.l2Dobel}`} />
        <Kpi label="Antrean pengajuan MKH" nilai={rv.mkhTotal} ikon="kalender" nada={rv.mkhBasi ? 'rose' : 'slate'} catatan={`${rv.mkhJumlah} pengajuan · ${rv.mkhDobel} tampak ganda · ${rv.mkhBasi} > 30 hari`} />
        <Kpi label="Rencana bayar minggu ini" nilai={k.rencana.totalBayar} ikon="kas-keluar" nada="violet" catatan={`dari ${k.rencana.danaTersedia.toLocaleString('id-ID')} di atas kas minimum; ditunda ${k.rencana.totalTunda.toLocaleString('id-ID')}`} />
      </div>

      {pesan && <p className="text-[12px] font-semibold">{pesan}</p>}

      <Panel
        judul={`Tindakan CFO (${terbuka.length})`}
        ikon="ceklis"
        padat
        aksi={
          <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px]" disabled={sibuk} onClick={() => void aksi(() => jalankan('tindakan'), 'Daftar tindakan diperbarui.')}>
            Perbarui daftar
          </button>
        }
      >
        {!dariDb && terbuka.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11.5px] text-amber-900">Pratinjau hasil hitung terkini — belum tersimpan. Tekan &ldquo;Perbarui daftar&rdquo; (atau tunggu sinkron otomatis tiap 2 jam) agar bisa ditandai selesai.</div>
        )}
        <div className="divide-y divide-slate-100">
          {terbuka.map((t) => (
            <div key={t.kunci} className={`px-4 py-3 ${lewat.has(t.kunci) ? 'bg-rose-50' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <ChipTingkat t={t.tingkat} />
                <span className="chip bg-slate-100 text-slate-600">{t.lini}</span>
                <span className="text-[12.5px] font-semibold">{t.judul}</span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {t.penanggung}
                  {t.tenggat ? ` · tenggat ${labelTanggal(t.tenggat)}` : ''}
                  {lewat.has(t.kunci) ? ' · ⏰ lewat' : ''}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{t.langkah}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {t.nilai != null && <span className="font-mono text-[11px]"><Uang n={Number(t.nilai)} /></span>}
                <span className="font-mono text-[10px] text-slate-400">{(t.sumber ?? []).map((s) => (s.ket ? `${s.tabel} (${s.ket})` : s.tabel)).join(' · ')}</span>
                {'id' in t && dariDb && (
                  <span className="ml-auto flex gap-1">
                    <button className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] text-emerald-700" disabled={sibuk} onClick={() => ubah(t as TindakanDb, 'selesai')}>Selesai</button>
                    <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px]" disabled={sibuk} onClick={() => ubah(t as TindakanDb, 'diabaikan')}>Abaikan…</button>
                  </span>
                )}
              </div>
            </div>
          ))}
          {!terbuka.length && <div className="p-4"><Catatan>Tidak ada tindakan terbuka.</Catatan></div>}
        </div>
        <div className="px-4 py-2">
          <Catatan>Tindakan dibuat dari angka sistem dan tertutup otomatis saat kondisinya teratasi (mis. rekening sudah diisi). Tindakan yang diabaikan tidak dibuka lagi. Tenggat tidak pernah dimundurkan otomatis.</Catatan>
        </div>
      </Panel>

      <Panel judul="Reviu pengajuan Loonars 2 — rekomendasi AI CFO" ikon="dokumen" padat>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12px]">
            <thead className="bg-slate-50 text-[10.5px] uppercase text-slate-500">
              <tr><th className="px-3 py-2 text-left">Kode</th><th className="px-3 py-2 text-left">Isi</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Umur</th><th className="px-3 py-2 text-left">Rekomendasi</th><th className="px-3 py-2 text-left">Alasan</th></tr>
            </thead>
            <tbody>
              {k.reviuL2.map((r) => (
                <tr key={r.kelompok} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono font-semibold">{kodeWa(r.kelompok)}</td>
                  <td className="px-3 py-2">{r.contoh}<div className="text-[10.5px] text-slate-500">{r.kategori} · {r.ids.length} baris{r.unit.length ? ` · ${r.unit.join(', ')}` : ''}</div></td>
                  <td className="px-3 py-2 text-right font-mono"><Uang n={r.total} /></td>
                  <td className="px-3 py-2 text-right">{r.umurHari} hr</td>
                  <td className="px-3 py-2"><Badge nada={NADA_PUTUSAN[r.putusan]} anak={r.putusan.replace('_', ' ')} /></td>
                  <td className="px-3 py-2 text-[11.5px] text-slate-700">{r.alasan.join(' ')}<div className="mt-0.5 font-mono text-[10.5px] text-slate-400">WA: setujui {kodeWa(r.kelompok)} / tolak {kodeWa(r.kelompok)} &lt;alasan&gt;</div></td>
                </tr>
              ))}
              {!k.reviuL2.length && <tr><td className="p-4" colSpan={6}><Catatan>Tidak ada pengajuan Loonars 2 yang menunggu.</Catatan></td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel judul="Reviu antrean pengajuan MKH (semua proyek)" ikon="kalender" padat>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead className="sticky top-0 bg-slate-50 text-[10.5px] uppercase text-slate-500">
              <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Proyek · keterangan</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-right">Umur</th><th className="px-3 py-2 text-left">Temuan</th></tr>
            </thead>
            <tbody>
              {[...k.reviuMkh].sort((a, b) => (a.putusan === 'PROSES' ? 1 : 0) - (b.putusan === 'PROSES' ? 1 : 0) || b.umurHari - a.umurHari).map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono">{r.id}</td>
                  <td className="px-3 py-2">{r.proyek} · {r.tipe}<div className="text-[10.5px] text-slate-500">{r.ringkas}</div></td>
                  <td className="px-3 py-2 text-right font-mono"><Uang n={r.nominal} /></td>
                  <td className="px-3 py-2 text-right">{r.umurHari} hr</td>
                  <td className="px-3 py-2"><Badge nada={NADA_PUTUSAN[r.putusan]} anak={r.putusan.replace('_', ' ')} /><div className="mt-0.5 text-[11px] text-slate-600">{r.alasan.join(' ')}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2"><Catatan>Nomor rekening di keterangan disamarkan (••••). Keputusan tetap lewat halaman Verifikasi.</Catatan></div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel judul="Rencana bayar minggu ini" ikon="kas-keluar" padat>
          <table className="w-full text-[12px]">
            <tbody>
              {k.rencana.bayar.map((b) => (
                <tr key={b.id} className="border-b border-slate-100"><td className="px-3 py-1.5">✅ {b.pihak}<div className="text-[10.5px] text-slate-500">{b.lini} · {b.alasan}</div></td><td className="px-3 py-1.5 text-right font-mono"><Uang n={b.nominal} /></td></tr>
              ))}
              {k.rencana.tunda.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 text-slate-500"><td className="px-3 py-1.5">⏸ {b.pihak}<div className="text-[10.5px]">{b.lini} · {b.alasan}</div></td><td className="px-3 py-1.5 text-right font-mono"><Uang n={b.nominal} /></td></tr>
              ))}
              <tr className="font-bold"><td className="px-3 py-1.5">Sisa kas di atas minimum setelah rencana</td><td className="px-3 py-1.5 text-right font-mono"><Uang n={k.rencana.sisa} /></td></tr>
            </tbody>
          </table>
          <div className="px-4 py-2"><Catatan>Dana tersedia = kas tercatat ({m.kasTotal.toLocaleString('id-ID')}) − kas minimum ({m.kasMinimum.toLocaleString('id-ID')}). Urutan = prioritas risiko; pengajuan yang direkomendasikan TAHAN/CEK DOBEL tidak dijadwalkan. AI CFO tidak membayar apa pun.</Catatan></div>
        </Panel>

        <Panel
          judul="Tutup buku bulanan"
          ikon="buku"
          aksi={
            <button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px]" disabled={sibuk} onClick={() => void aksi(async () => {
              const j = await jalankan('tutup_buku');
              setPesan(j.status === 'ok' ? `Tutup buku ${String(j.periode)} selesai & dikirim ke WA.` : j.status === 'belum_waktunya' ? 'Belum waktunya: bulan lalu sudah ditutup atau laporan villa belum final (otomatis paling lambat tgl 6).' : `Status: ${String(j.status)}`);
            }, 'Selesai.')}>
              Tutup buku sekarang
            </button>
          }
        >
          {k.laporanBulanan.length ? (
            <div className="space-y-2">
              {k.laporanBulanan.slice(0, lihatTutup ? 24 : 3).map((l) => (
                <details key={l.periode} className="rounded border border-slate-200 p-2" open={l === k.laporanBulanan[0]}>
                  <summary className="cursor-pointer text-[12.5px] font-semibold">{labelBulan(l.periode.slice(0, 7))} <span className="font-normal text-slate-400">· dibekukan {new Date(l.dibuat_pada).toLocaleDateString('id-ID')}</span></summary>
                  <pre className="mt-1 whitespace-pre-wrap text-[11.5px] text-slate-700">{l.komentar}</pre>
                  <div className="font-mono text-[10px] text-slate-400">hash {l.hash.slice(0, 12)} · {l.dibuat_oleh}</div>
                </details>
              ))}
              {k.laporanBulanan.length > 3 && <button className="text-[11px] text-blue-600" onClick={() => setLihatTutup(!lihatTutup)}>{lihatTutup ? 'Ringkas' : 'Lihat semua'}</button>}
            </div>
          ) : (
            <Catatan>Belum ada bulan yang ditutup. Otomatis setiap tanggal 2–6 (menunggu laporan villa final), angka bulan lalu dibekukan dan laporan analisis dikirim ke WA owner.</Catatan>
          )}
        </Panel>
      </div>

      {selesai.length > 0 && (
        <Panel judul={`Tindakan selesai / diabaikan (30 hari, ${selesai.length})`} ikon="ceklis" padat>
          <table className="w-full text-[12px]">
            <tbody>
              {selesai.map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="px-3 py-1.5">{t.status === 'selesai' ? '✓' : '—'} {t.judul}<div className="text-[10.5px] text-slate-500">{t.ditutup_oleh}{t.alasan ? ` · ${t.alasan}` : ''}</div></td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-slate-500">{t.ditutup_pada ? new Date(t.ditutup_pada).toLocaleDateString('id-ID') : ''}</td>
                  <td className="px-3 py-1.5 text-right"><button className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px]" disabled={sibuk} onClick={() => ubah(t, 'terbuka')}>Buka lagi</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
