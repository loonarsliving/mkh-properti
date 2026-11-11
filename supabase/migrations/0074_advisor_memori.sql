-- ============================================================================
-- 0074 — Loonars AI Advisor: memori perusahaan (D-2026-008)
-- ============================================================================
-- Direksi AI "makin lama makin paham" Loonars Mahakarya: fakta model bisnis,
-- beban, hambatan, pelajaran, dan tujuan yang disahkan founder. Setiap sidang
-- board / mentor membaca memori aktif. Usulan dari board berstatus 'usulan'
-- sampai founder mengesahkan lewat WA. Hanya objek baru; akses lewat RPC
-- bergerbang x-advisor-secret (_advisor_wajib dari 0073b).
-- ============================================================================

create table if not exists public.advisor_memori (
  id bigserial primary key,
  kategori text not null default 'lain'
    check (kategori in ('model_bisnis', 'beban', 'hambatan', 'pelajaran', 'tujuan', 'aturan', 'lain')),
  teks text not null check (length(teks) between 3 and 1000),
  status text not null default 'usulan' check (status in ('usulan', 'aktif', 'arsip')),
  sumber text not null default 'founder' check (length(sumber) between 1 and 80),
  dibuat timestamptz not null default now(),
  diubah timestamptz not null default now()
);
create index if not exists advisor_memori_status_idx on public.advisor_memori (status, kategori);
alter table public.advisor_memori enable row level security;
revoke all on public.advisor_memori from anon, authenticated;

create or replace function public.advisor_memori_tambah(p_kategori text, p_teks text, p_status text, p_sumber text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public._advisor_wajib();
  if p_status not in ('usulan', 'aktif') then
    raise exception 'Status memori baru harus usulan atau aktif' using errcode = '22023';
  end if;
  insert into public.advisor_memori (kategori, teks, status, sumber)
  values (coalesce(nullif(p_kategori, ''), 'lain'), p_teks, p_status, left(coalesce(nullif(p_sumber, ''), 'founder'), 80))
  returning id into v_id;
  insert into public.advisor_log (aksi, ringkas) values ('memori_tambah', jsonb_build_object('id', v_id, 'status', p_status));
  return v_id;
end;
$$;

create or replace function public.advisor_memori_ubah(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  perform public._advisor_wajib();
  if p_status not in ('aktif', 'arsip') then
    raise exception 'Status memori tidak valid' using errcode = '22023';
  end if;
  update public.advisor_memori set status = p_status, diubah = now() where id = p_id;
  get diagnostics v_n = row_count;
  insert into public.advisor_log (aksi, ringkas) values ('memori_ubah', jsonb_build_object('id', p_id, 'status', p_status, 'ada', v_n > 0));
  return jsonb_build_object('id', p_id, 'status', p_status, 'ada', v_n > 0);
end;
$$;

create or replace function public.advisor_memori_daftar(p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._advisor_wajib();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'kategori', m.kategori, 'teks', m.teks, 'status', m.status, 'sumber', m.sumber, 'dibuat', m.dibuat) order by m.kategori, m.id)
    from public.advisor_memori m
    where (p_status is null and m.status <> 'arsip') or m.status = p_status), '[]'::jsonb);
end;
$$;

revoke execute on function public.advisor_memori_tambah(text, text, text, text) from public;
grant execute on function public.advisor_memori_tambah(text, text, text, text) to anon, authenticated;
revoke execute on function public.advisor_memori_ubah(bigint, text) from public;
grant execute on function public.advisor_memori_ubah(bigint, text) to anon, authenticated;
revoke execute on function public.advisor_memori_daftar(text) from public;
grant execute on function public.advisor_memori_daftar(text) to anon, authenticated;
