-- ============================================================================
-- MKH Property — 0006: Expense-approval WhatsApp alert + branch cash balance
-- sync (outbound half)
--
-- Two new outbound event types riding the existing sync_log/sync_dispatch_
-- pending pipeline from 0001_sync_foundation.sql — no new transport, just new
-- triggers that enqueue rows the way 0002's crm_payment_receipts trigger
-- already does.
--
-- 1. finance_expense_approved: fired when an admin-submitted pengajuan
--    (tipe 'bahan' or 'tukang' — the two types a human actually submits from
--    admin-proyek.html; the five HR/CRM sync-originated tipe values are
--    already reported to MK Connect by their own originating flow, so they
--    are excluded here to avoid a redundant alert) is approved by a manager/
--    verifikator. MK Connect's sync_inbound RPC turns this into a WhatsApp
--    notification to every super_admin.
--
-- 2. finance_branch_balance_updated: fired on every jurnal change that
--    touches one of the branch cash/bank accounts, recomputing that branch's
--    total cash position with the exact same formula the Finance Dashboard
--    itself uses (index.html branchSaldo(): sum over the branch's projects
--    of that project's dedicated bank account + the one shared Kas Tunai
--    account). MK Connect stores this in finance_branch_balances for the
--    Kepala Cabang dashboard widget and the AI balance-threshold advisory.
-- ============================================================================

create or replace function public.pengajuan_expense_approved_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric;
  v_desc text;
  v_branch_nama text;
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.tipe in ('bahan', 'tukang')
     and coalesce(new.source_system, '') <> 'mk_connect'
  then
    v_amount := coalesce((new.data ->> 'nominal')::numeric, 0);
    v_desc := coalesce(new.data ->> 'keterangan', new.data ->> 'ketJ', new.tipe);
    v_branch_nama := coalesce(new.data ->> 'proyek_nama', new.proyek);

    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'finance_expense_approved', 'pengajuan', new.id::text,
      'expense-approved-' || new.id,
      jsonb_build_object(
        'pengajuan_id', new.id,
        'tipe', new.tipe,
        'proyek', new.proyek,
        'proyek_nama', v_branch_nama,
        'nominal', v_amount,
        'keterangan', v_desc,
        'admin_email', new.created_by,
        'approved_by', new.verified_by,
        'approved_at', new.updated_at
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_pengajuan_expense_approved_sync
after update on public.pengajuan
for each row execute function public.pengajuan_expense_approved_sync();

comment on function public.pengajuan_expense_approved_sync is
  'Enqueues an outbound finance_expense_approved sync event to MK Connect when an admin-submitted expense (bahan/tukang) is approved, so every super_admin gets a WhatsApp reminder.';

-- ----------------------------------------------------------------------------
-- Branch cash balance sync
-- ----------------------------------------------------------------------------
create or replace function public.jurnal_branch_balance_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proyek text := coalesce(new.proyek, old.proyek);
  v_branch_code text;
  v_branch_nama text;
  v_proyek_ids text[];
  v_saldo numeric := 0;
  v_kas_tunai numeric;
  v_bank_akun text;
begin
  v_branch_code := case v_proyek
    when 'AFP' then 'KDI'
    when 'IH'  then 'MKS'
    when 'LL'  then 'JOG'
    when 'GCI' then 'JBD'
    when 'GCR' then 'JBD'
    else null
  end;
  if v_branch_code is null then
    return coalesce(new, old);
  end if;

  v_branch_nama := case v_branch_code
    when 'KDI' then 'Kendari'
    when 'MKS' then 'Makassar'
    when 'JOG' then 'Jogja'
    when 'JBD' then 'Jabodetabek'
  end;
  v_proyek_ids := case v_branch_code
    when 'KDI' then array['AFP']
    when 'MKS' then array['IH']
    when 'JOG' then array['LL']
    when 'JBD' then array['GCI', 'GCR']
  end;

  select coalesce(sum(d), 0) - coalesce(sum(k), 0) into v_kas_tunai
  from public.jurnal where akun = '1-1001';

  for v_bank_akun in select unnest(array_agg(
    case p
      when 'AFP' then '1-1002' when 'IH' then '1-1003' when 'LL' then '1-1004'
      when 'GCI' then '1-1005' when 'GCR' then '1-1008'
    end
  )) from unnest(v_proyek_ids) as p
  loop
    v_saldo := v_saldo + v_kas_tunai
      + (select coalesce(sum(d), 0) - coalesce(sum(k), 0) from public.jurnal where akun = v_bank_akun);
  end loop;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
  values (
    'outbound', 'finance_branch_balance_updated', 'jurnal', coalesce(new.id, old.id)::text,
    'branch-balance-' || v_branch_code || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
    jsonb_build_object(
      'branch_code', v_branch_code,
      'branch_name', v_branch_nama,
      'saldo', v_saldo,
      'as_of', now()
    )
  )
  on conflict (idempotency_key) do nothing;

  return coalesce(new, old);
end;
$$;

create trigger trg_jurnal_branch_balance_sync
after insert or update or delete on public.jurnal
for each row execute function public.jurnal_branch_balance_sync();

comment on function public.jurnal_branch_balance_sync is
  'Recomputes and pushes the affected branch total cash position to MK Connect (finance_branch_balances) on every jurnal change, using the same formula as the Finance Dashboard (index.html branchSaldo()).';

-- Seed an immediate sync for the 4 branches' current balance so MK Connect's
-- Kepala Cabang widget has data right away instead of waiting for the next
-- organic jurnal write.
insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
select 'outbound', 'finance_branch_balance_updated', 'jurnal', 'seed-' || code,
  'branch-balance-seed-' || code || '-' || to_char(now(), 'YYYYMMDDHH24MISS'),
  jsonb_build_object('branch_code', code, 'branch_name', nama, 'saldo', saldo, 'as_of', now())
from (
  select 'KDI' as code, 'Kendari' as nama,
    (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1002')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1001') as saldo
  union all
  select 'MKS', 'Makassar',
    (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1003')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1001')
  union all
  select 'JOG', 'Jogja',
    (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1004')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1001')
  union all
  select 'JBD', 'Jabodetabek',
    (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1005')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1001')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1008')
    + (select coalesce(sum(d),0)-coalesce(sum(k),0) from public.jurnal where akun='1-1001')
) b;
