-- ============================================================================
-- 0062 — AI CFO: tautan PDF laporan keuangan untuk WhatsApp owner
-- ============================================================================
--
-- Owner (2026-11-02): "semua laporan keuangan saya minta di WA dan AI
-- mengirimkan file PDF" — Laporan Holding SAK EMKM, Loonars 1 bulanan,
-- Loonars 2. Pola sama dengan laporan utang Loonars 2 (0053):
--
--   1. MK Connect (asisten WA owner, super admin saja) memanggil
--      POST /api/cfo/pdf-wa dengan rahasia sync → RPC cfo_pdf_buat_tautan
--      membuat TOKEN berumur 15 menit, bertanda tangan HMAC-SHA256 rahasia
--      sync yang sudah ada (Vault mk_sync_shared_secret), terikat jenis &
--      periode laporan.
--   2. Whacenter mengunduh GET /api/cfo/pdf/<token>/<nama>.pdf → RPC
--      cfo_pdf_data(token) memeriksa tanda tangan + kedaluwarsa, lalu
--      mengembalikan data yang SAMA dengan cfo_ambil_data/cfo_ambil_kerja
--      (hanya baca). PDF dibuat saat diunduh dan tidak disimpan.
--
-- Keamanan:
--   - Server MKH Property tidak memakai service-role key; database yang
--     memeriksa token.
--   - _cfo_akses mengenali token HANYA lewat pengaturan lokal transaksi
--     'cfo.tautan_pdf' yang diisi cfo_pdf_data, dan token itu diverifikasi
--     ulang (HMAC + kedaluwarsa) — pengaturan tanpa token sah tidak berarti apa-apa.
--   - Setiap pembuatan tautan dicatat di cfo_audit_log.
--
-- Rollback: drop function cfo_pdf_data(text), cfo_pdf_buat_tautan(text,text,text),
--           _cfo_token_pdf_sah(text), _cfo_tanda_pdf(text); jalankan ulang
--           definisi _cfo_akses dari 0057.
-- ============================================================================

create or replace function public._cfo_tanda_pdf(p_isi text)
returns text
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  if v_secret is null then return null; end if;
  return encode(extensions.hmac(('cfo-pdf|' || p_isi)::bytea, v_secret::bytea, 'sha256'), 'hex');
end;
$$;
revoke execute on function public._cfo_tanda_pdf(text) from public, anon, authenticated;

-- Token: <exp>.<jenis>.<periode|->.<hmac>
create or replace function public._cfo_token_pdf_sah(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bagian text[];
  v_tanda text;
begin
  if p_token is null or p_token !~ '^[0-9]{9,12}\.(holding|loonars1|loonars2)\.([0-9]{4}(-[0-9]{2})?|-)\.[0-9a-f]{64}$' then
    return null;
  end if;
  v_bagian := string_to_array(p_token, '.');
  if v_bagian[1]::bigint < extract(epoch from now())::bigint then
    return null;
  end if;
  v_tanda := public._cfo_tanda_pdf(v_bagian[1] || '|' || v_bagian[2] || '|' || v_bagian[3]);
  if v_tanda is null or v_tanda <> v_bagian[4] then
    return null;
  end if;
  return jsonb_build_object('jenis', v_bagian[2], 'periode', nullif(v_bagian[3], '-'));
end;
$$;
revoke execute on function public._cfo_token_pdf_sah(text) from public, anon, authenticated;

-- _cfo_akses (0057) + pengenalan token PDF yang sudah diverifikasi.
create or replace function public._cfo_akses(p_peminta_wa text)
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
  v_tautan text := nullif(current_setting('cfo.tautan_pdf', true), '');
begin
  if public.mkh_is_cfo() then
    return 'cfo:' || public.mkh_email_login();
  end if;
  if v_tautan is not null and public._cfo_token_pdf_sah(v_tautan) is not null then
    return 'tautan_pdf';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-sync-secret',
    current_setting('request.header.x-sync-secret', true)
  );
  if v_secret is null or v_provided is distinct from v_secret then
    return null;
  end if;
  if p_peminta_wa is null then
    return 'sistem';
  end if;
  if p_peminta_wa ~ '^62[0-9]{8,14}$' then
    return 'wa:' || p_peminta_wa;
  end if;
  return null;
end;
$$;
revoke execute on function public._cfo_akses(text) from public, anon, authenticated;

create or replace function public.cfo_pdf_buat_tautan(p_jenis text, p_periode text, p_peminta_wa text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(p_peminta_wa);
  v_periode text := coalesce(nullif(trim(p_periode), ''), '-');
  v_exp bigint := extract(epoch from now() + interval '15 minutes')::bigint;
  v_tanda text;
  v_nama text;
begin
  if v_akses is null or v_akses = 'tautan_pdf' then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_jenis is null or p_jenis not in ('holding', 'loonars1', 'loonars2') then
    raise exception 'Jenis laporan tidak dikenal' using errcode = '22023';
  end if;
  if v_periode <> '-' and v_periode !~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$' then
    raise exception 'Periode tidak valid (YYYY atau YYYY-MM)' using errcode = '22023';
  end if;
  v_tanda := public._cfo_tanda_pdf(v_exp || '|' || p_jenis || '|' || v_periode);
  if v_tanda is null then
    return jsonb_build_object('status', 'galat', 'pesan', 'Rahasia sistem tidak tersedia');
  end if;
  v_nama := case p_jenis
              when 'holding' then 'Laporan-Keuangan-Holding'
              when 'loonars1' then 'Laporan-Loonars1-Villa'
              else 'Laporan-Loonars2-Developer' end
            || case when v_periode = '-' then '' else '_' || v_periode end
            || '_' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') || '.pdf';
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_akses, case split_part(v_akses, ':', 1) when 'cfo' then 'web' when 'wa' then 'whatsapp' else 'sistem' end,
          'pdf_tautan', jsonb_build_object('jenis', p_jenis, 'periode', v_periode));
  return jsonb_build_object('status', 'ok', 'token', v_exp || '.' || p_jenis || '.' || v_periode || '.' || v_tanda, 'nama_berkas', v_nama);
end;
$$;
revoke execute on function public.cfo_pdf_buat_tautan(text, text, text) from public;
grant execute on function public.cfo_pdf_buat_tautan(text, text, text) to anon, authenticated;

create or replace function public.cfo_pdf_data(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_isi jsonb := public._cfo_token_pdf_sah(p_token);
  v_hasil jsonb;
begin
  if v_isi is null then
    raise exception 'Tautan tidak valid atau kedaluwarsa' using errcode = '42501';
  end if;
  perform set_config('cfo.tautan_pdf', p_token, true);
  v_hasil := v_isi || jsonb_build_object(
    'data', public.cfo_ambil_data(null),
    'kerja', public.cfo_ambil_kerja(null)
  );
  perform set_config('cfo.tautan_pdf', '', true);
  return v_hasil;
end;
$$;
revoke execute on function public.cfo_pdf_data(text) from public;
grant execute on function public.cfo_pdf_data(text) to anon, authenticated;
