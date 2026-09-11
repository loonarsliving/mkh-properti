-- ============================================================================
-- MKH Property — 0035: Auto-reject a detected duplicate bahan expense
--
-- Owner's explicit direction (2026-09-11), after 4 real duplicate incidents
-- this week (KK-309/317, KK-310/318, KK-311/319, and KK-316/325 -- the last
-- one already paid twice before it was caught): "lain kali jika ada yg
-- double langsung tolak saja dan sampaikan penolakan itu ke Vando dan Anang."
--
-- Pattern behind every real incident so far: a bahan pengajuan whose
-- destination account matches an already-APPROVED pengajuan for the same
-- proyek, same exact nominal, and near-identical itemized description
-- (the same nota re-entered -- once manually, once from the AI-read photo,
-- or the same photo processed twice). This is a BEFORE INSERT guard, not a
-- post-hoc check: it runs before trg_pengajuan_expense_submitted_sync (an
-- AFTER INSERT trigger keyed on status = 'pending'), so if this guard flips
-- the new row straight to 'rejected', the normal "new pengajuan awaiting
-- verification" notification to Kepala Cabang never fires at all -- only
-- the duplicate-rejection notification below does.
--
-- Deliberately conservative to avoid a false-positive auto-rejecting a
-- legitimate expense (real risk: two genuinely different Rp100.000
-- "operasional belanja" reimbursements submitted days apart coincidentally
-- share both nominal and generic wording -- KK-295 and KK-329 were exactly
-- this, and are NOT duplicates of each other):
--   - requires an EXACT nominal match, not just "close"
--   - requires the same proyek and destination-account digit run
--   - requires the existing match to be within the last 30 days
--   - requires the item/keterangan text itself to be at least 60 characters
--     (a real itemized nota, not a one-line generic note like "operasional
--     belanja material") AND >60% pg_trgm similar to the existing one
-- A pengajuan that doesn't clear every one of these stays untouched and
-- goes through the normal verification flow.
-- ============================================================================

create extension if not exists pg_trgm;

create or replace function public.pengajuan_expense_duplicate_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new_note text;
  v_new_account text;
  v_match record;
begin
  if new.tipe <> 'bahan' or new.status <> 'pending' or coalesce(new.source_system, '') = 'mk_connect' then
    return new;
  end if;

  v_new_note := coalesce(new.data ->> 'keterangan', new.data ->> 'ket', '');
  if length(v_new_note) < 60 then
    return new;
  end if;

  v_new_account := regexp_replace(split_part(v_new_note, '|', 1), '[^0-9]', '', 'g');
  if v_new_account = '' then
    return new;
  end if;

  select p.id into v_match
  from public.pengajuan p
  where p.id <> new.id
    and p.proyek = new.proyek
    and p.tipe = 'bahan'
    and p.status = 'approved'
    and p.created_at >= now() - interval '30 days'
    and coalesce((p.data ->> 'nominal')::numeric, -1) = coalesce((new.data ->> 'nominal')::numeric, -2)
    and regexp_replace(split_part(coalesce(p.data ->> 'keterangan', p.data ->> 'ket', ''), '|', 1), '[^0-9]', '', 'g') = v_new_account
    and similarity(coalesce(p.data ->> 'keterangan', p.data ->> 'ket', ''), v_new_note) > 0.6
  order by p.created_at desc
  limit 1;

  if v_match.id is not null then
    new.status := 'rejected';
    new.verified_by := 'Sistem (deteksi duplikat otomatis)';
    new.data := new.data || jsonb_build_object(
      'auto_rejected_reason', 'Duplikat dari pengajuan #' || v_match.id || ' yang sudah disetujui -- item dan nominal sama persis',
      'auto_rejected_duplicate_of', v_match.id
    );

    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'finance_expense_duplicate_rejected', 'pengajuan', new.id::text,
      'expense-duplicate-rejected-' || new.id,
      jsonb_build_object(
        'pengajuan_id', new.id,
        'duplicate_of_pengajuan_id', v_match.id,
        'tipe', new.tipe,
        'proyek', new.proyek,
        'proyek_nama', coalesce(new.data ->> 'proyek_nama', new.proyek),
        'branch_name', case new.proyek
          when 'AFP' then 'Kendari' when 'IH' then 'Makassar' when 'LL' then 'Jogja'
          when 'GCI' then 'Jabodetabek' when 'GCR' then 'Jabodetabek' else new.proyek
        end,
        'nominal', coalesce((new.data ->> 'nominal')::numeric, 0),
        'item', coalesce(new.data ->> 'item', new.data ->> 'tukang_nama'),
        'keterangan', v_new_note,
        'admin_email', new.created_by,
        'submitted_at', new.created_at
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger trg_pengajuan_expense_duplicate_guard
before insert on public.pengajuan
for each row execute function public.pengajuan_expense_duplicate_guard();

comment on function public.pengajuan_expense_duplicate_guard is
  'BEFORE INSERT guard: auto-rejects a bahan pengajuan whose destination account, exact nominal, and itemized description (>60 chars, >60% trigram-similar) already matches an approved pengajuan from the last 30 days. Fires finance_expense_duplicate_rejected outward so MK Connect notifies Kepala Cabang and the original submitter directly, instead of silently dropping it.';
