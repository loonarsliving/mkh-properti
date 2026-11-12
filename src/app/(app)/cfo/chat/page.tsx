'use client';

import { useEffect, useRef, useState } from 'react';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Umum';
import { Catatan } from '@/components/cfo/Ui';
import { getAccessToken, perbaruiToken } from '@/lib/supabase';

/** 8. AI CFO Chat — jawaban dapat ditelusuri ke fakta & sumber data. */
interface Pesan {
  peran: 'owner' | 'cfo';
  isi: string;
  mode?: string;
  putusan?: string | null;
  fakta?: { id: string; label: string; teks: string; sumber: string }[];
}

const CONTOH = [
  'Bagaimana kondisi kas dan kapan kita berisiko defisit?',
  'Kewajiban mana yang harus dibayar dulu minggu ini?',
  'Berapa EBITDA villa bulan lalu dan bagian MKH setelah jaminan investor?',
  'Saya mau bangun 3 unit LUNARA lagi senilai 480 jt bulan ini, boleh?',
  'Apa risiko terbesar Loonars 2 sekarang?',
  'Apakah data penjualan investor sudah cocok dengan rekening Loonars 2?',
];

async function kirim(pertanyaan: string, riwayat: Pesan[]): Promise<Response> {
  const body = JSON.stringify({ pertanyaan, riwayat: riwayat.slice(-6).map(({ peran, isi }) => ({ peran, isi })) });
  const panggil = (t: string | null) =>
    fetch('/api/cfo/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t ?? ''}` }, body });
  let res = await panggil(getAccessToken());
  if (res.status === 401) {
    const baru = await perbaruiToken();
    if (baru) res = await panggil(baru);
  }
  return res;
}

const LABEL_MODE: Record<string, string> = {
  ai: 'Narasi AI (angka tervalidasi terhadap fakta)',
  ai_ditolak: 'Narasi AI ditolak karena memuat angka di luar fakta — ditampilkan jawaban sistem',
};

/** Avatar AI CFO — dipakai di kepala panel, di samping jawaban, dan saat menghitung. */
function AvatarCfo({ besar = false, hidup = false }: { besar?: boolean; hidup?: boolean }) {
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-500 font-bold text-white shadow-md shadow-blue-600/30 ${
        besar ? 'h-14 w-14 text-base' : 'h-7 w-7 text-[10px]'
      }`}
      aria-hidden
    >
      AI
      {hidup ? <span className="anim-denyut absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" /> : null}
    </span>
  );
}

/**
 * Jawaban baru "diketik" huruf demi huruf (maks ±1,2 detik) supaya terasa
 * hidup. Hanya hiasan: teks lengkap tetap ada untuk pembaca layar, dan
 * pengguna dengan "kurangi gerakan" langsung melihat teks utuh.
 */
function TeksMengetik({ teks, onMaju }: { teks: string; onMaju: () => void }) {
  const [n, setN] = useState(0);
  const majuRef = useRef(onMaju);
  majuRef.current = onMaju;
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setN(teks.length);
      return;
    }
    const durasi = Math.min(1200, Math.max(250, teks.length * 6));
    const mulai = performance.now();
    let raf = 0;
    const langkah = (kini: number) => {
      const t = Math.min(1, (kini - mulai) / durasi);
      setN(Math.ceil(teks.length * t));
      majuRef.current();
      if (t < 1) raf = requestAnimationFrame(langkah);
    };
    raf = requestAnimationFrame(langkah);
    return () => cancelAnimationFrame(raf);
  }, [teks]);
  const selesai = n >= teks.length;
  return (
    <div className="whitespace-pre-wrap leading-relaxed" aria-label={teks}>
      <span aria-hidden={!selesai}>{teks.slice(0, n)}</span>
      {selesai ? null : <span aria-hidden className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-blue-500" />}
    </div>
  );
}

export default function HalamanCfoChat() {
  useJudul({ judul: 'AI CFO Chat', deskripsi: 'Tanya kondisi keuangan Loonars 1 & 2 — setiap angka dirujuk ke fakta & sumber datanya', tampilkanFilter: false });
  const [pesan, setPesan] = useState<Pesan[]>([]);
  const [teks, setTeks] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const kotak = useRef<HTMLDivElement>(null);
  const masukan = useRef<HTMLInputElement>(null);

  // Gulir hanya kotak percakapan (bukan seluruh halaman) ke pesan terbaru.
  const keBawah = (halus = true) => {
    const el = kotak.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: halus ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    keBawah();
  }, [pesan.length, sibuk]);

  async function tanya(q: string) {
    const pertanyaan = q.trim();
    if (!pertanyaan || sibuk) return;
    const riwayat = pesan;
    setPesan([...riwayat, { peran: 'owner', isi: pertanyaan }]);
    setTeks('');
    setSibuk(true);
    try {
      const res = await kirim(pertanyaan, riwayat);
      const j = (await res.json()) as { jawaban?: string; error?: string; mode?: string; putusan?: string | null; fakta?: Pesan['fakta'] };
      setPesan((p) => [...p, res.ok ? { peran: 'cfo', isi: j.jawaban ?? '', mode: j.mode, putusan: j.putusan, fakta: j.fakta } : { peran: 'cfo', isi: `Gagal: ${j.error ?? res.status}` }]);
    } catch (e) {
      setPesan((p) => [...p, { peran: 'cfo', isi: `Gagal menghubungi server: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setSibuk(false);
      masukan.current?.focus();
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <section className="card flex h-[calc(100dvh-15rem)] min-h-[460px] flex-col overflow-hidden xl:col-span-3">
        {/* Kepala panel */}
        <div className="flex items-center gap-3 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/60 px-4 py-3">
          <AvatarCfo hidup />
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-bold text-slate-800">AI CFO</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
              {sibuk ? (
                <>
                  <span className="titik-ketik text-blue-600" aria-hidden><i /><i /><i /></span> menghitung dari data…
                </>
              ) : (
                'Siap menjawab · hanya membaca data'
              )}
            </p>
          </div>
          {pesan.length > 0 && (
            <span className="chip anim-letup bg-white text-slate-500 shadow-sm">{pesan.filter((p) => p.peran === 'owner').length} pertanyaan</span>
          )}
        </div>

        {/* Isi percakapan */}
        <div
          ref={kotak}
          className="thin-scroll flex-1 space-y-3 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.18)_1px,transparent_0)] px-3 py-4 [background-size:18px_18px] sm:px-5"
          aria-live="polite"
        >
          {!pesan.length && (
            <div className="flex h-full flex-col items-center justify-center px-2 text-center">
              <div className="anim-melayang"><AvatarCfo besar /></div>
              <h3 className="anim-naik mt-4 text-[15px] font-bold text-slate-800">Apa yang ingin Anda ketahui hari ini?</h3>
              <p className="anim-naik mt-1 max-w-md text-[12px] leading-relaxed text-slate-500 [animation-delay:0.06s]">
                Mulai dengan pertanyaan di bawah atau pilih contoh. Untuk menguji keputusan, sebutkan nominalnya (mis. &quot;mau beli tanah 1,5 M&quot;).
              </p>
              <div className="berurutan mt-5 grid w-full max-w-2xl gap-2 sm:grid-cols-2 xl:hidden">
                {CONTOH.slice(0, 4).map((c) => (
                  <button key={c} onClick={() => void tanya(c)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[12px] text-slate-700 shadow-sm hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {pesan.map((p, i) => {
            const owner = p.peran === 'owner';
            const terakhir = i === pesan.length - 1;
            return (
              <div key={i} className={`flex items-end gap-2 ${owner ? 'justify-end' : 'justify-start'}`}>
                {!owner && <AvatarCfo />}
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] shadow-sm sm:max-w-[78%] ${
                    owner
                      ? 'anim-gelembung-kanan rounded-br-md bg-gradient-to-br from-blue-600 to-blue-500 text-white shadow-blue-600/20'
                      : 'anim-gelembung-kiri rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {owner || !terakhir ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{p.isi}</div>
                  ) : (
                    <TeksMengetik teks={p.isi} onMaju={() => keBawah(false)} />
                  )}
                  {!owner && p.mode && (
                    <div className="anim-muncul mt-2.5 border-t border-slate-100 pt-2 text-[10.5px] text-slate-500 [animation-delay:0.5s]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${p.mode === 'ai' ? 'bg-violet-50 text-violet-700' : p.mode === 'ai_ditolak' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {LABEL_MODE[p.mode] ?? 'Jawaban sistem (deterministik)'}
                        </span>
                        {p.putusan ? <span className="chip bg-slate-800 text-white">putusan: {p.putusan.toUpperCase()}</span> : null}
                      </div>
                      {p.fakta && p.fakta.length > 0 && (
                        <details className="group mt-1.5">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 font-semibold text-blue-700 hover:bg-blue-50">
                            <span className="inline-block transition-transform duration-200 group-open:rotate-90">▸</span> Rujukan fakta ({p.fakta.length})
                          </summary>
                          <ul className="berurutan mt-1.5 space-y-1">
                            {p.fakta.map((f) => (
                              <li key={f.id} className="rounded-lg bg-slate-50 px-2 py-1.5 leading-snug">
                                <b className="text-slate-700">[{f.id}]</b> {f.label}: {f.teks} <span className="font-mono text-slate-400">— {f.sumber}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {sibuk && (
            <div className="flex items-end gap-2" role="status">
              <AvatarCfo />
              <div className="anim-gelembung-kiri flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-[12px] text-slate-500 shadow-sm">
                <span className="titik-ketik text-blue-600" aria-hidden><i /><i /><i /></span>
                AI CFO menghitung…
              </div>
            </div>
          )}
        </div>

        {/* Kolom ketik */}
        <form className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-3 sm:px-4" onSubmit={(e) => { e.preventDefault(); void tanya(teks); }}>
          <input
            ref={masukan}
            className="h-11 min-w-0 flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/15"
            placeholder="Tanya AI CFO…"
            aria-label="Tanya AI CFO"
            value={teks}
            onChange={(e) => setTeks(e.target.value)}
            maxLength={1000}
          />
          <button
            className="kilau flex h-11 shrink-0 items-center gap-2 rounded-full bg-gradient-to-br from-brand-amber to-amber-500 px-4 text-sm font-semibold text-slate-900 shadow-md shadow-amber-500/30 enabled:hover:-translate-y-0.5 enabled:hover:shadow-lg enabled:hover:shadow-amber-500/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            disabled={sibuk || !teks.trim()}
          >
            <Icon name="kirim" className="h-4 w-4" /> <span className="hidden sm:inline">Kirim</span>
          </button>
        </form>
      </section>

      <Panel judul="Contoh pertanyaan" ikon="info">
        <div className="berurutan space-y-1.5">
          {CONTOH.map((c) => (
            <button key={c} onClick={() => void tanya(c)} disabled={sibuk} className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[12px] text-slate-700 hover:translate-x-0.5 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-800 disabled:opacity-50">
              {c}
            </button>
          ))}
        </div>
        <div className="mt-3"><Catatan>Setiap pertanyaan tercatat di audit log. AI CFO hanya membaca data — tidak bisa membayar, memindahkan uang, atau mengubah transaksi.</Catatan></div>
      </Panel>
    </div>
  );
}
