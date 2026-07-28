-- ============================================================================
-- MKH Property — 0014: fee-claim approval moves fully to CFO (verifikasi.html)
--
-- Previously there were two separate human approvals for one decision:
--   1. Sales claims fee -> loonars_fee (pending) -> owner approves in
--      loonars-sales (PATCH loonars_fee.status='approved').
--   2. ONLY THEN does a pengajuan(tipe='komisi', pending) row get created,
--      for CFO to approve a second time on /verifikasi.html.
--
-- Now: the pengajuan(komisi) row is created the moment the fee is claimed
-- (same trigger that already fires the loonars_fee_submitted WhatsApp alert
-- to every super_admin), so CFO approval on /verifikasi.html IS the only
-- approval gate. There's no more owner-approval step in loonars-sales.
--
-- Approving/rejecting the pengajuan mirrors the decision back onto
-- loonars_fee and re-enqueues the same outbound sync-to-MK-Connect that used
-- to fire from the (now-removed) loonars_fee UPDATE trigger, plus a new
-- loonars_fee_decided event so MK Connect sends a WhatsApp alert to every
-- super_admin on the outcome (replacing the CFO page's old Telegram message
-- for this event specifically).
-- ============================================================================

create or replace function public.loonars_fee_submitted_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' then
    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'loonars_fee_submitted', 'loonars_fee', new.id::text,
      'loonars-fee-submitted-' || new.id,
      jsonb_build_object(
        'fee_id', new.id,
        'proyek', new.proyek,
        'unit', new.unit,
        'buyer', new.buyer,
        'marketing', new.marketing,
        'phone', new.phone,
        'price', new.price,
        'fee_amount', new.fee_amount,
        'tipe', new.type,
        'tgl', new.date
      )
    )
    on conflict (idempotency_key) do nothing;

    insert into public.pengajuan (proyek, tipe, data, status, created_by, source_system, idempotency_key)
    values (
      new.proyek, 'komisi',
      jsonb_build_object(
        'fee_id', new.id,
        'nominal', coalesce(new.fee_amount, 0),
        'keterangan', 'Fee marketing — Unit ' || coalesce(new.unit, '-') || ' — ' || coalesce(new.buyer, '-'),
        'unit', new.unit,
        'buyer', new.buyer,
        'marketing', new.marketing,
        'phone', new.phone,
        'tgl', coalesce(new.date, current_date::text)
      ),
      'pending', 'sync:loonars_fee', 'loonars_sales',
      'loonars-fee-pengajuan-' || new.id
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.loonars_fee_submitted_sync is
  'On fee claim: alerts every super_admin via WhatsApp (loonars_fee_submitted) and immediately enters the fee into the CFO approval queue (pengajuan, tipe=komisi) -- approving/rejecting it on /verifikasi.html is now the only approval gate for a loonars fee claim.';

-- Approval no longer happens via an UPDATE on loonars_fee (the old owner
-- step in loonars-sales) -- replaced by pengajuan_komisi_decided_sync below.
drop trigger if exists trg_loonars_fee_approved_sync on public.loonars_fee;
drop function if exists public.loonars_fee_approved_sync();

create or replace function public.pengajuan_komisi_decided_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_id bigint;
  v_fee public.loonars_fee%rowtype;
begin
  if new.tipe <> 'komisi' or new.status = old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;

  v_fee_id := nullif(new.data ->> 'fee_id', '')::bigint;
  if v_fee_id is null then
    return new;
  end if;

  update public.loonars_fee set status = new.status where id = v_fee_id
  returning * into v_fee;
  if not found then
    return new;
  end if;

  if new.status = 'approved' then
    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'loonars_closing_approved', 'loonars_fee', v_fee.id::text,
      'loonars-closing-approved-' || v_fee.id,
      jsonb_build_object(
        'fee_id', v_fee.id,
        'pengajuan_id', new.id,
        'proyek', v_fee.proyek,
        'unit', v_fee.unit,
        'buyer', v_fee.buyer,
        'marketing', v_fee.marketing,
        'phone', v_fee.phone,
        'price', v_fee.price,
        'fee_amount', v_fee.fee_amount,
        'tipe', v_fee.type,
        'tgl', coalesce(v_fee.date, current_date::text)
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
  values (
    'outbound', 'loonars_fee_decided', 'loonars_fee', v_fee.id::text,
    'loonars-fee-decided-' || v_fee.id,
    jsonb_build_object(
      'fee_id', v_fee.id,
      'unit', v_fee.unit,
      'buyer', v_fee.buyer,
      'marketing', v_fee.marketing,
      'fee_amount', v_fee.fee_amount,
      'proyek', v_fee.proyek,
      'status', new.status,
      'verified_by', new.verified_by
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_pengajuan_komisi_decided_sync on public.pengajuan;
create trigger trg_pengajuan_komisi_decided_sync
after update on public.pengajuan
for each row execute function public.pengajuan_komisi_decided_sync();

comment on function public.pengajuan_komisi_decided_sync is
  'When CFO approves/rejects a komisi pengajuan (the loonars fee claim queue on /verifikasi.html), mirrors the decision onto loonars_fee and enqueues loonars_closing_approved (approved only -- MK Connect matches the marketing to a sales employee for target tracking) plus loonars_fee_decided (both outcomes -- MK Connect alerts every super_admin via WhatsApp).';
