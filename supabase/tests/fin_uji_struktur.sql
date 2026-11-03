-- Uji migrasi 0064 (struktur buku besar institusional) di Postgres lokal.
\set ON_ERROR_STOP 1

-- Data jurnal uji (proyek aktif) — bulan lalu seimbang, satu nomor timpang di bulan lain.
insert into public.jurnal (tgl, no, akun, proyek, d, k) values
  ('2026-09-10', 'UJI-A', '1-1004', 'LL', 100, 0), ('2026-09-10', 'UJI-A', '4-1001', 'LL', 0, 100),
  ('2026-08-10', 'UJI-B', '1-1004', 'LL', 50, 0), ('2026-08-10', 'UJI-B', '4-1001', 'LL', 0, 40);

do $$
declare
  j jsonb;
  n int;
  h text;
begin
  -- seed
  if (select count(*) from public.fin_properti) <> 5 then raise exception 'GAGAL: 5 properti'; end if;
  if (select properti from public.fin_peta_proyek where proyek = 'LL') <> 'L1' then raise exception 'GAGAL: LL → L1 (D-1)'; end if;
  if (select count(*) from public.fin_peta_proyek where properti = 'ARSIP') <> 5 then raise exception 'GAGAL: 5 proyek arsip'; end if;

  -- tanpa CFO: semua RPC ditolak
  perform set_config('uji.cfo', '', false);
  begin
    perform public.fin_ambil_struktur();
    raise exception 'GAGAL: non-CFO bisa membaca struktur';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_periode_tutup('2026-09-01');
    raise exception 'GAGAL: non-CFO bisa tutup buku';
  exception when insufficient_privilege then null;
  end;

  perform set_config('uji.cfo', 'ya', false);
  perform set_config('uji.email', 'owner@uji.local', false);

  j := public.fin_ambil_struktur();
  if jsonb_array_length(j->'properti') <> 5 then raise exception 'GAGAL: struktur properti'; end if;

  -- belum ada bulan ditutup → jurnal bebas (perilaku lama tidak berubah)
  insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-09-11', 'UJI-C', '1-1004', 'LL', 1, 0);
  delete from public.jurnal where no = 'UJI-C';

  -- bulan berjalan tidak bisa ditutup
  begin
    perform public.fin_periode_tutup((now() at time zone 'Asia/Jakarta')::date);
    raise exception 'GAGAL: bulan berjalan bisa ditutup';
  exception when invalid_parameter_value then null;
  end;

  -- Agustus timpang → ditolak (validasi debit = kredit)
  begin
    perform public.fin_periode_tutup('2026-08-15');
    raise exception 'GAGAL: bulan timpang bisa ditutup';
  exception when invalid_parameter_value then null;
  end;

  -- September seimbang → ditutup
  j := public.fin_periode_tutup('2026-09-20', 'uji tutup');
  if (j->>'baris')::int <> 2 then raise exception 'GAGAL: ringkas tutup %', j; end if;

  -- jurnal September kini ditolak (insert/update/delete), Oktober tetap bisa
  begin
    insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-09-30', 'UJI-D', '1-1004', 'LL', 1, 0);
    raise exception 'GAGAL: insert ke bulan tertutup';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.jurnal set d = 101 where no = 'UJI-A' and akun = '1-1004';
    raise exception 'GAGAL: update bulan tertutup';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.jurnal set tgl = '2026-09-05' where no = 'UJI-B';
    raise exception 'GAGAL: memindah jurnal ke bulan tertutup';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.jurnal where no = 'UJI-A';
    raise exception 'GAGAL: delete bulan tertutup';
  exception when insufficient_privilege then null;
  end;
  insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-10-01', 'UJI-E', '1-1004', 'LL', 1, 0);
  delete from public.jurnal where no = 'UJI-E';

  -- buka kembali wajib alasan
  begin
    perform public.fin_periode_buka('2026-09-01', 'x');
    raise exception 'GAGAL: buka tanpa alasan';
  exception when invalid_parameter_value then null;
  end;
  perform public.fin_periode_buka('2026-09-01', 'koreksi nota terlambat dari toko');
  insert into public.jurnal (tgl, no, akun, proyek, d, k) values ('2026-09-30', 'UJI-F', '1-1004', 'LL', 1, 0);
  delete from public.jurnal where no = 'UJI-F';
  if (select count(*) from public.fin_periode_log where periode = '2026-09-01') <> 2 then raise exception 'GAGAL: log tutup/buka'; end if;

  -- dimensi: nomor harus ada; append-only
  begin
    perform public.fin_dimensi_catat('LL', 'TIDAK-ADA', 'L2', null, 'uji nomor yang tidak ada');
    raise exception 'GAGAL: dimensi nomor tak ada';
  exception when invalid_parameter_value then null;
  end;
  j := public.fin_dimensi_catat('LL', 'UJI-A', 'L1', 'L2', 'uji transaksi antarproperti');
  begin
    update public.fin_jurnal_dimensi set properti = 'L2';
    raise exception 'GAGAL: dimensi bisa diubah';
  exception when insufficient_privilege then null;
  end;

  -- peta proyek: wajib alasan, tercatat di audit
  begin
    perform public.fin_peta_ubah('LL', 'L2', 'x');
    raise exception 'GAGAL: peta tanpa alasan';
  exception when invalid_parameter_value then null;
  end;

  -- laporan beku: hash sha256 dihitung database & append-only
  j := public.fin_laporan_bekukan('laba_rugi', '2026-10', '{"net":123}'::jsonb, 'keuangan@uji');
  h := encode(extensions.digest(convert_to('{"net": 123}', 'UTF8'), 'sha256'), 'hex');
  if j->>'hash' <> h then raise exception 'GAGAL: hash % <> %', j->>'hash', h; end if;
  begin
    delete from public.fin_laporan_beku;
    raise exception 'GAGAL: laporan beku bisa dihapus';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.fin_laporan_bekukan('laba_rugi', '2026-13x', '{}'::jsonb, 'v');
    raise exception 'GAGAL: kode periode tidak sah diterima';
  exception when check_violation then null;
  end;

  -- peran baca: viewer bisa baca struktur tetapi tidak bisa tutup buku
  perform public.fin_peran_set('viewer@uji.local', 'viewer_laporan');
  perform set_config('uji.cfo', '', false);
  perform set_config('uji.email', 'viewer@uji.local', false);
  j := public.fin_ambil_struktur();
  if jsonb_array_length(j->'laporan_beku') <> 1 then raise exception 'GAGAL: viewer membaca laporan beku'; end if;
  if (j->'laporan_beku'->0) ? 'data' then raise exception 'GAGAL: daftar laporan beku tidak boleh memuat isi'; end if;
  begin
    perform public.fin_periode_tutup('2026-09-01');
    raise exception 'GAGAL: viewer bisa tutup buku';
  exception when insufficient_privilege then null;
  end;

  select count(*) into n from public.cfo_audit_log where aksi like 'fin_%';
  -- migrasi + tutup + buka + dimensi + bekukan + peran = 6 (perubahan yang ditolak tidak tercatat)
  if n < 6 then raise exception 'GAGAL: audit fin_* hanya %', n; end if;

  -- anon tidak punya akses tabel/fungsi
  if has_table_privilege('anon', 'public.fin_laporan_beku', 'select') then raise exception 'GAGAL: anon baca tabel'; end if;
  if has_function_privilege('anon', 'public.fin_periode_tutup(date, text)', 'execute') then raise exception 'GAGAL: anon eksekusi RPC'; end if;

  perform set_config('uji.email', '', false);
  raise notice 'fin_uji_struktur: SEMUA LULUS';
end;
$$;

-- bersihkan data uji (bulan tidak ditutup lagi, jadi boleh dihapus)
delete from public.jurnal where no in ('UJI-A', 'UJI-B');
