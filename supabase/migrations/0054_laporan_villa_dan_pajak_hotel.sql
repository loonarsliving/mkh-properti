-- ============================================================================
-- MKH Property — 0054: Laporan keuangan villa (kiriman harian) + pajak hotel
--
-- Permintaan owner 2026-10-21: MKH Property punya laporan keuangan khusus
-- villa yang bisa diminta lewat WhatsApp, dan rekap pajak hotel (PBJT jasa
-- perhotelan) untuk Dispenda. "Tidak perlu realtime, per hari saja."
--
-- Yang ditambahkan (semua tabel dan fungsi BARU; tidak ada yang diubah):
--   1. laporan_villa_bulanan   Snapshot keuangan villa per bulan, diisi
--                              villa-api tiap malam: kotor, komisi OTA,
--                              bersih, COGS, gross profit, OPEX, net profit.
--   2. pajak_hotel_villa       Tarif/dasar pajak per bulan dan catatan
--                              setoran ke Dispenda (dibekukan saat dicatat).
--   3. villa_laporan_terima()  Penerima kiriman harian dari villa-api.
--   4. villa_laporan_ringkasan_wa()  Ringkasan untuk permintaan WhatsApp.
--
-- Sengaja TIDAK memakai tabel `jurnal` / COA: villa belum menjadi proyek di
-- buku besar ini (lihat 0032). Laporan pajak dibuat dari angka transaksi
-- villa yang sebenarnya; tidak ada penyesuaian angka di sini.
--
-- Auth penerima: pola villa_income_sync (0033). SECURITY DEFINER, EXECUTE ke
-- anon/authenticated, dijaga rahasia Vault `villa_sync_shared_secret` lewat
-- header x-villa-sync-secret -- rahasia yang sudah dipakai villa, TIDAK ada
-- rahasia baru. Ringkasan WA memakai ir_boleh_akses() (0041): CFO login atau
-- x-sync-secret MK Connect + nomor super admin.
--
-- Catatan penerapan: tanpa DROP dan tanpa SELECT tingkat atas (lihat 0037).
-- ============================================================================

create table if not exists public.laporan_villa_bulanan (
  -- Selalu tanggal 1 pada bulannya.
  periode date primary key check (extract(day from periode) = 1),
  status text not null check (status in ('sementara', 'final')),
  -- Total yang dibayar tamu per booking, SEBELUM komisi OTA.
  omzet_kotor numeric(16, 2) not null,
  komisi_ota numeric(16, 2) not null,
  -- Uang yang diterima villa setelah komisi OTA.
  pendapatan_bersih numeric(16, 2) not null,
  -- Cafe/spa/lainnya (bukan sewa kamar), dilaporkan terpisah.
  pendapatan_walkin numeric(16, 2) not null default 0,
  malam_terjual int not null,
  malam_gratis int not null default 0,
  malam_tersedia int not null default 0,
  okupansi_pct numeric(6, 1),
  cogs_per_malam numeric(14, 2) not null,
  cogs numeric(16, 2) not null,
  gross_profit numeric(16, 2) not null,
  -- OPEX = gaji staf.
  opex numeric(16, 2) not null,
  net_profit numeric(16, 2) not null,
  -- Rincian per channel, komponen COGS, gaji, dan bagi hasil.
  rincian jsonb not null default '{}'::jsonb,
  diterima_pada timestamptz not null default now()
);

comment on table public.laporan_villa_bulanan is
  'Laporan keuangan Loonars Villa per bulan, dikirim villa-api tiap malam lewat villa_laporan_terima(). Bulan berjalan = sementara; bulan lalu dikirim ulang tanggal 1-5 sebagai final. Angka sama dengan Finance villa.';
comment on column public.laporan_villa_bulanan.omzet_kotor is
  'Total yang dibayar tamu per booking sebelum komisi OTA (Grand Total Cloudbeds untuk OTA). Dasar pajak hotel bila dasar = kotor.';

alter table public.laporan_villa_bulanan enable row level security;
revoke all on public.laporan_villa_bulanan from anon, authenticated;
grant select on public.laporan_villa_bulanan to authenticated;

create policy cfo_baca on public.laporan_villa_bulanan for select to authenticated
  using ((select public.mkh_is_cfo()));

-- ----------------------------------------------------------------------------
-- Pajak hotel (PBJT jasa perhotelan). Satu baris per bulan, dibuat saat CFO
-- mencatat setoran atau mengubah tarif/dasar. Tanpa baris: tarif 10% dan
-- dasar 'kotor' (bawaan sampai Dispenda mengonfirmasi aturan daerah).
-- ----------------------------------------------------------------------------
create table if not exists public.pajak_hotel_villa (
  periode date primary key check (extract(day from periode) = 1),
  tarif_pct numeric(5, 2) not null default 10 check (tarif_pct >= 0 and tarif_pct <= 100),
  -- kotor = total dibayar tamu; bersih = diterima villa setelah komisi OTA.
  -- Pilihan mengikuti aturan Dispenda, bukan selera.
  dasar text not null default 'kotor' check (dasar in ('kotor', 'bersih')),
  -- Dibekukan dari laporan saat setoran dicatat.
  dasar_pengenaan numeric(16, 2),
  pajak_terutang numeric(16, 2),
  jumlah_disetor numeric(16, 2) check (jumlah_disetor is null or jumlah_disetor >= 0),
  tgl_setor date,
  bukti_ref text,
  catatan text,
  dicatat_oleh text,
  diperbarui_pada timestamptz not null default now()
);

comment on table public.pajak_hotel_villa is
  'Pengaturan dan setoran pajak hotel (PBJT jasa perhotelan) villa per bulan, untuk Dispenda. Angka dasar diambil dari laporan_villa_bulanan apa adanya.';

alter table public.pajak_hotel_villa enable row level security;
revoke all on public.pajak_hotel_villa from anon, authenticated;
grant select, insert, update on public.pajak_hotel_villa to authenticated;

create policy cfo_kelola on public.pajak_hotel_villa for all to authenticated
  using ((select public.mkh_is_cfo()))
  with check ((select public.mkh_is_cfo()));

-- ----------------------------------------------------------------------------
-- Penerima kiriman harian dari villa-api.
-- ----------------------------------------------------------------------------
create or replace function public.villa_laporan_terima(
  p_periode date,
  p_data jsonb,
  p_status text default 'sementara'
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
  v_provided text;
  v_kunci_asing text[];
  v_periode_txt text;
  v_omzet numeric;
  v_komisi numeric;
  v_bersih numeric;
  v_malam int;
  v_cogs_malam numeric;
  v_cogs numeric;
  v_gross numeric;
  v_opex numeric;
  v_net numeric;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'villa_sync_shared_secret';
  v_provided := coalesce(
    current_setting('request.headers', true)::json ->> 'x-villa-sync-secret',
    current_setting('request.header.x-villa-sync-secret', true)
  );
  if v_secret is null or v_provided is distinct from v_secret then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;

  if p_periode is null or extract(day from p_periode) <> 1 then
    raise exception 'p_periode harus tanggal 1 pada bulannya (contoh: 2026-10-01)' using errcode = '22023';
  end if;
  if p_status not in ('sementara', 'final') then
    raise exception 'status harus sementara/final' using errcode = '22023';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 100000 then
    raise exception 'p_data harus objek JSON' using errcode = '22023';
  end if;

  select array_agg(k) into v_kunci_asing
    from jsonb_object_keys(p_data) k
   where k <> all (array[
     'omzet_kotor', 'komisi_ota', 'pendapatan_bersih', 'pendapatan_walkin',
     'malam_terjual', 'malam_gratis', 'malam_tersedia', 'okupansi_pct',
     'cogs_per_malam', 'cogs', 'gross_profit', 'opex', 'net_profit', 'rincian'
   ]);
  if v_kunci_asing is not null then
    raise exception 'Kunci di luar kontrak: %', array_to_string(v_kunci_asing, ', ') using errcode = '22023';
  end if;

  v_omzet := (p_data ->> 'omzet_kotor')::numeric;
  v_komisi := (p_data ->> 'komisi_ota')::numeric;
  v_bersih := (p_data ->> 'pendapatan_bersih')::numeric;
  v_malam := (p_data ->> 'malam_terjual')::int;
  v_cogs_malam := (p_data ->> 'cogs_per_malam')::numeric;
  v_cogs := (p_data ->> 'cogs')::numeric;
  v_gross := (p_data ->> 'gross_profit')::numeric;
  v_opex := (p_data ->> 'opex')::numeric;
  v_net := (p_data ->> 'net_profit')::numeric;
  if v_omzet is null or v_komisi is null or v_bersih is null or v_malam is null
     or v_cogs_malam is null or v_cogs is null or v_gross is null or v_opex is null or v_net is null then
    raise exception 'Angka wajib tidak lengkap' using errcode = '22023';
  end if;

  v_periode_txt := to_char(p_periode, 'YYYY-MM');

  insert into public.laporan_villa_bulanan (
    periode, status, omzet_kotor, komisi_ota, pendapatan_bersih, pendapatan_walkin,
    malam_terjual, malam_gratis, malam_tersedia, okupansi_pct,
    cogs_per_malam, cogs, gross_profit, opex, net_profit, rincian, diterima_pada
  ) values (
    p_periode, p_status, v_omzet, v_komisi, v_bersih, coalesce((p_data ->> 'pendapatan_walkin')::numeric, 0),
    v_malam, coalesce((p_data ->> 'malam_gratis')::int, 0), coalesce((p_data ->> 'malam_tersedia')::int, 0),
    (p_data ->> 'okupansi_pct')::numeric,
    v_cogs_malam, v_cogs, v_gross, v_opex, v_net, coalesce(p_data -> 'rincian', '{}'::jsonb), now()
  )
  on conflict (periode) do update
     set status = excluded.status,
         omzet_kotor = excluded.omzet_kotor,
         komisi_ota = excluded.komisi_ota,
         pendapatan_bersih = excluded.pendapatan_bersih,
         pendapatan_walkin = excluded.pendapatan_walkin,
         malam_terjual = excluded.malam_terjual,
         malam_gratis = excluded.malam_gratis,
         malam_tersedia = excluded.malam_tersedia,
         okupansi_pct = excluded.okupansi_pct,
         cogs_per_malam = excluded.cogs_per_malam,
         cogs = excluded.cogs,
         gross_profit = excluded.gross_profit,
         opex = excluded.opex,
         net_profit = excluded.net_profit,
         rincian = excluded.rincian,
         diterima_pada = now()
   -- Bulan yang sudah final tidak diturunkan kembali menjadi sementara.
   where public.laporan_villa_bulanan.status <> 'final' or excluded.status = 'final';

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status, target_ref)
  values ('inbound', 'villa_laporan_diterima', 'laporan_villa_bulanan', v_periode_txt,
          'villa-laporan:' || v_periode_txt,
          jsonb_build_object('periode', v_periode_txt, 'status', p_status, 'omzet_kotor', v_omzet,
                             'pendapatan_bersih', v_bersih, 'net_profit', v_net),
          'succeeded', v_periode_txt)
  on conflict (idempotency_key) do update
    set payload = excluded.payload, status = 'succeeded', last_error = null, updated_at = now();

  return jsonb_build_object('status', 'ok', 'periode', v_periode_txt, 'laporan_status', p_status);
end;
$$;

comment on function public.villa_laporan_terima(date, jsonb, text) is
  'Penerima kiriman harian laporan keuangan villa dari villa-api (POST /cron/sync-laporan-villa). Dijaga rahasia Vault villa_sync_shared_secret (header x-villa-sync-secret).';

revoke all on function public.villa_laporan_terima(date, jsonb, text) from public;
grant execute on function public.villa_laporan_terima(date, jsonb, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Ringkasan untuk permintaan WhatsApp (asisten WA owner di MK Connect).
-- Hanya baca. Akses: ir_boleh_akses() -- CFO login, atau x-sync-secret
-- MK Connect + nomor super admin. Pajak dihitung dari angka laporan
-- (dasar kotor/bersih sesuai pajak_hotel_villa, bawaan kotor 10%).
-- ----------------------------------------------------------------------------
create or replace function public.villa_laporan_ringkasan_wa(
  p_peminta_wa text,
  p_periode date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_periode date;
  v_lap public.laporan_villa_bulanan%rowtype;
  v_paj public.pajak_hotel_villa%rowtype;
  v_tarif numeric := 10;
  v_dasar text := 'kotor';
  v_dasar_angka numeric;
begin
  if public.ir_boleh_akses(p_peminta_wa) is null then
    raise exception 'Tidak berhak' using errcode = '42501';
  end if;

  v_periode := date_trunc('month', coalesce(p_periode, (now() at time zone 'Asia/Jakarta')::date))::date;

  select * into v_lap from public.laporan_villa_bulanan where periode = v_periode;
  if not found then
    return jsonb_build_object('ada_data', false, 'periode', to_char(v_periode, 'YYYY-MM'));
  end if;

  select * into v_paj from public.pajak_hotel_villa where periode = v_periode;
  if found then
    v_tarif := v_paj.tarif_pct;
    v_dasar := v_paj.dasar;
  end if;
  v_dasar_angka := case v_dasar when 'bersih' then v_lap.pendapatan_bersih else v_lap.omzet_kotor end;

  return jsonb_build_object(
    'ada_data', true,
    'periode', to_char(v_periode, 'YYYY-MM'),
    'status', v_lap.status,
    'diperbarui', v_lap.diterima_pada,
    'omzet_kotor', v_lap.omzet_kotor,
    'komisi_ota', v_lap.komisi_ota,
    'pendapatan_bersih', v_lap.pendapatan_bersih,
    'pendapatan_walkin', v_lap.pendapatan_walkin,
    'malam_terjual', v_lap.malam_terjual,
    'okupansi_pct', v_lap.okupansi_pct,
    'cogs', v_lap.cogs,
    'gross_profit', v_lap.gross_profit,
    'opex', v_lap.opex,
    'net_profit', v_lap.net_profit,
    'pajak_hotel', jsonb_build_object(
      'tarif_pct', v_tarif,
      'dasar', v_dasar,
      'dasar_pengenaan', v_dasar_angka,
      'pajak_terutang', round(v_dasar_angka * v_tarif / 100),
      'jumlah_disetor', v_paj.jumlah_disetor,
      'tgl_setor', v_paj.tgl_setor
    )
  );
end;
$$;

comment on function public.villa_laporan_ringkasan_wa(text, date) is
  'Ringkasan keuangan villa (dan pajak hotel terutang) untuk asisten WA owner. Hanya baca; akses lewat ir_boleh_akses().';

revoke all on function public.villa_laporan_ringkasan_wa(text, date) from public;
grant execute on function public.villa_laporan_ringkasan_wa(text, date) to anon, authenticated;
