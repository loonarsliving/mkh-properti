-- ============================================================================
-- 0070 — Loonars 2: bukti transfer yang menyebut kode, dan pilihan kode saat ambigu
-- ============================================================================
-- Insiden 10 Nov 2026 (owner): M-100 (DP kaca) dan M-101 (DP pipa air panas)
-- sama-sama Rp 3.000.000 ke rekening yang sama. Owner mengirim foto bukti
-- transfer Rp 3.000.000 → sistem menjawab "cocok dengan beberapa pengajuan,
-- kirim ulang dengan 'L2 bayar <kode>'". Owner mengirim ulang dengan keterangan
-- "L2 m100" → tidak dikenali, foto jatuh ke modul slip gaji MK Connect yang
-- menjawab "rekening gaji karyawan … tidak dicatat". Selain itu "L2 bayar M-100"
-- untuk kode yang masih MENUNGGU pun tidak bisa (bayar_kelompok hanya membayar
-- baris yang sudah disetujui), padahal aturan owner: transfer = persetujuan.
--
--  1. `_loonars2_bayar_kode_bukti(user, kode, nominal, bukti)`: bayar SATU kode
--     yang disebut (M-n atau L2-n) dengan foto. Nominal foto harus sama dengan
--     total baris kode itu yang belum dibayar; bila owner dan masih menunggu,
--     disetujui lalu dibayar (fungsi yang sama dengan pencocok otomatis 0063).
--     Pelaksana tidak bisa menyetujui kode yang masih menunggu.
--  2. `_loonars2_bukti_transfer_utama` (0052) ditulis ulang: keterangan foto yang
--     menyebut kode ("L2 bayar M-100", "M-100", "m100") → langsung ke (1);
--     selain itu pencocok lama. Bila hasilnya AMBIGU dan pengirimnya owner, foto
--     disimpan sebagai pending `pilih_bukti` (30 menit) dan owner cukup membalas
--     kodenya, mis. "M-100".
--  3. Aksi `bayar_kelompok` dengan foto, atau saat ada pending `pilih_bukti`,
--     memakai (1). Tanpa foto & tanpa pending: perilaku lama.
-- Tidak ada tabel/kolom baru. Rumus pembayaran tidak berubah.
-- ============================================================================

create or replace function public._loonars2_kode_dari_teks(p_teks text)
returns text
language plpgsql
immutable
as $$
declare
  m text[];
begin
  m := regexp_match(coalesce(p_teks, ''), '(?i)(?:^|[^a-z0-9])(m|l2)-?(\d{1,5})(?:[^0-9]|$)');
  if m is null then return null; end if;
  return upper(m[1]) || '-' || m[2];
end;
$$;

create or replace function public._loonars2_bayar_kode_bukti(p_user public.loonars2_wa_users, p_kode text, p_nominal numeric, p_bukti text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_kode text := upper(trim(coalesce(p_kode, '')));
  v_id integer;
  v_total numeric;
  v_menunggu boolean;
  v_pesan text;
begin
  if v_kode ~ '^L2-\d+$' then
    v_id := substring(v_kode from 4)::integer;
    select nominal, status = 'menunggu' into v_total, v_menunggu from public.loonars2_material_requests
     where id = v_id and status in ('menunggu', 'disetujui');
  else
    select sum(x.nominal), bool_or(x.status = 'menunggu') into v_total, v_menunggu from (
      select nominal, status from public.loonars2_material_requests where kelompok = v_kode and status in ('menunggu', 'disetujui')
      union all select nominal, status from public.loonars2_cicilan where kelompok = v_kode and status in ('menunggu', 'disetujui')) x;
  end if;
  if v_total is null then
    return jsonb_build_object('status', 'ok', 'balasan', 'ℹ️ ' || v_kode || ' tidak punya baris yang menunggu pembayaran (mungkin sudah dibayar atau ditolak). Tidak ada yang dicatat.');
  end if;
  if p_nominal is not null and p_nominal <> v_total then
    return jsonb_build_object('status', 'ok', 'balasan',
      '⚠️ Nominal di foto ' || public.loonars2_rp(p_nominal) || ' tidak sama dengan total ' || v_kode || ' ' || public.loonars2_rp(v_total)
      || '. Tidak ada yang dicatat. Periksa lagi kodenya, atau kirim foto transfer yang sesuai.');
  end if;
  if v_menunggu and p_user.peran <> 'owner' then
    return jsonb_build_object('status', 'ok', 'balasan', '⏳ ' || v_kode || ' masih menunggu persetujuan, jadi belum bisa dicatat dibayar.');
  end if;
  v_pesan := '📎 Bukti transfer ' || public.loonars2_rp(v_total) || ' dicatat untuk ' || v_kode || '.';
  if p_user.peran = 'owner' then perform set_config('loonars2.talangan', 'ya', true); end if;
  if v_id is not null then
    if v_menunggu then v_pesan := v_pesan || E'\n' || public._loonars2_putuskan(v_id, true, null, true, v_aktor, 'wa'); end if;
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_pengajuan(v_id, null, p_bukti, v_aktor, 'wa');
  else
    if v_menunggu then v_pesan := v_pesan || E'\n' || public._loonars2_putuskan_kode(v_kode, true, null, true, v_aktor, 'wa'); end if;
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_kelompok(v_kode, p_bukti, v_aktor, 'wa');
  end if;
  return jsonb_build_object('status', 'ok', 'balasan', v_pesan);
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
  v_kode text := public._loonars2_kode_dari_teks(p_data ->> 'keterangan');
begin
  if v_kode is not null then
    return public._loonars2_bayar_kode_bukti(p_user, v_kode, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'bukti_url');
  end if;
  v := public._loonars2_bukti_transfer(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima', p_data ->> 'bukti_url');
  if v ->> 'status' = 'tidak_cocok' and p_user.peran = 'owner' and public._loonars2_ket_utang_toko(p_data ->> 'keterangan') then
    return public._loonars2_bukti_cicilan(p_user, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'penerima',
      p_data ->> 'tanggal', p_data ->> 'keterangan', p_data ->> 'bukti_url',
      jsonb_build_object('waktu', p_data ->> 'waktu', 'referensi', p_data ->> 'referensi', 'paksa', coalesce(p_data ->> 'paksa', 'false')));
  end if;
  if v ->> 'status' = 'ambigu' and p_user.peran = 'owner' then
    insert into public.loonars2_wa_pending (nomor, aksi, data)
    values (p_user.nomor, 'pilih_bukti', jsonb_build_object('nominal', p_data -> 'nominal', 'bukti_url', p_data ->> 'bukti_url'))
    on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
    v := v || jsonb_build_object('balasan', (v ->> 'balasan') || E'\nAtau cukup balas kodenya saja, mis. "M-100" — foto ini saya ingat 30 menit.');
  end if;
  return v;
end;
$$;

create or replace function public._loonars2_wa_bayar_kode(p_user public.loonars2_wa_users, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pend public.loonars2_wa_pending;
  v_kode text := coalesce(public._loonars2_kode_dari_teks(p_data ->> 'kode'), upper(trim(p_data ->> 'kode')));
begin
  if nullif(p_data ->> 'bukti_url', '') is not null then
    return public._loonars2_bayar_kode_bukti(p_user, v_kode, nullif(p_data ->> 'nominal', '')::numeric, p_data ->> 'bukti_url');
  end if;
  delete from public.loonars2_wa_pending where nomor = p_user.nomor and aksi = 'pilih_bukti' and kedaluwarsa_pada > now()
  returning * into v_pend;
  return public._loonars2_bayar_kode_bukti(p_user, v_kode, nullif(v_pend.data ->> 'nominal', '')::numeric, v_pend.data ->> 'bukti_url');
end;
$$;

revoke execute on function public._loonars2_kode_dari_teks(text) from public, anon, authenticated;
revoke execute on function public._loonars2_bayar_kode_bukti(public.loonars2_wa_users, text, numeric, text) from public, anon, authenticated;
revoke execute on function public._loonars2_bukti_transfer_utama(public.loonars2_wa_users, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_bayar_kode(public.loonars2_wa_users, jsonb) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, E'  elsif p_aksi = \'bayar_kelompok\' then\n',
    $q$  elsif p_aksi = 'bayar_kelompok' and (nullif(p_data ->> 'bukti_url', '') is not null
        or exists (select 1 from public.loonars2_wa_pending w where w.nomor = p_user.nomor and w.aksi = 'pilih_bukti' and w.kedaluwarsa_pada > now())) then
    return public._loonars2_wa_bayar_kode(p_user, p_data);

  elsif p_aksi = 'bayar_kelompok' then
$q$);
  if v_new = v_def or position('_loonars2_wa_bayar_kode(p_user, p_data)' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal (0070)';
  end if;
  execute v_new;
end;
$$;
