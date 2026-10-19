-- ============================================================================
-- 0053 — Loonars 2: laporan pembayaran utang toko, dikirim sebagai PDF lewat WA
-- ============================================================================
-- Owner (19 Okt 2026): MKH Property menyimpan laporan pembayaran utang; kalau
-- diminta lewat bot WA, langsung dikirim berupa PDF.
--
-- Datanya sudah tersimpan (utang U-n, cicilan dibayar + bukti di
-- loonars2_disbursements). Migrasi ini menambahkan cara mengambilnya sebagai
-- laporan, tanpa tabel baru dan tanpa menyimpan salinan PDF (PDF dibuat saat
-- diunduh, selalu sesuai data terbaru):
--   * aksi WA 'laporan_utang' (khusus owner) -> tautan unduh berumur 15 menit.
--     Tautan memuat tanda tangan HMAC-SHA256 dengan rahasia sync yang sudah
--     ada (Vault mk_sync_shared_secret); tidak ada rahasia baru.
--   * loonars2_laporan_utang_data(token) -> data laporan bila tanda tangan sah
--     dan belum kedaluwarsa. Dipakai route PDF di server (tanpa service key).
-- ============================================================================

create or replace function public._loonars2_tanda_laporan(p_exp bigint)
returns text
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  if v_secret is null then return null; end if;
  return encode(extensions.hmac(('laporan-utang-loonars2|' || p_exp)::bytea, v_secret::bytea, 'sha256'), 'hex');
end;
$$;

create or replace function public._loonars2_buat_tautan_laporan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exp bigint := extract(epoch from now() + interval '15 minutes')::bigint;
  v_tanda text := public._loonars2_tanda_laporan(v_exp);
begin
  if v_tanda is null then
    return jsonb_build_object('status', 'galat', 'balasan', '⚠️ Laporan belum bisa dibuat (rahasia sistem tidak tersedia).');
  end if;
  return jsonb_build_object('status', 'ok', 'token', v_exp || '.' || v_tanda,
    'nama_berkas', 'Laporan-Utang-Toko-Loonars2_' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') || '.pdf');
end;
$$;

create or replace function public.loonars2_laporan_utang_data(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_exp bigint;
  v_tanda text;
  v_toko jsonb;
  v_ringkas jsonb;
begin
  if p_token !~ '^[0-9]{9,12}\.[0-9a-f]{64}$' then
    raise exception 'Tautan tidak valid' using errcode = '28000';
  end if;
  v_exp := split_part(p_token, '.', 1)::bigint;
  v_tanda := public._loonars2_tanda_laporan(v_exp);
  if v_tanda is null or v_tanda <> split_part(p_token, '.', 2) or v_exp < extract(epoch from now())::bigint then
    raise exception 'Tautan tidak valid atau kedaluwarsa' using errcode = '28000';
  end if;

  select coalesce(jsonb_agg(t order by (t ->> 'sisa')::numeric desc, t ->> 'nama'), '[]'::jsonb) into v_toko from (
    select jsonb_build_object(
      'nama', vt.nama,
      'utang_disetujui', vt.utang_disetujui,
      'cicilan_dibayar', vt.cicilan_dibayar,
      'sisa', vt.sisa_utang,
      'utang', coalesce((
        select jsonb_agg(jsonb_build_object('kode', x.kelompok, 'tanggal', x.tanggal, 'rincian', x.rincian,
                                            'nominal', x.nominal, 'status', x.status, 'oleh', x.oleh) order by x.tanggal, x.kelompok)
          from (select ut.kelompok, min(ut.tanggal) as tanggal, left(min(ut.deskripsi), 120) as rincian,
                       sum(ut.nominal) as nominal, min(ut.status) as status, min(ut.diajukan_oleh) as oleh
                  from public.loonars2_utang_toko ut
                 where ut.toko_id = vt.id and ut.status <> 'ditolak' group by ut.kelompok) x), '[]'::jsonb),
      'pembayaran', coalesce((
        select jsonb_agg(jsonb_build_object('kode', c.kelompok, 'tanggal', d.tanggal, 'nominal', c.nominal,
                                            'keterangan', c.catatan, 'ada_bukti', d.bukti_url is not null, 'talangan', coalesce(d.talangan, false))
                          order by d.tanggal, c.id)
          from public.loonars2_cicilan c
          left join public.loonars2_disbursements d on d.cicilan_id = c.id
         where c.toko_id = vt.id and c.status = 'dibayar'), '[]'::jsonb)
    ) as t
    from public.loonars2_v_toko vt
   where vt.utang_disetujui <> 0 or vt.cicilan_dibayar <> 0
  ) s;

  select jsonb_build_object(
    'total_utang', coalesce(sum(utang_disetujui), 0),
    'total_dibayar', coalesce(sum(cicilan_dibayar), 0),
    'total_sisa', coalesce(sum(sisa_utang), 0))
    into v_ringkas
    from public.loonars2_v_toko;

  return jsonb_build_object('dibuat_pada', now(), 'ringkasan', v_ringkas, 'toko', v_toko);
end;
$$;

revoke execute on function public._loonars2_tanda_laporan(bigint) from public, anon, authenticated;
revoke execute on function public._loonars2_buat_tautan_laporan() from public, anon, authenticated;
revoke execute on function public.loonars2_laporan_utang_data(text) from public;
grant execute on function public.loonars2_laporan_utang_data(text) to anon, authenticated;

do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._loonars2_wa_jalankan(loonars2_wa_users,text,jsonb,boolean)'::regprocedure);
  v_new := replace(v_def, $q$'cairkan_profit', 'borongan')$q$, $q$'cairkan_profit', 'borongan', 'laporan_utang')$q$);
  v_new := replace(v_new, E'elsif p_aksi = \'daftar_borongan\' then\n',
    E'elsif p_aksi = \'laporan_utang\' then\n    return public._loonars2_buat_tautan_laporan();\n\n  elsif p_aksi = \'daftar_borongan\' then\n');
  if position('laporan_utang' in v_new) = 0 or v_new = v_def
     or position($q$'borongan', 'laporan_utang')$q$ in v_new) = 0 then
    raise exception 'penggantian _loonars2_wa_jalankan gagal';
  end if;
  execute v_new;
end;
$$;
