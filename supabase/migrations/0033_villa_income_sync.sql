-- ============================================================================
-- MKH Property — 0033: villa_income_sync RPC (automatic Loonars Villa sync)
--
-- Follow-up to migration 0032 (pendapatan_villa, manual entry). Owner asked
-- to automate the villa side: once a month, the villa system (a separate
-- Supabase project, svcmybsziaelwwdrnzcv) computes that month's rental +
-- walk-in (cafe/spa/lainnya) income via its own villa-api and pushes it here.
--
-- Design choice: a dedicated RPC (`villa_income_sync`), NOT an extension of
-- the existing `sync_inbound` function. `sync_inbound` is documented
-- (DEVELOPMENT_WORKFLOW.md) as production-critical shared infrastructure for
-- MK Connect — "CREATE OR REPLACE needs the full body" and "a bad edit here
-- has broken multiple downstream flows before". Villa is a different
-- external system with a different trust boundary; giving it its own small,
-- independently reviewable function avoids risking that shared code path.
--
-- Auth model, deliberately narrower than sync_inbound's: sync_inbound is
-- restricted to `service_role` (whoever calls it already holds this
-- project's service_role key — a much bigger secret to hand to a second
-- external company's system). This function instead grants EXECUTE to
-- `anon`/`authenticated` (PostgREST's normal RPC path with the already-public
-- anon key) and gates itself internally with its own dedicated shared secret
-- (`villa_sync_shared_secret` in Vault, checked against the `x-villa-sync-secret`
-- request header — same pattern as sync_inbound's own `x-sync-secret` check,
-- just a separate secret so a compromise of one doesn't affect the other).
-- The secret VALUE is set separately via Vault, not committed here — same
-- convention as `mk_sync_shared_secret` (see migration 0001).
--
-- Idempotent by design: idempotency_key = 'villa:<YYYY-MM>:<kategori>', one
-- row per month per kategori in pendapatan_villa (upsert on conflict), so a
-- retried or re-run monthly cron never creates duplicate income lines.
-- ============================================================================

create or replace function public.villa_income_sync(p_periode date, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
  v_item jsonb;
  v_kategori text;
  v_jumlah numeric;
  v_key text;
  v_periode_txt text;
  v_count int := 0;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'villa_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-villa-sync-secret',
    current_setting('request.header.x-villa-sync-secret', true)
  );
  if v_secret is null or v_provided is distinct from v_secret then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_periode is null or extract(day from p_periode) <> 1 then
    raise exception 'p_periode harus tanggal 1 pada bulannya (contoh: 2026-09-01)';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'p_items harus berupa array [{"kategori":"rental","jumlah":123}, ...]';
  end if;

  v_periode_txt := to_char(p_periode, 'YYYY-MM');

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_kategori := v_item ->> 'kategori';
    v_jumlah := coalesce((v_item ->> 'jumlah')::numeric, 0);
    if v_kategori is null or v_kategori not in ('rental', 'cafe', 'spa', 'lainnya') then
      raise exception 'kategori tidak dikenali: %', coalesce(v_kategori, 'null');
    end if;

    v_key := 'villa:' || v_periode_txt || ':' || v_kategori;

    insert into public.pendapatan_villa (periode, kategori, jumlah, sumber, idempotency_key, created_by)
    values (p_periode, v_kategori, v_jumlah, 'villa_api', v_key, 'sync:villa_api')
    on conflict (idempotency_key) where idempotency_key is not null do update
      set jumlah = excluded.jumlah, updated_at = now();

    v_count := v_count + 1;
  end loop;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status, target_ref)
  values ('inbound', 'villa_income_reported', 'pendapatan_villa', v_periode_txt, 'villa:' || v_periode_txt || ':report', p_items, 'succeeded', v_periode_txt)
  on conflict (idempotency_key) do update
    set payload = excluded.payload, status = 'succeeded', last_error = null, updated_at = now();

  return jsonb_build_object('status', 'ok', 'periode', v_periode_txt, 'items_upserted', v_count);
end;
$$;

comment on function public.villa_income_sync(date, jsonb) is
  'Inbound sync target for Loonars Villa monthly income (rental/cafe/spa/lainnya) into pendapatan_villa. Called by villa-api''s own monthly cron (POST /cron/sync-mkh-income), authenticated via x-villa-sync-secret against Vault secret villa_sync_shared_secret — a dedicated secret, separate from MK Connect''s mk_sync_shared_secret. See migration 0032 for why this income is not posted into jurnal.';

revoke all on function public.villa_income_sync(date, jsonb) from public;
grant execute on function public.villa_income_sync(date, jsonb) to anon, authenticated;
