-- ============================================================================
-- 0072 — AI CFO: akses HANYA-BACA untuk Loonars AI Advisor (repo Istri)
-- ============================================================================
--
-- Owner (2026-11-11): advisor boleh memakai AI CFO "selama endpoint advisor
-- itu tidak merusak sistem yang sudah bekerja".
--
-- Desain — tidak ada perilaku lama yang berubah:
--   1. _cfo_akses() dinyatakan ulang PERSIS seperti 0062, ditambah SATU cabang
--      di depan jalur rahasia sync: cabang itu hanya aktif bila
--        (a) flag transaksi `cfo.advisor_baca` = 'ya' (hanya diset oleh dua
--            fungsi pembungkus di bawah), DAN
--        (b) header x-advisor-secret = Vault `advisor_shared_secret`.
--      Tanpa flag, atau tanpa secret di Vault, alur lama berjalan apa adanya.
--   2. cfo_advisor_ambil_data() / cfo_advisor_ambil_kerja(): pembungkus yang
--      memanggil cfo_ambil_data(null) / cfo_ambil_kerja(null) (keduanya
--      STABLE, hanya baca) dan mencatat ke cfo_audit_log (aktor 'advisor').
--      Header advisor ke RPC lain mana pun (cfo_catat, cfo_tutup_buku,
--      cfo_briefing_antre, cfo_tindakan_sinkron, cfo_pdf_buat_tautan,
--      cfo_tanda_ai) tidak memasang flag → ditolak seperti anon.
--   3. Tidak ada tabel/kolom baru. Rahasia TIDAK ada di migrasi: dibuat
--      manual di SQL editor (lihat bawah). Sebelum dibuat, jalur advisor mati.
--
-- Mengaktifkan (manual, sekali, oleh owner):
--   select vault.create_secret('<rahasia acak ≥32 karakter>', 'advisor_shared_secret');
-- Mencabut: hapus/ganti secret itu di Vault. Rahasia sync MK Connect tidak
-- tersentuh.
-- ============================================================================

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
  v_adv_secret text;
  v_adv_provided text;
begin
  if public.mkh_is_cfo() then
    return 'cfo:' || public.mkh_email_login();
  end if;
  if v_tautan is not null and public._cfo_token_pdf_sah(v_tautan) is not null then
    return 'tautan_pdf';
  end if;
  -- 0072: jalur baca Loonars AI Advisor (hanya lewat cfo_advisor_ambil_*).
  if coalesce(current_setting('cfo.advisor_baca', true), '') = 'ya' then
    select decrypted_secret into v_adv_secret from vault.decrypted_secrets where name = 'advisor_shared_secret';
    v_adv_provided := coalesce(
      current_setting('request.headers', true)::json ->> 'x-advisor-secret',
      current_setting('request.header.x-advisor-secret', true)
    );
    if v_adv_secret is not null and length(v_adv_secret) >= 32 and v_adv_provided = v_adv_secret then
      return 'advisor';
    end if;
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

create or replace function public._cfo_advisor_catat(p_aksi text, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values ('advisor', 'sistem', p_aksi,
          jsonb_build_object('mode', case when p_mode ~ '^[a-z_]{1,20}$' then p_mode else 'lain' end));
end;
$$;
revoke execute on function public._cfo_advisor_catat(text, text) from public, anon, authenticated;

create or replace function public.cfo_advisor_ambil_data(p_mode text default 'fakta')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hasil jsonb;
begin
  perform set_config('cfo.advisor_baca', 'ya', true);
  v_hasil := public.cfo_ambil_data(null);  -- menolak (42501) bila rahasia advisor salah/tidak ada
  perform set_config('cfo.advisor_baca', '', true);
  perform public._cfo_advisor_catat('advisor_ambil_data', p_mode);
  return v_hasil;
exception when others then
  perform set_config('cfo.advisor_baca', '', true);
  raise;
end;
$$;
revoke execute on function public.cfo_advisor_ambil_data(text) from public;
grant execute on function public.cfo_advisor_ambil_data(text) to anon, authenticated;

create or replace function public.cfo_advisor_ambil_kerja()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hasil jsonb;
begin
  perform set_config('cfo.advisor_baca', 'ya', true);
  v_hasil := public.cfo_ambil_kerja(null);
  perform set_config('cfo.advisor_baca', '', true);
  return v_hasil;
exception when others then
  perform set_config('cfo.advisor_baca', '', true);
  raise;
end;
$$;
revoke execute on function public.cfo_advisor_ambil_kerja() from public;
grant execute on function public.cfo_advisor_ambil_kerja() to anon, authenticated;
