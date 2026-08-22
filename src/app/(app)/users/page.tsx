'use client';

import { useEffect, useState } from 'react';
import { GuardHalaman } from '@/components/shell/GuardHalaman';
import { useData } from '@/components/shell/DataProvider';
import { useJudul } from '@/components/shell/JudulProvider';
import { Icon } from '@/components/ui/Icon';
import { Kosong, Memuat, OverlaySimpan, Panel, PesanGalat, Toast, useToast } from '@/components/ui/Umum';
import { Bidang, PilihProyek, TagProyek } from '@/components/ui/Form';
import { SB_KEY, SB_URL } from '@/lib/config';
import { sbDelete, sbInsert } from '@/lib/supabase';
import type { UsersProyek } from '@/types';

export default function HalamanUsers() {
  return (
    <GuardHalaman izinkan={['cfo']}>
      <IsiUsers />
    </GuardHalaman>
  );
}

function IsiUsers() {
  const { usersProyek, memuat, galat, muatUlang, setUsersProyek } = useData();
  const toast = useToast();
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [asal, setAsal] = useState('');

  useJudul({
    judul: 'Pengguna & Hak Akses',
    deskripsi: 'Admin proyek, manager, dan verifikator',
    tampilkanFilter: false,
  });

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [proyek, setProyek] = useState('AFP');
  const [nama, setNama] = useState('');

  useEffect(() => setAsal(window.location.origin), []);

  async function tambah() {
    const alamat = email.trim();
    if (!alamat || !password || !proyek) {
      toast.galat('Lengkapi email, password, dan proyek!');
      return;
    }
    if (password.length < 6) {
      toast.galat('Password minimal 6 karakter!');
      return;
    }
    if (usersProyek.some((u) => u.email === alamat)) {
      toast.galat('Email sudah terdaftar!');
      return;
    }

    setSibuk('Membuat akun admin…');
    try {
      // Akun Auth dibuat lewat Edge Function `admin-create-user`, yang memegang
      // service role key di sisi server dan memverifikasi pemanggil ada di
      // allowlist cfo_users. Klien tidak pernah menyentuh service role key.
      const token = window.sessionStorage.getItem('sb_access_token');
      const res = await fetch(`${SB_URL}/functions/v1/admin-create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SB_KEY,
          Authorization: `Bearer ${token ?? ''}`,
        },
        body: JSON.stringify({ email: alamat, password }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; msg?: string; message?: string };
        throw new Error(err.error ?? err.msg ?? err.message ?? 'Gagal membuat akun di Supabase');
      }

      const baris = await sbInsert<UsersProyek>('users_proyek', [
        { email: alamat, proyek_id: proyek, nama: nama || alamat },
      ]);
      setUsersProyek((sebelum) => [...sebelum, ...baris]);

      toast.sukses(`Admin ${alamat} berhasil dibuat untuk proyek ${proyek}!`);
      setEmail('');
      setPassword('');
      setNama('');
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function hapus(id: number, alamat: string) {
    if (!window.confirm(`Hapus akses admin ${alamat}? Akun Supabase Auth tidak ikut terhapus.`)) return;
    setSibuk('Menghapus…');
    try {
      await sbDelete('users_proyek', id);
      setUsersProyek((sebelum) => sebelum.filter((u) => u.id !== id));
      toast.info(`Akses ${alamat} dicabut.`);
    } catch (e) {
      toast.galat(`Gagal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  if (memuat) return <Memuat />;
  if (galat) return <PesanGalat pesan={galat} onCoba={() => void muatUlang()} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
      <OverlaySimpan pesan={sibuk} />
      <Toast isi={toast.isi} onSelesai={toast.bersihkan} />

      <Panel judul="Tambah Admin Proyek" ikon="orang">
        <div className="grid gap-3">
          <Bidang
            label="Email Admin"
            anak={
              <input
                type="email"
                className="input"
                placeholder="admin@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            }
          />
          <Bidang
            label="Password"
            anak={
              <input
                type="password"
                className="input"
                placeholder="Min. 6 karakter"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            }
          />
          <Bidang
            label="Assign ke Proyek"
            bantuan='Isi "MANAGER" atau "VERIFIKATOR" lewat database untuk peran verifikator.'
            anak={<PilihProyek id="usr-proyek" nilai={proyek} onUbah={setProyek} />}
          />
          <Bidang
            label="Nama Admin (opsional)"
            anak={
              <input
                className="input"
                placeholder="Nama lengkap admin"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
              />
            }
          />
        </div>

        <button className="btn-green mt-4 w-full" onClick={() => void tambah()}>
          <Icon name="plus" className="h-4 w-4" /> Buat Akun Admin
        </button>

        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10.5px] leading-relaxed text-emerald-900">
          Admin yang dibuat hanya bisa membuka <b>Dashboard Proyek</b> dan hanya melihat data proyek
          yang di-assign. Akses dashboard CFO diatur terpisah lewat tabel <b>cfo_users</b> di
          Supabase.
        </p>
      </Panel>

      <div className="space-y-4">
        <Panel judul="Link Halaman Admin Proyek" ikon="info">
          <p className="mb-2 text-[11.5px] text-slate-500">Bagikan link ini ke admin proyek:</p>
          <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-blue-600">
            {asal}/admin-proyek
          </code>
          <button
            className="btn-ghost mt-2 w-full py-1.5 text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(`${asal}/admin-proyek`);
              toast.info('Link disalin!');
            }}
          >
            <Icon name="dokumen" className="h-3.5 w-3.5" /> Salin Link
          </button>
        </Panel>

        <Panel judul={`Daftar Pengguna (${usersProyek.length})`} ikon="orang-grup" padat>
          {usersProyek.length === 0 ? (
            <Kosong pesan="Belum ada admin proyek." ikon="orang-grup" />
          ) : (
            <div className="thin-scroll max-h-[55vh] overflow-auto">
              <table className="tbl">
                <thead className="sticky top-0">
                  <tr>
                    <th>Email</th>
                    <th>Proyek / Peran</th>
                    <th>Nama</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {usersProyek.map((u) => (
                    <tr key={u.id}>
                      <td className="text-[11.5px]">{u.email}</td>
                      <td>
                        {u.proyek_id === 'MANAGER' || u.proyek_id?.startsWith('VERIFIKATOR') ? (
                          <span className="chip bg-blue-100 text-blue-700">{u.proyek_id}</span>
                        ) : (
                          <TagProyek id={u.proyek_id} />
                        )}
                      </td>
                      <td className="text-[11.5px] text-slate-500">{u.nama || '-'}</td>
                      <td>
                        {u.id !== undefined ? (
                          <button
                            onClick={() => void hapus(u.id as number, u.email)}
                            className="rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                            aria-label={`Cabut akses ${u.email}`}
                          >
                            <Icon name="sampah" className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
