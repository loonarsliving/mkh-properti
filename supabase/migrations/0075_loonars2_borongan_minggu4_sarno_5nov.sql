-- 0075 — Loonars 2: pembayaran Sarno 5 Nov 2026 (M-89, Rp 20.000.000) masuk borongan L2
--
-- Koreksi data (tanpa perubahan skema, tanpa perubahan nominal/saldo):
--  * M-89 (loonars2_material_requests id 179, dibayar 5 Nov) dicatat sebagai
--    'tukang' biasa tanpa borongan_id/minggu_ke, sehingga halaman borongan hanya
--    menghitung 4 minggu / Rp 78 jt padahal 5 minggu / Rp 98 jt sudah dibayar.
--    Keputusan owner 2026-11-11: pembayaran 5 Nov jelas bagian borongan L2.
--    -> borongan_id = 3, minggu_ke = 4.
--  * M-107 (id 205–210, dibayar 11 Nov) tadinya diberi minggu ke-4 karena M-89
--    belum tertaut -> menjadi minggu ke-5.
-- Urutan mingguan: 15 Okt (1), 22 Okt (2), 28 Okt (3), 5 Nov (4), 11 Nov (5).
-- Pembayaran 1 Nov (M-68) & 9 Nov (M-94) TIDAK disentuh.
do $$
declare
  n int;
begin
  update public.loonars2_material_requests
     set minggu_ke = 5,
         deskripsi = replace(deskripsi, 'minggu ke-4:', 'minggu ke-5:')
   where id between 205 and 210 and kelompok = 'M-107'
     and borongan_id = 3 and minggu_ke = 4 and status = 'dibayar';
  get diagnostics n = row_count;
  if n <> 6 then raise exception '0075: M-107 harus 6 baris, ditemukan %', n; end if;

  update public.loonars2_disbursements
     set keterangan = replace(keterangan, 'minggu ke-4:', 'minggu ke-5:')
   where material_request_id between 205 and 210;
  get diagnostics n = row_count;
  if n <> 6 then raise exception '0075: pengeluaran M-107 harus 6 baris, ditemukan %', n; end if;

  update public.loonars2_material_requests
     set borongan_id = 3,
         minggu_ke = 4,
         deskripsi = 'Upah borongan Borongan tukang minggu ke-4: ' || deskripsi
   where id = 179 and kelompok = 'M-89' and kategori = 'tukang' and status = 'dibayar'
     and nominal = 20000000 and borongan_id is null and minggu_ke is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0075: M-89 harus 1 baris, ditemukan %', n; end if;

  update public.loonars2_disbursements
     set keterangan = replace(keterangan, 'L2-179: ', 'L2-179: Upah borongan Borongan tukang minggu ke-4: ')
   where material_request_id = 179;
  get diagnostics n = row_count;
  if n <> 1 then raise exception '0075: pengeluaran M-89 harus 1 baris, ditemukan %', n; end if;
end $$;
