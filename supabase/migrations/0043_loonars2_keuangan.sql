-- ============================================================================
-- 0043 — Modul Keuangan Loonars 2 (sistem 4 rekening + pengajuan via WA)
--
-- Keputusan owner (2026-10-11):
--   - Loonars 2 = 17 unit villa leasehold (siteplan MK Connect `LNR2`):
--       AVARA-01..06 + BANYU-01..06 = 12 unit "1 Kamar" Rp 420 jt
--       LUNARA-01..05              =  5 unit "2 Kamar" Rp 600 jt
--   - Biaya bangun 120 jt / 160 jt, buffer 15% biaya bangun, fee marketing
--     8% dari harga jual (sama dengan tarif komisi MK Connect 0275).
--   - Sewa tanah 20 th Rp 1 M, lunas dalam 12 bulan. DP default 50%.
--   SEMUA angka di atas hanya NILAI AWAL di tabel pengaturan — bisa diedit
--   lewat halaman /loonars2 atau WA owner; tidak ada yang di-hardcode di
--   fungsi. Harga, DP%, dan fee% boleh di-override per unit (negosiasi).
--
-- Empat rekening:
--   A Penampung — semua pembayaran pembeli masuk ke sini, hanya boleh keluar
--     sebagai transfer alokasi ke B/C/D.
--   B Tanah — hanya pembayaran tanah.
--   C Konstruksi & Fee — pengajuan material/tukang yang disetujui, fee.
--   D Profit — hanya pencairan yang lolos syarat milestone.
--
-- Aturan alokasi "unit terdanai penuh dulu" (_loonars2_hitung_alokasi):
--   setiap pembayaran pembeli → C sampai kebutuhan C unit itu penuh
--   (biaya bangun + buffer + fee) → sisanya B sampai target tanah →
--   sisanya D. Dihitung per unit. Semua nominal rupiah bulat, jadi jumlah
--   alokasi SELALU sama persis dengan nominal masuk (dijaga juga oleh
--   constraint trigger loonars2_cek_jumlah_alokasi).
--   "Target tanah sudah tercapai" diukur dari TOTAL yang pernah dialokasikan
--   ke B (termasuk yang belum dikonfirmasi), bukan saldo B — supaya
--   pembayaran tanah tidak membuat target terlihat kosong lagi.
--
-- Sistem TIDAK memindahkan uang. Saldo dihitung dari buku besar
-- (loonars2_v_rekening): receipt menambah A; alokasi yang DIKONFIRMASI
-- memindahkan A → B/C/D; pengeluaran mengurangi B/C/D. Tidak ada kolom
-- saldo yang bisa diedit sehingga saldo tidak mungkin melenceng.
--
-- Akses:
--   - Web: hanya CFO/owner (cfo_users, mkh_is_cfo() dari 0036). Tabel
--     pengaturan/rekening/unit/nomor WA boleh diedit langsung; uang
--     (receipt, alokasi, pengajuan, pengeluaran) hanya lewat RPC loonars2_web.
--   - WhatsApp: MK Connect memanggil RPC loonars2_wa lewat route
--     /api/loonars2/wa dengan header x-sync-secret = Vault
--     mk_sync_shared_secret yang SUDAH ADA (pola sama dengan 0041/0042).
--     Tidak ada rahasia baru dan tidak ada service-role key.
--   - Nomor WA di-whitelist per peran (loonars2_wa_users). Nomor tak dikenal
--     diabaikan dan dicatat di loonars2_wa_log.
--   - Setiap perubahan data tercatat di loonars2_audit_log (siapa, kapan,
--     web/wa/sistem, nilai lama & baru).
--
-- Pengiriman WA keluar (pengingat, laporan, perintah transfer dari web):
-- antre di loonars2_outbox → pg_cron membangunkan MK Connect
-- (/api/loonars2/outbox) → MK Connect mengambil antrean lewat loonars2_wa
-- dan mengirimnya dengan jalur Whacenter yang sudah ada. Tidak menyentuh
-- sync_inbound/sync_log.
--
-- Catatan penerapan: tanpa `if exists/if not exists` dan tanpa SELECT di
-- tingkat atas (lihat catatan di 0036/CURRENT_STATE.md).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabel
-- ----------------------------------------------------------------------------
create table public.loonars2_settings (
  id smallint primary key default 1 check (id = 1),
  target_tanah numeric not null default 1000000000 check (target_tanah >= 0 and target_tanah = round(target_tanah)),
  jatuh_tempo_tanah date,
  dp_persen_default numeric not null default 50 check (dp_persen_default > 0 and dp_persen_default <= 100),
  jam_mulai_pengingat smallint not null default 8 check (jam_mulai_pengingat between 0 and 23),
  jam_selesai_pengingat smallint not null default 21 check (jam_selesai_pengingat between 1 and 24),
  interval_pengingat_jam smallint not null default 2 check (interval_pengingat_jam between 1 and 24),
  eskalasi_jam smallint not null default 24 check (eskalasi_jam between 1 and 168),
  -- Syarat pencairan profit dari D. Transfer tertunda SELALU memblokir
  -- (aturan keras), terlepas dari isi kolom ini.
  milestone_profit jsonb not null default
    '{"wajib_target_tanah_terkonfirmasi": true, "wajib_unit_terjual_terdanai_penuh": true, "min_unit_serah_terima": 0}'::jsonb,
  mk_connect_url text not null default 'https://mkh.haluoleo.id',
  diubah_pada timestamptz not null default now()
);

create table public.loonars2_unit_types (
  id smallint generated always as identity primary key,
  nama text not null unique check (length(nama) between 2 and 40),
  harga numeric not null check (harga > 0 and harga = round(harga)),
  biaya_bangun numeric not null check (biaya_bangun >= 0 and biaya_bangun = round(biaya_bangun)),
  buffer_persen numeric not null default 15 check (buffer_persen >= 0 and buffer_persen <= 100),
  fee_persen numeric not null default 8 check (fee_persen >= 0 and fee_persen <= 100),
  jumlah_unit smallint not null default 0 check (jumlah_unit >= 0),
  diubah_pada timestamptz not null default now()
);

create table public.loonars2_accounts (
  kode char(1) primary key check (kode in ('A', 'B', 'C', 'D')),
  nama text not null,
  fungsi text not null,
  bank text,
  nomor_rekening text check (nomor_rekening is null or nomor_rekening ~ '^[0-9 -]{4,30}$'),
  nama_pemilik text,
  -- Saldo awal sebelum modul dipakai (biasanya 0). Saldo berjalan dihitung
  -- dari buku besar di loonars2_v_rekening, bukan disimpan.
  saldo_awal numeric not null default 0 check (saldo_awal = round(saldo_awal)),
  diubah_pada timestamptz not null default now()
);

create table public.loonars2_units (
  id smallint generated always as identity primary key,
  -- Nomor urut yang dipakai di WA ("DP unit 5"). Kode = kode siteplan.
  nomor smallint not null unique check (nomor > 0),
  kode text not null unique check (kode ~ '^[A-Z]+-[0-9]{2}$'),
  tipe_id smallint not null references public.loonars2_unit_types(id) on delete restrict,
  nama_pembeli text,
  -- Override hasil negosiasi; kosong = ikut tipe / pengaturan.
  harga numeric check (harga is null or (harga > 0 and harga = round(harga))),
  dp_persen numeric check (dp_persen is null or (dp_persen > 0 and dp_persen <= 100)),
  fee_persen numeric check (fee_persen is null or (fee_persen >= 0 and fee_persen <= 100)),
  status text not null default 'tersedia' check (status in ('tersedia', 'booking', 'dp', 'lunas')),
  -- Kosong = jatuh tempo saat serah terima (tanggal_serah_terima).
  jatuh_tempo_pelunasan date,
  tanggal_serah_terima date,
  status_bangun text not null default 'belum' check (status_bangun in ('belum', 'proses', 'selesai', 'serah_terima')),
  -- Unit contoh boleh menerima pengajuan material walau belum terjual.
  is_unit_contoh boolean not null default false,
  catatan text,
  diubah_pada timestamptz not null default now()
);

create table public.loonars2_receipts (
  id integer generated always as identity primary key,
  unit_id smallint not null references public.loonars2_units(id) on delete restrict,
  jenis text not null check (jenis in ('booking', 'dp', 'pelunasan', 'cicilan')),
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  tanggal date not null default ((now() at time zone 'Asia/Jakarta')::date),
  bukti_url text,
  status text not null default 'aktif' check (status in ('aktif', 'batal')),
  sumber text not null check (sumber in ('wa', 'web')),
  dicatat_oleh text not null,
  dibuat_pada timestamptz not null default now(),
  terakhir_diingatkan_pada timestamptz,
  alasan_batal text
);
create index loonars2_receipts_unit_idx on public.loonars2_receipts (unit_id);

create table public.loonars2_allocations (
  id integer generated always as identity primary key,
  receipt_id integer not null references public.loonars2_receipts(id) on delete restrict,
  -- Nomor blok di perintah transfer ("sudah 1").
  urutan smallint not null check (urutan between 1 and 3),
  ke_rekening char(1) not null check (ke_rekening in ('B', 'C', 'D')),
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  status text not null default 'menunggu' check (status in ('menunggu', 'terkonfirmasi', 'batal')),
  dikonfirmasi_pada timestamptz,
  dikonfirmasi_oleh text,
  bukti_url text,
  unique (receipt_id, urutan),
  unique (receipt_id, ke_rekening)
);
create index loonars2_allocations_status_idx on public.loonars2_allocations (status);

create table public.loonars2_material_requests (
  id integer generated always as identity primary key,
  unit_id smallint not null references public.loonars2_units(id) on delete restrict,
  kategori text not null check (kategori in ('material', 'tukang', 'lain')),
  deskripsi text not null check (length(deskripsi) between 1 and 2000),
  items jsonb,
  toko text,
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  nota_url text,
  diajukan_oleh text not null,
  diajukan_oleh_nomor text,
  sumber text not null check (sumber in ('wa', 'web')),
  -- Hasil validasi otomatis saat diajukan.
  pakai_buffer boolean not null default false,
  melewati_buffer boolean not null default false,
  saldo_c_kurang boolean not null default false,
  unit_belum_terdanai boolean not null default false,
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak', 'dibayar')),
  alasan_tolak text,
  diputuskan_oleh text,
  diputuskan_pada timestamptz,
  dibuat_pada timestamptz not null default now()
);
create index loonars2_material_requests_unit_idx on public.loonars2_material_requests (unit_id, status);

create table public.loonars2_disbursements (
  id integer generated always as identity primary key,
  dari_rekening char(1) not null check (dari_rekening in ('B', 'C', 'D')),
  kategori text not null,
  unit_id smallint references public.loonars2_units(id) on delete restrict,
  material_request_id integer unique references public.loonars2_material_requests(id) on delete restrict,
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  tanggal date not null default ((now() at time zone 'Asia/Jakarta')::date),
  penerima text,
  keterangan text,
  bukti_url text,
  sumber text not null check (sumber in ('wa', 'web')),
  dicatat_oleh text not null,
  dibuat_pada timestamptz not null default now(),
  -- Aturan "boleh keluar untuk" per rekening.
  constraint loonars2_disbursements_aturan_rekening check (
    (dari_rekening = 'B' and kategori = 'tanah')
    or (dari_rekening = 'C' and kategori in ('material', 'tukang', 'fee_marketing', 'lain_konstruksi'))
    or (dari_rekening = 'D' and kategori = 'profit')
  ),
  constraint loonars2_disbursements_pengajuan_dari_c check (material_request_id is null or dari_rekening = 'C')
);

create table public.loonars2_wa_users (
  id smallint generated always as identity primary key,
  nomor text not null unique check (nomor ~ '^62[0-9]{8,14}$'),
  nama text not null check (length(nama) between 2 and 80),
  peran text not null check (peran in ('owner', 'pelaksana')),
  aktif boolean not null default true,
  diubah_pada timestamptz not null default now()
);

-- Konfirmasi "YA" yang sedang ditunggu, satu per nomor.
create table public.loonars2_wa_pending (
  nomor text primary key,
  aksi text not null,
  data jsonb not null,
  dibuat_pada timestamptz not null default now(),
  kedaluwarsa_pada timestamptz not null default now() + interval '30 minutes'
);

-- Log pesan WA yang masuk ke modul ini (termasuk nomor tak dikenal).
create table public.loonars2_wa_log (
  id bigint generated always as identity primary key,
  nomor text,
  aksi text,
  data jsonb,
  hasil text not null,
  dibuat_pada timestamptz not null default now()
);

create table public.loonars2_outbox (
  id bigint generated always as identity primary key,
  nomor text not null,
  pesan text not null check (length(pesan) between 1 and 4000),
  gambar_url text,
  jenis text not null,
  kunci text unique,
  status text not null default 'antri' check (status in ('antri', 'proses', 'terkirim', 'gagal')),
  percobaan smallint not null default 0,
  galat text,
  dibuat_pada timestamptz not null default now(),
  diproses_pada timestamptz,
  terkirim_pada timestamptz
);
create index loonars2_outbox_antri_idx on public.loonars2_outbox (status, dibuat_pada) where status in ('antri', 'proses');

create table public.loonars2_audit_log (
  id bigint generated always as identity primary key,
  tabel text not null,
  baris_id text not null,
  aksi text not null check (aksi in ('INSERT', 'UPDATE', 'DELETE')),
  nilai_lama jsonb,
  nilai_baru jsonb,
  aktor text not null,
  sumber text not null check (sumber in ('wa', 'web', 'sistem')),
  dibuat_pada timestamptz not null default now()
);
create index loonars2_audit_log_tabel_idx on public.loonars2_audit_log (tabel, baris_id);

-- ----------------------------------------------------------------------------
-- 2. Data awal (bisa diedit setelahnya). Nomor rekening sengaja kosong —
--    owner mengisinya lewat web atau WA ("ubah rekening C ...").
-- ----------------------------------------------------------------------------
insert into public.loonars2_settings (id, jatuh_tempo_tanah)
values (1, ((now() at time zone 'Asia/Jakarta')::date + interval '12 months')::date);

insert into public.loonars2_unit_types (nama, harga, biaya_bangun, buffer_persen, fee_persen, jumlah_unit) values
  ('1 Kamar', 420000000, 120000000, 15, 8, 12),
  ('2 Kamar', 600000000, 160000000, 15, 8, 5);

insert into public.loonars2_accounts (kode, nama, fungsi) values
  ('A', 'Penampung', 'Semua pembayaran pembeli masuk ke sini. Hanya boleh keluar sebagai transfer alokasi ke B, C, D.'),
  ('B', 'Tanah', 'Dana pelunasan sewa tanah. Hanya untuk pembayaran tanah.'),
  ('C', 'Konstruksi & Fee', 'Biaya bangun, buffer, fee marketing. Untuk pengajuan material/tukang yang disetujui dan fee.'),
  ('D', 'Profit', 'Profit dikunci. Hanya pencairan yang lolos syarat milestone.');

insert into public.loonars2_units (nomor, kode, tipe_id)
select n, kode, (select id from public.loonars2_unit_types where nama = tipe)
from (values
  (1, 'AVARA-01', '1 Kamar'), (2, 'AVARA-02', '1 Kamar'), (3, 'AVARA-03', '1 Kamar'),
  (4, 'AVARA-04', '1 Kamar'), (5, 'AVARA-05', '1 Kamar'), (6, 'AVARA-06', '1 Kamar'),
  (7, 'BANYU-01', '1 Kamar'), (8, 'BANYU-02', '1 Kamar'), (9, 'BANYU-03', '1 Kamar'),
  (10, 'BANYU-04', '1 Kamar'), (11, 'BANYU-05', '1 Kamar'), (12, 'BANYU-06', '1 Kamar'),
  (13, 'LUNARA-01', '2 Kamar'), (14, 'LUNARA-02', '2 Kamar'), (15, 'LUNARA-03', '2 Kamar'),
  (16, 'LUNARA-04', '2 Kamar'), (17, 'LUNARA-05', '2 Kamar')
) as v(n, kode, tipe);

-- ----------------------------------------------------------------------------
-- 3. Helper
-- ----------------------------------------------------------------------------
create or replace function public.loonars2_rp(p numeric)
returns text
language sql
immutable
as $$
  select case when p < 0 then '-Rp ' else 'Rp ' end
         || replace(to_char(abs(round(coalesce(p, 0))), 'FM999,999,999,999,990'), ',', '.');
$$;

create or replace function public._loonars2_hari_ini()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Jakarta')::date $$;

create or replace function public._loonars2_normalisasi_nomor(p text)
returns text
language sql
immutable
as $$
  select case
    when d like '0%' then '62' || substr(d, 2)
    when d like '8%' then '62' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Siapa & dari mana perubahan dilakukan, untuk audit log. Fungsi RPC
-- mengisi loonars2.aktor/loonars2.sumber; edit tabel langsung dari web
-- otomatis tercatat sebagai email CFO yang login.
create or replace function public._loonars2_aktor()
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v text := nullif(current_setting('loonars2.aktor', true), '');
  v_email text;
begin
  if v is not null then return v; end if;
  begin
    v_email := public.mkh_email_login();
  exception when others then
    v_email := null;
  end;
  return coalesce('web:' || nullif(v_email, ''), 'sistem');
end;
$$;

create or replace function public._loonars2_sumber()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('loonars2.sumber', true), ''),
    case when public._loonars2_aktor() like 'web:%' then 'web' else 'sistem' end
  );
$$;

create or replace function public._loonars2_set_aktor(p_aktor text, p_sumber text)
returns void
language sql
as $$
  select set_config('loonars2.aktor', p_aktor, true), set_config('loonars2.sumber', p_sumber, true);
$$;

-- ----------------------------------------------------------------------------
-- 4. Audit log (trigger generik)
-- ----------------------------------------------------------------------------
create or replace function public.loonars2_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lama jsonb;
  v_baru jsonb;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_lama := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_baru := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_lama - 'diubah_pada' = v_baru - 'diubah_pada' then
    return new;
  end if;
  v_id := coalesce(v_baru, v_lama) ->> coalesce(tg_argv[0], 'id');
  insert into public.loonars2_audit_log (tabel, baris_id, aksi, nilai_lama, nilai_baru, aktor, sumber)
  values (tg_table_name, coalesce(v_id, '?'), tg_op, v_lama, v_baru, public._loonars2_aktor(), public._loonars2_sumber());
  return coalesce(new, old);
end;
$$;

create or replace function public.loonars2_sentuh_diubah_pada()
returns trigger
language plpgsql
as $$
begin
  new.diubah_pada := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['loonars2_settings', 'loonars2_unit_types', 'loonars2_units', 'loonars2_wa_users']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.loonars2_sentuh_diubah_pada()', t || '_diubah', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.loonars2_audit(''id'')', t || '_audit', t);
  end loop;
  foreach t in array array['loonars2_receipts', 'loonars2_allocations', 'loonars2_material_requests', 'loonars2_disbursements']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.loonars2_audit(''id'')', t || '_audit', t);
  end loop;
end $$;

create trigger loonars2_accounts_diubah before update on public.loonars2_accounts
  for each row execute function public.loonars2_sentuh_diubah_pada();
create trigger loonars2_accounts_audit after insert or update or delete on public.loonars2_accounts
  for each row execute function public.loonars2_audit('kode');

-- Jumlah alokasi (selain yang batal) harus sama persis dengan nominal
-- receipt aktif. Dicek di akhir transaksi.
create or replace function public.loonars2_cek_jumlah_alokasi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id integer;
  v_nominal numeric;
  v_status text;
  v_jumlah numeric;
begin
  if tg_table_name = 'loonars2_receipts' then
    v_receipt_id := new.id;
  else
    v_receipt_id := new.receipt_id;
  end if;
  select nominal, status into v_nominal, v_status from public.loonars2_receipts where id = v_receipt_id;
  select coalesce(sum(nominal), 0) into v_jumlah
    from public.loonars2_allocations where receipt_id = v_receipt_id and status <> 'batal';
  if v_status = 'aktif' and v_jumlah <> v_nominal then
    raise exception 'Jumlah alokasi receipt % (%) tidak sama dengan nominal (%)', v_receipt_id, v_jumlah, v_nominal
      using errcode = '23514';
  end if;
  if v_status = 'batal' and v_jumlah <> 0 then
    raise exception 'Receipt % dibatalkan tapi masih punya alokasi aktif', v_receipt_id using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger loonars2_receipts_cek_jumlah after insert or update on public.loonars2_receipts
  deferrable initially deferred for each row execute function public.loonars2_cek_jumlah_alokasi();
create constraint trigger loonars2_allocations_cek_jumlah after insert or update on public.loonars2_allocations
  deferrable initially deferred for each row execute function public.loonars2_cek_jumlah_alokasi();

-- ----------------------------------------------------------------------------
-- 5. View turunan (security_invoker: tunduk pada RLS pemanggil)
-- ----------------------------------------------------------------------------
create view public.loonars2_v_unit with (security_invoker = true) as
with dasar as (
  select
    u.*,
    t.nama as tipe,
    coalesce(u.harga, t.harga) as harga_efektif,
    coalesce(u.dp_persen, s.dp_persen_default) as dp_persen_efektif,
    coalesce(u.fee_persen, t.fee_persen) as fee_persen_efektif,
    t.biaya_bangun,
    round(t.biaya_bangun * t.buffer_persen / 100) as buffer
  from public.loonars2_units u
  join public.loonars2_unit_types t on t.id = u.tipe_id
  cross join public.loonars2_settings s
)
select
  d.*,
  round(d.harga_efektif * d.fee_persen_efektif / 100) as fee,
  d.biaya_bangun + d.buffer + round(d.harga_efektif * d.fee_persen_efektif / 100) as kebutuhan_c,
  round(d.harga_efektif * d.dp_persen_efektif / 100) as dp_target,
  coalesce(r.total, 0) as total_dibayar,
  d.harga_efektif - coalesce(r.total, 0) as sisa_pelunasan,
  coalesce(a.c_dialokasikan, 0) as c_dialokasikan,
  coalesce(a.c_terkonfirmasi, 0) as c_terkonfirmasi,
  coalesce(k.terpakai_konstruksi, 0) as terpakai_konstruksi,
  coalesce(k.keluar_c, 0) as keluar_c,
  coalesce(m.komitmen, 0) as komitmen_disetujui,
  coalesce(a.c_dialokasikan, 0) >= d.biaya_bangun + d.buffer + round(d.harga_efektif * d.fee_persen_efektif / 100) as terdanai_penuh,
  coalesce(d.jatuh_tempo_pelunasan, d.tanggal_serah_terima) as jatuh_tempo_efektif
from dasar d
left join lateral (
  select sum(nominal) as total from public.loonars2_receipts where unit_id = d.id and status = 'aktif'
) r on true
left join lateral (
  select sum(al.nominal) filter (where al.status <> 'batal') as c_dialokasikan,
         sum(al.nominal) filter (where al.status = 'terkonfirmasi') as c_terkonfirmasi
    from public.loonars2_allocations al
    join public.loonars2_receipts re on re.id = al.receipt_id
   where re.unit_id = d.id and al.ke_rekening = 'C'
) a on true
left join lateral (
  select sum(nominal) filter (where kategori in ('material', 'tukang', 'lain_konstruksi')) as terpakai_konstruksi,
         sum(nominal) as keluar_c
    from public.loonars2_disbursements where unit_id = d.id and dari_rekening = 'C'
) k on true
left join lateral (
  select sum(nominal) as komitmen from public.loonars2_material_requests where unit_id = d.id and status = 'disetujui'
) m on true;

create view public.loonars2_v_rekening with (security_invoker = true) as
select
  ac.kode, ac.nama, ac.fungsi, ac.bank, ac.nomor_rekening, ac.nama_pemilik, ac.saldo_awal,
  ac.saldo_awal
    + case when ac.kode = 'A'
        then coalesce((select sum(nominal) from public.loonars2_receipts where status = 'aktif'), 0)
             - coalesce((select sum(nominal) from public.loonars2_allocations where status = 'terkonfirmasi'), 0)
        else coalesce((select sum(nominal) from public.loonars2_allocations where status = 'terkonfirmasi' and ke_rekening = ac.kode), 0)
             - coalesce((select sum(nominal) from public.loonars2_disbursements where dari_rekening = ac.kode), 0)
      end as saldo,
  case when ac.kode = 'A'
    then coalesce((select sum(nominal) from public.loonars2_allocations where status = 'menunggu'), 0)
    else coalesce((select sum(nominal) from public.loonars2_allocations where status = 'menunggu' and ke_rekening = ac.kode), 0)
  end as menunggu_transfer,
  ac.diubah_pada
from public.loonars2_accounts ac;

-- Berapa lama rata-rata uang mengendap di A sebelum dikonfirmasi pindah.
create view public.loonars2_v_lama_mengendap with (security_invoker = true) as
select
  count(*) as jumlah_transfer,
  avg(al.dikonfirmasi_pada - re.dibuat_pada) as rata_rata,
  max(al.dikonfirmasi_pada - re.dibuat_pada) as terlama
from public.loonars2_allocations al
join public.loonars2_receipts re on re.id = al.receipt_id
where al.status = 'terkonfirmasi';

-- ----------------------------------------------------------------------------
-- 6. RLS
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'loonars2_settings', 'loonars2_unit_types', 'loonars2_accounts', 'loonars2_units',
    'loonars2_receipts', 'loonars2_allocations', 'loonars2_material_requests',
    'loonars2_disbursements', 'loonars2_wa_users', 'loonars2_wa_pending',
    'loonars2_wa_log', 'loonars2_outbox', 'loonars2_audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy cfo_baca on public.%I for select to authenticated using ((select public.mkh_is_cfo()))', t);
  end loop;

  -- Pengaturan & data master boleh diedit langsung oleh CFO (tercatat audit).
  -- Uang (receipt/alokasi/pengajuan/pengeluaran) hanya lewat RPC loonars2_web.
  foreach t in array array['loonars2_settings', 'loonars2_unit_types', 'loonars2_accounts', 'loonars2_units']
  loop
    execute format('grant update on public.%I to authenticated', t);
    execute format('create policy cfo_ubah on public.%I for update to authenticated using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()))', t);
  end loop;
  grant insert, update, delete on public.loonars2_wa_users to authenticated;
  create policy cfo_tambah on public.loonars2_wa_users for insert to authenticated with check ((select public.mkh_is_cfo()));
  create policy cfo_ubah on public.loonars2_wa_users for update to authenticated using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));
  create policy cfo_hapus on public.loonars2_wa_users for delete to authenticated using ((select public.mkh_is_cfo()));
end $$;

revoke all on public.loonars2_v_unit, public.loonars2_v_rekening, public.loonars2_v_lama_mengendap from anon;
grant select on public.loonars2_v_unit, public.loonars2_v_rekening, public.loonars2_v_lama_mengendap to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Inti: alokasi, receipt, konfirmasi
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_cari_unit(p text)
returns smallint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := upper(trim(coalesce(p, '')));
  v_huruf text;
  v_angka text;
  v_id smallint;
begin
  v := regexp_replace(v, '^UNIT\s*', '');
  if v ~ '^[0-9]{1,3}$' then
    select id into v_id from public.loonars2_units where nomor = v::int;
    return v_id;
  end if;
  v_huruf := substring(v from '^([A-Z]+)');
  v_angka := substring(v from '([0-9]+)$');
  if v_huruf is null or v_angka is null then return null; end if;
  select id into v_id from public.loonars2_units
   where kode = v_huruf || '-' || lpad(ltrim(v_angka, '0'), 2, '0');
  return v_id;
end;
$$;

create or replace function public._loonars2_label_unit(p_unit_id smallint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'Unit ' || u.nomor || ' ' || u.kode || ', ' || t.nama
    from public.loonars2_units u join public.loonars2_unit_types t on t.id = u.tipe_id
   where u.id = p_unit_id;
$$;

-- Pemecahan satu pembayaran ke C → B → D (tanpa menulis apa pun).
create or replace function public._loonars2_hitung_alokasi(p_unit_id smallint, p_nominal numeric)
returns table (ke_rekening char(1), nominal numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kebutuhan numeric;
  v_sudah_c numeric;
  v_target numeric;
  v_sudah_b numeric;
  v_c numeric;
  v_b numeric;
  v_sisa numeric := p_nominal;
begin
  select kebutuhan_c, c_dialokasikan into v_kebutuhan, v_sudah_c from public.loonars2_v_unit where id = p_unit_id;
  select target_tanah into v_target from public.loonars2_settings where id = 1;
  select coalesce(sum(al.nominal), 0) into v_sudah_b
    from public.loonars2_allocations al where al.ke_rekening = 'B' and al.status <> 'batal';

  v_c := least(v_sisa, greatest(v_kebutuhan - v_sudah_c, 0));
  v_sisa := v_sisa - v_c;
  v_b := least(v_sisa, greatest(v_target - v_sudah_b, 0));
  v_sisa := v_sisa - v_b;

  if v_c > 0 then ke_rekening := 'C'; nominal := v_c; return next; end if;
  if v_b > 0 then ke_rekening := 'B'; nominal := v_b; return next; end if;
  if v_sisa > 0 then ke_rekening := 'D'; nominal := v_sisa; return next; end if;
end;
$$;

create or replace function public._loonars2_nama_rekening(p char)
returns text
language sql
stable
security definer
set search_path = public
as $$ select nama from public.loonars2_accounts where kode = p $$;

create or replace function public._loonars2_detail_rekening(p char)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when nullif(trim(coalesce(bank, '')), '') is null or nomor_rekening is null
      then '(nomor rekening ' || kode || ' belum diisi — balas "ubah rekening ' || kode || ' <bank> <nomor> a.n. <nama>")'
    else bank || ' ' || nomor_rekening || coalesce(' a.n. ' || nama_pemilik, '')
  end
  from public.loonars2_accounts where kode = p;
$$;

create or replace function public._loonars2_total_tertunda()
returns numeric
language sql
stable
security definer
set search_path = public
as $$ select coalesce(sum(nominal), 0) from public.loonars2_allocations where status = 'menunggu' $$;

-- Antrekan pesan WA ke semua nomor aktif dengan peran tertentu.
create or replace function public._loonars2_kirim(p_peran text, p_pesan text, p_jenis text, p_kunci text default null, p_gambar text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jumlah integer := 0;
  r record;
begin
  for r in select nomor from public.loonars2_wa_users where peran = p_peran and aktif loop
    insert into public.loonars2_outbox (nomor, pesan, jenis, kunci, gambar_url)
    values (r.nomor, left(p_pesan, 4000), p_jenis, case when p_kunci is null then null else p_kunci || ':' || r.nomor end, p_gambar)
    on conflict (kunci) do nothing;
    if found then v_jumlah := v_jumlah + 1; end if;
  end loop;
  return v_jumlah;
end;
$$;

create or replace function public._loonars2_teks_instruksi(p_receipt_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_re record;
  v_teks text;
  v_unit record;
  r record;
  v_n integer := 0;
  v_jenis text;
begin
  select * into v_re from public.loonars2_receipts where id = p_receipt_id;
  select * into v_unit from public.loonars2_v_unit where id = v_re.unit_id;
  v_jenis := case v_re.jenis when 'dp' then 'DP' when 'pelunasan' then 'Pelunasan' when 'booking' then 'Booking' else 'Cicilan' end;
  v_teks := '🔴 SEGERA TRANSFER — ' || v_jenis || ' ' || public._loonars2_label_unit(v_re.unit_id)
            || ' (' || public.loonars2_rp(v_re.nominal) || ')';
  for r in select * from public.loonars2_allocations where receipt_id = p_receipt_id and status = 'menunggu' order by urutan loop
    v_n := v_n + 1;
    v_teks := v_teks || E'\n\n' || r.urutan || ') A → ' || r.ke_rekening || ' (' || public._loonars2_nama_rekening(r.ke_rekening) || ')'
              || E'\n   ' || public._loonars2_detail_rekening(r.ke_rekening)
              || E'\n   ' || public.loonars2_rp(r.nominal);
  end loop;
  if v_n = 0 then
    return '✅ Semua alokasi ' || v_jenis || ' ' || public._loonars2_label_unit(v_re.unit_id) || ' sudah dikonfirmasi.';
  end if;
  v_teks := v_teks || E'\n\nBalas "sudah 1"' || case when v_n > 1 then ' / "sudah 2"' else '' end
            || case when v_n > 2 then ' / "sudah 3"' else '' end
            || ' / "sudah semua" setelah transfer (boleh sertakan foto bukti).';
  if v_unit.status in ('dp', 'lunas') and not v_unit.terdanai_penuh then
    v_teks := v_teks || E'\n\n⚠️ Unit ini BELUM TERDANAI PENUH: C baru ' || public.loonars2_rp(v_unit.c_dialokasikan)
              || ' dari kebutuhan ' || public.loonars2_rp(v_unit.kebutuhan_c) || '.';
  end if;
  return v_teks;
end;
$$;

-- Mencatat pembayaran pembeli, menghitung alokasi, memperbarui status unit.
create or replace function public._loonars2_catat_receipt(
  p_unit_id smallint, p_jenis text, p_nominal numeric, p_tanggal date,
  p_nama_pembeli text, p_bukti text, p_aktor text, p_sumber text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit record;
  v_id integer;
  v_urutan smallint := 0;
  v_total numeric;
  v_status text;
  r record;
begin
  if p_jenis not in ('booking', 'dp', 'pelunasan', 'cicilan') then
    raise exception 'Jenis pembayaran tidak dikenal: %', p_jenis using errcode = '22023';
  end if;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    raise exception 'Nominal harus rupiah bulat lebih dari 0' using errcode = '22023';
  end if;
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  -- Serialisasi: target tanah bersifat global, jadi dua receipt bersamaan
  -- tidak boleh sama-sama melihat sisa target yang sama.
  perform 1 from public.loonars2_settings where id = 1 for update;

  select * into v_unit from public.loonars2_v_unit where id = p_unit_id;
  if not found then raise exception 'Unit tidak ditemukan' using errcode = '22023'; end if;
  if p_nominal > v_unit.sisa_pelunasan then
    raise exception 'Nominal % melebihi sisa tagihan unit % (%)', public.loonars2_rp(p_nominal), v_unit.kode, public.loonars2_rp(v_unit.sisa_pelunasan)
      using errcode = '22023';
  end if;

  insert into public.loonars2_receipts (unit_id, jenis, nominal, tanggal, bukti_url, sumber, dicatat_oleh)
  values (p_unit_id, p_jenis, p_nominal, coalesce(p_tanggal, public._loonars2_hari_ini()), p_bukti, p_sumber, p_aktor)
  returning id into v_id;

  for r in select * from public._loonars2_hitung_alokasi(p_unit_id, p_nominal) loop
    v_urutan := v_urutan + 1;
    insert into public.loonars2_allocations (receipt_id, urutan, ke_rekening, nominal)
    values (v_id, v_urutan, r.ke_rekening, r.nominal);
  end loop;

  v_total := v_unit.total_dibayar + p_nominal;
  v_status := case
    when v_total >= v_unit.harga_efektif then 'lunas'
    when v_total >= v_unit.dp_target then 'dp'
    else 'booking' end;
  update public.loonars2_units
     set status = v_status,
         nama_pembeli = coalesce(nullif(trim(p_nama_pembeli), ''), nama_pembeli)
   where id = p_unit_id;
  return v_id;
end;
$$;

-- Konfirmasi transfer alokasi; saldo berpindah A → tujuan saat ini juga.
create or replace function public._loonars2_konfirmasi(p_ids integer[], p_bukti text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '';
  v_n integer := 0;
  v_sisa numeric;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  for r in
    update public.loonars2_allocations
       set status = 'terkonfirmasi', dikonfirmasi_pada = now(), dikonfirmasi_oleh = p_aktor,
           bukti_url = coalesce(p_bukti, bukti_url)
     where id = any(p_ids) and status = 'menunggu'
    returning *
  loop
    v_n := v_n + 1;
    v_teks := v_teks || E'\n✅ A → ' || r.ke_rekening || ' ' || public.loonars2_rp(r.nominal);
  end loop;
  if v_n = 0 then
    return 'Tidak ada transfer tertunda yang cocok.';
  end if;
  v_sisa := public._loonars2_total_tertunda();
  return 'Transfer dikonfirmasi:' || v_teks
         || case when p_bukti is not null then E'\n📎 Bukti disimpan.' else '' end
         || E'\n\n' || case when v_sisa > 0
              then '⏳ Masih ada ' || public.loonars2_rp(v_sisa) || ' belum dipindahkan dari A.'
              else '👍 Tidak ada lagi uang yang mengendap di A.' end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Laporan teks (dipakai WA & pengingat)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_teks_tertunda()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '';
  v_total numeric := public._loonars2_total_tertunda();
  v_tertua timestamptz;
begin
  if v_total = 0 then return null; end if;
  select min(re.dibuat_pada) into v_tertua
    from public.loonars2_allocations al join public.loonars2_receipts re on re.id = al.receipt_id
   where al.status = 'menunggu';
  v_teks := '🔴 TRANSFER TERTUNDA: ' || public.loonars2_rp(v_total) || ' masih di rekening A (tertua sejak '
            || to_char(v_tertua at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI') || ' WIB)';
  for r in
    select al.*, re.unit_id, re.jenis from public.loonars2_allocations al
      join public.loonars2_receipts re on re.id = al.receipt_id
     where al.status = 'menunggu' order by al.id
  loop
    v_teks := v_teks || E'\n• T' || r.id || ' ' || upper(r.jenis) || ' ' || public._loonars2_label_unit(r.unit_id)
              || ': A → ' || r.ke_rekening || ' ' || public.loonars2_rp(r.nominal);
  end loop;
  return v_teks || E'\nBalas "sudah T<nomor>" untuk mengonfirmasi satu per satu.';
end;
$$;

create or replace function public._loonars2_teks_saldo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '';
  v_tertunda text := public._loonars2_teks_tertunda();
  v_set record;
  v_b_alokasi numeric;
  v_b_konfirm numeric;
  v_hari integer;
begin
  select * into v_set from public.loonars2_settings where id = 1;
  if v_tertunda is not null then v_teks := v_tertunda || E'\n\n'; end if;
  v_teks := v_teks || '💰 SALDO LOONARS 2';
  for r in select * from public.loonars2_v_rekening order by kode loop
    v_teks := v_teks || E'\n' || r.kode || ' ' || r.nama || ': ' || public.loonars2_rp(r.saldo)
              || case when r.kode <> 'A' and r.menunggu_transfer > 0 then ' (+' || public.loonars2_rp(r.menunggu_transfer) || ' menunggu transfer)' else '' end;
  end loop;
  select coalesce(sum(nominal) filter (where status <> 'batal'), 0),
         coalesce(sum(nominal) filter (where status = 'terkonfirmasi'), 0)
    into v_b_alokasi, v_b_konfirm
    from public.loonars2_allocations where ke_rekening = 'B';
  v_teks := v_teks || E'\n\n🏞️ Dana tanah: ' || public.loonars2_rp(v_b_alokasi) || ' dari ' || public.loonars2_rp(v_set.target_tanah)
            || case when v_set.target_tanah > 0 then ' (' || round(100 * v_b_alokasi / v_set.target_tanah) || '%)' else '' end
            || case when v_b_konfirm <> v_b_alokasi then E'\n   terkonfirmasi di B: ' || public.loonars2_rp(v_b_konfirm) else '' end;
  if v_set.jatuh_tempo_tanah is not null then
    v_hari := v_set.jatuh_tempo_tanah - public._loonars2_hari_ini();
    v_teks := v_teks || E'\n   Jatuh tempo tanah ' || to_char(v_set.jatuh_tempo_tanah, 'DD-MM-YYYY')
              || case when v_hari >= 0 then ' (sisa ' || v_hari || ' hari)' else ' (🔴 LEWAT ' || -v_hari || ' hari)' end;
  end if;
  return v_teks;
end;
$$;

create or replace function public._loonars2_teks_tagihan()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '📑 TAGIHAN LOONARS 2 (belum lunas)';
  v_n integer := 0;
  v_hari integer;
  v_hari_ini date := public._loonars2_hari_ini();
begin
  for r in
    select * from public.loonars2_v_unit
     where status in ('booking', 'dp') and sisa_pelunasan > 0
     order by jatuh_tempo_efektif nulls last, nomor
  loop
    v_n := v_n + 1;
    v_hari := r.jatuh_tempo_efektif - v_hari_ini;
    v_teks := v_teks || E'\n' || v_n || '. ' || case when v_hari < 0 then '🔴 ' else '' end
              || 'Unit ' || r.nomor || ' ' || r.kode || ' — ' || coalesce(r.nama_pembeli, '(nama pembeli belum diisi)')
              || E'\n   Sisa ' || public.loonars2_rp(r.sisa_pelunasan) || ' — jatuh tempo '
              || case
                   when r.jatuh_tempo_efektif is null then 'saat serah terima (tanggal belum diisi)'
                   when v_hari < 0 then to_char(r.jatuh_tempo_efektif, 'DD-MM-YYYY') || ' (LEWAT ' || -v_hari || ' hari)'
                   else to_char(r.jatuh_tempo_efektif, 'DD-MM-YYYY') || ' (' || v_hari || ' hari lagi)'
                 end;
  end loop;
  if v_n = 0 then return '📑 Tidak ada tagihan: semua unit terjual sudah lunas atau belum ada penjualan.'; end if;
  return v_teks;
end;
$$;

-- Proyeksi dana tanah: B yang sudah dialokasikan + bagian B dari pelunasan
-- yang dijadwalkan sebelum jatuh tempo tanah (C unit dipenuhi dulu).
create or replace function public._loonars2_proyeksi_tanah()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_set record;
  v_b numeric;
  v_jadwal numeric := 0;
  v_proyeksi numeric;
  v_kurang numeric;
  v_kontribusi numeric;
  v_unit_tambahan integer := 0;
begin
  select * into v_set from public.loonars2_settings where id = 1;
  select coalesce(sum(nominal), 0) into v_b from public.loonars2_allocations where ke_rekening = 'B' and status <> 'batal';
  if v_set.jatuh_tempo_tanah is not null then
    select coalesce(sum(greatest(sisa_pelunasan - greatest(kebutuhan_c - c_dialokasikan, 0), 0)), 0) into v_jadwal
      from public.loonars2_v_unit
     where status in ('booking', 'dp') and sisa_pelunasan > 0
       and jatuh_tempo_efektif is not null and jatuh_tempo_efektif <= v_set.jatuh_tempo_tanah;
  end if;
  v_proyeksi := least(v_b + v_jadwal, greatest(v_set.target_tanah, v_b));
  v_kurang := greatest(v_set.target_tanah - v_proyeksi, 0);
  if v_kurang > 0 then
    -- Asumsi konservatif: unit tambahan = tipe dengan kontribusi ke B
    -- terkecil (harga − kebutuhan C), dibayar penuh sebelum jatuh tempo.
    select min(t.harga - (t.biaya_bangun + round(t.biaya_bangun * t.buffer_persen / 100) + round(t.harga * t.fee_persen / 100)))
      into v_kontribusi
      from public.loonars2_unit_types t;
    if v_kontribusi > 0 then v_unit_tambahan := ceil(v_kurang / v_kontribusi); end if;
  end if;
  return jsonb_build_object('b_dialokasikan', v_b, 'pelunasan_terjadwal_ke_b', v_jadwal, 'proyeksi', v_proyeksi,
                            'target', v_set.target_tanah, 'kurang', v_kurang, 'unit_tambahan', v_unit_tambahan,
                            'jatuh_tempo', v_set.jatuh_tempo_tanah);
end;
$$;

-- Cek kesehatan: saldo C harus cukup untuk sisa kebutuhan C semua unit
-- yang sudah terjual (minimal DP).
create or replace function public._loonars2_cek_kesehatan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_saldo_c numeric;
  v_menunggu_c numeric;
  v_butuh numeric;
begin
  select saldo, menunggu_transfer into v_saldo_c, v_menunggu_c from public.loonars2_v_rekening where kode = 'C';
  select coalesce(sum(greatest(kebutuhan_c - keluar_c, 0)), 0) into v_butuh
    from public.loonars2_v_unit where status in ('dp', 'lunas');
  return jsonb_build_object('saldo_c', v_saldo_c, 'menunggu_ke_c', v_menunggu_c, 'kebutuhan_sisa', v_butuh,
                            'kurang', greatest(v_butuh - v_saldo_c, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Pengajuan material/tukang (pelaksana)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_teks_pengajuan(p_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  u record;
  v_saldo_c numeric;
  v_komitmen_lain numeric;
  v_terpakai numeric;
  v_teks text;
  v_tertunda numeric := public._loonars2_total_tertunda();
begin
  select * into m from public.loonars2_material_requests where id = p_id;
  select * into u from public.loonars2_v_unit where id = m.unit_id;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  select coalesce(sum(nominal), 0) into v_komitmen_lain
    from public.loonars2_material_requests where status = 'disetujui' and id <> p_id;
  v_terpakai := u.terpakai_konstruksi + u.komitmen_disetujui - case when m.status = 'disetujui' then m.nominal else 0 end;

  v_teks := '📋 PENGAJUAN L2-' || m.id || ' — ' || public._loonars2_label_unit(m.unit_id)
    || E'\nDari: ' || m.diajukan_oleh
    || E'\nKategori: ' || initcap(m.kategori)
    || E'\nRincian: ' || left(m.deskripsi, 600)
    || coalesce(E'\nToko/penerima: ' || m.toko, '')
    || E'\nTotal: ' || public.loonars2_rp(m.nominal)
    || E'\n\nBudget bangun unit: ' || public.loonars2_rp(u.biaya_bangun) || ' (+ buffer ' || public.loonars2_rp(u.buffer) || ')'
    || E'\nSudah terpakai/disetujui: ' || public.loonars2_rp(v_terpakai)
    || E'\nSisa budget setelah ini: ' || public.loonars2_rp(u.biaya_bangun - v_terpakai - m.nominal)
    || case when u.biaya_bangun - v_terpakai - m.nominal < 0
         then ' (sisa buffer ' || public.loonars2_rp(u.biaya_bangun + u.buffer - v_terpakai - m.nominal) || ')' else '' end
    || E'\nSaldo C: ' || public.loonars2_rp(v_saldo_c) || ' (sisa setelah pengajuan lain yang disetujui & ini: '
    || public.loonars2_rp(v_saldo_c - v_komitmen_lain - m.nominal) || ')';
  if m.melewati_buffer then
    v_teks := v_teks || E'\n\n🔴 MELEWATI BIAYA BANGUN + BUFFER unit ini.';
  elsif m.pakai_buffer then
    v_teks := v_teks || E'\n\n🟠 PAKAI BUFFER: total unit melewati biaya bangun.';
  end if;
  if m.saldo_c_kurang then v_teks := v_teks || E'\n⚠️ Saldo C tidak cukup.'; end if;
  if m.unit_belum_terdanai then v_teks := v_teks || E'\n⚠️ Unit belum terdanai penuh di C.'; end if;
  if v_tertunda > 0 then
    v_teks := v_teks || E'\n⚠️ Masih ada ' || public.loonars2_rp(v_tertunda) || ' belum dipindahkan dari A.';
  end if;
  if m.status = 'menunggu' then
    v_teks := v_teks || E'\n\nBalas "setujui L2-' || m.id || case when m.pakai_buffer or m.melewati_buffer then ' buffer' else '' end
              || '" atau "tolak L2-' || m.id || ' <alasan>".';
  end if;
  return v_teks;
end;
$$;

create or replace function public._loonars2_ajukan(
  p_unit_id smallint, p_kategori text, p_deskripsi text, p_items jsonb, p_toko text,
  p_nominal numeric, p_nota text, p_nama text, p_nomor text, p_sumber text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_saldo_c numeric;
  v_komitmen numeric;
  v_total_unit numeric;
  v_id integer;
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  select * into u from public.loonars2_v_unit where id = p_unit_id;
  if not found then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Unit tidak ditemukan. Sebutkan nomor unit (1–17) atau kodenya, mis. BANYU-06.');
  end if;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Nominal pengajuan tidak terbaca. Tulis totalnya, mis. "total 1.850.000".');
  end if;
  if u.status not in ('dp', 'lunas') and not u.is_unit_contoh then
    return jsonb_build_object('status', 'ditolak', 'balasan',
      '❌ Pengajuan ditolak: ' || public._loonars2_label_unit(p_unit_id) || ' belum terjual (minimal DP). '
      || 'Material hanya bisa diajukan untuk unit yang sudah DP atau unit contoh.');
  end if;

  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  select coalesce(sum(nominal), 0) into v_komitmen from public.loonars2_material_requests where status = 'disetujui';
  v_total_unit := u.terpakai_konstruksi + u.komitmen_disetujui + p_nominal;

  insert into public.loonars2_material_requests (
    unit_id, kategori, deskripsi, items, toko, nominal, nota_url, diajukan_oleh, diajukan_oleh_nomor, sumber,
    pakai_buffer, melewati_buffer, saldo_c_kurang, unit_belum_terdanai)
  values (
    p_unit_id, coalesce(p_kategori, 'material'), p_deskripsi, p_items, nullif(trim(p_toko), ''), p_nominal, p_nota, p_nama, p_nomor, p_sumber,
    v_total_unit > u.biaya_bangun,
    v_total_unit > u.biaya_bangun + u.buffer,
    v_saldo_c - v_komitmen < p_nominal,
    not u.terdanai_penuh and not u.is_unit_contoh)
  returning id into v_id;

  perform public._loonars2_kirim('owner', public._loonars2_teks_pengajuan(v_id), 'pengajuan', 'pengajuan:' || v_id, p_nota);
  return jsonb_build_object('status', 'diajukan', 'id', v_id, 'balasan',
    '✅ Pengajuan L2-' || v_id || ' diterima — ' || public._loonars2_label_unit(p_unit_id) || E'\nTotal: ' || public.loonars2_rp(p_nominal)
    || E'\nStatus: MENUNGGU PERSETUJUAN OWNER'
    || case when v_total_unit > u.biaya_bangun + u.buffer then E'\n🔴 Melewati biaya bangun + buffer unit.'
            when v_total_unit > u.biaya_bangun then E'\n🟠 Pakai buffer — butuh persetujuan khusus owner.' else '' end);
end;
$$;

create or replace function public._loonars2_putuskan(p_id integer, p_setuju boolean, p_alasan text, p_izin_buffer boolean, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  select * into m from public.loonars2_material_requests where id = p_id for update;
  if not found then return 'Pengajuan L2-' || p_id || ' tidak ditemukan.'; end if;
  if m.status <> 'menunggu' then return 'Pengajuan L2-' || p_id || ' sudah ' || m.status || '.'; end if;
  if p_setuju and (m.pakai_buffer or m.melewati_buffer) and not coalesce(p_izin_buffer, false) then
    return '⚠️ L2-' || p_id || ' memakai buffer' || case when m.melewati_buffer then ' dan MELEWATI biaya bangun + buffer' else '' end
           || '. Untuk menyetujui, balas "setujui L2-' || p_id || ' buffer".';
  end if;
  update public.loonars2_material_requests
     set status = case when p_setuju then 'disetujui' else 'ditolak' end,
         alasan_tolak = case when p_setuju then null else nullif(trim(p_alasan), '') end,
         diputuskan_oleh = p_aktor, diputuskan_pada = now()
   where id = p_id;
  perform public._loonars2_kirim('pelaksana',
    case when p_setuju
      then '✅ Pengajuan L2-' || p_id || ' (' || public._loonars2_label_unit(m.unit_id) || ', ' || public.loonars2_rp(m.nominal)
           || ') DISETUJUI owner. Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar L2-' || p_id || '".'
      else '❌ Pengajuan L2-' || p_id || ' (' || public._loonars2_label_unit(m.unit_id) || ', ' || public.loonars2_rp(m.nominal)
           || ') DITOLAK owner.' || coalesce(E'\nAlasan: ' || nullif(trim(p_alasan), ''), '')
    end, 'keputusan_pengajuan', 'keputusan:' || p_id);
  return case when p_setuju
    then '✅ L2-' || p_id || ' disetujui. Pelaksana sudah diberi tahu. Setelah dibayar, kirim bukti dengan keterangan "L2 bayar L2-' || p_id || '".'
    else '❌ L2-' || p_id || ' ditolak. Pelaksana sudah diberi tahu.' end;
end;
$$;

-- Pengeluaran dari B/C/D. Saldo rekening asal harus cukup (saldo hanya
-- berisi uang yang transfernya sudah dikonfirmasi).
create or replace function public._loonars2_catat_pengeluaran(
  p_dari char(1), p_kategori text, p_nominal numeric, p_unit_id smallint, p_request_id integer,
  p_penerima text, p_keterangan text, p_bukti text, p_tanggal date, p_aktor text, p_sumber text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo numeric;
  v_id integer;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  perform 1 from public.loonars2_settings where id = 1 for update;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    raise exception 'Nominal harus rupiah bulat lebih dari 0' using errcode = '22023';
  end if;
  select saldo into v_saldo from public.loonars2_v_rekening where kode = p_dari;
  if v_saldo < p_nominal then
    raise exception 'Saldo % (%) tidak cukup untuk %. Konfirmasi dulu transfer dari A bila sudah dilakukan.',
      p_dari, public.loonars2_rp(v_saldo), public.loonars2_rp(p_nominal) using errcode = '22023';
  end if;
  insert into public.loonars2_disbursements (dari_rekening, kategori, unit_id, material_request_id, nominal, tanggal, penerima, keterangan, bukti_url, sumber, dicatat_oleh)
  values (p_dari, p_kategori, p_unit_id, p_request_id, p_nominal, coalesce(p_tanggal, public._loonars2_hari_ini()), p_penerima, p_keterangan, p_bukti, p_sumber, p_aktor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public._loonars2_bayar_pengajuan(p_id integer, p_nominal numeric, p_bukti text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_nominal numeric;
begin
  select * into m from public.loonars2_material_requests where id = p_id for update;
  if not found then return 'Pengajuan L2-' || p_id || ' tidak ditemukan.'; end if;
  if m.status = 'dibayar' then return 'Pengajuan L2-' || p_id || ' sudah tercatat dibayar.'; end if;
  if m.status <> 'disetujui' then return 'Pengajuan L2-' || p_id || ' belum disetujui owner (status: ' || m.status || ').'; end if;
  v_nominal := coalesce(p_nominal, m.nominal);
  perform public._loonars2_catat_pengeluaran('C',
    case m.kategori when 'material' then 'material' when 'tukang' then 'tukang' else 'lain_konstruksi' end,
    v_nominal, m.unit_id, m.id, m.toko, 'Pengajuan L2-' || m.id || ': ' || left(m.deskripsi, 200), p_bukti, null, p_aktor, p_sumber);
  update public.loonars2_material_requests set status = 'dibayar' where id = p_id;
  perform public._loonars2_kirim('owner',
    '💸 L2-' || p_id || ' dibayar ' || public.loonars2_rp(v_nominal) || ' dari C (' || public._loonars2_label_unit(m.unit_id) || '). Dicatat oleh ' || p_aktor || '.',
    'pengajuan_dibayar', 'dibayar:' || p_id, p_bukti);
  perform public._loonars2_kirim('pelaksana',
    '💸 L2-' || p_id || ' tercatat dibayar ' || public.loonars2_rp(v_nominal) || '.', 'pengajuan_dibayar', 'dibayar:' || p_id, null);
  return '✅ L2-' || p_id || ' tercatat dibayar ' || public.loonars2_rp(v_nominal) || ' dari C. Budget unit sudah diperbarui.';
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Profit (D)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_cek_profit(p_nominal numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_set record;
  v_alasan text[] := '{}';
  v_tertunda numeric := public._loonars2_total_tertunda();
  v_saldo_d numeric;
  v_b_konfirm numeric;
  v_belum integer;
  v_serah integer;
  v_min integer;
begin
  select * into v_set from public.loonars2_settings where id = 1;
  if v_tertunda > 0 then
    v_alasan := v_alasan || ('Masih ada ' || public.loonars2_rp(v_tertunda) || ' belum dipindahkan dari A.');
  end if;
  select saldo into v_saldo_d from public.loonars2_v_rekening where kode = 'D';
  if p_nominal is null or p_nominal <= 0 then
    v_alasan := v_alasan || 'Nominal pencairan tidak valid.'::text;
  elsif p_nominal > v_saldo_d then
    v_alasan := v_alasan || ('Saldo D hanya ' || public.loonars2_rp(v_saldo_d) || '.');
  end if;
  if coalesce((v_set.milestone_profit ->> 'wajib_target_tanah_terkonfirmasi')::boolean, true) then
    select coalesce(sum(nominal), 0) into v_b_konfirm from public.loonars2_allocations where ke_rekening = 'B' and status = 'terkonfirmasi';
    if v_b_konfirm < v_set.target_tanah then
      v_alasan := v_alasan || ('Dana tanah terkonfirmasi baru ' || public.loonars2_rp(v_b_konfirm) || ' dari target ' || public.loonars2_rp(v_set.target_tanah) || '.');
    end if;
  end if;
  if coalesce((v_set.milestone_profit ->> 'wajib_unit_terjual_terdanai_penuh')::boolean, true) then
    select count(*) into v_belum from public.loonars2_v_unit
     where status in ('dp', 'lunas') and c_terkonfirmasi < kebutuhan_c;
    if v_belum > 0 then
      v_alasan := v_alasan || (v_belum || ' unit terjual belum terdanai penuh di C (terkonfirmasi).');
    end if;
  end if;
  v_min := coalesce((v_set.milestone_profit ->> 'min_unit_serah_terima')::int, 0);
  if v_min > 0 then
    select count(*) into v_serah from public.loonars2_units where status_bangun = 'serah_terima';
    if v_serah < v_min then
      v_alasan := v_alasan || ('Baru ' || v_serah || ' unit serah terima dari minimal ' || v_min || '.');
    end if;
  end if;
  return jsonb_build_object('boleh', cardinality(v_alasan) = 0, 'alasan', to_jsonb(v_alasan), 'saldo_d', v_saldo_d);
end;
$$;

create or replace function public._loonars2_cairkan_profit(p_nominal numeric, p_keterangan text, p_bukti text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cek jsonb := public._loonars2_cek_profit(p_nominal);
begin
  if not (v_cek ->> 'boleh')::boolean then
    return '❌ Pencairan profit ditolak:' || E'\n• ' || array_to_string(array(select jsonb_array_elements_text(v_cek -> 'alasan')), E'\n• ');
  end if;
  perform public._loonars2_catat_pengeluaran('D', 'profit', p_nominal, null, null, null, coalesce(p_keterangan, 'Pencairan profit'), p_bukti, null, p_aktor, p_sumber);
  return '✅ Pencairan profit ' || public.loonars2_rp(p_nominal) || ' dari D dicatat. Sisa saldo D: '
         || public.loonars2_rp((select saldo from public.loonars2_v_rekening where kode = 'D')) || '.';
end;
$$;

create or replace function public._loonars2_ubah_rekening(p_kode text, p_bank text, p_nomor text, p_nama text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  update public.loonars2_accounts
     set bank = nullif(trim(p_bank), ''), nomor_rekening = nullif(regexp_replace(coalesce(p_nomor, ''), '[^0-9]', '', 'g'), ''),
         nama_pemilik = nullif(trim(p_nama), '')
   where kode = upper(p_kode);
  if not found then return 'Rekening ' || coalesce(p_kode, '?') || ' tidak dikenal (A/B/C/D).'; end if;
  return '✅ Rekening ' || upper(p_kode) || ' (' || public._loonars2_nama_rekening(upper(p_kode)::char) || ') disimpan: '
         || public._loonars2_detail_rekening(upper(p_kode)::char);
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Pintu WhatsApp (dipanggil MK Connect lewat /api/loonars2/wa)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_rahasia_wa_sah()
returns boolean
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-sync-secret',
    current_setting('request.header.x-sync-secret', true)
  );
  return v_secret is not null and v_provided is not distinct from v_secret;
end;
$$;

create or replace function public._loonars2_wa_jalankan(p_user public.loonars2_wa_users, p_aksi text, p_data jsonb, p_sudah_konfirmasi boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_unit_id smallint;
  v_unit record;
  v_nominal numeric;
  v_jenis text;
  v_id integer;
  v_ids integer[];
  v_receipt integer;
  v_teks text;
  r record;
  v_cek jsonb;
  v_ref text;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');

  if p_aksi in ('receipt', 'konfirmasi_transfer', 'tagihan', 'saldo', 'ubah_rekening', 'putuskan', 'cairkan_profit')
     and p_user.peran <> 'owner' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Perintah ini hanya untuk owner.');
  end if;
  if p_aksi = 'ajukan' and p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Pengajuan material diajukan oleh pelaksana.');
  end if;

  if p_aksi = 'saldo' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_saldo());
  elsif p_aksi = 'tagihan' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_tagihan());

  elsif p_aksi = 'receipt' then
    v_unit_id := public._loonars2_cari_unit(p_data ->> 'unit');
    if v_unit_id is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Sebutkan nomor unit (1–17) atau kodenya, mis. "DP unit 12" / "DP BANYU-06".');
    end if;
    select * into v_unit from public.loonars2_v_unit where id = v_unit_id;
    v_jenis := coalesce(p_data ->> 'jenis', 'cicilan');
    v_nominal := nullif(p_data ->> 'nominal', '')::numeric;
    if v_nominal is null then
      if v_jenis = 'pelunasan' then
        v_nominal := v_unit.sisa_pelunasan;
      elsif v_jenis = 'dp' then
        v_nominal := greatest(v_unit.dp_target - v_unit.total_dibayar, 0);
      end if;
    end if;
    if v_nominal is null or v_nominal <= 0 then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nominalnya, mis. "DP unit ' || v_unit.nomor || ', 210 juta".');
    end if;
    if v_nominal > v_unit.sisa_pelunasan then
      return jsonb_build_object('status', 'ditolak', 'balasan', '❌ ' || public.loonars2_rp(v_nominal) || ' melebihi sisa tagihan '
        || public._loonars2_label_unit(v_unit_id) || ' (' || public.loonars2_rp(v_unit.sisa_pelunasan) || ').');
    end if;
    if not p_sudah_konfirmasi then
      v_teks := 'Konfirmasi: catat ' || upper(v_jenis) || ' ' || public._loonars2_label_unit(v_unit_id)
                || coalesce(' — ' || nullif(trim(coalesce(p_data ->> 'nama_pembeli', v_unit.nama_pembeli)), ''), '')
                || E'\nNominal: ' || public.loonars2_rp(v_nominal)
                || E'\nSisa tagihan setelah ini: ' || public.loonars2_rp(v_unit.sisa_pelunasan - v_nominal)
                || E'\n\nAlokasi:';
      for r in select * from public._loonars2_hitung_alokasi(v_unit_id, v_nominal) loop
        v_teks := v_teks || E'\n→ ' || r.ke_rekening || ' (' || public._loonars2_nama_rekening(r.ke_rekening) || ') ' || public.loonars2_rp(r.nominal);
      end loop;
      insert into public.loonars2_wa_pending (nomor, aksi, data)
      values (p_user.nomor, 'receipt', p_data || jsonb_build_object('nominal', v_nominal, 'jenis', v_jenis))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan', v_teks || E'\n\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    v_receipt := public._loonars2_catat_receipt(v_unit_id, v_jenis, v_nominal, nullif(p_data ->> 'tanggal', '')::date,
                                                p_data ->> 'nama_pembeli', p_data ->> 'bukti_url', v_aktor, 'wa');
    -- Perintah transfer ke owner LAIN (kalau ada lebih dari satu owner);
    -- pengirim sendiri menerimanya sebagai balasan langsung.
    for r in select nomor from public.loonars2_wa_users where peran = 'owner' and aktif and nomor <> p_user.nomor loop
      insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
      values (r.nomor, public._loonars2_teks_instruksi(v_receipt), 'instruksi_transfer', 'instruksi:' || v_receipt || ':' || r.nomor)
      on conflict (kunci) do nothing;
    end loop;
    return jsonb_build_object('status', 'ok', 'receipt_id', v_receipt, 'balasan', public._loonars2_teks_instruksi(v_receipt));

  elsif p_aksi = 'konfirmasi_transfer' then
    v_ref := lower(coalesce(p_data ->> 'ref', ''));
    if v_ref ~ '^t[0-9]+$' then
      v_ids := array[substr(v_ref, 2)::int];
    elsif p_data ? 'rekening' then
      select array[id] into v_ids from public.loonars2_allocations
       where status = 'menunggu' and ke_rekening = upper(p_data ->> 'rekening')
         and (not (p_data ? 'nominal') or nominal = (p_data ->> 'nominal')::numeric)
       order by id limit 1;
    else
      select re.id into v_receipt from public.loonars2_receipts re
       where exists (select 1 from public.loonars2_allocations al where al.receipt_id = re.id and al.status = 'menunggu')
       order by re.id desc limit 1;
      if v_receipt is null then
        return jsonb_build_object('status', 'ok', 'balasan', 'Tidak ada transfer tertunda.');
      end if;
      if v_ref = 'semua' then
        select array_agg(id) into v_ids from public.loonars2_allocations where receipt_id = v_receipt and status = 'menunggu';
      elsif v_ref ~ '^[0-9]$' then
        select array_agg(id) into v_ids from public.loonars2_allocations
         where receipt_id = v_receipt and status = 'menunggu' and urutan = v_ref::int;
      end if;
    end if;
    if v_ids is null or cardinality(v_ids) = 0 then
      return jsonb_build_object('status', 'tidak_cocok', 'balasan',
        'Transfer itu tidak ditemukan di daftar tertunda.' || coalesce(E'\n\n' || public._loonars2_teks_tertunda(), ''));
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_konfirmasi(v_ids, p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'ubah_rekening' then
    if upper(coalesce(p_data ->> 'rekening', '')) not in ('A', 'B', 'C', 'D') or coalesce(p_data ->> 'nomor', '') !~ '[0-9]{4,}' then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Format: ubah rekening C BCA 1234567890 a.n. Nama Pemilik');
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'ubah_rekening', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi ubah rekening ' || upper(p_data ->> 'rekening') || ' (' || public._loonars2_nama_rekening(upper(p_data ->> 'rekening')::char) || ')'
        || E'\nLama: ' || public._loonars2_detail_rekening(upper(p_data ->> 'rekening')::char)
        || E'\nBaru: ' || coalesce(p_data ->> 'bank', '?') || ' ' || (p_data ->> 'nomor') || coalesce(' a.n. ' || (p_data ->> 'nama'), '')
        || E'\n\nBalas YA untuk menyimpan, atau BATAL.');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_ubah_rekening(p_data ->> 'rekening', p_data ->> 'bank', p_data ->> 'nomor', p_data ->> 'nama', v_aktor, 'wa'));

  elsif p_aksi = 'putuskan' then
    v_id := nullif(p_data ->> 'id', '')::int;
    if v_id is null then return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nomor pengajuan, mis. "setujui L2-12".'); end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_putuskan(
      v_id, coalesce((p_data ->> 'setuju')::boolean, false), p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'wa'));

  elsif p_aksi = 'cairkan_profit' then
    v_nominal := nullif(p_data ->> 'nominal', '')::numeric;
    v_cek := public._loonars2_cek_profit(v_nominal);
    if not (v_cek ->> 'boleh')::boolean then
      return jsonb_build_object('status', 'ditolak', 'balasan', '❌ Pencairan profit belum boleh. Syarat yang belum terpenuhi:'
        || E'\n• ' || array_to_string(array(select jsonb_array_elements_text(v_cek -> 'alasan')), E'\n• '));
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'cairkan_profit', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi pencairan profit ' || public.loonars2_rp(v_nominal) || ' dari D (saldo ' || public.loonars2_rp((v_cek ->> 'saldo_d')::numeric) || ').'
        || E'\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_cairkan_profit(v_nominal, p_data ->> 'keterangan', p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'ajukan' then
    return public._loonars2_ajukan(
      public._loonars2_cari_unit(p_data ->> 'unit'), p_data ->> 'kategori', coalesce(nullif(p_data ->> 'deskripsi', ''), '(tanpa rincian)'),
      p_data -> 'items', p_data ->> 'toko', nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'nota_url',
      p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'bayar_pengajuan' then
    v_id := nullif(p_data ->> 'id', '')::int;
    if v_id is null then return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nomor pengajuan, mis. "L2 bayar L2-12".'); end if;
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_bayar_pengajuan(v_id, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'bukti_url', v_aktor, 'wa'));
  end if;

  return jsonb_build_object('status', 'tidak_dikenal', 'balasan', 'Perintah Loonars 2 tidak dikenali.');
exception
  when sqlstate '22023' or sqlstate '23514' then
    return jsonb_build_object('status', 'ditolak', 'balasan', '❌ ' || sqlerrm);
end;
$$;

create or replace function public.loonars2_wa(p_nomor text, p_aksi text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nomor text := public._loonars2_normalisasi_nomor(p_nomor);
  v_user public.loonars2_wa_users;
  v_pending public.loonars2_wa_pending;
  v_hasil jsonb;
  v_baris jsonb;
begin
  if not public._loonars2_rahasia_wa_sah() then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  p_data := coalesce(p_data, '{}'::jsonb);

  -- Antrean keluar (dipakai MK Connect, bukan perintah pengguna).
  if p_aksi = 'outbox_ambil' then
    with dipilih as (
      select id from public.loonars2_outbox
       where (status = 'antri' or (status = 'proses' and diproses_pada < now() - interval '10 minutes'))
         and percobaan < 5
       order by id limit 20
       for update skip locked
    ), diambil as (
      update public.loonars2_outbox o set status = 'proses', diproses_pada = now(), percobaan = o.percobaan + 1
        from dipilih where o.id = dipilih.id
      returning o.id, o.nomor, o.pesan, o.gambar_url
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nomor', nomor, 'pesan', pesan, 'gambar_url', gambar_url) order by id), '[]'::jsonb)
      into v_hasil from diambil;
    return jsonb_build_object('pesan', v_hasil);
  elsif p_aksi = 'outbox_selesai' then
    for v_baris in select * from jsonb_array_elements(coalesce(p_data -> 'hasil', '[]'::jsonb)) loop
      update public.loonars2_outbox
         set status = case when (v_baris ->> 'ok')::boolean then 'terkirim' when percobaan >= 5 then 'gagal' else 'antri' end,
             terkirim_pada = case when (v_baris ->> 'ok')::boolean then now() else null end,
             galat = left(v_baris ->> 'error', 500)
       where id = (v_baris ->> 'id')::bigint and status = 'proses';
    end loop;
    return jsonb_build_object('status', 'ok');
  end if;

  select * into v_user from public.loonars2_wa_users where nomor = v_nomor and aktif;
  if not found then
    insert into public.loonars2_wa_log (nomor, aksi, data, hasil) values (v_nomor, p_aksi, p_data, 'diabaikan: nomor tidak terdaftar');
    return jsonb_build_object('status', 'abaikan');
  end if;

  if p_aksi in ('ya', 'batal') then
    delete from public.loonars2_wa_pending where nomor = v_nomor returning * into v_pending;
    if v_pending.nomor is null or v_pending.kedaluwarsa_pada < now() then
      return jsonb_build_object('status', 'tidak_ada_pending');
    end if;
    if p_aksi = 'batal' then
      v_hasil := jsonb_build_object('status', 'ok', 'balasan', 'Dibatalkan. Tidak ada yang dicatat.');
    else
      v_hasil := public._loonars2_wa_jalankan(v_user, v_pending.aksi, v_pending.data, true);
    end if;
  else
    v_hasil := public._loonars2_wa_jalankan(v_user, p_aksi, p_data, false);
  end if;

  insert into public.loonars2_wa_log (nomor, aksi, data, hasil) values (v_nomor, p_aksi, p_data, coalesce(v_hasil ->> 'status', '?'));
  return v_hasil;
end;
$$;

-- ----------------------------------------------------------------------------
-- 12. Pintu web (CFO login)
-- ----------------------------------------------------------------------------
create or replace function public.loonars2_web(p_aksi text, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text;
  v_id integer;
  v_unit smallint;
  r record;
  v_alokasi jsonb;
begin
  if not public.mkh_is_cfo() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  v_aktor := 'web:' || public.mkh_email_login();
  perform public._loonars2_set_aktor(v_aktor, 'web');
  p_data := coalesce(p_data, '{}'::jsonb);

  if p_aksi = 'pratinjau_alokasi' then
    v_unit := (p_data ->> 'unit_id')::smallint;
    select coalesce(jsonb_agg(jsonb_build_object('ke_rekening', ke_rekening, 'nominal', nominal)), '[]'::jsonb) into v_alokasi
      from public._loonars2_hitung_alokasi(v_unit, (p_data ->> 'nominal')::numeric);
    return jsonb_build_object('alokasi', v_alokasi);

  elsif p_aksi = 'catat_receipt' then
    v_id := public._loonars2_catat_receipt((p_data ->> 'unit_id')::smallint, p_data ->> 'jenis', (p_data ->> 'nominal')::numeric,
              nullif(p_data ->> 'tanggal', '')::date, p_data ->> 'nama_pembeli', nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web');
    -- Dicatat dari web: perintah transfer dikirim ke semua owner lewat WA.
    perform public._loonars2_kirim('owner', public._loonars2_teks_instruksi(v_id), 'instruksi_transfer', 'instruksi:' || v_id);
    return jsonb_build_object('receipt_id', v_id, 'instruksi', public._loonars2_teks_instruksi(v_id));

  elsif p_aksi = 'konfirmasi' then
    return jsonb_build_object('pesan', public._loonars2_konfirmasi(
      array(select jsonb_array_elements_text(p_data -> 'ids')::int), nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web'));

  elsif p_aksi = 'batal_receipt' then
    v_id := (p_data ->> 'receipt_id')::int;
    if exists (select 1 from public.loonars2_allocations where receipt_id = v_id and status = 'terkonfirmasi') then
      raise exception 'Receipt sudah punya transfer terkonfirmasi; tidak bisa dibatalkan' using errcode = '22023';
    end if;
    update public.loonars2_allocations set status = 'batal' where receipt_id = v_id and status = 'menunggu';
    update public.loonars2_receipts set status = 'batal', alasan_batal = nullif(trim(p_data ->> 'alasan'), '') where id = v_id and status = 'aktif';
    -- Hitung ulang status unit dari pembayaran yang masih aktif.
    for r in select u.id, u.harga_efektif, u.dp_target, u.total_dibayar from public.loonars2_v_unit u
              where u.id = (select unit_id from public.loonars2_receipts where id = v_id) loop
      update public.loonars2_units set status = case
          when r.total_dibayar >= r.harga_efektif then 'lunas'
          when r.total_dibayar >= r.dp_target then 'dp'
          when r.total_dibayar > 0 then 'booking'
          else 'tersedia' end
       where id = r.id;
    end loop;
    return jsonb_build_object('status', 'ok');

  elsif p_aksi = 'ajukan' then
    return public._loonars2_ajukan((p_data ->> 'unit_id')::smallint, p_data ->> 'kategori', p_data ->> 'deskripsi', null,
             p_data ->> 'toko', (p_data ->> 'nominal')::numeric, nullif(p_data ->> 'nota_url', ''), public.mkh_email_login(), null, 'web');

  elsif p_aksi = 'putuskan' then
    return jsonb_build_object('pesan', public._loonars2_putuskan((p_data ->> 'id')::int, (p_data ->> 'setuju')::boolean,
             p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'web'));

  elsif p_aksi = 'bayar_pengajuan' then
    return jsonb_build_object('pesan', public._loonars2_bayar_pengajuan((p_data ->> 'id')::int,
             nullif(p_data ->> 'nominal', '')::numeric, nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web'));

  elsif p_aksi = 'catat_pengeluaran' then
    if p_data ->> 'kategori' = 'profit' then
      return jsonb_build_object('pesan', public._loonars2_cairkan_profit((p_data ->> 'nominal')::numeric,
               p_data ->> 'keterangan', nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web'));
    end if;
    v_id := public._loonars2_catat_pengeluaran((p_data ->> 'dari')::char, p_data ->> 'kategori', (p_data ->> 'nominal')::numeric,
              nullif(p_data ->> 'unit_id', '')::smallint, null, p_data ->> 'penerima', p_data ->> 'keterangan',
              nullif(p_data ->> 'bukti_url', ''), nullif(p_data ->> 'tanggal', '')::date, v_aktor, 'web');
    return jsonb_build_object('id', v_id);

  elsif p_aksi = 'cek_profit' then
    return public._loonars2_cek_profit((p_data ->> 'nominal')::numeric);

  elsif p_aksi = 'ringkasan' then
    return jsonb_build_object(
      'tertunda', public._loonars2_total_tertunda(),
      'teks_tertunda', public._loonars2_teks_tertunda(),
      'proyeksi_tanah', public._loonars2_proyeksi_tanah(),
      'kesehatan', public._loonars2_cek_kesehatan());
  end if;
  raise exception 'Aksi tidak dikenal: %', p_aksi using errcode = '22023';
end;
$$;

-- ----------------------------------------------------------------------------
-- 13. Pengingat & laporan otomatis (pg_cron tiap 15 menit)
-- ----------------------------------------------------------------------------
create or replace function public.loonars2_pengingat()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_set record;
  v_lokal timestamp := now() at time zone 'Asia/Jakarta';
  v_hari date := (now() at time zone 'Asia/Jakarta')::date;
  v_tertunda numeric;
  v_tertua timestamptz;
  r record;
  v_teks text;
  v_n integer;
  v_hari_ke integer;
  v_proy jsonb;
  v_sehat jsonb;
  v_rata interval;
  v_rekap_baru integer := 0;
begin
  perform public._loonars2_set_aktor('sistem:pengingat', 'sistem');
  select * into v_set from public.loonars2_settings where id = 1;
  -- Tidak ada pesan di luar jam kerja.
  if v_lokal::time < make_time(v_set.jam_mulai_pengingat, 0, 0)
     or v_lokal::time > make_time(least(v_set.jam_selesai_pengingat, 23), case when v_set.jam_selesai_pengingat = 24 then 59 else 0 end, 0) then
    return;
  end if;

  -- (a) Rekap pagi semua transfer tertunda — sekali sehari.
  v_teks := public._loonars2_teks_tertunda();
  if v_teks is not null then
    v_rekap_baru := public._loonars2_kirim('owner', '🌅 REKAP PAGI' || E'\n' || v_teks, 'rekap_pagi', 'rekap:' || v_hari);
  end if;
  -- Rekap pagi baru saja dikirim: jam pengingat per receipt dihitung ulang
  -- dari sekarang, supaya isi yang sama tidak terkirim dua kali.
  if v_rekap_baru > 0 then
    update public.loonars2_receipts re set terakhir_diingatkan_pada = now()
     where re.status = 'aktif'
       and exists (select 1 from public.loonars2_allocations al where al.receipt_id = re.id and al.status = 'menunggu');
  end if;

  -- (b) Pengingat per receipt tiap N jam selama masih ada transfer tertunda.
  for r in
    select re.* from public.loonars2_receipts re
     where re.status = 'aktif'
       and exists (select 1 from public.loonars2_allocations al where al.receipt_id = re.id and al.status = 'menunggu')
       and coalesce(re.terakhir_diingatkan_pada, re.dibuat_pada) <= now() - make_interval(hours => v_set.interval_pengingat_jam)
  loop
    perform public._loonars2_kirim('owner',
      '⏰ PENGINGAT (' || round(extract(epoch from now() - r.dibuat_pada) / 3600) || ' jam sejak dicatat)' || E'\n'
      || public._loonars2_teks_instruksi(r.id), 'pengingat_transfer',
      'pengingat:' || r.id || ':' || to_char(v_lokal, 'YYYYMMDDHH24'));
    update public.loonars2_receipts set terakhir_diingatkan_pada = now() where id = r.id;
  end loop;

  -- (c) Eskalasi merah bila ada uang mengendap di A lebih dari N jam.
  select coalesce(sum(al.nominal), 0), min(re.dibuat_pada) into v_tertunda, v_tertua
    from public.loonars2_allocations al join public.loonars2_receipts re on re.id = al.receipt_id
   where al.status = 'menunggu';
  if v_tertunda > 0 and v_tertua <= now() - make_interval(hours => v_set.eskalasi_jam) then
    perform public._loonars2_kirim('owner',
      '🚨 PERINGATAN MERAH: ' || public.loonars2_rp(v_tertunda) || ' MENGENDAP DI REKENING A sudah '
      || floor(extract(epoch from now() - v_tertua) / 86400) || ' hari ' || floor(mod(extract(epoch from now() - v_tertua)::numeric, 86400) / 3600) || ' jam.'
      || E'\nPencairan profit diblokir sampai semua transfer dikonfirmasi.' || E'\n\n' || public._loonars2_teks_tertunda(),
      'eskalasi', 'eskalasi:' || v_hari);
  end if;

  -- (d) Pelunasan: H-14, H-7, H-1, dan setiap pagi bila lewat jatuh tempo.
  v_teks := '';
  v_n := 0;
  for r in
    select * from public.loonars2_v_unit
     where status in ('booking', 'dp') and sisa_pelunasan > 0 and jatuh_tempo_efektif is not null
       and (jatuh_tempo_efektif - v_hari in (14, 7, 1) or jatuh_tempo_efektif < v_hari)
     order by jatuh_tempo_efektif
  loop
    v_n := v_n + 1;
    v_hari_ke := r.jatuh_tempo_efektif - v_hari;
    v_teks := v_teks || E'\n' || case when v_hari_ke < 0 then '🔴 LEWAT ' || -v_hari_ke || ' hari' else 'H-' || v_hari_ke end
              || ': Unit ' || r.nomor || ' ' || r.kode || ' — ' || coalesce(r.nama_pembeli, '(nama pembeli belum diisi)')
              || ' — tagih ' || public.loonars2_rp(r.sisa_pelunasan) || ' (jatuh tempo ' || to_char(r.jatuh_tempo_efektif, 'DD-MM-YYYY') || ')';
  end loop;
  if v_n > 0 then
    perform public._loonars2_kirim('owner', '📅 PENGINGAT PELUNASAN LOONARS 2' || v_teks, 'pelunasan', 'pelunasan:' || v_hari);
  end if;

  -- (e) Laporan mingguan (Senin).
  if extract(isodow from v_hari) = 1 then
    v_proy := public._loonars2_proyeksi_tanah();
    select rata_rata into v_rata from public.loonars2_v_lama_mengendap;
    select count(*) into v_n from public.loonars2_material_requests where status = 'menunggu';
    v_teks := '📊 LAPORAN MINGGUAN LOONARS 2' || E'\n\n' || public._loonars2_teks_saldo()
      || E'\n\n🏠 Unit: ' || (select count(*) from public.loonars2_units where status in ('dp', 'lunas')) || ' terjual (DP/lunas), '
      || (select count(*) from public.loonars2_units where status = 'lunas') || ' lunas, '
      || (select count(*) from public.loonars2_units where status = 'booking') || ' booking, '
      || (select count(*) from public.loonars2_units where status = 'tersedia') || ' tersedia'
      || E'\n📋 Pengajuan menunggu keputusan: ' || v_n
      || E'\n\n🏞️ Proyeksi dana tanah s.d. jatuh tempo: ' || public.loonars2_rp((v_proy ->> 'proyeksi')::numeric)
      || ' dari ' || public.loonars2_rp((v_proy ->> 'target')::numeric)
      || E'\n   (B sudah dialokasikan ' || public.loonars2_rp((v_proy ->> 'b_dialokasikan')::numeric)
      || ' + pelunasan terjadwal ke B ' || public.loonars2_rp((v_proy ->> 'pelunasan_terjadwal_ke_b')::numeric) || ')'
      || case when (v_proy ->> 'kurang')::numeric > 0
           then E'\n🔴 PROYEKSI KURANG ' || public.loonars2_rp((v_proy ->> 'kurang')::numeric)
                || ' — perlu sekitar ' || (v_proy ->> 'unit_tambahan') || ' unit tambahan terjual dan lunas sebelum jatuh tempo tanah.'
           else E'\n✅ Proyeksi mencukupi target.' end
      || coalesce(E'\n\n⏱️ Rata-rata uang mengendap di A sebelum dipindah: '
           || floor(extract(epoch from v_rata) / 3600) || ' jam ' || floor(mod(extract(epoch from v_rata)::numeric, 3600) / 60) || ' menit', '');
    perform public._loonars2_kirim('owner', v_teks, 'mingguan', 'mingguan:' || to_char(v_hari, 'IYYY-IW'));
  end if;

  -- (f) Cek kesehatan bulanan (tanggal 1).
  if extract(day from v_hari) = 1 then
    v_sehat := public._loonars2_cek_kesehatan();
    if (v_sehat ->> 'kurang')::numeric > 0 then
      perform public._loonars2_kirim('owner',
        '🚨 CEK KESEHATAN BULANAN — Ada kebocoran: saldo C kurang ' || public.loonars2_rp((v_sehat ->> 'kurang')::numeric)
        || ' untuk menyelesaikan unit yang sudah terjual.'
        || E'\nSaldo C ' || public.loonars2_rp((v_sehat ->> 'saldo_c')::numeric) || ', sisa kebutuhan C unit terjual '
        || public.loonars2_rp((v_sehat ->> 'kebutuhan_sisa')::numeric)
        || case when (v_sehat ->> 'menunggu_ke_c')::numeric > 0
             then E'\n(' || public.loonars2_rp((v_sehat ->> 'menunggu_ke_c')::numeric) || ' masih menunggu transfer A → C.)' else '' end,
        'kesehatan', 'kesehatan:' || to_char(v_hari, 'YYYY-MM'));
    end if;
  end if;
  -- Konfirmasi "YA" yang kedaluwarsa tidak perlu dihapus di sini: loonars2_wa
  -- menolaknya saat dibaca dan konfirmasi berikutnya menimpanya.
end;
$$;

-- Membangunkan MK Connect bila ada pesan antre. MK Connect yang mengambil
-- isinya (loonars2_wa 'outbox_ambil') dan mengirim lewat Whacenter.
create or replace function public.loonars2_outbox_bangunkan()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  v_url text;
begin
  if not exists (
    select 1 from public.loonars2_outbox
     where percobaan < 5 and (status = 'antri' or (status = 'proses' and diproses_pada < now() - interval '10 minutes'))
  ) then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select mk_connect_url into v_url from public.loonars2_settings where id = 1;
  if v_secret is null or v_url is null then return; end if;
  perform net.http_post(
    url := v_url || '/api/loonars2/outbox',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 14. Hak eksekusi
-- ----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  -- Semua fungsi internal (_loonars2_*) dan fungsi cron tertutup untuk
  -- klien; hanya dipanggil dari fungsi lain/pg_cron.
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '\_loonars2\_%' or p.proname in ('loonars2_pengingat', 'loonars2_outbox_bangunkan',
            'loonars2_audit', 'loonars2_cek_jumlah_alokasi', 'loonars2_sentuh_diubah_pada'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

revoke execute on function public.loonars2_wa(text, text, jsonb) from public;
grant execute on function public.loonars2_wa(text, text, jsonb) to anon, authenticated;
revoke execute on function public.loonars2_web(text, jsonb) from public, anon;
grant execute on function public.loonars2_web(text, jsonb) to authenticated;
grant execute on function public.loonars2_rp(numeric) to authenticated;

alter function public.loonars2_rp(numeric) set search_path = public;
alter function public._loonars2_hari_ini() set search_path = public;
alter function public._loonars2_normalisasi_nomor(text) set search_path = public;
alter function public._loonars2_sumber() set search_path = public;
alter function public._loonars2_set_aktor(text, text) set search_path = public;
alter function public.loonars2_sentuh_diubah_pada() set search_path = public;

do $$
begin
  perform cron.schedule('loonars2-pengingat', '*/15 * * * *', 'select public.loonars2_pengingat()');
  perform cron.schedule('loonars2-outbox', '*/1 * * * *', 'select public.loonars2_outbox_bangunkan()');
end $$;
