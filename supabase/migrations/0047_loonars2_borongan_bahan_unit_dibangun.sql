-- ============================================================================
-- 0047 — Loonars 2: borongan tukang, pesanan bahan kolektif, unit sedang dibangun
-- ============================================================================
-- Perubahan cara kerja pengajuan pelaksana (Vando):
--
--  1. Upah tukang = BORONGAN per paket unit, bukan per bobot/per unit:
--       total = jumlah_unit × (nilai_per_unit − retensi_per_unit)
--       cicilan mingguan = total ÷ jumlah_minggu (selisih pembulatan di minggu terakhir)
--     Contoh: 6 unit × (35 jt − 9 jt) = 156 jt ÷ 12 minggu = 13 jt/minggu.
--     Pelaksana cukup menulis "tukang minggu ini"; nominal & minggu ke-n dihitung
--     sistem. Retensi per unit ditahan sampai unit ditandai selesai/serah terima,
--     lalu diajukan dan disetujui owner seperti pengajuan biasa.
--  2. Bahan dipesan KOLEKTIF (tanpa menyebut unit). Sistem membagi ke unit yang
--     sedang dibangun (bagi rata; item bisa ditujukan ke unit tertentu dari
--     catatan pelaksana/AI), mencatat pembagian per item di loonars2_bahan_unit
--     (RAB pemakaian bahan per unit) dan membuat baris biaya per unit seperti
--     biasa (budget unit tetap akurat). Pembagian bisa dikoreksi.
--  3. "Unit sedang dibangun" = acuan pembagian. Pelaksana ditanya tiap kali
--     mengirim pengajuan yang unitnya tidak disebut; jawabannya disimpan.
--     Syarat DP dicabut untuk unit yang ditandai sedang dibangun.
--
-- Semua tabel baru berawalan loonars2_, RLS aktif, perubahan diaudit. Tidak ada
-- tabel lain yang diubah selain kolom tambahan pada tabel loonars2_ sendiri.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Skema
-- ----------------------------------------------------------------------------
alter table public.loonars2_units add column sedang_dibangun boolean not null default false;

create table public.loonars2_borongan (
  id smallint generated always as identity primary key,
  nama text not null check (length(trim(nama)) >= 2),
  nilai_per_unit numeric not null check (nilai_per_unit > 0 and nilai_per_unit = round(nilai_per_unit)),
  retensi_per_unit numeric not null default 0 check (retensi_per_unit >= 0 and retensi_per_unit = round(retensi_per_unit)),
  jumlah_minggu smallint not null check (jumlah_minggu between 1 and 104),
  tanggal_mulai date,
  status text not null default 'aktif' check (status in ('aktif', 'selesai', 'batal')),
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now(),
  diubah_pada timestamptz not null default now(),
  check (retensi_per_unit < nilai_per_unit)
);

create table public.loonars2_borongan_unit (
  borongan_id smallint not null references public.loonars2_borongan(id) on delete restrict,
  unit_id smallint not null unique references public.loonars2_units(id) on delete restrict,
  primary key (borongan_id, unit_id)
);

create table public.loonars2_pesanan_bahan (
  id integer generated always as identity primary key,
  kelompok text not null,
  jenis text not null check (jenis in ('tunai', 'utang')),
  toko text,
  deskripsi text not null,
  items jsonb,
  nominal numeric not null check (nominal > 0),
  tanggal date not null,
  nota_url text,
  diajukan_oleh text not null,
  dibuat_pada timestamptz not null default now()
);

-- Pembagian bahan per unit (RAB pemakaian). Baris lama tidak dihapus saat
-- dikoreksi: aktif=false, baris baru ditambahkan.
create table public.loonars2_bahan_unit (
  id integer generated always as identity primary key,
  pesanan_id integer not null references public.loonars2_pesanan_bahan(id) on delete restrict,
  unit_id smallint not null references public.loonars2_units(id) on delete restrict,
  item text not null,
  qty numeric,
  satuan text,
  nominal numeric not null check (nominal >= 0),
  aktif boolean not null default true,
  dibuat_pada timestamptz not null default now()
);
create index loonars2_bahan_unit_idx on public.loonars2_bahan_unit (unit_id) where aktif;
create index loonars2_bahan_unit_pesanan_idx on public.loonars2_bahan_unit (pesanan_id);

alter table public.loonars2_material_requests add column borongan_id smallint references public.loonars2_borongan(id) on delete restrict;
alter table public.loonars2_material_requests add column minggu_ke smallint;
alter table public.loonars2_material_requests add column retensi boolean not null default false;
alter table public.loonars2_material_requests add column pesanan_id integer references public.loonars2_pesanan_bahan(id) on delete restrict;
alter table public.loonars2_utang_toko add column pesanan_id integer references public.loonars2_pesanan_bahan(id) on delete restrict;

-- Satu minggu per unit hanya boleh diajukan sekali (selama belum ditolak); retensi satu kali per unit.
create unique index loonars2_mr_borongan_minggu_uq on public.loonars2_material_requests (borongan_id, minggu_ke, unit_id)
  where borongan_id is not null and not retensi and status <> 'ditolak';
create unique index loonars2_mr_retensi_uq on public.loonars2_material_requests (borongan_id, unit_id)
  where retensi and status <> 'ditolak';

do $$
declare
  t text;
begin
  foreach t in array array['loonars2_borongan', 'loonars2_borongan_unit', 'loonars2_pesanan_bahan', 'loonars2_bahan_unit']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy cfo_baca on public.%I for select to authenticated using ((select public.mkh_is_cfo()))', t);
  end loop;
  execute 'create trigger loonars2_borongan_audit after insert or update or delete on public.loonars2_borongan for each row execute function public.loonars2_audit(''id'')';
  execute 'create trigger loonars2_borongan_unit_audit after insert or update or delete on public.loonars2_borongan_unit for each row execute function public.loonars2_audit(''unit_id'')';
  execute 'create trigger loonars2_pesanan_bahan_audit after insert or update or delete on public.loonars2_pesanan_bahan for each row execute function public.loonars2_audit(''id'')';
  execute 'create trigger loonars2_bahan_unit_audit after insert or update or delete on public.loonars2_bahan_unit for each row execute function public.loonars2_audit(''id'')';
  execute 'create trigger loonars2_borongan_diubah before update on public.loonars2_borongan for each row execute function public.loonars2_sentuh_diubah_pada()';
end $$;

-- ----------------------------------------------------------------------------
-- 2. Views: ringkasan borongan, RAB bahan per unit
-- ----------------------------------------------------------------------------
create view public.loonars2_v_borongan with (security_invoker = true) as
select
  b.id, b.nama, b.nilai_per_unit, b.retensi_per_unit, b.jumlah_minggu, b.tanggal_mulai, b.status,
  n.jumlah_unit,
  n.jumlah_unit * (b.nilai_per_unit - b.retensi_per_unit) as total_mingguan,
  n.jumlah_unit * b.retensi_per_unit as total_retensi,
  coalesce(m.minggu_diajukan, 0) as minggu_diajukan,
  coalesce(m.minggu_dibayar, 0) as minggu_dibayar,
  coalesce(m.nominal_diajukan, 0) as nominal_diajukan,
  coalesce(m.nominal_dibayar, 0) as nominal_dibayar,
  coalesce(m.retensi_diajukan, 0) as retensi_diajukan,
  coalesce(m.retensi_dibayar, 0) as retensi_dibayar
from public.loonars2_borongan b
left join lateral (select count(*) as jumlah_unit from public.loonars2_borongan_unit where borongan_id = b.id) n on true
left join lateral (
  select
    count(distinct minggu_ke) filter (where not retensi and status <> 'ditolak') as minggu_diajukan,
    (select count(*) from (select q.minggu_ke from public.loonars2_material_requests q
        where q.borongan_id = b.id and not q.retensi and q.status <> 'ditolak'
        group by q.minggu_ke having bool_and(q.status = 'dibayar')) z) as minggu_dibayar,
    sum(nominal) filter (where not retensi and status <> 'ditolak') as nominal_diajukan,
    sum(nominal) filter (where not retensi and status = 'dibayar') as nominal_dibayar,
    sum(nominal) filter (where retensi and status <> 'ditolak') as retensi_diajukan,
    sum(nominal) filter (where retensi and status = 'dibayar') as retensi_dibayar
  from public.loonars2_material_requests where borongan_id = b.id
) m on true;

create view public.loonars2_v_rab_bahan with (security_invoker = true) as
select unit_id, lower(trim(item)) as item, max(satuan) as satuan, sum(qty) as qty, sum(nominal) as nominal
  from public.loonars2_bahan_unit where aktif
 group by unit_id, lower(trim(item));

revoke all on public.loonars2_v_borongan, public.loonars2_v_rab_bahan from anon;
grant select on public.loonars2_v_borongan, public.loonars2_v_rab_bahan to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Unit sedang dibangun
-- ----------------------------------------------------------------------------
-- Syarat DP dicabut untuk unit yang ditandai sedang dibangun.
create or replace function public._loonars2_cek_unit_boleh(p_unit_id smallint)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u record;
begin
  select * into u from public.loonars2_v_unit where id = p_unit_id;
  if not found then return 'Unit tidak ditemukan.'; end if;
  if u.status not in ('dp', 'lunas') and not u.is_unit_contoh
     and not exists (select 1 from public.loonars2_units where id = p_unit_id and sedang_dibangun) then
    return public._loonars2_label_unit(p_unit_id) || ' belum terjual dan tidak ditandai sedang dibangun. Sebutkan unit yang sedang dibangun, mis. "L2 unit 1-6".';
  end if;
  return null;
end;
$$;

create or replace function public._loonars2_unit_dibangun()
returns smallint[]
language sql
stable
security definer
set search_path = public
as $$ select coalesce(array_agg(id order by nomor), '{}'::smallint[]) from public.loonars2_units where sedang_dibangun $$;

create or replace function public._loonars2_teks_unit_dibangun()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(string_agg(nomor || ' ' || kode, ', ' order by nomor), '(belum ada)') from public.loonars2_units where sedang_dibangun
$$;

-- Daftar yang disebut pelaksana menjadi acuan: unit di daftar = sedang dibangun,
-- selain itu bukan. status_bangun hanya dinaikkan belum -> proses (tidak pernah
-- diturunkan, supaya tidak menghapus penanda selesai/serah terima).
create or replace function public._loonars2_atur_unit_dibangun(p_ids smallint[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.loonars2_units
     set sedang_dibangun = (id = any (p_ids)),
         status_bangun = case when id = any (p_ids) and status_bangun = 'belum' then 'proses' else status_bangun end
   where sedang_dibangun is distinct from (id = any (p_ids))
      or (id = any (p_ids) and status_bangun = 'belum');
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Borongan tukang
-- ----------------------------------------------------------------------------
-- Cicilan minggu ke-n; selisih pembulatan masuk minggu terakhir sehingga
-- jumlah seluruh minggu = total persis.
create or replace function public._loonars2_nominal_minggu(p_borongan_id smallint, p_minggu integer)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b record;
  v_n integer;
  v_total numeric;
  v_dasar numeric;
begin
  select * into b from public.loonars2_borongan where id = p_borongan_id;
  select count(*) into v_n from public.loonars2_borongan_unit where borongan_id = p_borongan_id;
  v_total := v_n * (b.nilai_per_unit - b.retensi_per_unit);
  v_dasar := floor(v_total / b.jumlah_minggu);
  return case when p_minggu >= b.jumlah_minggu then v_total - v_dasar * (b.jumlah_minggu - 1) else v_dasar end;
end;
$$;

-- Pilih borongan aktif: satu-satunya, atau yang namanya disebut di teks.
create or replace function public._loonars2_cari_borongan(p_teks text)
returns smallint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids smallint[];
  v_id smallint;
begin
  select array_agg(id order by id) into v_ids from public.loonars2_borongan where status = 'aktif';
  if v_ids is null then return null; end if;
  select id into v_id from public.loonars2_borongan
   where status = 'aktif' and position(lower(trim(nama)) in lower(coalesce(p_teks, ''))) > 0 order by id limit 1;
  if v_id is not null then return v_id; end if;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  return null;
end;
$$;

create or replace function public._loonars2_buat_borongan(
  p_nama text, p_unit_ids smallint[], p_nilai numeric, p_retensi numeric, p_minggu integer, p_tanggal date, p_aktor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id smallint;
  v_n integer := coalesce(cardinality(p_unit_ids), 0);
  v_i integer;
  v_lain text;
begin
  perform public._loonars2_set_aktor(p_aktor, 'wa');
  if length(trim(coalesce(p_nama, ''))) < 2 then
    raise exception 'Nama mandor/borongan belum ada, mis. "borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu".' using errcode = '22023';
  end if;
  if v_n = 0 or array_position(p_unit_ids, null) is not null then
    raise exception 'Unit borongan belum disebut/dikenali, mis. "unit 1-6".' using errcode = '22023';
  end if;
  if p_nilai is null or p_nilai <= 0 or p_nilai <> round(p_nilai) then
    raise exception 'Nilai borongan per unit belum terbaca, mis. "35 juta".' using errcode = '22023';
  end if;
  if coalesce(p_retensi, 0) < 0 or coalesce(p_retensi, 0) >= p_nilai or coalesce(p_retensi, 0) <> round(coalesce(p_retensi, 0)) then
    raise exception 'Retensi harus lebih kecil dari nilai borongan per unit.' using errcode = '22023';
  end if;
  if p_minggu is null or p_minggu < 1 or p_minggu > 104 then
    raise exception 'Jumlah minggu belum terbaca, mis. "12 minggu".' using errcode = '22023';
  end if;
  select string_agg(public._loonars2_label_unit(bu.unit_id), '; ') into v_lain
    from public.loonars2_borongan_unit bu join public.loonars2_borongan b on b.id = bu.borongan_id
   where b.status = 'aktif' and bu.unit_id = any (p_unit_ids);
  if v_lain is not null then
    raise exception 'Sudah masuk borongan aktif lain: %', v_lain using errcode = '22023';
  end if;
  insert into public.loonars2_borongan (nama, nilai_per_unit, retensi_per_unit, jumlah_minggu, tanggal_mulai, dibuat_oleh)
  values (trim(p_nama), p_nilai, coalesce(p_retensi, 0), p_minggu, coalesce(p_tanggal, public._loonars2_hari_ini()), p_aktor)
  returning id into v_id;
  for v_i in 1..v_n loop
    insert into public.loonars2_borongan_unit (borongan_id, unit_id) values (v_id, p_unit_ids[v_i]);
  end loop;
  perform public._loonars2_atur_unit_dibangun(array(select unnest(public._loonars2_unit_dibangun()) union select unnest(p_unit_ids)));
  return jsonb_build_object('status', 'ok', 'id', v_id, 'balasan',
    '✅ Borongan ' || trim(p_nama) || ' dicatat: ' || v_n || ' unit × ' || public.loonars2_rp(p_nilai) || ' (retensi ' || public.loonars2_rp(coalesce(p_retensi, 0)) || '/unit).'
    || E'\nDibayar mingguan ' || public.loonars2_rp(v_n * (p_nilai - coalesce(p_retensi, 0))) || ' ÷ ' || p_minggu || ' minggu = ' || public.loonars2_rp(public._loonars2_nominal_minggu(v_id, 1)) || '/minggu.'
    || E'\nPelaksana mengajukan tiap minggu dengan "L2 tukang minggu ini". Unit borongan otomatis ditandai sedang dibangun.');
end;
$$;

create or replace function public._loonars2_teks_borongan()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '';
begin
  for r in select * from public.loonars2_v_borongan where status <> 'batal' order by id loop
    v_teks := v_teks || E'\n\n👷 ' || r.nama || ' (' || r.status || ') — ' || r.jumlah_unit || ' unit: '
      || (select string_agg(u.nomor::text, ',' order by u.nomor) from public.loonars2_borongan_unit bu join public.loonars2_units u on u.id = bu.unit_id where bu.borongan_id = r.id)
      || E'\nNilai ' || public.loonars2_rp(r.nilai_per_unit) || '/unit, retensi ' || public.loonars2_rp(r.retensi_per_unit) || '/unit'
      || E'\nMingguan ' || public.loonars2_rp(r.total_mingguan) || ' ÷ ' || r.jumlah_minggu || ' minggu = ' || public.loonars2_rp(public._loonars2_nominal_minggu(r.id, 1)) || '/minggu'
      || E'\nDiajukan ' || r.minggu_diajukan || '/' || r.jumlah_minggu || ' minggu (' || public.loonars2_rp(r.nominal_diajukan) || '), dibayar ' || r.minggu_dibayar || ' minggu (' || public.loonars2_rp(r.nominal_dibayar) || ')'
      || E'\nRetensi ditahan ' || public.loonars2_rp(r.total_retensi - r.retensi_diajukan) || ', diajukan/dibayar ' || public.loonars2_rp(r.retensi_diajukan) || ' / ' || public.loonars2_rp(r.retensi_dibayar);
  end loop;
  return case when v_teks = '' then 'Belum ada borongan. Owner: "borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu".' else '👷 BORONGAN TUKANG' || v_teks end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Pesanan bahan kolektif -> dibagi ke unit -> RAB pemakaian per unit
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_fmt_qty(p numeric)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p is null then ''
              when position('.' in round(p, 2)::text) > 0 then regexp_replace(round(p, 2)::text, '\.?0+$', '')
              else round(p, 2)::text end
$$;

-- Teks pembagian satu pesanan per unit (untuk owner & pelaksana).
create or replace function public._loonars2_teks_alokasi_pesanan(p_pesanan_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p record;
  r record;
  v_teks text;
begin
  select * into p from public.loonars2_pesanan_bahan where id = p_pesanan_id;
  if not found then return null; end if;
  v_teks := '📦 Pembagian bahan (' || p.kelompok || '): ' || left(p.deskripsi, 120) || ' — ' || public.loonars2_rp(p.nominal)
            || coalesce(' (' || p.toko || ')', '') || ', ' || case p.jenis when 'utang' then 'utang' else 'tunai' end;
  for r in
    select b.unit_id, sum(b.nominal) as nominal,
           string_agg(b.item || case when b.qty is not null then ' ' || public._loonars2_fmt_qty(b.qty) || coalesce(' ' || b.satuan, '') else '' end, '; ' order by b.id) as rincian
      from public.loonars2_bahan_unit b
     where b.pesanan_id = p_pesanan_id and b.aktif
     group by b.unit_id order by b.unit_id
  loop
    v_teks := v_teks || E'\n• ' || public._loonars2_label_unit(r.unit_id) || ': ' || public.loonars2_rp(r.nominal) || ' — ' || left(r.rincian, 160);
  end loop;
  return v_teks;
end;
$$;

create or replace function public._loonars2_teks_alokasi_kelompok(p_kode text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select string_agg(public._loonars2_teks_alokasi_pesanan(id), E'\n\n' order by id) from public.loonars2_pesanan_bahan where kelompok = p_kode
$$;

-- Pesanan bahan kolektif. Salah input = exception 22023 (pemanggil membatalkan
-- seluruh transaksi), sehingga tidak ada pesanan setengah jadi.
create or replace function public._loonars2_pesan_bahan(
  p_jenis text, p_toko text, p_deskripsi text, p_items jsonb, p_nominal numeric, p_unit_ids smallint[],
  p_nota text, p_tanggal date, p_nama text, p_nomor text, p_sumber text, p_kelompok text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default smallint[];
  v_items jsonb;
  v_n integer;
  v_i integer;
  v_j integer;
  it jsonb;
  v_nama text;
  v_qty numeric;
  v_satuan text;
  v_units smallint[];
  v_uid smallint;
  v_ref text;
  v_alasan text;
  v_nilai numeric[];
  v_given integer := 0;
  v_sum_given numeric := 0;
  v_bagian numeric[];
  v_estimasi boolean := false;
  v_pid integer;
  v_kelompok text;
  v_qdasar numeric;
  v_qpart numeric;
  v_alok jsonb := '[]'::jsonb;
  v_toko_id smallint;
  v_row integer;
  v_desc text;
  v_unit_n integer;
  v_ada boolean;
  u record;
  r record;
  v_total_unit numeric;
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if p_jenis not in ('tunai', 'utang') then
    raise exception 'Jenis pesanan bahan tidak dikenal.' using errcode = '22023';
  end if;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    raise exception 'Nominal bahan belum terbaca. Tulis totalnya, mis. "8,5 juta".' using errcode = '22023';
  end if;
  if p_jenis = 'utang' and length(trim(coalesce(p_toko, ''))) < 2 then
    raise exception 'Nama toko belum ada. Contoh: "L2 utang TB Maju semen 50 sak 6.500.000".' using errcode = '22023';
  end if;
  v_default := case when coalesce(cardinality(p_unit_ids), 0) > 0 then p_unit_ids else public._loonars2_unit_dibangun() end;
  if cardinality(v_default) = 0 or array_position(v_default, null) is not null then
    raise exception 'Belum ada unit yang ditandai sedang dibangun. Kirim daftar unitnya, mis. "L2 unit 1-6".' using errcode = '22023';
  end if;

  v_items := case when jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 40 then p_items
                  else jsonb_build_array(jsonb_build_object('nama', coalesce(nullif(trim(p_deskripsi), ''), 'bahan'))) end;
  v_n := jsonb_array_length(v_items);

  -- Nominal per item: pakai nilai item bila lengkap & cocok dengan total; selain itu
  -- sisa dibagi rata (ditandai estimasi karena nota rinci belum ada).
  v_nilai := array_fill(0::numeric, array[v_n]);
  for v_i in 1..v_n loop
    v_nilai[v_i] := coalesce(nullif(v_items -> (v_i - 1) ->> 'nilai', '')::numeric, 0);
    if v_nilai[v_i] > 0 then
      v_given := v_given + 1;
      v_sum_given := v_sum_given + v_nilai[v_i];
    end if;
  end loop;
  if v_given = v_n and v_sum_given = p_nominal then
    null;
  elsif v_given > 0 and v_given < v_n and v_sum_given < p_nominal then
    v_bagian := public._loonars2_bagi_rata(p_nominal - v_sum_given, v_n - v_given);
    v_j := 0;
    for v_i in 1..v_n loop
      if v_nilai[v_i] <= 0 then v_j := v_j + 1; v_nilai[v_i] := v_bagian[v_j]; end if;
    end loop;
    v_estimasi := true;
  else
    v_bagian := public._loonars2_bagi_rata(p_nominal, v_n);
    for v_i in 1..v_n loop v_nilai[v_i] := v_bagian[v_i]; end loop;
    v_estimasi := v_n > 1;
  end if;

  for v_i in 1..v_n loop
    it := v_items -> (v_i - 1);
    v_nama := left(coalesce(nullif(trim(it ->> 'nama'), ''), 'bahan'), 120);
    v_qty := nullif(it ->> 'qty', '')::numeric;
    v_satuan := nullif(left(trim(coalesce(it ->> 'satuan', '')), 30), '');
    v_ada := case when jsonb_typeof(it -> 'untuk_unit') = 'array' then jsonb_array_length(it -> 'untuk_unit') > 0 else false end;
    if v_ada then
      v_units := '{}';
      for v_ref in select jsonb_array_elements_text(it -> 'untuk_unit') loop
        v_uid := public._loonars2_cari_unit(v_ref);
        if v_uid is null then
          raise exception 'Unit "%" pada item "%" tidak dikenali.', v_ref, v_nama using errcode = '22023';
        end if;
        if not (v_uid = any (v_units)) then v_units := v_units || v_uid; end if;
      end loop;
    else
      v_units := v_default;
    end if;
    foreach v_uid in array v_units loop
      v_alasan := public._loonars2_cek_unit_boleh(v_uid);
      if v_alasan is not null then raise exception '%', v_alasan using errcode = '22023'; end if;
    end loop;
    v_unit_n := cardinality(v_units);
    v_bagian := public._loonars2_bagi_rata(v_nilai[v_i], v_unit_n);
    v_qdasar := case when v_qty is null then null else trunc(v_qty / v_unit_n, 4) end;
    for v_j in 1..v_unit_n loop
      v_qpart := case when v_qty is null then null
                      when v_j = 1 then v_qty - v_qdasar * (v_unit_n - 1)
                      else v_qdasar end;
      v_alok := v_alok || jsonb_build_object('unit_id', v_units[v_j], 'item', v_nama, 'qty', v_qpart, 'satuan', v_satuan, 'nominal', v_bagian[v_j]);
    end loop;
  end loop;

  v_kelompok := coalesce(nullif(trim(p_kelompok), ''), public._loonars2_kode_baru(case p_jenis when 'utang' then 'U' else 'M' end));
  insert into public.loonars2_pesanan_bahan (kelompok, jenis, toko, deskripsi, items, nominal, tanggal, nota_url, diajukan_oleh)
  values (v_kelompok, p_jenis, nullif(trim(p_toko), ''), coalesce(nullif(trim(p_deskripsi), ''), '(tanpa rincian)'), v_items, p_nominal,
          coalesce(p_tanggal, public._loonars2_hari_ini()), p_nota, p_nama)
  returning id into v_pid;
  insert into public.loonars2_bahan_unit (pesanan_id, unit_id, item, qty, satuan, nominal)
  select v_pid, (a ->> 'unit_id')::smallint, a ->> 'item', nullif(a ->> 'qty', '')::numeric, a ->> 'satuan', (a ->> 'nominal')::numeric
    from jsonb_array_elements(v_alok) a;

  v_toko_id := case when p_jenis = 'utang' then public._loonars2_cari_toko(p_toko, true) else null end;
  for r in
    select (a ->> 'unit_id')::smallint as unit_id, sum((a ->> 'nominal')::numeric) as total
      from jsonb_array_elements(v_alok) a group by 1 order by 1
  loop
    continue when r.total <= 0;
    v_desc := left(coalesce(nullif(trim(p_deskripsi), ''), '(tanpa rincian)'), 300) || ' — bahan kolektif, bagian unit ini';
    if p_jenis = 'tunai' then
      v_row := public._loonars2_buat_pengajuan(r.unit_id, 'material', v_desc, null, p_toko, r.total, p_nota, p_nama, p_nomor, p_sumber, v_kelompok);
      update public.loonars2_material_requests set pesanan_id = v_pid where id = v_row;
    else
      select * into u from public.loonars2_v_unit where id = r.unit_id;
      v_total_unit := u.terpakai_konstruksi + u.komitmen_disetujui + r.total;
      insert into public.loonars2_utang_toko (kelompok, toko_id, unit_id, deskripsi, nominal, tanggal, nota_url,
        diajukan_oleh, diajukan_oleh_nomor, sumber, pakai_buffer, melewati_buffer, unit_belum_terdanai, pesanan_id)
      values (v_kelompok, v_toko_id, r.unit_id, v_desc, r.total, coalesce(p_tanggal, public._loonars2_hari_ini()), p_nota,
        p_nama, p_nomor, p_sumber, v_total_unit > u.biaya_bangun, v_total_unit > u.biaya_bangun + u.buffer,
        not u.terdanai_penuh and not u.is_unit_contoh, v_pid);
    end if;
  end loop;

  return jsonb_build_object('status', 'diajukan', 'kelompok', v_kelompok, 'pesanan_id', v_pid, 'estimasi', v_estimasi,
    'alokasi', public._loonars2_teks_alokasi_pesanan(v_pid));
end;
$$;

-- Koreksi pembagian: "L2 koreksi M-7 semen unit 1,2,3" (item opsional = semua item).
-- Total tidak berubah; hanya dipindah antar unit. Pesanan yang sudah dibayar tidak bisa dikoreksi.
create or replace function public._loonars2_koreksi_bahan(p_kode text, p_item text, p_unit_ids smallint[], p_aktor text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text := upper(trim(coalesce(p_kode, '')));
  p record;
  r record;
  b record;
  v_uid smallint;
  v_alasan text;
  v_n integer := coalesce(cardinality(p_unit_ids), 0);
  v_bagian numeric[];
  v_qdasar numeric;
  v_j integer;
  v_diubah integer := 0;
  v_row integer;
  v_desc text;
  v_toko_id smallint;
  v_kena integer;
  v_teks text := '';
  v_tot numeric;
  u record;
  v_total_unit numeric;
begin
  perform public._loonars2_set_aktor(p_aktor, 'wa');
  if v_kode !~ '^[MU]-[0-9]+$' then
    raise exception 'Sebutkan kode pengajuan/utang, mis. "L2 koreksi M-7 semen unit 1,2,3".' using errcode = '22023';
  end if;
  if v_n = 0 or array_position(p_unit_ids, null) is not null then
    raise exception 'Sebutkan unit tujuannya, mis. "L2 koreksi % semen unit 1,2,3".', v_kode using errcode = '22023';
  end if;
  foreach v_uid in array p_unit_ids loop
    v_alasan := public._loonars2_cek_unit_boleh(v_uid);
    if v_alasan is not null then raise exception '%', v_alasan using errcode = '22023'; end if;
  end loop;

  for p in select * from public.loonars2_pesanan_bahan where kelompok = v_kode order by id loop
    if exists (select 1 from public.loonars2_material_requests where pesanan_id = p.id and status = 'dibayar') then
      raise exception '% sudah dibayar; pembagiannya tidak bisa dikoreksi lagi.', v_kode using errcode = '22023';
    end if;
    v_kena := 0;
    for r in
      select lower(trim(item)) as kunci, min(item) as item, sum(qty) as qty, max(satuan) as satuan, sum(nominal) as nominal
        from public.loonars2_bahan_unit
       where pesanan_id = p.id and aktif
         and (nullif(trim(coalesce(p_item, '')), '') is null or position(lower(trim(p_item)) in lower(item)) > 0)
       group by lower(trim(item))
    loop
      v_kena := v_kena + 1;
      update public.loonars2_bahan_unit set aktif = false where pesanan_id = p.id and aktif and lower(trim(item)) = r.kunci;
      v_bagian := public._loonars2_bagi_rata(r.nominal, v_n);
      v_qdasar := case when r.qty is null then null else trunc(r.qty / v_n, 4) end;
      for v_j in 1..v_n loop
        insert into public.loonars2_bahan_unit (pesanan_id, unit_id, item, qty, satuan, nominal)
        values (p.id, p_unit_ids[v_j], r.item,
                case when r.qty is null then null when v_j = 1 then r.qty - v_qdasar * (v_n - 1) else v_qdasar end,
                r.satuan, v_bagian[v_j]);
      end loop;
    end loop;
    continue when v_kena = 0;
    v_diubah := v_diubah + v_kena;

    -- Samakan baris biaya per unit dengan pembagian terbaru.
    v_toko_id := case when p.jenis = 'utang' then public._loonars2_cari_toko(p.toko, true) else null end;
    for b in
      select unit_id from public.loonars2_bahan_unit where pesanan_id = p.id
      union select unit_id from public.loonars2_material_requests where pesanan_id = p.id
      union select unit_id from public.loonars2_utang_toko where pesanan_id = p.id
    loop
      select coalesce(sum(nominal), 0) into v_tot from public.loonars2_bahan_unit where pesanan_id = p.id and aktif and unit_id = b.unit_id;
      if p.jenis = 'tunai' then
        select id into v_row from public.loonars2_material_requests where pesanan_id = p.id and unit_id = b.unit_id and status <> 'ditolak' order by id limit 1;
        if v_row is not null and v_tot > 0 then
          update public.loonars2_material_requests set nominal = v_tot where id = v_row;
        elsif v_row is not null then
          update public.loonars2_material_requests set status = 'ditolak', alasan_tolak = 'dikoreksi: unit tidak lagi menerima bahan ini' where id = v_row;
        elsif v_tot > 0 then
          v_desc := left(p.deskripsi, 300) || ' — bahan kolektif, bagian unit ini (dikoreksi)';
          v_row := public._loonars2_buat_pengajuan(b.unit_id, 'material', v_desc, null, p.toko, v_tot, p.nota_url, p.diajukan_oleh, null, 'wa', p.kelompok);
          update public.loonars2_material_requests set pesanan_id = p.id where id = v_row;
        end if;
      else
        select id into v_row from public.loonars2_utang_toko where pesanan_id = p.id and unit_id = b.unit_id and status <> 'ditolak' order by id limit 1;
        if v_row is not null and v_tot > 0 then
          update public.loonars2_utang_toko set nominal = v_tot where id = v_row;
        elsif v_row is not null then
          update public.loonars2_utang_toko set status = 'ditolak', alasan_tolak = 'dikoreksi: unit tidak lagi menerima bahan ini' where id = v_row;
        elsif v_tot > 0 then
          select * into u from public.loonars2_v_unit where id = b.unit_id;
          v_total_unit := u.terpakai_konstruksi + u.komitmen_disetujui + v_tot;
          insert into public.loonars2_utang_toko (kelompok, toko_id, unit_id, deskripsi, nominal, tanggal, nota_url,
            diajukan_oleh, sumber, pakai_buffer, melewati_buffer, unit_belum_terdanai, pesanan_id)
          values (p.kelompok, v_toko_id, b.unit_id, left(p.deskripsi, 300) || ' — bahan kolektif, bagian unit ini (dikoreksi)', v_tot, p.tanggal, p.nota_url,
            p.diajukan_oleh, 'wa', v_total_unit > u.biaya_bangun, v_total_unit > u.biaya_bangun + u.buffer,
            not u.terdanai_penuh and not u.is_unit_contoh, p.id);
        end if;
      end if;
    end loop;
    v_teks := v_teks || E'\n\n' || public._loonars2_teks_alokasi_pesanan(p.id);
  end loop;

  if v_diubah = 0 then
    raise exception 'Tidak ada bahan yang cocok di % (item: %).', v_kode, coalesce(nullif(trim(p_item), ''), 'semua') using errcode = '22023';
  end if;
  perform public._loonars2_kirim('owner', '✏️ Pembagian bahan ' || v_kode || ' dikoreksi (' || p_aktor || '). Baris unit baru (jika ada) menunggu persetujuan.' || v_teks, 'koreksi_bahan', null);
  return jsonb_build_object('status', 'ok', 'balasan', '✅ Pembagian ' || v_kode || ' dikoreksi.' || v_teks);
end;
$$;

-- RAB pemakaian bahan per unit (hasil pesanan kolektif Vando).
create or replace function public._loonars2_teks_rab(p_unit_id smallint)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text;
  v_total numeric := 0;
begin
  if p_unit_id is not null then
    v_teks := '🧱 RAB bahan ' || public._loonars2_label_unit(p_unit_id) || ' (dari pesanan Vando)';
    for r in select * from public.loonars2_v_rab_bahan where unit_id = p_unit_id order by nominal desc loop
      v_total := v_total + r.nominal;
      v_teks := v_teks || E'\n• ' || r.item || case when r.qty is not null then ' ' || public._loonars2_fmt_qty(r.qty) || coalesce(' ' || r.satuan, '') else '' end || ': ' || public.loonars2_rp(r.nominal);
    end loop;
    if v_total = 0 then return v_teks || E'\n(belum ada pesanan bahan untuk unit ini)'; end if;
    return v_teks || E'\nTotal bahan: ' || public.loonars2_rp(v_total);
  end if;
  v_teks := '🧱 RAB BAHAN PER UNIT (dari pesanan Vando)';
  for r in
    select unit_id, sum(nominal) as nominal, count(*) as jenis from public.loonars2_v_rab_bahan group by unit_id order by unit_id
  loop
    v_total := v_total + r.nominal;
    v_teks := v_teks || E'\n• ' || public._loonars2_label_unit(r.unit_id) || ': ' || public.loonars2_rp(r.nominal) || ' (' || r.jenis || ' jenis bahan)';
  end loop;
  if v_total = 0 then return v_teks || E'\n(belum ada pesanan bahan)'; end if;
  return v_teks || E'\nTotal: ' || public.loonars2_rp(v_total) || E'\nRinci per unit: "rab unit 3".';
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Pengajuan mingguan (isi lengkap): + tukang borongan, + retensi, + bahan kolektif
-- ----------------------------------------------------------------------------
--   "tukang minggu ini" / "borongan Pak Anang"  -> cicilan borongan minggu berikutnya (nominal dihitung sistem)
--   "retensi unit 3"                            -> retensi unit yang sudah selesai
--   "material semen 50 sak 6,5 juta TB Maju"    -> bahan kolektif (tanpa unit = unit sedang dibangun)
--   "kontraktor X unit 5,6 15 juta" / "lain ..."-> pengajuan per unit seperti sebelumnya
--   "cicilan TB Maju 3 juta"                    -> cicilan utang toko
-- Salah input = exception 22023 => seluruh pengajuan dibatalkan (tidak ada yang setengah masuk).
create or replace function public._loonars2_ajukan_mingguan(p_baris jsonb, p_nama text, p_nomor text, p_sumber text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baris jsonb;
  v_kelompok text;
  v_no integer := 0;
  v_jenis text;
  v_nominal numeric;
  v_unit_ids smallint[];
  v_unit text;
  v_id smallint;
  v_bagian numeric[];
  v_i integer;
  v_toko_id smallint;
  v_alasan text;
  v_total numeric := 0;
  v_b smallint;
  v_bor record;
  v_minggu integer;
  v_bu smallint[];
  v_row integer;
  v_dipakai smallint[] := '{}';
  v_retensi_unit smallint[] := '{}';
  v_bangun text;
  v_ringkas text := '';
  v_hasil jsonb;
  v_alok text := '';
  v_isi_owner text;
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Pengajuan kosong. Tulis satu baris per pembayaran.');
  end if;
  if jsonb_array_length(p_baris) > 30 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Maksimal 30 baris per pengajuan.');
  end if;

  v_kelompok := public._loonars2_kode_baru('M');
  for v_baris in select * from jsonb_array_elements(p_baris) loop
    v_no := v_no + 1;
    v_jenis := coalesce(v_baris ->> 'jenis', 'material');
    v_nominal := nullif(v_baris ->> 'nominal', '')::numeric;
    v_unit_ids := '{}';
    if jsonb_typeof(v_baris -> 'unit') = 'array' then
      for v_unit in select jsonb_array_elements_text(v_baris -> 'unit') loop
        v_id := public._loonars2_cari_unit(v_unit);
        if v_id is null then
          raise exception 'Baris %: unit "%" tidak dikenali.', v_no, v_unit using errcode = '22023';
        end if;
        if not (v_id = any (v_unit_ids)) then v_unit_ids := v_unit_ids || v_id; end if;
      end loop;
    end if;
    if v_jenis not in ('cicilan', 'tukang', 'material', 'lain', 'retensi') then
      raise exception 'Baris %: jenis tidak dikenal.', v_no using errcode = '22023';
    end if;

    if v_jenis = 'cicilan' then
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".', v_no using errcode = '22023';
      end if;
      v_toko_id := public._loonars2_cari_toko(v_baris ->> 'toko', false);
      if v_toko_id is null then
        raise exception 'Baris %: toko "%" belum punya utang tercatat. Catat dulu utangnya: "L2 utang <toko> <rincian> <nominal>".', v_no, coalesce(v_baris ->> 'toko', '') using errcode = '22023';
      end if;
      insert into public.loonars2_cicilan (kelompok, toko_id, nominal, catatan, diajukan_oleh, diajukan_oleh_nomor, sumber)
      values (v_kelompok, v_toko_id, v_nominal, nullif(trim(v_baris ->> 'deskripsi'), ''), p_nama, p_nomor, p_sumber);
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• Cicilan ' || (select nama from public.loonars2_toko where id = v_toko_id) || ': ' || public.loonars2_rp(v_nominal);

    elsif v_jenis = 'retensi' then
      if cardinality(v_unit_ids) = 0 then
        raise exception 'Baris %: sebut unitnya, mis. "retensi unit 3".', v_no using errcode = '22023';
      end if;
      foreach v_id in array v_unit_ids loop
        select bu.borongan_id into v_b from public.loonars2_borongan_unit bu where bu.unit_id = v_id;
        if v_b is null then
          raise exception 'Baris %: % tidak ada di borongan mana pun.', v_no, public._loonars2_label_unit(v_id) using errcode = '22023';
        end if;
        select * into v_bor from public.loonars2_borongan where id = v_b;
        select status_bangun into v_bangun from public.loonars2_units where id = v_id;
        if v_bangun not in ('selesai', 'serah_terima') then
          raise exception 'Baris %: % belum selesai (status bangun: %). Retensi baru bisa diajukan setelah unit ditandai selesai/serah terima oleh owner.',
            v_no, public._loonars2_label_unit(v_id), v_bangun using errcode = '22023';
        end if;
        if v_bor.retensi_per_unit <= 0 then
          raise exception 'Baris %: borongan % tidak memakai retensi.', v_no, v_bor.nama using errcode = '22023';
        end if;
        if v_id = any (v_retensi_unit)
           or exists (select 1 from public.loonars2_material_requests where borongan_id = v_b and unit_id = v_id and retensi and status <> 'ditolak') then
          raise exception 'Baris %: retensi % sudah pernah diajukan.', v_no, public._loonars2_label_unit(v_id) using errcode = '22023';
        end if;
        v_retensi_unit := v_retensi_unit || v_id;
        v_row := public._loonars2_buat_pengajuan(v_id, 'tukang', 'Retensi borongan ' || v_bor.nama, null, null, v_bor.retensi_per_unit, null, p_nama, p_nomor, p_sumber, v_kelompok);
        update public.loonars2_material_requests set borongan_id = v_b, retensi = true where id = v_row;
        v_total := v_total + v_bor.retensi_per_unit;
        v_ringkas := v_ringkas || E'\n• Retensi ' || v_bor.nama || ' ' || public._loonars2_label_unit(v_id) || ': ' || public.loonars2_rp(v_bor.retensi_per_unit);
      end loop;

    elsif v_jenis = 'tukang' and v_nominal is null then
      v_b := public._loonars2_cari_borongan(coalesce(v_baris ->> 'deskripsi', '') || ' ' || coalesce(v_baris ->> 'toko', ''));
      if v_b is null then
        if not exists (select 1 from public.loonars2_borongan where status = 'aktif') then
          raise exception 'Baris %: belum ada borongan tukang yang aktif. Owner mencatat dulu: "borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu". Atau tulis nominal dan unit: "kontraktor Pak Anang unit 5,6 15 juta".', v_no using errcode = '22023';
        end if;
        raise exception 'Baris %: ada beberapa borongan aktif, sebut nama mandornya, mis. "tukang Pak Anang minggu ini".', v_no using errcode = '22023';
      end if;
      select * into v_bor from public.loonars2_borongan where id = v_b;
      if v_b = any (v_dipakai) then
        raise exception 'Baris %: borongan % sudah ada di pengajuan ini.', v_no, v_bor.nama using errcode = '22023';
      end if;
      select max(minggu_ke) into v_minggu from public.loonars2_material_requests
       where borongan_id = v_b and not retensi and status = 'menunggu';
      if v_minggu is not null then
        raise exception 'Baris %: upah borongan % minggu ke-% masih menunggu persetujuan owner. Minggu berikutnya bisa diajukan setelah itu (mencegah pengajuan ganda).', v_no, v_bor.nama, v_minggu using errcode = '22023';
      end if;
      select coalesce(max(minggu_ke), 0) + 1 into v_minggu from public.loonars2_material_requests
       where borongan_id = v_b and not retensi and status <> 'ditolak';
      if v_minggu > v_bor.jumlah_minggu then
        raise exception 'Baris %: borongan % sudah diajukan lengkap (% minggu).', v_no, v_bor.nama, v_bor.jumlah_minggu using errcode = '22023';
      end if;
      v_nominal := public._loonars2_nominal_minggu(v_b, v_minggu);
      v_bu := array(select unit_id from public.loonars2_borongan_unit where borongan_id = v_b order by unit_id);
      v_bagian := public._loonars2_bagi_rata(v_nominal, cardinality(v_bu));
      for v_i in 1..cardinality(v_bu) loop
        v_row := public._loonars2_buat_pengajuan(v_bu[v_i], 'tukang',
          'Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || '/' || v_bor.jumlah_minggu || ' (dibagi rata ' || cardinality(v_bu) || ' unit)',
          null, null, v_bagian[v_i], null, p_nama, p_nomor, p_sumber, v_kelompok);
        update public.loonars2_material_requests set borongan_id = v_b, minggu_ke = v_minggu where id = v_row;
      end loop;
      v_dipakai := v_dipakai || v_b;
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• Upah borongan ' || v_bor.nama || ' minggu ke-' || v_minggu || '/' || v_bor.jumlah_minggu || ': ' || public.loonars2_rp(v_nominal)
                   || ' (' || cardinality(v_bu) || ' unit)';

    elsif v_jenis = 'material' then
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".', v_no using errcode = '22023';
      end if;
      v_hasil := public._loonars2_pesan_bahan('tunai', v_baris ->> 'toko', coalesce(nullif(trim(v_baris ->> 'deskripsi'), ''), '(tanpa rincian)'),
        v_baris -> 'items', v_nominal, v_unit_ids, v_baris ->> 'nota_url', null, p_nama, p_nomor, p_sumber, v_kelompok);
      v_alok := v_alok || E'\n\n' || (v_hasil ->> 'alokasi');
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• Bahan ' || left(coalesce(v_baris ->> 'deskripsi', ''), 60) || ': ' || public.loonars2_rp(v_nominal) || ' (dibagi ke unit sedang dibangun)';

    else
      -- tukang dengan nominal & unit, atau biaya lain: per unit, dibagi rata.
      if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
        raise exception 'Baris %: nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".', v_no using errcode = '22023';
      end if;
      if cardinality(v_unit_ids) = 0 then
        raise exception 'Baris %: unit belum disebut (mis. "unit 5" atau "unit 5,6").', v_no using errcode = '22023';
      end if;
      foreach v_id in array v_unit_ids loop
        v_alasan := public._loonars2_cek_unit_boleh(v_id);
        if v_alasan is not null then raise exception 'Baris %: %', v_no, v_alasan using errcode = '22023'; end if;
      end loop;
      v_bagian := public._loonars2_bagi_rata(v_nominal, cardinality(v_unit_ids));
      for v_i in 1..cardinality(v_unit_ids) loop
        perform public._loonars2_buat_pengajuan(v_unit_ids[v_i], v_jenis,
          coalesce(nullif(trim(v_baris ->> 'deskripsi'), ''), '(tanpa rincian)')
            || case when cardinality(v_unit_ids) > 1 then ' (dibagi rata ' || cardinality(v_unit_ids) || ' unit)' else '' end,
          null, v_baris ->> 'toko', v_bagian[v_i], v_baris ->> 'nota_url', p_nama, p_nomor, p_sumber, v_kelompok);
      end loop;
      v_total := v_total + v_nominal;
      v_ringkas := v_ringkas || E'\n• ' || case v_jenis when 'tukang' then 'Kontraktor/tukang' else 'Lain-lain' end || ' ' || left(coalesce(v_baris ->> 'deskripsi', ''), 60) || ': ' || public.loonars2_rp(v_nominal);
    end if;
  end loop;

  v_isi_owner := public._loonars2_teks_kelompok(v_kelompok);
  perform public._loonars2_kirim('owner', v_isi_owner || v_alok, 'pengajuan_mingguan', 'mingguan:' || v_kelompok);
  return jsonb_build_object('status', 'diajukan', 'kode', v_kelompok, 'balasan',
    '✅ Pengajuan ' || v_kelompok || ' diterima: ' || jsonb_array_length(p_baris) || ' baris, total ' || public.loonars2_rp(v_total)
    || v_ringkas || v_alok
    || E'\n\nStatus: MENUNGGU PERSETUJUAN OWNER. Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_kelompok || '".'
    || case when v_alok <> '' then E'\nPembagian bahan ke unit salah? Koreksi: "L2 koreksi ' || v_kelompok || ' <bahan> unit 1,2,3".' else '' end);
end;
$$;

-- Apakah pesan pelaksana ini bergantung pada daftar "unit sedang dibangun"?
-- Bila ya, pelaksana ditanya dulu (jawabannya jadi acuan).
create or replace function public._loonars2_butuh_unit(p_aksi text, p_data jsonb)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_baris jsonb;
  v_ada_unit boolean;
begin
  if p_aksi in ('bahan', 'utang') then
    return not (case when jsonb_typeof(p_data -> 'unit') = 'array' then jsonb_array_length(p_data -> 'unit') > 0 else false end);
  end if;
  if p_aksi = 'ajukan_mingguan' and jsonb_typeof(p_data -> 'baris') = 'array' then
    for v_baris in select * from jsonb_array_elements(p_data -> 'baris') loop
      v_ada_unit := case when jsonb_typeof(v_baris -> 'unit') = 'array' then jsonb_array_length(v_baris -> 'unit') > 0 else false end;
      if coalesce(v_baris ->> 'jenis', 'material') = 'material' and not v_ada_unit then return true; end if;
      if v_baris ->> 'jenis' = 'tukang' and nullif(v_baris ->> 'nominal', '') is null then return true; end if;
    end loop;
  end if;
  return false;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Pintu WA: pembungkus pesanan bahan (kirim ke owner + balasan pelaksana)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_pesan_bahan_wa(p_user public.loonars2_wa_users, p_jenis text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_ids smallint[];
  v_hasil jsonb;
  v_k text;
  v_nominal numeric := nullif(p_data ->> 'nominal', '')::numeric;
  v_teks text;
begin
  select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
    from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
  if v_unit_ids is not null and array_position(v_unit_ids, null) is not null then
    return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Contoh: "unit 5" atau "unit 5,6", atau kosongkan untuk unit yang sedang dibangun.');
  end if;
  v_hasil := public._loonars2_pesan_bahan(p_jenis, p_data ->> 'toko', coalesce(nullif(p_data ->> 'deskripsi', ''), '(tanpa rincian)'), p_data -> 'items',
    v_nominal, coalesce(v_unit_ids, '{}'), p_data ->> 'nota_url', nullif(p_data ->> 'tanggal', '')::date, p_user.nama, p_user.nomor, 'wa', null);
  v_k := v_hasil ->> 'kelompok';
  v_teks := case p_jenis when 'utang' then public._loonars2_teks_utang_kelompok(v_k) else public._loonars2_teks_kelompok(v_k) end;
  perform public._loonars2_kirim('owner', coalesce(v_teks, '') || E'\n\n' || (v_hasil ->> 'alokasi'),
    case p_jenis when 'utang' then 'utang' else 'pengajuan_mingguan' end,
    case p_jenis when 'utang' then 'utang:' else 'mingguan:' end || v_k, p_data ->> 'nota_url');
  return jsonb_build_object('status', 'diajukan', 'kode', v_k, 'balasan',
    '✅ ' || case p_jenis when 'utang' then 'Utang bahan ' else 'Pesanan bahan ' end || v_k || ' diterima: ' || public.loonars2_rp(v_nominal)
    || E'\n\n' || (v_hasil ->> 'alokasi')
    || case when (v_hasil ->> 'estimasi')::boolean then E'\n\nℹ️ Pembagian per item masih perkiraan (dibagi rata) karena harga per item belum dirinci.' else '' end
    || E'\n\nStatus: MENUNGGU PERSETUJUAN OWNER.'
    || case p_jenis when 'utang' then E' Cicilannya diajukan di pengajuan mingguan: "cicilan <toko> <nominal>".'
                    else E' Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_k || '".' end
    || E'\nPembagian ke unit salah? Koreksi: "L2 koreksi ' || v_k || ' <bahan> unit 1,2,3".');
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Pintu WA (isi lengkap): + unit_dibangun, bahan, borongan, daftar_borongan, koreksi_bahan, rab
-- ----------------------------------------------------------------------------
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
  v_unit_ids smallint[];
  v_pend public.loonars2_wa_pending;
  v_hasil jsonb;
  v_ilang boolean;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');

  if p_aksi in ('receipt', 'konfirmasi_transfer', 'tagihan', 'saldo', 'ubah_rekening', 'putuskan', 'putuskan_kode', 'cairkan_profit', 'borongan')
     and p_user.peran <> 'owner' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Perintah ini hanya untuk owner.');
  end if;
  if p_aksi in ('ajukan', 'utang', 'ajukan_mingguan', 'bahan') and p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Pengajuan dan input utang dilakukan oleh pelaksana.');
  end if;

  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.
  if p_user.peran = 'pelaksana' and not p_sudah_konfirmasi and p_aksi in ('ajukan_mingguan', 'bahan', 'utang')
     and public._loonars2_butuh_unit(p_aksi, p_data) then
    insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, p_data)
    on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
    return jsonb_build_object('status', 'menunggu_unit', 'balasan',
      case when cardinality(public._loonars2_unit_dibangun()) = 0
        then '📍 Unit mana yang sedang dibangun? Kirim daftarnya, mis. "L2 unit 1-6". Pengajuan Bapak saya proses setelah itu.'
        else '📍 Unit yang sedang dibangun saat ini: ' || public._loonars2_teks_unit_dibangun()
             || E'.\nUpah dan bahan dibagi mengikuti daftar ini.\nBalas YA jika sudah benar, atau kirim daftar terbaru, mis. "L2 unit 1-7".' end);
  end if;

  if p_aksi = 'saldo' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_saldo());
  elsif p_aksi = 'tagihan' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_tagihan());
  elsif p_aksi = 'daftar_utang' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_daftar_utang());

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

  elsif p_aksi = 'putuskan_kode' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_putuskan_kode(
      p_data ->> 'kode', coalesce((p_data ->> 'setuju')::boolean, false), p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'wa'));

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

  elsif p_aksi = 'utang' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 then
      return public._loonars2_pesan_bahan_wa(p_user, 'utang', p_data);
    end if;
    return public._loonars2_catat_utang(v_unit_ids, p_data ->> 'toko', p_data ->> 'deskripsi', p_data -> 'items',
      nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'nota_url', nullif(p_data ->> 'tanggal', '')::date, p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'bahan' then
    return public._loonars2_pesan_bahan_wa(p_user, case when coalesce(p_data ->> 'utang', 'false') = 'true' then 'utang' else 'tunai' end, p_data);

  elsif p_aksi = 'unit_dibangun' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 or array_position(v_unit_ids, null) is not null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Contoh: "L2 unit 1-6" atau "L2 unit 1,2,3".');
    end if;
    perform public._loonars2_atur_unit_dibangun(v_unit_ids);
    v_teks := '📍 Unit sedang dibangun: ' || public._loonars2_teks_unit_dibangun() || '.';
    select * into v_pend from public.loonars2_wa_pending
     where nomor = p_user.nomor and kedaluwarsa_pada > now() and aksi in ('ajukan_mingguan', 'bahan', 'utang');
    v_ilang := found;
    if v_ilang then
      update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
      v_hasil := public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_pend.data, true);
      return v_hasil || jsonb_build_object('balasan', v_teks || E'\n\n' || coalesce(v_hasil ->> 'balasan', ''));
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', v_teks);

  elsif p_aksi = 'borongan' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    v_nominal := nullif(p_data ->> 'nilai', '')::numeric;
    if v_unit_ids is null or cardinality(v_unit_ids) = 0 or array_position(v_unit_ids, null) is not null
       or v_nominal is null or nullif(p_data ->> 'minggu', '') is null or length(trim(coalesce(p_data ->> 'nama', ''))) < 2 then
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        'Format: borongan Pak Anang unit 1-6 35 juta retensi 9 juta 12 minggu' || E'\n(nama mandor, unit, nilai per unit, retensi per unit, jumlah minggu)');
    end if;
    if not p_sudah_konfirmasi then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, 'borongan', p_data)
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_ya', 'balasan',
        'Konfirmasi borongan ' || trim(p_data ->> 'nama') || ': ' || cardinality(v_unit_ids) || ' unit × ' || public.loonars2_rp(v_nominal)
        || ', retensi ' || public.loonars2_rp(coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)) || '/unit, ' || (p_data ->> 'minggu') || ' minggu.'
        || E'\nDibayar mingguan: ' || public.loonars2_rp(cardinality(v_unit_ids) * (v_nominal - coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)))
        || ' ÷ ' || (p_data ->> 'minggu') || ' minggu ≈ ' || public.loonars2_rp(floor(cardinality(v_unit_ids) * (v_nominal - coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0)) / (p_data ->> 'minggu')::int)) || '/minggu.'
        || E'\n\nBalas YA untuk mencatat, atau BATAL.');
    end if;
    return public._loonars2_buat_borongan(p_data ->> 'nama', v_unit_ids, v_nominal, coalesce(nullif(p_data ->> 'retensi', '')::numeric, 0),
      (p_data ->> 'minggu')::int, nullif(p_data ->> 'tanggal', '')::date, v_aktor);

  elsif p_aksi = 'daftar_borongan' then
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_borongan());

  elsif p_aksi = 'koreksi_bahan' then
    select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids
      from jsonb_array_elements_text(case when jsonb_typeof(p_data -> 'unit') = 'array' then p_data -> 'unit' else '[]'::jsonb end) x;
    return public._loonars2_koreksi_bahan(p_data ->> 'kode', p_data ->> 'item', v_unit_ids, v_aktor);

  elsif p_aksi = 'rab' then
    v_unit_id := case when nullif(p_data ->> 'unit', '') is null then null else public._loonars2_cari_unit(p_data ->> 'unit') end;
    if nullif(p_data ->> 'unit', '') is not null and v_unit_id is null then
      return jsonb_build_object('status', 'perlu_info', 'balasan', 'Unit tidak dikenali. Contoh: "rab unit 3".');
    end if;
    return jsonb_build_object('status', 'ok', 'balasan', public._loonars2_teks_rab(v_unit_id));

  elsif p_aksi = 'ajukan_mingguan' then
    return public._loonars2_ajukan_mingguan(p_data -> 'baris', p_user.nama, p_user.nomor, 'wa');

  elsif p_aksi = 'bayar_pengajuan' then
    v_id := nullif(p_data ->> 'id', '')::int;
    if v_id is null then return jsonb_build_object('status', 'perlu_info', 'balasan', 'Sebutkan nomor pengajuan, mis. "L2 bayar L2-12".'); end if;
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_bayar_pengajuan(v_id, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'bukti_url', v_aktor, 'wa'));

  elsif p_aksi = 'bayar_kelompok' then
    return jsonb_build_object('status', 'ok', 'balasan',
      public._loonars2_bayar_kelompok(p_data ->> 'kode', p_data ->> 'bukti_url', v_aktor, 'wa'));
  end if;

  return jsonb_build_object('status', 'tidak_dikenal', 'balasan', 'Perintah Loonars 2 tidak dikenali.');
exception
  when sqlstate '22023' or sqlstate '23514' then
    return jsonb_build_object('status', 'ditolak', 'balasan', '❌ ' || sqlerrm);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Pengingat (isi lengkap): contoh pengajuan mingguan format baru
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
  if v_lokal::time < make_time(v_set.jam_mulai_pengingat, 0, 0)
     or v_lokal::time > make_time(least(v_set.jam_selesai_pengingat, 23), case when v_set.jam_selesai_pengingat = 24 then 59 else 0 end, 0) then
    return;
  end if;

  v_teks := public._loonars2_teks_tertunda();
  if v_teks is not null then
    v_rekap_baru := public._loonars2_kirim('owner', '🌅 REKAP PAGI' || E'\n' || v_teks, 'rekap_pagi', 'rekap:' || v_hari);
  end if;
  if v_rekap_baru > 0 then
    update public.loonars2_receipts re set terakhir_diingatkan_pada = now()
     where re.status = 'aktif'
       and exists (select 1 from public.loonars2_allocations al where al.receipt_id = re.id and al.status = 'menunggu');
  end if;

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

  -- Pengingat pengajuan mingguan ke pelaksana (hari yang diatur, mis. Jumat).
  if extract(isodow from v_hari) = v_set.hari_pengajuan_mingguan then
    perform public._loonars2_kirim('pelaksana',
      '🗓️ Waktunya pengajuan mingguan Loonars 2.' || E'\n' || public._loonars2_teks_daftar_utang()
      || E'\n\nKirim satu pesan, satu baris per pembayaran, contoh:'
      || E'\nL2 pengajuan minggu ini'
      || E'\n- cicilan TB Maju 3 juta'
      || E'\n- tukang minggu ini'
      || E'\n- material semen 50 sak, pasir 4 rit 8,5 juta TB Maju',
      'pengingat_mingguan', 'pengingat_mingguan:' || v_hari);
  end if;

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
      || E'\n\n' || public._loonars2_teks_daftar_utang()
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
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Data baca-saja pelaksana (isi lengkap): + borongan, RAB bahan, unit dibangun
-- ----------------------------------------------------------------------------
create or replace function public.loonars2_web_lihat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loonars2_boleh_lihat() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'proyeksi_tanah', public._loonars2_proyeksi_tanah(),
    'unit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'nomor', v.nomor, 'kode', v.kode, 'tipe', v.tipe, 'status', v.status,
        'status_bangun', v.status_bangun, 'is_unit_contoh', v.is_unit_contoh,
        'jatuh_tempo_efektif', v.jatuh_tempo_efektif,
        'biaya_bangun', v.biaya_bangun, 'buffer', v.buffer,
        'terpakai_konstruksi', v.terpakai_konstruksi, 'utang_disetujui', v.utang_disetujui,
        'komitmen_disetujui', v.komitmen_disetujui,
        'sedang_dibangun', (select x.sedang_dibangun from public.loonars2_units x where x.id = v.id)
      ) order by v.nomor) from public.loonars2_v_unit v), '[]'::jsonb),
    'toko', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'nama', nama, 'utang_disetujui', utang_disetujui, 'utang_menunggu', utang_menunggu,
        'cicilan_dibayar', cicilan_dibayar, 'cicilan_diproses', cicilan_diproses, 'sisa_utang', sisa_utang
      ) order by sisa_utang desc, nama) from public.loonars2_v_toko), '[]'::jsonb),
    'utang', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'toko_id', toko_id, 'unit_id', unit_id, 'deskripsi', deskripsi,
          'nominal', nominal, 'tanggal', tanggal, 'pakai_buffer', pakai_buffer, 'melewati_buffer', melewati_buffer,
          'status', status, 'alasan_tolak', alasan_tolak
        ) as x from public.loonars2_utang_toko order by id desc limit 200) s), '[]'::jsonb),
    'cicilan', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'toko_id', toko_id, 'nominal', nominal, 'catatan', catatan,
          'status', status, 'alasan_tolak', alasan_tolak, 'dibuat_pada', dibuat_pada
        ) as x from public.loonars2_cicilan order by id desc limit 200) s), '[]'::jsonb),
    'pengajuan', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'unit_id', unit_id, 'kategori', kategori, 'deskripsi', deskripsi,
          'toko', toko, 'nominal', nominal, 'pakai_buffer', pakai_buffer, 'melewati_buffer', melewati_buffer,
          'status', status, 'alasan_tolak', alasan_tolak, 'dibuat_pada', dibuat_pada,
          'borongan_id', borongan_id, 'minggu_ke', minggu_ke, 'retensi', retensi
        ) as x from public.loonars2_material_requests order by id desc limit 200) s), '[]'::jsonb),
    'borongan', coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.loonars2_v_borongan b where b.status <> 'batal'), '[]'::jsonb),
    'rab', coalesce((select jsonb_agg(to_jsonb(r)) from public.loonars2_v_rab_bahan r), '[]'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 11. Hak eksekusi: semua fungsi internal tertutup untuk klien
-- ----------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like '\_loonars2\_%' or p.proname = 'loonars2_pengingat')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.loonars2_web_lihat() from public, anon;
grant execute on function public.loonars2_web_lihat() to authenticated;
