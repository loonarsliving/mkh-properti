-- ============================================================================
-- 0057 — AI CFO / Financial Manager (pusat keuangan Loonars 1 + Loonars 2)
-- ============================================================================
--
-- Tujuan: owner cukup membuka MKH Property untuk melihat seluruh kondisi
-- keuangan Loonars. Migrasi ini HANYA MENAMBAH:
--
--   1. cfo_pengaturan        — 1 baris: URL aplikasi, kas minimum, saklar briefing.
--   2. cfo_sumber_snapshot   — salinan baca-saja data dari database lain
--                              (MK Connect + villa, project svcmybsziaelwwdrnzcv):
--                              penjualan unit ke investor, refund customer,
--                              settlement OTA, transfer tertunda. Kunci =
--                              (sumber, jenis, source_id) → deduplikasi; hash isi
--                              → hanya baris yang berubah yang diperbarui;
--                              baris yang hilang dari sumber ditandai aktif=false,
--                              TIDAK PERNAH dihapus.
--   3. cfo_sync_log          — jejak setiap kiriman (jumlah baru/berubah/sama).
--   4. cfo_audit_log         — append-only: pertanyaan ke AI CFO, briefing yang
--                              dikirim, perubahan pengaturan. UPDATE/DELETE ditolak
--                              trigger.
--   5. RPC cfo_sumber_terima — penerima kiriman (header x-sync-secret = rahasia
--                              Vault yang SUDAH ADA; tidak ada rahasia baru).
--   6. RPC cfo_ambil_data    — HANYA BACA. Satu paket data mentah untuk mesin
--                              perhitungan deterministik di src/lib/cfo/.
--                              Akses: CFO login, atau server dengan x-sync-secret.
--   7. RPC cfo_catat         — tulis jejak audit.
--   8. RPC cfo_briefing_antre — antrekan pesan WA ke owner lewat antrean WA
--                              yang SUDAH ADA (loonars2_outbox → MK Connect →
--                              Whacenter). Tidak ada jalur WA baru.
--   9. pg_cron               — membangunkan /api/cfo/briefing (harian, mingguan,
--                              cek peringatan). Isi pesan disusun aplikasi dari
--                              angka deterministik, bukan oleh database/AI.
--  10. cfo_saldo_rekening    — saldo rekening (mis. rekening villa Loonars 1) per
--                              tanggal, dicatat CFO; append-only. Kas berjalan =
--                              saldo terakhir + mutasi villa sesudahnya (snapshot
--                              villa_kas_masuk / villa_kas_keluar).
--  11. RPC cfo_tanda_ai      — tanda tangan HMAC sekali-pakai (5 menit) agar
--                              server MKH Property boleh memakai layanan AI milik
--                              MK Connect (/api/mkh-property/ai-cfo/narasi).
--                              MKH Property TIDAK punya kunci AI sendiri.
--
-- Prinsip yang dijaga:
--   - Tidak ada tabel sumber yang diubah. Tidak ada DROP / DELETE.
--   - AI CFO tidak bisa memindahkan uang: tidak ada RPC di sini yang menulis ke
--     jurnal, loonars2_*, pengajuan, atau tabel transaksi lain.
--   - Semua tabel baru RLS aktif; hanya CFO yang bisa membaca; tulis hanya lewat
--     RPC security definer; anon tidak punya akses tabel.
--
-- Rollback (bila owner meminta): nonaktifkan cron
--   select cron.unschedule('cfo-briefing-harian'); (dan dua job lain)
-- lalu revoke execute RPC cfo_* (termasuk cfo_saldo_catat, cfo_tanda_ai) dari anon/authenticated. Tabel boleh dibiarkan
-- (tidak dibaca aplikasi lain). Tidak ada data sumber yang perlu dipulihkan.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pengaturan
-- ----------------------------------------------------------------------------
create table if not exists public.cfo_pengaturan (
  id smallint primary key default 1 check (id = 1),
  url_aplikasi text not null default 'https://finance.haluoleo.id',
  kas_minimum numeric not null default 50000000 check (kas_minimum >= 0),
  briefing_harian boolean not null default true,
  briefing_mingguan boolean not null default true,
  peringatan_otomatis boolean not null default true,
  diubah_pada timestamptz not null default now()
);
insert into public.cfo_pengaturan (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Snapshot data sumber eksternal
-- ----------------------------------------------------------------------------
create table if not exists public.cfo_sumber_snapshot (
  sumber text not null,
  jenis text not null,
  source_id text not null check (length(source_id) between 1 and 200),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  hash text not null,
  sumber_diubah_pada timestamptz,
  pertama_diterima_pada timestamptz not null default now(),
  diterima_pada timestamptz not null default now(),
  berubah_pada timestamptz not null default now(),
  aktif boolean not null default true,
  primary key (sumber, jenis, source_id)
);
create index if not exists cfo_sumber_snapshot_aktif_idx on public.cfo_sumber_snapshot (sumber, jenis) where aktif;

create table if not exists public.cfo_sync_log (
  id bigserial primary key,
  sumber text not null,
  jenis text not null,
  jumlah int not null default 0,
  baru int not null default 0,
  berubah int not null default 0,
  sama int not null default 0,
  nonaktif int not null default 0,
  lengkap boolean not null default false,
  galat text,
  diterima_pada timestamptz not null default now()
);
create index if not exists cfo_sync_log_terbaru_idx on public.cfo_sync_log (sumber, jenis, diterima_pada desc);

-- ----------------------------------------------------------------------------
-- 3. Audit log (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.cfo_audit_log (
  id bigserial primary key,
  waktu timestamptz not null default now(),
  aktor text not null,
  kanal text not null check (kanal in ('web', 'whatsapp', 'sistem')),
  aksi text not null check (length(aksi) between 1 and 60),
  ringkas jsonb not null default '{}'::jsonb
);
create index if not exists cfo_audit_log_waktu_idx on public.cfo_audit_log (waktu desc);

create or replace function public._cfo_tolak_ubah_audit()
returns trigger
language plpgsql
as $$
begin
  raise exception 'cfo_audit_log hanya boleh ditambah (append-only)' using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'cfo_audit_log_append_only') then
    create trigger cfo_audit_log_append_only
      before update or delete on public.cfo_audit_log
      for each row execute function public._cfo_tolak_ubah_audit();
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. RLS: hanya CFO yang membaca; tulis hanya lewat RPC
-- ----------------------------------------------------------------------------
alter table public.cfo_pengaturan enable row level security;
alter table public.cfo_sumber_snapshot enable row level security;
alter table public.cfo_sync_log enable row level security;
alter table public.cfo_audit_log enable row level security;

revoke all on public.cfo_pengaturan, public.cfo_sumber_snapshot, public.cfo_sync_log, public.cfo_audit_log from anon;
revoke all on public.cfo_sumber_snapshot, public.cfo_sync_log, public.cfo_audit_log from authenticated;
grant select on public.cfo_sumber_snapshot, public.cfo_sync_log, public.cfo_audit_log to authenticated;
grant select, update on public.cfo_pengaturan to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cfo_pengaturan' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_pengaturan for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cfo_pengaturan' and policyname = 'cfo_ubah') then
    create policy cfo_ubah on public.cfo_pengaturan for update to authenticated using (public.mkh_is_cfo()) with check (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cfo_sumber_snapshot' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_sumber_snapshot for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cfo_sync_log' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_sync_log for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cfo_audit_log' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_audit_log for select to authenticated using (public.mkh_is_cfo());
  end if;
end;
$$;

-- Perubahan pengaturan ikut tercatat di audit log.
create or replace function public._cfo_audit_pengaturan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.diubah_pada := now();
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (coalesce('cfo:' || public.mkh_email_login(), 'sistem'), 'web', 'ubah_pengaturan',
          jsonb_build_object('sebelum', to_jsonb(old), 'sesudah', to_jsonb(new)));
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'cfo_pengaturan_audit') then
    create trigger cfo_pengaturan_audit
      before update on public.cfo_pengaturan
      for each row execute function public._cfo_audit_pengaturan();
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4b. Saldo rekening per tanggal (append-only)
-- ----------------------------------------------------------------------------
-- Sistem villa tidak bisa membaca bank; saldo rekening villa hanya diisi manual
-- (sebelumnya hanya di localStorage browser halaman villa). Di sini saldo
-- dicatat CFO dengan tanggal saldo; koreksi = baris baru, tidak ada UPDATE/DELETE.
create table if not exists public.cfo_saldo_rekening (
  id bigserial primary key,
  lini text not null check (lini in ('L1', 'L2')),
  rekening text not null check (length(rekening) between 2 and 80),
  saldo numeric not null check (saldo = round(saldo)),
  per_tanggal date not null,
  catatan text check (catatan is null or length(catatan) <= 300),
  dicatat_oleh text not null,
  dibuat_pada timestamptz not null default now()
);
create index if not exists cfo_saldo_rekening_terbaru_idx on public.cfo_saldo_rekening (lini, rekening, per_tanggal desc, id desc);
alter table public.cfo_saldo_rekening enable row level security;
revoke all on public.cfo_saldo_rekening from anon;
revoke all on public.cfo_saldo_rekening from authenticated;
grant select on public.cfo_saldo_rekening to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cfo_saldo_rekening' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_saldo_rekening for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cfo_saldo_rekening_append_only') then
    create trigger cfo_saldo_rekening_append_only
      before update or delete on public.cfo_saldo_rekening
      for each row execute function public._cfo_tolak_ubah_audit();
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Siapa pemanggilnya?
--    'cfo:<email>'  — CFO login (cfo_users)
--    'wa:<nomor>'   — server MK Connect atas nama super admin (x-sync-secret
--                     mk_sync_shared_secret, sama dengan ir_boleh_akses)
--    'sistem'       — server dengan x-sync-secret tanpa nomor (cron briefing)
--    null           — ditolak
-- ----------------------------------------------------------------------------
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
begin
  if public.mkh_is_cfo() then
    return 'cfo:' || public.mkh_email_login();
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

-- ----------------------------------------------------------------------------
-- 6. Penerima kiriman snapshot
-- ----------------------------------------------------------------------------
-- p_baris: [{ "id": "<source id>", "diubah_pada": "<timestamptz|null>", "data": {...} }, ...]
-- p_lengkap: true = kiriman ini memuat SEMUA baris aktif jenis tsb di sumber;
--            baris yang tidak ikut terkirim ditandai aktif=false (tidak dihapus).
create or replace function public.cfo_sumber_terima(
  p_jenis text,
  p_baris jsonb,
  p_lengkap boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_hdr json := current_setting('request.headers', true)::json;
  v_provided text := coalesce(v_hdr ->> 'x-sync-secret', current_setting('request.header.x-sync-secret', true));
  v_mk text;
  v_villa text;
  v_sumber text;
  v_boleh text[];
  v_el jsonb;
  v_id text;
  v_data jsonb;
  v_hash text;
  v_diubah timestamptz;
  v_lama record;
  v_ids text[] := '{}';
  v_baru int := 0;
  v_berubah int := 0;
  v_sama int := 0;
  v_nonaktif int := 0;
begin
  select decrypted_secret into v_mk from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select decrypted_secret into v_villa from vault.decrypted_secrets where name = 'villa_sync_shared_secret';

  -- Pengirim ditentukan oleh RAHASIA yang cocok, bukan oleh klaim pemanggil.
  if v_mk is not null and v_provided is not distinct from v_mk then
    -- Database MK Connect + villa (project bersama svcmybsziaelwwdrnzcv).
    v_sumber := 'svcmyb';
    v_boleh := array['investor_penjualan', 'refund_customer', 'transfer_tertunda', 'ota_settlement', 'pengajuan_biaya_villa',
                     'villa_kas_masuk', 'villa_kas_keluar'];
  elsif v_villa is not null and v_provided is not distinct from v_villa then
    v_sumber := 'villa_api';
    v_boleh := array['ota_settlement', 'pengajuan_biaya_villa', 'villa_kas_masuk', 'villa_kas_keluar'];
  else
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_jenis is null or not (p_jenis = any (v_boleh)) then
    raise exception 'Jenis tidak dikenal: %', p_jenis using errcode = '22023';
  end if;
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' then
    raise exception 'p_baris harus array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_baris) > 5000 then
    raise exception 'Terlalu banyak baris (maks 5000)' using errcode = '22023';
  end if;

  for v_el in select value from jsonb_array_elements(p_baris) loop
    v_id := nullif(trim(v_el ->> 'id'), '');
    v_data := v_el -> 'data';
    if v_id is null or length(v_id) > 200 or v_data is null or jsonb_typeof(v_data) <> 'object' then
      raise exception 'Baris tidak valid (id/data)' using errcode = '22023';
    end if;
    begin
      v_diubah := nullif(v_el ->> 'diubah_pada', '')::timestamptz;
    exception when others then
      v_diubah := null;
    end;
    v_hash := md5(v_data::text);
    v_ids := v_ids || v_id;

    select hash, aktif into v_lama from public.cfo_sumber_snapshot
     where sumber = v_sumber and jenis = p_jenis and source_id = v_id
     for update;
    if not found then
      insert into public.cfo_sumber_snapshot (sumber, jenis, source_id, data, hash, sumber_diubah_pada)
      values (v_sumber, p_jenis, v_id, v_data, v_hash, v_diubah);
      v_baru := v_baru + 1;
    elsif v_lama.hash is distinct from v_hash or not v_lama.aktif then
      update public.cfo_sumber_snapshot
         set data = v_data, hash = v_hash, sumber_diubah_pada = v_diubah,
             diterima_pada = now(), berubah_pada = now(), aktif = true
       where sumber = v_sumber and jenis = p_jenis and source_id = v_id;
      v_berubah := v_berubah + 1;
    else
      update public.cfo_sumber_snapshot set diterima_pada = now()
       where sumber = v_sumber and jenis = p_jenis and source_id = v_id;
      v_sama := v_sama + 1;
    end if;
  end loop;

  if coalesce(p_lengkap, false) then
    update public.cfo_sumber_snapshot
       set aktif = false, berubah_pada = now()
     where sumber = v_sumber and jenis = p_jenis and aktif
       and not (source_id = any (v_ids));
    get diagnostics v_nonaktif = row_count;
  end if;

  insert into public.cfo_sync_log (sumber, jenis, jumlah, baru, berubah, sama, nonaktif, lengkap)
  values (v_sumber, p_jenis, jsonb_array_length(p_baris), v_baru, v_berubah, v_sama, v_nonaktif, coalesce(p_lengkap, false));

  return jsonb_build_object('status', 'ok', 'sumber', v_sumber, 'jenis', p_jenis,
    'baru', v_baru, 'berubah', v_berubah, 'sama', v_sama, 'nonaktif', v_nonaktif);
end;
$$;
revoke execute on function public.cfo_sumber_terima(text, jsonb, boolean) from public;
grant execute on function public.cfo_sumber_terima(text, jsonb, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Paket data (HANYA BACA) untuk mesin perhitungan
-- ----------------------------------------------------------------------------
-- Angka mentah saja. Semua rumus (laba rugi, arus kas, forecast, peringatan)
-- ada di src/lib/cfo/ dan diuji vitest. Nomor rekening bank, NIK, telepon,
-- dan alamat sengaja TIDAK disertakan (izin minimum).
create or replace function public.cfo_ambil_data(p_peminta_wa text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(p_peminta_wa);
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'versi', 1,
    'dibuat_pada', now(),
    'akses', split_part(v_akses, ':', 1),
    'pengaturan', (select to_jsonb(p) - 'id' from public.cfo_pengaturan p where id = 1),

    -- ── Loonars 1 (hospitality) ── kiriman harian villa-api (0054) + KPI (0040)
    'l1_laporan', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periode', l.periode, 'status', l.status, 'omzet_kotor', l.omzet_kotor, 'komisi_ota', l.komisi_ota,
        'pendapatan_bersih', l.pendapatan_bersih, 'pendapatan_walkin', l.pendapatan_walkin,
        'malam_terjual', l.malam_terjual, 'malam_gratis', l.malam_gratis, 'malam_tersedia', l.malam_tersedia,
        'okupansi_pct', l.okupansi_pct, 'cogs', l.cogs, 'gross_profit', l.gross_profit, 'opex', l.opex,
        'net_profit', l.net_profit, 'channel', l.rincian -> 'channel', 'bagi_hasil', l.rincian -> 'bagi_hasil',
        'opex_rincian', l.rincian -> 'opex_rincian', 'diterima_pada', l.diterima_pada) order by l.periode)
      from public.laporan_villa_bulanan l), '[]'::jsonb),
    'l1_metrik', coalesce((
      select jsonb_agg(jsonb_build_object('periode', m.periode, 'status', m.status, 'metrik', m.metrik,
                                          'diterima_pada', m.diterima_pada) order by m.periode)
      from public.ir_metrik_bulanan m join public.ir_unit_bisnis u on u.id = m.unit_id
      where u.kode = 'loonars-1'), '[]'::jsonb),
    'l1_pajak', coalesce((
      select jsonb_agg(jsonb_build_object('periode', p.periode, 'tarif_pct', p.tarif_pct, 'dasar', p.dasar,
        'pajak_terutang', p.pajak_terutang, 'jumlah_disetor', p.jumlah_disetor, 'tgl_setor', p.tgl_setor) order by p.periode)
      from public.pajak_hotel_villa p), '[]'::jsonb),

    -- ── Loonars 2 (developer & konstruksi) ── modul 4 rekening (0043–0056)
    'l2_pengaturan', (select jsonb_build_object('target_tanah', s.target_tanah, 'jatuh_tempo_tanah', s.jatuh_tempo_tanah,
                       'dp_persen_default', s.dp_persen_default) from public.loonars2_settings s where s.id = 1),
    'l2_unit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'kode', v.kode, 'tipe', v.tipe, 'nama_pembeli', v.nama_pembeli, 'status', v.status,
        'status_bangun', v.status_bangun, 'sedang_dibangun', u.sedang_dibangun, 'harga', v.harga_efektif,
        'biaya_bangun', v.biaya_bangun, 'buffer', v.buffer, 'fee', v.fee, 'kebutuhan_c', v.kebutuhan_c,
        'dp_target', v.dp_target, 'total_dibayar', v.total_dibayar, 'sisa_pelunasan', v.sisa_pelunasan,
        'terpakai_konstruksi', v.terpakai_konstruksi, 'utang_disetujui', v.utang_disetujui,
        'keluar_c', v.keluar_c, 'jatuh_tempo', v.jatuh_tempo_efektif, 'is_unit_contoh', v.is_unit_contoh) order by v.nomor)
      from public.loonars2_v_unit v join public.loonars2_units u on u.id = v.id), '[]'::jsonb),
    'l2_rekening', coalesce((
      select jsonb_agg(jsonb_build_object('kode', r.kode, 'nama', r.nama, 'saldo_awal', r.saldo_awal,
        'saldo', r.saldo, 'menunggu_transfer', r.menunggu_transfer) order by r.kode)
      from public.loonars2_v_rekening r), '[]'::jsonb),
    'l2_penerimaan', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'unit_id', x.unit_id, 'jenis', x.jenis, 'nominal', x.nominal,
        'tanggal', x.tanggal, 'status', x.status) order by x.id)
      from public.loonars2_receipts x), '[]'::jsonb),
    'l2_pengeluaran', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'dari', d.dari_rekening, 'kategori', d.kategori,
        'unit_id', d.unit_id, 'nominal', d.nominal, 'tanggal', d.tanggal, 'talangan', d.talangan,
        'toko_id', d.toko_id, 'cicilan_id', d.cicilan_id) order by d.id)
      from public.loonars2_disbursements d), '[]'::jsonb),
    'l2_toko', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'nama', t.nama, 'utang_disetujui', t.utang_disetujui,
        'utang_menunggu', t.utang_menunggu, 'cicilan_dibayar', t.cicilan_dibayar,
        'cicilan_diproses', t.cicilan_diproses, 'sisa_utang', t.sisa_utang) order by t.id)
      from public.loonars2_v_toko t), '[]'::jsonb),
    'l2_cicilan', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'kelompok', c.kelompok, 'toko_id', c.toko_id,
        'nominal', c.nominal, 'status', c.status, 'dibuat_pada', c.dibuat_pada) order by c.id)
      from public.loonars2_cicilan c), '[]'::jsonb),
    'l2_pengajuan_menunggu', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kategori', m.kategori, 'unit_id', m.unit_id,
        'nominal', m.nominal, 'kelompok', m.kelompok, 'dibuat_pada', m.dibuat_pada) order by m.id)
      from public.loonars2_material_requests m where m.status = 'menunggu'), '[]'::jsonb),

    -- ── Buku besar MKH (semua proyek, termasuk LL = Loonars Living) ── agregat
    'jurnal_bulanan', coalesce((
      select jsonb_agg(jsonb_build_object('proyek', j.proyek, 'akun', j.akun, 'bulan', j.bulan,
        'd', j.d, 'k', j.k, 'n', j.n))
      from (select proyek, akun, to_char(tgl, 'YYYY-MM') bulan, sum(coalesce(d, 0)) d, sum(coalesce(k, 0)) k, count(*) n
              from public.jurnal group by 1, 2, 3) j), '[]'::jsonb),
    'pengajuan_menunggu', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'proyek', p.proyek, 'tipe', p.tipe,
        'nominal', case when (p.data ->> 'nominal') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p.data ->> 'nominal')::numeric else 0 end,
        'dibuat_pada', p.created_at) order by p.id)
      from public.pengajuan p where p.status = 'pending'), '[]'::jsonb),
    'utang_bank', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'proyek', u.proyek, 'jenis', u.jenis, 'bank', u.bank,
        'pokok', u.pokok, 'terbayar', u.terbayar, 'jt_tempo', u.jt_tempo) order by u.id)
      from public.utang_bank u), '[]'::jsonb),

    -- ── Saldo rekening tercatat (terbaru per rekening) ──
    'saldo_rekening', coalesce((
      select jsonb_agg(jsonb_build_object('lini', x.lini, 'rekening', x.rekening, 'saldo', x.saldo,
        'per_tanggal', x.per_tanggal, 'catatan', x.catatan, 'dicatat_oleh', x.dicatat_oleh, 'dibuat_pada', x.dibuat_pada))
      from (select distinct on (lini, rekening) * from public.cfo_saldo_rekening
             order by lini, rekening, per_tanggal desc, id desc) x), '[]'::jsonb),

    -- ── Snapshot sumber eksternal (MK Connect + villa) ──
    'snapshot', coalesce((
      select jsonb_agg(jsonb_build_object('sumber', s.sumber, 'jenis', s.jenis, 'id', s.source_id,
        'data', s.data, 'diterima_pada', s.diterima_pada, 'sumber_diubah_pada', s.sumber_diubah_pada))
      from public.cfo_sumber_snapshot s where s.aktif), '[]'::jsonb),

    -- ── Kesegaran data per sumber (Integration & Sync Monitoring) ──
    'kesegaran', jsonb_build_object(
      'l1_laporan', (select max(diterima_pada) from public.laporan_villa_bulanan),
      'l1_metrik', (select max(m.diterima_pada) from public.ir_metrik_bulanan m),
      'l2_pengeluaran', (select max(dibuat_pada) from public.loonars2_disbursements),
      'l2_utang_toko', (select max(dibuat_pada) from public.loonars2_utang_toko),
      'l2_penerimaan', (select max(dibuat_pada) from public.loonars2_receipts),
      'jurnal', (select max(created_at) from public.jurnal),
      'jurnal_mk_connect', (select max(created_at) from public.jurnal where source_system = 'mk_connect')
    ),
    'sync_log', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.sumber, x.jenis)
      from (select distinct on (sumber, jenis) sumber, jenis, jumlah, baru, berubah, sama, nonaktif, lengkap, galat, diterima_pada
              from public.cfo_sync_log order by sumber, jenis, diterima_pada desc) x), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.cfo_ambil_data(text) from public;
grant execute on function public.cfo_ambil_data(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Jejak audit
-- ----------------------------------------------------------------------------
create or replace function public.cfo_catat(
  p_aksi text,
  p_ringkas jsonb default '{}'::jsonb,
  p_peminta_wa text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(p_peminta_wa);
  v_kanal text;
  v_id bigint;
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_aksi is null or p_aksi !~ '^[a-z_]{1,60}$' then
    raise exception 'Aksi tidak valid' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_ringkas, '{}'::jsonb)::text) > 20000 then
    raise exception 'Ringkasan terlalu besar' using errcode = '22023';
  end if;
  v_kanal := case split_part(v_akses, ':', 1) when 'cfo' then 'web' when 'wa' then 'whatsapp' else 'sistem' end;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_akses, v_kanal, p_aksi, coalesce(p_ringkas, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.cfo_catat(text, jsonb, text) from public;
grant execute on function public.cfo_catat(text, jsonb, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8b. Catat saldo rekening (CFO)
-- ----------------------------------------------------------------------------
create or replace function public.cfo_saldo_catat(
  p_lini text,
  p_rekening text,
  p_saldo numeric,
  p_per_tanggal date,
  p_catatan text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_aktor text;
begin
  if not public.mkh_is_cfo() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_lini not in ('L1', 'L2') or p_rekening is null or length(trim(p_rekening)) not between 2 and 80 then
    raise exception 'Lini/rekening tidak valid' using errcode = '22023';
  end if;
  if p_saldo is null or p_saldo <> round(p_saldo) then
    raise exception 'Saldo harus rupiah bulat' using errcode = '22023';
  end if;
  if p_per_tanggal is null or p_per_tanggal > (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Tanggal saldo tidak boleh kosong atau di masa depan' using errcode = '22023';
  end if;
  v_aktor := 'cfo:' || public.mkh_email_login();
  insert into public.cfo_saldo_rekening (lini, rekening, saldo, per_tanggal, catatan, dicatat_oleh)
  values (p_lini, trim(p_rekening), p_saldo, p_per_tanggal, nullif(trim(p_catatan), ''), v_aktor)
  returning id into v_id;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'catat_saldo', jsonb_build_object('id', v_id, 'lini', p_lini, 'rekening', trim(p_rekening),
          'saldo', p_saldo, 'per_tanggal', p_per_tanggal));
  return v_id;
end;
$$;
revoke execute on function public.cfo_saldo_catat(text, text, numeric, date, text) from public, anon;
grant execute on function public.cfo_saldo_catat(text, text, numeric, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8c. Tanda tangan untuk layanan AI MK Connect
-- ----------------------------------------------------------------------------
-- Server MKH Property menghitung sha256 isi permintaan narasi, lalu meminta
-- tanda tangan di sini (hanya CFO / pemegang rahasia sync). MK Connect
-- memverifikasi HMAC-SHA256('ai-cfo-narasi|<ts>|<sha256>') dengan rahasia sync
-- yang sama (get_sync_secret) dan menolak bila lebih dari 5 menit. Rahasia
-- tidak pernah keluar dari database.
create or replace function public.cfo_tanda_ai(p_hash text, p_peminta_wa text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
  v_ts bigint := floor(extract(epoch from now()))::bigint;
begin
  if public._cfo_akses(p_peminta_wa) is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash tidak valid' using errcode = '22023';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  if v_secret is null then
    raise exception 'Rahasia sync tidak tersedia' using errcode = '55000';
  end if;
  return jsonb_build_object('ts', v_ts,
    'sig', encode(extensions.hmac(('ai-cfo-narasi|' || v_ts || '|' || p_hash)::bytea, v_secret::bytea, 'sha256'), 'hex'));
end;
$$;
revoke execute on function public.cfo_tanda_ai(text, text) from public;
grant execute on function public.cfo_tanda_ai(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. Antrekan briefing WA ke owner (antrean WA yang sudah ada)
-- ----------------------------------------------------------------------------
-- Penerima = loonars2_wa_users peran 'owner' yang aktif (sudah diisi owner
-- untuk modul Loonars 2). Kunci unik per (kunci, nomor) → briefing yang sama
-- tidak pernah terkirim dua kali walau cron/route dipanggil ulang.
create or replace function public.cfo_briefing_antre(
  p_jenis text,
  p_pesan text,
  p_kunci text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(null);
  v_set public.cfo_pengaturan;
  v_owner record;
  v_masuk int := 0;
  v_n int;
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_jenis not in ('harian', 'mingguan', 'peringatan', 'manual') then
    raise exception 'Jenis briefing tidak dikenal' using errcode = '22023';
  end if;
  if p_pesan is null or length(p_pesan) not between 1 and 4000 then
    raise exception 'Pesan kosong / terlalu panjang' using errcode = '22023';
  end if;
  if p_kunci is null or p_kunci !~ '^[A-Za-z0-9:_.-]{1,120}$' then
    raise exception 'Kunci tidak valid' using errcode = '22023';
  end if;

  select * into v_set from public.cfo_pengaturan where id = 1;
  if p_jenis = 'harian' and not v_set.briefing_harian
     or p_jenis = 'mingguan' and not v_set.briefing_mingguan
     or p_jenis = 'peringatan' and not v_set.peringatan_otomatis then
    return jsonb_build_object('status', 'nonaktif', 'antre', 0);
  end if;

  for v_owner in select nomor from public.loonars2_wa_users where peran = 'owner' and aktif loop
    insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
    values (v_owner.nomor, p_pesan, 'cfo_' || p_jenis, 'cfo:' || p_kunci || ':' || v_owner.nomor)
    on conflict (kunci) do nothing;
    get diagnostics v_n = row_count;
    v_masuk := v_masuk + v_n;
  end loop;

  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_akses, case when v_akses like 'cfo:%' then 'web' else 'sistem' end, 'briefing_' || p_jenis,
          jsonb_build_object('kunci', p_kunci, 'antre', v_masuk, 'panjang', length(p_pesan)));

  return jsonb_build_object('status', 'ok', 'antre', v_masuk);
end;
$$;
revoke execute on function public.cfo_briefing_antre(text, text, text) from public;
grant execute on function public.cfo_briefing_antre(text, text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. pg_cron → /api/cfo/briefing (aplikasi menyusun pesan dari angka deterministik)
-- ----------------------------------------------------------------------------
create or replace function public.cfo_briefing_bangunkan(p_jenis text)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  v_url text;
begin
  if p_jenis not in ('harian', 'mingguan', 'peringatan') then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select url_aplikasi into v_url from public.cfo_pengaturan where id = 1;
  if v_secret is null or v_url is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/cfo/briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('jenis', p_jenis),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public.cfo_briefing_bangunkan(text) from public, anon, authenticated;

-- Jadwal (UTC). 23:07 UTC = 07:07 WITA / 06:07 WIB.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('cfo-briefing-harian', '7 23 * * *', $c$select public.cfo_briefing_bangunkan('harian')$c$);
    perform cron.schedule('cfo-briefing-mingguan', '17 23 * * 0', $c$select public.cfo_briefing_bangunkan('mingguan')$c$);
    perform cron.schedule('cfo-cek-peringatan', '37 */6 * * *', $c$select public.cfo_briefing_bangunkan('peringatan')$c$);
  end if;
end;
$$;
