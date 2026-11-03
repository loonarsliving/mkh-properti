-- 0063 — Loonars 2: satu transfer untuk beberapa pengajuan ke rekening yang sama
--
-- Insiden 3 Nov 2026: Vando mengajukan pasir Rp 5.250.000, belanja material
-- Rp 1.340.500 dan kos Rp 1.000.000 (M-77, M-78, M-79), semuanya ke BCA
-- 7855066190 a.n. Naimuddin Irfan. Owner membayar sekaligus Rp 7.590.500 dalam
-- satu transfer dan mengirim fotonya. Pencocok (0049) hanya mencocokkan nominal
-- foto dengan SATU kode, jadi hasilnya "tidak_cocok" dan foto jatuh ke modul
-- slip gaji di MK Connect yang membalas "terbaca sebagai bukti transfer gaji".
--
-- Aturan owner: beberapa pengajuan ke rekening yang sama boleh dibayar dengan
-- satu transfer gabungan. Langkah baru (d), hanya bila (a)–(c) tidak menemukan
-- apa pun:
--   * Semua kode terbuka (M-n, L2-n, cicilan) dikelompokkan per rekening tujuan
--     (nomor rekening dari " | rek: …" di rincian, migrasi 0056).
--   * Bila nomor rekening terbaca di foto, hanya rekening itu yang dicoba.
--   * Cocok bila jumlah SEMUA kode terbuka ke rekening itu = nominal foto, atau
--     tepat SATU gabungan kode utuh (maks. 12 kode per rekening) = nominal foto.
--     Lebih dari satu kemungkinan -> "ambigu", owner diminta menyebut kodenya.
--   * Setiap kode lalu disetujui (bila owner & masih menunggu) dan dibayar
--     dengan fungsi yang sama seperti langkah (a)/(b). Tidak ada rumus baru.
-- Langkah (a)–(c) tidak berubah.

create or replace function public._loonars2_nomor_rekening(p_teks text)
returns text
language sql
immutable
as $$
  -- "BCA 7855066190 a.n. X" -> "7855066190" (hasil _loonars2_ekstrak_rekening), null bila tidak ada rekening.
  select substring(public._loonars2_ekstrak_rekening(p_teks) from '\d{8,18}');
$$;

create or replace function public._loonars2_bukti_transfer(p_user loonars2_wa_users, p_nominal numeric, p_penerima text, p_bukti text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_aktor text := 'wa:' || p_user.nama || ' (' || p_user.nomor || ')';
  v_kand jsonb := '[]'::jsonb;
  c record;
  k jsonb;
  v_n integer;
  v_teks text := '';
  v_pesan text;
  v_id integer;
  v_digit_foto text := regexp_replace(coalesce(p_penerima, ''), '\D', '', 'g');
  v_gab jsonb := '[]'::jsonb;
  v_kode jsonb;
  v_total numeric;
  v_mask bigint;
  v_cnt integer;
  v_cocok jsonb;
begin
  perform public._loonars2_set_aktor(v_aktor, 'wa');
  if p_nominal is null or p_nominal <= 0 then
    return jsonb_build_object('status', 'tidak_cocok');
  end if;

  -- (a) satu kode M-n: jumlah seluruh baris yang belum dibayar = nominal di foto
  for c in
    select x.kelompok, sum(x.nominal) as total, bool_or(x.status = 'menunggu') as ada_menunggu
      from (
        select kelompok, nominal, status from public.loonars2_material_requests where kelompok like 'M-%' and status in ('menunggu', 'disetujui')
        union all
        select kelompok, nominal, status from public.loonars2_cicilan where status in ('menunggu', 'disetujui')
      ) x
     group by x.kelompok having sum(x.nominal) = p_nominal
  loop
    v_kand := v_kand || jsonb_build_object('tipe', 'M', 'kode', c.kelompok, 'menunggu', c.ada_menunggu);
  end loop;
  -- (b) pengajuan tunggal L2-n
  for c in select id, status from public.loonars2_material_requests
            where kelompok is null and status in ('menunggu', 'disetujui') and nominal = p_nominal order by id loop
    v_kand := v_kand || jsonb_build_object('tipe', 'L2', 'id', c.id, 'kode', 'L2-' || c.id, 'menunggu', c.status = 'menunggu');
  end loop;
  -- (c) transfer A -> B/C/D yang menunggu konfirmasi (hanya owner)
  if p_user.peran = 'owner' then
    for c in select id, ke_rekening from public.loonars2_allocations where status = 'menunggu' and nominal = p_nominal order by id loop
      v_kand := v_kand || jsonb_build_object('tipe', 'T', 'id', c.id, 'kode', 'T' || c.id || ' (ke ' || c.ke_rekening || ')', 'menunggu', false);
    end loop;
  end if;

  v_n := jsonb_array_length(v_kand);

  -- (d) satu transfer gabungan untuk beberapa kode ke rekening yang sama
  if v_n = 0 then
    for c in
      with kode as (
        select 'M' as tipe, kelompok as kode, null::integer as id, sum(nominal) as total, bool_or(status = 'menunggu') as menunggu,
               max(public._loonars2_nomor_rekening(deskripsi)) as norek
          from public.loonars2_material_requests where kelompok like 'M-%' and status in ('menunggu', 'disetujui') group by kelompok
        union all
        select 'M', kelompok, null, sum(nominal), bool_or(status = 'menunggu'), max(public._loonars2_nomor_rekening(catatan))
          from public.loonars2_cicilan where status in ('menunggu', 'disetujui') group by kelompok
        union all
        select 'L2', 'L2-' || id, id, nominal, status = 'menunggu', public._loonars2_nomor_rekening(deskripsi)
          from public.loonars2_material_requests where kelompok is null and status in ('menunggu', 'disetujui')
      )
      select norek, jsonb_agg(jsonb_build_object('tipe', tipe, 'kode', kode, 'id', id, 'total', total, 'menunggu', menunggu) order by kode) as daftar,
             count(*) as n, sum(total) as jumlah
        from kode
       where norek is not null
         and (length(v_digit_foto) < 8 or position(norek in v_digit_foto) > 0 or position(v_digit_foto in norek) > 0)
       group by norek
      having count(*) >= 2
    loop
      if c.jumlah = p_nominal then
        v_gab := v_gab || jsonb_build_array(c.daftar);
      elsif c.n <= 12 then
        -- tepat satu gabungan kode utuh yang jumlahnya = nominal foto
        v_cnt := 0;
        v_cocok := null;
        for v_mask in 1 .. (1::bigint << c.n::int) - 2 loop
          continue when bit_count(v_mask::bit(12)) < 2;
          select sum((e ->> 'total')::numeric) into v_total
            from jsonb_array_elements(c.daftar) with ordinality as t(e, i)
           where (v_mask >> (i - 1)::int) & 1 = 1;
          if v_total = p_nominal then
            v_cnt := v_cnt + 1;
            select jsonb_agg(e order by i) into v_cocok
              from jsonb_array_elements(c.daftar) with ordinality as t(e, i)
             where (v_mask >> (i - 1)::int) & 1 = 1;
          end if;
        end loop;
        if v_cnt = 1 then
          v_gab := v_gab || jsonb_build_array(v_cocok);
        elsif v_cnt > 1 then
          v_gab := v_gab || jsonb_build_array(jsonb_build_array(jsonb_build_object('ambigu', true, 'norek', c.norek)));
        end if;
      end if;
    end loop;

    if jsonb_array_length(v_gab) = 1 and not ((v_gab -> 0 -> 0) ? 'ambigu') then
      if p_user.peran <> 'owner' and exists (select 1 from jsonb_array_elements(v_gab -> 0) e where (e ->> 'menunggu')::boolean) then
        select string_agg(e ->> 'kode', ', ') into v_teks from jsonb_array_elements(v_gab -> 0) e;
        return jsonb_build_object('status', 'ok', 'balasan', '📎 Bukti transfer ' || public.loonars2_rp(p_nominal) || ' cocok dengan gabungan ' || v_teks
          || E'.\n⏳ Sebagian pengajuan ini belum disetujui owner, jadi belum dicatat dibayar.');
      end if;
      select string_agg(e ->> 'kode', ', ') into v_teks from jsonb_array_elements(v_gab -> 0) e;
      v_pesan := '📎 Bukti transfer ' || public.loonars2_rp(p_nominal) || coalesce(' ke ' || nullif(trim(p_penerima), ''), '')
        || ' cocok dengan gabungan ' || jsonb_array_length(v_gab -> 0) || ' pengajuan ke rekening yang sama: ' || v_teks || '.';
      if p_user.peran = 'owner' then perform set_config('loonars2.talangan', 'ya', true); end if;
      for v_kode in select * from jsonb_array_elements(v_gab -> 0) loop
        if (v_kode ->> 'menunggu')::boolean then
          if v_kode ->> 'tipe' = 'M' then
            v_pesan := v_pesan || E'\n' || public._loonars2_putuskan_kode(v_kode ->> 'kode', true, null, true, v_aktor, 'wa');
          else
            v_pesan := v_pesan || E'\n' || public._loonars2_putuskan((v_kode ->> 'id')::int, true, null, true, v_aktor, 'wa');
          end if;
        end if;
        if v_kode ->> 'tipe' = 'M' then
          v_pesan := v_pesan || E'\n' || public._loonars2_bayar_kelompok(v_kode ->> 'kode', p_bukti, v_aktor, 'wa');
        else
          v_pesan := v_pesan || E'\n' || public._loonars2_bayar_pengajuan((v_kode ->> 'id')::int, null, p_bukti, v_aktor, 'wa');
        end if;
      end loop;
      perform set_config('loonars2.talangan', '', true);
      return jsonb_build_object('status', 'ok', 'balasan', v_pesan);
    end if;

    if jsonb_array_length(v_gab) >= 1 then
      return jsonb_build_object('status', 'ambigu', 'balasan',
        '📎 Nominal di foto (' || public.loonars2_rp(p_nominal) || ') cocok dengan lebih dari satu gabungan pengajuan ke rekening yang sama.'
        || E'\n\nKirim ulang foto dengan keterangan "L2 bayar <kode>" untuk tiap kode, supaya tidak salah tempel.');
    end if;
    return jsonb_build_object('status', 'tidak_cocok');
  end if;

  if v_n > 1 then
    for k in select * from jsonb_array_elements(v_kand) loop
      v_teks := v_teks || E'\n• ' || (k ->> 'kode');
    end loop;
    return jsonb_build_object('status', 'ambigu', 'balasan',
      '📎 Nominal di foto (' || public.loonars2_rp(p_nominal) || ') cocok dengan beberapa pengajuan:' || v_teks
      || E'\n\nKirim ulang foto dengan keterangan "L2 bayar <kode>" supaya tidak salah tempel.');
  end if;

  k := v_kand -> 0;
  v_pesan := '📎 Bukti transfer ' || public.loonars2_rp(p_nominal) || coalesce(' ke ' || nullif(trim(p_penerima), ''), '') || ' cocok dengan ' || (k ->> 'kode') || '.';

  if k ->> 'tipe' = 'T' then
    return jsonb_build_object('status', 'ok', 'balasan', v_pesan || E'\n' || public._loonars2_konfirmasi(array[(k ->> 'id')::int], p_bukti, v_aktor, 'wa'));
  end if;

  if (k ->> 'menunggu')::boolean then
    if p_user.peran <> 'owner' then
      return jsonb_build_object('status', 'ok', 'balasan', v_pesan || E'\n⏳ Pengajuan ini belum disetujui owner, jadi belum dicatat dibayar.');
    end if;
    -- Owner sudah membayar = menyetujui.
    if k ->> 'tipe' = 'M' then
      v_pesan := v_pesan || E'\n' || public._loonars2_putuskan_kode(k ->> 'kode', true, null, true, v_aktor, 'wa');
    else
      v_pesan := v_pesan || E'\n' || public._loonars2_putuskan((k ->> 'id')::int, true, null, true, v_aktor, 'wa');
    end if;
  end if;

  if p_user.peran = 'owner' then perform set_config('loonars2.talangan', 'ya', true); end if;
  if k ->> 'tipe' = 'M' then
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_kelompok(k ->> 'kode', p_bukti, v_aktor, 'wa');
  else
    v_id := (k ->> 'id')::int;
    v_pesan := v_pesan || E'\n' || public._loonars2_bayar_pengajuan(v_id, null, p_bukti, v_aktor, 'wa');
  end if;
  perform set_config('loonars2.talangan', '', true);
  return jsonb_build_object('status', 'ok', 'balasan', v_pesan);
end;
$function$;
