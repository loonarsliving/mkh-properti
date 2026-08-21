# ENVIRONMENT

Full grep audit performed across `*.html` and `supabase/` for `process.env`, `import.meta.env`, `Deno.env`, and any `.env*` file. No values are recorded below — names and purpose only.

## Frontend (`.html` pages)
**No environment variables are used.** There is no build step, so there is no `process.env`/`import.meta.env` substitution mechanism available to these pages. Configuration that would normally be an env var (Supabase URL, Supabase anon/publishable key) is instead **hardcoded directly as JS constants** in each page (e.g. `SB_URL`, `SB_KEY` in `index.html`; equivalent constants repeated per page). This is expected/acceptable for a Supabase **anon** key (it is designed to be public and is not a secret), but it does mean there is no per-environment (dev/staging/prod) config switch in the frontend at all — every page always points at the same hardcoded Supabase project.

## Edge Functions (Deno, `supabase/functions/*`)
| Variable | Used in | Purpose | Required/Optional | Local/Prod | Source |
|---|---|---|---|---|---|
| `SUPABASE_URL` | `admin-create-user/index.ts`, `sync-inbound/index.ts` | Base URL for the Supabase client (`createClient`) inside the function | Required | Both | Auto-injected by the Supabase platform into every Edge Function's runtime — not something a developer sets manually via `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | `admin-create-user/index.ts`, `sync-inbound/index.ts` | Privileged Supabase client to bypass RLS for admin operations (create user, write sync records) | Required | Both | Auto-injected by the Supabase platform |

Both are read via `Deno.env.get("...")!` (non-null assertion — the functions will throw if these are ever missing, which is expected since Supabase always provides them for deployed functions).

## Repo-level `.gitignore` env references (files, not variable names)
The `.gitignore` lists `.env`, `.env.local`, `.env.*.local`, `.env.production` — standard Vercel/Node conventions — but **none of these files exist in the repository** (correctly, since they're git-ignored) and, per the frontend audit above, the frontend doesn't actually consume any env vars, so it's UNKNOWN — NEEDS CONFIRMATION what (if anything) such a `.env.production` file would contain in practice. It may be a leftover from an earlier or parallel Vercel project setup, or reserved for future use.

## Database-level secret (not an OS/process env var, but functionally similar)
`mk_sync_shared_secret` — stored in **Supabase Vault** (not an env var in the traditional sense), retrieved inside Postgres via the `get_sync_secret()` RPC (migration `0001_sync_foundation.sql`) and compared against the `X-Sync-Secret` request header in `sync-inbound`. No value is recorded here.

## Conclusion
This project has an unusually small environment-variable surface because it has no build step and no traditional application server — configuration lives either hardcoded in HTML (Supabase URL/anon key — intentionally public) or in Supabase-platform-managed Edge Function runtime injection (service role key — never client-exposed) or in Supabase Vault (shared sync secret). There are no custom, developer-defined environment variable names anywhere in this codebase.
