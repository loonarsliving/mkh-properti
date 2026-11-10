-- ============================================================================
-- 0071 — Loonars 2: rincian yang terlalu umum ditanyakan ("belanja material" → barang apa?)
-- ============================================================================
-- Permintaan owner (10 Nov 2026), melihat M-102 "Belanja: belanja material
-- Rp 225.000": "Berikutnya perjelas ke Vando ini item apa." Dalam 60 hari ada
-- rincian "belanja material" ×2 dan "Belanja Bahan bangunan" ×2.
--
--  1. `_loonars2_rincian_umum(teks)`: true bila rincian (tanpa rekening, catatan
--     sistem dalam kurung, angka) hanya berisi kata umum — belanja, material,
--     bahan, bangunan, pembelian, barang, kebutuhan, proyek, lain-lain, biaya,
--     pembayaran, dll.
--  2. Di pintu WA pelaksana (setelah cek total DP, sebelum cek nota): baris
--     material/lain dengan rincian umum DITAHAN dan pelaksana ditanya barang apa
--     saja (pending `_perlu_rincian`, pola sama dengan rekening/nota). Balasan
--     "L2 rincian semen 5 sak, paku 2 kg" (aksi `rincian`, {no?, isi}) mengganti
--     rincian baris itu; rincian yang masih umum ditanya ulang.
--  3. `loonars2_minta_rincian(text[])` (internal): menanyakan rincian kode yang
--     sudah terlanjur masuk (pending `lengkapi_rincian`, 24 jam). Jawabannya
--     memperbarui rincian semua baris kode itu (dan pesanan bahannya) lalu
--     mengabari owner.
-- Tanpa tabel/kolom baru. Nominal, budget, saldo, persetujuan tidak berubah.
-- ============================================================================

create or replace function public._loonars2_rincian_umum(p_teks text)
returns boolean
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(
           regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', '')),
           '\([^)]*\)|\[[^\]]*\]|\s+—\s+bahan kolektif.*$', ' ', 'g'),
           '\m(belanja|belanjaan|material|materials|matrial|bahan|bahan2|bangunan|pembelian|beli|barang|barang2|kebutuhan|keperluan|proyek|project|lain|lainnya|biaya|pembayaran|bayar|bon|nota|dll|dan|untuk|unit|minggu|ini|l2|pengajuan|rp|jt|juta|rb|ribu|kecil|harian|operasional|ops)\M', ' ', 'g'),
           '[0-9.,/()&:;\-%+]', ' ', 'g'),
           '\s+', ' ', 'g')) = '';
$$;

create or replace function public._loonars2_cek_rincian(p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_kurang jsonb := '[]'::jsonb;
  b jsonb;
  v_no integer := 0;
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(p_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      if coalesce(b ->> 'jenis', 'material') in ('material', 'lain') and public._loonars2_rincian_umum(b ->> 'deskripsi') then
        v_kurang := v_kurang || jsonb_build_object('no', v_no, 'nama', left(public._loonars2_hapus_rekening(b ->> 'deskripsi'), 60), 'nominal', nullif(b ->> 'nominal', '')::numeric);
      end if;
    end loop;
  elsif coalesce(p_data ->> 'kategori', 'material') in ('material', 'lain')
        and coalesce(jsonb_array_length(case when jsonb_typeof(p_data -> 'items') = 'array' then p_data -> 'items' end), 0) = 0
        and public._loonars2_rincian_umum(p_data ->> 'deskripsi') then
    v_kurang := jsonb_build_array(jsonb_build_object('no', 1, 'nama', left(public._loonars2_hapus_rekening(p_data ->> 'deskripsi'), 60), 'nominal', nullif(p_data ->> 'nominal', '')::numeric));
  end if;
  return v_kurang;
end;
$$;

create or replace function public._loonars2_teks_minta_rincian(p_kurang jsonb)
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
  return '🧾 Barang apa saja yang dibeli?' || v_teks
    || E'\n\nBalas dengan rinciannya, mis. "L2 rincian semen 5 sak, paku 2 kg, kuas"'
    || case when jsonb_array_length(p_kurang) > 1 then ' (sebut nomornya: "L2 rincian 2 semen 5 sak")' else '' end
    || E'.\nSaya perlu tahu barangnya supaya pengeluaran bisa diperiksa dan dicatat ke pos yang benar.';
end;
$$;

-- Ganti teks rincian (bagian sebelum " | rek: …"), simpan tulisan awal di belakang.
create or replace function public._loonars2_ganti_rincian(p_dsk text, p_isi text)
returns text
language plpgsql
immutable
as $$
declare
  v_dsk text := coalesce(p_dsk, '');
  v_pos integer := position(' | rek:' in v_dsk);
  v_baru text := btrim(p_isi) || ' (awal: ' || btrim(case when v_pos = 0 then v_dsk else substring(v_dsk from 1 for v_pos - 1) end) || ')';
begin
  if v_pos = 0 then return left(v_baru, 1900); end if;
  return left(v_baru, 1900 - (length(v_dsk) - v_pos + 1)) || substring(v_dsk from v_pos);
end;
$$;

create or replace function public._loonars2_lengkapi_rincian(p_kode text, p_isi text, p_nama text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_total numeric;
begin
  update public.loonars2_material_requests
     set deskripsi = public._loonars2_ganti_rincian(deskripsi, p_isi)
   where kelompok = p_kode and status <> 'ditolak' and position('(awal: ' in deskripsi) = 0;
  get diagnostics v_n = row_count;
  if v_n = 0 then return null; end if;
  update public.loonars2_pesanan_bahan
     set deskripsi = public._loonars2_ganti_rincian(deskripsi, p_isi)
   where kelompok = p_kode and position('(awal: ' in deskripsi) = 0;
  select sum(nominal) into v_total from public.loonars2_material_requests where kelompok = p_kode and status <> 'ditolak';
  perform public._loonars2_kirim('owner', '🧾 ' || coalesce(p_nama, 'Pelaksana') || ' memperjelas ' || p_kode || ' (' || public.loonars2_rp(v_total) || '): ' || left(btrim(p_isi), 300), 'rincian_susulan');
  return p_kode || ': ' || left(btrim(p_isi), 200);
end;
$$;

create or replace function public.loonars2_minta_rincian(p_kodes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_kurang jsonb := '[]'::jsonb;
  v_nomor text;
  v_no integer := 0;
begin
  for r in
    select m.kelompok, sum(m.nominal) as nominal, max(m.diajukan_oleh_nomor) as nomor,
           regexp_replace(public._loonars2_hapus_rekening(min(m.deskripsi)), '\s+—\s+bahan kolektif.*$', '') as nama
      from public.loonars2_material_requests m
     where m.kelompok = any(p_kodes) and m.status <> 'ditolak'
     group by m.kelompok order by min(m.id)
  loop
    if v_nomor is not null and r.nomor is distinct from v_nomor then
      raise exception 'Kode % diajukan nomor lain; minta per pelaksana.', r.kelompok using errcode = '22023';
    end if;
    v_nomor := r.nomor;
    v_no := v_no + 1;
    v_kurang := v_kurang || jsonb_build_object('no', v_no, 'kelompok', r.kelompok, 'nama', left(r.kelompok || ' ' || r.nama, 60), 'nominal', r.nominal);
  end loop;
  if v_no = 0 or v_nomor is null then
    return jsonb_build_object('status', 'tidak_ada');
  end if;
  insert into public.loonars2_wa_pending (nomor, aksi, data, kedaluwarsa_pada)
  values (v_nomor, 'lengkapi_rincian', jsonb_build_object('_perlu_rincian', v_kurang), now() + interval '24 hours')
  on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = excluded.kedaluwarsa_pada;
  insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
  values (v_nomor, 'Saya memeriksa ulang pengajuan yang sudah masuk: rinciannya masih terlalu umum.' || E'\n\n' || public._loonars2_teks_minta_rincian(v_kurang),
          'minta_rincian', 'minta_rincian:' || array_to_string(p_kodes, ',') || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  return jsonb_build_object('status', 'ditanyakan', 'kode', v_kurang);
end;
$$;

create or replace function public._loonars2_wa_rincian(p_user public.loonars2_wa_users, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend public.loonars2_wa_pending;
  v_kurang jsonb;
  v_data jsonb;
  v_no integer;
  v_isi text := btrim(coalesce(p_data ->> 'isi', ''));
  v_kode text;
  v_hasil text;
  v_jalur text[];
begin
  if p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  select * into v_pend from public.loonars2_wa_pending
   where nomor = p_user.nomor and kedaluwarsa_pada > now() and data ? '_perlu_rincian';
  if not found then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  v_data := v_pend.data;
  v_kurang := v_data -> '_perlu_rincian';
  v_no := coalesce(nullif(p_data ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
  if not exists (select 1 from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no) then
    return jsonb_build_object('status', 'perlu_info', 'balasan', 'Nomor ' || v_no || ' tidak sedang ditanya.' || E'\n\n' || public._loonars2_teks_minta_rincian(v_kurang));
  end if;
  if length(v_isi) < 3 or public._loonars2_rincian_umum(v_isi) then
    return jsonb_build_object('status', 'perlu_info', 'balasan', '🧾 Sebut nama barangnya, bukan hanya "material"/"bahan", mis. "L2 rincian semen 5 sak, paku 2 kg".'
      || E'\n\n' || public._loonars2_teks_minta_rincian(v_kurang));
  end if;

  if v_pend.aksi = 'lengkapi_rincian' then
    select x ->> 'kelompok' into v_kode from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no;
    v_hasil := public._loonars2_lengkapi_rincian(v_kode, v_isi, p_user.nama);
  elsif v_pend.aksi = 'ajukan_mingguan' then
    v_jalur := array['baris', (v_no - 1)::text, 'deskripsi'];
    v_data := jsonb_set(v_data, v_jalur, to_jsonb(public._loonars2_ganti_rincian(v_data #>> v_jalur, v_isi)));
  else
    v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_ganti_rincian(v_data ->> 'deskripsi', v_isi));
  end if;
  v_kurang := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer <> v_no), '[]'::jsonb);

  if jsonb_array_length(v_kurang) > 0 then
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_rincian', v_kurang),
           kedaluwarsa_pada = greatest(kedaluwarsa_pada, now() + interval '30 minutes')
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_rincian', 'balasan', '✅ Rincian dicatat.' || E'\n\n' || public._loonars2_teks_minta_rincian(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  if v_pend.aksi = 'lengkapi_rincian' then
    return jsonb_build_object('status', 'ok', 'balasan', '✅ Terima kasih, rincian dicatat' || coalesce(': ' || v_hasil, '.'));
  end if;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_rincian', false);
end;
$$;

revoke execute on function public._loonars2_rincian_umum(text) from public, anon, authenticated;
revoke execute on function public._loonars2_cek_rincian(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_minta_rincian(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_ganti_rincian(text, text) from public, anon, authenticated;
revoke execute on function public._loonars2_lengkapi_rincian(text, text, text) from public, anon, authenticated;
revoke execute on function public.loonars2_minta_rincian(text[]) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_rincian(public.loonars2_wa_users, jsonb) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, E'declare\n  v_rekcek jsonb;\n', E'declare\n  v_rekcek jsonb;\n  v_rinciancek jsonb;\n');
  v_new := replace(v_new, E'  -- Pelaksana: belanja di atas batas wajib bernota (atau alasan tanpa nota).\n',
    $q$  -- Pelaksana: rincian yang hanya kata umum ("belanja material") ditanyakan barangnya.
  if p_user.peran = 'pelaksana'
     and (p_aksi in ('ajukan_mingguan', 'ajukan') or (p_aksi = 'bahan' and coalesce(p_data ->> 'utang', 'false') <> 'true')) then
    v_rinciancek := public._loonars2_cek_rincian(p_aksi, p_data - '_perlu_rincian');
    if jsonb_array_length(v_rinciancek) > 0 then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, (p_data - '_perlu_rincian') || jsonb_build_object('_perlu_rincian', v_rinciancek))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_rincian', 'balasan', public._loonars2_teks_minta_rincian(v_rinciancek));
    end if;
    p_data := p_data - '_perlu_rincian';
  end if;

  -- Pelaksana: belanja di atas batas wajib bernota (atau alasan tanpa nota).
$q$);
  v_new := replace(v_new, E'  elsif p_aksi = \'daftar_borongan\' then\n',
    E'  elsif p_aksi = \'rincian\' then\n    return public._loonars2_wa_rincian(p_user, p_data);\n\n  elsif p_aksi = \'daftar_borongan\' then\n');
  if v_new = v_def or position('v_rinciancek jsonb' in v_new) = 0 or position('_loonars2_cek_rincian(' in v_new) = 0
     or position('_loonars2_wa_rincian(p_user, p_data)' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal (0071)';
  end if;
  execute v_new;
end;
$$;
