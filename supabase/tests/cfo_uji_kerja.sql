-- Uji migrasi 0058 (AI CFO meja kerja). Dijalankan setelah cfo_uji.sql.
\set ON_ERROR_STOP on

do $$
declare v jsonb; v_id bigint; v_tenggat date;
begin
  perform set_config('request.headers', '{}', false);
  perform set_config('uji.cfo', '', false);
  begin
    perform public.cfo_tindakan_sinkron('[]'::jsonb);
    raise exception 'GAGAL: sinkron tanpa akses lolos';
  exception when sqlstate '42501' then null;
  end;

  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_tindakan_sinkron('[
    {"kunci":"rekening_placeholder","judul":"Isi rekening","langkah":"Buka /loonars2","tingkat":"tinggi","lini":"L2","tenggat":"2026-11-04"},
    {"kunci":"saldo_villa","judul":"Catat saldo villa","langkah":"Buka /cfo/loonars-1","tingkat":"sedang","lini":"L1","tenggat":"2026-11-08"}]');
  if (v ->> 'baru')::int <> 2 then raise exception 'GAGAL baru: %', v; end if;

  -- tenggat tidak dimundurkan saat diperbarui
  v := public.cfo_tindakan_sinkron('[
    {"kunci":"rekening_placeholder","judul":"Isi rekening A-D","langkah":"Buka /loonars2","tingkat":"kritis","lini":"L2","tenggat":"2026-12-31"},
    {"kunci":"saldo_villa","judul":"Catat saldo villa","langkah":"x","tingkat":"sedang","lini":"L1"}]');
  select tenggat into v_tenggat from public.cfo_tindakan where kunci = 'rekening_placeholder';
  if v_tenggat <> '2026-11-04' then raise exception 'GAGAL: tenggat dimundurkan %', v_tenggat; end if;
  if (select tingkat from public.cfo_tindakan where kunci = 'rekening_placeholder') <> 'kritis' then raise exception 'GAGAL: tingkat tidak diperbarui'; end if;

  -- kondisi teratasi → ditutup otomatis
  v := public.cfo_tindakan_sinkron('[{"kunci":"saldo_villa","judul":"Catat saldo villa","langkah":"x","tingkat":"sedang","lini":"L1"}]');
  if (v ->> 'ditutup')::int <> 1 then raise exception 'GAGAL tutup: %', v; end if;
  if (select status from public.cfo_tindakan where kunci = 'rekening_placeholder') <> 'selesai' then raise exception 'GAGAL: tidak selesai'; end if;

  -- muncul lagi → dibuka ulang
  v := public.cfo_tindakan_sinkron('[{"kunci":"saldo_villa","judul":"a","langkah":"x","tingkat":"sedang","lini":"L1"},
                                     {"kunci":"rekening_placeholder","judul":"b","langkah":"y","tingkat":"tinggi","lini":"L2","tenggat":"2026-11-10"}]');
  if (v ->> 'buka_ulang')::int <> 1 then raise exception 'GAGAL buka ulang: %', v; end if;

  -- CFO mengabaikan (wajib alasan); tidak dibuka lagi oleh sinkron
  select id into v_id from public.cfo_tindakan where kunci = 'saldo_villa';
  begin
    perform public.cfo_tindakan_ubah(v_id, 'diabaikan', null);
    raise exception 'GAGAL: bukan CFO bisa ubah';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('uji.cfo', 'ya', false);
  perform set_config('uji.email', 'owner@uji', false);
  begin
    perform public.cfo_tindakan_ubah(v_id, 'diabaikan', '');
    raise exception 'GAGAL: abaikan tanpa alasan lolos';
  exception when sqlstate '22023' then null;
  end;
  perform public.cfo_tindakan_ubah(v_id, 'diabaikan', 'villa belum punya rekening sendiri');
  perform set_config('uji.cfo', '', false);
  v := public.cfo_tindakan_sinkron('[{"kunci":"saldo_villa","judul":"a","langkah":"x","tingkat":"sedang","lini":"L1"}]');
  if (select status from public.cfo_tindakan where id = v_id) <> 'diabaikan' then raise exception 'GAGAL: diabaikan dibuka lagi'; end if;
  begin
    perform public.cfo_tindakan_sinkron('[{"kunci":"x","judul":"a","langkah":"x","tingkat":"bahaya","lini":"L1"}]');
    raise exception 'GAGAL: tingkat asing lolos';
  exception when sqlstate '23514' then null;
  end;
end $$;

-- Tutup buku: sekali per periode, tidak bisa diubah, tidak boleh bulan berjalan.
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  begin
    perform public.cfo_tutup_buku(date_trunc('month', now())::date, '{"a":1}', 'k');
    raise exception 'GAGAL: bulan berjalan lolos';
  exception when sqlstate '22023' then null;
  end;
  v := public.cfo_tutup_buku('2026-10-01', '{"revenue":155084926}', 'Revenue villa Oktober Rp 155 jt.');
  if v ->> 'status' <> 'ok' then raise exception 'GAGAL tutup buku: %', v; end if;
  v := public.cfo_tutup_buku('2026-10-01', '{"revenue":1}', 'ubah');
  if v ->> 'status' <> 'sudah_ada' then raise exception 'GAGAL: tutup buku ganda %', v; end if;
  if (select (data ->> 'revenue')::numeric from public.cfo_laporan_bulanan where periode = '2026-10-01') <> 155084926 then
    raise exception 'GAGAL: angka berubah';
  end if;
  begin
    update public.cfo_laporan_bulanan set komentar = 'x' where periode = '2026-10-01';
    raise exception 'GAGAL: laporan bisa diubah';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- Data kerja: nomor rekening disamarkan; status rekening A-D tanpa nomornya.
do $$
declare v jsonb;
begin
  insert into public.pengajuan (proyek, tipe, data, status)
  values ('GCI', 'bahan', '{"nominal":"1000000","keterangan":"Beban Lain-lain - Heksanto BNI 1148154567"}', 'pending');
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_ambil_kerja(null);
  if v::text like '%1148154567%' then raise exception 'GAGAL: nomor rekening bocor'; end if;
  if not (v::text like '%••••%') then raise exception 'GAGAL: tidak disamarkan'; end if;
  if v -> 'rekening_terisi' ->> 'A' <> 'false' then raise exception 'GAGAL: rekening A dianggap terisi %', v -> 'rekening_terisi'; end if;
  if jsonb_array_length(v -> 'tindakan') < 2 or jsonb_array_length(v -> 'laporan_bulanan') <> 1 then raise exception 'GAGAL: tindakan/laporan'; end if;
  perform set_config('request.headers', '{}', false);
  begin
    perform public.cfo_ambil_kerja(null);
    raise exception 'GAGAL: ambil kerja tanpa akses lolos';
  exception when sqlstate '42501' then null;
  end;
end $$;

set role anon;
do $$
begin
  begin
    perform 1 from public.cfo_tindakan;
    raise exception 'GAGAL: anon baca tindakan';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  if (select count(*) from cron.job where jobname in ('cfo-tindakan-sinkron', 'cfo-tutup-buku')) <> 2 then raise exception 'GAGAL: cron 0058'; end if;
  perform public.cfo_briefing_bangunkan('tutup_buku');
  if not exists (select 1 from net.panggilan where body ->> 'jenis' = 'tutup_buku') then raise exception 'GAGAL: bangunkan tutup_buku'; end if;
end $$;

\i supabase/migrations/0058_ai_cfo_meja_kerja.sql
select 'cfo_uji_kerja: SEMUA LULUS' as hasil;
