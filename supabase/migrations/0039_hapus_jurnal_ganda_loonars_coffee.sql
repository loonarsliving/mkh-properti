-- ============================================================================
-- 0039 — Hapus jurnal ganda historis Loonars Coffee
--
-- !! MENUNGGU PERSETUJUAN OWNER — mengubah isi buku besar. Jangan diterapkan
-- !! sebelum owner menyetujui secara eksplisit.
--
-- Latar belakang: lihat 0038. Sebelum 0038, setiap biaya pembangunan Loonars
-- Coffee dijurnal dua kali:
--   (1) dari construction_expense_submitted — nomor KDI-xxx, tanggal = tanggal
--       biaya di MK Connect (expense_date), idempotency 'mkc:construction_expense:<id>'
--   (2) dari construction_project_financial_record — nomor LC-/LL-xxx yang
--       tercantum di construction_project_financial_records.jurnal_no, tanggal
--       = tanggal sinkronisasi.
-- Keduanya untuk biaya yang SAMA (financial_record.reference_document =
-- id biaya pada (1)).
--
-- Yang dipertahankan: (1), karena tanggalnya tanggal transaksi sebenarnya.
-- Yang dihapus: jurnal (2) — HANYA bila pasangan (1)-nya benar-benar ada
-- dengan nominal yang sama. Baris construction_project_financial_records
-- diarahkan ke nomor jurnal (1). Seluruh baris yang dihapus disalin utuh ke
-- sync_log (event 'jurnal_duplikat_dihapus') agar bisa dipulihkan.
--
-- Dampak (diuji 2026-10-10 dalam transaksi yang dibatalkan): biaya LC dan
-- Utang Toko Bangunan LC masing-masing turun sebesar total duplikat;
-- neraca tetap seimbang (setiap pasangan debet/kredit dihapus utuh).
-- ============================================================================

do $hapus$
declare
  r record;
  v_arsip jsonb := '[]'::jsonb;
  v_jumlah int := 0;
  v_nominal numeric := 0;
begin
  for r in
    select c.id as cpfr_id, c.jurnal_no as no_ganda, c.amount, e.no as no_asli
      from public.construction_project_financial_records c
      join lateral (
        select j.no
          from public.jurnal j
         where j.source_system = 'mk_connect'
           and j.idempotency_key like 'mkc:construction_expense:%'
           and j.source_ref = c.reference_document
           and j.d = c.amount
         limit 1
      ) e on true
     where c.jurnal_no is not null
       and c.jurnal_no <> e.no
       and exists (select 1 from public.jurnal g where g.no = c.jurnal_no and g.idempotency_key like 'mkc:construction_cost_request:%')
  loop
    v_arsip := v_arsip || coalesce((
      select jsonb_agg(to_jsonb(g)) from public.jurnal g
       where g.no = r.no_ganda and g.idempotency_key like 'mkc:construction_cost_request:%'
    ), '[]'::jsonb);

    delete from public.jurnal g
     where g.no = r.no_ganda and g.idempotency_key like 'mkc:construction_cost_request:%';

    update public.construction_project_financial_records
       set jurnal_no = r.no_asli, updated_at = now()
     where id = r.cpfr_id;

    v_jumlah := v_jumlah + 1;
    v_nominal := v_nominal + r.amount;
  end loop;

  insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status)
  values (
    'inbound', 'jurnal_duplikat_dihapus', 'jurnal', '0039',
    'migrasi:0039:hapus-jurnal-ganda-loonars-coffee',
    jsonb_build_object(
      'alasan', 'Biaya Loonars Coffee dijurnal dua kali (construction_expense_submitted + construction_project_financial_record) sebelum 0038',
      'jumlah_transaksi', v_jumlah,
      'total_nominal', v_nominal,
      'baris_dihapus', v_arsip
    ),
    'succeeded'
  );
end
$hapus$;
