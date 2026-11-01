-- Uji migrasi 0059: jenis snapshot 'proyek_konstruksi' hanya dari database MK Connect.
\set ON_ERROR_STOP on
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_sumber_terima('proyek_konstruksi', '[{"id":"lc","data":{"nama":"Loonars Coffee","budget_total":133387454}}]', true);
  if (v ->> 'baru')::int <> 1 or v ->> 'sumber' <> 'svcmyb' then raise exception 'GAGAL proyek: %', v; end if;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-villa"}', false);
  begin
    perform public.cfo_sumber_terima('proyek_konstruksi', '[]'::jsonb, false);
    raise exception 'GAGAL: villa boleh kirim proyek';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_sumber_terima('investor_penjualan', '[]'::jsonb, false);
  if v ->> 'status' <> 'ok' then raise exception 'GAGAL: jenis lama rusak'; end if;
end $$;
\i supabase/migrations/0059_ai_cfo_proyek_konstruksi.sql
select 'cfo_uji_proyek: SEMUA LULUS' as hasil;
