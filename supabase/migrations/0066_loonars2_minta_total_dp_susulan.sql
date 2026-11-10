-- ============================================================================
-- 0066 — Loonars 2: tanyakan total DP untuk pengajuan yang sudah terkirim
-- ============================================================================
-- Permintaan owner (10 Nov 2026): M-100 (DP kaca) dan M-101 (DP sambungan pipa
-- air panas) diajukan Vando sebelum 0064/0065 aktif, tanpa total. "Tanyakan ke
-- dia kalau begitu."
--
--  1. `loonars2_minta_total_dp(p_kodes text[])` (internal, hanya service role /
--     migrasi): untuk kode M-n yang belum punya kontrak dan belum ditolak,
--     mengirim WA ke pelaksana yang mengajukan ("DP ini dari total nilai
--     berapa?") dan menyimpan pending `lengkapi_dp` (berlaku 24 jam).
--  2. `_loonars2_wa_total_dp` (0064) ditulis ulang: balasan "total 10 juta" /
--     "1. total …\n2. total …" untuk pending `lengkapi_dp` membuat kontrak D-n
--     dan menautkan semua baris pengajuan kode itu, menambahkan keterangan
--     "(DP dari total …, sisa …)" di rinciannya, dan mengabari owner. Alur
--     pending pengajuan baru (0064) tidak berubah.
--
-- Nominal, status, budget, saldo tidak berubah.
-- ============================================================================

create or replace function public.loonars2_minta_total_dp(p_kodes text[])
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
    select m.kelompok, sum(m.nominal) as nominal, max(m.diajukan_oleh_nomor) as nomor, min(m.id) as id_awal,
           regexp_replace(public._loonars2_hapus_rekening(min(m.deskripsi)), '\s+—\s+bahan kolektif, bagian unit ini.*$', '') as nama
      from public.loonars2_material_requests m
     where m.kelompok = any(p_kodes) and m.kontrak_dp_id is null and m.status <> 'ditolak'
     group by m.kelompok
     order by min(m.id)
  loop
    if v_nomor is not null and r.nomor is distinct from v_nomor then
      raise exception 'Kode % diajukan nomor lain; minta per pelaksana.', r.kelompok using errcode = '22023';
    end if;
    v_nomor := r.nomor;
    v_no := v_no + 1;
    v_kurang := v_kurang || jsonb_build_object('no', v_no, 'kelompok', r.kelompok, 'nama', left(r.kelompok || ' ' || r.nama, 80), 'nominal', r.nominal);
  end loop;
  if v_no = 0 or v_nomor is null then
    return jsonb_build_object('status', 'tidak_ada', 'balasan', 'Tidak ada pengajuan tanpa kontrak untuk kode itu.');
  end if;
  if not exists (select 1 from public.loonars2_wa_users where nomor = v_nomor and peran = 'pelaksana' and aktif) then
    raise exception 'Nomor pengaju bukan pelaksana aktif.' using errcode = '22023';
  end if;

  insert into public.loonars2_wa_pending (nomor, aksi, data, kedaluwarsa_pada)
  values (v_nomor, 'lengkapi_dp', jsonb_build_object('_perlu_total_dp', v_kurang), now() + interval '24 hours')
  on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = excluded.kedaluwarsa_pada;

  insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
  values (v_nomor,
    'Pak Avi minta total harga untuk DP yang sudah diajukan, supaya sisa pembayarannya tercatat dan tidak salah bayar.' || E'\n\n'
      || public._loonars2_teks_minta_total_dp(v_kurang),
    'minta_total_dp', 'minta_total_dp:' || array_to_string(p_kodes, ',') || ':' || to_char(now(), 'YYYYMMDDHH24MISS'));
  return jsonb_build_object('status', 'ditanyakan', 'nomor', v_nomor, 'kode', v_kurang);
end;
$$;
revoke execute on function public.loonars2_minta_total_dp(text[]) from public, anon, authenticated;

-- Selesaikan pending lengkapi_dp: buat kontrak & tautkan pengajuan lama.
create or replace function public._loonars2_lengkapi_dp(p_isi jsonb, p_nama text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb;
  v_kode text;
  v_total numeric;
  v_nominal numeric;
  v_id integer;
  v_item text;
  v_rek text;
  v_baris text := '';
  k record;
begin
  for it in select * from jsonb_array_elements(p_isi) loop
    v_kode := it ->> 'kelompok';
    v_total := (it ->> 'total')::numeric;
    continue when exists (select 1 from public.loonars2_material_requests where kelompok = v_kode and kontrak_dp_id is not null);
    select sum(nominal),
           btrim(regexp_replace(public._loonars2_hapus_rekening(min(deskripsi)), '\s+—\s+bahan kolektif, bagian unit ini.*$', '')),
           public._loonars2_ekstrak_rekening(min(deskripsi))
      into v_nominal, v_item, v_rek
      from public.loonars2_material_requests where kelompok = v_kode and status <> 'ditolak';
    continue when v_nominal is null;
    insert into public.loonars2_kontrak_dp (item, penerima, total, kelompok_awal, diajukan_oleh)
    values (left(coalesce(nullif(v_item, ''), 'DP'), 300), v_rek, v_total, v_kode, p_nama)
    returning id into v_id;
    update public.loonars2_material_requests
       set kontrak_dp_id = v_id,
           deskripsi = left(public._loonars2_tempel_total_dp(deskripsi, v_nominal, v_total), 2000)
     where kelompok = v_kode and kontrak_dp_id is null;
    select * into k from public.loonars2_v_kontrak_dp where id = v_id;
    v_baris := v_baris || E'\n• ' || v_kode || ' ' || left(k.item, 60) || ' → kontrak ' || k.kode
      || ': total ' || public.loonars2_rp(k.total) || ', DP ' || public.loonars2_rp(v_nominal) || ', sisa ' || public.loonars2_rp(k.sisa);
  end loop;
  if v_baris <> '' then
    perform public._loonars2_kirim('owner', '🧮 ' || coalesce(p_nama, 'Pelaksana') || ' melengkapi total DP:' || v_baris
      || E'\nPembayaran berikutnya untuk item ini otomatis dicek terhadap sisanya.', 'total_dp_susulan');
  end if;
  return v_baris;
end;
$$;
revoke execute on function public._loonars2_lengkapi_dp(jsonb, text) from public, anon, authenticated;

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
  v_kelompok text;
  v_kecil text := '';
  v_hasil text;
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
    if v_pend.aksi = 'lengkapi_dp' then
      v_hasil := public._loonars2_lengkapi_dp(coalesce(v_data -> '_isi', '[]'::jsonb), p_user.nama);
      return jsonb_build_object('status', 'ok', 'balasan', '👍 Baik, sisanya tanpa total.' || coalesce(E'\nYang sudah dicatat:' || nullif(v_hasil, ''), ''));
    end if;
    return public._loonars2_wa_jalankan(p_user, v_pend.aksi, (v_data - '_perlu_total_dp') || '{"tanpa_total_dp":true}'::jsonb, false);
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_data -> 'daftar', '[]'::jsonb)) loop
    v_total := nullif(it ->> 'total', '')::numeric;
    continue when v_total is null or v_total <= 0;
    v_no := coalesce(nullif(it ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
    select (x ->> 'nominal')::numeric, x ->> 'kelompok' into v_nominal, v_kelompok
      from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no;
    continue when not found;
    if v_total <= v_nominal then
      v_kecil := v_kecil || E'\n• ' || v_no || ': total ' || public.loonars2_rp(v_total) || ' tidak lebih besar dari DP ' || public.loonars2_rp(v_nominal);
      continue;
    end if;
    if v_pend.aksi = 'lengkapi_dp' then
      v_data := jsonb_set(v_data, '{_isi}', coalesce(v_data -> '_isi', '[]'::jsonb) || jsonb_build_object('kelompok', v_kelompok, 'total', v_total));
    elsif v_pend.aksi = 'ajukan_mingguan' then
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
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_total_dp', v_kurang),
           kedaluwarsa_pada = greatest(kedaluwarsa_pada, now() + interval '30 minutes')
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_total_dp', 'balasan', '✅ Total dicatat.' || E'\n\n' || public._loonars2_teks_minta_total_dp(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  if v_pend.aksi = 'lengkapi_dp' then
    v_hasil := public._loonars2_lengkapi_dp(coalesce(v_data -> '_isi', '[]'::jsonb), p_user.nama);
    return jsonb_build_object('status', 'ok', 'balasan', '✅ Terima kasih, total DP dicatat dan sudah dikabarkan ke Pak Avi:' || coalesce(v_hasil, ''));
  end if;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_total_dp', false);
end;
$$;
revoke execute on function public._loonars2_wa_total_dp(public.loonars2_wa_users, jsonb, boolean) from public, anon, authenticated;
