-- ============================================================================
-- 0058 — AI CFO bekerja: tindakan CFO, reviu pengajuan, tutup buku bulanan
-- ============================================================================
--
-- Lanjutan 0057. AI CFO tidak hanya menampilkan angka, tetapi menjalankan
-- pekerjaan rutin CFO. Semua keputusan uang TETAP di tangan owner; tidak ada
-- fungsi di sini yang menulis ke jurnal, loonars2_*, atau pengajuan.
--
--   1. cfo_tindakan          — daftar tindakan CFO (tugas konkret: apa, siapa,
--                              tenggat). Disusun aplikasi dari angka
--                              deterministik (src/lib/cfo/kerja.ts) lewat
--                              RPC cfo_tindakan_sinkron: tindakan baru dibuat,
--                              yang kondisinya sudah teratasi DITUTUP OTOMATIS,
--                              yang muncul lagi dibuka ulang, yang diabaikan
--                              owner (dengan alasan) tidak dibuka lagi.
--   2. cfo_laporan_bulanan   — tutup buku bulanan: ringkasan angka per bulan
--                              DIBEKUKAN (append-only) + komentar varians.
--   3. RPC cfo_ambil_kerja   — data tambahan hanya-baca untuk reviu pengajuan &
--                              tindakan: detail pengajuan Loonars 2 & MKH
--                              (nomor rekening di keterangan DISAMARKAN),
--                              alokasi DP menunggu konfirmasi transfer, status
--                              nomor rekening A–D (terisi/belum, tanpa nomornya),
--                              tindakan, laporan bulanan.
--   4. pg_cron               — sinkron tindakan tiap 2 jam; cek tutup buku harian.
--
-- Rollback: cron.unschedule('cfo-tindakan-sinkron'), cron.unschedule('cfo-tutup-buku');
-- revoke execute RPC baru. Tabel boleh dibiarkan. Tidak ada data sumber berubah.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tindakan CFO
-- ----------------------------------------------------------------------------
create table if not exists public.cfo_tindakan (
  id bigserial primary key,
  kunci text not null unique check (length(kunci) between 1 and 160),
  judul text not null check (length(judul) between 1 and 300),
  langkah text not null check (length(langkah) between 1 and 1500),
  tingkat text not null check (tingkat in ('kritis', 'tinggi', 'sedang', 'info')),
  lini text not null check (lini in ('L1', 'L2', 'Grup', 'Data')),
  penanggung text not null default 'owner' check (length(penanggung) between 1 and 60),
  tenggat date,
  nilai numeric,
  sumber jsonb not null default '[]'::jsonb,
  status text not null default 'terbuka' check (status in ('terbuka', 'selesai', 'diabaikan')),
  dibuat_pada timestamptz not null default now(),
  terakhir_terdeteksi timestamptz not null default now(),
  ditutup_pada timestamptz,
  ditutup_oleh text,
  alasan text check (alasan is null or length(alasan) <= 500)
);
create index if not exists cfo_tindakan_status_idx on public.cfo_tindakan (status, tenggat);

alter table public.cfo_tindakan enable row level security;
revoke all on public.cfo_tindakan from anon;
revoke all on public.cfo_tindakan from authenticated;
grant select on public.cfo_tindakan to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Laporan bulanan (tutup buku) — append-only
-- ----------------------------------------------------------------------------
create table if not exists public.cfo_laporan_bulanan (
  periode date primary key check (extract(day from periode) = 1),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  komentar text not null check (length(komentar) between 1 and 6000),
  hash text not null,
  dibuat_oleh text not null,
  dibuat_pada timestamptz not null default now()
);
alter table public.cfo_laporan_bulanan enable row level security;
revoke all on public.cfo_laporan_bulanan from anon;
revoke all on public.cfo_laporan_bulanan from authenticated;
grant select on public.cfo_laporan_bulanan to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cfo_tindakan' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_tindakan for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cfo_laporan_bulanan' and policyname = 'cfo_baca') then
    create policy cfo_baca on public.cfo_laporan_bulanan for select to authenticated using (public.mkh_is_cfo());
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cfo_laporan_bulanan_append_only') then
    create trigger cfo_laporan_bulanan_append_only
      before update or delete on public.cfo_laporan_bulanan
      for each row execute function public._cfo_tolak_ubah_audit();
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Sinkron tindakan (sistem / CFO)
-- ----------------------------------------------------------------------------
-- p_daftar: [{kunci, judul, langkah, tingkat, lini, penanggung, tenggat, nilai, sumber}]
-- = SEMUA tindakan yang saat ini masih relevan menurut mesin hitung.
create or replace function public.cfo_tindakan_sinkron(p_daftar jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(null);
  v_el jsonb;
  v_kunci text;
  v_kuncis text[] := '{}';
  v_lama record;
  v_baru int := 0;
  v_perbarui int := 0;
  v_buka_ulang int := 0;
  v_tutup int := 0;
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_daftar is null or jsonb_typeof(p_daftar) <> 'array' or jsonb_array_length(p_daftar) > 500 then
    raise exception 'p_daftar harus array (maks 500)' using errcode = '22023';
  end if;

  for v_el in select value from jsonb_array_elements(p_daftar) loop
    v_kunci := nullif(trim(v_el ->> 'kunci'), '');
    if v_kunci is null or length(v_kunci) > 160 then
      raise exception 'Kunci tindakan tidak valid' using errcode = '22023';
    end if;
    v_kuncis := v_kuncis || v_kunci;
    select id, status into v_lama from public.cfo_tindakan where kunci = v_kunci for update;
    if not found then
      insert into public.cfo_tindakan (kunci, judul, langkah, tingkat, lini, penanggung, tenggat, nilai, sumber)
      values (v_kunci, left(v_el ->> 'judul', 300), left(v_el ->> 'langkah', 1500), v_el ->> 'tingkat', v_el ->> 'lini',
              coalesce(nullif(v_el ->> 'penanggung', ''), 'owner'), nullif(v_el ->> 'tenggat', '')::date,
              nullif(v_el ->> 'nilai', '')::numeric, coalesce(v_el -> 'sumber', '[]'::jsonb));
      v_baru := v_baru + 1;
    elsif v_lama.status = 'terbuka' then
      -- Tenggat TIDAK dimundurkan; isi & tingkat boleh diperbarui (angka bisa berubah).
      update public.cfo_tindakan
         set judul = left(v_el ->> 'judul', 300), langkah = left(v_el ->> 'langkah', 1500),
             tingkat = v_el ->> 'tingkat', nilai = nullif(v_el ->> 'nilai', '')::numeric,
             sumber = coalesce(v_el -> 'sumber', sumber), terakhir_terdeteksi = now()
       where id = v_lama.id;
      v_perbarui := v_perbarui + 1;
    elsif v_lama.status = 'selesai' then
      update public.cfo_tindakan
         set status = 'terbuka', judul = left(v_el ->> 'judul', 300), langkah = left(v_el ->> 'langkah', 1500),
             tingkat = v_el ->> 'tingkat', nilai = nullif(v_el ->> 'nilai', '')::numeric,
             tenggat = nullif(v_el ->> 'tenggat', '')::date, terakhir_terdeteksi = now(),
             ditutup_pada = null, ditutup_oleh = null, alasan = null
       where id = v_lama.id;
      v_buka_ulang := v_buka_ulang + 1;
    end if;
    -- status 'diabaikan': keputusan owner dihormati, tidak dibuka lagi.
  end loop;

  update public.cfo_tindakan
     set status = 'selesai', ditutup_pada = now(), ditutup_oleh = 'sistem: kondisi sudah teratasi'
   where status = 'terbuka' and not (kunci = any (v_kuncis));
  get diagnostics v_tutup = row_count;

  if v_baru + v_buka_ulang + v_tutup > 0 then
    insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
    values (v_akses, case when v_akses like 'cfo:%' then 'web' else 'sistem' end, 'sinkron_tindakan',
            jsonb_build_object('baru', v_baru, 'buka_ulang', v_buka_ulang, 'ditutup', v_tutup));
  end if;
  return jsonb_build_object('status', 'ok', 'baru', v_baru, 'diperbarui', v_perbarui, 'buka_ulang', v_buka_ulang, 'ditutup', v_tutup);
end;
$$;
revoke execute on function public.cfo_tindakan_sinkron(jsonb) from public;
grant execute on function public.cfo_tindakan_sinkron(jsonb) to anon, authenticated;

-- Owner menandai tindakan selesai / diabaikan (wajib alasan) / dibuka lagi.
create or replace function public.cfo_tindakan_ubah(p_id bigint, p_status text, p_alasan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aktor text;
begin
  if not public.mkh_is_cfo() then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_status not in ('selesai', 'diabaikan', 'terbuka') then
    raise exception 'Status tidak dikenal' using errcode = '22023';
  end if;
  if p_status = 'diabaikan' and length(coalesce(trim(p_alasan), '')) < 5 then
    raise exception 'Alasan wajib diisi (min 5 huruf) untuk mengabaikan tindakan' using errcode = '22023';
  end if;
  v_aktor := 'cfo:' || public.mkh_email_login();
  update public.cfo_tindakan
     set status = p_status,
         ditutup_pada = case when p_status = 'terbuka' then null else now() end,
         ditutup_oleh = case when p_status = 'terbuka' then null else v_aktor end,
         alasan = case when p_status = 'terbuka' then null else left(nullif(trim(p_alasan), ''), 500) end
   where id = p_id;
  if not found then
    raise exception 'Tindakan tidak ditemukan' using errcode = '22023';
  end if;
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_aktor, 'web', 'ubah_tindakan', jsonb_build_object('id', p_id, 'status', p_status, 'alasan', p_alasan));
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.cfo_tindakan_ubah(bigint, text, text) from public, anon;
grant execute on function public.cfo_tindakan_ubah(bigint, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Tutup buku bulanan (sistem / CFO) — sekali per periode, tidak bisa diubah
-- ----------------------------------------------------------------------------
create or replace function public.cfo_tutup_buku(p_periode date, p_data jsonb, p_komentar text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(null);
  v_bulan_ini date := date_trunc('month', (now() at time zone 'Asia/Jakarta'))::date;
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_periode is null or extract(day from p_periode) <> 1 or p_periode >= v_bulan_ini then
    raise exception 'Periode harus tanggal 1 bulan yang sudah lewat' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 200000 then
    raise exception 'Data laporan tidak valid' using errcode = '22023';
  end if;
  if p_komentar is null or length(p_komentar) not between 1 and 6000 then
    raise exception 'Komentar tidak valid' using errcode = '22023';
  end if;
  if exists (select 1 from public.cfo_laporan_bulanan where periode = p_periode) then
    return jsonb_build_object('status', 'sudah_ada');
  end if;
  insert into public.cfo_laporan_bulanan (periode, data, komentar, hash, dibuat_oleh)
  values (p_periode, p_data, p_komentar, md5(p_data::text || p_komentar), v_akses);
  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_akses, case when v_akses like 'cfo:%' then 'web' else 'sistem' end, 'tutup_buku',
          jsonb_build_object('periode', p_periode));
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.cfo_tutup_buku(date, jsonb, text) from public;
grant execute on function public.cfo_tutup_buku(date, jsonb, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Data kerja (HANYA BACA)
-- ----------------------------------------------------------------------------
-- Nomor rekening/telepon di keterangan, toko, dan supplier pengajuan disamarkan.
create or replace function public.cfo_ambil_kerja(p_peminta_wa text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(p_peminta_wa);
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'l2_pengajuan', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kelompok', m.kelompok, 'kategori', m.kategori, 'unit_id', m.unit_id, 'nominal', m.nominal,
        'deskripsi', regexp_replace(left(coalesce(m.deskripsi, ''), 200), '[0-9][0-9 .-]{5,}[0-9]', '••••', 'g'),
        'toko', regexp_replace(coalesce(m.toko, ''), '[0-9]{6,}', '••••', 'g'), 'status', m.status, 'pakai_buffer', m.pakai_buffer, 'melewati_buffer', m.melewati_buffer,
        'saldo_c_kurang', m.saldo_c_kurang, 'unit_belum_terdanai', m.unit_belum_terdanai,
        'borongan_id', m.borongan_id, 'minggu_ke', m.minggu_ke, 'retensi', m.retensi,
        'diajukan_oleh', m.diajukan_oleh, 'dibuat_pada', m.dibuat_pada, 'diputuskan_pada', m.diputuskan_pada) order by m.id)
      from public.loonars2_material_requests m
      where m.status = 'menunggu' or m.dibuat_pada >= now() - interval '45 days'), '[]'::jsonb),
    'mkh_pengajuan', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'proyek', p.proyek, 'tipe', p.tipe,
        'nominal_teks', p.data ->> 'nominal',
        'supplier', nullif(regexp_replace(coalesce(p.data ->> 'supplier', ''), '[0-9]{6,}', '••••', 'g'), ''),
        'keterangan', regexp_replace(left(coalesce(p.data ->> 'keterangan', p.data ->> 'ketJ', ''), 160), '[0-9][0-9 .-]{5,}[0-9]', '••••', 'g'),
        'dibuat_pada', p.created_at) order by p.id)
      from public.pengajuan p where p.status = 'pending'), '[]'::jsonb),
    'alokasi_menunggu', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'receipt_id', a.receipt_id, 'ke_rekening', a.ke_rekening,
        'nominal', a.nominal, 'tanggal', r.tanggal, 'unit', u.kode, 'jenis', r.jenis) order by a.id)
      from public.loonars2_allocations a
      join public.loonars2_receipts r on r.id = a.receipt_id
      join public.loonars2_units u on u.id = r.unit_id
      where a.status = 'menunggu' and r.status = 'aktif'), '[]'::jsonb),
    'rekening_terisi', coalesce((
      select jsonb_object_agg(a.kode, coalesce(a.nomor_rekening, '') ~ '[1-9]' and length(regexp_replace(coalesce(a.nomor_rekening, ''), '\D', '', 'g')) >= 8
                                         and regexp_replace(coalesce(a.nomor_rekening, ''), '\D', '', 'g') !~ '0{6,}')
      from public.loonars2_accounts a), '{}'::jsonb),
    'tindakan', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.status, t.tenggat nulls last, t.id)
      from public.cfo_tindakan t
      where t.status = 'terbuka' or t.ditutup_pada >= now() - interval '30 days'), '[]'::jsonb),
    'laporan_bulanan', coalesce((
      select jsonb_agg(jsonb_build_object('periode', l.periode, 'komentar', l.komentar, 'data', l.data,
        'dibuat_oleh', l.dibuat_oleh, 'dibuat_pada', l.dibuat_pada, 'hash', l.hash) order by l.periode desc)
      from public.cfo_laporan_bulanan l), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.cfo_ambil_kerja(text) from public;
grant execute on function public.cfo_ambil_kerja(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Perluas pemicu briefing: jenis 'tindakan' (sinkron, tanpa WA) & 'tutup_buku'
-- ----------------------------------------------------------------------------
create or replace function public.cfo_briefing_bangunkan(p_jenis text)
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_secret text;
  v_url text;
begin
  if p_jenis not in ('harian', 'mingguan', 'peringatan', 'tindakan', 'tutup_buku') then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'mk_sync_shared_secret';
  select url_aplikasi into v_url from public.cfo_pengaturan where id = 1;
  if v_secret is null or v_url is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/cfo/briefing',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', v_secret),
    body := jsonb_build_object('jenis', p_jenis),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke execute on function public.cfo_briefing_bangunkan(text) from public, anon, authenticated;

create or replace function public.cfo_briefing_antre(
  p_jenis text,
  p_pesan text,
  p_kunci text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_akses text := public._cfo_akses(null);
  v_set public.cfo_pengaturan;
  v_owner record;
  v_masuk int := 0;
  v_n int;
begin
  if v_akses is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;
  if p_jenis not in ('harian', 'mingguan', 'peringatan', 'manual', 'tutup_buku') then
    raise exception 'Jenis briefing tidak dikenal' using errcode = '22023';
  end if;
  if p_pesan is null or length(p_pesan) not between 1 and 4000 then
    raise exception 'Pesan kosong / terlalu panjang' using errcode = '22023';
  end if;
  if p_kunci is null or p_kunci !~ '^[A-Za-z0-9:_.-]{1,120}$' then
    raise exception 'Kunci tidak valid' using errcode = '22023';
  end if;

  select * into v_set from public.cfo_pengaturan where id = 1;
  if p_jenis = 'harian' and not v_set.briefing_harian
     or p_jenis in ('mingguan', 'tutup_buku') and not v_set.briefing_mingguan
     or p_jenis = 'peringatan' and not v_set.peringatan_otomatis then
    return jsonb_build_object('status', 'nonaktif', 'antre', 0);
  end if;

  for v_owner in select nomor from public.loonars2_wa_users where peran = 'owner' and aktif loop
    insert into public.loonars2_outbox (nomor, pesan, jenis, kunci)
    values (v_owner.nomor, p_pesan, 'cfo_' || p_jenis, 'cfo:' || p_kunci || ':' || v_owner.nomor)
    on conflict (kunci) do nothing;
    get diagnostics v_n = row_count;
    v_masuk := v_masuk + v_n;
  end loop;

  insert into public.cfo_audit_log (aktor, kanal, aksi, ringkas)
  values (v_akses, case when v_akses like 'cfo:%' then 'web' else 'sistem' end, 'briefing_' || p_jenis,
          jsonb_build_object('kunci', p_kunci, 'antre', v_masuk, 'panjang', length(p_pesan)));

  return jsonb_build_object('status', 'ok', 'antre', v_masuk);
end;
$$;
revoke execute on function public.cfo_briefing_antre(text, text, text) from public;
grant execute on function public.cfo_briefing_antre(text, text, text) to anon, authenticated;

-- Jadwal (UTC): sinkron tindakan tiap 2 jam; cek tutup buku tiap hari 01:27 UTC (09:27 WITA).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('cfo-tindakan-sinkron', '23 */2 * * *', $c$select public.cfo_briefing_bangunkan('tindakan')$c$);
    perform cron.schedule('cfo-tutup-buku', '27 1 * * *', $c$select public.cfo_briefing_bangunkan('tutup_buku')$c$);
  end if;
end;
$$;
