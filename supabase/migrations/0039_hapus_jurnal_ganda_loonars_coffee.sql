-- ============================================================================
-- 0039 — Hapus jurnal ganda historis Loonars Coffee
--
-- STATUS: DISETUJUI owner dan DITERAPKAN ke produksi 2026-10-10.
-- Hasil: 28 baris (14 transaksi, Rp72.174.950) dihapus; biaya & Utang Toko
-- Bangunan LC = Rp72.174.950 (sama dengan MK Connect); neraca seimbang.
-- Diterapkan sebagai tiga perintah terpisah (blok gabungan membuat klien
-- Supabase MCP menggantung).
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

-- 1) arsip baris yang akan dihapus
insert into public.sync_log (direction, event_type, source_table, source_id, idempotency_key, payload, status)
select 'inbound', 'jurnal_duplikat_dihapus', 'jurnal', '0039', 'migrasi:0039:hapus-jurnal-ganda-loonars-coffee',
       jsonb_build_object('alasan', 'Biaya Loonars Coffee dijurnal dua kali (construction_expense_submitted + construction_project_financial_record) sebelum 0038',
                          'disetujui', 'owner 2026-10-10',
                          'jumlah_baris', count(*), 'total_debit_dihapus', coalesce(sum(g.d), 0),
                          'baris_dihapus', coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)),
       'succeeded'
  from public.jurnal g
 where g.idempotency_key like 'mkc:construction_cost_request:%'
   and exists (select 1 from public.construction_project_financial_records c where c.jurnal_no = g.no
                and exists (select 1 from public.jurnal e where e.source_system = 'mk_connect' and e.idempotency_key like 'mkc:construction_expense:%'
                             and e.source_ref = c.reference_document and e.d = c.amount));

-- 2) arahkan catatan biaya ke nomor jurnal asli
update public.construction_project_financial_records c
   set jurnal_no = (select e.no from public.jurnal e where e.source_system = 'mk_connect' and e.idempotency_key like 'mkc:construction_expense:%'
                     and e.source_ref = c.reference_document and e.d = c.amount limit 1),
       updated_at = now()
 where exists (select 1 from public.jurnal g where g.no = c.jurnal_no and g.idempotency_key like 'mkc:construction_cost_request:%')
   and exists (select 1 from public.jurnal e where e.source_system = 'mk_connect' and e.idempotency_key like 'mkc:construction_expense:%'
                and e.source_ref = c.reference_document and e.d = c.amount);

-- 3) hapus jurnal ganda yang sudah diarsip dan tidak dirujuk lagi
do $hapus$ begin
  delete from public.jurnal g
   where g.idempotency_key like 'mkc:construction_cost_request:%'
     and not exists (select 1 from public.construction_project_financial_records c where c.jurnal_no = g.no)
     and g.id in (select (x ->> 'id')::bigint from public.sync_log s, jsonb_array_elements(s.payload -> 'baris_dihapus') x
                   where s.idempotency_key = 'migrasi:0039:hapus-jurnal-ganda-loonars-coffee');
end $hapus$;
