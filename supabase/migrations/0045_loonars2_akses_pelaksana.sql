-- ============================================================================
-- 0045 — Loonars 2: akses web BACA-SAJA untuk pelaksana (Vando)
-- ============================================================================
-- Tujuan: pelaksana bisa membuka dashboard Loonars 2 untuk belajar proyeksi,
-- memantau budget per unit, utang toko, dan status pengajuannya.
--
-- Prinsip:
--   * Tidak ada tabel baru dan tidak ada perubahan tabel yang sudah ada.
--     Izin = baris users_proyek dengan proyek_id 'LOONARS2' (dibuat owner lewat
--     menu Pengguna & Akses, yang sudah ada). Baris itu tidak cocok dengan
--     proyek mana pun, jadi tidak membuka data proyek lain.
--   * Pelaksana TIDAK mendapat policy SELECT pada tabel loonars2_*. Semua
--     data dibaca lewat satu RPC security definer yang hanya mengembalikan
--     kolom yang boleh dilihat pelaksana. Disengaja tidak ada: saldo
--     rekening, nomor rekening, pembayaran pembeli, nama pembeli, harga,
--     nomor WA, dan audit log (di WA, "saldo" & "tagihan" juga khusus owner).
--   * Hanya baca. Semua aksi uang tetap lewat loonars2_web (khusus CFO) atau WA.
-- ============================================================================

create or replace function public.loonars2_boleh_lihat()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mkh_is_cfo()
      or exists (
        select 1 from public.users_proyek
         where lower(email) = public.mkh_email_login() and proyek_id = 'LOONARS2'
      );
$$;

create or replace function public.loonars2_web_lihat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.loonars2_boleh_lihat() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'proyeksi_tanah', public._loonars2_proyeksi_tanah(),
    'unit', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'nomor', nomor, 'kode', kode, 'tipe', tipe, 'status', status,
        'status_bangun', status_bangun, 'is_unit_contoh', is_unit_contoh,
        'jatuh_tempo_efektif', jatuh_tempo_efektif,
        'biaya_bangun', biaya_bangun, 'buffer', buffer,
        'terpakai_konstruksi', terpakai_konstruksi, 'utang_disetujui', utang_disetujui,
        'komitmen_disetujui', komitmen_disetujui
      ) order by nomor) from public.loonars2_v_unit), '[]'::jsonb),
    'toko', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'nama', nama, 'utang_disetujui', utang_disetujui, 'utang_menunggu', utang_menunggu,
        'cicilan_dibayar', cicilan_dibayar, 'cicilan_diproses', cicilan_diproses, 'sisa_utang', sisa_utang
      ) order by sisa_utang desc, nama) from public.loonars2_v_toko), '[]'::jsonb),
    'utang', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'toko_id', toko_id, 'unit_id', unit_id, 'deskripsi', deskripsi,
          'nominal', nominal, 'tanggal', tanggal, 'pakai_buffer', pakai_buffer, 'melewati_buffer', melewati_buffer,
          'status', status, 'alasan_tolak', alasan_tolak
        ) as x from public.loonars2_utang_toko order by id desc limit 200) s), '[]'::jsonb),
    'cicilan', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'toko_id', toko_id, 'nominal', nominal, 'catatan', catatan,
          'status', status, 'alasan_tolak', alasan_tolak, 'dibuat_pada', dibuat_pada
        ) as x from public.loonars2_cicilan order by id desc limit 200) s), '[]'::jsonb),
    'pengajuan', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object(
          'id', id, 'kelompok', kelompok, 'unit_id', unit_id, 'kategori', kategori, 'deskripsi', deskripsi,
          'toko', toko, 'nominal', nominal, 'pakai_buffer', pakai_buffer, 'melewati_buffer', melewati_buffer,
          'status', status, 'alasan_tolak', alasan_tolak, 'dibuat_pada', dibuat_pada
        ) as x from public.loonars2_material_requests order by id desc limit 200) s), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.loonars2_boleh_lihat() from public, anon;
grant execute on function public.loonars2_boleh_lihat() to authenticated;
revoke execute on function public.loonars2_web_lihat() from public, anon;
grant execute on function public.loonars2_web_lihat() to authenticated;
