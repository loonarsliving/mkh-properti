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

## Relationships (as evidenced by column usage, not a formal ERD)
- `pengajuan.proyek` / `jurnal.proyek` reference a project code (matches `mkh_projects.kode`).
- `users_proyek.proyek_id` maps a user to a project.
- `cfo_users.email` is looked up against the authenticated caller's verified email.
- `sync_log.idempotency_key` is unique (relied on for dedup — see the `23505` unique-violation handling in `sync-inbound`).
- `crm_payment_receipts` references `mkc_payment_id`/`mkc_prospect_id` (external MK Connect IDs) and `jurnal_no`.

No secrets, keys, tokens, or passwords are recorded anywhere in this document.
