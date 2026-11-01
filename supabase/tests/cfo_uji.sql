-- Uji migrasi 0057 (AI CFO). Setiap pemeriksaan gagal = exception = psql berhenti.
\set ON_ERROR_STOP on

insert into public.laporan_villa_bulanan (periode, status, omzet_kotor, komisi_ota, pendapatan_bersih, cogs, gross_profit, opex, net_profit, okupansi_pct, rincian)
values ('2026-10-01', 'final', 155084925.75, 38092576.75, 116992349, 27543972, 89448377, 10500000, 78948377, 67.5, '{"channel":[]}');
insert into public.jurnal (tgl, akun, nama, proyek, d, k) values ('2026-10-01', '1-1001', 'Kas', 'LL', 100, 0), ('2026-10-01', '4-1001', 'Penjualan', 'LL', 0, 100);
insert into public.pengajuan (proyek, tipe, data, status) values ('LL', 'bahan', '{"nominal": 5000}', 'pending'), ('LL', 'bahan', '{"nominal": "abc"}', 'pending');
insert into public.loonars2_wa_users (nomor, nama, peran, aktif) values ('6281200000001', 'Owner Uji', 'owner', true)
  on conflict do nothing;

-- 1. Tanpa rahasia & bukan CFO: ditolak.
do $$
begin
  perform set_config('request.headers', '{}', false);
  begin
    perform public.cfo_ambil_data(null);
    raise exception 'GAGAL: cfo_ambil_data tanpa akses lolos';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.cfo_sumber_terima('investor_penjualan', '[]'::jsonb, false);
    raise exception 'GAGAL: cfo_sumber_terima tanpa rahasia lolos';
  exception when sqlstate '28000' then null;
  end;
end $$;

-- 2. Rahasia salah: ditolak.
do $$
begin
  perform set_config('request.headers', '{"x-sync-secret":"salah"}', false);
  begin
    perform public.cfo_ambil_data(null);
    raise exception 'GAGAL: rahasia salah lolos';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- 3. Rahasia benar: sistem boleh baca; nomor tidak valid ditolak.
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_ambil_data(null);
  if v ->> 'akses' <> 'sistem' then raise exception 'GAGAL: akses %', v ->> 'akses'; end if;
  if jsonb_array_length(v -> 'l1_laporan') <> 1 then raise exception 'GAGAL: l1_laporan'; end if;
  if jsonb_array_length(v -> 'l2_unit') < 1 then raise exception 'GAGAL: l2_unit kosong'; end if;
  if jsonb_array_length(v -> 'jurnal_bulanan') <> 2 then raise exception 'GAGAL: jurnal_bulanan'; end if;
  if (select sum((x ->> 'nominal')::numeric) from jsonb_array_elements(v -> 'pengajuan_menunggu') x) <> 5000 then
    raise exception 'GAGAL: nominal pengajuan non-angka harus jadi 0';
  end if;
  if (v -> 'l2_rekening' -> 0) ? 'nomor_rekening' then raise exception 'GAGAL: nomor rekening bocor'; end if;
  v := public.cfo_ambil_data('6281200000001');
  if v ->> 'akses' <> 'wa' then raise exception 'GAGAL: akses wa'; end if;
  begin
    perform public.cfo_ambil_data('bukan-nomor');
    raise exception 'GAGAL: nomor tidak valid lolos';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- 4. CFO login boleh baca tanpa rahasia.
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{}', false);
  perform set_config('uji.cfo', 'ya', false);
  perform set_config('uji.email', 'owner@uji', false);
  v := public.cfo_ambil_data(null);
  if v ->> 'akses' <> 'cfo' then raise exception 'GAGAL: akses cfo'; end if;
  perform set_config('uji.cfo', '', false);
  perform set_config('uji.email', '', false);
end $$;

-- 5. Penerima snapshot: baru / sama / berubah / nonaktif, tanpa hapus.
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_sumber_terima('investor_penjualan',
    '[{"id":"a","data":{"harga":420000000}},{"id":"b","diubah_pada":"2026-10-30T10:00:00Z","data":{"harga":600000000}}]', true);
  if (v ->> 'baru')::int <> 2 or v ->> 'sumber' <> 'svcmyb' then raise exception 'GAGAL baru: %', v; end if;
  v := public.cfo_sumber_terima('investor_penjualan',
    '[{"id":"a","data":{"harga":420000000}},{"id":"b","data":{"harga":600000000}}]', true);
  if (v ->> 'sama')::int <> 2 then raise exception 'GAGAL sama: %', v; end if;
  v := public.cfo_sumber_terima('investor_penjualan', '[{"id":"a","data":{"harga":430000000}}]', true);
  if (v ->> 'berubah')::int <> 1 or (v ->> 'nonaktif')::int <> 1 then raise exception 'GAGAL berubah/nonaktif: %', v; end if;
  if (select count(*) from public.cfo_sumber_snapshot) <> 2 then raise exception 'GAGAL: baris terhapus'; end if;
  if (select aktif from public.cfo_sumber_snapshot where source_id = 'b') then raise exception 'GAGAL: b masih aktif'; end if;
  if jsonb_array_length(public.cfo_ambil_data(null) -> 'snapshot') <> 1 then raise exception 'GAGAL: snapshot nonaktif ikut'; end if;
  -- kirim ulang b → aktif lagi (berubah)
  v := public.cfo_sumber_terima('investor_penjualan', '[{"id":"b","data":{"harga":600000000}}]', false);
  if (v ->> 'berubah')::int <> 1 then raise exception 'GAGAL aktif ulang: %', v; end if;
  if (select count(*) from public.cfo_sync_log) <> 4 then raise exception 'GAGAL: sync log'; end if;

  begin
    perform public.cfo_sumber_terima('jurnal', '[]'::jsonb, false);
    raise exception 'GAGAL: jenis asing lolos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cfo_sumber_terima('refund_customer', '[{"id":"","data":{}}]'::jsonb, false);
    raise exception 'GAGAL: id kosong lolos';
  exception when sqlstate '22023' then null;
  end;

  -- Rahasia villa hanya boleh jenis villa.
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-villa"}', false);
  v := public.cfo_sumber_terima('ota_settlement', '[{"id":"s1","data":{"amount":1}}]', false);
  if v ->> 'sumber' <> 'villa_api' then raise exception 'GAGAL villa: %', v; end if;
  begin
    perform public.cfo_sumber_terima('investor_penjualan', '[]'::jsonb, false);
    raise exception 'GAGAL: villa kirim investor lolos';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 6. Briefing: masuk antrean WA owner sekali saja; saklar mati = tidak dikirim.
do $$
declare v jsonb;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_briefing_antre('harian', 'Briefing uji', 'harian:2026-11-01');
  if (v ->> 'antre')::int <> 1 then raise exception 'GAGAL antre: %', v; end if;
  v := public.cfo_briefing_antre('harian', 'Briefing uji', 'harian:2026-11-01');
  if (v ->> 'antre')::int <> 0 then raise exception 'GAGAL idempoten: %', v; end if;
  if (select count(*) from public.loonars2_outbox where jenis = 'cfo_harian' and status = 'antri') <> 1 then
    raise exception 'GAGAL: outbox';
  end if;
  update public.cfo_pengaturan set briefing_harian = false where id = 1;
  v := public.cfo_briefing_antre('harian', 'Briefing uji', 'harian:2026-11-02');
  if v ->> 'status' <> 'nonaktif' then raise exception 'GAGAL saklar: %', v; end if;
  update public.cfo_pengaturan set briefing_harian = true where id = 1;
  begin
    perform public.cfo_briefing_antre('harian', '', 'k');
    raise exception 'GAGAL: pesan kosong lolos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cfo_briefing_antre('harian', 'x', 'kunci dengan spasi');
    raise exception 'GAGAL: kunci tidak valid lolos';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 7. Audit log append-only; cfo_catat menolak aksi tidak valid.
do $$
declare v bigint;
begin
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_catat('tanya_cfo', '{"pertanyaan":"uji"}', '6281200000001');
  if (select kanal from public.cfo_audit_log where id = v) <> 'whatsapp' then raise exception 'GAGAL kanal'; end if;
  begin
    update public.cfo_audit_log set aksi = 'x' where id = v;
    raise exception 'GAGAL: audit bisa diubah';
  exception when sqlstate '42501' then null;
  end;
  begin
    delete from public.cfo_audit_log where id = v;
    raise exception 'GAGAL: audit bisa dihapus';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.cfo_catat('DROP TABLE', '{}', null);
    raise exception 'GAGAL: aksi tidak valid lolos';
  exception when sqlstate '22023' then null;
  end;
  if not exists (select 1 from public.cfo_audit_log where aksi = 'ubah_pengaturan') then
    raise exception 'GAGAL: ubah pengaturan tidak tercatat';
  end if;
end $$;

-- 7b. Saldo rekening (CFO, append-only) + mutasi villa + tanda tangan AI.
do $$
declare v jsonb; v_id bigint; v_hash text := repeat('ab', 32);
begin
  perform set_config('request.headers', '{}', false);
  begin
    perform public.cfo_saldo_catat('L1', 'BTN Villa', 1000, current_date, null);
    raise exception 'GAGAL: bukan CFO bisa catat saldo';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('uji.cfo', 'ya', false);
  perform set_config('uji.email', 'owner@uji', false);
  v_id := public.cfo_saldo_catat('L1', 'BTN Villa', 50000000, current_date - 3, 'cek mutasi');
  perform public.cfo_saldo_catat('L1', 'BTN Villa', 52000000, current_date - 1, null);
  begin
    perform public.cfo_saldo_catat('L1', 'BTN Villa', 1, current_date + 2, null);
    raise exception 'GAGAL: tanggal masa depan lolos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.cfo_saldo_catat('L1', 'BTN Villa', 1.5, current_date, null);
    raise exception 'GAGAL: saldo pecahan lolos';
  exception when sqlstate '22023' then null;
  end;
  begin
    update public.cfo_saldo_rekening set saldo = 0 where id = v_id;
    raise exception 'GAGAL: saldo bisa diubah';
  exception when sqlstate '42501' then null;
  end;
  v := public.cfo_ambil_data(null);
  if jsonb_array_length(v -> 'saldo_rekening') <> 1 or (v -> 'saldo_rekening' -> 0 ->> 'saldo')::numeric <> 52000000 then
    raise exception 'GAGAL: saldo terbaru %', v -> 'saldo_rekening';
  end if;
  if not exists (select 1 from public.cfo_audit_log where aksi = 'catat_saldo') then raise exception 'GAGAL: audit saldo'; end if;
  perform set_config('uji.cfo', '', false);
  perform set_config('uji.email', '', false);

  -- tanda tangan AI: tanpa akses ditolak; dengan rahasia → HMAC benar.
  begin
    perform public.cfo_tanda_ai(v_hash, null);
    raise exception 'GAGAL: tanda AI tanpa akses lolos';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.headers', '{"x-sync-secret":"rahasia-uji"}', false);
  v := public.cfo_tanda_ai(v_hash, null);
  if v ->> 'sig' <> encode(extensions.hmac(('ai-cfo-narasi|' || (v ->> 'ts') || '|' || v_hash)::bytea, 'rahasia-uji'::bytea, 'sha256'), 'hex') then
    raise exception 'GAGAL: tanda tangan AI salah';
  end if;
  begin
    perform public.cfo_tanda_ai('bukan-hash', null);
    raise exception 'GAGAL: hash tidak valid lolos';
  exception when sqlstate '22023' then null;
  end;

  v := public.cfo_sumber_terima('villa_kas_masuk', '[{"id":"ota:1","data":{"tanggal":"2026-11-01","nominal":1000000,"jenis":"ota"}}]', true);
  if (v ->> 'baru')::int <> 1 then raise exception 'GAGAL: villa_kas_masuk %', v; end if;
end $$;

-- 8. Anon tidak bisa membaca tabel CFO; cron terjadwal; bangunkan memanggil URL benar.
set role anon;
do $$
begin
  begin
    perform 1 from public.cfo_sumber_snapshot;
    raise exception 'GAGAL: anon bisa baca snapshot';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.cfo_audit_log;
    raise exception 'GAGAL: anon bisa baca audit';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  if (select count(*) from cron.job where jobname like 'cfo-%') <> 3 then raise exception 'GAGAL: cron'; end if;
  perform public.cfo_briefing_bangunkan('harian');
  if not exists (select 1 from net.panggilan where url = 'https://finance.haluoleo.id/api/cfo/briefing' and body ->> 'jenis' = 'harian') then
    raise exception 'GAGAL: bangunkan';
  end if;
  perform public.cfo_briefing_bangunkan('jahat');
  if (select count(*) from net.panggilan where url like '%/api/cfo/briefing') <> 1 then raise exception 'GAGAL: jenis asing dipanggil'; end if;
end $$;

-- 9. Migrasi bisa dijalankan ulang (idempoten).
\i supabase/migrations/0057_ai_cfo.sql

select 'cfo_uji: SEMUA LULUS' as hasil;
