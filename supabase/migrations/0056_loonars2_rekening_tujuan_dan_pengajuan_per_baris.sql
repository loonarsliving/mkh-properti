-- ============================================================================
-- 0056 — Loonars 2: pengajuan Vando lengkap dengan rekening tujuan, sampai ke owner seperti Loonars 1
-- ============================================================================
-- Permintaan owner (24 Okt 2026): pengajuan belanja kecil dari Vando harus
-- sampai ke owner seperti pengajuan Loonars 1 — satu pengajuan satu pesan, dengan
-- rincian, nilai, DAN rekening tujuan yang tinggal disalin, lalu cukup transfer
-- dan kirim foto bukti. Sistem harus menanyakan nomor rekening bila Vando belum
-- melampirkannya.
--
--  1. Rekening tujuan: dibaca dari tulisan Vando ("BCA 123… a.n. X"); bila belum
--     ada, sistem menanyakan (balas "1. BCA 123 a.n. X"), mengingat rekening
--     per penerima/toko untuk pengajuan berikutnya, dan boleh dilewati dengan
--     "L2 tanpa rekening". Rekening disimpan di teks rincian (" | rek: …") dan
--     toko (catatan) — tanpa kolom/tabel baru.
--  2. Pengajuan mingguan dipecah per baris: tiap baris punya kode M sendiri
--     (satu penerima = satu pesan ke owner = satu transfer = satu bukti), sehingga
--     bukti transfer per baris cocok otomatis. Upah borongan mingguan tetap satu.
--  3. Pesan ke owner dibuat ringkas ala Loonars 1: Item, Nilai, Rekening (nomor
--     di baris sendiri untuk disalin), Diinput oleh, unit (dirangkum 1–6),
--     peringatan singkat, cara membayar, dan cara menolak. Baris per unit tidak
--     lagi ditampilkan satu-satu.
-- ============================================================================

-- 1. Pembaca rekening -----------------------------------------------------------
create or replace function public._loonars2_ekstrak_rekening(p_teks text)
returns text
language plpgsql
immutable
as $$
declare
  c_bank constant text := 'bca|bri|bni|bsi|btn|btpn|mandiri|danamon|cimb(?:\s+niaga)?|permata|panin|mega|ocbc|maybank|jago|seabank|jenius|sultra|bpd(?:\s+[a-z]+)?|dana|ovo|gopay|shopeepay';
  c_no constant text := '(\d{6,18}|\d{3,5}(?:[\s\-]\d{3,5}){1,3}(?:[\s\-]\d{1,5})?)';
  m text[];
  v_bank text;
  v_no text;
  v_an text;
  v_dgt text;
begin
  if p_teks is null or p_teks = '' then return null; end if;
  m := regexp_match(p_teks, '\m(?:bank\s+)?(' || c_bank || ')\M[\s:.\-]*(?:no\.?\s*(?:rek(?:ening)?\.?)?[\s:.\-]*|rek(?:ening)?\.?[\s:.\-]*)?' || c_no, 'i');
  if m is not null then
    v_bank := m[1]; v_no := m[2];
  else
    m := regexp_match(p_teks, c_no || '\s*(?:bank\s+)?(' || c_bank || ')\M', 'i');
    if m is null then return null; end if;
    v_no := m[1]; v_bank := m[2];
  end if;
  v_dgt := regexp_replace(v_no, '\D', '', 'g');
  if length(v_dgt) < 8 or length(v_dgt) > 18 then return null; end if;

  m := regexp_match(p_teks, '\m(?:a\.?\s?n\.?|atas\s+nama)\M[\s:.]*([A-Za-z][A-Za-z.'' ]{1,40})', 'i');
  if m is not null then
    v_an := regexp_replace(trim(m[1]), '\s+(dan|untuk|ya|tolong|sudah|terima|makasih|thanks|pak|bu)\M.*$', '', 'i');
    v_an := substring(v_an from '^(\S+(?:\s+\S+){0,4})');
  else
    m := regexp_match(p_teks, '((?:[A-Z]{2,}\s+){0,4}[A-Z]{2,})\s+[Bb]ank\M');
    if m is not null then v_an := m[1]; end if;
  end if;
  if v_an is null then
    -- nama tanpa "a.n." tepat setelah nomor rekening: "Mandiri 1850 0066 1464 5 Sarno"
    m := regexp_match(substring(p_teks from position(v_no in p_teks) + length(v_no)), '^\s*([A-Za-z][A-Za-z.'' ]{1,40}?)\s*$');
    if m is not null then v_an := substring(trim(m[1]) from '^(\S+(?:\s+\S+){0,3})'); end if;
  end if;
  return upper(regexp_replace(regexp_replace(v_bank, '^bank\s+', '', 'i'), '\s+', ' ', 'g')) || ' ' || v_dgt
         || coalesce(' a.n. ' || nullif(upper(trim(v_an)), ''), '');
end;
$$;

create or replace function public._loonars2_kunci_penerima(p_teks text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', '')),
           '\m(rp|juta|jt|rb|ribu|total|nominal|bayar|pembayaran|transfer|ke|untuk)\M', ' ', 'g'),
           '[0-9.,/()&:;\-]', ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function public._loonars2_rekening_dikenal(p_nama text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := public._loonars2_kunci_penerima(p_nama);
  v_rek text;
begin
  if v_key = '' then return null; end if;
  select public._loonars2_ekstrak_rekening(t.catatan) into v_rek from public.loonars2_toko t
   where public._loonars2_kunci_toko(t.nama) <> '' and public._loonars2_kunci_toko(t.nama) = public._loonars2_kunci_toko(p_nama)
     and public._loonars2_ekstrak_rekening(t.catatan) is not null order by t.id limit 1;
  if v_rek is not null then return v_rek; end if;
  select public._loonars2_ekstrak_rekening(m.deskripsi) into v_rek from public.loonars2_material_requests m
   where position(' | rek:' in m.deskripsi) > 0
     and (public._loonars2_kunci_penerima(m.deskripsi) = v_key or public._loonars2_kunci_penerima(coalesce(m.toko, '')) = v_key)
   order by m.id desc limit 1;
  if v_rek is not null then return v_rek; end if;
  select public._loonars2_ekstrak_rekening(c.catatan) into v_rek from public.loonars2_cicilan c
   where position(' | rek:' in coalesce(c.catatan, '')) > 0 and public._loonars2_kunci_penerima(c.catatan) = v_key
   order by c.id desc limit 1;
  return v_rek;
end;
$$;

create or replace function public._loonars2_ingat_rekening_toko(p_toko text, p_rek text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id smallint := public._loonars2_cari_toko(p_toko, false);
begin
  if v_id is not null and p_rek is not null then
    update public.loonars2_toko set catatan = 'rek: ' || p_rek where id = v_id;
  end if;
end;
$$;

create or replace function public._loonars2_hapus_rekening(p_teks text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(coalesce(p_teks, ''), '\s*\|\s*rek:.*$', ''));
$$;

create or replace function public._loonars2_rentang_unit(p_nomor integer[])
returns text
language plpgsql
immutable
as $$
declare
  a integer[] := (select array_agg(distinct x order by x) from unnest(p_nomor) x);
  v_out text := '';
  v_mulai integer;
  v_akhir integer;
  i integer;
begin
  if a is null or cardinality(a) = 0 then return ''; end if;
  v_mulai := a[1]; v_akhir := a[1];
  for i in 2..cardinality(a) + 1 loop
    if i <= cardinality(a) and a[i] = v_akhir + 1 then
      v_akhir := a[i];
    else
      v_out := v_out || case when v_out = '' then '' else ',' end
               || case when v_mulai = v_akhir then v_mulai::text when v_akhir = v_mulai + 1 then v_mulai || ',' || v_akhir else v_mulai || '–' || v_akhir end;
      if i <= cardinality(a) then v_mulai := a[i]; v_akhir := a[i]; end if;
    end if;
  end loop;
  return v_out;
end;
$$;

-- 2. Lengkapi / tanyakan rekening ------------------------------------------------------
create or replace function public._loonars2_isi_dan_cek_rekening(p_aksi text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb := coalesce(p_data, '{}'::jsonb) - '_perlu_rekening';
  v_out jsonb := '[]'::jsonb;
  v_kurang jsonb := '[]'::jsonb;
  b jsonb;
  v_no integer := 0;
  v_jenis text;
  v_rek text;
  v_otomatis boolean;
  v_dsk text;
begin
  if p_aksi = 'ajukan_mingguan' then
    for b in select * from jsonb_array_elements(coalesce(v_data -> 'baris', '[]'::jsonb)) loop
      v_no := v_no + 1;
      v_jenis := coalesce(b ->> 'jenis', 'material');
      if v_jenis = 'retensi' or (v_jenis = 'tukang' and nullif(b ->> 'nominal', '') is null) then
        v_out := v_out || b;
        continue;
      end if;
      v_dsk := coalesce(b ->> 'deskripsi', '');
      v_rek := coalesce(public._loonars2_ekstrak_rekening(nullif(trim(b ->> 'rekening'), '')), public._loonars2_ekstrak_rekening(v_dsk));
      v_otomatis := false;
      if v_rek is null then
        v_rek := public._loonars2_rekening_dikenal(case when v_jenis = 'cicilan' then coalesce(b ->> 'toko', v_dsk) else coalesce(nullif(b ->> 'toko', ''), v_dsk) end);
        v_otomatis := v_rek is not null;
      end if;
      if v_rek is null then
        v_kurang := v_kurang || jsonb_build_object('no', v_no, 'nama', left(coalesce(nullif(b ->> 'toko', ''), v_dsk), 80), 'nominal', b -> 'nominal');
      else
        b := b || jsonb_build_object('rekening', v_rek, 'rekening_otomatis', v_otomatis);
        if position(' | rek:' in v_dsk) = 0 then
          b := b || jsonb_build_object('deskripsi', public._loonars2_hapus_rekening(v_dsk) || ' | rek: ' || v_rek);
        end if;
        if v_jenis = 'cicilan' and not v_otomatis then
          perform public._loonars2_ingat_rekening_toko(b ->> 'toko', v_rek);
        end if;
      end if;
      v_out := v_out || b;
    end loop;
    v_data := jsonb_set(v_data, '{baris}', v_out);
  else
    v_dsk := coalesce(v_data ->> 'deskripsi', '');
    v_rek := coalesce(public._loonars2_ekstrak_rekening(nullif(trim(v_data ->> 'rekening'), '')), public._loonars2_ekstrak_rekening(v_dsk));
    v_otomatis := false;
    if v_rek is null then
      v_rek := public._loonars2_rekening_dikenal(coalesce(nullif(v_data ->> 'toko', ''), v_dsk));
      v_otomatis := v_rek is not null;
    end if;
    if v_rek is null then
      v_kurang := jsonb_build_array(jsonb_build_object('no', 1, 'nama', left(coalesce(nullif(v_data ->> 'toko', ''), v_dsk), 80), 'nominal', v_data -> 'nominal'));
    else
      v_data := v_data || jsonb_build_object('rekening', v_rek, 'rekening_otomatis', v_otomatis);
      if position(' | rek:' in v_dsk) = 0 then
        v_data := v_data || jsonb_build_object('deskripsi', public._loonars2_hapus_rekening(v_dsk) || ' | rek: ' || v_rek);
      end if;
    end if;
  end if;
  return jsonb_build_object('data', v_data, 'kurang', v_kurang);
end;
$$;

create or replace function public._loonars2_teks_minta_rekening(p_kurang jsonb)
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
  return '🏦 Nomor rekening tujuan belum ada untuk:' || v_teks
    || E'\n\nBalas dengan rekeningnya (nama bank, nomor, a.n.), mis.\n'
    || case when jsonb_array_length(p_kurang) > 1 then E'1. BCA 1234567890 a.n. Sarno\n2. Mandiri 9876543210 a.n. Toko Maju'
            else 'BCA 1234567890 a.n. Sarno' end
    || E'\n\nRekening saya ingat untuk pengajuan berikutnya, jadi cukup sekali. Tidak ada rekening? Balas "L2 tanpa rekening".';
end;
$$;

create or replace function public._loonars2_wa_rekening(p_user public.loonars2_wa_users, p_data jsonb, p_tanpa boolean)
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
  k jsonb;
  v_no integer;
  v_rek text;
  v_jalur text[];
  v_dsk text;
begin
  if p_user.peran <> 'pelaksana' then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  select * into v_pend from public.loonars2_wa_pending
   where nomor = p_user.nomor and kedaluwarsa_pada > now() and data ? '_perlu_rekening';
  if not found then
    return jsonb_build_object('status', 'tidak_ada_pending');
  end if;
  v_data := v_pend.data;
  v_kurang := v_pend.data -> '_perlu_rekening';
  v_awal := jsonb_array_length(v_kurang);

  if p_tanpa then
    update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
    return public._loonars2_wa_jalankan(p_user, v_pend.aksi, (v_data - '_perlu_rekening') || '{"tanpa_rekening":true}'::jsonb, false);
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_data -> 'daftar', '[]'::jsonb)) loop
    v_rek := public._loonars2_ekstrak_rekening(it ->> 'rekening');
    continue when v_rek is null;
    v_no := coalesce(nullif(it ->> 'no', '')::integer, (v_kurang -> 0 ->> 'no')::integer);
    continue when not exists (select 1 from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer = v_no);
    if v_pend.aksi = 'ajukan_mingguan' then
      v_jalur := array['baris', (v_no - 1)::text];
      v_dsk := coalesce(v_data #>> (v_jalur || 'deskripsi'::text), '');
      v_data := jsonb_set(v_data, v_jalur || 'rekening'::text, to_jsonb(v_rek));
      v_data := jsonb_set(v_data, v_jalur || 'deskripsi'::text, to_jsonb(public._loonars2_hapus_rekening(v_dsk) || ' | rek: ' || v_rek));
      if v_data #>> (v_jalur || 'jenis'::text) = 'cicilan' then
        perform public._loonars2_ingat_rekening_toko(v_data #>> (v_jalur || 'toko'::text), v_rek);
      end if;
    else
      v_dsk := coalesce(v_data ->> 'deskripsi', '');
      v_data := v_data || jsonb_build_object('rekening', v_rek, 'deskripsi', public._loonars2_hapus_rekening(v_dsk) || ' | rek: ' || v_rek);
    end if;
    v_kurang := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_kurang) x where (x ->> 'no')::integer <> v_no), '[]'::jsonb);
  end loop;

  if jsonb_array_length(v_kurang) = v_awal then
    return jsonb_build_object('status', 'perlu_info', 'balasan',
      '🏦 Rekening belum terbaca. Tulis nama bank, nomor, dan a.n., mis. "BCA 1234567890 a.n. Sarno".' || E'\n\n' || public._loonars2_teks_minta_rekening(v_kurang));
  end if;
  if jsonb_array_length(v_kurang) > 0 then
    update public.loonars2_wa_pending set data = v_data || jsonb_build_object('_perlu_rekening', v_kurang), kedaluwarsa_pada = now() + interval '30 minutes'
     where nomor = p_user.nomor;
    return jsonb_build_object('status', 'menunggu_rekening', 'balasan', '✅ Rekening dicatat.' || E'\n\n' || public._loonars2_teks_minta_rekening(v_kurang));
  end if;
  update public.loonars2_wa_pending set kedaluwarsa_pada = now() - interval '1 second' where nomor = p_user.nomor;
  return public._loonars2_wa_jalankan(p_user, v_pend.aksi, v_data - '_perlu_rekening', false);
end;
$$;

-- 3. Pesan ke owner ala Loonars 1 ------------------------------------------------------
create or replace function public._loonars2_blok_rekening(p_rek text)
returns text
language sql
immutable
as $$
  select case when p_rek is null then E'🏦 Rekening tujuan: (belum dilampirkan pelaksana)'
    else E'🏦 Rekening tujuan:\n' || p_rek || E'\n🔢 No. rek (salin): ' || substring(p_rek from '[0-9]{8,18}') end;
$$;

create or replace function public._loonars2_teks_kelompok(p_kelompok text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_item text := '';
  v_total numeric := 0;
  v_n integer := 0;
  v_dari text;
  v_menunggu boolean := false;
  v_buffer boolean := false;
  v_lewat boolean := false;
  v_belum boolean := false;
  v_rek text;
  v_unit integer[] := '{}';
  v_saldo_c numeric;
  v_tertunda numeric := public._loonars2_total_tertunda();
  v_teks text;
  v_dsk text;
  v_pesanan integer;
  v_kat text;
begin
  for r in
    select c.id, c.nominal, c.status, c.diajukan_oleh, c.catatan, t.nama as nama_toko, t.catatan as rek_toko, vt.sisa_utang
      from public.loonars2_cicilan c join public.loonars2_toko t on t.id = c.toko_id
      join public.loonars2_v_toko vt on vt.id = c.toko_id
     where c.kelompok = p_kelompok order by c.id
  loop
    v_n := v_n + 1;
    v_dari := coalesce(v_dari, r.diajukan_oleh);
    v_total := v_total + r.nominal;
    v_menunggu := v_menunggu or r.status = 'menunggu';
    v_item := v_item || case when v_item = '' then '' else '; ' end || 'Cicilan utang ' || r.nama_toko || ' (sisa utang ' || public.loonars2_rp(r.sisa_utang) || ')'
              || case when r.nominal > r.sisa_utang then ' ⚠️ melebihi sisa utang' else '' end;
    v_rek := coalesce(v_rek, public._loonars2_ekstrak_rekening(r.catatan), public._loonars2_ekstrak_rekening(r.rek_toko));
  end loop;

  for r in
    select m.id, m.unit_id, m.kategori, m.deskripsi, m.toko, m.nominal, m.status, m.diajukan_oleh, m.pakai_buffer, m.melewati_buffer,
           m.unit_belum_terdanai, m.pesanan_id, u.nomor as nomor_unit
      from public.loonars2_material_requests m join public.loonars2_units u on u.id = m.unit_id
     where m.kelompok = p_kelompok order by m.id
  loop
    v_n := v_n + 1;
    v_dari := coalesce(v_dari, r.diajukan_oleh);
    v_total := v_total + r.nominal;
    v_menunggu := v_menunggu or r.status = 'menunggu';
    v_buffer := v_buffer or (r.pakai_buffer and r.status = 'menunggu');
    v_lewat := v_lewat or (r.melewati_buffer and r.status = 'menunggu');
    v_belum := v_belum or r.unit_belum_terdanai;
    v_unit := v_unit || r.nomor_unit;
    v_pesanan := coalesce(v_pesanan, r.pesanan_id);
    v_kat := coalesce(v_kat, r.kategori);
    v_rek := coalesce(v_rek, public._loonars2_ekstrak_rekening(r.deskripsi));
    v_dsk := coalesce(v_dsk, regexp_replace(public._loonars2_hapus_rekening(r.deskripsi), '\s+—\s+bahan kolektif, bagian unit ini.*$', ''));
  end loop;
  if v_n = 0 then return null; end if;

  if v_dsk is not null then
    if v_pesanan is not null then
      select coalesce(public._loonars2_hapus_rekening(deskripsi), v_dsk) into v_dsk from public.loonars2_pesanan_bahan where id = v_pesanan;
    end if;
    v_item := v_item || case when v_item = '' then '' else '; ' end
              || case v_kat when 'tukang' then 'Kontraktor/tukang' when 'material' then 'Belanja' else 'Biaya' end || ': ' || left(v_dsk, 300);
  end if;

  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  v_teks := '📋 *PENGAJUAN LOONARS 2 — ' || p_kelompok || '*'
    || E'\n🧾 Item: ' || v_item
    || E'\n💰 Nilai: ' || public.loonars2_rp(v_total)
    || E'\n' || public._loonars2_blok_rekening(v_rek)
    || E'\n👤 Diinput oleh: ' || coalesce(v_dari, '-')
    || case when cardinality(v_unit) > 0 then E'\n🏠 Unit: ' || public._loonars2_rentang_unit(v_unit) || case when cardinality(v_unit) > 1 then ' (dibagi rata)' else '' end else '' end;
  if v_lewat then v_teks := v_teks || E'\n🔴 Melewati biaya bangun + buffer unit.';
  elsif v_buffer then v_teks := v_teks || E'\n🟠 Memakai buffer unit — butuh persetujuan khusus.'; end if;
  if v_saldo_c < v_total then
    v_teks := v_teks || E'\n⚠️ Saldo C ' || public.loonars2_rp(v_saldo_c) || ' kurang dari nilai ini; transfer Bapak dicatat sebagai dana talangan.';
  end if;
  if v_belum then v_teks := v_teks || E'\n⚠️ Ada unit yang belum terdanai penuh di C.'; end if;
  if v_tertunda > 0 then
    v_teks := v_teks || E'\n⚠️ Masih ada ' || public.loonars2_rp(v_tertunda) || ' belum dipindahkan dari A.';
  end if;
  if v_menunggu then
    v_teks := v_teks || E'\n\n💸 Cukup transfer sesuai rekening di atas, lalu kirim foto bukti transfer ke WhatsApp ini — otomatis dibaca AI, dicatat (transfer = persetujuan), dan diteruskan ke Vando.'
      || E'\n❌ Kalau ada yang salah, balas TOLAK ' || p_kelompok || ' <alasan> untuk membatalkan sebelum transfer.'
      || case when v_buffer or v_lewat then E'\n(Memakai buffer: kalau mau disetujui tanpa transfer sekarang, balas SETUJUI ' || p_kelompok || ' BUFFER.)'
              else E'\n(Mau disetujui dulu tanpa transfer sekarang? Balas SETUJUI ' || p_kelompok || '.)' end;
  end if;
  return v_teks;
end;
$$;

create or replace function public._loonars2_teks_pengajuan(p_id integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  u record;
  v_saldo_c numeric;
  v_terpakai numeric;
  v_teks text;
  v_tertunda numeric := public._loonars2_total_tertunda();
begin
  select * into m from public.loonars2_material_requests where id = p_id;
  select * into u from public.loonars2_v_unit where id = m.unit_id;
  select saldo into v_saldo_c from public.loonars2_v_rekening where kode = 'C';
  v_terpakai := u.terpakai_konstruksi + u.komitmen_disetujui - case when m.status = 'disetujui' then m.nominal else 0 end;

  v_teks := '📋 *PENGAJUAN LOONARS 2 — L2-' || m.id || '*'
    || E'\n🧾 Item: ' || initcap(m.kategori) || ': ' || left(public._loonars2_hapus_rekening(m.deskripsi), 400)
    || E'\n💰 Nilai: ' || public.loonars2_rp(m.nominal)
    || E'\n' || public._loonars2_blok_rekening(public._loonars2_ekstrak_rekening(m.deskripsi))
    || coalesce(E'\n🏪 Toko/penerima: ' || m.toko, '')
    || E'\n👤 Diinput oleh: ' || m.diajukan_oleh
    || E'\n🏠 ' || public._loonars2_label_unit(m.unit_id)
    || E'\n📊 Budget unit: terpakai ' || public.loonars2_rp(v_terpakai + m.nominal) || ' / ' || public.loonars2_rp(u.biaya_bangun);
  if m.melewati_buffer then
    v_teks := v_teks || E'\n🔴 Melewati biaya bangun + buffer unit.';
  elsif m.pakai_buffer then
    v_teks := v_teks || E'\n🟠 Memakai buffer unit — butuh persetujuan khusus.';
  end if;
  if m.saldo_c_kurang then v_teks := v_teks || E'\n⚠️ Saldo C ' || public.loonars2_rp(v_saldo_c) || ' kurang; transfer Bapak dicatat sebagai dana talangan.'; end if;
  if m.unit_belum_terdanai then v_teks := v_teks || E'\n⚠️ Unit belum terdanai penuh di C.'; end if;
  if v_tertunda > 0 then
    v_teks := v_teks || E'\n⚠️ Masih ada ' || public.loonars2_rp(v_tertunda) || ' belum dipindahkan dari A.';
  end if;
  if m.status = 'menunggu' then
    v_teks := v_teks || E'\n\n💸 Cukup transfer sesuai rekening di atas, lalu kirim foto bukti transfer ke WhatsApp ini — otomatis dibaca AI, dicatat (transfer = persetujuan), dan diteruskan ke Vando.'
      || E'\n❌ Kalau ada yang salah, balas TOLAK L2-' || m.id || ' <alasan> untuk membatalkan sebelum transfer.'
      || case when m.pakai_buffer or m.melewati_buffer then E'\n(Memakai buffer: untuk menyetujui tanpa transfer sekarang, balas SETUJUI L2-' || m.id || ' BUFFER.)'
              else E'\n(Mau disetujui dulu tanpa transfer sekarang? Balas SETUJUI L2-' || m.id || '.)' end;
  end if;
  return v_teks;
end;
$$;

revoke execute on function public._loonars2_ekstrak_rekening(text) from public, anon, authenticated;
revoke execute on function public._loonars2_kunci_penerima(text) from public, anon, authenticated;
revoke execute on function public._loonars2_hapus_rekening(text) from public, anon, authenticated;
revoke execute on function public._loonars2_rentang_unit(integer[]) from public, anon, authenticated;
revoke execute on function public._loonars2_blok_rekening(text) from public, anon, authenticated;
revoke execute on function public._loonars2_teks_minta_rekening(jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_isi_dan_cek_rekening(text, jsonb) from public, anon, authenticated;
revoke execute on function public._loonars2_wa_rekening(public.loonars2_wa_users, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public._loonars2_rekening_dikenal(text) from public, anon, authenticated;
revoke execute on function public._loonars2_ingat_rekening_toko(text, text) from public, anon, authenticated;

-- 4. Pengajuan mingguan per baris + sambungan di pintu WA ----------------------------------
do $$
declare
  v_def text;
  v_new text;
  v_tanda text;
begin
  v_def := pg_get_functiondef('public._loonars2_ajukan_mingguan(jsonb,text,text,text)'::regprocedure);
  v_new := replace(v_def, E'  v_sisa numeric;\nbegin\n', E'  v_sisa numeric;\n  v_kodes text[] := ''{}'';\n  v_kodebahan text;\nbegin\n');
  v_new := replace(v_new, E'  v_kelompok := public._loonars2_kode_baru(''M'');\n  for v_baris in select * from jsonb_array_elements(p_baris) loop\n    v_no := v_no + 1;\n',
                          E'  for v_baris in select * from jsonb_array_elements(p_baris) loop\n    v_no := v_no + 1;\n    v_kelompok := public._loonars2_kode_baru(''M'');\n    v_kodes := v_kodes || v_kelompok;\n');
  v_new := replace(v_new, $q$v_ringkas := v_ringkas || E'\n• $q$, $q$v_ringkas := v_ringkas || E'\n• ' || v_kelompok || ': ' || E'$q$);
  v_new := replace(v_new, $q$      v_alok := v_alok || E'\n\n' || (v_hasil ->> 'alokasi');$q$, $q$      v_alok := v_alok || E'\n\n' || (v_hasil ->> 'alokasi');
      v_kodebahan := v_kelompok;$q$);
  v_new := replace(v_new,
    $q$  v_isi_owner := public._loonars2_teks_kelompok(v_kelompok);
  perform public._loonars2_kirim('owner', v_isi_owner || v_alok || coalesce(E'\n\n' || nullif(trim(v_dibuat), ''), ''), 'pengajuan_mingguan', 'mingguan:' || v_kelompok);$q$,
    $q$  foreach v_kelompok in array v_kodes loop
    perform public._loonars2_kirim('owner', public._loonars2_teks_kelompok(v_kelompok)
      || case when v_kelompok = v_kodes[1] then coalesce(E'\n\n' || nullif(trim(v_dibuat), ''), '') else '' end,
      'pengajuan_mingguan', 'mingguan:' || v_kelompok);
  end loop;$q$);
  v_new := replace(v_new, $q$'kode', v_kelompok, 'balasan',$q$, $q$'kode', v_kodes[1], 'kodes', to_jsonb(v_kodes), 'balasan',$q$);
  v_new := replace(v_new, $q$'✅ Pengajuan ' || v_kelompok || ' diterima: '$q$, $q$'✅ Pengajuan ' || array_to_string(v_kodes, ', ') || ' diterima: '$q$);
  v_new := replace(v_new, $q$Status: MENUNGGU PERSETUJUAN OWNER. Setelah dibayar, kirim foto bukti transfer dengan keterangan "L2 bayar ' || v_kelompok || '".'$q$,
                          $q$Status: MENUNGGU PERSETUJUAN OWNER. Tiap baris sampai ke Pak Avi sebagai pengajuan sendiri lengkap dengan rekeningnya; setelah ditransfer, buktinya otomatis dicatat dan diteruskan ke Anda.'$q$);
  v_new := replace(v_new, $q$Pembagian bahan ke unit salah? Koreksi: "L2 koreksi ' || v_kelompok || ' <bahan> unit 1,2,3".'$q$,
                          $q$Pembagian bahan ke unit salah? Koreksi: "L2 koreksi ' || coalesce(v_kodebahan, v_kodes[1]) || ' <bahan> unit 1,2,3".'$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_ajukan_mingguan gagal (tidak ada perubahan)'; end if;
  foreach v_tanda in array array['v_kodes text[]', 'v_kodes := v_kodes || v_kelompok', 'v_kelompok || '': '' || E''', 'v_kodebahan := v_kelompok',
      'foreach v_kelompok in array v_kodes', '''kodes'', to_jsonb(v_kodes)', 'array_to_string(v_kodes', 'Tiap baris sampai ke Pak Avi', 'coalesce(v_kodebahan'] loop
    if position(v_tanda in v_new) = 0 then raise exception 'penggantian _loonars2_ajukan_mingguan gagal: tidak ditemukan "%"', v_tanda; end if;
  end loop;
  execute v_new;

  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := regexp_replace(v_def, E'declare\n', E'declare\n  v_rekcek jsonb;\n', 'n');
  -- pelaksana wajib melampirkan rekening (kecuali utang kredit / upah borongan otomatis)
  v_new := replace(v_new,
    E'  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.\n',
    $q$  -- Pelaksana: rekening tujuan wajib ada (dibaca dari pesan, diingat dari pengajuan sebelumnya, atau ditanyakan).
  if p_user.peran = 'pelaksana' and coalesce(p_data ->> 'tanpa_rekening', 'false') <> 'true'
     and (p_aksi in ('ajukan_mingguan', 'ajukan') or (p_aksi = 'bahan' and coalesce(p_data ->> 'utang', 'false') <> 'true')) then
    v_rekcek := public._loonars2_isi_dan_cek_rekening(p_aksi, p_data);
    p_data := v_rekcek -> 'data';
    if jsonb_array_length(v_rekcek -> 'kurang') > 0 then
      insert into public.loonars2_wa_pending (nomor, aksi, data) values (p_user.nomor, p_aksi, p_data || jsonb_build_object('_perlu_rekening', v_rekcek -> 'kurang'))
      on conflict (nomor) do update set aksi = excluded.aksi, data = excluded.data, dibuat_pada = now(), kedaluwarsa_pada = now() + interval '30 minutes';
      return jsonb_build_object('status', 'menunggu_rekening', 'balasan', public._loonars2_teks_minta_rekening(v_rekcek -> 'kurang'));
    end if;
  end if;

  -- Pesan pelaksana yang unitnya tidak disebut: tanya dulu unit mana yang sedang dibangun.
$q$);
  v_new := replace(v_new, E'elsif p_aksi = \'daftar_borongan\' then\n',
    E'elsif p_aksi = \'rekening\' then\n    return public._loonars2_wa_rekening(p_user, p_data, false);\n\n  elsif p_aksi = \'tanpa_rekening\' then\n    return public._loonars2_wa_rekening(p_user, p_data, true);\n\n  elsif p_aksi = \'daftar_borongan\' then\n');
  if v_new = v_def or position('_loonars2_isi_dan_cek_rekening' in v_new) = 0 or position('tanpa_rekening' in v_new) = 0 or position('v_rekcek jsonb' in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal';
  end if;
  execute v_new;
end;
$$;

-- 5. Nama item bahan tidak boleh memuat rekening (RAB per unit tetap bersih)
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_pesan_bahan(text,text,text,jsonb,numeric,smallint[],text,date,text,text,text,text)'::regprocedure);
  v_new := replace(v_def, $q$jsonb_build_object('nama', coalesce(nullif(trim(p_deskripsi), ''), 'bahan'))$q$,
                          $q$jsonb_build_object('nama', coalesce(nullif(public._loonars2_hapus_rekening(p_deskripsi), ''), 'bahan'))$q$);
  if v_new = v_def then raise exception 'penggantian _loonars2_pesan_bahan gagal'; end if;
  execute v_new;
end;
$$;
