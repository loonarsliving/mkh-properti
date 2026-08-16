-- ============================================================================
-- MKH Property — 0017: Include tukang contract balance in the
-- finance_expense_submitted sync payload
--
-- Owner's ask: the WhatsApp alert Kepala Cabang (e.g. Vando) gets when a
-- gaji tukang pengajuan is submitted should show the remaining contract
-- balance ("sisa gaji"), not just the amount being requested right now.
-- admin-proyek.html's bayarTukang() already computes sisa_kontrak (nilai
-- kontrak minus total terbayar INCLUDING this payment) and terbayarBaru
-- into pengajuan.data -- this migration just forwards those two fields
-- (already sitting in pengajuan.data for tipe='tukang') through the
-- outbound sync payload, where 0008 previously dropped them. MK Connect
-- (mkhsistem) picks these up to build the fuller WhatsApp message.
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
        'verification_link', 'https://finance.haluoleo.id/verifikasi.html',
        -- tipe='tukang' only -- admin-proyek.html's bayarTukang() already
        -- computes these into pengajuan.data; forwarded as-is, null for
        -- tipe='bahan' since a material purchase has no "contract".
        'sisa_kontrak', new.data ->> 'sisa_kontrak',
        'terbayar_baru', new.data ->> 'terbayarBaru'
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

comment on function public.pengajuan_expense_submitted_sync is
  'Enqueues an outbound finance_expense_submitted sync event to MK Connect the moment an admin submits an expense (bahan/tukang), so that branch''s Kepala Cabang gets a WhatsApp alert with the verifikasi.html link -- before it reaches super_admin on approval. For tipe=tukang, also forwards sisa_kontrak/terbayar_baru so the WA message can show the remaining contract balance (0017).';
