-- ============================================================================
-- MKH Property — 0001: Cross-system sync foundation (MKH Property <-> MK Connect)
--
-- This is the first migration ever committed for this project — MKH
-- Property previously had no supabase/migrations directory at all; its 7
-- tables (jurnal, aset, pengajuan, users_proyek, tukang_borongan,
-- bayar_tukang, utang_bank) plus the unused karyawan/slip_gaji/mkh_projects/
-- mkh_counter tables were created directly against the live database. From
-- here on, schema changes for the sync integration are tracked as
-- migrations and applied with `supabase db push` against project ref
-- gluoioiimapyhchdasfl.
--
-- IMPORTANT: gluoioiimapyhchdasfl is a SHARED Supabase project used by
-- several unrelated apps on this account (kos_*, loonars_*, beauty_orders,
-- products/orders/customers, ...). Every object added here is scoped to
-- MKH Property's own tables only.
--
-- Mirrors MK Connect's supabase/migrations/0055_finance_sync_foundation.sql
-- — same outbox/inbox pattern, so keep the two in sync if the mechanism
-- changes.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;

create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('outbound', 'inbound')),
  event_type text not null,
  source_table text not null,
  source_id text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'succeeded', 'failed', 'dead_letter', 'skipped')),
  attempt_count int not null default 0,
  max_attempts int not null default 8,
  last_error text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  request_id bigint,
  target_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key)
);

alter table public.sync_log enable row level security;
-- No policies for anon/authenticated: only service_role (Edge Functions,
-- pg_cron/SECURITY DEFINER functions) can read/write this table, even
-- though this project's other tables use permissive anon/authenticated
-- policies (see the integration report for that pre-existing finding).

create index sync_log_dispatch_idx on public.sync_log (next_attempt_at)
  where direction = 'outbound' and status in ('pending', 'failed');
create index sync_log_collect_idx on public.sync_log (request_id)
  where status = 'sent';

comment on table public.sync_log is
  'Outbound/inbound event log for the MKH Property <-> MK Connect integration. idempotency_key prevents duplicate ledger entries on retry.';

create table public.sync_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.sync_config enable row level security;

comment on table public.sync_config is
  'Non-secret sync configuration (peer Edge Function URL, etc). The shared HMAC secret lives in Supabase Vault (name = mk_sync_shared_secret), never here.';

create or replace function public.get_sync_secret()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
$$;

revoke execute on function public.get_sync_secret() from public, anon, authenticated;
grant execute on function public.get_sync_secret() to service_role;

create or replace function public.sync_dispatch_pending()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_peer_url text;
  v_secret text;
  v_row record;
  v_req_id bigint;
begin
  select value into v_peer_url from public.sync_config where key = 'peer_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';

  if v_peer_url is null or v_secret is null then
    return;
  end if;

  for v_row in
    select *
    from public.sync_log
    where direction = 'outbound'
      and status in ('pending', 'failed')
      and next_attempt_at <= now()
      and attempt_count < max_attempts
    order by created_at
    limit 25
  loop
    select net.http_post(
      url := v_peer_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'X-Sync-Secret', v_secret),
      body := jsonb_build_object(
        'sync_log_id', v_row.id,
        'idempotency_key', v_row.idempotency_key,
        'event_type', v_row.event_type,
        'source_system', 'mkh_property',
        'created_at', v_row.created_at,
        'payload', v_row.payload
      ),
      timeout_milliseconds := 8000
    ) into v_req_id;

    update public.sync_log
      set status = 'sent',
          attempt_count = attempt_count + 1,
          last_attempt_at = now(),
          request_id = v_req_id,
          updated_at = now()
      where id = v_row.id;
  end loop;
end;
$$;

comment on function public.sync_dispatch_pending is
  'Sends due outbound sync_log rows to MK Connect via pg_net. Scheduled every minute by pg_cron.';

create or replace function public.sync_collect_responses()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row record;
  v_resp record;
begin
  for v_row in select * from public.sync_log where status = 'sent' and request_id is not null
  loop
    select * into v_resp from net._http_response where id = v_row.request_id;

    if not found then
      continue;
    end if;

    if v_resp.status_code between 200 and 299 then
      update public.sync_log
        set status = 'succeeded',
            target_ref = nullif(v_resp.content::jsonb ->> 'target_ref', ''),
            last_error = null,
            updated_at = now()
        where id = v_row.id;
    else
      update public.sync_log
        set status = case when attempt_count >= max_attempts then 'dead_letter' else 'failed' end,
            last_error = left(coalesce(v_resp.content, 'HTTP ' || v_resp.status_code::text), 2000),
            next_attempt_at = now() + (power(2, least(attempt_count, 6)) * interval '1 minute'),
            updated_at = now()
        where id = v_row.id;
    end if;
  end loop;

  update public.sync_log
    set status = case when attempt_count >= max_attempts then 'dead_letter' else 'failed' end,
        last_error = 'no response received (timeout)',
        next_attempt_at = now() + (power(2, least(attempt_count, 6)) * interval '1 minute'),
        updated_at = now()
    where status = 'sent'
      and last_attempt_at < now() - interval '5 minutes';
end;
$$;

comment on function public.sync_collect_responses is
  'Collects pg_net responses for sent sync_log rows and retries/dead-letters failures. Scheduled every minute by pg_cron.';

select cron.schedule('sync-dispatch-pending', '*/1 * * * *', $$select public.sync_dispatch_pending()$$);
select cron.schedule('sync-collect-responses', '*/1 * * * *', $$select public.sync_collect_responses()$$);
