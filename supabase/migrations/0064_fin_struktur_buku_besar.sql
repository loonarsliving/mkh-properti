-- ============================================================================
-- 0064 — Struktur buku besar institusional (Tahap 2a)
-- ============================================================================
--
-- Keputusan owner 2026-11-03 (docs/ai-cfo/INSTITUTIONAL-REPORTING-AUDIT-DAN-RENCANA.md §8):
--   D-2  satu buku besar (`jurnal` yang sudah ada); dimensi lewat TABEL PEMETAAN
--        — tabel `jurnal` TIDAK diubah (tidak ada kolom baru, tidak ada baris
--        yang di-UPDATE/DELETE oleh migrasi ini).
--   D-3  satu badan hukum: PT Loonars Mahakarya; Loonars 1/2/Coffee = properti.
--   D-1  jurnal proyek LL = pengembangan & penjualan villa Loonars 1.
--
-- Isi (semuanya ADITIF):
--   1. fin_entitas          — badan hukum pelapor
--   2. fin_properti         — properti / lini usaha (L1, L2, LC, HOLDING, ARSIP)
--   3. fin_peta_proyek      — kode proyek jurnal → properti
--   4. fin_jurnal_dimensi   — pengecualian per nomor jurnal (append-only; baris
--                             terbaru berlaku) + penanda transaksi antarproperti
--                             untuk eliminasi konsolidasi
--   5. fin_periode (+ _log) — tutup buku per bulan; jurnal bertanggal di bulan
--                             yang DITUTUP ditolak (trigger). Saat migrasi
--                             diterapkan TIDAK ADA bulan yang ditutup → tidak
--                             ada perubahan perilaku sampai CFO menutup bulan.
--   6. fin_laporan_beku     — laporan final per periode, isi + hash sha256,
--                             append-only (reproducibility)
--   7. fin_peran            — peran baca laporan (viewer_laporan, auditor);
--                             CFO (cfo_users) tetap pemilik akses penuh
--   8. RPC                  — fin_ambil_struktur, fin_periode_tutup/buka,
--                             fin_peta_ubah, fin_dimensi_catat,
--                             fin_laporan_bekukan, fin_peran_set
--   Audit: semua perubahan dicatat ke cfo_audit_log (append-only, 0057).
--
-- Dampak ke sinkronisasi MK Connect / sync_inbound: hanya bila CFO menutup
-- sebuah bulan; posting MK Connect bertanggal di bulan tertutup akan GAGAL
-- (tercatat failed di sync_log) sampai bulan dibuka kembali (wajib alasan).
--
-- Rollback penuh (butuh persetujuan owner; tidak ada data jurnal yang terdampak):
--   drop trigger trg_jurnal_periode_ditutup on public.jurnal;
--   drop function public._fin_tolak_periode_ditutup(), public.fin_* (8 RPC),
--     public.fin_boleh_baca();
--   drop table public.fin_laporan_beku, public.fin_periode_log, public.fin_periode,
--     public.fin_jurnal_dimensi, public.fin_peta_proyek, public.fin_peran,
--     public.fin_properti, public.fin_entitas;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Entitas & properti
-- ----------------------------------------------------------------------------
create table if not exists public.fin_entitas (
  kode text primary key check (kode ~ '^[A-Z0-9-]{2,12}$'),
  nama text not null,
  mata_uang text not null default 'IDR' check (mata_uang = 'IDR'),
  tahun_buku_resmi_pertama int not null,
  standar text not null default 'SAK EMKM',
  catatan text,
  dibuat_pada timestamptz not null default now()
);

create table if not exists public.fin_properti (
  kode text primary key check (kode ~ '^[A-Z0-9_]{2,12}$'),
  nama text not null,
  entitas text not null references public.fin_entitas (kode),
  jenis text not null check (jenis in ('hospitality', 'pengembang', 'proyek_pendukung', 'holding', 'arsip')),
  status text not null check (status in ('konstruksi', 'pre_opening', 'operasi', 'tutup', 'arsip')),
  induk text references public.fin_properti (kode),
  tgl_buka date,
  dilaporkan boolean not null default true,
  urutan int not null default 100,
  catatan text,
  dibuat_pada timestamptz not null default now()
);

insert into public.fin_entitas (kode, nama, tahun_buku_resmi_pertama, catatan)
values ('PT-LM', 'PT Loonars Mahakarya', 2027,
        'Nama baru PT Maha Karya Haluoleo. Satu-satunya badan hukum pelapor (keputusan owner D-3, 2026-11-03).')
on conflict (kode) do nothing;

insert into public.fin_properti (kode, nama, entitas, jenis, status, induk, tgl_buka, dilaporkan, urutan, catatan) values
  ('L1', 'Loonars 1 — Loonars Private Living (villa, Yogyakarta)', 'PT-LM', 'hospitality', 'operasi', null, date '2026-09-23', true, 10,
   'Tanggal buka dari ir_unit_bisnis (catatan villa menyebut 20 Sep 2026 — perlu konfirmasi). Termasuk pengembangan & penjualan unit villa (jurnal LL, D-1).'),
  ('L2', 'Loonars 2 — Loonars Living (pengembang)', 'PT-LM', 'pengembang', 'konstruksi', null, null, true, 20,
   'Modul 4 rekening (loonars2_*); pendapatan unit diakui 31 Desember saat serah terima.'),
  ('LC', 'Loonars Coffee', 'PT-LM', 'proyek_pendukung', 'konstruksi', 'L2', null, true, 30,
   'Dibiayai keuangan Loonars 2 (keputusan owner 2026-11-01).'),
  ('HOLDING', 'Tingkat holding (biaya bersama)', 'PT-LM', 'holding', 'operasi', null, null, true, 40,
   'Gaji tim bersama & biaya kantor pusat.'),
  ('ARSIP', 'Proyek lama PT (dikunci sejak 1 Nov 2026)', 'PT-LM', 'arsip', 'arsip', null, null, false, 90,
   'AFP, IH, GCI, GCR, KDI — hanya-baca (migrasi 0060); tidak masuk laporan Loonars.')
on conflict (kode) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Pemetaan proyek jurnal → properti
-- ----------------------------------------------------------------------------
create table if not exists public.fin_peta_proyek (
  proyek text primary key check (proyek = upper(trim(proyek)) and length(proyek) between 1 and 10),
  properti text not null references public.fin_properti (kode),
  alasan text not null,
  diubah_oleh text not null default 'migrasi 0064',
  diubah_pada timestamptz not null default now()
);

insert into public.fin_peta_proyek (proyek, properti, alasan) values
  ('LL', 'L1', 'Keputusan owner D-1 (2026-11-03): jurnal LL = pembangunan & penjualan villa Loonars 1; diverifikasi tidak memuat belanja Loonars 2.'),
  ('LC', 'LC', 'Kode proyek Loonars Coffee sejak migrasi 0038.'),
  ('HO', 'HOLDING', 'Overhead / sinkronisasi HR MK Connect.'),
  ('AFP', 'ARSIP', 'Dikunci 0060.'),
  ('IH', 'ARSIP', 'Dikunci 0060.'),
  ('GCI', 'ARSIP', 'Dikunci 0060.'),
  ('GCR', 'ARSIP', 'Dikunci 0060.'),
  ('KDI', 'ARSIP', 'Dikunci 0060.')
on conflict (proyek) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Dimensi per nomor jurnal (pengecualian & antarproperti) — append-only
-- ----------------------------------------------------------------------------
create table if not exists public.fin_jurnal_dimensi (
  id bigserial primary key,
  proyek text not null,
  no text not null,
  properti text not null references public.fin_properti (kode),
  -- properti lawan bila transaksi ini antarproperti (dieliminasi di konsolidasi)
  antar_properti text references public.fin_properti (kode),
  alasan text not null check (length(trim(alasan)) >= 10),
  dicatat_oleh text not null,
  dibuat_pada timestamptz not null default now(),
  check (antar_properti is null or antar_properti <> properti)
);
create index if not exists fin_jurnal_dimensi_no_idx on public.fin_jurnal_dimensi (proyek, no, id desc);

-- ----------------------------------------------------------------------------
-- 4. Tutup buku per bulan
-- ----------------------------------------------------------------------------
create table if not exists public.fin_periode (
  entitas text not null references public.fin_entitas (kode),
  periode date not null check (periode = date_trunc('month', periode)::date),
  status text not null check (status in ('ditutup', 'dibuka_kembali')),
  diubah_oleh text not null,
  diubah_pada timestamptz not null default now(),
  catatan text,
  primary key (entitas, periode)
);

create table if not exists public.fin_periode_log (
  id bigserial primary key,
  entitas text not null,
  periode date not null,
  aksi text not null check (aksi in ('tutup', 'buka')),
  oleh text not null,
  alasan text,
  ringkas jsonb not null default '{}'::jsonb,
  waktu timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 5. Laporan beku (reproducibility) — append-only
-- ----------------------------------------------------------------------------
create table if not exists public.fin_laporan_beku (
  id bigserial primary key,
  entitas text not null references public.fin_entitas (kode),
  jenis text not null check (jenis in ('laba_rugi', 'neraca', 'arus_kas', 'unit_ekonomi', 'konsolidasi', 'holding', 'ebitda', 'proyeksi', 'lainnya')),
  periode_kode text not null check (periode_kode ~ '^[0-9]{4}(-[0-9]{2}|-Q[1-4])?$'),
  data jsonb not null,
  hash text not null,
  versi_mesin text not null,
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now()
);
create index if not exists fin_laporan_beku_idx on public.fin_laporan_beku (entitas, jenis, periode_kode, id desc);

-- ----------------------------------------------------------------------------
-- 6. Peran baca laporan
-- ----------------------------------------------------------------------------
create table if not exists public.fin_peran (
  email text primary key check (email = lower(trim(email)) and email like '%@%'),
  peran text not null check (peran in ('viewer_laporan', 'auditor')),
  diberikan_oleh text not null,
  dibuat_pada timestamptz not null default now()
);

create or replace function public.fin_boleh_baca()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mkh_is_cfo()
      or exists (select 1 from public.fin_peran p where p.email = public.mkh_email_login());
$$;
revoke execute on function public.fin_boleh_baca() from public;
grant execute on function public.fin_boleh_baca() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS & append-only
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fin_entitas', 'fin_properti', 'fin_peta_proyek', 'fin_jurnal_dimensi', 'fin_periode', 'fin_periode_log', 'fin_laporan_beku', 'fin_peran'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'fin_baca') then
      execute format('create policy fin_baca on public.%I for select to authenticated using ((select public.fin_boleh_baca()))', t);
    end if;
  end loop;
  foreach t in array array['fin_jurnal_dimensi', 'fin_periode_log', 'fin_laporan_beku'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_append_only') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public._cfo_tolak_ubah_audit()', t || '_append_only', t);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Kunci periode pada jurnal
-- ----------------------------------------------------------------------------
create or replace function public._fin_tolak_periode_ditutup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tgl date;
  v_periode date;
begin
  foreach v_tgl in array array[
    case when tg_op in ('INSERT', 'UPDATE') then new.tgl end,
    case when tg_op in ('UPDATE', 'DELETE') then old.tgl end
  ] loop
    continue when v_tgl is null;
    v_periode := date_trunc('month', v_tgl)::date;
    if exists (select 1 from public.fin_periode where periode = v_periode and status = 'ditutup') then
      raise exception 'Buku bulan % sudah ditutup. Transaksi bertanggal di bulan itu tidak bisa ditambah/diubah/dihapus.',
        to_char(v_periode, 'MM-YYYY')
        using errcode = '42501',
              hint = 'Catat koreksi di bulan berjalan, atau minta CFO membuka kembali bulan itu (wajib alasan).';
    end if;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public._fin_tolak_periode_ditutup() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.jurnal') is not null
     and not exists (select 1 from pg_trigger where tgname = 'trg_jurnal_periode_ditutup') then
    create trigger trg_jurnal_periode_ditutup
      before insert or update or delete on public.jurnal
      for each row execute function public._fin_tolak_periode_ditutup();
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. RPC
-- ----------------------------------------------------------------------------
create or replace function public._fin_wajib_cfo()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.mkh_is_cfo(), false) then
    raise exception 'Hanya CFO/owner' using errcode = '42501';
  end if;
  return 'cfo:' || coalesce(public.mkh_email_login(), '?');
end;
$$;
revoke execute on function public._fin_wajib_cfo() from public, anon, authenticated;

-- Struktur untuk aplikasi (hanya baca).
create or replace function public.fin_ambil_struktur()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.fin_boleh_baca(), false) then
    raise exception 'Tidak berwenang' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'versi', 1,
    'entitas', coalesce((select jsonb_agg(to_jsonb(e) order by e.kode) from public.fin_entitas e), '[]'::jsonb),
    'properti', coalesce((select jsonb_agg(to_jsonb(p) order by p.urutan) from public.fin_properti p), '[]'::jsonb),
    'peta_proyek', coalesce((select jsonb_agg(to_jsonb(m) order by m.proyek) from public.fin_peta_proyek m), '[]'::jsonb),
    'dimensi', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.proyek, d.no)
      from (select distinct on (proyek, no) * from public.fin_jurnal_dimensi order by proyek, no, id desc) d
    ), '[]'::jsonb),
    'periode', coalesce((select jsonb_agg(to_jsonb(f) order by f.periode) from public.fin_periode f), '[]'::jsonb),
    'laporan_beku', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'jenis', b.jenis, 'periode_kode', b.periode_kode, 'hash', b.hash,
                                          'versi_mesin', b.versi_mesin, 'dibuat_oleh', b.dibuat_oleh, 'dibuat_pada', b.dibuat_pada) order by b.id desc)
      from public.fin_laporan_beku b
    ), '[]'::jsonb)
  );
end;
$$;

-- Tutup buku: hanya bila setiap nomor jurnal di bulan itu seimbang (debit = kredit).
create or replace function public.fin_periode_tutup(p_periode date, p_catatan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_bulan date := date_trunc('month', p_periode)::date;
  v_timpang jsonb;
  v_ringkas jsonb;
begin
  if v_bulan >= date_trunc('month', (now() at time zone 'Asia/Jakarta'))::date then
    raise exception 'Bulan berjalan / masa depan tidak bisa ditutup' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('no', no, 'proyek', proyek, 'selisih', selisih))
    into v_timpang
    from (
      select no, proyek, sum(coalesce(d, 0)) - sum(coalesce(k, 0)) as selisih
      from public.jurnal
      where tgl >= v_bulan and tgl < (v_bulan + interval '1 month')
      group by no, proyek
      having abs(sum(coalesce(d, 0)) - sum(coalesce(k, 0))) > 0.5
      limit 20
    ) t;
  if v_timpang is not null then
    raise exception 'Tidak bisa tutup buku %: ada nomor jurnal tidak seimbang: %', to_char(v_bulan, 'MM-YYYY'), v_timpang::text
      using errcode = '22023';
  end if;
  select jsonb_build_object('baris', count(*), 'debit', coalesce(sum(d), 0), 'kredit', coalesce(sum(k), 0))
    into v_ringkas
    from public.jurnal where tgl >= v_bulan and tgl < (v_bulan + interval '1 month');

  insert into public.fin_periode (entitas, periode, status, diubah_oleh, catatan)
  values ('PT-LM', v_bulan, 'ditutup', v_aktor, p_catatan)
  on conflict (entitas, periode) do update set status = 'ditutup', diubah_oleh = excluded.diubah_oleh, diubah_pada = now(), catatan = excluded.catatan;
  insert into public.fin_periode_log (entitas, periode, aksi, oleh, alasan, ringkas)
  values ('PT-LM', v_bulan, 'tutup', v_aktor, p_catatan, v_ringkas);
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_periode_tutup', jsonb_build_object('periode', v_bulan) || v_ringkas);
  return jsonb_build_object('ok', true, 'periode', v_bulan) || v_ringkas;
end;
$$;

create or replace function public.fin_periode_buka(p_periode date, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_bulan date := date_trunc('month', p_periode)::date;
begin
  if length(trim(coalesce(p_alasan, ''))) < 10 then
    raise exception 'Alasan membuka kembali wajib diisi (min. 10 karakter)' using errcode = '22023';
  end if;
  update public.fin_periode set status = 'dibuka_kembali', diubah_oleh = v_aktor, diubah_pada = now(), catatan = p_alasan
   where entitas = 'PT-LM' and periode = v_bulan and status = 'ditutup';
  if not found then
    raise exception 'Bulan % tidak sedang ditutup', to_char(v_bulan, 'MM-YYYY') using errcode = '22023';
  end if;
  insert into public.fin_periode_log (entitas, periode, aksi, oleh, alasan) values ('PT-LM', v_bulan, 'buka', v_aktor, p_alasan);
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_periode_buka', jsonb_build_object('periode', v_bulan, 'alasan', p_alasan));
  return jsonb_build_object('ok', true, 'periode', v_bulan);
end;
$$;

create or replace function public.fin_peta_ubah(p_proyek text, p_properti text, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_proyek text := upper(trim(p_proyek));
  v_lama text;
begin
  if length(trim(coalesce(p_alasan, ''))) < 10 then
    raise exception 'Alasan wajib diisi (min. 10 karakter)' using errcode = '22023';
  end if;
  select properti into v_lama from public.fin_peta_proyek where proyek = v_proyek;
  insert into public.fin_peta_proyek (proyek, properti, alasan, diubah_oleh)
  values (v_proyek, p_properti, p_alasan, v_aktor)
  on conflict (proyek) do update set properti = excluded.properti, alasan = excluded.alasan, diubah_oleh = excluded.diubah_oleh, diubah_pada = now();
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_peta_ubah', jsonb_build_object('proyek', v_proyek, 'dari', v_lama, 'ke', p_properti, 'alasan', p_alasan));
  return jsonb_build_object('ok', true, 'proyek', v_proyek, 'dari', v_lama, 'ke', p_properti);
end;
$$;

create or replace function public.fin_dimensi_catat(p_proyek text, p_no text, p_properti text, p_antar_properti text, p_alasan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_id bigint;
begin
  if not exists (select 1 from public.jurnal where proyek = upper(trim(p_proyek)) and no = p_no) then
    raise exception 'Nomor jurnal % proyek % tidak ditemukan', p_no, p_proyek using errcode = '22023';
  end if;
  insert into public.fin_jurnal_dimensi (proyek, no, properti, antar_properti, alasan, dicatat_oleh)
  values (upper(trim(p_proyek)), p_no, p_properti, p_antar_properti, p_alasan, v_aktor)
  returning id into v_id;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_dimensi_catat', jsonb_build_object('id', v_id, 'proyek', p_proyek, 'no', p_no, 'properti', p_properti, 'antar', p_antar_properti));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Bekukan laporan final; hash dihitung di database dari isi yang disimpan.
create or replace function public.fin_laporan_bekukan(p_jenis text, p_periode_kode text, p_data jsonb, p_versi_mesin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_hash text := encode(extensions.digest(convert_to(p_data::text, 'UTF8'), 'sha256'), 'hex');
  v_id bigint;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Isi laporan harus objek JSON' using errcode = '22023';
  end if;
  insert into public.fin_laporan_beku (entitas, jenis, periode_kode, data, hash, versi_mesin, dibuat_oleh)
  values ('PT-LM', p_jenis, p_periode_kode, p_data, v_hash, p_versi_mesin, v_aktor)
  returning id into v_id;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_laporan_bekukan', jsonb_build_object('id', v_id, 'jenis', p_jenis, 'periode', p_periode_kode, 'hash', v_hash));
  return jsonb_build_object('ok', true, 'id', v_id, 'hash', v_hash);
end;
$$;

-- Beri / cabut peran baca laporan (p_peran null = cabut).
create or replace function public.fin_peran_set(p_email text, p_peran text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := public._fin_wajib_cfo();
  v_email text := lower(trim(p_email));
begin
  if p_peran is null then
    delete from public.fin_peran where email = v_email;
  else
    insert into public.fin_peran (email, peran, diberikan_oleh) values (v_email, p_peran, v_aktor)
    on conflict (email) do update set peran = excluded.peran, diberikan_oleh = excluded.diberikan_oleh, dibuat_pada = now();
  end if;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'fin_peran_set', jsonb_build_object('email', v_email, 'peran', p_peran));
  return jsonb_build_object('ok', true, 'email', v_email, 'peran', p_peran);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'fin_ambil_struktur()', 'fin_periode_tutup(date, text)', 'fin_periode_buka(date, text)',
    'fin_peta_ubah(text, text, text)', 'fin_dimensi_catat(text, text, text, text, text)',
    'fin_laporan_bekukan(text, text, jsonb, text)', 'fin_peran_set(text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;

  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values ('sistem: migrasi 0064', 'sistem', 'fin_struktur',
          jsonb_build_object('entitas', 'PT-LM', 'properti', jsonb_build_array('L1', 'L2', 'LC', 'HOLDING', 'ARSIP'),
                             'keputusan', 'D-1, D-2, D-3 (2026-11-03)'));
end;
$$;
