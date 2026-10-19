# DATABASE

Supabase Postgres project. Project ref visible in hardcoded frontend URL / `supabase/config.toml` comment: `gluoioiimapyhchdasfl` (`https://gluoioiimapyhchdasfl.supabase.co`). No credentials, keys, or secrets are reproduced in this document (the anon/publishable key does appear in the app's own client-side source, which is intentional/expected for a Supabase anon key, but is not repeated here).

## Migration history
55 migration files, `supabase/migrations/0001_...sql` through `0029_...sql` (audited: `0001`–`0029`, all present). This is an **append-only, incrementally-applied set relative to a pre-existing base schema** — the migration history does not contain `create table` statements for the app's core tables (`jurnal`, `pengajuan`, `aset`, `utang_bank`, `tukang_borongan`, `bayar_tukang`, `users_proyek`, `mkh_projects`, `loonars_fee`). Those tables are referenced (`alter table`, RPC bodies, frontend `sbGet`/`sbInsert` calls) as already existing. UNKNOWN — NEEDS CONFIRMATION: where/how those base tables were originally created (likely via the Supabase dashboard/SQL editor directly, predating this migration history).

## Tables created by migrations in this repo
| Table | Migration | Purpose |
|---|---|---|
| `sync_log` | 0001 | Outbound/inbound cross-system sync event log with idempotency key, status, target_ref |
| `sync_config` | 0001 | Sync configuration (per comment context) |
| `cfo_users` | 0026 | Allowlist of emails permitted to access the CFO/owner dashboard |
| `crm_payment_receipts` | 0009 (referenced)/0001 area | CRM payment receipts queue for CFO confirmation |
| `pendapatan_villa` | 0032 | Loonars Villa rental income (rental/cafe/spa/lainnya), manual entry for now — not posted into `jurnal`; see FEATURES.md/CURRENT_STATE.md |
| `beban_villa` | 0034 | Loonars Villa expenses (opex/marketing per akad, lainnya) — pairs with `pendapatan_villa` for `/laporan-villa`'s laba-rugi; see FEATURES.md |

## Tables referenced but not created here (pre-existing / external to migration history)
`jurnal` (general ledger), `pengajuan` (submissions/expense requests), `aset` (assets), `utang_bank` (bank debt), `tukang_borongan` (contractor work orders), `bayar_tukang` (contractor payments), `users_proyek` (user-to-project mapping), `mkh_projects` (project master data, incl. `rekening`/`bank` columns used by `sync-inbound`), `loonars_fee` (external loonars-sales commission table, altered by migration 0009 to add columns).

## Row Level Security (RLS)
- Per migration `0025`'s own detailed header comment: as of that migration's authoring, RLS was "enabled" on the core financial tables but every one carried a **permissive `USING (true)` policy granting the `anon` role full SELECT/INSERT/UPDATE/DELETE** — i.e., effectively no access control, because the frontend ships the anon key in client-side JS.
- Migration `0025` proposes tightening these to `authenticated`-role-only policies, but its own comment explicitly warns: **"Do NOT apply this against production until"** the frontend is changed to send the user's session access token instead of the anon key on these calls. Commit `c81ff34`'s message states this migration was added "(not applied live)".
- **Live/production RLS state is UNKNOWN — NEEDS CONFIRMATION.** Do not assume migration `0025` has been applied to the production database; the repo state and live database state may differ. Confirm directly against the Supabase project before relying on this for security assumptions.
- `cfo_users` (migration `0026`) has RLS enabled with an anon+authenticated read-only policy (`anon_read_cfo_users`) and **no write policy** — inserts/deletes are manual (dashboard/SQL editor) only, by design.

## RPC / Functions
| Function | Migration | Purpose |
|---|---|---|
| `get_sync_secret()` | 0001 | Returns the shared sync secret from Supabase Vault, used to authenticate inbound MK Connect calls |
| `sync_dispatch_pending()` | 0001 | Dispatches pending outbound sync_log rows (intended to run on a schedule — see ARCHITECTURE.md) |
| `sync_collect_responses()` | 0001 | Collects responses for dispatched sync events |
| `sync_inbound(idempotency_key, event_type, payload)` | 0003, redefined through 0027/0029 | Main inbound event router (also implemented in the `sync-inbound` Edge Function — UNKNOWN whether both paths are live simultaneously or the Edge Function calls this RPC; NEEDS CONFIRMATION by reading both bodies fully if this matters for a future change) |
| `next_mkh_no(p_prefix)` | 0003+ | Generates sequential document numbers (e.g. `KM-...`) |
| `loonars_login` | 0010 | Auth RPC for the external loonars-sales app's own login |
| `loonars_users_hash_password` | 0010 (trigger) | Password hashing trigger for loonars users |
| `jurnal_branch_balance_sync` | 0006 (trigger) | Keeps branch cash balance in sync when `jurnal` rows are written |
| `loonars_closing_declared_sync` | 0011/0012 | Syncs loonars-sales unit-closing declarations |
| `loonars_fee_submitted_sync` / `loonars_fee_approved_sync` | 0009 | Sync loonars fee submission/approval events outward |
| `pengajuan_expense_approved_sync` / `pengajuan_expense_submitted_sync` | 0006/0008 | Fire outbound sync + WhatsApp-alert events on expense submission/approval |
| `pengajuan_komisi_decided_sync` | (present, exact migration not individually re-listed) | Syncs commission decision events |
| `trg_crm_payment_receipt_confirmed_sync` | trigger | Fires when a CRM payment receipt is confirmed |

## Triggers
`crm_payment_receipt_after_update_sync`, `trg_pengajuan_expense_approved_sync`, `trg_jurnal_branch_balance_sync`, `trg_pengajuan_expense_submitted_sync`, `trg_loonars_fee_submitted_sync`, `trg_loonars_fee_approved_sync`, `trg_loonars_users_hash_password`, `trg_loonars_closing_declared_sync`, `trg_loonars_closing_declared_sync_insert`, `trg_pengajuan_komisi_decided_sync`. (Full list from `grep create trigger` across all migrations.)

## Views
No `create view` statements found in any migration. UNKNOWN whether views exist that were created outside migrations.

## Storage
No references to Supabase Storage (`storage.buckets`, `/storage/v1`, `.storage.`) found anywhere in the app or migrations. Per migration `0027`'s comment, WhatsApp receipt photos are explicitly **not stored** ("no image is stored — read once, then discarded" by the external MK Connect AI). **Storage is NOT USED / NOT IMPLEMENTED** in this app as far as this repo shows.

## Secrets used by the database layer
- `mk_sync_shared_secret` (name only, per migration `0009`'s comment) — stored in Supabase Vault, retrieved via `get_sync_secret()`. No value present in this repo.
- `SUPABASE_SERVICE_ROLE_KEY` — used only inside Edge Functions via `Deno.env.get`, never in client code (this was explicitly fixed — see commit `b50250a`, "remove hardcoded service_role key", and the `admin-create-user` function's own header comment describing the prior vulnerability).

## `pendapatan_villa` (added 2026-09-10, migration `0032`)
`id, periode (date, always the 1st of the month), kategori (rental|cafe|spa|lainnya), jumlah, keterangan, sumber (manual|villa_api, default manual), idempotency_key (unique, nullable), created_by, created_at, updated_at`.
Holds Loonars Villa rental income, entered manually via `/pendapatan-villa`
(CFO-only). **Not wired into `jurnal`** — villa income isn't part of this
app's PROYEK/COA, and choosing an account/proyek for it is an accounting
decision left to the owner, not invented by this migration. `sumber`/
`idempotency_key` exist so a future automatic sync from the villa system
(a *different* Supabase project, `svcmybsziaelwwdrnzcv` — see "Supabase
project" above) can populate this table without a schema change; no such
sync exists yet. RLS follows the same permissive `anon`+`authenticated`
`USING (true)` pattern as `crm_payment_receipts`/`jurnal`/etc. (see RLS
section above) — this is a new table, not a live-production carry-over, but
it was made consistent with the rest of this app's current (pre-`0025`)
access model rather than introducing a one-off stricter table that the
anon-key frontend couldn't actually use yet.

## `villa_income_sync` RPC (added 2026-09-10, migration `0033`)
`public.villa_income_sync(p_periode date, p_items jsonb) returns jsonb` — inbound
sync target for Loonars Villa's monthly income push into `pendapatan_villa`.
See INTEGRATIONS.md "Loonars Villa" section for the full design and why it's a
separate function from `sync_inbound`. Vault secret `villa_sync_shared_secret`
gates it via the `x-villa-sync-secret` header (checked inside the function,
not by Supabase's own JWT layer) — `EXECUTE` is granted to `anon`/`authenticated`
so PostgREST's normal RPC path works with the already-public anon key; the
secret is what actually authorizes the call, not the key. No value is
recorded in this repo.

## Relationships (as evidenced by column usage, not a formal ERD)
- `pengajuan.proyek` / `jurnal.proyek` reference a project code (matches `mkh_projects.kode`).
- `users_proyek.proyek_id` maps a user to a project.
- `cfo_users.email` is looked up against the authenticated caller's verified email.
- `sync_log.idempotency_key` is unique (relied on for dedup — see the `23505` unique-violation handling in `sync-inbound`).
- `crm_payment_receipts` references `mkc_payment_id`/`mkc_prospect_id` (external MK Connect IDs) and `jurnal_no`.

No secrets, keys, tokens, or passwords are recorded anywhere in this document.

## 2026-10-10 — migrasi 0036–0040
- `0036_akses_staf_login` (live): fungsi `mkh_email_login()`, `mkh_is_cfo()`,
  `mkh_is_staf()`; policy `staf_akses_penuh` di tabel keuangan; RPC
  `lapor_lapangan_kirim(p_proyek, p_pelapor, p_data)`.
- `0037_tutup_akses_anon` (live): cabut akses anon; kunci tabel aplikasi
  yang tidak dipakai lagi. Policy lama dinetralkan `TO service_role`.
- `0038_loonars_coffee_kode_proyek_dan_cegah_jurnal_ganda` (live): ubah
  `sync_inbound` lewat penggantian potongan tepat (bukan salin seluruh badan,
  karena repo tidak lagi punya badan lengkap yang cocok dengan produksi).
- `0039_hapus_jurnal_ganda_loonars_coffee` (live, disetujui owner).
- `0040_laporan_investor` (live): `ir_unit_bisnis`, `ir_metrik_bulanan`
  (+ `ir_metrik_log` via trigger), `ir_narasi` (append-only),
  `ir_unduhan_log`, `ir_wa_penerima`; RPC `ir_metrik_terima`,
  `ir_ambil_data`, `ir_catat_unduhan`; kontrak kunci `ir_kunci_metrik_v1()`.
  Semua CFO-only, tanpa policy anon.
- `0041_laporan_investor_pakai_secret_yang_ada` (live): `ir_metrik_terima`
  dan `ir_boleh_akses` memakai Vault secret yang sudah ada
  (`mk_sync_shared_secret`, `villa_sync_shared_secret`); tidak ada secret
  baru. `ir_wa_penerima` tidak dipakai (akses dicabut).

## 2026-10-11 — migrasi 0043 (Keuangan Loonars 2) — LIVE (diterapkan sebagai 0043a–h, lihat CURRENT_STATE.md)

Tabel (semua RLS, select hanya CFO): `loonars2_settings` (1 baris),
`loonars2_unit_types`, `loonars2_accounts` (A/B/C/D), `loonars2_units` (17),
`loonars2_receipts`, `loonars2_allocations`, `loonars2_material_requests`,
`loonars2_disbursements` (check aturan rekening: B=tanah, C=material/tukang/
fee/lain_konstruksi, D=profit), `loonars2_wa_users`, `loonars2_wa_pending`,
`loonars2_wa_log`, `loonars2_outbox`, `loonars2_audit_log`.
Edit langsung CFO hanya untuk settings/unit_types/accounts/units/wa_users;
uang hanya lewat RPC `loonars2_web(p_aksi, p_data)` (CFO) dan
`loonars2_wa(p_nomor, p_aksi, p_data)` (header x-sync-secret).
View: `loonars2_v_unit`, `loonars2_v_rekening`, `loonars2_v_lama_mengendap`
(security_invoker). Cron: `loonars2-pengingat` (*/15), `loonars2-outbox` (*/1).
Fungsi internal `_loonars2_*` tertutup untuk klien.

## 2026-10-19 — migrasi 0051 (utang langsung sah + penjaga double) — LIVE
Fungsi baru `_loonars2_kunci_toko`, `_loonars2_cek_utang_double`; `_loonars2_cari_toko` memakai kunci nama. `_loonars2_pesan_bahan` & `_loonars2_catat_utang` memasukkan utang berstatus `disetujui`; `_loonars2_wa_jalankan` memeriksa double sebelum mencatat; `_loonars2_putuskan_kode` boleh menolak utang yang sudah disetujui. Tanpa tabel/kolom baru. Dijalankan di produksi sebagai 0051a–d (0051d, penghapusan 2 toko kosong, tidak selesai: DELETE lewat MCP butuh konfirmasi).

## 2026-10-15 — migrasi 0050 (bukti diteruskan ke pelaksana) — LIVE
- Hanya mengganti argumen gambar pada pemberitahuan ke pelaksana di `_loonars2_bayar_kelompok` (disisipkan lewat DO-block pada definisi yang ada).

## 2026-10-15 — migrasi 0049 (bukti transfer otomatis, dana talangan) — LIVE (0049a–d)
- Kolom baru `loonars2_disbursements.talangan` (default false). Diganti: `_loonars2_catat_pengeluaran`, `_loonars2_bayar_kelompok` (boleh melewati saldo C hanya bila GUC `loonars2.talangan='ya'`, diset oleh jalur bukti owner). Baru: `_loonars2_bukti_transfer`; cabang `bukti_kandidat` & `bukti_transfer` di `_loonars2_wa_jalankan` (disisipkan lewat 0049d).

## 2026-10-14 — migrasi 0048 (borongan otomatis) — LIVE (0048a–c)
- `loonars2_settings`: + `tukang_nilai_per_unit` (35 jt), `tukang_retensi_per_unit` (9 jt), `tukang_minggu` (12).
- Fungsi baru `_loonars2_siapkan_borongan`; diganti `_loonars2_ajukan_mingguan` (banyak borongan, biaya lain tanpa unit, cicilan lunas) dan `_loonars2_butuh_unit`.

## 2026-10-14 — migrasi 0047 (borongan, bahan kolektif, unit dibangun) — LIVE (0047a1–h2)
- Kolom baru: `loonars2_units.sedang_dibangun`; `loonars2_material_requests.borongan_id, minggu_ke, retensi, pesanan_id`; `loonars2_utang_toko.pesanan_id`. Indeks unik: satu minggu per unit per borongan, satu retensi per unit.
- Tabel baru (RLS cfo_baca + audit): `loonars2_borongan` (nama, nilai_per_unit, retensi_per_unit, jumlah_minggu, status), `loonars2_borongan_unit` (unit unik), `loonars2_pesanan_bahan`, `loonars2_bahan_unit` (pembagian per item per unit; koreksi = aktif=false + baris baru, tanpa DELETE).
- View: `loonars2_v_borongan`, `loonars2_v_rab_bahan` (security_invoker).
- Fungsi: `_loonars2_nominal_minggu`, `_buat_borongan`, `_pesan_bahan`, `_koreksi_bahan`, `_teks_rab`, `_atur_unit_dibangun`, `_butuh_unit`, dll.; diganti: `_cek_unit_boleh` (DP ATAU sedang dibangun), `_ajukan_mingguan`, `_wa_jalankan`, `loonars2_pengingat` (contoh format baru), `loonars2_web_lihat` (+borongan, rab). Aksi WA baru: unit_dibangun, borongan, daftar_borongan, bahan, koreksi_bahan, rab.
- Pembulatan: nominal & jumlah barang dibagi dengan sisa ke unit pertama; selisih borongan di minggu terakhir, jumlah selalu persis.

## 2026-10-13 — migrasi 0046 (tabel `loonars2_akses_web`) — LIVE (0046a–c)
- Tabel baru `loonars2_akses_web (id, email, nama, dibuat_pada)`, unik `lower(email)`, RLS: CFO kelola, pemilik email hanya baca barisnya, trigger audit. Menggantikan kebutuhan baris kedua di `users_proyek` (email unik di sana). `loonars2_boleh_lihat()` diperbarui. Seed: vando@haluoleo.id.

## 2026-10-13 — migrasi 0045 (akses baca-saja pelaksana) — LIVE (0045a–b)
- Fungsi baru: `loonars2_boleh_lihat()` (CFO atau `users_proyek.proyek_id = 'LOONARS2'`), `loonars2_web_lihat()` (jsonb read-only: proyeksi tanah, unit tanpa pembeli/harga/pembayaran, toko, utang, cicilan, pengajuan). Keduanya security definer, EXECUTE hanya `authenticated`.
- Tidak ada tabel/kolom baru dan tidak ada policy SELECT baru pada `loonars2_*`: pelaksana tidak bisa membaca tabel langsung.

## 2026-10-11 — migrasi 0044 (utang toko + pengajuan mingguan) — LIVE (0044a–h)

Tabel: `loonars2_toko`, `loonars2_utang_toko` (kode kelompok U-n, per unit),
`loonars2_cicilan` (kode M-n, per toko). Kolom baru: `loonars2_material_requests.kelompok`,
`loonars2_disbursements.toko_id/cicilan_id` (check: cicilan hanya dari C,
kategori material), `loonars2_settings.hari_pengajuan_mingguan`. View baru
`loonars2_v_toko`; `loonars2_v_unit` kini menambah `utang_disetujui` dan
memasukkannya ke `terpakai_konstruksi`. Sequence `loonars2_kelompok_seq`.
