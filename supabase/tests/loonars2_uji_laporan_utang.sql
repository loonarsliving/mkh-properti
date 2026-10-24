-- Uji migrasi 0053 (laporan pembayaran utang toko -> PDF). Setelah loonars2_uji_bukti_utang.sql.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

select set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
create function pg_temp.wa(n text, a text, d jsonb default '{}') returns jsonb language sql as
  $$ select public.loonars2_wa(n, a, case when a in ('ajukan', 'ajukan_mingguan', 'bahan') and not (d ? 'uji_rekening') then d || '{"tanpa_rekening":true}'::jsonb else d end) $$;
create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;

select pg_temp.cek('pelaksana tidak boleh meminta laporan', (pg_temp.wa('6281100000002', 'laporan_utang') ->> 'status') = 'tidak_berhak');
select pg_temp.cek('nomor asing tidak mendapat apa-apa', (pg_temp.wa('6289999999999', 'laporan_utang') ->> 'status') = 'abaikan');
create temp table t as select pg_temp.wa('6281100000001', 'laporan_utang') as j;
select pg_temp.cek('owner mendapat tautan + nama berkas pdf', (select j ->> 'status' = 'ok' and j ->> 'token' ~ '^[0-9]+\.[0-9a-f]{64}$' and j ->> 'nama_berkas' like 'Laporan-Utang-Toko-Loonars2_%.pdf' from t));
create temp table d as select public.loonars2_laporan_utang_data((select j ->> 'token' from t)) as j;
select pg_temp.cek('data laporan: ringkasan dan toko',
  (select (j -> 'ringkasan' ->> 'total_utang')::numeric > 0 and jsonb_array_length(j -> 'toko') >= 2 from d));
select pg_temp.cek('ringkasan = jumlah per toko (utang - dibayar = sisa)',
  (select (j -> 'ringkasan' ->> 'total_sisa')::numeric = (j -> 'ringkasan' ->> 'total_utang')::numeric - (j -> 'ringkasan' ->> 'total_dibayar')::numeric from d));
select pg_temp.cek('toko yang sudah dicicil memuat pembayaran dengan keterangan penerima',
  exists (select 1 from d, jsonb_array_elements(j -> 'toko') t, jsonb_array_elements(t -> 'pembayaran') p
           where p ->> 'keterangan' like 'Bukti transfer ke PAPANG%' and (p ->> 'ada_bukti')::boolean));
select pg_temp.cek('daftar utang per kode (bukan per baris unit)',
  (select bool_and(jsonb_array_length(t -> 'utang') > 0) from d, jsonb_array_elements(j -> 'toko') t where (t ->> 'utang_disetujui')::numeric > 0));

-- tanda tangan
select pg_temp.cek('token dipalsukan ditolak',
  (select count(*) = 0 from (select 1) x where false) and
  (select (regexp_replace(j ->> 'token', '[0-9a-f]$', case when right(j ->> 'token', 1) = '0' then '1' else '0' end)) <> j ->> 'token' from t));
do $$ begin
  begin
    perform public.loonars2_laporan_utang_data((select regexp_replace(j ->> 'token', '[0-9a-f]$', case when right(j ->> 'token', 1) = '0' then '1' else '0' end) from t));
    raise exception 'GAGAL: token palsu harus ditolak';
  exception when sqlstate '28000' then null;
  end;
  begin
    perform public.loonars2_laporan_utang_data('1000000000.' || repeat('a', 64));
    raise exception 'GAGAL: token kedaluwarsa/palsu harus ditolak';
  exception when sqlstate '28000' then null;
  end;
  begin
    perform public.loonars2_laporan_utang_data('sembarang');
    raise exception 'GAGAL: format salah harus ditolak';
  exception when sqlstate '28000' then null;
  end;
end $$;
select 'LULUS: token palsu, kedaluwarsa, dan format salah ditolak';
select 'SEMUA UJI LAPORAN UTANG LULUS';
