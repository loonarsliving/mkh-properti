-- ============================================================================
-- MKH Property — 0012: fire loonars_closing_declared on INSERT too
--
-- 0011's trigger only covered UPDATE (the common case: a pre-seeded block
-- moving tersedia -> verifikasi). But saveUnitDB() in loonars-sales falls
-- back to INSERTing a fresh `aset` row when the block has no row yet (new
-- project, or a block never pre-seeded) -- that INSERT can already carry
-- status='verifikasi' directly, which the UPDATE-only trigger would never
-- see. Add a matching AFTER INSERT trigger using the same function.
-- ============================================================================

create or replace function public.loonars_closing_declared_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ket jsonb;
begin
  if new.status = 'verifikasi' and (TG_OP = 'INSERT' or old.status is distinct from 'verifikasi') then
    begin
      v_ket := nullif(new.ket, '')::jsonb;
    exception when others then
      v_ket := '{}'::jsonb;
    end;

    insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload)
    values (
      'outbound', 'loonars_closing_declared', 'aset', new.id::text,
      'loonars-closing-declared-' || new.id || '-' || extract(epoch from clock_timestamp())::bigint,
      jsonb_build_object(
        'aset_id', new.id,
        'proyek', new.proyek,
        'blok', new.blok,
        'buyer', new.pembeli,
        'nik', v_ket ->> 'nik',
        'phone', v_ket ->> 'phone',
        'address', v_ket ->> 'address',
        'tipe', v_ket ->> 'type',
        'price', new.harga,
        'tgl', new.tgl_jual,
        'marketing_name', v_ket ->> 'marketing',
        'marketing_email', v_ket ->> 'marketingEmail'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loonars_closing_declared_sync_insert on public.aset;
create trigger trg_loonars_closing_declared_sync_insert
after insert on public.aset
for each row execute function public.loonars_closing_declared_sync();

comment on function public.loonars_closing_declared_sync is
  'Enqueues an outbound loonars_closing_declared sync event to MK Connect when a unit is inserted or updated with status=verifikasi (sales declared a closing, pending finance verification). Fires on both INSERT (block had no aset row yet) and UPDATE (pre-seeded block transitioning into verifikasi).';
