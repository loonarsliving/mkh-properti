-- 0073b — gerbang rahasia x-advisor-secret
-- Bagian dari register advisor (lihat 0073a untuk desain). Hanya objek baru.

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

