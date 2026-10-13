-- Uji migrasi 0045 (akses web baca-saja untuk pelaksana). Dijalankan SETELAH
-- loonars2_uji.sql & loonars2_uji_utang.sql pada database yang sama.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on

create function pg_temp.cek(label text, kondisi boolean) returns text language plpgsql as
  $$ begin if not coalesce(kondisi, false) then raise exception 'GAGAL: %', label; end if; return 'LULUS: ' || label; end $$;
create function pg_temp.sebagai(email text, cfo boolean) returns void language sql as
  $$ select set_config('uji.email', email, false), set_config('uji.cfo', case when cfo then 'ya' else 'tidak' end, false) $$;

insert into public.users_proyek (email, proyek_id, nama) values
  ('vando@contoh.id', 'LOONARS2', 'Vando'),
  ('admin.afp@contoh.id', 'AFP', 'Admin AFP');

-- Pelaksana (proyek LOONARS2) boleh; admin proyek biasa & orang asing tidak.
select pg_temp.sebagai('vando@contoh.id', false);
select pg_temp.cek('pelaksana LOONARS2 boleh melihat', public.loonars2_boleh_lihat());
select pg_temp.sebagai('admin.afp@contoh.id', false);
select pg_temp.cek('admin proyek lain tidak boleh', not public.loonars2_boleh_lihat());
select pg_temp.sebagai('', false);
select pg_temp.cek('tanpa login tidak boleh', not public.loonars2_boleh_lihat());
select pg_temp.sebagai('asing@contoh.id', false);
select pg_temp.cek('orang asing tidak boleh', not public.loonars2_boleh_lihat());
select pg_temp.sebagai('owner@contoh.id', true);
select pg_temp.cek('CFO boleh', public.loonars2_boleh_lihat());

-- RPC menolak yang tidak berhak.
select pg_temp.sebagai('admin.afp@contoh.id', false);
do $$ begin
  perform public.loonars2_web_lihat();
  raise exception 'GAGAL: admin proyek lain bisa memanggil loonars2_web_lihat';
exception when insufficient_privilege then null; end $$;
select 'LULUS: RPC menolak yang tidak berhak';

-- Isi RPC untuk pelaksana: ada data yang dibutuhkan, tidak ada data sensitif.
select pg_temp.sebagai('vando@contoh.id', false);
create temp table hasil as select public.loonars2_web_lihat() as j;
select pg_temp.cek('17 unit terkirim', (select jsonb_array_length(j -> 'unit') from hasil) = 17);
select pg_temp.cek('proyeksi tanah ikut', (select j -> 'proyeksi_tanah' ? 'proyeksi' from hasil));
select pg_temp.cek('utang toko & cicilan ikut', (select jsonb_array_length(j -> 'toko') > 0 and j ? 'cicilan' and j ? 'pengajuan' from hasil));
select pg_temp.cek('sisa utang TB Maju sama dengan view', (select (t ->> 'sisa_utang')::numeric from hasil, jsonb_array_elements(j -> 'toko') t where t ->> 'nama' = 'TB Maju')
                    = (select sisa_utang from loonars2_v_toko where nama = 'TB Maju'));
select pg_temp.cek('unit tidak membawa pembeli/harga/pembayaran',
  not (select (j -> 'unit' -> 0) ?| array['nama_pembeli', 'harga', 'harga_efektif', 'total_dibayar', 'sisa_pelunasan', 'c_dialokasikan', 'dp_target'] from hasil));
select pg_temp.cek('tidak ada saldo rekening/receipt/audit/pengguna WA',
  not (select j ?| array['rekening', 'receipt', 'audit', 'pengguna', 'kesehatan'] from hasil));
select pg_temp.cek('utang tidak membawa tautan nota', not (select (j -> 'utang' -> 0) ? 'nota_url' from hasil));

-- Pelaksana tidak punya akses baca langsung ke tabel/view loonars2_* (RLS) dan anon tidak boleh memanggil.
set role authenticated;
select pg_temp.cek('pelaksana tidak bisa SELECT langsung tabel receipts', (select count(*) from public.loonars2_receipts) = 0);
select pg_temp.cek('pelaksana tidak melihat rekening lewat view', (select count(*) from public.loonars2_v_rekening) = 0);
select pg_temp.cek('pelaksana tidak melihat wa_users', (select count(*) from public.loonars2_wa_users) = 0);
reset role;
select pg_temp.cek('anon tidak punya EXECUTE loonars2_web_lihat', not has_function_privilege('anon', 'public.loonars2_web_lihat()', 'execute'));
select pg_temp.cek('authenticated punya EXECUTE loonars2_web_lihat', has_function_privilege('authenticated', 'public.loonars2_web_lihat()', 'execute'));
