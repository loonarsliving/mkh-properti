-- ============================================================================
-- MKH Property — 0025: Restore sisa_kontrak/terbayar_baru in the
-- finance_expense_submitted payload
--
-- These fields were present in an earlier version of this trigger
-- (0017/0221's intent on MK Connect's side) but got silently dropped when
-- this function was last recreated for the Syafiq->Vando routing override
-- (0022/0023), since that migration's baseline copy of the function no
-- longer had them. Real-world effect: gaji tukang pengajuan stopped
-- showing the remaining contract balance in the Kepala Cabang WhatsApp
-- alert, even when submitted correctly as tipe='tukang' with
-- data.sisa_kontrak/data.terbayarBaru set.
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

    if new.proyek = 'IH' and new.created_by ilike '%syafiq%' then
      v_branch_nama := 'Jogja';
    end if;

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
        'items', new.data -> 'items',
        'supplier', v_supplier,
        'keterangan', v_desc,
        'admin_email', new.created_by,
        'submitted_at', new.created_at,
        'verification_link', 'https://finance.haluoleo.id/verifikasi.html',
        'sisa_kontrak', new.data ->> 'sisa_kontrak',
        'terbayar_baru', new.data ->> 'terbayarBaru'
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
