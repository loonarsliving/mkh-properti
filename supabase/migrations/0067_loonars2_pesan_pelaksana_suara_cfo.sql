-- ============================================================================
-- 0067 — Loonars 2: pesan ke pelaksana tidak lagi membawa nama owner
-- ============================================================================
-- Arahan owner (10 Nov 2026), setelah melihat pesan "Pak Avi minta total harga
-- untuk DP…" di WA Vando: "Kenapa Pak Avi? Ke depannya jangan pernah bawa saya
-- lagi. MKH sistem adalah CFO AI sendiri, jadi harus bisa berpikir sendiri
-- ketika sebuah pengajuan tidak lengkap."
--
-- Prinsip (dicatat juga di docs/project-memory/AI_AND_AGENTS.md): pertanyaan,
-- permintaan kelengkapan, dan status yang dikirim ke pelaksana berbicara
-- sebagai sistem/CFO itu sendiri — tidak mengatasnamakan owner, tidak
-- menyebut nama owner, dan tidak menyebut "persetujuan owner". Pesan KE owner
-- tidak berubah.
--
-- Hanya teks pesan yang diganti (replace pada definisi fungsi yang hidup, pola
-- 0056); logika, nominal, dan alur persetujuan tidak berubah.
-- ============================================================================

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_ganti text[][] := array[
    -- ringkasan pengajuan ke pelaksana
    array['MENUNGGU PERSETUJUAN OWNER. Tiap baris sampai ke Pak Avi sebagai pengajuan sendiri lengkap dengan rekeningnya;',
          'MENUNGGU PERSETUJUAN. Tiap baris diproses sebagai pengajuan sendiri lengkap dengan rekeningnya;'],
    array['MENUNGGU PERSETUJUAN OWNER', 'MENUNGGU PERSETUJUAN'],
    array['tidak perlu persetujuan owner', 'tidak perlu persetujuan'],
    array['masih menunggu persetujuan owner', 'masih menunggu persetujuan'],
    -- pertanyaan total DP (0064/0066)
    array['Pengajuan saya teruskan ke Pak Avi setelah totalnya ada, supaya sisa yang masih akan ditagih kelihatan.',
          'Saya perlu totalnya untuk mencatat sisa pembayaran, supaya tidak terjadi salah bayar.'],
    array['Pak Avi minta total harga untuk DP yang sudah diajukan, supaya sisa pembayarannya tercatat dan tidak salah bayar.',
          'Saya memeriksa ulang pengajuan DP yang sudah masuk: total harganya belum ada, jadi sisa pembayarannya belum bisa saya catat.'],
    array['✅ Terima kasih, total DP dicatat dan sudah dikabarkan ke Pak Avi:', '✅ Terima kasih, total DP dicatat:']
  ];
  i integer;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.proname like '%loonars2%'
       and pg_get_functiondef(p.oid) ~ '(Pak Avi|PERSETUJUAN OWNER|persetujuan owner)'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := v_def;
    for i in 1..array_length(v_ganti, 1) loop
      v_new := replace(v_new, v_ganti[i][1], v_ganti[i][2]);
    end loop;
    if v_new <> v_def then execute v_new; end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.prokind = 'f' and p.proname like '%loonars2%'
                and pg_get_functiondef(p.oid) ~ '(Pak Avi|PERSETUJUAN OWNER|persetujuan owner)') then
    raise exception '0067: masih ada pesan yang menyebut owner';
  end if;
end;
$$;
