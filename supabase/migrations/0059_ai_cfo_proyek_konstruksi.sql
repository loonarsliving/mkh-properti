-- ============================================================================
-- 0059 — AI CFO: terima snapshot proyek konstruksi Loonars (Loonars Coffee)
-- ============================================================================
--
-- Owner (2026-11-01): Loonars Coffee memakai keuangan Loonars 2, jadi harus
-- masuk laporan Loonars 2. Budget & realisasi proyek Loonars Coffee ada di
-- MK Connect (construction_projects / construction_cost_requests /
-- construction_expenses). Migrasi ini HANYA menambah jenis snapshot
-- 'proyek_konstruksi' ke daftar yang boleh dikirim database MK Connect ke
-- cfo_sumber_terima. Fungsi lain tidak berubah. Tanpa tabel/kolom baru.
-- Pasangan: Mkhsistem migrasi 0309 (pengirim).
--
-- Rollback: jalankan ulang definisi cfo_sumber_terima dari 0057.
-- ============================================================================

create or replace function public.cfo_sumber_terima(
  p_jenis text,
  p_baris jsonb,
  p_lengkap boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_hdr json := current_setting('request.headers', true)::json;
  v_provided text := coalesce(v_hdr ->> 'x-sync-secret', current_setting('request.header.x-sync-secret', true));
  v_mk text;
  v_villa text;
  v_sumber text;
  v_boleh text[];
  v_el jsonb;
  v_id text;
  v_data jsonb;
  v_hash text;
  v_diubah timestamptz;
  v_lama record;
  v_ids text[] := '{}';
  v_baru int := 0;
  v_berubah int := 0;
  v_sama int := 0;
  v_nonaktif int := 0;
begin
  select decrypted_secret into v_mk from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select decrypted_secret into v_villa from vault.decrypted_secrets where name = 'villa_sync_shared_secret';

  -- Pengirim ditentukan oleh RAHASIA yang cocok, bukan oleh klaim pemanggil.
  if v_mk is not null and v_provided is not distinct from v_mk then
    -- Database MK Connect + villa (project bersama svcmybsziaelwwdrnzcv).
    v_sumber := 'svcmyb';
    v_boleh := array['investor_penjualan', 'refund_customer', 'transfer_tertunda', 'ota_settlement', 'pengajuan_biaya_villa',
                     'villa_kas_masuk', 'villa_kas_keluar', 'proyek_konstruksi'];
  elsif v_villa is not null and v_provided is not distinct from v_villa then
    v_sumber := 'villa_api';
    v_boleh := array['ota_settlement', 'pengajuan_biaya_villa', 'villa_kas_masuk', 'villa_kas_keluar'];
  else
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_jenis is null or not (p_jenis = any (v_boleh)) then
    raise exception 'Jenis tidak dikenal: %', p_jenis using errcode = '22023';
  end if;
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' then
    raise exception 'p_baris harus array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_baris) > 5000 then
    raise exception 'Terlalu banyak baris (maks 5000)' using errcode = '22023';
  end if;

  for v_el in select value from jsonb_array_elements(p_baris) loop
    v_id := nullif(trim(v_el ->> 'id'), '');
    v_data := v_el -> 'data';
    if v_id is null or length(v_id) > 200 or v_data is null or jsonb_typeof(v_data) <> 'object' then
      raise exception 'Baris tidak valid (id/data)' using errcode = '22023';
    end if;
    begin
      v_diubah := nullif(v_el ->> 'diubah_pada', '')::timestamptz;
    exception when others then
      v_diubah := null;
    end;
    v_hash := md5(v_data::text);
    v_ids := v_ids || v_id;

    select hash, aktif into v_lama from public.cfo_sumber_snapshot
     where sumber = v_sumber and jenis = p_jenis and source_id = v_id
     for update;
    if not found then
      insert into public.cfo_sumber_snapshot (sumber, jenis, source_id, data, hash, sumber_diubah_pada)
      values (v_sumber, p_jenis, v_id, v_data, v_hash, v_diubah);
      v_baru := v_baru + 1;
    elsif v_lama.hash is distinct from v_hash or not v_lama.aktif then
      update public.cfo_sumber_snapshot
         set data = v_data, hash = v_hash, sumber_diubah_pada = v_diubah,
             diterima_pada = now(), berubah_pada = now(), aktif = true
       where sumber = v_sumber and jenis = p_jenis and source_id = v_id;
      v_berubah := v_berubah + 1;
    else
      update public.cfo_sumber_snapshot set diterima_pada = now()
       where sumber = v_sumber and jenis = p_jenis and source_id = v_id;
      v_sama := v_sama + 1;
    end if;
  end loop;

  if coalesce(p_lengkap, false) then
    update public.cfo_sumber_snapshot
       set aktif = false, berubah_pada = now()
     where sumber = v_sumber and jenis = p_jenis and aktif
       and not (source_id = any (v_ids));
    get diagnostics v_nonaktif = row_count;
  end if;

  insert into public.cfo_sync_log (sumber, jenis, jumlah, baru, berubah, sama, nonaktif, lengkap)
  values (v_sumber, p_jenis, jsonb_array_length(p_baris), v_baru, v_berubah, v_sama, v_nonaktif, coalesce(p_lengkap, false));

  return jsonb_build_object('status', 'ok', 'sumber', v_sumber, 'jenis', p_jenis,
    'baru', v_baru, 'berubah', v_berubah, 'sama', v_sama, 'nonaktif', v_nonaktif);
end;
$$;
revoke execute on function public.cfo_sumber_terima(text, jsonb, boolean) from public;
grant execute on function public.cfo_sumber_terima(text, jsonb, boolean) to anon, authenticated;
