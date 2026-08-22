'use client';

import Image from 'next/image';
import { PERUSAHAAN } from '@/lib/config';
import { rupiah, tanggalPanjang } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';

export interface DataKwitansi {
  no: string;
  tgl: string;
  jenis: string;
  blok: string;
  pembeli: string;
  nominal: number;
  proyek: string;
  ket: string;
}

function Baris({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="mb-2 flex text-[11pt]">
      <span className="w-[180px] shrink-0 text-slate-600">{label}</span>
      <span className="flex-1 border-b border-slate-300 pb-0.5 font-bold">{nilai}</span>
    </div>
  );
}

/**
 * Kwitansi pembayaran.
 *
 * Versi lama membuka jendela baru lalu menyusun HTML lewat `document.write`
 * dengan nilai dari database. Di sini kwitansi dirender sebagai bagian halaman
 * yang hanya muncul saat mencetak, jadi tidak ada lagi penyusunan HTML sebagai
 * string. Logo juga dilayani dari `public/` sendiri, bukan dari raw.githubusercontent.com,
 * supaya kwitansi tetap tercetak lengkap walau jaringan ke GitHub terputus.
 */
export function Kwitansi({ data }: { data: DataKwitansi | null }) {
  if (!data) return null;

  return (
    <div className="hidden print:block">
      <div className="mx-auto max-w-[720px] p-8 font-serif text-slate-900">
        <div className="mb-5 flex items-center justify-between border-b-[3px] border-slate-900 pb-4">
          <Image src="/logo-mkh.png" alt="MKH" width={160} height={56} className="h-14 w-auto object-contain" />
          <Image
            src="/logo-loonars.png"
            alt="Loonars"
            width={160}
            height={56}
            className="h-14 w-auto object-contain"
          />
        </div>

        <div className="mb-5 text-center">
          <h1 className="text-[22pt] font-bold uppercase tracking-[0.1em]">Kwitansi Pembayaran</h1>
          <div className="mt-1 text-[11pt] text-slate-600">
            No: {data.no} | Tanggal: {tanggalPanjang(data.tgl)}
          </div>
        </div>

        <div className="mb-4 rounded border-2 border-slate-900 bg-slate-50 px-5 py-3.5 text-center">
          <div className="text-[20pt] font-bold">{rupiah(data.nominal)}</div>
          <div className="mt-1 text-[10pt] italic text-slate-600 first-letter:uppercase">
            # {terbilang(data.nominal)} rupiah #
          </div>
        </div>

        <div className="mb-4 rounded border-2 border-slate-900 px-5 py-4">
          <Baris label="Telah diterima dari" nilai={data.pembeli || '_______________'} />
          <Baris label="Untuk pembayaran" nilai={data.jenis} />
          <Baris label="Blok / Unit" nilai={data.blok || '_______________'} />
          <Baris label="Proyek" nilai={data.proyek} />
          {data.ket ? <Baris label="Keterangan" nilai={data.ket} /> : null}
        </div>

        <div className="mt-8 flex justify-between">
          {['Pembeli / Penyetor,', 'Yang Menerima,'].map((label) => (
            <div key={label} className="w-[200px] text-center">
              <div className="text-[10pt]">{label}</div>
              <div className="mt-[70px] border-t border-slate-900 pt-1.5 text-[10pt]">
                ( _____________________ )
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-3 text-center text-[9pt] text-slate-400">
          {PERUSAHAAN} • Sistem Keuangan Digital
        </div>
      </div>
    </div>
  );
}
