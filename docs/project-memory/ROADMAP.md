# ROADMAP

No issue tracker, TODO-list file, or explicit roadmap document exists in this repository. This roadmap is built **only** from what is directly evidenced in code comments, migration headers, and commit messages — nothing here is invented.

## COMPLETED (evidenced by merged commits / applied-looking migrations)
- MK Connect sync integration (CRM payments, payroll, commission, HR expenses) — commits `b5f4e0f`/`9d7d3dd`.
- Branch-based Finance Dashboard redesign with drill-down — commits `cea592e`/`3555b91`.
- loonars-sales fee/closing verification flow — migrations `0009`–`0016`.
- Move loonars fee-claim approval fully to CFO, drop owner step — commit `b36eb0e`.
- Remove Telegram from bahan/tukang approval flow, replace with WhatsApp — commit `0fd8ada`.
- No-login expense report pages for field supervisors, restricted to named individuals/branches — commits `d249bcb`, `9d7e75f`, `f6e6895`, `00903f7`.
- WhatsApp nota-photo (AI-read by MK Connect) → material expense submission, itemized — migrations `0027`–`0029`.
- Security fixes: stored XSS (`349bce5`), CFO dashboard access control (`69a2822`), admin-create-user privilege check (`c4f64a7`), hardcoded service_role key removal (`b50250a`).

## IN PROGRESS (evidenced by explicit "not yet complete" language in the repo)
- **RLS tightening on financial tables** (migration `0025`) — written, but its own comment states it must not be applied until a corresponding frontend auth-token change is made; that frontend change is not evidenced elsewhere in this repo as done. Status: in progress / blocked on a follow-up change.
- **`loonars_fee_wa_decision`** (commit `dfd09ce`) — explicitly labeled "temporary" in its own commit message; implies a more permanent approval mechanism is intended eventually. No evidence of what that permanent mechanism should look like exists in-repo.

## NEXT / PLANNED
UNKNOWN — NEEDS CONFIRMATION. No explicit "next up" list, TODO comments describing future work, or open issues are present in this repository to draw from. Do not infer a product roadmap beyond what's stated above.

## UNKNOWN
- Whether there is a broader roadmap tracked outside this repo (e.g. in a project-management tool, GitHub Issues/Projects — this audit did not have access to check GitHub Issues).
- Whether `mkhsistem` (mentioned once in commit `a39106d`) represents a larger planned integration or is already complete elsewhere.
- The intended replacement for the "temporary" `loonars_fee_wa_decision` mechanism.
