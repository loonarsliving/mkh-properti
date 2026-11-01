'use client';

import { useRef, useState } from 'react';
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

export default function HalamanCfoChat() {
  useJudul({ judul: 'AI CFO Chat', deskripsi: 'Tanya kondisi keuangan Loonars 1 & 2 — setiap angka dirujuk ke fakta & sumber datanya', tampilkanFilter: false });
  const [pesan, setPesan] = useState<Pesan[]>([]);
  const [teks, setTeks] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const bawah = useRef<HTMLDivElement>(null);

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
      setTimeout(() => bawah.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-4">
      <div className="xl:col-span-3">
        <Panel judul="Percakapan" ikon="kirim">
          <div className="max-h-[60vh] min-h-[320px] space-y-3 overflow-y-auto pr-1">
            {!pesan.length && <Catatan>Mulai dengan pertanyaan di bawah atau pilih contoh di samping. Untuk menguji keputusan, sebutkan nominalnya (mis. &quot;mau beli tanah 1,5 M&quot;).</Catatan>}
            {pesan.map((p, i) => (
              <div key={i} className={`flex ${p.peran === 'owner' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 text-[12.5px] ${p.peran === 'owner' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white'}`}>
                  <div className="whitespace-pre-wrap leading-relaxed">{p.isi}</div>
                  {p.peran === 'cfo' && p.mode && (
                    <div className="mt-2 border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-500">
                      {p.mode === 'ai' ? 'Narasi AI (angka tervalidasi terhadap fakta)' : p.mode === 'ai_ditolak' ? 'Narasi AI ditolak karena memuat angka di luar fakta — ditampilkan jawaban sistem' : 'Jawaban sistem (deterministik)'}
                      {p.putusan ? ` · putusan: ${p.putusan.toUpperCase()}` : ''}
                      {p.fakta && p.fakta.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer">Rujukan fakta ({p.fakta.length})</summary>
                          <ul className="mt-1 space-y-0.5">
                            {p.fakta.map((f) => <li key={f.id}><b>[{f.id}]</b> {f.label}: {f.teks} <span className="font-mono text-slate-400">— {f.sumber}</span></li>)}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {sibuk && <div className="text-[12px] text-slate-500">AI CFO menghitung…</div>}
            <div ref={bawah} />
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void tanya(teks); }}>
            <input className="input flex-1" placeholder="Tanya AI CFO…" value={teks} onChange={(e) => setTeks(e.target.value)} maxLength={1000} />
            <button className="btn-amber" disabled={sibuk || !teks.trim()}><Icon name="kirim" className="h-4 w-4" /> Kirim</button>
          </form>
        </Panel>
      </div>
      <Panel judul="Contoh pertanyaan" ikon="info">
        <div className="space-y-1.5">
          {CONTOH.map((c) => <button key={c} onClick={() => void tanya(c)} className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[12px] hover:border-blue-300">{c}</button>)}
        </div>
        <div className="mt-3"><Catatan>Setiap pertanyaan tercatat di audit log. AI CFO hanya membaca data — tidak bisa membayar, memindahkan uang, atau mengubah transaksi.</Catatan></div>
      </Panel>
    </div>
  );
}
