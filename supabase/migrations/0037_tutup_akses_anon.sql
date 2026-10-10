-- ============================================================================
-- 0037 — Tutup akses publik (TAHAP 2 dari 2: MENCABUT akses anon)
--
-- STATUS: DITERAPKAN ke produksi 2026-10-10 (setelah log API membuktikan
-- frontend PR #13 memakai token login: semua permintaan finance.haluoleo.id
-- berstatus 200 sebagai `authenticated`).
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


-- Cara penerapan: policy lama TIDAK di-DROP tetapi dinetralkan dengan
-- `ALTER POLICY ... TO service_role` (service_role melewati RLS, jadi policy
-- itu tidak berlaku lagi untuk anon/authenticated). Alasan: setiap DROP di
-- proyek ini memicu event trigger sql_drop bawaan Supabase dan membuat klien
-- Supabase MCP menggantung (terbukti berulang kali 2026-10-10). Diterapkan
-- dalam lima blok berurutan yang masing-masing langsung diverifikasi.

-- 1. Tabel keuangan: hanya staf login (policy staf_akses_penuh dari 0036).
do $m$ declare t text; r record; begin
  foreach t in array array['jurnal','aset','utang_bank','pengajuan','bayar_tukang','tukang_borongan',
                           'crm_payment_receipts','pendapatan_villa','beban_villa','construction_project_financial_records'] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t and policyname <> 'staf_akses_penuh' and roles <> '{service_role}' loop
      execute format('alter policy %I on public.%I to service_role', r.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $m$;

-- 2. karyawan / slip_gaji (RLS sebelumnya mati), daftar staf, sync_log.
do $m$ declare t text; r record; begin
  foreach t in array array['karyawan','slip_gaji'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname='staf_akses_penuh') then
      execute format('create policy staf_akses_penuh on public.%I for all to authenticated using ((select public.mkh_is_staf())) with check ((select public.mkh_is_staf()))', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
  for r in select tablename, policyname from pg_policies where schemaname='public' and roles <> '{service_role}'
            and ((tablename='users_proyek' and policyname not in ('users_proyek_baca_login','users_proyek_kelola_cfo'))
              or (tablename='cfo_users' and policyname <> 'cfo_users_baca_sendiri')
              or (tablename='sync_log' and policyname <> 'staf_baca_sync_log')) loop
    execute format('alter policy %I on public.%I to service_role', r.policyname, r.tablename);
  end loop;
  revoke all on public.users_proyek from anon;
  revoke all on public.cfo_users from anon;
  revoke all on public.sync_log from anon;
  revoke insert, update, delete on public.sync_log from authenticated;
end $m$;

-- 3. Tabel sistem + aplikasi yang tidak dipakai lagi (loonars-sales,
--    Loonars-dashboard, filehub lama): hanya service_role. Data tidak dihapus.
do $m$ declare t text; r record; begin
  foreach t in array array['mkh_counter','mkh_projects','loonars_users','loonars_siteplan','loonars_fee','loonars_counter',
                           'orders','order_items','products','customers','settings','notifications','profiles',
                           'stock_movements','followup_schedules','users','access_requests','activity_log'] loop
    execute format('alter table public.%I enable row level security', t);
    for r in select policyname from pg_policies where schemaname='public' and tablename=t and roles <> '{service_role}' loop
      execute format('alter policy %I on public.%I to service_role', r.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  revoke all on public.v_order_summary from anon, authenticated;
end $m$;

-- 4. loonars.id (kirim pesanan saja; konten hanya baca) + fungsi internal.
do $m$ declare t text; r record; begin
  alter table public.beauty_orders enable row level security;
  revoke all on public.beauty_orders from anon, authenticated;
  grant insert on public.beauty_orders to anon, authenticated;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='beauty_orders' and policyname='situs_kirim_pesanan') then
    create policy situs_kirim_pesanan on public.beauty_orders for insert to anon, authenticated with check (true);
  end if;
  foreach t in array array['project_images','projects','site_settings'] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t and cmd <> 'SELECT' and roles <> '{service_role}' loop
      execute format('alter policy %I on public.%I to service_role', r.policyname, t);
    end loop;
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
  revoke execute on function public.sync_dispatch_pending() from public, anon, authenticated;
  revoke execute on function public.sync_collect_responses() from public, anon, authenticated;
  revoke execute on function public.next_mkh_no(text) from public, anon;
  grant execute on function public.next_mkh_no(text) to authenticated;
  foreach t in array array['loonars_closing_declared_sync()','loonars_fee_submitted_sync()',
    'pengajuan_expense_approved_sync()','pengajuan_expense_duplicate_guard()','pengajuan_expense_rejected_sync()',
    'pengajuan_expense_submitted_sync()','pengajuan_komisi_decided_sync()','trg_crm_payment_receipt_confirmed_sync()',
    'auto_fill_order_customer()','map_order_items_columns()','notify_telegram_new_order()','sync_order_items_columns()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', t);
  end loop;
end $m$;

-- 5. Rapikan: fungsi trigger/lama yang tidak perlu dipanggil dari luar.
do $m$ begin
  revoke execute on function public.jurnal_branch_balance_sync() from public, anon, authenticated;
  revoke execute on function public.ir_metrik_catat_log() from public, anon, authenticated;
  revoke execute on function public.get_my_role() from public, anon, authenticated;
  revoke execute on function public.handle_new_user() from public, anon, authenticated;
end $m$;

-- Verifikasi setelah penerapan (2026-10-10): CFO & admin proyek membaca data
-- seperti biasa; akun non-staf 0 baris; anon tidak bisa membaca jurnal,
-- loonars_users, karyawan; form lapor lapangan, gambar loonars.id, kirim
-- pesanan beauty_orders, sync_inbound, villa_income_sync tetap jalan; cron
-- sync-dispatch-pending/collect-responses tetap sukses.
