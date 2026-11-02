-- Uji migrasi 0062: tautan PDF bertanda tangan.
\set ON_ERROR_STOP on
do $$
declare v jsonb; t text; d jsonb; palsu text;
begin
  -- tanpa rahasia: tidak boleh membuat tautan
  perform set_config('request.headers', '{}', false);
  begin
    perform public.cfo_pdf_buat_tautan('holding', '2026', '6281234567890');
    raise exception 'GAGAL: tanpa rahasia lolos';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  begin
    perform public.cfo_pdf_buat_tautan('rahasia_lain', '2026', '6281234567890');
    raise exception 'GAGAL: jenis asing lolos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cfo_pdf_buat_tautan('loonars1', '2026-13', '6281234567890');
    raise exception 'GAGAL: periode salah lolos';
  exception when sqlstate '22023' then null;
  end;
  v := public.cfo_pdf_buat_tautan('loonars1', '2026-10', '6281234567890');
  t := v ->> 'token';
  if v ->> 'status' <> 'ok' or v ->> 'nama_berkas' !~ '^Laporan-Loonars1-Villa_2026-10_' then raise exception 'GAGAL buat: %', v; end if;
  if not exists (select 1 from public.cfo_audit_log where aksi = 'pdf_tautan') then raise exception 'GAGAL audit'; end if;

  -- pengunduh (tanpa rahasia) dengan token sah → data
  perform set_config('request.headers', '{}', false);
  d := public.cfo_pdf_data(t);
  if d ->> 'jenis' <> 'loonars1' or d ->> 'periode' <> '2026-10' or d -> 'data' is null or d -> 'kerja' is null then raise exception 'GAGAL data: %', left(d::text, 200); end if;
  if coalesce(current_setting('cfo.tautan_pdf', true), '') <> '' then raise exception 'GAGAL: pengaturan token tidak dibersihkan'; end if;

  -- token diubah (jenis ditukar) / tanda tangan salah / kedaluwarsa → ditolak
  palsu := replace(t, '.loonars1.', '.holding.');
  begin
    perform public.cfo_pdf_data(palsu);
    raise exception 'GAGAL: token ditukar lolos';
  exception when insufficient_privilege then null;
  end;
  palsu := split_part(t, '.', 1) || '.loonars1.2026-10.' || repeat('0', 64);
  begin
    perform public.cfo_pdf_data(palsu);
    raise exception 'GAGAL: tanda tangan palsu lolos';
  exception when insufficient_privilege then null;
  end;
  palsu := '1000000000.loonars1.2026-10.' || public._cfo_tanda_pdf('1000000000|loonars1|2026-10');
  begin
    perform public.cfo_pdf_data(palsu);
    raise exception 'GAGAL: token kedaluwarsa lolos';
  exception when insufficient_privilege then null;
  end;
  -- pengaturan token palsu tidak memberi akses
  perform set_config('cfo.tautan_pdf', 'sembarang', false);
  begin
    perform public.cfo_ambil_data(null);
    raise exception 'GAGAL: pengaturan palsu memberi akses';
  exception when insufficient_privilege then null;
  end;
  perform set_config('cfo.tautan_pdf', '', false);
  -- token PDF tidak bisa dipakai membuat tautan baru
  perform set_config('cfo.tautan_pdf', t, false);
  begin
    perform public.cfo_pdf_buat_tautan('holding', '2026', null);
    raise exception 'GAGAL: token dipakai membuat tautan';
  exception when insufficient_privilege then null;
  end;
  perform set_config('cfo.tautan_pdf', '', false);
end $$;
select 'cfo_uji_pdf: SEMUA LULUS' as hasil;
