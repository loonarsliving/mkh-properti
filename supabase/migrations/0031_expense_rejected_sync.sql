-- ============================================================================
-- MKH Property — 0031: Sync pengajuan rejection to MK Connect
--
-- 0006 added an outbound finance_expense_approved event when a bahan/tukang
-- pengajuan is approved, but nothing symmetric fires on rejection -- MK
-- Connect has no way to tell "still awaiting a decision" apart from
-- "already rejected" for anything it notified a Kepala Cabang about. This
-- is what makes a safe stale-verification reminder possible on MK Connect's
-- side (a migration there, this session): without a rejection signal, a
-- rejected pengajuan would look identical to a silently-missed one and get
-- reminded forever.
-- ============================================================================

create or replace function public.pengajuan_expense_rejected_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'rejected'
     and old.status is distinct from 'rejected'
     and new.tipe in ('bahan', 'tukang')
     and coalesce(new.source_system, '') <> 'mk_connect'
  then
    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'finance_expense_rejected', 'pengajuan', new.id::text,
      'expense-rejected-' || new.id,
      jsonb_build_object(
        'pengajuan_id', new.id,
        'tipe', new.tipe,
        'proyek', new.proyek,
        'admin_email', new.created_by,
        'rejected_by', new.verified_by,
        'rejected_at', new.updated_at
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_pengajuan_expense_rejected_sync
after update on public.pengajuan
for each row execute function public.pengajuan_expense_rejected_sync();

comment on function public.pengajuan_expense_rejected_sync is
  'Enqueues an outbound finance_expense_rejected sync event to MK Connect when an admin-submitted expense (bahan/tukang) is rejected, so MK Connect can distinguish a decided pengajuan from one whose verification notification silently never arrived.';
