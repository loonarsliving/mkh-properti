-- 0073c — RPC register (syarat lama ditandai batal, tidak dihapus)
-- Bagian dari register advisor (lihat 0073a untuk desain). Hanya objek baru.

-- Simpan/ubah keputusan (bukan CONFIRMED/REVIEWED). p: {id?, judul, isi, status?, review_on?, sumber?, syarat?:[{teks,tenggat}]}
create or replace function public.advisor_keputusan_simpan(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(p ->> 'id', '');
  v_status text := coalesce(nullif(p ->> 'status', ''), 'PROPOSED');
  v_tahun text := to_char(now() at time zone 'Asia/Jakarta', 'YYYY');
  v_n int;
  v_item jsonb;
  v_lama text;
begin
  perform public._advisor_wajib();
  if v_status in ('CONFIRMED', 'REVIEWED') then
    raise exception 'Status % hanya lewat konfirmasi founder', v_status using errcode = '22023';
  end if;
  if v_id is null then
    select coalesce(max(substring(id from 8 for 3)::int), 0) + 1 into v_n from public.advisor_keputusan where id like 'D-' || v_tahun || '-%';
    v_id := 'D-' || v_tahun || '-' || lpad(v_n::text, 3, '0');
  end if;
  select status into v_lama from public.advisor_keputusan where id = v_id;
  if v_lama in ('CONFIRMED', 'REVIEWED') then
    raise exception 'Keputusan % sudah %, tidak bisa diubah lewat simpan', v_id, v_lama using errcode = '22023';
  end if;
  insert into public.advisor_keputusan as k (id, judul, tanggal, status, isi, review_on, sumber)
  values (v_id, p ->> 'judul', coalesce((p ->> 'tanggal')::date, (now() at time zone 'Asia/Jakarta')::date), v_status,
          coalesce(p -> 'isi', '{}'::jsonb), (p ->> 'review_on')::date, 'wa')
  on conflict (id) do update set judul = excluded.judul, status = excluded.status, isi = excluded.isi,
    review_on = excluded.review_on, diubah = now();
  if jsonb_typeof(p -> 'syarat') = 'array' then
    update public.advisor_syarat set status = 'batal' where keputusan_id = v_id and status = 'terbuka';
    for v_item in select * from jsonb_array_elements(p -> 'syarat') loop
      insert into public.advisor_syarat (keputusan_id, teks, tenggat)
      values (v_id, v_item ->> 'teks', nullif(v_item ->> 'tenggat', '')::date);
    end loop;
  end if;
  insert into public.advisor_log (aksi, ringkas) values ('keputusan_simpan', jsonb_build_object('id', v_id, 'status', v_status));
  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

create or replace function public.advisor_keputusan_konfirmasi(p_id text, p_oleh text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  perform public._advisor_wajib();
  select status into v_status from public.advisor_keputusan where id = p_id for update;
  if v_status is null then
    return jsonb_build_object('hasil', 'tidak_ada', 'id', p_id);
  end if;
  if v_status <> 'PROPOSED' then
    return jsonb_build_object('hasil', 'status_' || lower(v_status), 'id', p_id);
  end if;
  update public.advisor_keputusan
     set status = 'CONFIRMED', confirmed_at = now(), confirmed_by = left(coalesce(p_oleh, 'founder'), 80), diubah = now()
   where id = p_id;
  insert into public.advisor_log (aksi, ringkas) values ('keputusan_konfirmasi', jsonb_build_object('id', p_id, 'oleh', left(coalesce(p_oleh, 'founder'), 80)));
  return jsonb_build_object('hasil', 'confirmed', 'id', p_id);
end;
$$;

create or replace function public.advisor_syarat_ubah(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  if p_status not in ('terbuka', 'selesai', 'batal') then
    raise exception 'Status syarat tidak valid' using errcode = '22023';
  end if;
  update public.advisor_syarat set status = p_status where id = p_id;
  insert into public.advisor_log (aksi, ringkas) values ('syarat_ubah', jsonb_build_object('id', p_id, 'status', p_status));
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create or replace function public.advisor_syarat_jatuh_tempo(p_hari int default 3)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'keputusan_id', s.keputusan_id, 'teks', s.teks, 'tenggat', s.tenggat) order by s.tenggat)
    from public.advisor_syarat s join public.advisor_keputusan k on k.id = s.keputusan_id
    where s.status = 'terbuka' and s.tenggat is not null and k.status in ('CONFIRMED', 'PROPOSED')
      and s.tenggat <= (now() at time zone 'Asia/Jakarta')::date + greatest(0, least(p_hari, 60))), '[]'::jsonb);
end;
$$;

create or replace function public.advisor_dokumen_simpan(p_jenis text, p_judul text, p_isi text, p_keputusan_id text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public._advisor_wajib();
  insert into public.advisor_dokumen (jenis, judul, isi, keputusan_id) values (p_jenis, p_judul, p_isi, nullif(p_keputusan_id, ''))
  returning id into v_id;
  insert into public.advisor_log (aksi, ringkas) values ('dokumen_simpan', jsonb_build_object('id', v_id, 'jenis', p_jenis));
  return v_id;
end;
$$;

create or replace function public.advisor_dokumen_ambil(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return (select jsonb_build_object('id', d.id, 'jenis', d.jenis, 'judul', d.judul, 'isi', d.isi, 'keputusan_id', d.keputusan_id, 'dibuat', d.dibuat)
          from public.advisor_dokumen d where d.id = p_id);
end;
$$;

create or replace function public.advisor_dokumen_terbaru(p_jumlah int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', d.id, 'jenis', d.jenis, 'judul', d.judul, 'dibuat', d.dibuat) as x
    from public.advisor_dokumen d order by d.id desc limit greatest(1, least(p_jumlah, 50))) t), '[]'::jsonb);
end;
$$;

create or replace function public.advisor_pengaturan_set(p_kunci text, p_nilai text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  insert into public.advisor_pengaturan (kunci, nilai) values (p_kunci, p_nilai)
  on conflict (kunci) do update set nilai = excluded.nilai, diubah = now();
end;
$$;

create or replace function public.advisor_pengaturan_get(p_kunci text)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return (select nilai from public.advisor_pengaturan where kunci = p_kunci);
end;
$$;


revoke execute on function public.advisor_keputusan_daftar() from public;
grant execute on function public.advisor_keputusan_daftar() to anon, authenticated;
revoke execute on function public.advisor_keputusan_simpan(jsonb) from public;
grant execute on function public.advisor_keputusan_simpan(jsonb) to anon, authenticated;
revoke execute on function public.advisor_keputusan_konfirmasi(text, text) from public;
grant execute on function public.advisor_keputusan_konfirmasi(text, text) to anon, authenticated;
revoke execute on function public.advisor_syarat_ubah(bigint, text) from public;
grant execute on function public.advisor_syarat_ubah(bigint, text) to anon, authenticated;
revoke execute on function public.advisor_syarat_jatuh_tempo(int) from public;
grant execute on function public.advisor_syarat_jatuh_tempo(int) to anon, authenticated;
revoke execute on function public.advisor_dokumen_simpan(text, text, text, text) from public;
grant execute on function public.advisor_dokumen_simpan(text, text, text, text) to anon, authenticated;
revoke execute on function public.advisor_dokumen_ambil(bigint) from public;
grant execute on function public.advisor_dokumen_ambil(bigint) to anon, authenticated;
revoke execute on function public.advisor_dokumen_terbaru(int) from public;
grant execute on function public.advisor_dokumen_terbaru(int) to anon, authenticated;
revoke execute on function public.advisor_pengaturan_set(text, text) from public;
grant execute on function public.advisor_pengaturan_set(text, text) to anon, authenticated;
revoke execute on function public.advisor_pengaturan_get(text) from public;
grant execute on function public.advisor_pengaturan_get(text) to anon, authenticated;
