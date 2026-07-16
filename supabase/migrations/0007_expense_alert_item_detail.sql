-- ============================================================================
-- MKH Property — 0007: Include item/supplier in the expense-approval sync
-- payload
--
-- The super_admin WhatsApp alert needs to show what was actually bought
-- (item), not just the free-text keterangan. keterangan already carries the
-- destination bank account number as typed by the admin (e.g. "BCA
-- 0600492233 WIBOWO JADHISNO"), so it's kept as-is — MK Connect's
-- sync_inbound now surfaces it as a distinct labeled line instead of folding
-- it into one paragraph.
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
  v_item text;
  v_supplier text;
  v_branch_nama text;
begin
  if new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.tipe in ('bahan', 'tukang')
     and coalesce(new.source_system, '') <> 'mk_connect'
  then
    v_amount := coalesce((new.data ->> 'nominal')::numeric, 0);
    v_desc := coalesce(new.data ->> 'keterangan', new.data ->> 'ketJ', new.tipe);
    v_item := coalesce(new.data ->> 'item', new.data ->> 'tukang_nama');
    v_supplier := new.data ->> 'supplier';
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
        'item', v_item,
        'supplier', v_supplier,
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

comment on function public.pengajuan_expense_approved_sync is
  'Enqueues an outbound finance_expense_approved sync event to MK Connect when an admin-submitted expense (bahan/tukang) is approved, including item/supplier so the WhatsApp alert can show what was bought, not just the free-text note.';
