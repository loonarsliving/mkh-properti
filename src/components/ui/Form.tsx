'use client';

import { AKUN_KAS, PROYEK, getAkun, getProyek } from '@/lib/master';
import { formatInputAngka, parseAngka } from '@/lib/format';

export function Bidang({
  label,
  htmlFor,
  anak,
  span,
  bantuan,
}: {
  label: string;
  htmlFor?: string;
  anak: React.ReactNode;
  span?: boolean;
  bantuan?: string;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {anak}
      {bantuan ? <p className="mt-1 text-[10px] text-slate-400">{bantuan}</p> : null}
    </div>
  );
}

export function PilihProyek({
  id,
  nilai,
  onUbah,
  hanya,
}: {
  id: string;
  nilai: string;
  onUbah: (v: string) => void;
  hanya?: string[];
}) {
  const daftar = hanya ? PROYEK.filter((p) => hanya.includes(p.id)) : PROYEK;
  return (
    <select id={id} className="input" value={nilai} onChange={(e) => onUbah(e.target.value)}>
      {daftar.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nama}
        </option>
      ))}
    </select>
  );
}

/** Pilihan rekening kas/bank — daftar sama persis dengan `rekSelect()` lama. */
export function PilihRekening({
  id,
  nilai,
  onUbah,
}: {
  id: string;
  nilai: string;
  onUbah: (v: string) => void;
}) {
  return (
    <select id={id} className="input" value={nilai} onChange={(e) => onUbah(e.target.value)}>
      {AKUN_KAS.map((kode) => {
        const a = getAkun(kode);
        return (
          <option key={kode} value={kode}>
            {a?.nama}
            {a?.rek ? ` — ${a.rek}` : ''}
          </option>
        );
      })}
    </select>
  );
}

/**
 * Input nominal rupiah dengan pemisah ribuan saat diketik. Nilai yang
 * dikembalikan tetap number murni, jadi yang tersimpan ke database sama
 * persis dengan versi lama (`parseFloat` dari input number).
 */
export function InputRupiah({
  id,
  nilai,
  onUbah,
  placeholder = '0',
}: {
  id: string;
  nilai: number;
  onUbah: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-slate-400">
        Rp
      </span>
      <input
        id={id}
        inputMode="numeric"
        className="input pl-9 text-right font-mono tabular-nums"
        value={nilai ? formatInputAngka(String(nilai)) : ''}
        placeholder={placeholder}
        onChange={(e) => onUbah(parseAngka(e.target.value))}
      />
    </div>
  );
}

export function TagProyek({ id }: { id: string }) {
  const p = getProyek(id);
  return (
    <span
      className="chip"
      style={{ backgroundColor: `${p.warna}22`, color: p.warna }}
      title={p.nama}
    >
      {id || '-'}
    </span>
  );
}

export function TagStatusAset({ status }: { status?: string | null }) {
  const s = status ?? 'tersedia';
  const warna =
    s === 'tersedia'
      ? 'bg-emerald-100 text-emerald-700'
      : s === 'dp'
        ? 'bg-violet-100 text-violet-700'
        : 'bg-rose-100 text-rose-700';
  return <span className={`chip ${warna}`}>{s}</span>;
}
