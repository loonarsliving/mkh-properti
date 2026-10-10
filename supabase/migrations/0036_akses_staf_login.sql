-- ============================================================================
-- 0036 — Akses berbasis login untuk staf (TAHAP 1 dari 2: hanya MENAMBAH)
--
-- Latar belakang: semua tabel keuangan selama ini bisa dibaca, diubah, dan
-- dihapus oleh role `anon` — kunci anon memang publik (tertanam di kode
-- klien), jadi efektifnya siapa pun bisa mengakses buku besar. Migrasi 0025
-- pernah ditulis untuk menutupnya tetapi tidak pernah diterapkan karena
-- frontend belum mengirim token login.
--
-- Penutupan dibagi dua agar tidak ada yang putus di tengah jalan:
--   0036 (ini)  — MENAMBAH policy untuk staf yang login + RPC form lapangan.
--                 Tidak ada policy/izin lama yang dicabut. Aman diterapkan
--                 sebelum frontend baru ter-deploy.
--   0037        — MENCABUT akses anon, setelah frontend yang memakai token
--                 login terbukti berjalan di produksi.
--
-- "Staf" = email login terkonfirmasi yang terdaftar di `cfo_users` atau
-- `users_proyek` — persis aturan yang dipakai guard halaman (src/lib/auth.ts).
-- Mendaftar sendiri lewat /login TIDAK membuat seseorang menjadi staf.
--
-- Tidak ada rumus keuangan, kolom, atau data yang diubah.
-- ============================================================================

-- Catatan penerapan: semua policy di sini baru, jadi tidak ada `drop policy`.
-- (Saat diterapkan lewat Supabase MCP 2026-10-10, `drop policy if exists` dan
-- fungsi pg_temp membuat klien menggantung; keduanya sengaja dihindari.)

-- ----------------------------------------------------------------------------
-- Fungsi bantu peran. SECURITY DEFINER agar bisa membaca auth.users dan
-- daftar staf tanpa bergantung pada RLS tabel itu sendiri (mencegah rekursi
-- policy). Dipanggil dari policy sebagai `(select ...)` supaya dievaluasi
-- sekali per query, bukan per baris.
-- ----------------------------------------------------------------------------
create or replace function public.mkh_email_login()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null;
$$;

create or replace function public.mkh_is_cfo()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.cfo_users c
    where lower(c.email) = public.mkh_email_login()
  );
$$;

create or replace function public.mkh_is_staf()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.mkh_is_cfo() or exists (
    select 1 from public.users_proyek up
    where lower(up.email) = public.mkh_email_login()
  );
$$;

revoke execute on function public.mkh_email_login() from public;
revoke execute on function public.mkh_is_cfo() from public;
revoke execute on function public.mkh_is_staf() from public;
grant execute on function public.mkh_email_login() to anon, authenticated;
grant execute on function public.mkh_is_cfo() to anon, authenticated;
grant execute on function public.mkh_is_staf() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Tabel keuangan: staf yang login mendapat akses penuh — sama dengan yang
-- mereka punya hari ini lewat anon key, jadi perilaku aplikasi tidak berubah.
-- (Pembatasan admin proyek ke proyeknya sendiri adalah langkah terpisah.)
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'jurnal', 'aset', 'utang_bank', 'pengajuan', 'bayar_tukang',
    'tukang_borongan', 'crm_payment_receipts', 'pendapatan_villa',
    'beban_villa', 'construction_project_financial_records'
  ]
  loop
    -- Semua tabel di daftar ini SUDAH ber-RLS; `karyawan` dan `slip_gaji`
    -- (RLS masih mati) sengaja baru diurus di 0037 supaya 0036 benar-benar
    -- tidak mengurangi akses siapa pun.
    execute format(
      'create policy staf_akses_penuh on public.%I for all to authenticated '
      'using ((select public.mkh_is_staf())) with check ((select public.mkh_is_staf()))',
      t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Sequence untuk kolom id (insert dari frontend dengan token login).
grant usage, select on all sequences in schema public to authenticated;

-- ----------------------------------------------------------------------------
-- Daftar staf. Setiap orang boleh membaca barisnya sendiri (dibutuhkan guard
-- halaman untuk menentukan peran); staf boleh membaca semua; hanya CFO yang
-- boleh menambah/menghapus admin proyek (halaman /users).
-- ----------------------------------------------------------------------------
create policy users_proyek_baca_login on public.users_proyek for select to authenticated
  using (lower(email) = (select public.mkh_email_login()) or (select public.mkh_is_staf()));

create policy users_proyek_kelola_cfo on public.users_proyek for all to authenticated
  using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));

grant select, insert, update, delete on public.users_proyek to authenticated;

create policy cfo_users_baca_sendiri on public.cfo_users for select to authenticated
  using (lower(email) = (select public.mkh_email_login()) or (select public.mkh_is_cfo()));

-- sync_log: staf boleh membaca (jejak audit). Penulisan hanya oleh trigger/
-- fungsi sistem.
create policy staf_baca_sync_log on public.sync_log for select to authenticated
  using ((select public.mkh_is_staf()));

-- ----------------------------------------------------------------------------
-- Dua fungsi yang dipanggil dari konteks pengguna dijadikan SECURITY DEFINER
-- agar tidak bergantung pada izin pemanggil atas tabel penunjangnya
-- (mkh_counter, sync_log). Badan fungsi TIDAK diubah; semua nama tabel di
-- dalamnya sudah memakai `public.` sehingga search_path tetap aman.
-- ----------------------------------------------------------------------------
alter function public.next_mkh_no(text) security definer set search_path = public;
alter function public.jurnal_branch_balance_sync() security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- RPC untuk tiga form lapor lapangan tanpa login. Menggantikan insert langsung
-- ke `pengajuan` dengan anon key. Hanya bisa MEMBUAT satu pengajuan bahan
-- berstatus pending untuk pelapor & proyek yang memang punya form — tidak bisa
-- membaca, mengubah, atau menyetujui apa pun.
--
-- Kombinasi pelapor/proyek di bawah sama persis dengan konfigurasi halaman
-- src/app/lapor-*/page.tsx. Format created_by dipertahankan karena trigger
-- 0023 (routing Syafiq → KC Jogja) mencocokkannya.
-- ----------------------------------------------------------------------------
create or replace function public.lapor_lapangan_kirim(
  p_proyek text,
  p_pelapor text,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_no text;
  v_id bigint;
  v_nominal numeric;
  v_data jsonb;
begin
  if (p_proyek, p_pelapor) not in (
    ('LL', 'Pengawas: Endy'),
    ('LL', 'Pelapor: Rebecca'),
    ('IH', 'Pelapor: Muhammad Syafiq')
  ) then
    raise exception 'Form lapor tidak dikenal' using errcode = '42501';
  end if;

  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 20000 then
    raise exception 'Data laporan tidak valid' using errcode = '22023';
  end if;

  v_nominal := nullif(p_data->>'nominal', '')::numeric;
  if v_nominal is null or v_nominal <= 0 then
    raise exception 'Total pengeluaran harus lebih dari 0' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') = 0 then
    raise exception 'Minimal satu item pengeluaran' using errcode = '22023';
  end if;

  v_no := 'KK-' || lpad(public.next_mkh_no('KK')::text, 3, '0');
  v_data := p_data || jsonb_build_object('no', v_no);

  insert into public.pengajuan (proyek, tipe, status, created_by, data)
  values (p_proyek, 'bahan', 'pending', p_pelapor, v_data)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'no', v_no);
end;
$$;

revoke execute on function public.lapor_lapangan_kirim(text, text, jsonb) from public;
grant execute on function public.lapor_lapangan_kirim(text, text, jsonb) to anon, authenticated;
