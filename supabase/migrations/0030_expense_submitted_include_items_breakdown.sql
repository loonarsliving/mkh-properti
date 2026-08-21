-- ============================================================================
-- MKH Property — 0030: include the per-item breakdown in finance_expense_submitted
--
-- Owner's feedback: Vando's "Pengajuan Baru Menunggu Verifikasi" WhatsApp
-- alert only ever showed one combined item description, even when the
-- pengajuan's data.items already held a real per-line breakdown (nota
-- photos and Anang's own fund requests both populate this array -- see
-- mkh-properti 0028/0029). This trigger simply never forwarded that array
-- to MK Connect. Just adds it to the outbound payload as-is; MK Connect's
-- own sync_inbound (this repo's counterpart) decides how to render it --
-- see MK Connect migration adding itemized rendering to finance_expense_submitted.
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

    -- Syafiq's dedicated Makassar operational-report link routes approval
    -- to Vando (Jogja) instead of Makassar's own Kepala Cabang. Matches
    -- "Syafiq" anywhere in the "Pelapor: <name>" label, not just as a
    -- literal prefix, since his employee record is "Muhammad Syafiq".
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
        'verification_link', 'https://finance.haluoleo.id/verifikasi.html'
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;
