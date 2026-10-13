-- ============================================================================
-- 0046 — Loonars 2: daftar akses web pelaksana (tabel baru, berawalan loonars2_)
-- ============================================================================
-- Kenapa: 0045 memakai baris users_proyek 'LOONARS2' sebagai izin, tetapi
-- users_proyek.email UNIK (satu baris per orang). Orang yang sudah punya peran
-- lain (mis. Vando = verifikator) tidak bisa diberi baris kedua, dan mengubah
-- barisnya akan merusak perannya. Jadi izin tambahan disimpan di tabel sendiri.
--
-- RLS aktif. CFO mengelola; pemilik email hanya bisa membaca barisnya sendiri
-- (agar frontend tahu menu mana yang ditampilkan). Perubahan masuk audit log.
-- Penegakan akses data tetap di RPC loonars2_web_lihat.
-- ============================================================================

create table if not exists public.loonars2_akses_web (
  id          bigserial primary key,
  email       text not null,
  nama        text,
  dibuat_pada timestamptz not null default now()
);
create unique index if not exists loonars2_akses_web_email_uq on public.loonars2_akses_web (lower(email));

alter table public.loonars2_akses_web enable row level security;
revoke all on public.loonars2_akses_web from anon, authenticated;
grant select, insert, delete on public.loonars2_akses_web to authenticated;
grant usage, select on sequence public.loonars2_akses_web_id_seq to authenticated;

create policy baca_sendiri_atau_cfo on public.loonars2_akses_web for select to authenticated
  using ((select public.mkh_is_cfo()) or lower(email) = (select public.mkh_email_login()));
create policy cfo_tambah on public.loonars2_akses_web for insert to authenticated
  with check ((select public.mkh_is_cfo()));
create policy cfo_hapus on public.loonars2_akses_web for delete to authenticated
  using ((select public.mkh_is_cfo()));

create trigger loonars2_akses_web_audit after insert or update or delete on public.loonars2_akses_web
  for each row execute function public.loonars2_audit('id');

create or replace function public.loonars2_boleh_lihat()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mkh_is_cfo()
      or exists (
        select 1 from public.users_proyek
         where lower(email) = public.mkh_email_login() and proyek_id = 'LOONARS2'
      )
      or exists (
        select 1 from public.loonars2_akses_web
         where lower(email) = public.mkh_email_login()
      );
$$;

revoke execute on function public.loonars2_boleh_lihat() from public, anon;
grant execute on function public.loonars2_boleh_lihat() to authenticated;
