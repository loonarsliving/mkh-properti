-- ============================================================================
-- MKH Property — 0008: Notify Kepala Cabang on submission (before approval)
--
-- New outbound event, finance_expense_submitted, fired the moment an admin
-- submits a pengajuan (bahan/tukang -- same two types 0006/0007 already
-- track), not just when it's approved. MK Connect turns this into a
-- WhatsApp alert to that branch's Kepala Cabang, including a direct link
-- to verifikasi.html so they can act on it immediately from the WhatsApp
-- message instead of remembering to open the app separately. The existing
-- finance_expense_approved event (fired when the Kepala Cabang actually
-- approves it in verifikasi.html) is untouched -- that's what notifies
-- super_admin, completing the two-stage flow: admin submits -> Kepala
-- Cabang verifies -> super_admin informed.
--
-- Branch-code mapping mirrors jurnal_branch_balance_sync (0006) exactly:
-- AFP->Kendari, IH->Makassar, LL->Jogja, GCI/GCR->Jabodetabek.
-- ============================================================================

create or replace function public.pengajuan_expense_submitted_sync()
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
  v_branch_code text;
  v_branch_nama text;
begin
  if new.tipe in ('bahan', 'tukang')
     and new.status = 'pending'
     and coalesce(new.source_system, '') <> 'mk_connect'
  then
    v_amount := coalesce((new.data ->> 'nominal')::numeric, 0);
    v_desc := coalesce(new.data ->> 'keterangan', new.data ->> 'ketJ', new.tipe);
    v_item := coalesce(new.data ->> 'item', new.data ->> 'tukang_nama');
    v_supplier := new.data ->> 'supplier';

    v_branch_code := case new.proyek
      when 'AFP' then 'KDI'
      when 'IH'  then 'MKS'
      when 'LL'  then 'JOG'
      when 'GCI' then 'JBD'
      when 'GCR' then 'JBD'
      else null
    end;
    v_branch_nama := case v_branch_code
      when 'KDI' then 'Kendari'
      when 'MKS' then 'Makassar'
      when 'JOG' then 'Jogja'
      when 'JBD' then 'Jabodetabek'
      else coalesce(new.data ->> 'proyek_nama', new.proyek)
    end;

    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'finance_expense_submitted', 'pengajuan', new.id::text,
      'expense-submitted-' || new.id,
      jsonb_build_object(
        'pengajuan_id', new.id,
        'tipe', new.tipe,
        'proyek', new.proyek,
        'proyek_nama', coalesce(new.data ->> 'proyek_nama', new.proyek),
        'branch_name', v_branch_nama,
        'nominal', v_amount,
        'item', v_item,
        'supplier', v_supplier,
        'keterangan', v_desc,
        'admin_email', new.created_by,
        'submitted_at', new.created_at,
        'verification_link', 'https://finance.haluoleo.id/verifikasi.html'
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger trg_pengajuan_expense_submitted_sync
after insert on public.pengajuan
for each row execute function public.pengajuan_expense_submitted_sync();

comment on function public.pengajuan_expense_submitted_sync is
  'Enqueues an outbound finance_expense_submitted sync event to MK Connect the moment an admin submits an expense (bahan/tukang), so that branch''s Kepala Cabang gets a WhatsApp alert with the verifikasi.html link -- before it reaches super_admin on approval.';
