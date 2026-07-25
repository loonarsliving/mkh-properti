-- ============================================================================
-- MKH Property — 0010: loonars_users password hashing hardening
--
-- loonars-sales (villa siteplan app, shares this project) previously stored
-- and compared login passwords in PLAINTEXT (loonars_users.password_hash),
-- verified client-side by fetching the row over PostgREST with the anon
-- key and comparing in JS. Anyone with the anon key (public, embedded in
-- the client) could read every user's plaintext password directly.
--
-- Fix:
-- 1. Use pgcrypto's bcrypt (crypt()/gen_salt('bf')) — no external Deno
--    bcrypt dependency needed, no new Edge Function.
-- 2. Rehash any existing plaintext values (bcrypt hashes always start with
--    "$2"; this is idempotent — running it twice is a no-op the second
--    time).
-- 3. A SECURITY DEFINER RPC (public.loonars_login) does the credential
--    check server-side and returns only a minimal safe profile — the
--    client never sees password_hash again.
-- 4. Revoke direct SELECT on the password_hash column from anon/
--    authenticated so it can no longer be fetched directly via PostgREST,
--    only compared inside the RPC.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

update public.loonars_users
set password_hash = crypt(password_hash, gen_salt('bf'))
where password_hash is not null
  and password_hash not like '$2%';

revoke select (password_hash) on public.loonars_users from anon, authenticated;

create or replace function public.loonars_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user record;
begin
  select id, email, nama, role, password_hash into v_user
  from public.loonars_users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'Email tidak terdaftar');
  end if;

  if v_user.password_hash is null or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    return jsonb_build_object('ok', false, 'error', 'Password salah');
  end if;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('id', v_user.id, 'email', v_user.email, 'nama', v_user.nama, 'role', v_user.role)
  );
end;
$$;

revoke execute on function public.loonars_login(text, text) from public;
grant execute on function public.loonars_login(text, text) to anon, authenticated;

comment on function public.loonars_login is
  'Server-side credential check for loonars-sales custom login (loonars_users). Replaces the old client-side plaintext comparison — password_hash is never returned to the client.';

-- ----------------------------------------------------------------------------
-- Belt-and-suspenders: the admin "add/edit user" screens in loonars-sales
-- still INSERT/UPDATE password_hash with a plaintext value directly via
-- PostgREST. Transparently hash it server-side on write so those screens
-- don't need to change, and so no code path can ever store plaintext again.
-- ----------------------------------------------------------------------------
create or replace function public.loonars_users_hash_password()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.password_hash is not null and new.password_hash not like '$2%' then
    new.password_hash := crypt(new.password_hash, gen_salt('bf'));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loonars_users_hash_password on public.loonars_users;
create trigger trg_loonars_users_hash_password
before insert or update of password_hash on public.loonars_users
for each row execute function public.loonars_users_hash_password();

comment on function public.loonars_users_hash_password is
  'Transparently bcrypt-hashes password_hash on insert/update so it is never persisted in plaintext, regardless of what the client sends.';
