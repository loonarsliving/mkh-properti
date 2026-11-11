-- 0073d — advisor_log append-only
-- Bagian dari register advisor (lihat 0073a untuk desain). Hanya objek baru.

create or replace function public._advisor_log_tolak_ubah()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'advisor_log append-only' using errcode = '42501';
end;
$$;
create or replace trigger advisor_log_append_only before update or delete on public.advisor_log
  for each row execute function public._advisor_log_tolak_ubah();

-- Gerbang: rahasia advisor (Vault advisor_shared_secret) di header.
