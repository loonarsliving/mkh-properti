-- ============================================================================
-- 0060 — Kunci proyek/cabang selain Loonars 1 & Loonars 2 (per 1 Nov 2026)
-- ============================================================================
--
-- Keputusan owner 2026-11-01: hanya Loonars 1 (hospitality villa Yogyakarta)
-- dan Loonars 2 (Loonars Living; Loonars Coffee/LC memakai keuangan Loonars 2)
-- yang aktif. Proyek lain — AFP, IH, GCI, GCR, KDI — DIKUNCI per hari ini:
--
--   * TIDAK ADA data yang dihapus atau diubah. Jurnal, pengajuan, aset,
--     utang bank, dan data tukang proyek tersebut tetap ada dan tetap bisa
--     dibaca (laporan lama tetap bisa dibuka sebagai arsip).
--   * Mulai sekarang database MENOLAK penambahan / perubahan / penghapusan
--     baris milik proyek yang dikunci (trigger di bawah). Ini berlaku untuk
--     semua jalur: aplikasi web, sinkronisasi MK Connect, dan service role.
--   * Pengajuan lama yang masih 'pending' dari proyek yang dikunci TIDAK
--     disentuh; pengajuan itu masih boleh DITOLAK, tetapi tidak bisa
--     disetujui lagi (persetujuan bahan/tukang berlanjut ke transfer + jurnal,
--     yang memang sudah ditutup).
--   * HO (overhead) tidak dikunci: sinkronisasi HR MK Connect memakai HO.
--   * Tabel `branches` (portal lama): cabang selain Yogyakarta / Loonars 1
--     ditandai is_active = false (bisa dikembalikan).
--
-- Membuka kunci (hanya dengan persetujuan owner) = migrasi baru yang
-- menghapus baris proyek tersebut dari public.proyek_kunci.
--
-- Rollback penuh:
--   drop trigger ... (lihat daftar tabel di blok DO) ;
--   drop function public._tolak_proyek_dikunci();
--   drop table public.proyek_kunci;
--   update public.branches set is_active = true where id in (... daftar di bawah);
-- ============================================================================

create table if not exists public.proyek_kunci (
  proyek text primary key check (proyek = upper(trim(proyek)) and length(proyek) between 1 and 10),
  dikunci_sejak date not null,
  alasan text not null,
  dikunci_oleh text not null default 'owner',
  dibuat_pada timestamptz not null default now()
);
alter table public.proyek_kunci enable row level security;
revoke all on public.proyek_kunci from public, anon, authenticated;
grant select on public.proyek_kunci to authenticated;
drop policy if exists proyek_kunci_baca_staf on public.proyek_kunci;
create policy proyek_kunci_baca_staf on public.proyek_kunci
  for select to authenticated using ((select public.mkh_is_staf()));

insert into public.proyek_kunci (proyek, dikunci_sejak, alasan)
select v.p, date '2026-11-01',
       'Keputusan owner 2026-11-01: hanya Loonars 1 (hospitality Yogyakarta) dan Loonars 2 (Loonars Living + Loonars Coffee) yang aktif.'
from (values ('AFP'), ('IH'), ('GCI'), ('GCR'), ('KDI')) as v(p)
on conflict (proyek) do nothing;

create or replace function public._tolak_proyek_dikunci()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baru text;
  v_lama text;
  v_kunci public.proyek_kunci%rowtype;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    v_baru := upper(trim(new.proyek));
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_lama := upper(trim(old.proyek));
  end if;

  -- Pengajuan proyek dikunci masih boleh ditolak / diberi catatan,
  -- asalkan proyeknya tidak dipindah dan tidak berubah menjadi 'approved'.
  -- (IF bertingkat: PL/pgSQL tidak short-circuit akses kolom new.status.)
  if tg_table_name = 'pengajuan' and tg_op = 'UPDATE' then
    if v_baru is not distinct from v_lama
       and not (new.status = 'approved' and old.status is distinct from 'approved') then
      return new;
    end if;
  end if;

  select * into v_kunci from public.proyek_kunci
   where proyek in (coalesce(v_baru, ''), coalesce(v_lama, ''))
   order by dikunci_sejak limit 1;
  if found then
    raise exception 'Proyek % sudah dikunci sejak % (keputusan owner). Data proyek ini hanya bisa dibaca.',
      v_kunci.proyek, to_char(v_kunci.dikunci_sejak, 'DD-MM-YYYY')
      using errcode = '42501',
            hint = 'Hanya Loonars 1 dan Loonars 2 yang aktif. Membuka kunci butuh persetujuan owner.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke execute on function public._tolak_proyek_dikunci() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['jurnal', 'pengajuan', 'aset', 'utang_bank', 'bayar_tukang', 'tukang_borongan'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_%s_proyek_dikunci on public.%I', t, t);
      execute format(
        'create trigger trg_%s_proyek_dikunci before insert or update or delete on public.%I '
        'for each row execute function public._tolak_proyek_dikunci()', t, t);
    end if;
  end loop;

  if to_regclass('public.branches') is not null then
    update public.branches set is_active = false
     where is_active and id not in ('yogyakarta', 'yogya-loonars1');
  end if;

  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values ('sistem: migrasi 0060', 'sistem', 'kunci_proyek',
          jsonb_build_object('proyek', jsonb_build_array('AFP', 'IH', 'GCI', 'GCR', 'KDI'), 'sejak', '2026-11-01',
                             'alasan', 'keputusan owner: hanya Loonars 1 & Loonars 2 aktif'));
end;
$$;
