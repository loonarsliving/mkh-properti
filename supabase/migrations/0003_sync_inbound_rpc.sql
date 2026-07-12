-- ============================================================================
-- MKH Property — 0003: sync_inbound RPC (replaces the sync-inbound Edge
-- Function as the receiving endpoint)
--
-- Same reasoning as MK Connect's 0058_sync_inbound_rpc.sql: this session's
-- Edge Function deployment tooling was unavailable, so the receiver is a
-- PostgREST-callable RPC function instead — no separate deploy step, ships
-- with the migration. supabase/functions/sync-inbound/index.ts is kept as
-- the Edge-Function-based equivalent for later; sync_config.peer_sync_url
-- for MK Connect points at this RPC (…/rest/v1/rpc/sync_inbound), which is
-- what is actually live.
-- ============================================================================

create or replace function public.sync_inbound(p_idempotency_key text, p_event_type text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
  v_sync_log_id uuid;
  v_target_ref text;
  v_proyek text;
  v_payment_type text;
  v_amount numeric;
  v_tgl date;
  v_no text;
  v_no_num bigint;
  v_ket text;
  v_cash_akun text;
  v_cash_nama text;
  v_rev_akun text;
  v_rev_nama text;
  v_rekening text;
  v_bank text;
  v_tipe text;
  v_nominal numeric;
  v_pengajuan_id bigint;
  v_data jsonb;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  -- PostgREST (v10+, current on Supabase) exposes request headers as the
  -- single JSON GUC `request.headers`, not the older per-header
  -- `request.header.<name>` convention; keep both so this degrades
  -- gracefully if that ever changes again.
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-sync-secret',
    current_setting('request.header.x-sync-secret', true)
  );
  if v_secret is null or v_provided is distinct from v_secret then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status)
  values ('inbound', p_event_type, 'mk_connect', gen_random_uuid()::text, p_idempotency_key, p_payload, 'sent')
  on conflict (idempotency_key) do nothing
  returning id into v_sync_log_id;

  if v_sync_log_id is null then
    select target_ref into v_target_ref from public.sync_log where idempotency_key = p_idempotency_key;
    return jsonb_build_object('status', 'duplicate', 'target_ref', v_target_ref);
  end if;

  begin
    if p_event_type = 'crm_payment_approved' then
      v_proyek := nullif(p_payload ->> 'mkh_project_code', '');
      if v_proyek is null then
        raise exception 'Unmapped CRM project "%": set crm_projects.mkh_project_code in MK Connect before this payment can sync.',
          p_payload ->> 'project_name';
      end if;

      v_payment_type := coalesce(p_payload ->> 'payment_type', 'dp');
      if v_payment_type = 'bank_disbursement' then
        v_rev_akun := '4-1001'; v_rev_nama := 'Penjualan Rumah';
      else
        v_rev_akun := '4-1002'; v_rev_nama := 'Uang Muka Penjualan';
      end if;

      v_amount := coalesce((p_payload ->> 'amount')::numeric, 0);
      v_tgl := coalesce((p_payload ->> 'payment_date')::date, current_date);

      select public.next_mkh_no('KM') into v_no_num;
      v_no := 'KM-' || lpad(v_no_num::text, 3, '0');

      select rekening, bank into v_rekening, v_bank from public.mkh_projects where kode = v_proyek;
      if v_rekening is not null and v_rekening <> '' then
        v_cash_akun := v_rekening;
        v_cash_nama := trim(both from ('Bank ' || coalesce(v_bank, '')));
      else
        v_cash_akun := '1-1001';
        v_cash_nama := 'Kas Tunai';
      end if;

      v_ket := 'Sinkronisasi CRM: ' || coalesce(p_payload ->> 'customer_name', '-') || ' - ' || coalesce(p_payload ->> 'project_name', '-')
        || case when p_payload ->> 'unit_label' is not null then ' Unit ' || (p_payload ->> 'unit_label') else '' end
        || ' (' || v_payment_type || ') - Sales: ' || coalesce(p_payload ->> 'sales_name', '-')
        || ' - Cabang: ' || coalesce(p_payload ->> 'branch_name', '-')
        || case when p_payload ->> 'reference_number' is not null then ' - Ref: ' || (p_payload ->> 'reference_number') else '' end;

      insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
        (v_tgl, v_no, v_ket, v_cash_akun, v_cash_nama, v_proyek, v_amount, 0, p_idempotency_key || ':d', 'mk_connect', p_payload ->> 'prospect_payment_id'),
        (v_tgl, v_no, v_ket, v_rev_akun, v_rev_nama, v_proyek, 0, v_amount, p_idempotency_key || ':k', 'mk_connect', p_payload ->> 'prospect_payment_id');

      insert into public.crm_payment_receipts (
        mkc_payment_id, mkc_prospect_id, proyek, customer_name, project_name, unit_label,
        payment_type, amount, payment_date, reference_number, sales_name, branch_name, jurnal_no, idempotency_key
      ) values (
        (p_payload ->> 'prospect_payment_id')::uuid, nullif(p_payload ->> 'prospect_id', '')::uuid, v_proyek,
        p_payload ->> 'customer_name', p_payload ->> 'project_name', p_payload ->> 'unit_label',
        v_payment_type, v_amount, v_tgl, p_payload ->> 'reference_number', p_payload ->> 'sales_name', p_payload ->> 'branch_name',
        v_no, p_idempotency_key
      );

      v_target_ref := v_no;

    elsif p_event_type = 'payroll_run_approved' then
      -- Informational only; payroll_salary_generated (one per employee) is
      -- what actually creates an expense record.
      v_target_ref := null;

    elsif p_event_type in ('sales_commission_approved', 'payroll_salary_generated', 'bonus_approved', 'reimbursement_approved', 'hr_expense_approved') then
      v_tipe := case p_event_type
        when 'sales_commission_approved' then 'komisi'
        when 'payroll_salary_generated' then 'gaji'
        when 'bonus_approved' then 'bonus'
        when 'reimbursement_approved' then 'reimbursement'
        else 'hr_lain'
      end;
      v_proyek := coalesce(nullif(p_payload ->> 'mkh_project_code', ''), 'HO');
      v_nominal := case p_event_type
        when 'sales_commission_approved' then coalesce((p_payload ->> 'commission_amount')::numeric, 0)
        when 'payroll_salary_generated' then coalesce((p_payload ->> 'net_salary')::numeric, 0)
        else coalesce((p_payload ->> 'amount')::numeric, 0)
      end;

      v_data := jsonb_build_object(
        'source', 'mk_connect',
        'nominal', v_nominal,
        'tgl', coalesce(p_payload ->> 'payment_date', p_payload ->> 'expense_date', to_char(current_date, 'YYYY-MM-DD')),
        'proyek_nama', case when v_proyek = 'HO' then 'Kantor Pusat / Overhead' else v_proyek end,
        'employee_name', p_payload ->> 'employee_name',
        'employee_code', p_payload ->> 'employee_code',
        'mkc_employee_id', p_payload ->> 'employee_id',
        'sales_name', p_payload ->> 'sales_name',
        'branch_name', p_payload ->> 'branch_name',
        'period_month', p_payload -> 'period_month',
        'period_year', p_payload -> 'period_year',
        'base_salary', p_payload -> 'base_salary',
        'description', p_payload ->> 'description'
      );

      insert into public.pengajuan (proyek, tipe, data, status, created_by, source_system, idempotency_key)
      values (v_proyek, v_tipe, v_data, 'pending', 'sync:mk_connect', 'mk_connect', p_idempotency_key)
      returning id into v_pengajuan_id;

      v_target_ref := v_pengajuan_id::text;

    else
      update public.sync_log set status = 'skipped', last_error = 'Unknown event_type: ' || p_event_type, updated_at = now()
        where id = v_sync_log_id;
      return jsonb_build_object('status', 'skipped');
    end if;

    update public.sync_log set status = 'succeeded', target_ref = v_target_ref, updated_at = now() where id = v_sync_log_id;
    return jsonb_build_object('status', 'ok', 'target_ref', v_target_ref);
  exception when others then
    update public.sync_log set status = 'failed', last_error = left(sqlerrm, 2000), updated_at = now() where id = v_sync_log_id;
    raise;
  end;
end;
$$;

grant execute on function public.sync_inbound(text, text, jsonb) to anon, authenticated;

comment on function public.sync_inbound is
  'PostgREST-callable receiver for MK Connect -> MKH Property sync events (CRM payments, payroll, commission, bonus, reimbursement, HR expenses). Authenticated via X-Sync-Secret header against Supabase Vault, not JWT.';
