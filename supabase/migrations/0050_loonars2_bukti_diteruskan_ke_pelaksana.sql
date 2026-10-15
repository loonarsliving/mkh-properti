-- ============================================================================
-- 0050 — Loonars 2: bukti transfer yang dicatat otomatis diteruskan ke pelaksana
-- ============================================================================
-- Saat pengajuan dicatat dibayar (mis. dari foto bukti owner), pelaksana (Vando) kini menerima
-- fotonya juga, bukan hanya teks "tercatat dibayar", supaya bisa diteruskan ke tukang/toko.
-- Hanya mengubah argumen gambar pada pemberitahuan ke pelaksana di _loonars2_bayar_kelompok
-- (disisipkan pada definisi yang ada; aman dijalankan ulang).
-- ============================================================================
do $do$
declare
  v_def text;
  v_lama text := $a$' tercatat dibayar ' || public.loonars2_rp(v_total) || '.', 'pengajuan_dibayar', 'dibayar:' || v_kode, null);$a$;
  v_baru text := $b$' tercatat dibayar ' || public.loonars2_rp(v_total) || '.' || case when p_bukti is not null then ' Bukti transfer terlampir.' else '' end, 'pengajuan_dibayar', 'dibayar:' || v_kode, p_bukti);$b$;
begin
  select pg_get_functiondef('public._loonars2_bayar_kelompok(text,text,text,text)'::regprocedure) into v_def;
  if position(v_lama in v_def) = 0 then
    raise notice 'sudah diterapkan atau pola tidak ditemukan';
    return;
  end if;
  execute replace(v_def, v_lama, v_baru);
end
$do$;
