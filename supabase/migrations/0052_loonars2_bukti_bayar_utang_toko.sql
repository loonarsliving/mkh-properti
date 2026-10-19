-- ============================================================================
-- 0052 — Loonars 2: foto bukti transfer pembayaran utang toko dibaca & dicatat otomatis
-- ============================================================================
-- Masalah (19 Okt 2026): owner mengirim bukti transfer Rp 9.173.000 dengan
-- keterangan "Pembayaran utang toko bangunan loonars 2", tetapi tidak ada
-- pengajuan cicilan yang menunggu, sehingga sistem membalas "tidak ada pengajuan
-- gaji tukang/pembelian bahan" dan tidak mencatat apa pun.
--
-- Sekarang: bila owner mengirim bukti transfer dan keterangannya menyebut utang
-- toko, dan nominalnya tidak cocok dengan pengajuan yang menunggu, sistem:
--   1. menentukan tokonya: nama toko di keterangan -> toko yang pernah dibayar ke
--      penerima yang sama -> satu-satunya toko yang sisa utangnya cukup;
--   2. mencatat cicilan (disetujui + dibayar dari C, dana talangan bila saldo C
--      kurang) lengkap dengan bukti, memotong sisa utang toko;
--   3. meneruskan bukti ke pelaksana (sudah dilakukan _loonars2_bayar_kelompok);
--   4. bila tokonya tidak bisa ditentukan atau nominal melebihi sisa utang,
--      tidak mencatat apa pun dan menjelaskan apa yang perlu ditambahkan;
--   5. bukti yang sama (nominal + penerima) tidak dicatat dua kali.
-- Tanpa tabel/kolom baru.
-- ============================================================================

create or replace function public._loonars2_ket_utang_toko(p_ket text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_ket, '') !~* '\mkk-?[0-9]'
     and coalesce(p_ket, '') !~* '\m(living|coffee|kopi)\M'
     and (   coalesce(p_ket, '') ~* '\m(utang|hutang|ngutang|cicil\w*|angsur\w*|lunas|pelunasan)\M.{0,60}\m(toko|tb|ud|cv|bangunan|besi|material|bahan)\M'
          or coalesce(p_ket, '') ~* '\m(toko|tb|ud|cv|bangunan|besi|material|bahan)\M.{0,60}\m(utang|hutang|cicil\w*|angsur\w*|lunas|pelunasan)\M');
$$;

create or replace function public._loonars2_bukti_cicilan(
  p_user public.loonars2_wa_users, p_nominal numeric, p_penerima text, p_tanggal text, p_ket text, p_bukti text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_catatan text := left('Bukti transfer ke ' || coalesce(nullif(trim(p_penerima), ''), '(penerima tidak terbaca)'), 200);
  v_kunci_ket text := public._loonars2_kunci_toko(p_ket);
  v_toko smallint;
  v_ids smallint[];
  v_nama text;
  v_sisa numeric;
  v_kode text;
  v_id integer;
  v_teks text;
  v_daftar text := '';
  r record;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');
  if p_user.peran <> 'owner' or p_nominal is null or p_nominal <= 0 then
    return jsonb_build_object('status', 'tidak_cocok');
  end if;

  -- bukti yang sama sudah dicatat?
  select c.kelompok into v_kode from public.loonars2_cicilan c
   where c.status = 'dibayar' and c.nominal = p_nominal and c.catatan = v_catatan
     and c.diputuskan_pada > now() - interval '2 days' order by c.id desc limit 1;
  if v_kode is not null then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      '📎 Bukti ' || public.loonars2_rp(p_nominal) || ' ke ' || coalesce(nullif(trim(p_penerima), ''), 'penerima yang sama')
      || ' sepertinya sudah dicatat sebagai ' || v_kode || '. Tidak dicatat dua kali.');
  end if;

  -- 1) toko disebut di keterangan (toko yang paling awal untuk nama yang sama)
  -- nama yang paling panjang menang ("semen uji" mengalahkan "uji")
  select array_agg(t.id order by t.id) into v_ids from public.loonars2_toko t
   where public._loonars2_kunci_toko(t.nama) <> ''
     and position(public._loonars2_kunci_toko(t.nama) in v_kunci_ket) > 0
     and t.id = (select min(t2.id) from public.loonars2_toko t2 where public._loonars2_kunci_toko(t2.nama) = public._loonars2_kunci_toko(t.nama))
     and length(public._loonars2_kunci_toko(t.nama)) = (
       select max(length(public._loonars2_kunci_toko(t3.nama))) from public.loonars2_toko t3
        where public._loonars2_kunci_toko(t3.nama) <> '' and position(public._loonars2_kunci_toko(t3.nama) in v_kunci_ket) > 0);
  if cardinality(v_ids) = 1 then
    v_toko := v_ids[1];
  end if;

  -- 2) toko yang pernah dibayar ke penerima yang sama
  if v_toko is null and nullif(trim(p_penerima), '') is not null then
    select c.toko_id into v_toko from public.loonars2_cicilan c
     where c.status = 'dibayar' and c.catatan = v_catatan order by c.id desc limit 1;
  end if;

  -- 3) satu-satunya toko yang sisa utangnya cukup
  if v_toko is null then
    select array_agg(vt.id order by vt.id) into v_ids from public.loonars2_v_toko vt where vt.sisa_utang >= p_nominal;
    if cardinality(v_ids) = 1 then
      v_toko := v_ids[1];
    else
      for r in select nama, sisa_utang from public.loonars2_v_toko where sisa_utang > 0 order by sisa_utang desc loop
        v_daftar := v_daftar || E'\n• ' || r.nama || ': sisa ' || public.loonars2_rp(r.sisa_utang);
      end loop;
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        '📎 Bukti ' || public.loonars2_rp(p_nominal) || coalesce(' ke ' || nullif(trim(p_penerima), ''), '')
        || case when cardinality(v_ids) > 1 then ' bisa untuk beberapa toko, belum dicatat.' else ' lebih besar dari sisa utang toko mana pun, belum dicatat.' end
        || v_daftar || E'\n\nKirim ulang foto dengan nama tokonya di keterangan, mis. "bayar utang Sedia Nurut".');
    end if;
  end if;

  select nama into v_nama from public.loonars2_toko where id = v_toko;
  select sisa_utang into v_sisa from public.loonars2_v_toko where id = v_toko;
  if p_nominal > v_sisa then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      '📎 Bukti ' || public.loonars2_rp(p_nominal) || ' lebih besar dari sisa utang ' || v_nama || ' (' || public.loonars2_rp(v_sisa)
      || '), belum dicatat. Cek tokonya, atau catat dulu utang yang belum masuk.');
  end if;

  -- catat cicilan: disetujui (owner yang membayar) lalu dibayar dari C dengan bukti
  v_kode := public._loonars2_kode_baru('M');
  insert into public.loonars2_cicilan (kelompok, toko_id, nominal, catatan, diajukan_oleh, diajukan_oleh_nomor, sumber)
  values (v_kode, v_toko, p_nominal, v_catatan, p_user.nama, p_user.nomor, 'wa')
  returning id into v_id;
  update public.loonars2_cicilan set status = 'disetujui', diputuskan_oleh = v_aktor, diputuskan_pada = now() where id = v_id;
  perform set_config('loonars2.talangan', 'ya', true);
  v_teks := public._loonars2_bayar_kelompok(v_kode, p_bukti, v_aktor, 'wa');
  perform set_config('loonars2.talangan', '', true);
  select sisa_utang into v_sisa from public.loonars2_v_toko where id = v_toko;

  return jsonb_build_object('status', 'ok', 'balasan',
    '✅ Pembayaran utang ' || v_nama || ' ' || public.loonars2_rp(p_nominal) || coalesce(' (ke ' || nullif(trim(p_penerima), '') || ')', '')
    || ' tercatat sebagai ' || v_kode || '.' || E'\nSisa utang ' || v_nama || ' sekarang ' || public.loonars2_rp(v_sisa) || '.'
    || E'\n' || v_teks);
end;
$$;

create or replace function public._loonars2_bukti_transfer_utama(p_user public.loonars2_wa_users, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := public._loonars2_bukti_transfer(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima', p_data ->> 'bukti_url');
  if v ->> 'status' = 'tidak_cocok' and p_user.peran = 'owner' and public._loonars2_ket_utang_toko(p_data ->> 'keterangan') then
    return public._loonars2_bukti_cicilan(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima',
      p_data ->> 'tanggal', p_data ->> 'keterangan', p_data ->> 'bukti_url');
  end if;
  return v;
end;
$$;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def,
    $q$then (select count(*) from public.loonars2_allocations where status = 'menunggu') else 0 end);$q$,
    $q$then (select count(*) from public.loonars2_allocations where status = 'menunggu') else 0 end
      + case when p_user.peran = 'owner' and public._loonars2_ket_utang_toko(p_data ->> 'keterangan') then 1 else 0 end);$q$);
  v_new := replace(v_new,
    $q$return public._loonars2_bukti_transfer(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima', p_data ->> 'bukti_url');$q$,
    $q$return public._loonars2_bukti_transfer_utama(p_user, p_data);$q$);
  if v_new = v_def or position('_bukti_transfer_utama' in v_new) = 0 or position('_ket_utang_toko' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal';
  end if;
  execute v_new;
end;
$$;

revoke execute on function public._loonars2_bukti_cicilan(public.loonars2_wa_users, numeric, text, text, text, text) from public, anon, authenticated;
revoke execute on function public._loonars2_bukti_transfer_utama(public.loonars2_wa_users, jsonb) from public, anon, authenticated;
