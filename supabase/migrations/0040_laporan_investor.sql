-- ============================================================================
-- 0040 — Modul Laporan Investor
--
-- Keputusan owner (2026-10-10):
--   - Cakupan = seluruh perusahaan: semua proyek pembangunan + operasi properti.
--   - Modul REALTIME: laporan selalu dihitung ulang dari data terbaru, sehingga
--     perbaikan data/rumus di sumber otomatis tercermin. Tetap transparan:
--     setiap kali angka kiriman sistem lain berubah, versi lamanya disimpan di
--     ir_metrik_log dan laporan menandai bulan yang pernah direvisi.
--   - Nama tabel bebas → awalan ir_ (investor report) agar tidak bertabrakan
--     dengan tabel aplikasi lain di proyek Supabase yang sama.
--   - Laporan bisa diminta lewat WhatsApp oleh nomor yang terdaftar.
--
-- Sumber angka:
--   - Proyek pembangunan & laporan perusahaan → `jurnal` (dihitung di aplikasi
--     dengan mesin SAK EMKM yang sudah ada, src/lib/akuntansi/sak-emkm.ts —
--     tidak ada rumus akuntansi baru).
--   - Operasi properti (okupansi, ADR, channel, headcount, kewajiban investor,
--     …) → ir_metrik_bulanan, didorong sistem lain lewat RPC ir_metrik_terima
--     atau diisi manual oleh CFO.
--
-- Keamanan: semua tabel hanya untuk CFO/owner (cfo_users, lewat
-- mkh_is_cfo() dari 0036). Tidak ada policy untuk anon. Tidak ada kolom data
-- pribadi tamu/karyawan; RPC penerima menolak kunci metrik di luar kontrak.
--
-- Catatan penerapan: tanpa `if exists/if not exists` dan tanpa SELECT di
-- tingkat atas (lihat catatan di 0036).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Unit bisnis = properti yang dioperasikan ATAU proyek pembangunan.
-- Menambah properti/proyek baru = menambah satu baris di sini (lewat halaman
-- Laporan Investor → Tambah unit bisnis). Kode modul tidak perlu diubah.
-- ----------------------------------------------------------------------------
create table public.ir_unit_bisnis (
  id bigint generated always as identity primary key,
  kode text not null unique check (kode ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  nama text not null check (length(nama) between 2 and 120),
  jenis text not null check (jenis in ('operasi_properti', 'proyek_pembangunan')),
  kota text,
  tgl_mulai_operasi date,
  jumlah_unit_total integer check (jumlah_unit_total is null or jumlah_unit_total >= 0),
  jumlah_unit_dijual integer check (jumlah_unit_dijual is null or jumlah_unit_dijual >= 0),
  model_kepemilikan text check (model_kepemilikan is null or model_kepemilikan in ('milik_sendiri', 'sewa', 'kontrak_manajemen')),
  -- kode `jurnal.proyek` milik unit ini (proyek pembangunan); kosong untuk
  -- operasi properti yang pembukuannya belum masuk jurnal.
  kode_proyek_jurnal text[] not null default '{}',
  -- label sumber data untuk lampiran (mis. 'jurnal', 'villa-api', 'manual')
  sumber_data text not null default 'manual',
  -- tabel lama pendapatan_villa/beban_villa (sebelum modul ini) milik unit ini
  pakai_tabel_villa_lama boolean not null default false,
  aktif boolean not null default true,
  catatan text,
  dibuat_pada timestamptz not null default now(),
  diubah_pada timestamptz not null default now()
);

comment on table public.ir_unit_bisnis is
  'Laporan Investor: properti yang dioperasikan dan proyek pembangunan. Satu baris = satu unit di laporan.';

-- ----------------------------------------------------------------------------
-- Metrik bulanan kiriman sistem lain (atau input manual CFO). Satu baris per
-- unit × periode × sumber; kiriman ulang MENIMPA (realtime) dan versi lama
-- otomatis disalin ke ir_metrik_log.
-- ----------------------------------------------------------------------------
create table public.ir_metrik_bulanan (
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.ir_unit_bisnis(id),
  periode text not null check (periode ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sumber text not null check (sumber ~ '^[a-z0-9_-]{2,40}$'),
  metrik jsonb not null check (jsonb_typeof(metrik) = 'object'),
  versi_definisi text not null,
  status text not null default 'sementara' check (status in ('sementara', 'final')),
  dihitung_pada timestamptz not null default now(),
  diterima_pada timestamptz not null default now(),
  revisi integer not null default 0,
  unique (unit_id, periode, sumber)
);

create table public.ir_metrik_log (
  id bigint generated always as identity primary key,
  metrik_id bigint not null,
  unit_id bigint not null,
  periode text not null,
  sumber text not null,
  aksi text not null check (aksi in ('baru', 'revisi')),
  metrik_lama jsonb,
  metrik_baru jsonb not null,
  versi_definisi_lama text,
  versi_definisi_baru text not null,
  status_lama text,
  status_baru text not null,
  dicatat_pada timestamptz not null default now()
);

create or replace function public.ir_metrik_catat_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ir_metrik_log (metrik_id, unit_id, periode, sumber, aksi, metrik_baru, versi_definisi_baru, status_baru)
    values (new.id, new.unit_id, new.periode, new.sumber, 'baru', new.metrik, new.versi_definisi, new.status);
  elsif new.metrik is distinct from old.metrik or new.status is distinct from old.status
        or new.versi_definisi is distinct from old.versi_definisi then
    insert into public.ir_metrik_log (metrik_id, unit_id, periode, sumber, aksi, metrik_lama, metrik_baru,
                                      versi_definisi_lama, versi_definisi_baru, status_lama, status_baru)
    values (new.id, new.unit_id, new.periode, new.sumber, 'revisi', old.metrik, new.metrik,
            old.versi_definisi, new.versi_definisi, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger trg_ir_metrik_catat_log
  after insert or update on public.ir_metrik_bulanan
  for each row execute function public.ir_metrik_catat_log();

create or replace function public.ir_metrik_hitung_revisi()
returns trigger
language plpgsql
as $$
begin
  if new.metrik is distinct from old.metrik or new.status is distinct from old.status
     or new.versi_definisi is distinct from old.versi_definisi then
    new.revisi := old.revisi + 1;
  end if;
  return new;
end;
$$;

create trigger trg_ir_metrik_hitung_revisi
  before update on public.ir_metrik_bulanan
  for each row execute function public.ir_metrik_hitung_revisi();

-- ----------------------------------------------------------------------------
-- Narasi manual (strategi, risiko, teknologi, …), berversi: setiap simpan
-- menambah baris baru; tidak ada ubah/hapus.
-- ----------------------------------------------------------------------------
create table public.ir_narasi (
  id bigint generated always as identity primary key,
  bagian text not null check (bagian in ('ringkasan', 'strategi', 'teknologi', 'risiko', 'mitigasi', 'catatan')),
  isi text not null check (length(isi) <= 20000),
  dibuat_oleh text not null default coalesce(public.mkh_email_login(), 'sistem'),
  dibuat_pada timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Jejak setiap unduhan/kiriman laporan. PDF-nya sendiri TIDAK disimpan.
-- ----------------------------------------------------------------------------
create table public.ir_unduhan_log (
  id bigint generated always as identity primary key,
  kanal text not null check (kanal in ('web', 'whatsapp')),
  peminta text not null,
  parameter jsonb not null,
  sha256 text,
  ukuran_byte integer,
  dibuat_pada timestamptz not null default now()
);

-- Nomor WhatsApp yang boleh meminta laporan (super admin / owner).
create table public.ir_wa_penerima (
  nomor text primary key check (nomor ~ '^62[0-9]{8,14}$'),
  nama text not null,
  aktif boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- RLS: hanya CFO/owner.
-- ----------------------------------------------------------------------------
alter table public.ir_unit_bisnis enable row level security;
alter table public.ir_metrik_bulanan enable row level security;
alter table public.ir_metrik_log enable row level security;
alter table public.ir_narasi enable row level security;
alter table public.ir_unduhan_log enable row level security;
alter table public.ir_wa_penerima enable row level security;

revoke all on public.ir_unit_bisnis, public.ir_metrik_bulanan, public.ir_metrik_log,
  public.ir_narasi, public.ir_unduhan_log, public.ir_wa_penerima from anon;

create policy cfo_kelola on public.ir_unit_bisnis for all to authenticated
  using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));
create policy cfo_kelola on public.ir_metrik_bulanan for all to authenticated
  using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));
create policy cfo_baca on public.ir_metrik_log for select to authenticated
  using ((select public.mkh_is_cfo()));
create policy cfo_baca on public.ir_narasi for select to authenticated
  using ((select public.mkh_is_cfo()));
create policy cfo_tambah on public.ir_narasi for insert to authenticated
  with check ((select public.mkh_is_cfo()));
create policy cfo_baca on public.ir_unduhan_log for select to authenticated
  using ((select public.mkh_is_cfo()));
create policy cfo_kelola on public.ir_wa_penerima for all to authenticated
  using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));

grant select, insert, update, delete on public.ir_unit_bisnis, public.ir_metrik_bulanan, public.ir_wa_penerima to authenticated;
grant select on public.ir_metrik_log, public.ir_unduhan_log to authenticated;
grant select, insert on public.ir_narasi to authenticated;
revoke update, delete on public.ir_narasi from authenticated;
revoke insert, update, delete on public.ir_metrik_log, public.ir_unduhan_log from authenticated;

-- ----------------------------------------------------------------------------
-- Kontrak KPI v1: kunci metrik yang boleh dikirim. Kunci lain ditolak supaya
-- tidak ada data pribadi (nama tamu, nomor HP, rekening, gaji per orang) yang
-- bisa masuk lewat jalur ini. Definisi tiap kunci ada di
-- src/lib/laporan-investor/kontrak.ts (dan di lampiran PDF).
-- ----------------------------------------------------------------------------
create or replace function public.ir_kunci_metrik_v1()
returns text[]
language sql
immutable
as $$
  select array[
    'hari_operasi',
    'unit_total', 'unit_dijual',
    'malam_tersedia_total', 'malam_tersedia_dijual', 'malam_terjual',
    'okupansi_unit_total_pct', 'okupansi_unit_dijual_pct',
    'pendapatan_kotor', 'pendapatan_basis_investor', 'pendapatan_bersih', 'pendapatan_walkin',
    'adr_kotor', 'adr_bersih', 'revpar_kotor', 'revpar_bersih',
    'booking_diakui', 'booking_batal', 'booking_pra_buka',
    'channel', 'porsi_ota_pct', 'porsi_langsung_pct',
    'headcount', 'headcount_total', 'fungsi_outsourcing',
    'total_gaji', 'jumlah_penerima_gaji', 'biaya_hr',
    'biaya_operasional', 'biaya_vendor_outsourcing',
    'kewajiban_investor_tetap', 'kewajiban_investor_jaminan',
    'kas', 'utang',
    'anggaran_total', 'realisasi_biaya', 'progres_fisik_pct',
    'catatan_sumber'
  ]::text[];
$$;

-- ----------------------------------------------------------------------------
-- RPC penerima metrik dari sistem lain. Pola sama dengan villa_income_sync:
-- dipanggil lewat anon key + header x-ir-sync-secret yang dicocokkan dengan
-- Vault secret 'ir_sync_shared_secret' (dibuat owner; tidak ada di repo).
-- ----------------------------------------------------------------------------
create or replace function public.ir_metrik_terima(
  p_unit_kode text,
  p_periode text,
  p_sumber text,
  p_metrik jsonb,
  p_versi_definisi text,
  p_status text default 'sementara',
  p_dihitung_pada timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
  v_unit_id bigint;
  v_kunci_asing text[];
  v_id bigint;
  v_revisi int;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ir_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-ir-sync-secret',
    current_setting('request.header.x-ir-sync-secret', true)
  );
  if v_secret is null or v_provided is distinct from v_secret then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  select id into v_unit_id from public.ir_unit_bisnis where kode = p_unit_kode and aktif;
  if v_unit_id is null then
    raise exception 'Unit bisnis % tidak dikenal atau tidak aktif', p_unit_kode using errcode = '22023';
  end if;
  if p_metrik is null or jsonb_typeof(p_metrik) <> 'object' or length(p_metrik::text) > 50000 then
    raise exception 'metrik harus objek JSON' using errcode = '22023';
  end if;
  if p_status not in ('sementara', 'final') then
    raise exception 'status harus sementara/final' using errcode = '22023';
  end if;

  select array_agg(k) into v_kunci_asing
    from jsonb_object_keys(p_metrik) k
   where k <> all (public.ir_kunci_metrik_v1());
  if v_kunci_asing is not null then
    raise exception 'Kunci metrik di luar kontrak: %', array_to_string(v_kunci_asing, ', ') using errcode = '22023';
  end if;

  insert into public.ir_metrik_bulanan (unit_id, periode, sumber, metrik, versi_definisi, status, dihitung_pada)
  values (v_unit_id, p_periode, p_sumber, p_metrik, p_versi_definisi, p_status, coalesce(p_dihitung_pada, now()))
  on conflict (unit_id, periode, sumber) do update
     set metrik = excluded.metrik,
         versi_definisi = excluded.versi_definisi,
         status = excluded.status,
         dihitung_pada = excluded.dihitung_pada,
         diterima_pada = now()
  returning id, revisi into v_id, v_revisi;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status, target_ref)
  values ('inbound', 'ir_metrik_diterima', 'ir_metrik_bulanan', v_id::text,
          'ir:' || p_unit_kode || ':' || p_periode || ':' || p_sumber || ':' || clock_timestamp()::text,
          jsonb_build_object('unit', p_unit_kode, 'periode', p_periode, 'sumber', p_sumber,
                             'versi_definisi', p_versi_definisi, 'status', p_status, 'revisi', v_revisi),
          'succeeded', v_id::text);

  return jsonb_build_object('status', 'ok', 'id', v_id, 'revisi', v_revisi);
end;
$$;

revoke execute on function public.ir_metrik_terima(text, text, text, jsonb, text, text, timestamptz) from public;
grant execute on function public.ir_metrik_terima(text, text, text, jsonb, text, text, timestamptz) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Akses data laporan. Dua jalur:
--   1. CFO login (halaman web / unduh PDF): mkh_is_cfo().
--   2. Permintaan WhatsApp lewat server mkh-properti: header
--      x-ir-report-secret = Vault 'ir_report_secret' DAN nomor peminta
--      terdaftar aktif di ir_wa_penerima.
-- Hanya kolom yang dibutuhkan laporan yang dikembalikan — keterangan jurnal
-- (bisa memuat nama orang), nama pembeli aset, dan nomor akad tidak ikut.
-- ----------------------------------------------------------------------------
create or replace function public.ir_boleh_akses(p_peminta_wa text)
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
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ir_report_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-ir-report-secret',
    current_setting('request.header.x-ir-report-secret', true)
  );
  if v_secret is not null and v_provided is not distinct from v_secret
     and exists (select 1 from public.ir_wa_penerima w where w.nomor = p_peminta_wa and w.aktif) then
    return 'wa:' || p_peminta_wa;
  end if;
  return null;
end;
$$;

revoke execute on function public.ir_boleh_akses(text) from public, anon, authenticated;

create or replace function public.ir_ambil_data(p_sampai date, p_peminta_wa text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_peminta text;
begin
  v_peminta := public.ir_boleh_akses(p_peminta_wa);
  if v_peminta is null then
    raise exception 'Tidak berhak mengakses Laporan Investor' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'peminta', v_peminta,
    'diambil_pada', now(),
    'unit_bisnis', coalesce((select jsonb_agg(to_jsonb(u) order by u.jenis, u.id) from public.ir_unit_bisnis u), '[]'::jsonb),
    -- jurnal kumulatif s.d. akhir rentang (neraca butuh sejak awal berdiri)
    'jurnal', coalesce((
      select jsonb_agg(jsonb_build_object('tgl', j.tgl, 'no', j.no, 'akun', j.akun, 'nama', j.nama,
                                          'proyek', j.proyek, 'd', j.d, 'k', j.k) order by j.tgl, j.id)
        from public.jurnal j where j.tgl <= p_sampai), '[]'::jsonb),
    'pendapatan_villa', coalesce((
      select jsonb_agg(jsonb_build_object('periode', to_char(v.periode, 'YYYY-MM'), 'kategori', v.kategori,
                                          'jumlah', v.jumlah, 'sumber', v.sumber, 'diubah', v.updated_at))
        from public.pendapatan_villa v where v.periode <= p_sampai), '[]'::jsonb),
    'beban_villa', coalesce((
      select jsonb_agg(jsonb_build_object('periode', to_char(b.periode, 'YYYY-MM'), 'kategori', b.kategori,
                                          'jumlah', b.jumlah, 'sumber', b.sumber))
        from public.beban_villa b where b.periode <= p_sampai), '[]'::jsonb),
    'utang_bank', coalesce((
      select jsonb_agg(jsonb_build_object('proyek', u.proyek, 'jenis', u.jenis, 'bank', u.bank, 'pokok', u.pokok,
                                          'terbayar', u.terbayar, 'tgl_akad', u.tgl_akad, 'jt_tempo', u.jt_tempo))
        from public.utang_bank u), '[]'::jsonb),
    'aset_ringkas', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('proyek', a.proyek, 'status', coalesce(a.status, '-'),
                                  'jumlah', count(*), 'nilai', coalesce(sum(a.harga), 0)) x
          from public.aset a group by a.proyek, a.status) s), '[]'::jsonb),
    'metrik', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.unit_id, m.periode) from public.ir_metrik_bulanan m
       where m.periode <= to_char(p_sampai, 'YYYY-MM')), '[]'::jsonb),
    'narasi', coalesce((
      select jsonb_object_agg(n.bagian, jsonb_build_object('isi', n.isi, 'dibuat_pada', n.dibuat_pada, 'dibuat_oleh', n.dibuat_oleh))
        from (select distinct on (bagian) * from public.ir_narasi order by bagian, id desc) n), '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.ir_ambil_data(date, text) from public;
grant execute on function public.ir_ambil_data(date, text) to anon, authenticated;

create or replace function public.ir_catat_unduhan(
  p_kanal text,
  p_parameter jsonb,
  p_sha256 text,
  p_ukuran integer,
  p_peminta_wa text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_peminta text;
  v_id bigint;
begin
  v_peminta := public.ir_boleh_akses(p_peminta_wa);
  if v_peminta is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  insert into public.ir_unduhan_log (kanal, peminta, parameter, sha256, ukuran_byte)
  values (p_kanal, v_peminta, coalesce(p_parameter, '{}'::jsonb), p_sha256, p_ukuran)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.ir_catat_unduhan(text, jsonb, text, integer, text) from public;
grant execute on function public.ir_catat_unduhan(text, jsonb, text, integer, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Data awal: unit bisnis yang sudah punya data di sistem (2026-10-10).
-- Kolom yang belum diketahui pasti (kota beberapa proyek, model kepemilikan,
-- unit dijual) sengaja dibiarkan kosong — diisi owner dari halaman modul,
-- tidak ditebak. Kota diisi hanya bila tercatat di tabel branches /
-- nama proyek di MK Connect.
-- ----------------------------------------------------------------------------
insert into public.ir_unit_bisnis
  (kode, nama, jenis, kota, tgl_mulai_operasi, jumlah_unit_total, kode_proyek_jurnal, sumber_data, pakai_tabel_villa_lama, catatan)
values
  ('loonars-1', 'Loonars Private Living', 'operasi_properti', null, date '2026-09-23', 13, '{}', 'villa-api', true,
   'Buka resmi 23 Sep 2026 (owner). 13 unit tercatat di sistem villa. Kode sama dengan finance_property_config.property_code di sistem villa.'),
  ('afp', 'Al Fath Puuwatu', 'proyek_pembangunan', 'Kendari', null, null, '{AFP}', 'jurnal', false, null),
  ('gci', 'Griya Cariu Indah', 'proyek_pembangunan', 'Bogor', null, null, '{GCI}', 'jurnal', false, null),
  ('gcr', 'Green Cibarusah Residence', 'proyek_pembangunan', null, null, null, '{GCR}', 'jurnal', false, null),
  ('ih', 'Introvert House', 'proyek_pembangunan', 'Makassar', null, null, '{IH}', 'jurnal', false, null),
  ('kdi', 'Pembangunan Cabang Kendari', 'proyek_pembangunan', 'Kendari', null, null, '{KDI}', 'jurnal', false, null),
  ('ll', 'Loonars Living', 'proyek_pembangunan', null, null, null, '{LL}', 'jurnal', false,
   'Pengembangan & penjualan unit Loonars Living. Pembangunan Loonars Coffee dipisah ke LC sejak 0038.'),
  ('lc', 'Loonars Coffee', 'proyek_pembangunan', 'Yogyakarta', null, null, '{LC}', 'jurnal', false,
   'Kode proyek sendiri sejak 2026-10-10 (sebelumnya tercampur di LL).');
