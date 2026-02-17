# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current state (what is true vs what must be verified)
- Production stack decisions already locked: Supabase Postgres + Cloud Run; Stripe webhooks wired; production smoke flow previously validated.
- P0 “legal/meta/bootstrap gating” work was completed locally by Codex and verified with:
  - `npm run typecheck` PASS
  - `npm run db:bootstrap` PASS
  - `npm test` PASS (21/21)
- IMPORTANT: In the next thread, **first verify whether the P0 code/spec changes are already committed and pushed** (do not assume).

## What changed in code/specs (P0 legal/meta/bootstrap gating)
Files changed (per Codex SUCCESS report):
- `src/config.ts`
- `src/app.ts`
- `src/services/fabricService.ts`
- `src/db/fabricRepo.ts`
- `docs/specs/21__db-ddl.sql`
- `docs/specs/20__api-contracts.md`
- `docs/specs/10__invariants.md`
- `tests/api.test.mjs`
- `scripts/smoke-stripe-subscription.ps1`

Behavior added/updated:
- Public HTML routes (implemented; document content still needs real text):
  - `GET /legal/terms`
  - `GET /legal/privacy`
  - `GET /legal/aup`
  - `GET /support`
  - `GET /docs/agents` (placeholder)
- Public `GET /v1/meta`:
  - includes `api_version`, `required_legal_version` = `2026-02-17`
  - includes absolute `legal_urls`, `support_url`, `docs_urls.agents_url`
- `POST /v1/bootstrap` gated on explicit assent:
  - requires `legal.accepted === true`
  - requires `legal.version === required_legal_version`
  - error codes: `legal_required`, `legal_version_mismatch`
  - persists `legal_accepted_at`, `legal_version`, optional `legal_ip`, `legal_user_agent`

## Decisions made in this thread (must be reflected in project files)
- **Docs/hosting:** Publish OpenAPI on same origin as API; expose `GET /openapi.json` (or `/docs/openapi.json`) and link as `openapi_url` from `GET /v1/meta`.
- **Gating rule (confirmed):** Subscriber-gated actions remain **subscription-only** (credits balance does not unlock gated actions).
- **Upgrades:** Grant **difference-based credits immediately** when the **upgrade/proration invoice is paid** (ledger idempotency keyed by `invoice_id`). Downgrades apply at next renewal (MVP).
- **Suspension (MVP):** Use **manual suspension** initially (set `nodes.suspended_at`, revoke keys) with a runbook; defer admin endpoints to later hardening.
- **Verification requirement:** Verify gating enforcement + rate limits are actually implemented everywhere required by specs; implement missing coverage + tests.
- **Top-ups:** Implement **3 credit-pack top-ups** priced ~2× subscription implied cost-per-credit (Phase 1), with Stripe Checkout + webhook grants + velocity limits.

## TODO list status
- Existing P0 items are complete.
- `docs/project-files/todo.md` should be updated to the consolidated phased list:
  - Phase 0.5: OpenAPI publish, real `/docs/agents`, legal/support content, ops runbooks, verify gating + rate limits + retention, manual suspension
  - Phase 1: `/v1/credits/quote`, credit packs top-ups, plan-change credit semantics
  - Phase 2: SDKs + MCP + expanded docs
  - Phase 3: hardening + admin endpoints + anomaly detection + compliance

## Current blocker
- None known. First action next thread is to confirm git state and whether commits/pushes are pending.

## Exact next command sequence (PowerShell)
1) Verify repo state and whether anything is uncommitted:
   - `git status -sb`
   - `git log -5 --oneline`
2) If P0 code/spec changes are uncommitted, commit and push them (non-project-files commit).
3) Update project files (at least `docs/project-files/todo.md` and `docs/project-files/decision-log.md` with the provided snippet), commit and push project-files separately.
4) Start Phase 0.5 work with run-to-completion protocol:
   - implement OpenAPI publication (`/openapi.json` + `openapi_url` in `/v1/meta`)
   - replace `/docs/agents` placeholder with real Agent Quickstart
   - audit/implement gating + rate-limit coverage vs specs (add tests)
   - write MVP legal/support document text + ops runbooks
   - document and/or implement manual suspension steps
