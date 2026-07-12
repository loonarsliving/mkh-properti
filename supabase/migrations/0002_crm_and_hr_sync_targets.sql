-- ============================================================================
-- MKH Property — 0002: Sync targets for CRM payments & HR/payroll expenses
--
-- Design (see integration report for full rationale):
--
--  - CRM customer payments (already Finance-verified inside MK Connect via
--    `prospect.finance_verify`) post DIRECTLY to `jurnal` as Incoming Cash,
--    matching this app's own existing pattern where project-admin income
--    entries (admin-proyek.html simpanKasMasuk) post directly with no
--    second approval, unlike expenses which always route through
--    `pengajuan`. A new `crm_payment_receipts` table is the CFO's
--    confirmation queue for these synced entries — confirming one is the
--    "Finance confirms a payment" event that syncs back to MK Connect.
--
--  - HR-originated money-OUT events (payroll salary, sales commission,
--    bonus, reimbursement, other HR expense) all land in `pengajuan`
--    (status='pending'), exactly like existing bahan/tukang submissions, so
--    the CFO/verifier keeps the same manual approval gate over MKH
--    Property's ledger for anything leaving the company. verifikasi.html is
--    extended (see repo root) to post the correct jurnal entries per tipe
--    on approval.
--
--  - Payroll specifically also lands in the previously-unused
--    karyawan/slip_gaji tables (already present in this database, never
--    wired to any UI) once approved, giving Finance a real payslip record
--    instead of just a generic ledger line.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- pengajuan: link back to the originating MK Connect event for idempotency
-- (defense in depth on top of sync_log's own unique idempotency_key) and to
-- tag sync-originated rows distinctly from ones staff enter by hand.
-- ----------------------------------------------------------------------------
alter table public.pengajuan
  add column idempotency_key text unique,
  add column source_system text;

comment on column public.pengajuan.idempotency_key is
  'Set only for rows created by the MK Connect sync-inbound function; prevents a duplicate delivery from creating a second submission even if sync_log dedup is somehow bypassed.';
comment on column public.pengajuan.source_system is
  'NULL for rows entered by staff via admin-proyek.html; "mk_connect" for rows created automatically by the sync integration.';

-- ----------------------------------------------------------------------------
-- jurnal: same idea, for entries posted directly (CRM incoming cash).
-- ----------------------------------------------------------------------------
alter table public.jurnal
  add column idempotency_key text,
  add column source_system text,
  add column source_ref text;

create unique index jurnal_idempotency_key_uidx on public.jurnal (idempotency_key) where idempotency_key is not null;

comment on column public.jurnal.idempotency_key is
  'Set only for rows created by the sync integration (one per jurnal line, so "<idempotency_key>:d"/":k"); NULL for manually entered rows.';
comment on column public.jurnal.source_ref is
  'For CRM-sourced rows: the MK Connect prospect_payments.id this entry represents.';

-- ----------------------------------------------------------------------------
-- karyawan: link to the MK Connect employee this record was synced from, so
-- repeat syncs (e.g. next month's payroll for the same person) update the
-- same karyawan row instead of creating duplicates.
-- ----------------------------------------------------------------------------
alter table public.karyawan
  add column mkc_employee_id uuid unique;

comment on column public.karyawan.mkc_employee_id is
  'MK Connect employees.id, set when this karyawan row originated from (or was matched to) a payroll sync event.';

-- ----------------------------------------------------------------------------
-- crm_payment_receipts: the CFO's confirmation queue for CRM-sourced
-- Incoming Cash. Row is inserted (status='recorded') the moment the
-- sync-inbound function posts the jurnal entries; status flips to
-- 'confirmed' when the CFO reviews it in verifikasi.html, which is the
-- trigger point for the finance_payment_confirmed event back to MK Connect.
-- ----------------------------------------------------------------------------
create table public.crm_payment_receipts (
  id bigint generated always as identity primary key,
  mkc_payment_id uuid not null unique,
  mkc_prospect_id uuid,
  proyek text not null,
  customer_name text,
  project_name text,
  unit_label text,
  payment_type text,
  amount numeric(14, 2) not null,
  payment_date date not null,
  reference_number text,
  sales_name text,
  branch_name text,
  jurnal_no text not null,
  status text not null default 'recorded' check (status in ('recorded', 'confirmed')),
  confirmed_by text,
  confirmed_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

alter table public.crm_payment_receipts enable row level security;
create policy anon_all_crm_payment_receipts on public.crm_payment_receipts for all
  to anon, authenticated using (true) with check (true);
-- Matches this project's existing wide-open access model for
-- staff-facing tables (see pengajuan/jurnal policies) — verifikasi.html
-- authenticates via Supabase Auth + its own users_proyek role check, not
-- via RLS. Flagged in the integration report alongside the pre-existing
-- RLS findings; not tightened here to avoid breaking the current app.

comment on table public.crm_payment_receipts is
  'CFO confirmation queue for Incoming Cash entries synced automatically from MK Connect CRM payments. Confirming a row here fires the finance_payment_confirmed event back to MK Connect.';

create or replace function public.trg_crm_payment_receipt_confirmed_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'finance_payment_confirmed', 'crm_payment_receipts', new.id::text,
      'mkh:finance_confirm:' || new.mkc_payment_id,
      jsonb_build_object(
        'mkc_payment_id', new.mkc_payment_id,
        'confirmed_by', new.confirmed_by,
        'confirmed_at', new.confirmed_at,
        'jurnal_no', new.jurnal_no
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger crm_payment_receipt_after_update_sync
  after update on public.crm_payment_receipts
  for each row execute function public.trg_crm_payment_receipt_confirmed_sync();
