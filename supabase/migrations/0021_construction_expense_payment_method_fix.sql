-- Companion to mkhsistem's 0226: construction_expense_submitted's jurnal
-- posting ignored payment_method entirely (credit side was always either
-- Kas Tunai for gaji_tukang or Utang Toko Bangunan for everything else),
-- so a cash material purchase got posted as unpaid debt. mkhsistem's
-- trigger now derives the correct debit/credit account itself and sends
-- it in the payload (debit_akun/debit_nama/credit_akun/credit_nama) --
-- this branch uses those when present, falling back to the old hardcoded
-- logic only for events already queued before mkhsistem's fix deploys.
--
-- CREATE OR REPLACE below is the full live definition of sync_inbound as
-- of migration 0020, with only the construction_expense_submitted branch
-- changed. Every other branch is copied verbatim.

create or replace function public.sync_inbound(p_idempotency_key text, p_event_type text, p_payload jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
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
  v_aset_id bigint;
  v_price numeric;
  v_fee_id bigint;
  v_fee public.loonars_fee%rowtype;
  v_debit_akun text;
  v_debit_nama text;
  v_credit_akun text;
  v_credit_nama text;
  v_pay public.pengajuan%rowtype;
  v_pdata jsonb;
  v_tukang_id integer;
  v_tb_id integer;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
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
        'department_name', p_payload ->> 'department_name',
        'period_month', p_payload -> 'period_month',
        'period_year', p_payload -> 'period_year',
        'base_salary', p_payload -> 'base_salary',
        'description', p_payload ->> 'description'
      );

      insert into public.pengajuan (proyek, tipe, data, status, created_by, source_system, idempotency_key)
      values (v_proyek, v_tipe, v_data, 'pending', 'sync:mk_connect', 'mk_connect', p_idempotency_key)
      returning id into v_pengajuan_id;

      v_target_ref := v_pengajuan_id::text;

    elsif p_event_type = 'construction_expense_submitted' then
      v_proyek := coalesce(nullif(p_payload ->> 'mkh_project_code', ''), 'KDI');
      v_nominal := coalesce((p_payload ->> 'amount')::numeric, 0);
      v_tgl := coalesce((p_payload ->> 'expense_date')::date, current_date);

      if p_payload ? 'debit_akun' then
        v_debit_akun := p_payload ->> 'debit_akun';
        v_debit_nama := p_payload ->> 'debit_nama';
        v_credit_akun := p_payload ->> 'credit_akun';
        v_credit_nama := p_payload ->> 'credit_nama';
      elsif p_payload ->> 'expense_type' = 'gaji_tukang' then
        v_debit_akun := '5-1003'; v_debit_nama := 'Biaya Upah Tukang';
        v_credit_akun := '1-1001'; v_credit_nama := 'Kas Tunai';
      else
        v_debit_akun := '5-1001'; v_debit_nama := 'Pembelian Material';
        v_credit_akun := '2-1003'; v_credit_nama := 'Utang Toko Bangunan';
      end if;

      select public.next_mkh_no('KDI') into v_no_num;
      v_no := 'KDI-' || lpad(v_no_num::text, 3, '0');

      v_ket := 'Sinkronisasi MK Connect: ' || coalesce(p_payload ->> 'party_name', '-')
        || case when coalesce(p_payload ->> 'description', '') <> '' then ' - ' || (p_payload ->> 'description') else '' end
        || ' - Cabang: ' || coalesce(p_payload ->> 'branch_name', '-')
        || ' - Input oleh: ' || coalesce(p_payload ->> 'created_by_name', '-');

      insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
        (v_tgl, v_no, v_ket, v_debit_akun, v_debit_nama, v_proyek, v_nominal, 0, p_idempotency_key || ':d', 'mk_connect', p_payload ->> 'construction_expense_id'),
        (v_tgl, v_no, v_ket, v_credit_akun, v_credit_nama, v_proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', p_payload ->> 'construction_expense_id');

      v_target_ref := v_no;

    elsif p_event_type = 'construction_fund_transfer_recorded' then
      v_proyek := nullif(p_payload ->> 'mkh_project_code', '');
      if v_proyek is null then
        raise exception 'Unmapped branch for construction fund transfer -- set branches.mkh_project_code in MK Connect first';
      end if;
      v_nominal := coalesce((p_payload ->> 'amount')::numeric, 0);
      v_tgl := coalesce((p_payload ->> 'transfer_date')::date, current_date);

      select public.next_mkh_no(v_proyek) into v_no_num;
      v_no := v_proyek || '-' || lpad(v_no_num::text, 3, '0');

      v_ket := 'Dana masuk proyek ' || coalesce(p_payload ->> 'project_name', '-') || ' (dari Kantor Pusat)'
        || ' - Cabang: ' || coalesce(p_payload ->> 'branch_name', '-')
        || ' - Input oleh: ' || coalesce(p_payload ->> 'created_by_name', '-')
        || case when coalesce(p_payload ->> 'note', '') <> '' then ' - ' || (p_payload ->> 'note') else '' end;

      insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
        (v_tgl, v_no, v_ket, '1-1001', 'Kas Tunai', v_proyek, v_nominal, 0, p_idempotency_key || ':d', 'mk_connect', p_payload ->> 'construction_fund_transfer_id'),
        (v_tgl, v_no, v_ket, '3-1001', 'Modal dari Kantor Pusat', v_proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', p_payload ->> 'construction_fund_transfer_id');

      v_target_ref := v_no;

    elsif p_event_type = 'finance_expense_transfer_confirmed' then
      select * into v_pay from public.pengajuan where id = (p_payload ->> 'pengajuan_id')::bigint for update;
      if not found then
        raise exception 'pengajuan % not found', p_payload ->> 'pengajuan_id';
      end if;
      if v_pay.status <> 'approved' then
        raise exception 'pengajuan % is not approved yet (status=%)', v_pay.id, v_pay.status;
      end if;

      v_pdata := v_pay.data;
      v_nominal := coalesce((v_pdata ->> 'nominal')::numeric, 0);

      if v_pay.tipe = 'bahan' then
        insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
          (nullif(v_pdata ->> 'tgl', '')::date, v_pdata ->> 'no', coalesce(v_pdata ->> 'keterangan', 'bahan'), v_pdata ->> 'jenis', v_pdata ->> 'akunNama', v_pay.proyek, v_nominal, 0, p_idempotency_key || ':d', 'mk_connect', v_pay.id::text),
          (nullif(v_pdata ->> 'tgl', '')::date, v_pdata ->> 'no', coalesce(v_pdata ->> 'keterangan', 'bahan'), v_pdata ->> 'rek', v_pdata ->> 'rekNama', v_pay.proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', v_pay.id::text);

      elsif v_pay.tipe = 'tukang' then
        v_tukang_id := nullif(v_pdata ->> 'tukang_id', '')::integer;

        insert into public.bayar_tukang (proyek, tukang_id, tukang_nama, minggu, blok_selesai, unit_minggu, nominal, rek, tgl, no)
        values (
          v_pay.proyek, v_tukang_id, v_pdata ->> 'tukang_nama', v_pdata ->> 'minggu', v_pdata ->> 'blok_selesai',
          coalesce((v_pdata ->> 'unit_minggu')::numeric, 0), v_nominal, v_pdata ->> 'rek', nullif(v_pdata ->> 'tgl', '')::date, v_pdata ->> 'no'
        );

        update public.tukang_borongan
          set terbayar = coalesce((v_pdata ->> 'terbayarBaru')::numeric, terbayar),
              unit_selesai = coalesce((v_pdata ->> 'unitSelesaiBaru')::numeric, unit_selesai)
          where id = v_tukang_id;

        insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
          (nullif(v_pdata ->> 'tgl', '')::date, v_pdata ->> 'no', coalesce(v_pdata ->> 'ketJ', 'tukang'), '5-1003', 'Biaya Upah Tukang', v_pay.proyek, v_nominal, 0, p_idempotency_key || ':d', 'mk_connect', v_pay.id::text),
          (nullif(v_pdata ->> 'tgl', '')::date, v_pdata ->> 'no', coalesce(v_pdata ->> 'ketJ', 'tukang'), v_pdata ->> 'rek', v_pdata ->> 'rekNama', v_pay.proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', v_pay.id::text);
      else
        raise exception 'Unsupported tipe % for finance_expense_transfer_confirmed', v_pay.tipe;
      end if;

      update public.pengajuan
        set data = v_pdata || jsonb_build_object(
          'paid_at', now(),
          'bukti_transfer_url', p_payload ->> 'bukti_transfer_url',
          'ai_nominal', p_payload ->> 'ai_nominal',
          'ai_tanggal', p_payload ->> 'ai_tanggal',
          'ai_rekening', p_payload ->> 'ai_rekening',
          'confirmed_by', p_payload ->> 'confirmed_by'
        )
        where id = v_pay.id;

      v_target_ref := v_pdata ->> 'no';

    elsif p_event_type = 'loonars_closing_verified' then
      v_aset_id := (p_payload ->> 'aset_id')::bigint;
      v_price := coalesce((p_payload ->> 'price')::numeric, 0);
      v_tgl := coalesce(nullif(p_payload ->> 'tgl', '')::date, current_date);
      v_tipe := p_payload ->> 'tipe';

      v_amount := case v_tipe
        when 'booking' then coalesce((p_payload ->> 'bf')::numeric, 0)
        when 'dp' then coalesce((p_payload ->> 'dp')::numeric, 0)
        when 'akad' then v_price
        else v_price
      end;

      update public.aset set status = 'terjual', tgl_jual = v_tgl where id = v_aset_id;
      if not found then
        raise exception 'aset % not found', v_aset_id;
      end if;

      select public.next_mkh_no('LN') into v_no_num;
      v_no := 'LN-' || lpad(v_no_num::text, 3, '0');
      v_ket := 'Closing Loonars Villa Unit ' || coalesce(p_payload ->> 'blok', '-') || ' — verifikasi MK Connect';

      insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
        (v_tgl, v_no, v_ket, '1-1001', 'Kas Tunai', p_payload ->> 'proyek', v_amount, 0, p_idempotency_key || ':d', 'mk_connect', v_aset_id::text),
        (v_tgl, v_no, v_ket, '4-1001', 'Penjualan', p_payload ->> 'proyek', 0, v_amount, p_idempotency_key || ':k', 'mk_connect', v_aset_id::text);

      v_target_ref := v_no;

    elsif p_event_type = 'loonars_closing_rejected' then
      v_aset_id := (p_payload ->> 'aset_id')::bigint;

      update public.aset set status = 'tersedia', pembeli = null, harga = null, tgl_jual = null, ket = null
      where id = v_aset_id;
      if not found then
        raise exception 'aset % not found', v_aset_id;
      end if;

      v_target_ref := v_aset_id::text;

    elsif p_event_type = 'loonars_fee_requested' then
      insert into public.loonars_fee (unit, marketing, buyer, type, price, date, status, proyek, phone, fee_amount)
      values (
        p_payload ->> 'unit', p_payload ->> 'marketing', p_payload ->> 'buyer', p_payload ->> 'type',
        coalesce((p_payload ->> 'price')::numeric, 0), coalesce(p_payload ->> 'tgl', current_date::text),
        'pending', p_payload ->> 'proyek', p_payload ->> 'phone', coalesce((p_payload ->> 'fee_amount')::numeric, 0)
      )
      returning id into v_pengajuan_id;

      v_target_ref := v_pengajuan_id::text;

    elsif p_event_type = 'loonars_fee_wa_decision' then
      v_fee_id := (p_payload ->> 'fee_id')::bigint;

      select * into v_fee from public.loonars_fee where id = v_fee_id for update;
      if not found then
        raise exception 'loonars_fee % not found', v_fee_id;
      end if;

      if v_fee.status <> 'pending' then
        v_target_ref := v_fee_id::text;
      else
        if p_payload ->> 'decision' = 'approved' then
          select public.next_mkh_no('KK') into v_no_num;
          v_no := 'KK-' || lpad(v_no_num::text, 3, '0');
          v_ket := 'Fee marketing (disetujui via WhatsApp) — Unit ' || coalesce(v_fee.unit, '-') || ' — ' || coalesce(v_fee.buyer, '-');

          insert into public.jurnal (tgl, no, ket, akun, nama, proyek, d, k, idempotency_key, source_system, source_ref) values
            (current_date, v_no, v_ket, '6-1008', 'Komisi Sales', v_fee.proyek, coalesce(v_fee.fee_amount, 0), 0, p_idempotency_key || ':d', 'mkc_whatsapp', v_fee_id::text),
            (current_date, v_no, v_ket, '1-1001', 'Kas Tunai', v_fee.proyek, 0, coalesce(v_fee.fee_amount, 0), p_idempotency_key || ':k', 'mkc_whatsapp', v_fee_id::text);

          update public.pengajuan set status = 'approved', verified_by = coalesce(p_payload ->> 'decided_by', 'WhatsApp Super Admin'), updated_at = now()
            where tipe = 'komisi' and data ->> 'fee_id' = v_fee_id::text and status = 'pending';
        else
          update public.pengajuan set status = 'rejected', verified_by = coalesce(p_payload ->> 'decided_by', 'WhatsApp Super Admin'), updated_at = now()
            where tipe = 'komisi' and data ->> 'fee_id' = v_fee_id::text and status = 'pending';
        end if;

        v_target_ref := v_fee_id::text;
      end if;

    elsif p_event_type = 'tukang_borongan_sisa_upsert' then
      v_proyek := p_payload ->> 'proyek';
      if coalesce(v_proyek, '') = '' or coalesce(p_payload ->> 'nama', '') = '' then
        raise exception 'tukang_borongan_sisa_upsert requires proyek and nama';
      end if;

      select id into v_tb_id
        from public.tukang_borongan
        where proyek = v_proyek
          and lower(trim(coalesce(blok, ''))) = lower(trim(coalesce(p_payload ->> 'blok', '')))
          and lower(trim(nama)) = lower(trim(p_payload ->> 'nama'))
        limit 1;

      if v_tb_id is not null then
        update public.tukang_borongan
          set item = coalesce(p_payload ->> 'item', item),
              nilai_kontrak = coalesce((p_payload ->> 'nilai_kontrak')::numeric, nilai_kontrak),
              terbayar = coalesce((p_payload ->> 'terbayar')::numeric, terbayar),
              total_unit = coalesce((p_payload ->> 'total_unit')::numeric, total_unit),
              harga_per_unit = coalesce((p_payload ->> 'harga_per_unit')::numeric, harga_per_unit),
              unit_selesai = coalesce((p_payload ->> 'unit_selesai')::numeric, unit_selesai),
              ket = coalesce(p_payload ->> 'ket', ket)
          where id = v_tb_id;
        v_target_ref := v_tb_id::text;
      else
        insert into public.tukang_borongan (
          proyek, nama, item, nilai_kontrak, terbayar, tgl_mulai, ket,
          total_unit, harga_per_unit, unit_selesai, blok
        ) values (
          v_proyek, p_payload ->> 'nama', p_payload ->> 'item',
          coalesce((p_payload ->> 'nilai_kontrak')::numeric, 0),
          coalesce((p_payload ->> 'terbayar')::numeric, 0),
          coalesce(nullif(p_payload ->> 'tgl_mulai', '')::date, current_date),
          p_payload ->> 'ket',
          nullif(p_payload ->> 'total_unit', '')::numeric,
          nullif(p_payload ->> 'harga_per_unit', '')::numeric,
          nullif(p_payload ->> 'unit_selesai', '')::numeric,
          p_payload ->> 'blok'
        )
        returning id into v_tb_id;
        v_target_ref := v_tb_id::text;
      end if;

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
$function$
