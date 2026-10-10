-- ============================================================================
-- 0037 — Tutup akses publik (TAHAP 2 dari 2: MENCABUT akses anon)
--
-- PRASYARAT (wajib, urut):
--   1. 0036 sudah diterapkan.
--   2. Frontend yang mengirim token login (src/lib/supabase.ts) dan memakai
--      RPC lapor_lapangan_kirim sudah LIVE di finance.haluoleo.id, dan log API
--      menunjukkan permintaan role `authenticated` dari finance.haluoleo.id
--      berhasil (200) untuk tabel-tabel keuangan.
--   Menerapkan ini sebelum (2) akan memutus aplikasi keuangan untuk semua orang.
--
-- Yang TETAP berjalan setelah migrasi ini (diverifikasi dari log API & kode):
--   - MK Connect → rpc/sync_inbound (SECURITY DEFINER, dijaga x-sync-secret)
--   - Villa      → rpc/villa_income_sync (SECURITY DEFINER, dijaga secret)
--   - Edge Function sync-inbound / admin-create-user (service_role)
--   - Mkhsistem FDW (role mkhsistem_reader, hanya kos_*)
--   - loonars.id: baca project_images/projects/site_settings, kirim beauty_orders
--   - pg_cron sync_dispatch_pending / sync_collect_responses (sebagai postgres)
--   - Semua trigger (trigger tidak memeriksa izin EXECUTE pemanggil)
--
-- Aplikasi yang dinyatakan owner TIDAK DIPAKAI LAGI (2026-10-10) dan aksesnya
-- ikut dikunci: loonars-sales, Loonars-dashboard, aplikasi Kos, filehub lama.
-- Tidak ada tabel atau data yang dihapus — hanya akses yang dicabut, sehingga
-- bisa dibuka kembali bila ternyata masih dibutuhkan.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Helper: buang SEMUA policy lama pada sebuah tabel (nama policy lama tidak
-- konsisten — public_*, anon_*, auth_*), lalu biarkan hanya yang ditentukan.
-- ----------------------------------------------------------------------------
create or replace function pg_temp.buang_policy_kecuali(p_tabel text, p_simpan text[])
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = p_tabel
      and not (policyname = any (p_simpan))
  loop
    execute format('drop policy %I on public.%I', r.policyname, p_tabel);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Tabel keuangan: hanya staf login (policy staf_akses_penuh dari 0036).
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'jurnal', 'aset', 'utang_bank', 'pengajuan', 'bayar_tukang',
    'tukang_borongan', 'crm_payment_receipts', 'pendapatan_villa',
    'beban_villa', 'construction_project_financial_records'
  ]
  loop
    perform pg_temp.buang_policy_kecuali(t, array['staf_akses_penuh']);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- karyawan / slip_gaji: RLS sebelumnya MATI (kolom rekening & gaji terbuka).
do $$
declare
  t text;
begin
  foreach t in array array['karyawan', 'slip_gaji']
  loop
    execute format('alter table public.%I enable row level security', t);
    perform pg_temp.buang_policy_kecuali(t, array[]::text[]);
    execute format(
      'create policy staf_akses_penuh on public.%I for all to authenticated '
      'using ((select public.mkh_is_staf())) with check ((select public.mkh_is_staf()))',
      t
    );
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Daftar staf: tidak lagi bisa dibaca tanpa login.
do $$ begin perform pg_temp.buang_policy_kecuali('users_proyek', array['users_proyek_baca_login', 'users_proyek_kelola_cfo']); end $$;
do $$ begin perform pg_temp.buang_policy_kecuali('cfo_users', array['cfo_users_baca_sendiri']); end $$;
revoke all on public.users_proyek from anon;
revoke all on public.cfo_users from anon;

-- sync_log: payload memuat nama & nominal; hanya staf yang boleh membaca.
do $$ begin perform pg_temp.buang_policy_kecuali('sync_log', array['staf_baca_sync_log']); end $$;
revoke all on public.sync_log from anon;
revoke insert, update, delete on public.sync_log from authenticated;

-- Tabel pendukung sistem (RLS sebelumnya mati). Diakses hanya oleh fungsi
-- SECURITY DEFINER (next_mkh_no, sync_inbound) dan service_role.
do $$
declare
  t text;
begin
  foreach t in array array['mkh_counter', 'mkh_projects']
  loop
    execute format('alter table public.%I enable row level security', t);
    perform pg_temp.buang_policy_kecuali(t, array[]::text[]);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Aplikasi yang tidak dipakai lagi — kunci total (hanya service_role).
--    loonars-sales: loonars_users memuat hash password; loonars_fee/siteplan.
--    Loonars-dashboard: orders, customers (data pelanggan), dll.
--    filehub lama: users (ada kolom password), access_requests, activity_log.
--    Trigger yang menulis ke tabel ini (mis. pengajuan_komisi_decided_sync →
--    loonars_fee) adalah SECURITY DEFINER sehingga tetap berjalan.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'loonars_users', 'loonars_siteplan', 'loonars_fee', 'loonars_counter',
    'orders', 'order_items', 'products', 'customers', 'settings',
    'notifications', 'profiles', 'stock_movements', 'followup_schedules',
    'users', 'access_requests', 'activity_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    perform pg_temp.buang_policy_kecuali(t, array[]::text[]);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

revoke all on public.v_order_summary from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Situs loonars.id — tetap berjalan, tapi tidak bisa diubah orang luar.
-- ----------------------------------------------------------------------------
-- beauty_orders: form pemesanan di loonars.id hanya MENGIRIM pesanan
-- (supabase-js insert tanpa select). Membaca/mengubah pesanan orang lain
-- tidak lagi mungkin.
alter table public.beauty_orders enable row level security;
do $$ begin perform pg_temp.buang_policy_kecuali('beauty_orders', array[]::text[]); end $$;
revoke all on public.beauty_orders from anon, authenticated;
grant insert on public.beauty_orders to anon, authenticated;
create policy situs_kirim_pesanan on public.beauty_orders for insert to anon, authenticated
  with check (true);

-- Konten situs: baca publik tetap; tulis dicabut (dulu pengguna login mana
-- pun — termasuk akun daftar-sendiri — bisa mengubah gambar/teks situs).
do $$
declare
  t text;
  keep text[];
begin
  foreach t in array array['project_images', 'projects', 'site_settings']
  loop
    keep := array(
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    );
    perform pg_temp.buang_policy_kecuali(t, keep);
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Fungsi yang tidak boleh dipanggil dari luar.
--    (sync_inbound & villa_income_sync SENGAJA tetap bisa dipanggil anon —
--    keduanya diverifikasi secret di dalam fungsi dan memang dipanggil
--    MK Connect / villa lewat anon key.)
-- ----------------------------------------------------------------------------
revoke execute on function public.sync_dispatch_pending() from public, anon, authenticated;
revoke execute on function public.sync_collect_responses() from public, anon, authenticated;
revoke execute on function public.next_mkh_no(text) from public, anon;
grant execute on function public.next_mkh_no(text) to authenticated;

-- Fungsi trigger: memanggilnya langsung lewat RPC tidak ada gunanya; trigger
-- tetap berjalan karena PostgreSQL tidak memeriksa EXECUTE saat trigger aktif.
do $$
declare
  f text;
begin
  foreach f in array array[
    'loonars_closing_declared_sync()', 'loonars_fee_submitted_sync()',
    'pengajuan_expense_approved_sync()', 'pengajuan_expense_duplicate_guard()',
    'pengajuan_expense_rejected_sync()', 'pengajuan_expense_submitted_sync()',
    'pengajuan_komisi_decided_sync()', 'trg_crm_payment_receipt_confirmed_sync()',
    'auto_fill_order_customer()', 'map_order_items_columns()',
    'notify_telegram_new_order()', 'sync_order_items_columns()'
  ]
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
