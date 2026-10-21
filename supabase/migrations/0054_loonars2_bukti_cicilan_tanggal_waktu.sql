-- ============================================================================
-- 0054 — Loonars 2: bukti cicilan utang toko — bedakan transfer yang nominal & penerimanya sama
-- ============================================================================
-- Masalah (21 Okt 2026): owner mengunggah beberapa bukti cicilan LAMA ke penerima
-- yang sama dengan nominal yang sama (mis. beberapa transfer Rp 10.000.000 ke
-- PAPANG WIDIYANTO pada 3 dan 10 Okt). Penjaga bukti kembar (0052) hanya melihat
-- nominal + penerima, sehingga bukti yang berbeda dikira kembar.
--
-- Sekarang:
--   * identitas bukti = nominal + penerima + TANGGAL + JAM (+ nomor referensi bila
--     terbaca di foto). Hanya yang identik dianggap kembar.
--   * bila jam/referensi tidak terbaca dan tanggalnya sama dengan yang sudah ada,
--     sistem bertanya dan tidak menebak; owner menegaskan dengan "transfer beda"
--     (data paksa) kalau memang transfer yang lain.
--   * pembayaran dicatat pada TANGGAL TRANSFER di foto (bukan tanggal unggah), jadi
--     laporan utang menampilkan tanggal yang benar.
-- Tanpa tabel/kolom baru.
-- ============================================================================

create or replace function public._loonars2_tgl_dari_teks(p_teks text)
returns date
language plpgsql
immutable
as $$
declare
  m text[];
  v_bulan int;
begin
  if p_teks is null then return null; end if;
  m := regexp_match(p_teks, '(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])');
  if m is not null then
    return make_date(m[1]::int, m[2]::int, m[3]::int);
  end if;
  m := regexp_match(lower(p_teks), '([0-3]?[0-9])\s+(jan(?:uari)?|feb(?:ruari)?|mar(?:et)?|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|agu(?:stus)?|ags|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)\w*\s+(20[0-9]{2})');
  if m is null then return null; end if;
  v_bulan := case left(m[2], 3)
    when 'jan' then 1 when 'feb' then 2 when 'mar' then 3 when 'apr' then 4 when 'mei' then 5 when 'jun' then 6
    when 'jul' then 7 when 'agu' then 8 when 'ags' then 8 when 'sep' then 9 when 'okt' then 10 when 'nov' then 11 when 'des' then 12 end;
  return make_date(m[3]::int, v_bulan, m[1]::int);
exception when others then
  return null;
end;
$$;

create or replace function public._loonars2_bukti_cicilan(
  p_user public.loonars2_wa_users, p_nominal numeric, p_penerima text, p_tanggal text, p_ket text, p_bukti text, p_extra jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_penerima text := coalesce(nullif(trim(p_penerima), ''), '(penerima tidak terbaca)');
  v_tgl date := public._loonars2_tgl_dari_teks(p_tanggal);
  v_waktu text := nullif(trim(p_extra ->> 'waktu'), '');
  v_ref text := nullif(trim(p_extra ->> 'referensi'), '');
  v_paksa boolean := coalesce(p_extra ->> 'paksa', 'false') = 'true';
  v_catatan text;
  v_prefix text := left('Bukti transfer ke ' || v_penerima, 200);
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
  if v_tgl is not null and v_tgl > public._loonars2_hari_ini() then v_tgl := null; end if;

  -- identitas bukti: penerima + tanggal + jam (+ referensi)
  v_catatan := left(v_prefix || ' | ' || coalesce(to_char(v_tgl, 'DD-MM-YYYY'), nullif(trim(p_tanggal), ''), 'tanggal tidak terbaca')
                    || coalesce(' ' || v_waktu, '') || coalesce(' | ref ' || v_ref, ''), 250);

  -- identik sampai jam/referensi = kembar pasti (bila jam/referensi tidak terbaca, ditanyakan di bawah)
  if v_waktu is not null or v_ref is not null then
    select c.kelompok into v_kode from public.loonars2_cicilan c
     where c.status = 'dibayar' and c.nominal = p_nominal and c.catatan = v_catatan order by c.id desc limit 1;
  end if;
  if v_kode is not null then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      '📎 Bukti ' || public.loonars2_rp(p_nominal) || ' ke ' || v_penerima || coalesce(' tanggal ' || to_char(v_tgl, 'DD-MM-YYYY'), '')
      || coalesce(' jam ' || v_waktu, '') || ' sudah dicatat sebagai ' || v_kode || '. Tidak dicatat dua kali.');
  end if;

  -- jam/referensi tidak terbaca, tanggal & nominal & penerima sama dengan yang sudah ada: tanya, jangan menebak
  if not v_paksa and v_waktu is null and v_ref is null then
    select c.kelompok into v_kode from public.loonars2_cicilan c
     where c.status = 'dibayar' and c.nominal = p_nominal and c.catatan like v_prefix || ' | ' || coalesce(to_char(v_tgl, 'DD-MM-YYYY'), '%') || '%'
     order by c.id desc limit 1;
    if v_kode is not null then
      return jsonb_build_object('status', 'perlu_info', 'balasan',
        '📎 Sudah ada pembayaran ' || public.loonars2_rp(p_nominal) || ' ke ' || v_penerima || coalesce(' tanggal ' || to_char(v_tgl, 'DD-MM-YYYY'), '')
        || ' (' || v_kode || '), dan jam transfer di foto ini tidak terbaca, jadi belum dicatat supaya tidak dobel.'
        || E'\nKalau ini transfer YANG LAIN, kirim ulang foto dengan tambahan kata "transfer beda" di keterangan.');
    end if;
  end if;
  if v_paksa then
    v_catatan := left(v_catatan || ' | #' || to_char(now() at time zone 'Asia/Jakarta', 'HH24MISS'), 250);
  end if;

  -- 1) toko disebut di keterangan (nama paling panjang menang)
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
     where c.status = 'dibayar' and c.catatan like v_prefix || ' | %' order by c.id desc limit 1;
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

  v_kode := public._loonars2_kode_baru('M');
  insert into public.loonars2_cicilan (kelompok, toko_id, nominal, catatan, diajukan_oleh, diajukan_oleh_nomor, sumber)
  values (v_kode, v_toko, p_nominal, v_catatan, p_user.nama, p_user.nomor, 'wa')
  returning id into v_id;
  update public.loonars2_cicilan set status = 'disetujui', diputuskan_oleh = v_aktor, diputuskan_pada = now() where id = v_id;
  perform set_config('loonars2.talangan', 'ya', true);
  v_teks := public._loonars2_bayar_kelompok(v_kode, p_bukti, v_aktor, 'wa');
  perform set_config('loonars2.talangan', '', true);
  -- dicatat pada tanggal transfer di foto
  if v_tgl is not null then
    update public.loonars2_disbursements set tanggal = v_tgl where cicilan_id = v_id;
  end if;
  select sisa_utang into v_sisa from public.loonars2_v_toko where id = v_toko;

  return jsonb_build_object('status', 'ok', 'balasan',
    '✅ Pembayaran utang ' || v_nama || ' ' || public.loonars2_rp(p_nominal) || ' (ke ' || v_penerima || ')'
    || coalesce(', transfer ' || to_char(v_tgl, 'DD-MM-YYYY') || coalesce(' ' || v_waktu, ''), '')
    || ' tercatat sebagai ' || v_kode || '.' || E'\nSisa utang ' || v_nama || ' sekarang ' || public.loonars2_rp(v_sisa) || '.'
    || E'\n' || v_teks);
end;
$$;

-- versi 6 argumen (0052) tetap ada, meneruskan ke versi baru
create or replace function public._loonars2_bukti_cicilan(
  p_user public.loonars2_wa_users, p_nominal numeric, p_penerima text, p_tanggal text, p_ket text, p_bukti text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._loonars2_bukti_cicilan(p_user, p_nominal, p_penerima, p_tanggal, p_ket, p_bukti, '{}'::jsonb);
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
      p_data ->> 'tanggal', p_data ->> 'keterangan', p_data ->> 'bukti_url',
      jsonb_build_object('waktu', p_data ->> 'waktu', 'referensi', p_data ->> 'referensi', 'paksa', coalesce(p_data ->> 'paksa', 'false')));
  end if;
  return v;
end;
$$;

revoke execute on function public._loonars2_tgl_dari_teks(text) from public, anon, authenticated;
revoke execute on function public._loonars2_bukti_cicilan(public.loonars2_wa_users, numeric, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_bukti_cicilan(public.loonars2_wa_users, numeric, text, text, text, text) from public, anon, authenticated;
