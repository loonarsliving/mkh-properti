-- ============================================================================
-- MKH Property — 0009: loonars_fee integration (outbound half)
--
-- loonars-sales (the villa siteplan app, "PT. Loonars Living") already
-- shares this Supabase project and already writes cash-in journal entries
-- directly to `jurnal` when a unit is closed (see saveUnitDB() in that
-- repo's index.html) — that path is untouched here, no double-booking.
--
-- This migration wires the *fee/commission* side of a closing into the
-- existing sync_log/sync_dispatch_pending pipeline from
-- 0001_sync_foundation.sql, the same way 0006's expense-approval alert does:
--
-- 1. loonars_fee_submitted   -> fired when a marketing rep submits a fee
--    request (loonars_fee INSERT, status='pending'). MK Connect turns this
--    into a WhatsApp alert to every super_admin.
-- 2. loonars_closing_approved -> fired when the owner approves the fee in
--    loonars-sales (loonars_fee UPDATE, status -> 'approved'). Also, in the
--    same transaction, inserts a `pengajuan` (tipe='komisi', status=
--    'pending') so the fee enters MKH Property's normal CFO-approval queue
--    — no separate client call needed. MK Connect uses the event to match
--    the marketing's phone number to a sales employee and mark their
--    closing against the sales target.
--
-- No new secret/endpoint: rides the existing Vault secret
-- (mk_sync_shared_secret) and sync_dispatch_pending() cron already
-- scheduled every minute.
-- ============================================================================

alter table public.loonars_fee
  add column if not exists phone text,
  add column if not exists fee_amount numeric;

comment on column public.loonars_fee.phone is
  'Marketing rep phone number, required at fee-submission time in loonars-sales. Used by MK Connect to match the sales employee for target/commission tracking.';
comment on column public.loonars_fee.fee_amount is
  'Nominal fee/commission requested by the marketing rep (distinct from `price`, which is the unit sale price).';

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
  end if;
  return new;
end;
$$;

create trigger trg_loonars_fee_submitted_sync
after insert on public.loonars_fee
for each row execute function public.loonars_fee_submitted_sync();

comment on function public.loonars_fee_submitted_sync is
  'Enqueues an outbound loonars_fee_submitted sync event to MK Connect when a marketing rep submits a fee request, so every super_admin gets a WhatsApp alert.';

create or replace function public.loonars_fee_approved_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pengajuan_id bigint;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then

    insert into public.pengajuan (proyek, tipe, data, status, created_by, source_system, idempotency_key)
    values (
      new.proyek, 'komisi',
      jsonb_build_object(
        'nominal', coalesce(new.fee_amount, 0),
        'keterangan', 'Fee marketing — Unit ' || coalesce(new.unit, '-') || ' — ' || coalesce(new.buyer, '-'),
        'unit', new.unit,
        'buyer', new.buyer,
        'marketing', new.marketing,
        'phone', new.phone,
        'tgl', coalesce(new.date, current_date::text)
      ),
      'pending', 'sync:loonars_fee', 'loonars_sales',
      'loonars-fee-expense-' || new.id
    )
    on conflict (idempotency_key) do nothing
    returning id into v_pengajuan_id;

    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'loonars_closing_approved', 'loonars_fee', new.id::text,
      'loonars-closing-approved-' || new.id,
      jsonb_build_object(
        'fee_id', new.id,
        'pengajuan_id', v_pengajuan_id,
        'proyek', new.proyek,
        'unit', new.unit,
        'buyer', new.buyer,
        'marketing', new.marketing,
        'phone', new.phone,
        'price', new.price,
        'fee_amount', new.fee_amount,
        'tipe', new.type,
        'tgl', coalesce(new.date, current_date::text)
      )
    )
    on conflict (idempotency_key) do nothing;

  end if;
  return new;
end;
$$;

create trigger trg_loonars_fee_approved_sync
after update on public.loonars_fee
for each row execute function public.loonars_fee_approved_sync();

comment on function public.loonars_fee_approved_sync is
  'On fee approval: inserts a pending pengajuan (komisi) into the normal CFO-approval queue, and enqueues an outbound loonars_closing_approved sync event so MK Connect can match the marketing''s phone to a sales employee and reduce their target.';
