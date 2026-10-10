-- ============================================================================
-- 0038 — Loonars Coffee mendapat kode proyek sendiri (LC) + cegah jurnal ganda
--
-- 1. KODE PROYEK LC (keputusan owner 2026-10-10)
--    Pembangunan Loonars Coffee selama ini dibukukan di bawah proyek LL
--    (Loonars Living) karena MK Connect mengirim mkh_project_code = 'LL'.
--    Mulai sekarang sync_inbound memetakannya ke 'LC'.
--    Pengenal yang dipakai (stabil, bukan teks bebas):
--      - construction_expense_submitted: branch_id cabang "Loonars Coffee"
--        di MK Connect (7e2b07a4-b1f4-41d1-889c-6d320d6d5cc2)
--      - construction_project_financial_record: construction_project_code
--        = 'LOONARS_COFFEE'
--    Baris historis dipindah dari LL ke LC (hanya kolom `proyek`; nominal,
--    akun, tanggal, dan nomor bukti tidak diubah — total perusahaan tetap).
--
-- 2. CEGAH JURNAL GANDA (bug ditemukan 2026-10-10)
--    Setiap biaya pembangunan yang disetujui di MK Connect mengirim DUA event:
--    construction_expense_submitted dan construction_project_financial_record.
--    Keduanya memposting jurnal untuk biaya yang SAMA (payload kedua
--    membawa posted_expense_id = id biaya yang sudah dijurnal oleh event
--    pertama). Akibatnya biaya & "Utang Toko Bangunan" tercatat dua kali.
--    Perbaikan (berlaku ke depan, dua arah karena urutan kedatangan event
--    tidak dijamin):
--      - event financial_record TIDAK memposting jurnal bila biaya itu sudah
--        punya jurnal dari construction_expense; baris
--        construction_project_financial_records tetap dibuat dan menunjuk ke
--        nomor jurnal yang sudah ada.
--      - event construction_expense TIDAK memposting jurnal bila sudah ada
--        financial_record berjurnal untuk biaya yang sama.
--    Duplikat HISTORIS tidak disentuh di migrasi ini — koreksinya menunggu
--    persetujuan owner (lihat 0039).
--
-- Cara mengubah sync_inbound: badan fungsi yang LIVE (25 KB) diambil dengan
-- pg_get_functiondef lalu diganti pada potongan yang persis — setiap
-- potongan WAJIB ditemukan tepat satu kali, kalau tidak migrasi gagal dan
-- tidak ada yang berubah. Ini menghindari menyalin ulang seluruh badan
-- fungsi dengan tangan (berkas migrasi repo untuk beberapa cabang terakhir
-- sync_inbound tidak ada di repo, jadi badan "lengkap" di repo sudah tidak
-- cocok dengan produksi).
-- ============================================================================

do $migrasi$
declare
  v_def text;
  v_baru text;

  -- (a) construction_expense_submitted: pemetaan LC + cegah ganda
  a_lama constant text := $a$      select public.next_mkh_no('KDI') into v_no_num;
      v_no := 'KDI-' || lpad(v_no_num::text, 3, '0');
$a$;
  a_baru constant text := $a$      -- 0038: cabang Loonars Coffee di MK Connect -> proyek LC
      if p_payload ->> 'branch_id' = '7e2b07a4-b1f4-41d1-889c-6d320d6d5cc2' then
        v_proyek := 'LC';
      end if;

      -- 0038: biaya ini sudah dijurnal lewat construction_project_financial_record?
      select r.jurnal_no into v_no
        from public.construction_project_financial_records r
       where r.reference_document = p_payload ->> 'construction_expense_id'
         and r.jurnal_no is not null
         and exists (select 1 from public.jurnal j where j.no = r.jurnal_no)
       limit 1;
      if v_no is not null then
        v_target_ref := v_no;
        update public.sync_log set status = 'succeeded', target_ref = v_target_ref,
               last_error = 'Sudah dijurnal lewat construction_project_financial_record (' || v_no || ')',
               updated_at = now()
         where id = v_sync_log_id;
        return jsonb_build_object('status', 'ok', 'target_ref', v_target_ref, 'duplikat', true);
      end if;

      select public.next_mkh_no('KDI') into v_no_num;
      v_no := 'KDI-' || lpad(v_no_num::text, 3, '0');
$a$;

  -- (b) construction_project_financial_record: pemetaan LC
  b_lama constant text := $b$      v_tipe := p_payload ->> 'request_type';
$b$;
  b_baru constant text := $b$      v_tipe := p_payload ->> 'request_type';
      -- 0038: Loonars Coffee -> proyek LC
      if coalesce(p_payload ->> 'construction_project_code', 'LOONARS_COFFEE') = 'LOONARS_COFFEE' then
        v_proyek := 'LC';
      end if;
$b$;

  -- (c) construction_project_financial_record: cegah ganda
  c_lama constant text := $c$      select public.next_mkh_no(v_proyek) into v_no_num;
      v_no := v_proyek || '-' || lpad(v_no_num::text, 3, '0');

      v_ket := 'Loonars Coffee: '$c$;
  c_baru constant text := $c$      -- 0038: biaya ini sudah dijurnal lewat construction_expense_submitted?
      v_no := null;
      select j.no into v_no
        from public.jurnal j
       where j.source_system = 'mk_connect'
         and j.idempotency_key like 'mkc:construction_expense:%'
         and j.source_ref is not null
         and j.source_ref = coalesce(p_payload ->> 'posted_expense_id', p_payload ->> 'posted_labor_payment_id')
       limit 1;

      if v_no is null then
      select public.next_mkh_no(v_proyek) into v_no_num;
      v_no := v_proyek || '-' || lpad(v_no_num::text, 3, '0');

      v_ket := 'Loonars Coffee: '$c$;

  d_lama constant text := $d$        (v_tgl, v_no, v_ket, v_credit_akun, v_credit_nama, v_proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', p_payload ->> 'cost_request_id');

      insert into public.construction_project_financial_records ($d$;
  d_baru constant text := $d$        (v_tgl, v_no, v_ket, v_credit_akun, v_credit_nama, v_proyek, 0, v_nominal, p_idempotency_key || ':k', 'mk_connect', p_payload ->> 'cost_request_id');
      end if;

      insert into public.construction_project_financial_records ($d$;

  function_hitung int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sync_inbound';

  -- setiap potongan harus muncul TEPAT sekali
  if (length(v_def) - length(replace(v_def, a_lama, ''))) / length(a_lama) <> 1 then
    raise exception '0038: potongan (a) tidak ditemukan tepat sekali di sync_inbound';
  end if;
  if (length(v_def) - length(replace(v_def, b_lama, ''))) / length(b_lama) <> 1 then
    raise exception '0038: potongan (b) tidak ditemukan tepat sekali di sync_inbound';
  end if;
  if (length(v_def) - length(replace(v_def, c_lama, ''))) / length(c_lama) <> 1 then
    raise exception '0038: potongan (c) tidak ditemukan tepat sekali di sync_inbound';
  end if;
  if (length(v_def) - length(replace(v_def, d_lama, ''))) / length(d_lama) <> 1 then
    raise exception '0038: potongan (d) tidak ditemukan tepat sekali di sync_inbound';
  end if;

  v_baru := replace(replace(replace(replace(v_def, a_lama, a_baru), b_lama, b_baru), c_lama, c_baru), d_lama, d_baru);
  execute v_baru;
end
$migrasi$;

-- ----------------------------------------------------------------------------
-- Pindahkan baris historis Loonars Coffee dari LL ke LC.
--   - jurnal dari construction_expense_submitted: dikenali lewat sync_log
--     (payload.branch_id cabang Loonars Coffee) → idempotency_key jurnal.
--   - jurnal + baris construction_project_financial_records dari
--     financial_record: construction_project_code = 'LOONARS_COFFEE'.
-- Jumlah baris yang dipindah dicatat di sync_log sebagai jejak audit.
-- ----------------------------------------------------------------------------
do $pindah$
declare
  n_jurnal_expense int;
  n_jurnal_cpfr int;
  n_cpfr int;
begin
  update public.jurnal j
     set proyek = 'LC'
   where j.proyek = 'LL'
     and j.source_system = 'mk_connect'
     and exists (
       select 1 from public.sync_log s
        where s.event_type = 'construction_expense_submitted'
          and s.payload ->> 'branch_id' = '7e2b07a4-b1f4-41d1-889c-6d320d6d5cc2'
          and j.idempotency_key in (s.idempotency_key || ':d', s.idempotency_key || ':k')
     );
  get diagnostics n_jurnal_expense = row_count;

  update public.jurnal j
     set proyek = 'LC'
   where j.proyek = 'LL'
     and j.no in (
       select r.jurnal_no from public.construction_project_financial_records r
        where r.construction_project_code = 'LOONARS_COFFEE'
     );
  get diagnostics n_jurnal_cpfr = row_count;

  update public.construction_project_financial_records
     set proyek = 'LC', updated_at = now()
   where construction_project_code = 'LOONARS_COFFEE' and proyek = 'LL';
  get diagnostics n_cpfr = row_count;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status)
  values (
    'inbound', 'reklasifikasi_proyek', 'jurnal', '0038',
    'migrasi:0038:reklasifikasi-loonars-coffee',
    jsonb_build_object(
      'dari', 'LL', 'ke', 'LC',
      'alasan', 'Keputusan owner 2026-10-10: Loonars Coffee mendapat kode proyek sendiri',
      'baris_jurnal_construction_expense', n_jurnal_expense,
      'baris_jurnal_financial_record', n_jurnal_cpfr,
      'baris_construction_project_financial_records', n_cpfr
    ),
    'succeeded'
  );
end
$pindah$;
