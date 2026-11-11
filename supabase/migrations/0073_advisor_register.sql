-- ============================================================================
-- 0073 — Loonars AI Advisor: register keputusan, syarat, dokumen, log
-- ============================================================================
--
-- Owner D-2026-005 (data advisor di database MKH Property, tabel advisor_*
-- tersendiri) & D-2026-007 (semua fitur advisor lewat layanan advisor/WA).
--
-- Desain:
--   * Tabel baru saja; tidak ada tabel/fungsi lama yang diubah.
--   * RLS aktif TANPA policy → anon/authenticated tidak bisa membaca/menulis
--     langsung. Semua akses lewat RPC security definer di bawah, yang hanya
--     berjalan bila header x-advisor-secret = Vault advisor_shared_secret
--     (rahasia yang sama dengan endpoint /api/cfo/advisor, 0072).
--   * Status CONFIRMED hanya bisa dipasang lewat advisor_keputusan_konfirmasi
--     (dari PROPOSED), sesuai aturan "CONFIRMED hanya setelah founder
--     mengonfirmasi". advisor_keputusan_simpan menolak status CONFIRMED/REVIEWED
--     dan tidak bisa mengubah keputusan yang sudah CONFIRMED/REVIEWED.
--     Keputusan lama dari repo Istri diimpor sekali oleh operator (bukan lewat RPC).
--   * advisor_log append-only (trigger menolak UPDATE/DELETE), pola cfo_audit_log.
-- ============================================================================

create table if not exists public.advisor_keputusan (
  id text primary key check (id ~ '^D-[0-9]{4}-[0-9]{3}$'),
  judul text not null check (length(judul) between 3 and 300),
  tanggal date not null default (now() at time zone 'Asia/Jakarta')::date,
  status text not null default 'PROPOSED'
    check (status in ('DRAFT', 'PROPOSED', 'CONFIRMED', 'REVIEWED', 'REJECTED', 'SUPERSEDED', 'IMPORTED')),
  isi jsonb not null default '{}'::jsonb,
  review_on date,
  confirmed_at timestamptz,
  confirmed_by text,
  sumber text not null default 'wa' check (sumber in ('wa', 'repo')),
  dibuat timestamptz not null default now(),
  diubah timestamptz not null default now()
);

create table if not exists public.advisor_syarat (
  id bigserial primary key,
  keputusan_id text references public.advisor_keputusan(id) on delete cascade,
  teks text not null check (length(teks) between 3 and 500),
  tenggat date,
  status text not null default 'terbuka' check (status in ('terbuka', 'selesai', 'batal')),
  dibuat timestamptz not null default now()
);
create index if not exists advisor_syarat_tenggat_idx on public.advisor_syarat (status, tenggat);

create table if not exists public.advisor_dokumen (
  id bigserial primary key,
  jenis text not null check (jenis in ('board', 'mentor', 'riset', 'evaluasi', 'lain')),
  judul text not null check (length(judul) between 3 and 300),
  isi text not null check (octet_length(isi) <= 400000),
  keputusan_id text references public.advisor_keputusan(id) on delete set null,
  dibuat timestamptz not null default now()
);

create table if not exists public.advisor_pengaturan (
  kunci text primary key check (kunci ~ '^[a-z_]{1,40}$'),
  nilai text not null,
  diubah timestamptz not null default now()
);

create table if not exists public.advisor_log (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  aksi text not null check (length(aksi) between 1 and 60),
  ringkas jsonb not null default '{}'::jsonb
);

alter table public.advisor_keputusan enable row level security;
alter table public.advisor_syarat enable row level security;
alter table public.advisor_dokumen enable row level security;
alter table public.advisor_pengaturan enable row level security;
alter table public.advisor_log enable row level security;
revoke all on public.advisor_keputusan, public.advisor_syarat, public.advisor_dokumen,
              public.advisor_pengaturan, public.advisor_log from anon, authenticated;

create or replace function public._advisor_log_tolak_ubah()
returns trigger language plpgsql as $$
begin
  raise exception 'advisor_log append-only' using errcode = '42501';
end;
$$;
drop trigger if exists advisor_log_append_only on public.advisor_log;
create trigger advisor_log_append_only before update or delete on public.advisor_log
  for each row execute function public._advisor_log_tolak_ubah();

-- Gerbang: rahasia advisor (Vault advisor_shared_secret) di header.
create or replace function public._advisor_sah()
returns boolean
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'advisor_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-advisor-secret',
    current_setting('request.header.x-advisor-secret', true)
  );
  return v_secret is not null and length(v_secret) >= 32 and v_provided = v_secret;
end;
$$;
revoke execute on function public._advisor_sah() from public, anon, authenticated;

create or replace function public._advisor_wajib()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public._advisor_sah() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public._advisor_wajib() from public, anon, authenticated;

create or replace function public.advisor_keputusan_daftar()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'judul', k.judul, 'tanggal', k.tanggal, 'status', k.status, 'review_on', k.review_on,
      'confirmed_at', k.confirmed_at, 'isi', k.isi,
      'syarat', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'teks', s.teks, 'tenggat', s.tenggat, 'status', s.status) order by s.id)
                          from public.advisor_syarat s where s.keputusan_id = k.id), '[]'::jsonb)
    ) order by k.id)
    from public.advisor_keputusan k), '[]'::jsonb);
end;
$$;

-- Simpan/ubah keputusan (bukan CONFIRMED/REVIEWED). p: {id?, judul, isi, status?, review_on?, sumber?, syarat?:[{teks,tenggat}]}
create or replace function public.advisor_keputusan_simpan(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(p ->> 'id', '');
  v_status text := coalesce(nullif(p ->> 'status', ''), 'PROPOSED');
  v_tahun text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY');
  v_n int;
  v_item jsonb;
  v_lama text;
begin
  perform public._advisor_wajib();
  if v_status in ('CONFIRMED', 'REVIEWED') then
    raise exception 'Status % hanya lewat konfirmasi founder', v_status using errcode = '22023';
  end if;
  if v_id is null then
    select coalesce(max(substring(id from 8 for 3)::int), 0) + 1 into v_n from public.advisor_keputusan where id like 'D-' || v_tahun || '-%';
    v_id := 'D-' || v_tahun || '-' || lpad(v_n::text, 3, '0');
  end if;
  select status into v_lama from public.advisor_keputusan where id = v_id;
  if v_lama in ('CONFIRMED', 'REVIEWED') then
    raise exception 'Keputusan % sudah %, tidak bisa diubah lewat simpan', v_id, v_lama using errcode = '22023';
  end if;
  insert into public.advisor_keputusan as k (id, judul, tanggal, status, isi, review_on, sumber)
  values (v_id, p ->> 'judul', coalesce((p ->> 'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date), v_status,
          coalesce(p -> 'isi', '{}'::jsonb), (p ->> 'review_on')::date, 'wa')
  on conflict (id) do update set judul = excluded.judul, status = excluded.status, isi = excluded.isi,
    review_on = excluded.review_on, diubah = now();
  if jsonb_typeof(p -> 'syarat') = 'array' then
    delete from public.advisor_syarat where keputusan_id = v_id and status = 'terbuka';
    for v_item in select * from jsonb_array_elements(p -> 'syarat') loop
      insert into public.advisor_syarat (keputusan_id, teks, tenggat)
      values (v_id, v_item ->> 'teks', nullif(v_item ->> 'tenggat', '')::date);
    end loop;
  end if;
  insert into public.advisor_log (aksi, ringkas) values ('keputusan_simpan', jsonb_build_object('id', v_id, 'status', v_status));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

create or replace function public.advisor_keputusan_konfirmasi(p_id text, p_oleh text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  perform public._advisor_wajib();
  select status into v_status from public.advisor_keputusan where id = p_id for update;
  if v_status is null then
    return jsonb_build_object('hasil', 'tidak_ada', 'id', p_id);
  end if;
  if v_status <> 'PROPOSED' then
    return jsonb_build_object('hasil', 'status_' || lower(v_status), 'id', p_id);
  end if;
  update public.advisor_keputusan
     set status = 'CONFIRMED', confirmed_at = now(), confirmed_by = left(coalesce(p_oleh, 'founder'), 80), diubah = now()
   where id = p_id;
  insert into public.advisor_log (aksi, ringkas) values ('keputusan_konfirmasi', jsonb_build_object('id', p_id, 'oleh', left(coalesce(p_oleh, 'founder'), 80)));
  return jsonb_build_object('hasil', 'confirmed', 'id', p_id);
end;
$$;

create or replace function public.advisor_syarat_ubah(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  if p_status not in ('terbuka', 'selesai', 'batal') then
    raise exception 'Status syarat tidak valid' using errcode = '22023';
  end if;
  update public.advisor_syarat set status = p_status where id = p_id;
  insert into public.advisor_log (aksi, ringkas) values ('syarat_ubah', jsonb_build_object('id', p_id, 'status', p_status));
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create or replace function public.advisor_syarat_jatuh_tempo(p_hari int default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'keputusan_id', s.keputusan_id, 'teks', s.teks, 'tenggat', s.tenggat) order by s.tenggat)
    from public.advisor_syarat s join public.advisor_keputusan k on k.id = s.keputusan_id
    where s.status = 'terbuka' and s.tenggat is not null and k.status in ('CONFIRMED', 'PROPOSED')
      and s.tenggat <= (now() at time zone 'Asia/Jakarta')::date + greatest(0, least(p_hari, 60))), '[]'::jsonb);
end;
$$;

create or replace function public.advisor_dokumen_simpan(p_jenis text, p_judul text, p_isi text, p_keputusan_id text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public._advisor_wajib();
  insert into public.advisor_dokumen (jenis, judul, isi, keputusan_id) values (p_jenis, p_judul, p_isi, nullif(p_keputusan_id, ''))
  returning id into v_id;
  insert into public.advisor_log (aksi, ringkas) values ('dokumen_simpan', jsonb_build_object('id', v_id, 'jenis', p_jenis));
  return v_id;
end;
$$;

create or replace function public.advisor_dokumen_ambil(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return (select jsonb_build_object('id', d.id, 'jenis', d.jenis, 'judul', d.judul, 'isi', d.isi, 'keputusan_id', d.keputusan_id, 'dibuat', d.dibuat)
          from public.advisor_dokumen d where d.id = p_id);
end;
$$;

create or replace function public.advisor_dokumen_terbaru(p_jumlah int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', d.id, 'jenis', d.jenis, 'judul', d.judul, 'dibuat', d.dibuat) as x
    from public.advisor_dokumen d order by d.id desc limit greatest(1, least(p_jumlah, 50))) t), '[]'::jsonb);
end;
$$;

create or replace function public.advisor_pengaturan_set(p_kunci text, p_nilai text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  insert into public.advisor_pengaturan (kunci, nilai) values (p_kunci, p_nilai)
  on conflict (kunci) do update set nilai = excluded.nilai, diubah = now();
end;
$$;

create or replace function public.advisor_pengaturan_get(p_kunci text)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return (select nilai from public.advisor_pengaturan where kunci = p_kunci);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'advisor_keputusan_daftar()', 'advisor_keputusan_simpan(jsonb)', 'advisor_keputusan_konfirmasi(text, text)',
    'advisor_syarat_ubah(bigint, text)', 'advisor_syarat_jatuh_tempo(int)',
    'advisor_dokumen_simpan(text, text, text, text)', 'advisor_dokumen_ambil(bigint)', 'advisor_dokumen_terbaru(int)',
    'advisor_pengaturan_set(text, text)', 'advisor_pengaturan_get(text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end;
$$;
