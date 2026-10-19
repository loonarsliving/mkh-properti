-- Stub minimal lingkungan Supabase agar migrasi 0043 bisa diuji di
-- Postgres lokal sekali pakai (BUKAN untuk produksi).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema vault;
create table vault.secrets_stub (name text primary key, decrypted_secret text);
create view vault.decrypted_secrets as select name, decrypted_secret from vault.secrets_stub;
insert into vault.secrets_stub values ('mk_sync_shared_secret', 'rahasia-uji');
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command; select 1::bigint $$;
create schema net;
create table net.panggilan (id bigserial, url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int default 5000) returns bigint
  language sql as $$ insert into net.panggilan (url, headers, body) values (url, headers, body) returning id $$;
-- Pengganti fungsi 0036: CFO/email disimulasikan lewat GUC uji.
create function public.mkh_email_login() returns text language sql stable as
  $$ select nullif(current_setting('uji.email', true), '') $$;
create function public.mkh_is_cfo() returns boolean language sql stable as
  $$ select coalesce(current_setting('uji.cfo', true), '') = 'ya' $$;
-- Pengganti users_proyek (tabel produksi yang sudah ada; hanya kolom yang dipakai 0045).
create table public.users_proyek (id serial primary key, email text not null, proyek_id text, nama text);
