-- ============================================================================
-- MKH Property — 0022: Syafiq's Makassar operational reports route to Jogja's
-- Kepala Cabang (Vando), not Makassar's own
--
-- Owner's explicit ask: Syafiq (Makassar) can submit operational expense
-- reports (lapor-biaya-lain-makassar.html, mirrors Rebecca's Jogja-only
-- lapor-biaya-lain.html -- same "Beban Lain-lain" category only, no upah
-- tukang / pembelian bahan option), but approval still goes to Vando in
-- Jogja rather than whoever (if anyone) is Makassar's own Kepala Cabang.
--
-- pengajuan_expense_submitted_sync (0008) picks the notified branch purely
-- from new.proyek via a hardcoded case statement (IH -> Makassar). This
-- adds one narrow override: only for proyek IH submitted by Syafiq
-- specifically (matched via the "Pelapor: <name>" created_by label the
-- no-login report forms already use), route the Kepala Cabang notification
-- to Jogja instead. Every other IH (Makassar) submission -- from
-- admin-proyek.html, or any other reporter -- keeps the normal Makassar
-- routing untouched.
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
    -- to Vando (Jogja) instead of Makassar's own Kepala Cabang.
    if new.proyek = 'IH' and new.created_by ilike 'Pelapor: Syafiq%' then
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
