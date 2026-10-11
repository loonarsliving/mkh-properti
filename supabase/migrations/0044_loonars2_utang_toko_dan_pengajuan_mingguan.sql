-- ============================================================================
-- 0044 — Loonars 2: utang toko bangunan + pengajuan mingguan
--
-- Keputusan owner (2026-10-11): material dibeli secara UTANG di toko bangunan
-- dan dicicil tiap minggu. Vando menginput utang, lalu tiap minggu mengajukan
-- pembayaran (cicilan utang toko + pembayaran kontraktor + material lain)
-- dalam satu pengajuan.
--
--   - loonars2_toko            : daftar toko (dibuat otomatis dari nama).
--   - loonars2_utang_toko      : pembelian secara utang, per unit. Saat
--                                disetujui owner, nilainya langsung
--                                memotong budget bangun unit (materialnya
--                                sudah dipakai), walau belum dibayar.
--                                Kode persetujuan: U-<n> (satu nota bisa
--                                dibagi ke beberapa unit).
--   - loonars2_cicilan         : permintaan bayar cicilan ke toko (tidak
--                                per unit — budget unit sudah terpotong saat
--                                utang disetujui, jadi tidak dihitung dua kali).
--   - kelompok M-<n>           : satu pengajuan mingguan = beberapa baris
--                                (cicilan + kontraktor/material) yang
--                                disetujui ("setujui M-3") dan dibayar
--                                ("L2 bayar M-3" + bukti) sekaligus.
--
-- Pembayaran cicilan tercatat sebagai pengeluaran C kategori 'material'
-- dengan cicilan_id (tanpa unit), sehingga aturan rekening di 0043 tidak
-- perlu diubah. Sisa utang per toko = utang disetujui − cicilan dibayar.
--
-- Catatan penerapan: TANPA perintah DROP/DELETE apa pun (alat Supabase MCP
-- menahan pernyataan destruktif — lihat CURRENT_STATE.md 0043). Hanya
-- tabel/kolom baru dan CREATE OR REPLACE fungsi/view milik loonars2.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabel & kolom baru
-- ----------------------------------------------------------------------------
create sequence public.loonars2_kelompok_seq;

create table public.loonars2_toko (
  id smallint generated always as identity primary key,
  nama text not null check (length(trim(nama)) between 2 and 80),
  catatan text,
  dibuat_pada timestamptz not null default now()
);
create unique index loonars2_toko_nama_idx on public.loonars2_toko (lower(trim(nama)));

create table public.loonars2_utang_toko (
  id integer generated always as identity primary key,
  kelompok text not null,
  toko_id smallint not null references public.loonars2_toko(id) on delete restrict,
  unit_id smallint not null references public.loonars2_units(id) on delete restrict,
  deskripsi text not null check (length(deskripsi) between 1 and 2000),
  items jsonb,
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  tanggal date not null default ((now() at time zone 'Asia/Jakarta')::date),
  nota_url text,
  diajukan_oleh text not null,
  diajukan_oleh_nomor text,
  sumber text not null check (sumber in ('wa', 'web')),
  pakai_buffer boolean not null default false,
  melewati_buffer boolean not null default false,
  unit_belum_terdanai boolean not null default false,
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak')),
  alasan_tolak text,
  diputuskan_oleh text,
  diputuskan_pada timestamptz,
  dibuat_pada timestamptz not null default now()
);
create index loonars2_utang_toko_toko_idx on public.loonars2_utang_toko (toko_id, status);
create index loonars2_utang_toko_unit_idx on public.loonars2_utang_toko (unit_id, status);
create index loonars2_utang_toko_kelompok_idx on public.loonars2_utang_toko (kelompok);

create table public.loonars2_cicilan (
  id integer generated always as identity primary key,
  kelompok text not null,
  toko_id smallint not null references public.loonars2_toko(id) on delete restrict,
  nominal numeric not null check (nominal > 0 and nominal = round(nominal)),
  catatan text,
  diajukan_oleh text not null,
  diajukan_oleh_nomor text,
  sumber text not null check (sumber in ('wa', 'web')),
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak', 'dibayar')),
  alasan_tolak text,
  diputuskan_oleh text,
  diputuskan_pada timestamptz,
  dibuat_pada timestamptz not null default now()
);
create index loonars2_cicilan_kelompok_idx on public.loonars2_cicilan (kelompok);
create index loonars2_cicilan_toko_idx on public.loonars2_cicilan (toko_id, status);

alter table public.loonars2_material_requests add column kelompok text;
create index loonars2_material_requests_kelompok_idx on public.loonars2_material_requests (kelompok);

alter table public.loonars2_disbursements add column toko_id smallint references public.loonars2_toko(id) on delete restrict;
alter table public.loonars2_disbursements add column cicilan_id integer unique references public.loonars2_cicilan(id) on delete restrict;
alter table public.loonars2_disbursements add constraint loonars2_disbursements_cicilan_dari_c
  check (cicilan_id is null or (dari_rekening = 'C' and kategori = 'material'));

-- Hari pengingat pengajuan mingguan ke pelaksana (ISO: 1 = Senin … 7 = Minggu).
alter table public.loonars2_settings add column hari_pengajuan_mingguan smallint not null default 5
  check (hari_pengajuan_mingguan between 1 and 7);

do $$
declare
  t text;
begin
  foreach t in array array['loonars2_toko', 'loonars2_utang_toko', 'loonars2_cicilan']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy cfo_baca on public.%I for select to authenticated using ((select public.mkh_is_cfo()))', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.loonars2_audit(''id'')', t || '_audit', t);
  end loop;
end $$;
grant update (nama, catatan) on public.loonars2_toko to authenticated;
create policy cfo_ubah on public.loonars2_toko for update to authenticated
  using ((select public.mkh_is_cfo())) with check ((select public.mkh_is_cfo()));
revoke all on sequence public.loonars2_kelompok_seq from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. View: budget unit memperhitungkan utang yang disetujui; ringkasan toko
-- ----------------------------------------------------------------------------
create or replace view public.loonars2_v_unit with (security_invoker = true) as
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
  -- Terpakai = dibayar tunai dari C + material yang diambil secara utang
  -- (disetujui), walau utangnya belum lunas.
  coalesce(k.terpakai_konstruksi, 0) + coalesce(ut.utang, 0) as terpakai_konstruksi,
  coalesce(k.keluar_c, 0) as keluar_c,
  coalesce(m.komitmen, 0) as komitmen_disetujui,
  coalesce(a.c_dialokasikan, 0) >= d.biaya_bangun + d.buffer + round(d.harga_efektif * d.fee_persen_efektif / 100) as terdanai_penuh,
  coalesce(d.jatuh_tempo_pelunasan, d.tanggal_serah_terima) as jatuh_tempo_efektif,
  coalesce(ut.utang, 0) as utang_disetujui
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
) m on true
left join lateral (
  select sum(nominal) as utang from public.loonars2_utang_toko where unit_id = d.id and status = 'disetujui'
) ut on true;

create view public.loonars2_v_toko with (security_invoker = true) as
select
  t.id, t.nama, t.catatan,
  coalesce((select sum(nominal) from public.loonars2_utang_toko where toko_id = t.id and status = 'disetujui'), 0) as utang_disetujui,
  coalesce((select sum(nominal) from public.loonars2_utang_toko where toko_id = t.id and status = 'menunggu'), 0) as utang_menunggu,
  coalesce((select sum(nominal) from public.loonars2_cicilan where toko_id = t.id and status = 'dibayar'), 0) as cicilan_dibayar,
  coalesce((select sum(nominal) from public.loonars2_cicilan where toko_id = t.id and status in ('menunggu', 'disetujui')), 0) as cicilan_diproses,
  coalesce((select sum(nominal) from public.loonars2_utang_toko where toko_id = t.id and status = 'disetujui'), 0)
    - coalesce((select sum(nominal) from public.loonars2_cicilan where toko_id = t.id and status = 'dibayar'), 0) as sisa_utang
from public.loonars2_toko t;

revoke all on public.loonars2_v_toko from anon;
grant select on public.loonars2_v_toko to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Helper
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_cari_toko(p_nama text, p_buat boolean)
returns smallint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nama text := regexp_replace(trim(coalesce(p_nama, '')), '\s+', ' ', 'g');
  v_id smallint;
begin
  if length(v_nama) < 2 then return null; end if;
  select id into v_id from public.loonars2_toko where lower(trim(nama)) = lower(v_nama);
  if v_id is null and p_buat then
    insert into public.loonars2_toko (nama) values (v_nama) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Uang C yang sudah "terikat": pengajuan & cicilan disetujui yang belum
-- dibayar + sisa utang toko yang sudah disetujui.
create or replace function public._loonars2_c_terikat()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(nominal) from public.loonars2_material_requests where status = 'disetujui'), 0)
       + coalesce((select sum(sisa_utang) from public.loonars2_v_toko where sisa_utang > 0), 0);
$$;

create or replace function public._loonars2_kode_baru(p_awalan text)
returns text
language sql
security definer
set search_path = public
as $$ select p_awalan || '-' || nextval('public.loonars2_kelompok_seq') $$;

-- Bagi rata nominal ke beberapa unit dalam rupiah bulat; sisa pembagian ke
-- unit pertama, jadi jumlahnya selalu sama persis.
create or replace function public._loonars2_bagi_rata(p_nominal numeric, p_jumlah integer)
returns numeric[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_dasar numeric := floor(p_nominal / p_jumlah);
  v_hasil numeric[] := array_fill(v_dasar, array[p_jumlah]);
begin
  v_hasil[1] := v_hasil[1] + (p_nominal - v_dasar * p_jumlah);
  return v_hasil;
end;
$$;

-- Validasi satu baris pembelian/pengajuan untuk satu unit. Mengembalikan
-- null bila boleh, atau teks alasan penolakan.
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
  if u.status not in ('dp', 'lunas') and not u.is_unit_contoh then
    return public._loonars2_label_unit(p_unit_id) || ' belum terjual (minimal DP). Material/kontraktor hanya untuk unit yang sudah DP atau unit contoh.';
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Pengajuan satu baris (dipakai pengajuan biasa & mingguan)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_buat_pengajuan(
  p_unit_id smallint, p_kategori text, p_deskripsi text, p_items jsonb, p_toko text,
  p_nominal numeric, p_nota text, p_nama text, p_nomor text, p_sumber text, p_kelompok text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
  v_saldo_c numeric;
  v_total_unit numeric;
  v_id integer;
begin
  select * into u from public.loonars2_v_unit where id = p_unit_id;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  v_total_unit := u.terpakai_konstruksi + u.komitmen_disetujui + p_nominal;
  insert into public.loonars2_material_requests (
    unit_id, kategori, deskripsi, items, toko, nominal, nota_url, diajukan_oleh, diajukan_oleh_nomor, sumber,
    pakai_buffer, melewati_buffer, saldo_c_kurang, unit_belum_terdanai, kelompok)
  values (
    p_unit_id, coalesce(p_kategori, 'material'), p_deskripsi, p_items, nullif(trim(p_toko), ''), p_nominal, p_nota, p_nama, p_nomor, p_sumber,
    v_total_unit > u.biaya_bangun,
    v_total_unit > u.biaya_bangun + u.buffer,
    v_saldo_c - public._loonars2_c_terikat() < p_nominal,
    not u.terdanai_penuh and not u.is_unit_contoh,
    p_kelompok)
  returning id into v_id;
  return v_id;
end;
$$;

-- Pengajuan tunggal (alur lama "L2 unit 5 semen ..."): sama seperti 0043,
-- kini memakai _loonars2_buat_pengajuan dan memperhitungkan utang toko.
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
  v_alasan text;
  v_id integer;
  m record;
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if p_unit_id is null then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Unit tidak ditemukan. Sebutkan nomor unit (1–17) atau kodenya, mis. BANYU-06.');
  end if;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Nominal pengajuan tidak terbaca. Tulis totalnya, mis. "total 1.850.000".');
  end if;
  v_alasan := public._loonars2_cek_unit_boleh(p_unit_id);
  if v_alasan is not null then
    return jsonb_build_object('status', 'ditolak', 'balasan', '❌ Pengajuan ditolak: ' || v_alasan);
  end if;
  v_id := public._loonars2_buat_pengajuan(p_unit_id, p_kategori, p_deskripsi, p_items, p_toko, p_nominal, p_nota, p_nama, p_nomor, p_sumber, null);
  select * into m from public.loonars2_material_requests where id = v_id;
  perform public._loonars2_kirim('owner', public._loonars2_teks_pengajuan(v_id), 'pengajuan', 'pengajuan:' || v_id, p_nota);
  return jsonb_build_object('status', 'diajukan', 'id', v_id, 'balasan',
    '✅ Pengajuan L2-' || v_id || ' diterima — ' || public._loonars2_label_unit(p_unit_id) || E'\nTotal: ' || public.loonars2_rp(p_nominal)
    || E'\nStatus: MENUNGGU PERSETUJUAN OWNER'
    || case when m.melewati_buffer then E'\n🔴 Melewati biaya bangun + buffer unit.'
            when m.pakai_buffer then E'\n🟠 Pakai buffer — butuh persetujuan khusus owner.' else '' end);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Utang toko
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_teks_utang_kelompok(p_kelompok text)
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
  v_toko text;
  v_buffer boolean := false;
  v_sisa numeric;
  v_status text;
begin
  for r in
    select ut.*, t.nama as nama_toko, vu.biaya_bangun, vu.buffer, vu.terpakai_konstruksi, vu.komitmen_disetujui
      from public.loonars2_utang_toko ut
      join public.loonars2_toko t on t.id = ut.toko_id
      join public.loonars2_v_unit vu on vu.id = ut.unit_id
     where ut.kelompok = p_kelompok order by ut.id
  loop
    if v_teks is null then
      v_toko := r.nama_toko;
      v_status := r.status;
      v_teks := '🧾 UTANG TOKO ' || p_kelompok || ' — ' || r.nama_toko
                || E'\nDari: ' || r.diajukan_oleh || ' · ' || to_char(r.tanggal, 'DD-MM-YYYY')
                || E'\nRincian: ' || left(r.deskripsi, 500);
    end if;
    v_total := v_total + r.nominal;
    v_buffer := v_buffer or r.pakai_buffer or r.melewati_buffer;
    v_teks := v_teks || E'\n• ' || public._loonars2_label_unit(r.unit_id) || ': ' || public.loonars2_rp(r.nominal)
              || ' — budget terpakai ' || public.loonars2_rp(r.terpakai_konstruksi + r.komitmen_disetujui
                   + case when r.status = 'disetujui' then 0 else r.nominal end)
              || ' / ' || public.loonars2_rp(r.biaya_bangun)
              || case when r.melewati_buffer then ' 🔴 melewati buffer' when r.pakai_buffer then ' 🟠 pakai buffer' else '' end
              || case when r.unit_belum_terdanai then ' ⚠️ unit belum terdanai penuh' else '' end;
  end loop;
  if v_teks is null then return null; end if;
  select sisa_utang into v_sisa from public.loonars2_v_toko where nama = v_toko;
  v_teks := v_teks || E'\nTotal: ' || public.loonars2_rp(v_total)
            || E'\nSisa utang ke ' || v_toko || ' (yang sudah disetujui): ' || public.loonars2_rp(v_sisa);
  if v_status = 'menunggu' then
    v_teks := v_teks || E'\n\nBalas "setujui ' || p_kelompok || case when v_buffer then ' buffer' else '' end
              || '" atau "tolak ' || p_kelompok || ' <alasan>".';
  end if;
  return v_teks;
end;
$$;

-- p_unit_ids: satu atau beberapa unit; nominal dibagi rata (rupiah bulat).
create or replace function public._loonars2_catat_utang(
  p_unit_ids smallint[], p_toko text, p_deskripsi text, p_items jsonb, p_nominal numeric,
  p_nota text, p_tanggal date, p_nama text, p_nomor text, p_sumber text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_toko_id smallint;
  v_kelompok text;
  v_bagian numeric[];
  v_alasan text;
  v_i integer;
  u record;
  v_total_unit numeric;
  v_n integer := coalesce(cardinality(p_unit_ids), 0);
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if v_n = 0 or array_position(p_unit_ids, null) is not null then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Unit tidak dikenali. Contoh: "L2 utang TB Maju unit 5 semen 50 sak 6.500.000".');
  end if;
  if p_nominal is null or p_nominal <= 0 or p_nominal <> round(p_nominal) then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Nominal utang tidak terbaca. Tulis totalnya, mis. "6.500.000".');
  end if;
  if length(trim(coalesce(p_toko, ''))) < 2 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Nama toko belum ada. Contoh: "L2 utang TB Maju unit 5 semen 50 sak 6.500.000".');
  end if;
  for v_i in 1..v_n loop
    v_alasan := public._loonars2_cek_unit_boleh(p_unit_ids[v_i]);
    if v_alasan is not null then
      return jsonb_build_object('status', 'ditolak', 'balasan', '❌ Utang tidak dicatat: ' || v_alasan);
    end if;
  end loop;

  v_toko_id := public._loonars2_cari_toko(p_toko, true);
  v_kelompok := public._loonars2_kode_baru('U');
  v_bagian := public._loonars2_bagi_rata(p_nominal, v_n);
  for v_i in 1..v_n loop
    select * into u from public.loonars2_v_unit where id = p_unit_ids[v_i];
    v_total_unit := u.terpakai_konstruksi + u.komitmen_disetujui + v_bagian[v_i];
    insert into public.loonars2_utang_toko (kelompok, toko_id, unit_id, deskripsi, items, nominal, tanggal, nota_url,
      diajukan_oleh, diajukan_oleh_nomor, sumber, pakai_buffer, melewati_buffer, unit_belum_terdanai)
    values (v_kelompok, v_toko_id, p_unit_ids[v_i], coalesce(nullif(trim(p_deskripsi), ''), '(tanpa rincian)'),
      case when v_i = 1 then p_items else null end, v_bagian[v_i],
      coalesce(p_tanggal, public._loonars2_hari_ini()), p_nota, p_nama, p_nomor, p_sumber,
      v_total_unit > u.biaya_bangun, v_total_unit > u.biaya_bangun + u.buffer,
      not u.terdanai_penuh and not u.is_unit_contoh);
  end loop;

  perform public._loonars2_kirim('owner', public._loonars2_teks_utang_kelompok(v_kelompok), 'utang', 'utang:' || v_kelompok, p_nota);
  return jsonb_build_object('status', 'diajukan', 'kode', v_kelompok, 'balasan',
    '✅ Utang ' || v_kelompok || ' dicatat — ' || (select nama from public.loonars2_toko where id = v_toko_id)
    || E'\nTotal: ' || public.loonars2_rp(p_nominal)
    || case when v_n > 1 then ' (dibagi rata ke ' || v_n || ' unit)' else '' end
    || E'\nStatus: MENUNGGU PERSETUJUAN OWNER. Setelah disetujui, nilainya langsung memotong budget bangun unit.'
    || E'\nCicilannya diajukan di pengajuan mingguan: "cicilan ' || (select nama from public.loonars2_toko where id = v_toko_id) || ' <nominal>".');
end;
$$;

create or replace function public._loonars2_teks_daftar_utang()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '🧾 UTANG TOKO LOONARS 2';
  v_n integer := 0;
  v_total numeric := 0;
begin
  for r in select * from public.loonars2_v_toko where sisa_utang <> 0 or utang_menunggu > 0 or cicilan_diproses > 0 order by sisa_utang desc, nama loop
    v_n := v_n + 1;
    v_total := v_total + r.sisa_utang;
    v_teks := v_teks || E'\n• ' || r.nama || ': sisa ' || public.loonars2_rp(r.sisa_utang)
              || ' (utang ' || public.loonars2_rp(r.utang_disetujui) || ', sudah dicicil ' || public.loonars2_rp(r.cicilan_dibayar) || ')'
              || case when r.utang_menunggu > 0 then E'\n   + ' || public.loonars2_rp(r.utang_menunggu) || ' utang baru menunggu persetujuan' else '' end
              || case when r.cicilan_diproses > 0 then E'\n   ' || public.loonars2_rp(r.cicilan_diproses) || ' cicilan sedang diajukan' else '' end;
  end loop;
  if v_n = 0 then return '🧾 Tidak ada utang toko yang tercatat.'; end if;
  return v_teks || E'\nTotal sisa utang: ' || public.loonars2_rp(v_total);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Pengajuan mingguan (beberapa baris, satu kode M-<n>)
-- ----------------------------------------------------------------------------
-- p_baris: [{"jenis":"cicilan","toko":"TB Maju","nominal":3000000},
--           {"jenis":"tukang"|"material"|"lain","unit":["5","6"],"deskripsi":"...","toko":"...","nominal":15000000}]
create or replace function public._loonars2_teks_kelompok(p_kelompok text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_teks text := '';
  v_total numeric := 0;
  v_n integer := 0;
  v_buffer boolean := false;
  v_menunggu boolean := false;
  v_dari text;
  v_saldo_c numeric;
  v_tertunda numeric := public._loonars2_total_tertunda();
begin
  for r in
    select c.id, c.nominal, c.status, c.diajukan_oleh, t.nama as nama_toko, vt.sisa_utang
      from public.loonars2_cicilan c join public.loonars2_toko t on t.id = c.toko_id
      join public.loonars2_v_toko vt on vt.id = c.toko_id
     where c.kelompok = p_kelompok order by c.id
  loop
    v_n := v_n + 1;
    v_dari := coalesce(v_dari, r.diajukan_oleh);
    v_total := v_total + r.nominal;
    v_menunggu := v_menunggu or r.status = 'menunggu';
    v_teks := v_teks || E'\n' || v_n || '. Cicilan utang ' || r.nama_toko || ': ' || public.loonars2_rp(r.nominal)
              || ' (sisa utang ' || public.loonars2_rp(r.sisa_utang) || ') [C-' || r.id || ', ' || r.status || ']'
              || case when r.nominal > r.sisa_utang then ' ⚠️ melebihi sisa utang yang disetujui' else '' end;
  end loop;
  for r in
    select m.*, vu.biaya_bangun, vu.buffer, vu.terpakai_konstruksi, vu.komitmen_disetujui
      from public.loonars2_material_requests m join public.loonars2_v_unit vu on vu.id = m.unit_id
     where m.kelompok = p_kelompok order by m.id
  loop
    v_n := v_n + 1;
    v_dari := coalesce(v_dari, r.diajukan_oleh);
    v_total := v_total + r.nominal;
    v_menunggu := v_menunggu or r.status = 'menunggu';
    v_buffer := v_buffer or ((r.pakai_buffer or r.melewati_buffer) and r.status = 'menunggu');
    v_teks := v_teks || E'\n' || v_n || '. ' || case r.kategori when 'tukang' then 'Kontraktor/tukang' when 'material' then 'Material' else 'Lain-lain' end
              || ' ' || public._loonars2_label_unit(r.unit_id) || ': ' || public.loonars2_rp(r.nominal)
              || E'\n   ' || left(r.deskripsi, 200) || coalesce(' — ' || r.toko, '')
              || E'\n   budget ' || public.loonars2_rp(r.terpakai_konstruksi + r.komitmen_disetujui + case when r.status = 'menunggu' then r.nominal else 0 end)
              || ' / ' || public.loonars2_rp(r.biaya_bangun) || ' [L2-' || r.id || ', ' || r.status || ']'
              || case when r.melewati_buffer then ' 🔴 melewati buffer' when r.pakai_buffer then ' 🟠 pakai buffer' else '' end
              || case when r.unit_belum_terdanai then ' ⚠️ unit belum terdanai penuh' else '' end;
  end loop;
  if v_n = 0 then return null; end if;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  v_teks := '📋 PENGAJUAN MINGGUAN ' || p_kelompok || coalesce(' — dari ' || v_dari, '') || v_teks
            || E'\n\nTotal: ' || public.loonars2_rp(v_total)
            || E'\nSaldo C: ' || public.loonars2_rp(v_saldo_c)
            || case when v_saldo_c < v_total then E'\n⚠️ Saldo C tidak cukup untuk seluruh pengajuan ini.' else '' end;
  if v_tertunda > 0 then
    v_teks := v_teks || E'\n⚠️ Masih ada ' || public.loonars2_rp(v_tertunda) || ' belum dipindahkan dari A.';
  end if;
  if v_menunggu then
    v_teks := v_teks || E'\n\nBalas "setujui ' || p_kelompok || case when v_buffer then ' buffer' else '' end
              || '" untuk menyetujui semua, atau putuskan per baris: "tolak L2-<n> <alasan>" / "tolak C-<n> <alasan>".';
  end if;
  return v_teks;
end;
$$;

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
begin
  perform public._loonars2_set_aktor(p_sumber || ':' || p_nama || coalesce(' (' || p_nomor || ')', ''), p_sumber);
  if p_baris is null or jsonb_typeof(p_baris) <> 'array' or jsonb_array_length(p_baris) = 0 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Pengajuan kosong. Tulis satu baris per pembayaran.');
  end if;
  if jsonb_array_length(p_baris) > 30 then
    return jsonb_build_object('status', 'ditolak', 'balasan', 'Maksimal 30 baris per pengajuan.');
  end if;

  -- Validasi semua baris dulu: satu baris salah = tidak ada yang dicatat.
  for v_baris in select * from jsonb_array_elements(p_baris) loop
    v_no := v_no + 1;
    v_jenis := coalesce(v_baris ->> 'jenis', 'material');
    v_nominal := nullif(v_baris ->> 'nominal', '')::numeric;
    if v_jenis not in ('cicilan', 'tukang', 'material', 'lain') then
      return jsonb_build_object('status', 'ditolak', 'balasan', 'Baris ' || v_no || ': jenis tidak dikenal.');
    end if;
    if v_nominal is null or v_nominal <= 0 or v_nominal <> round(v_nominal) then
      return jsonb_build_object('status', 'ditolak', 'balasan', 'Baris ' || v_no || ': nominal belum terbaca. Tulis nominal di setiap baris, mis. "3 juta" atau "3.000.000".');
    end if;
    if v_jenis = 'cicilan' then
      v_toko_id := public._loonars2_cari_toko(v_baris ->> 'toko', false);
      if v_toko_id is null then
        return jsonb_build_object('status', 'ditolak', 'balasan', 'Baris ' || v_no || ': toko "' || coalesce(v_baris ->> 'toko', '') || '" belum punya utang tercatat. Catat dulu utangnya: "L2 utang <toko> unit <n> <rincian> <nominal>".');
      end if;
    else
      if jsonb_typeof(v_baris -> 'unit') <> 'array' or jsonb_array_length(v_baris -> 'unit') = 0 then
        return jsonb_build_object('status', 'ditolak', 'balasan', 'Baris ' || v_no || ': unit belum disebut (mis. "unit 5" atau "unit 5,6").');
      end if;
      for v_unit in select jsonb_array_elements_text(v_baris -> 'unit') loop
        v_id := public._loonars2_cari_unit(v_unit);
        if v_id is null then
          return jsonb_build_object('status', 'ditolak', 'balasan', 'Baris ' || v_no || ': unit "' || v_unit || '" tidak dikenali.');
        end if;
        v_alasan := public._loonars2_cek_unit_boleh(v_id);
        if v_alasan is not null then
          return jsonb_build_object('status', 'ditolak', 'balasan', '❌ Baris ' || v_no || ': ' || v_alasan);
        end if;
      end loop;
    end if;
  end loop;

  v_kelompok := public._loonars2_kode_baru('M');
  for v_baris in select * from jsonb_array_elements(p_baris) loop
    v_jenis := coalesce(v_baris ->> 'jenis', 'material');
    v_nominal := (v_baris ->> 'nominal')::numeric;
    v_total := v_total + v_nominal;
    if v_jenis = 'cicilan' then
      insert into public.loonars2_cicilan (kelompok, toko_id, nominal, catatan, diajukan_oleh, diajukan_oleh_nomor, sumber)
      values (v_kelompok, public._loonars2_cari_toko(v_baris ->> 'toko', false), v_nominal, nullif(trim(v_baris ->> 'deskripsi'), ''), p_nama, p_nomor, p_sumber);
    else
      select array_agg(public._loonars2_cari_unit(x)) into v_unit_ids from jsonb_array_elements_text(v_baris -> 'unit') x;
      v_bagian := public._loonars2_bagi_rata(v_nominal, cardinality(v_unit_ids));
      for v_i in 1..cardinality(v_unit_ids) loop
        perform public._loonars2_buat_pengajuan(v_unit_ids[v_i], v_jenis,
          coalesce(nullif(trim(v_baris ->> 'deskripsi'), ''), '(tanpa rincian)')
            || case when cardinality(v_unit_ids) > 1 then ' (dibagi rata ' || cardinality(v_unit_ids) || ' unit)' else '' end,
          null, v_baris ->> 'toko', v_bagian[v_i], v_baris ->> 'nota_url', p_nama, p_nomor, p_sumber, v_kelompok);
      end loop;
    end if;
  end loop;

  perform public._loonars2_kirim('owner', public._loonars2_teks_kelompok(v_kelompok), 'pengajuan_mingguan', 'mingguan:' || v_kelompok);
  return jsonb_build_object('status', 'diajukan', 'kode', v_kelompok, 'balasan',
    '✅ Pengajuan ' || v_kelompok || ' diterima: ' || jsonb_array_length(p_baris) || ' baris, total ' || public.loonars2_rp(v_total)
    || E'\nStatus: MENUNGGU PERSETUJUAN OWNER. Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_kelompok || '".');
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Keputusan per kode: M-<n> (pengajuan mingguan), U-<n> (utang), C-<n> (cicilan)
-- ----------------------------------------------------------------------------
create or replace function public._loonars2_putuskan_kode(p_kode text, p_setuju boolean, p_alasan text, p_izin_buffer boolean, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text := upper(trim(coalesce(p_kode, '')));
  v_status text := case when p_setuju then 'disetujui' else 'ditolak' end;
  v_alasan text := case when p_setuju then null else nullif(trim(p_alasan), '') end;
  v_n integer := 0;
  v_m integer := 0;
  v_buffer integer := 0;
  v_dibayar numeric;
  r record;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);

  if v_kode ~ '^C-[0-9]+$' then
    select * into r from public.loonars2_cicilan where id = substr(v_kode, 3)::int for update;
    if not found then return 'Cicilan ' || v_kode || ' tidak ditemukan.'; end if;
    if r.status <> 'menunggu' then return 'Cicilan ' || v_kode || ' sudah ' || r.status || '.'; end if;
    update public.loonars2_cicilan set status = v_status, alasan_tolak = v_alasan, diputuskan_oleh = p_aktor, diputuskan_pada = now() where id = r.id;
    perform public._loonars2_kirim('pelaksana', case when p_setuju then '✅ ' else '❌ ' end || 'Cicilan ' || v_kode || ' (' || public.loonars2_rp(r.nominal) || ') '
      || upper(v_status) || ' owner.' || coalesce(E'\nAlasan: ' || v_alasan, ''), 'keputusan_pengajuan', 'keputusan:' || v_kode || ':' || v_status);
    return (case when p_setuju then '✅ ' else '❌ ' end) || 'Cicilan ' || v_kode || ' ' || v_status || '.';
  end if;

  if v_kode ~ '^U-[0-9]+$' then
    if p_setuju and not coalesce(p_izin_buffer, false)
       and exists (select 1 from public.loonars2_utang_toko where kelompok = v_kode and status = 'menunggu' and (pakai_buffer or melewati_buffer)) then
      return '⚠️ Utang ' || v_kode || ' membuat unit memakai buffer. Untuk menyetujui, balas "setujui ' || v_kode || ' buffer".';
    end if;
    update public.loonars2_utang_toko set status = v_status, alasan_tolak = v_alasan, diputuskan_oleh = p_aktor, diputuskan_pada = now()
     where kelompok = v_kode and status = 'menunggu';
    get diagnostics v_n = row_count;
    if v_n = 0 then return 'Utang ' || v_kode || ' tidak ditemukan atau sudah diputuskan.'; end if;
    perform public._loonars2_kirim('pelaksana', case when p_setuju then '✅ ' else '❌ ' end || 'Utang ' || v_kode || ' ' || upper(v_status) || ' owner.'
      || case when p_setuju then ' Nilainya sudah memotong budget bangun unit.' else '' end || coalesce(E'\nAlasan: ' || v_alasan, ''),
      'keputusan_pengajuan', 'keputusan:' || v_kode || ':' || v_status);
    return (case when p_setuju then '✅ ' else '❌ ' end) || 'Utang ' || v_kode || ' ' || v_status
           || case when p_setuju then '. Budget unit sudah terpotong; cicilannya masuk pengajuan mingguan.' else '. Pelaksana sudah diberi tahu.' end;
  end if;

  if v_kode ~ '^M-[0-9]+$' then
    if p_setuju and not coalesce(p_izin_buffer, false) then
      select count(*) into v_buffer from public.loonars2_material_requests
       where kelompok = v_kode and status = 'menunggu' and (pakai_buffer or melewati_buffer);
      if v_buffer > 0 then
        return '⚠️ ' || v_buffer || ' baris di ' || v_kode || ' memakai buffer. Balas "setujui ' || v_kode || ' buffer" untuk menyetujui semua, '
               || 'atau tolak baris itu dulu: "tolak L2-<n> <alasan>".';
      end if;
    end if;
    update public.loonars2_material_requests set status = v_status, alasan_tolak = v_alasan, diputuskan_oleh = p_aktor, diputuskan_pada = now()
     where kelompok = v_kode and status = 'menunggu';
    get diagnostics v_n = row_count;
    update public.loonars2_cicilan set status = v_status, alasan_tolak = v_alasan, diputuskan_oleh = p_aktor, diputuskan_pada = now()
     where kelompok = v_kode and status = 'menunggu';
    get diagnostics v_m = row_count;
    if v_n + v_m = 0 then return 'Pengajuan ' || v_kode || ' tidak ditemukan atau sudah diputuskan semua.'; end if;
    select coalesce(sum(nominal), 0) into v_dibayar from (
      select nominal from public.loonars2_material_requests where kelompok = v_kode and status = 'disetujui'
      union all select nominal from public.loonars2_cicilan where kelompok = v_kode and status = 'disetujui') x;
    perform public._loonars2_kirim('pelaksana', case when p_setuju
        then '✅ Pengajuan ' || v_kode || ' DISETUJUI owner (' || (v_n + v_m) || ' baris, ' || public.loonars2_rp(v_dibayar) || ' siap dibayar).'
             || E'\nSetelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_kode || '".'
        else '❌ Pengajuan ' || v_kode || ' DITOLAK owner.' || coalesce(E'\nAlasan: ' || v_alasan, '') end,
      'keputusan_pengajuan', 'keputusan:' || v_kode || ':' || v_status);
    return (case when p_setuju then '✅ ' else '❌ ' end) || v_kode || ': ' || (v_n + v_m) || ' baris ' || v_status || '.'
           || case when p_setuju then ' Total siap dibayar ' || public.loonars2_rp(v_dibayar) || '. Setelah transfer, kirim bukti "L2 bayar ' || v_kode || '".' else '' end;
  end if;

  return 'Kode ' || coalesce(p_kode, '?') || ' tidak dikenali. Pakai L2-<n>, M-<n>, U-<n>, atau C-<n>.';
end;
$$;

-- Bayar semua baris yang sudah disetujui dalam satu pengajuan mingguan.
create or replace function public._loonars2_bayar_kelompok(p_kelompok text, p_bukti text, p_aktor text, p_sumber text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text := upper(trim(coalesce(p_kelompok, '')));
  v_total numeric;
  v_saldo_c numeric;
  v_n integer := 0;
  r record;
begin
  perform public._loonars2_set_aktor(p_aktor, p_sumber);
  perform 1 from public.loonars2_settings where id = 1 for update;
  select coalesce(sum(nominal), 0), count(*) into v_total, v_n from (
    select nominal from public.loonars2_material_requests where kelompok = v_kode and status = 'disetujui'
    union all select nominal from public.loonars2_cicilan where kelompok = v_kode and status = 'disetujui') x;
  if v_n = 0 then
    return 'Tidak ada baris ' || v_kode || ' yang sudah disetujui dan belum dibayar.';
  end if;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  if v_saldo_c < v_total then
    return '❌ Saldo C (' || public.loonars2_rp(v_saldo_c) || ') tidak cukup untuk ' || v_kode || ' (' || public.loonars2_rp(v_total)
           || '). Konfirmasi dulu transfer dari A bila sudah dilakukan.';
  end if;
  for r in select * from public.loonars2_material_requests where kelompok = v_kode and status = 'disetujui' order by id loop
    perform public._loonars2_catat_pengeluaran('C',
      case r.kategori when 'material' then 'material' when 'tukang' then 'tukang' else 'lain_konstruksi' end,
      r.nominal, r.unit_id, r.id, r.toko, v_kode || ' / L2-' || r.id || ': ' || left(r.deskripsi, 200), p_bukti, null, p_aktor, p_sumber);
    update public.loonars2_material_requests set status = 'dibayar' where id = r.id;
  end loop;
  for r in select c.*, t.nama as nama_toko from public.loonars2_cicilan c join public.loonars2_toko t on t.id = c.toko_id
            where c.kelompok = v_kode and c.status = 'disetujui' order by c.id loop
    insert into public.loonars2_disbursements (dari_rekening, kategori, unit_id, nominal, penerima, keterangan, bukti_url, sumber, dicatat_oleh, toko_id, cicilan_id)
    values ('C', 'material', null, r.nominal, r.nama_toko, v_kode || ' / C-' || r.id || ': cicilan utang ' || r.nama_toko, p_bukti, p_sumber, p_aktor, r.toko_id, r.id);
    update public.loonars2_cicilan set status = 'dibayar' where id = r.id;
  end loop;
  perform public._loonars2_kirim('owner', '💸 ' || v_kode || ' dibayar ' || public.loonars2_rp(v_total) || ' dari C (' || v_n || ' baris). Dicatat oleh ' || p_aktor || '.',
    'pengajuan_dibayar', 'dibayar:' || v_kode, p_bukti);
  perform public._loonars2_kirim('pelaksana', '💸 ' || v_kode || ' tercatat dibayar ' || public.loonars2_rp(v_total) || '.', 'pengajuan_dibayar', 'dibayar:' || v_kode, null);
  return '✅ ' || v_kode || ' tercatat dibayar ' || public.loonars2_rp(v_total) || ' dari C (' || v_n || ' baris). Budget unit & sisa utang toko sudah diperbarui.';
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Laporan: saldo & kesehatan memperhitungkan utang toko
-- ----------------------------------------------------------------------------
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
  v_utang numeric;
begin
  select * into v_set from public.loonars2_settings where id = 1;
  if v_tertunda is not null then v_teks := v_tertunda || E'\n\n'; end if;
  v_teks := v_teks || '💰 SALDO LOONARS 2';
  for r in select * from public.loonars2_v_rekening order by kode loop
    v_teks := v_teks || E'\n' || r.kode || ' ' || r.nama || ': ' || public.loonars2_rp(r.saldo)
              || case when r.kode <> 'A' and r.menunggu_transfer > 0 then ' (+' || public.loonars2_rp(r.menunggu_transfer) || ' menunggu transfer)' else '' end;
  end loop;
  select coalesce(sum(sisa_utang), 0) into v_utang from public.loonars2_v_toko where sisa_utang > 0;
  if v_utang > 0 then
    v_teks := v_teks || E'\n🧾 Utang toko (dibayar dari C): ' || public.loonars2_rp(v_utang);
  end if;
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

-- Saldo C harus cukup untuk sisa kebutuhan C unit terjual. Cicilan utang
-- dibayar tanpa unit, jadi totalnya dikurangkan dari kebutuhan sisa (material
-- yang diambil secara utang lalu dicicil sudah tidak perlu dibiayai lagi).
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
  v_cicilan numeric;
begin
  select saldo, menunggu_transfer into v_saldo_c, v_menunggu_c from public.loonars2_v_rekening where kode = 'C';
  select coalesce(sum(greatest(kebutuhan_c - keluar_c, 0)), 0) into v_butuh
    from public.loonars2_v_unit where status in ('dp', 'lunas');
  select coalesce(sum(nominal), 0) into v_cicilan from public.loonars2_disbursements where cicilan_id is not null;
  v_butuh := greatest(v_butuh - v_cicilan, 0);
  return jsonb_build_object('saldo_c', v_saldo_c, 'menunggu_ke_c', v_menunggu_c, 'kebutuhan_sisa', v_butuh,
                            'kurang', greatest(v_butuh - v_saldo_c, 0));
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Pintu WA: aksi baru (utang, daftar_utang, ajukan_mingguan, putuskan_kode,
--    bayar_kelompok). Isi fungsi lengkap dinyatakan ulang (CREATE OR REPLACE).
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
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');

  if p_aksi in ('receipt', 'konfirmasi_transfer', 'tagihan', 'saldo', 'ubah_rekening', 'putuskan', 'putuskan_kode', 'cairkan_profit')
     and p_user.peran <> 'owner' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Perintah ini hanya untuk owner.');
  end if;
  if p_aksi in ('ajukan', 'utang', 'ajukan_mingguan') and p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_berhak', 'balasan', '⚠️ Pengajuan dan input utang dilakukan oleh pelaksana.');
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
    return public._loonars2_catat_utang(v_unit_ids, p_data ->> 'toko', p_data ->> 'deskripsi', p_data -> 'items',
      nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'nota_url', nullif(p_data ->> 'tanggal', '')::date, p_user.nama, p_user.nomor, 'wa');

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
-- 10. Pintu web: aksi untuk utang & pengajuan mingguan (isi lengkap)
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

  elsif p_aksi = 'putuskan_kode' then
    return jsonb_build_object('pesan', public._loonars2_putuskan_kode(p_data ->> 'kode', (p_data ->> 'setuju')::boolean,
             p_data ->> 'alasan', coalesce((p_data ->> 'buffer')::boolean, false), v_aktor, 'web'));

  elsif p_aksi = 'bayar_pengajuan' then
    return jsonb_build_object('pesan', public._loonars2_bayar_pengajuan((p_data ->> 'id')::int,
             nullif(p_data ->> 'nominal', '')::numeric, nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web'));

  elsif p_aksi = 'bayar_kelompok' then
    return jsonb_build_object('pesan', public._loonars2_bayar_kelompok(p_data ->> 'kode', nullif(p_data ->> 'bukti_url', ''), v_aktor, 'web'));

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
-- 11. Pengingat: + pengingat pengajuan mingguan ke pelaksana, + utang toko di
--     laporan mingguan owner (isi lengkap)
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
      || E'\n- kontraktor Pak Anang unit 5,6 15 juta'
      || E'\n- material unit 7 pasir 2 rit 1,6 juta TB Sinar',
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
-- 12. Hak eksekusi: semua fungsi internal tertutup untuk klien
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
revoke execute on function public.loonars2_web(text, jsonb) from public, anon;
grant execute on function public.loonars2_web(text, jsonb) to authenticated;
