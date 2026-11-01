-- Uji migrasi 0061: jenis snapshot 'gaji_karyawan' hanya dari database MK Connect.
\set ON_ERROR_STOP on
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_sumber_terima('gaji_karyawan', '[{"id":"g1","data":{"cabang":"Jogja","periode":"2026-11","nominal":4000000,"status":"transferred"}}]', true);
  if (v ->> 'baru')::int <> 1 or v ->> 'sumber' <> 'svcmyb' then raise exception 'GAGAL gaji: %', v; end if;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-villa"}', false);
  begin
    perform public.cfo_sumber_terima('gaji_karyawan', '[]'::jsonb, false);
    raise exception 'GAGAL: villa boleh kirim gaji';
  exception when sqlstate '22023' then null;
  end;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_sumber_terima('proyek_konstruksi', '[]'::jsonb, false);
  if v ->> 'status' <> 'ok' then raise exception 'GAGAL: jenis lama rusak'; end if;
end $$;
select 'cfo_uji_gaji: SEMUA LULUS' as hasil;
