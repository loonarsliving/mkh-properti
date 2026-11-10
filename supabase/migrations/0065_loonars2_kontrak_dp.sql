-- ============================================================================
-- 0065 — Loonars 2: total DP disimpan sebagai kontrak (tabel loonars2_kontrak_dp)
-- ============================================================================
-- Permintaan owner (10 Nov 2026), lanjutan 0064: "Setelah dia menyebutkan
-- totalnya, harusnya database menyimpan totalnya agar tidak ada kesalahan
-- pembayaran nantinya."
--
--  1. Tabel baru `loonars2_kontrak_dp` (kode D-n): item, penerima/rekening,
--     total nilai, siapa yang mengajukan. Kolom baru
--     `loonars2_material_requests.kontrak_dp_id` menautkan setiap pembayaran
--     (DP pertama, DP kedua, pelunasan/termin) ke kontraknya.
--  2. View `loonars2_v_kontrak_dp`: total, sudah dibayar, sudah disetujui,
--     menunggu, sisa (= total − semua pembayaran yang tidak ditolak), status.
--  3. Pembayaran lanjutan pelaksana — baris yang memuat DP/pelunasan/lunas/
--     sisa/termin/tahap dan menyebut kode "D-n" atau item yang sama dengan
--     tepat satu kontrak yang masih ada sisanya — otomatis ditautkan, TIDAK
--     ditanya total lagi, dan ditandai "melebihi sisa" bila nominalnya lebih
--     besar dari sisa kontrak.
--  4. Pesan owner (M-n dan L2-n) memuat baris kontrak: total, sudah dibayar,
--     menunggu, sisa setelah pengajuan ini; 🔴 bila melebihi total.
--  5. Tautan dibuat oleh trigger BEFORE INSERT dari penanda yang ditulis
--     fungsi 0064/0065 di rincian ("(DP dari total Rp …" / "[lanjutan D-n"),
--     jadi fungsi pengajuan yang besar tidak perlu ditulis ulang. Baris yang
--     sudah ada dengan penanda 0064 ditautkan (backfill).
--
-- Tidak mengubah nominal, budget unit, saldo rekening, alokasi, atau alur
-- persetujuan/pembayaran. Owner tetap yang memutuskan.
-- ============================================================================

create table public.loonars2_kontrak_dp (
  id integer generated always as identity primary key,
  kode text generated always as ('D-' || id) stored unique,
  item text not null check (length(item) between 1 and 300),
  penerima text,
  total numeric not null check (total > 0 and total = round(total)),
  kelompok_awal text,
  diajukan_oleh text,
  dibuat_pada timestamptz not null default now()
);
create index loonars2_kontrak_dp_kelompok_idx on public.loonars2_kontrak_dp (kelompok_awal);

alter table public.loonars2_material_requests
  add column kontrak_dp_id integer references public.loonars2_kontrak_dp(id) on delete restrict;
create index loonars2_material_requests_kontrak_dp_idx on public.loonars2_material_requests (kontrak_dp_id);

alter table public.loonars2_kontrak_dp enable row level security;
revoke all on public.loonars2_kontrak_dp from anon, authenticated;
grant select on public.loonars2_kontrak_dp to authenticated;
create policy cfo_baca on public.loonars2_kontrak_dp for select to authenticated using ((select public.mkh_is_cfo()));
create trigger loonars2_kontrak_dp_audit after insert or update or delete on public.loonars2_kontrak_dp
  for each row execute function public.loonars2_audit('id');

create view public.loonars2_v_kontrak_dp with (security_invoker = true) as
select
  k.id, k.kode, k.item, k.penerima, k.total, k.kelompok_awal, k.diajukan_oleh, k.dibuat_pada,
  coalesce(sum(m.nominal) filter (where m.status = 'dibayar'), 0) as dibayar,
  coalesce(sum(m.nominal) filter (where m.status = 'disetujui'), 0) as disetujui,
  coalesce(sum(m.nominal) filter (where m.status = 'menunggu'), 0) as menunggu,
  k.total - coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) as sisa,
  case
    when coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) = 0 then 'batal'
    when k.total - coalesce(sum(m.nominal) filter (where m.status <> 'ditolak'), 0) < 0 then 'melebihi'
    when coalesce(sum(m.nominal) filter (where m.status = 'dibayar'), 0) >= k.total then 'lunas'
    else 'berjalan'
  end as status
from public.loonars2_kontrak_dp k
left join public.loonars2_material_requests m on m.kontrak_dp_id = k.id
group by k.id;
revoke all on public.loonars2_v_kontrak_dp from anon;
grant select on public.loonars2_v_kontrak_dp to authenticated;

-- 1. Pengenal & pencocok ----------------------------------------------------------
create or replace function public._loonars2_kata_lanjutan(p_teks text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_teks, '') ~* '(^|[^a-z0-9])(pelunasan|pelunasannya|lunas|lunasi|sisa|sisanya|termin|tahap)([^a-z0-9]|$)';
$$;

-- Kunci item untuk mencocokkan pembayaran lanjutan: "DP kaca" ~ "pelunasan kaca".
create or replace function public._loonars2_kunci_dp(p_teks text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(
           regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', '')),
           '\(dp[^)]*\)|\[lanjutan[^\]]*\]', ' ', 'g'),
           '\m(dp|d\.p|uang|muka|panjar|persekot|down|payment|pelunasan|pelunasannya|lunas|lunasi|sisa|sisanya|termin|tahap|ke|kedua|ketiga|keempat|ii|iii|bayar|pembayaran|belanja|untuk|dari|total|harga|nilai|rp|juta|jt|ribu|rb)\M', ' ', 'g'),
           '[0-9.,/()&:;\-%]', ' ', 'g'),
           '\m[a-z]\M', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function public._loonars2_cari_kontrak_dp(p_teks text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kode text := substring(coalesce(p_teks, '') from '(?i)\m(D-\d+)\M');
  v_kunci text := public._loonars2_kunci_dp(p_teks);
  v_id integer;
  v_n integer;
begin
  if v_kode is not null then
    select id into v_id from public.loonars2_kontrak_dp where kode = upper(v_kode);
    if found then return v_id; end if;
  end if;
  if v_kunci = '' then return null; end if;
  select count(*), min(k.id) into v_n, v_id
    from public.loonars2_v_kontrak_dp k
   where k.status in ('berjalan') and k.sisa > 0
     and public._loonars2_kunci_dp(k.item) <> ''
     and (public._loonars2_kunci_dp(k.item) = v_kunci
          or (' ' || v_kunci || ' ') like ('% ' || public._loonars2_kunci_dp(k.item) || ' %')
          or (' ' || public._loonars2_kunci_dp(k.item) || ' ') like ('% ' || v_kunci || ' %'));
  return case when v_n = 1 then v_id end;
end;
$$;

create or replace function public._loonars2_tempel_lanjutan_dp(p_dsk text, p_kontrak integer, p_nominal numeric)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k record;
  v_dsk text := coalesce(p_dsk, '');
  v_pos integer := position(' | rek:' in v_dsk);
  v_ket text;
begin
  select * into k from public.loonars2_v_kontrak_dp where id = p_kontrak;
  if not found or position('[lanjutan D-' in v_dsk) > 0 then return v_dsk; end if;
  v_ket := ' [lanjutan ' || k.kode || ', sisa sebelum ini ' || public.loonars2_rp(k.sisa)
           || case when p_nominal > k.sisa then ' ⚠️ MELEBIHI SISA' else '' end || ']';
  if v_pos = 0 then return btrim(v_dsk) || v_ket; end if;
  return btrim(substring(v_dsk from 1 for v_pos - 1)) || v_ket || substring(v_dsk from v_pos);
end;
$$;

-- 2. Cek DP (menggantikan versi 0064): pembayaran lanjutan dikenali lebih dulu ------
create or replace function public._loonars2_isi_dan_cek_dp(p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb) - '_perlu_total_dp';
  v_tanpa boolean := coalesce(p_data ->> 'tanpa_total_dp', 'false') = 'true';
  v_out jsonb := '[]'::jsonb;
  v_kurang jsonb := '[]'::jsonb;
  b jsonb;
  v_no integer := 0;
  v_hasil jsonb;
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(v_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      if coalesce(b ->> 'jenis', 'material') in ('retensi', 'cicilan') then
        v_out := v_out || b;
        continue;
      end if;
      v_hasil := public._loonars2_cek_satu_dp(b, v_tanpa);
      if v_hasil ? 'kurang' then
        v_kurang := v_kurang || ((v_hasil -> 'kurang') || jsonb_build_object('no', v_no));
      end if;
      v_out := v_out || (v_hasil -> 'baris');
    end loop;
    v_data := jsonb_set(v_data, '{baris}', v_out);
  else
    v_hasil := public._loonars2_cek_satu_dp(v_data, v_tanpa);
    if v_hasil ? 'kurang' then
      v_kurang := jsonb_build_array((v_hasil -> 'kurang') || jsonb_build_object('no', 1));
    end if;
    v_data := v_hasil -> 'baris';
  end if;
  return jsonb_build_object('data', v_data, 'kurang', v_kurang);
end;
$$;

-- Satu baris/pengajuan: {baris: <baris dilengkapi>} atau {baris, kurang: {nama, nominal}}.
create or replace function public._loonars2_cek_satu_dp(p_baris jsonb, p_tanpa boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b jsonb := p_baris;
  v_dsk text := coalesce(p_baris ->> 'deskripsi', '');
  v_bersih text := public._loonars2_hapus_rekening(coalesce(p_baris ->> 'deskripsi', ''));
  v_nominal numeric := nullif(p_baris ->> 'nominal', '')::numeric;
  v_total numeric := nullif(p_baris ->> 'total_dp', '')::numeric;
  v_kontrak integer;
begin
  if v_nominal is null or position('(DP dari total' in v_dsk) > 0 or position('total nilai belum disebut' in v_dsk) > 0
     or position('[lanjutan D-' in v_dsk) > 0 then
    return jsonb_build_object('baris', b);
  end if;
  -- Pembayaran lanjutan dari kontrak yang sudah ada (DP kedua, pelunasan, termin, "D-n")
  if (public._loonars2_kata_dp(v_bersih) and v_total is null) or public._loonars2_kata_lanjutan(v_bersih)
     or v_bersih ~* '\mD-\d+\M' then
    v_kontrak := public._loonars2_cari_kontrak_dp(v_bersih);
    if v_kontrak is not null then
      return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_lanjutan_dp(v_dsk, v_kontrak, v_nominal)));
    end if;
  end if;
  if not public._loonars2_kata_dp(v_bersih) then
    return jsonb_build_object('baris', b);
  end if;
  if v_total is not null and v_total > v_nominal then
    return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, v_total)));
  elsif p_tanpa then
    return jsonb_build_object('baris', b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, null)));
  end if;
  return jsonb_build_object('baris', b, 'kurang', jsonb_build_object('nama', left(v_bersih, 80), 'nominal', v_nominal));
end;
$$;

-- 3. Trigger: tautkan pengajuan ke kontrak dari penanda di rincian ---------------------
create or replace function public.loonars2_tautkan_kontrak_dp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kode text;
  v_total numeric;
  v_item text;
  v_id integer;
begin
  if new.kontrak_dp_id is not null then return new; end if;
  v_kode := substring(new.deskripsi from '\[lanjutan (D-\d+)');
  if v_kode is not null then
    select id into new.kontrak_dp_id from public.loonars2_kontrak_dp where kode = v_kode;
    return new;
  end if;
  v_total := replace(substring(new.deskripsi from '\(DP dari total Rp ([0-9.]+)'), '.', '')::numeric;
  if v_total is null then return new; end if;
  if new.kelompok is not null then
    select id into v_id from public.loonars2_kontrak_dp where kelompok_awal = new.kelompok order by id limit 1;
  end if;
  if v_id is null then
    v_item := btrim(regexp_replace(regexp_replace(public._loonars2_hapus_rekening(new.deskripsi), '\s*\(DP dari total[^)]*\)', ''),
                    '\s+—\s+bahan kolektif, bagian unit ini.*$', ''));
    insert into public.loonars2_kontrak_dp (item, penerima, total, kelompok_awal, diajukan_oleh)
    values (left(coalesce(nullif(v_item, ''), 'DP'), 300),
            coalesce(public._loonars2_ekstrak_rekening(new.deskripsi), new.toko),
            v_total, new.kelompok, new.diajukan_oleh)
    returning id into v_id;
  end if;
  new.kontrak_dp_id := v_id;
  return new;
end;
$$;

create trigger loonars2_material_requests_kontrak_dp before insert on public.loonars2_material_requests
  for each row execute function public.loonars2_tautkan_kontrak_dp();

-- Backfill baris yang sudah memuat penanda 0064.
do $$
declare
  r record;
  v_id integer;
  v_item text;
begin
  for r in select * from public.loonars2_material_requests
            where kontrak_dp_id is null and deskripsi like '%(DP dari total Rp %' order by id loop
    v_id := null;
    if r.kelompok is not null then
      select id into v_id from public.loonars2_kontrak_dp where kelompok_awal = r.kelompok order by id limit 1;
    end if;
    if v_id is null then
      v_item := btrim(regexp_replace(regexp_replace(public._loonars2_hapus_rekening(r.deskripsi), '\s*\(DP dari total[^)]*\)', ''),
                      '\s+—\s+bahan kolektif, bagian unit ini.*$', ''));
      insert into public.loonars2_kontrak_dp (item, penerima, total, kelompok_awal, diajukan_oleh, dibuat_pada)
      values (left(coalesce(nullif(v_item, ''), 'DP'), 300), coalesce(public._loonars2_ekstrak_rekening(r.deskripsi), r.toko),
              replace(substring(r.deskripsi from '\(DP dari total Rp ([0-9.]+)'), '.', '')::numeric, r.kelompok, r.diajukan_oleh, r.dibuat_pada)
      returning id into v_id;
    end if;
    update public.loonars2_material_requests set kontrak_dp_id = v_id where id = r.id;
  end loop;
end;
$$;

-- 4. Baris kontrak di pesan owner --------------------------------------------------------
create or replace function public._loonars2_teks_kontrak_dp(p_kelompok text, p_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k record;
  v_ini numeric;
  v_teks text := '';
begin
  for k in
    select distinct v.* from public.loonars2_v_kontrak_dp v
      join public.loonars2_material_requests m on m.kontrak_dp_id = v.id
     where (p_kelompok is not null and m.kelompok = p_kelompok) or (p_id is not null and m.id = p_id)
     order by v.id
  loop
    select coalesce(sum(nominal), 0) into v_ini from public.loonars2_material_requests
     where kontrak_dp_id = k.id and ((p_kelompok is not null and kelompok = p_kelompok) or (p_id is not null and id = p_id));
    v_teks := v_teks || E'\n📑 Kontrak ' || k.kode || ' (' || left(k.item, 60) || '): total ' || public.loonars2_rp(k.total)
      || E'\n   Sudah dibayar ' || public.loonars2_rp(k.dibayar)
      || case when k.disetujui > 0 then ' · disetujui ' || public.loonars2_rp(k.disetujui) else '' end
      || ' · pengajuan ini ' || public.loonars2_rp(v_ini)
      || case when k.menunggu - v_ini > 0 then ' · menunggu lain ' || public.loonars2_rp(k.menunggu - v_ini) else '' end
      || E'\n   Sisa setelah ini: ' || public.loonars2_rp(k.sisa)
      || case when k.sisa < 0 then E'\n🔴 Melebihi total kontrak ' || public.loonars2_rp(-k.sisa) || ' — periksa sebelum transfer.' else '' end;
  end loop;
  return nullif(v_teks, '');
end;
$$;

revoke execute on function public._loonars2_kata_lanjutan(text) from public, anon, authenticated;
revoke execute on function public._loonars2_kunci_dp(text) from public, anon, authenticated;
revoke execute on function public._loonars2_cari_kontrak_dp(text) from public, anon, authenticated;
revoke execute on function public._loonars2_tempel_lanjutan_dp(text, integer, numeric) from public, anon, authenticated;
revoke execute on function public._loonars2_isi_dan_cek_dp(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_cek_satu_dp(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.loonars2_tautkan_kontrak_dp() from public, anon, authenticated;
revoke execute on function public._loonars2_teks_kontrak_dp(text, integer) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_teks_kelompok(text)'::regprocedure);
  v_new := replace(v_def, E'  if v_tertunda > 0 then\n',
    E'  v_teks := v_teks || coalesce(public._loonars2_teks_kontrak_dp(p_kelompok, null), \'\');\n  if v_tertunda > 0 then\n');
  if v_new = v_def then raise exception 'penggantian _loonars2_teks_kelompok gagal (0065)'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public._loonars2_teks_pengajuan(integer)'::regprocedure);
  v_new := replace(v_def, E'  if v_tertunda > 0 then\n',
    E'  v_teks := v_teks || coalesce(public._loonars2_teks_kontrak_dp(null, p_id), \'\');\n  if v_tertunda > 0 then\n');
  if v_new = v_def then raise exception 'penggantian _loonars2_teks_pengajuan gagal (0065)'; end if;
  execute v_new;
end;
$$;
