-- ============================================================================
-- 0042 — Laporan Investor lewat WhatsApp: tautan unduh sementara
--
-- Owner (2026-10-10): "ketika super admin WA ke sistem 'lapkeu' maka akan
-- dikirimkan". Pengirim WA MK Connect (Whacenter) melampirkan dokumen dari
-- sebuah URL publik, jadi PDF perlu tautan yang bisa diambil Whacenter —
-- tanpa menyimpan PDF di mana pun:
--   1. MK Connect (sudah memastikan pengirim super_admin) memanggil
--      ir_buat_tautan_wa dengan rahasia sync yang SUDAH ADA (x-sync-secret
--      = Vault mk_sync_shared_secret; diperiksa ir_boleh_akses dari 0041).
--   2. Database membuat token acak 256-bit, berlaku 10 menit, maks 3 kali
--      ambil (Whacenter kadang mengambil ulang).
--   3. Whacenter mengambil https://finance.haluoleo.id/api/laporan-investor/
--      unduh/<token>/<nama>.pdf; server mkh-properti memanggil
--      ir_ambil_data_tautan(token) dan membuat PDF saat itu juga.
-- Tabel token tidak bisa diakses anon/authenticated sama sekali; hanya
-- lewat dua RPC SECURITY DEFINER di bawah.
--
-- STATUS: DITERAPKAN ke produksi 2026-10-10 (lima bagian terpisah, 0042a–e).
-- Token kedaluwarsa tidak dihapus otomatis (tidak berbahaya: sudah tidak
-- bisa dipakai, dan maks 10 per nomor per jam).
--
-- Catatan penerapan: tanpa DROP / DELETE / pg_temp / SELECT tingkat atas
-- (klien Supabase MCP menggantung pada perintah itu).
-- ============================================================================

create table public.ir_tautan_unduh (
  token text primary key check (token ~ '^[0-9a-f]{64}$'),
  peminta text not null,
  parameter jsonb not null default '{}'::jsonb,
  dibuat_pada timestamptz not null default now(),
  kedaluwarsa_pada timestamptz not null default now() + interval '10 minutes',
  dipakai integer not null default 0,
  maks_pakai integer not null default 3
);

alter table public.ir_tautan_unduh enable row level security;
revoke all on public.ir_tautan_unduh from anon, authenticated;

-- Isi data laporan tanpa pemeriksaan akses — HANYA dipanggil dari fungsi
-- yang sudah memeriksa akses (ir_ambil_data, ir_ambil_data_tautan).
create or replace function public.ir_data_laporan(p_sampai date, p_peminta text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'peminta', p_peminta,
    'diambil_pada', now(),
    'unit_bisnis', coalesce((select jsonb_agg(to_jsonb(u) order by u.jenis, u.id) from public.ir_unit_bisnis u), '[]'::jsonb),
    'jurnal', coalesce((
      select jsonb_agg(jsonb_build_object('tgl', j.tgl, 'no', j.no, 'akun', j.akun, 'nama', j.nama,
                                          'proyek', j.proyek, 'd', j.d, 'k', j.k) order by j.tgl, j.id)
        from public.jurnal j where j.tgl <= p_sampai), '[]'::jsonb),
    'pendapatan_villa', coalesce((
      select jsonb_agg(jsonb_build_object('periode', to_char(v.periode, 'YYYY-MM'), 'kategori', v.kategori,
                                          'jumlah', v.jumlah, 'sumber', v.sumber, 'diubah', v.updated_at))
        from public.pendapatan_villa v where v.periode <= p_sampai), '[]'::jsonb),
    'beban_villa', coalesce((
      select jsonb_agg(jsonb_build_object('periode', to_char(b.periode, 'YYYY-MM'), 'kategori', b.kategori,
                                          'jumlah', b.jumlah, 'sumber', b.sumber))
        from public.beban_villa b where b.periode <= p_sampai), '[]'::jsonb),
    'utang_bank', coalesce((
      select jsonb_agg(jsonb_build_object('proyek', u.proyek, 'jenis', u.jenis, 'bank', u.bank, 'pokok', u.pokok,
                                          'terbayar', u.terbayar, 'tgl_akad', u.tgl_akad, 'jt_tempo', u.jt_tempo))
        from public.utang_bank u), '[]'::jsonb),
    'aset_ringkas', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('proyek', a.proyek, 'status', coalesce(a.status, '-'),
                                  'jumlah', count(*), 'nilai', coalesce(sum(a.harga), 0)) x
          from public.aset a group by a.proyek, a.status) s), '[]'::jsonb),
    'metrik', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.unit_id, m.periode) from public.ir_metrik_bulanan m
       where m.periode <= to_char(p_sampai, 'YYYY-MM')), '[]'::jsonb),
    'narasi', coalesce((
      select jsonb_object_agg(n.bagian, jsonb_build_object('isi', n.isi, 'dibuat_pada', n.dibuat_pada, 'dibuat_oleh', n.dibuat_oleh))
        from (select distinct on (bagian) * from public.ir_narasi order by bagian, id desc) n), '{}'::jsonb)
  );
$$;

revoke execute on function public.ir_data_laporan(date, text) from public, anon, authenticated;

-- ir_ambil_data (0040) kini memakai ir_data_laporan; perilaku sama persis.
create or replace function public.ir_ambil_data(p_sampai date, p_peminta_wa text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_peminta text;
begin
  v_peminta := public.ir_boleh_akses(p_peminta_wa);
  if v_peminta is null then
    raise exception 'Tidak berhak mengakses Laporan Investor' using errcode = '42501';
  end if;
  return public.ir_data_laporan(p_sampai, v_peminta);
end;
$$;

-- Dipanggil MK Connect (rahasia sync) untuk super admin yang meminta lewat WA.
create or replace function public.ir_buat_tautan_wa(p_nomor text, p_parameter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_peminta text;
  v_token text;
  v_param jsonb := coalesce(p_parameter, '{}'::jsonb);
begin
  -- Hanya jalur WA (rahasia sync MK Connect), bukan sesi web.
  if public.mkh_is_cfo() then
    raise exception 'Gunakan tombol Unduh PDF di halaman Laporan Investor' using errcode = '42501';
  end if;
  v_peminta := public.ir_boleh_akses(p_nomor);
  if v_peminta is null then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if jsonb_typeof(v_param) <> 'object' or length(v_param::text) > 2000 then
    raise exception 'parameter tidak valid' using errcode = '22023';
  end if;

  -- Batas wajar: maks 10 tautan per nomor per jam.
  if (select count(*) from public.ir_tautan_unduh where peminta = v_peminta and dibuat_pada > now() - interval '1 hour') >= 10 then
    raise exception 'Terlalu banyak permintaan laporan, coba lagi nanti' using errcode = '53400';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.ir_tautan_unduh (token, peminta, parameter) values (v_token, v_peminta, v_param);

  return jsonb_build_object('token', v_token, 'kedaluwarsa_pada', now() + interval '10 minutes');
end;
$$;

revoke execute on function public.ir_buat_tautan_wa(text, jsonb) from public;
grant execute on function public.ir_buat_tautan_wa(text, jsonb) to anon, authenticated;

-- Dipanggil server mkh-properti saat Whacenter mengambil tautan.
create or replace function public.ir_ambil_data_tautan(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.ir_tautan_unduh%rowtype;
  v_sampai text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Tautan tidak valid' using errcode = '42501';
  end if;
  select * into v_t from public.ir_tautan_unduh where token = p_token for update;
  if not found or v_t.kedaluwarsa_pada < now() or v_t.dipakai >= v_t.maks_pakai then
    raise exception 'Tautan tidak valid atau kedaluwarsa' using errcode = '42501';
  end if;
  update public.ir_tautan_unduh set dipakai = dipakai + 1 where token = p_token;

  v_sampai := coalesce(v_t.parameter ->> 'sampai', to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM'));
  return public.ir_data_laporan((to_date(v_sampai, 'YYYY-MM') + interval '1 month' - interval '1 day')::date, v_t.peminta)
         || jsonb_build_object('parameter', v_t.parameter);
end;
$$;

revoke execute on function public.ir_ambil_data_tautan(text) from public;
grant execute on function public.ir_ambil_data_tautan(text) to anon, authenticated;

-- Catat unduhan lewat tautan (hash PDF), tanpa membuka akses lain.
create or replace function public.ir_catat_unduhan_tautan(p_token text, p_sha256 text, p_ukuran integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.ir_tautan_unduh%rowtype;
begin
  select * into v_t from public.ir_tautan_unduh where token = p_token;
  if not found then
    raise exception 'Tautan tidak valid' using errcode = '42501';
  end if;
  insert into public.ir_unduhan_log (kanal, peminta, parameter, sha256, ukuran_byte)
  values ('whatsapp', v_t.peminta, v_t.parameter, p_sha256, p_ukuran);
end;
$$;

revoke execute on function public.ir_catat_unduhan_tautan(text, text, integer) from public;
grant execute on function public.ir_catat_unduhan_tautan(text, text, integer) to anon, authenticated;
