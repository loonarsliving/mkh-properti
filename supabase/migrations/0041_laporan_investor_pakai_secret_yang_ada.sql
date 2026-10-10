-- ============================================================================
-- 0041 — Laporan Investor memakai rahasia sync yang SUDAH ADA
--
-- Keputusan owner (2026-10-10): "pakai fitur yang sudah ada, agar hanya super
-- admin yang dapat meminta laporan". Maka:
--   - Tidak ada Vault secret baru. 0040 sempat memakai `ir_report_secret` dan
--     `ir_sync_shared_secret`; keduanya diganti rahasia yang sudah dipakai
--     sehari-hari:
--       * MK Connect → `mk_sync_shared_secret`, header `x-sync-secret`
--         (sama dengan sync_inbound)
--       * Villa      → `villa_sync_shared_secret`, header `x-villa-sync-secret`
--         (sama dengan villa_income_sync)
--   - Siapa yang boleh meminta laporan lewat WhatsApp ditentukan MK Connect
--     dengan peran `super_admin` yang sudah ada di sana — bukan daftar nomor
--     terpisah di mkh-properti. Tabel ir_wa_penerima (0040, masih kosong)
--     tidak dipakai lagi; aksesnya dicabut. (DROP TABLE membuat klien
--     Supabase MCP menggantung saat penerapan, jadi tabel kosong itu
--     dibiarkan tanpa akses.)
--   - Setiap sumber hanya boleh mengisi metrik atas namanya sendiri:
--     rahasia villa → sumber berawalan 'villa', rahasia MK Connect → sumber
--     berawalan 'mk-connect'.
--
-- Tidak menyentuh apa pun milik sistem villa (fitur investor, dividen, dll.).
-- Catatan penerapan: tanpa `if exists` dan tanpa SELECT tingkat atas.
-- ============================================================================

create or replace function public.ir_boleh_akses(p_peminta_wa text)
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
begin
  if public.mkh_is_cfo() then
    return 'cfo:' || public.mkh_email_login();
  end if;

  -- Permintaan WhatsApp diteruskan server mkh-properti dari MK Connect,
  -- yang sudah memastikan pengirimnya super_admin.
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-sync-secret',
    current_setting('request.header.x-sync-secret', true)
  );
  if v_secret is not null and v_provided is not distinct from v_secret
     and p_peminta_wa ~ '^62[0-9]{8,14}$' then
    return 'wa-super-admin:' || p_peminta_wa;
  end if;
  return null;
end;
$$;

revoke execute on function public.ir_boleh_akses(text) from public, anon, authenticated;

create or replace function public.ir_metrik_terima(
  p_unit_kode text,
  p_periode text,
  p_sumber text,
  p_metrik jsonb,
  p_versi_definisi text,
  p_status text default 'sementara',
  p_dihitung_pada timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_mk text;
  v_villa text;
  v_hdr json := current_setting('request.headers', true)::json;
  v_pengirim text;
  v_unit_id bigint;
  v_kunci_asing text[];
  v_id bigint;
  v_revisi int;
begin
  select decrypted_secret into v_mk from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select decrypted_secret into v_villa from vault.decrypted_secrets where name = 'villa_sync_shared_secret';

  if v_mk is not null and coalesce(v_hdr ->> 'x-sync-secret', current_setting('request.header.x-sync-secret', true)) is not distinct from v_mk then
    v_pengirim := 'mk-connect';
  elsif v_villa is not null and coalesce(v_hdr ->> 'x-villa-sync-secret', current_setting('request.header.x-villa-sync-secret', true)) is not distinct from v_villa then
    v_pengirim := 'villa';
  else
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_sumber is null or left(p_sumber, length(v_pengirim)) <> v_pengirim then
    raise exception 'Sumber % tidak boleh dikirim oleh %', p_sumber, v_pengirim using errcode = '42501';
  end if;

  select id into v_unit_id from public.ir_unit_bisnis where kode = p_unit_kode and aktif;
  if v_unit_id is null then
    raise exception 'Unit bisnis % tidak dikenal atau tidak aktif', p_unit_kode using errcode = '22023';
  end if;
  if p_metrik is null or jsonb_typeof(p_metrik) <> 'object' or length(p_metrik::text) > 50000 then
    raise exception 'metrik harus objek JSON' using errcode = '22023';
  end if;
  if p_status not in ('sementara', 'final') then
    raise exception 'status harus sementara/final' using errcode = '22023';
  end if;

  select array_agg(k) into v_kunci_asing
    from jsonb_object_keys(p_metrik) k
   where k <> all (public.ir_kunci_metrik_v1());
  if v_kunci_asing is not null then
    raise exception 'Kunci metrik di luar kontrak: %', array_to_string(v_kunci_asing, ', ') using errcode = '22023';
  end if;

  insert into public.ir_metrik_bulanan (unit_id, periode, sumber, metrik, versi_definisi, status, dihitung_pada)
  values (v_unit_id, p_periode, p_sumber, p_metrik, p_versi_definisi, p_status, coalesce(p_dihitung_pada, now()))
  on conflict (unit_id, periode, sumber) do update
     set metrik = excluded.metrik,
         versi_definisi = excluded.versi_definisi,
         status = excluded.status,
         dihitung_pada = excluded.dihitung_pada,
         diterima_pada = now()
  returning id, revisi into v_id, v_revisi;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status, target_ref)
  values ('inbound', 'ir_metrik_diterima', 'ir_metrik_bulanan', v_id::text,
          'ir:' || p_unit_kode || ':' || p_periode || ':' || p_sumber || ':' || clock_timestamp()::text,
          jsonb_build_object('unit', p_unit_kode, 'periode', p_periode, 'sumber', p_sumber, 'pengirim', v_pengirim,
                             'versi_definisi', p_versi_definisi, 'status', p_status, 'revisi', v_revisi),
          'succeeded', v_id::text);

  return jsonb_build_object('status', 'ok', 'id', v_id, 'revisi', v_revisi);
end;
$$;

revoke execute on function public.ir_metrik_terima(text, text, text, jsonb, text, text, timestamptz) from public;
grant execute on function public.ir_metrik_terima(text, text, text, jsonb, text, text, timestamptz) to anon, authenticated;

revoke all on public.ir_wa_penerima from anon, authenticated;
comment on table public.ir_wa_penerima is
  'TIDAK DIPAKAI sejak 0041 — izin meminta laporan lewat WA ditentukan peran super_admin di MK Connect.';
