-- ============================================================================
-- 0064 — Loonars 2: pengajuan DP dari pelaksana wajib menyebut total nilainya
-- ============================================================================
-- Permintaan owner (10 Nov 2026): "Jika Vando mengajukan DP, baiknya ditanyakan
-- DP dari total nilai berapa." Pemicu: M-100 "DP kaca" Rp 3.000.000 dan M-101
-- "DP sambungan pipa air panas" Rp 3.000.000 sampai ke owner tanpa keterangan
-- harga keseluruhannya, jadi owner tidak tahu sisa yang masih akan ditagih.
--
--  1. Baris pengajuan pelaksana (ajukan_mingguan / ajukan / bahan tunai) yang
--     rinciannya memuat DP / uang muka / panjar / persekot / down payment dan
--     belum membawa total (`total_dp`) DITAHAN, lalu pelaksana ditanya:
--     "DP ... Rp 3.000.000 — dari total nilai berapa?" Pola sama persis dengan
--     pertanyaan rekening (0056): disimpan di loonars2_wa_pending dengan kunci
--     `_perlu_total_dp`, kedaluwarsa 30 menit, belum ada yang dicatat.
--  2. Balasan (aksi `total_dp`, dibaca MK Connect: "total 10 juta", atau
--     bernomor "1. total 10 juta\n2. total 8 juta") melengkapi baris; total
--     harus lebih besar dari nilai DP. "L2 tanpa total" (aksi `tanpa_total_dp`)
--     melanjutkan tanpa total; owner melihat "total nilai belum disebut".
--  3. Total disimpan di teks rincian — " (DP dari total Rp X, sisa Rp Y)",
--     sebelum " | rek: …" — sehingga ikut tampil di baris "Item" pesan owner,
--     di dashboard, dan di audit. Tanpa kolom/tabel baru (sama dengan rekening).
--  4. Nominal yang dicatat tetap nilai DP; tidak ada perubahan perhitungan
--     budget, saldo, alokasi, atau pembayaran.
-- ============================================================================

create or replace function public._loonars2_kata_dp(p_teks text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_teks, '') ~* '(^|[^a-z0-9])(dp|d\.p\.?|uang\s+muka|panjar|persekot|down\s*payment)([^a-z0-9]|$)';
$$;

-- Tempel keterangan total DP ke rincian, sebelum bagian " | rek: …".
create or replace function public._loonars2_tempel_total_dp(p_dsk text, p_nominal numeric, p_total numeric)
returns text
language plpgsql
immutable
as $$
declare
  v_dsk text := coalesce(p_dsk, '');
  v_pos integer := position(' | rek:' in v_dsk);
  v_ket text;
begin
  if position('DP dari total' in v_dsk) > 0 or position('total nilai belum disebut' in v_dsk) > 0 then return v_dsk; end if;
  v_ket := case when p_total is null then ' (DP — total nilai belum disebut)'
                else ' (DP dari total ' || public.loonars2_rp(p_total)
                     || coalesce(', sisa ' || public.loonars2_rp(p_total - p_nominal), '') || ')' end;
  if v_pos = 0 then return btrim(v_dsk) || v_ket; end if;
  return btrim(substring(v_dsk from 1 for v_pos - 1)) || v_ket || substring(v_dsk from v_pos);
end;
$$;

create or replace function public._loonars2_isi_dan_cek_dp(p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb) - '_perlu_total_dp';
  v_tanpa boolean := coalesce(p_data ->> 'tanpa_total_dp', 'false') = 'true';
  v_out jsonb := '[]'::jsonb;
  v_kurang jsonb := '[]'::jsonb;
  b jsonb;
  v_no integer := 0;
  v_nominal numeric;
  v_total numeric;
  v_dsk text;
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(v_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      v_dsk := coalesce(b ->> 'deskripsi', '');
      v_nominal := nullif(b ->> 'nominal', '')::numeric;
      if coalesce(b ->> 'jenis', 'material') in ('retensi', 'cicilan') or v_nominal is null
         or not public._loonars2_kata_dp(public._loonars2_hapus_rekening(v_dsk)) then
        v_out := v_out || b;
        continue;
      end if;
      v_total := nullif(b ->> 'total_dp', '')::numeric;
      if v_total is not null and v_total > v_nominal then
        b := b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, v_total));
      elsif v_tanpa then
        b := b || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, null));
      else
        v_kurang := v_kurang || jsonb_build_object('no', v_no, 'nama', left(public._loonars2_hapus_rekening(v_dsk), 80), 'nominal', v_nominal);
      end if;
      v_out := v_out || b;
    end loop;
    v_data := jsonb_set(v_data, '{baris}', v_out);
  else
    v_dsk := coalesce(v_data ->> 'deskripsi', '');
    v_nominal := nullif(v_data ->> 'nominal', '')::numeric;
    if v_nominal is not null and public._loonars2_kata_dp(public._loonars2_hapus_rekening(v_dsk)) then
      v_total := nullif(v_data ->> 'total_dp', '')::numeric;
      if v_total is not null and v_total > v_nominal then
        v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, v_total));
      elsif v_tanpa then
        v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_tempel_total_dp(v_dsk, v_nominal, null));
      else
        v_kurang := jsonb_build_array(jsonb_build_object('no', 1, 'nama', left(public._loonars2_hapus_rekening(v_dsk), 80), 'nominal', v_nominal));
      end if;
    end if;
  end if;
  return jsonb_build_object('data', v_data, 'kurang', v_kurang);
end;
$$;

create or replace function public._loonars2_teks_minta_total_dp(p_kurang jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  k jsonb;
  v_teks text := '';
begin
  for k in select * from jsonb_array_elements(p_kurang) loop
    v_teks := v_teks || E'\n' || (k ->> 'no') || '. ' || coalesce(nullif(k ->> 'nama', ''), '(tanpa rincian)')
              || coalesce(' — ' || public.loonars2_rp((k ->> 'nominal')::numeric), '');
  end loop;
  return '🧮 DP ini dari total nilai berapa?' || v_teks
    || E'\n\nBalas dengan total harganya, mis. '
    || case when jsonb_array_length(p_kurang) > 1 then E'\n1. total 10 juta\n2. total 8.500.000'
            else '"total 10 juta"' end
    || E'\n\nPengajuan saya teruskan ke Pak Avi setelah totalnya ada, supaya sisa yang masih akan ditagih kelihatan. Belum tahu totalnya? Balas "L2 tanpa total".';
end;
$$;

create or replace function public._loonars2_wa_total_dp(p_user public.loonars2_wa_users, p_data jsonb, p_tanpa boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend public.loonars2_wa_pending;
  v_kurang jsonb;
  v_awal integer;
  v_data jsonb;
  it jsonb;
  v_no integer;
  v_total numeric;
  v_nominal numeric;
  v_kecil text := '';
begin
  if p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  select * into v_pend from public.loonars2_wa_pending
   where nomor = p_user.nomor and kedaluwarsa_pada > now() and data ? '_perlu_total_dp';
  if not found then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  v_data := v_pend.data;
  v_kurang := v_pend.data -> '_perlu_total_dp';
  v_awal := jsonb_array_length(v_kurang);

  if p_tanpa then
    update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
    return public._loonars2_wa_jalankan(p_user, v_pend.aksi, (v_data - '_perlu_total_dp') || '{"tanpa_total_dp":true}'::jsonb, false);
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_data -> 'daftar', '[]'::jsonb)) loop
    v_total := nullif(it ->> 'total', '')::numeric;
    continue when v_total is null or v_total <= 0;
    v_no := coalesce(nullif(it ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
    select (x ->> 'nominal')::numeric into v_nominal from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no;
    continue when not found;
    if v_total <= v_nominal then
      v_kecil := v_kecil || E'\n• ' || v_no || ': total ' || public.loonars2_rp(v_total) || ' tidak lebih besar dari DP ' || public.loonars2_rp(v_nominal);
      continue;
    end if;
    if v_pend.aksi = 'ajukan_mingguan' then
      v_data := jsonb_set(v_data, array['baris', (v_no - 1)::text, 'total_dp'], to_jsonb(v_total));
    else
      v_data := v_data || jsonb_build_object('total_dp', v_total);
    end if;
    v_kurang := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer <> v_no), '[]'::jsonb);
  end loop;

  if jsonb_array_length(v_kurang) = v_awal then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      case when v_kecil <> '' then '⚠️ Total harus lebih besar dari nilai DP:' || v_kecil
           else '🧮 Total belum terbaca. Tulis total harganya, mis. "total 10 juta".' end
      || E'\n\n' || public._loonars2_teks_minta_total_dp(v_kurang));
  end if;
  if jsonb_array_length(v_kurang) > 0 then
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_total_dp', v_kurang), kedaluwarsa_pada = now() + interval '30 minutes'
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_total_dp', 'balasan', '✅ Total dicatat.' || E'\n\n' || public._loonars2_teks_minta_total_dp(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_total_dp', false);
end;
$$;

revoke execute on function public._loonars2_kata_dp(text) from public, anon, authenticated;
revoke execute on function public._loonars2_tempel_total_dp(text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public._loonars2_isi_dan_cek_dp(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_minta_total_dp(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_total_dp(public.loonars2_wa_users, jsonb, boolean) from public, anon, authenticated;

-- Sambungan di pintu WA: setelah rekening lengkap, cek total DP; aksi balasan baru.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, E'declare\n  v_rekcek jsonb;\n', E'declare\n  v_rekcek jsonb;\n  v_dpcek jsonb;\n');
  v_new := replace(v_new,
    E'  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.\n',
    $q$  -- Pelaksana mengajukan DP: total nilai keseluruhan wajib disebut (atau ditanyakan), supaya owner tahu sisanya.
  if p_user.peran = 'pelaksana'
     and (p_aksi in ('ajukan_mingguan', 'ajukan') or (p_aksi = 'bahan' and coalesce(p_data ->> 'utang', 'false') <> 'true')) then
    v_dpcek := public._loonars2_isi_dan_cek_dp(p_aksi, p_data);
    p_data := v_dpcek -> 'data';
    if jsonb_array_length(v_dpcek -> 'kurang') > 0 then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, p_data || jsonb_build_object('_perlu_total_dp', v_dpcek -> 'kurang'))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_total_dp', 'balasan', public._loonars2_teks_minta_total_dp(v_dpcek -> 'kurang'));
    end if;
  end if;

  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.
$q$);
  v_new := replace(v_new, E'  elsif p_aksi = \'daftar_borongan\' then\n',
    E'  elsif p_aksi = \'total_dp\' then\n    return public._loonars2_wa_total_dp(p_user, p_data, false);\n\n  elsif p_aksi = \'tanpa_total_dp\' then\n    return public._loonars2_wa_total_dp(p_user, p_data, true);\n\n  elsif p_aksi = \'daftar_borongan\' then\n');
  if v_new = v_def or position('v_dpcek jsonb' in v_new) = 0 or position('_loonars2_isi_dan_cek_dp' in v_new) = 0
     or position('_loonars2_wa_total_dp(p_user, p_data, true)' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal (0064)';
  end if;
  execute v_new;
end;
$$;
