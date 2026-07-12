-- ============================================================================
-- MKH Property — 0004: point sync_dispatch_pending at the RPC-based receiver
--
-- Mirrors MK Connect's 0059_sync_dispatch_rpc_target.sql.
-- ============================================================================

create or replace function public.sync_dispatch_pending()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_peer_url text;
  v_peer_anon_key text;
  v_secret text;
  v_row record;
  v_req_id bigint;
begin
  select value into v_peer_url from public.sync_config where key = 'peer_sync_url';
  select value into v_peer_anon_key from public.sync_config where key = 'peer_anon_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';

  if v_peer_url is null or v_peer_anon_key is null or v_secret is null then
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_peer_anon_key,
        'Authorization', 'Bearer ' || v_peer_anon_key,
        'X-Sync-Secret', v_secret
      ),
      body := jsonb_build_object(
        'p_idempotency_key', v_row.idempotency_key,
        'p_event_type', v_row.event_type,
        'p_payload', v_row.payload
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
