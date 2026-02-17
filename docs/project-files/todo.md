# Fabric - TODO (thread-active)

Last updated: 2026-02-17

## ✅ Completed (P0) — Post-merge decisions and hygiene
- [x] Decide repo policy for `package-lock.json` and record it in `docs/project-files/decision-log.md`:
  - Policy chosen: commit it and keep it updated.
- [x] Apply the chosen lockfile policy in a clean follow-up PR (merged to `main`).
- [x] Keep local-only project-files artifacts out of git using `.git/info/exclude` (done in this thread).

## ✅ Completed (P0) — Keep local verification baseline healthy
- [x] Sync `main` and verify status is clean:
  - `git switch main`
  - `git pull`
  - `git status --short`
- [x] Run local test suite on current `main`:
  - `npm test`
- [x] Ensure PostgreSQL service is running and listening on port 5432:
  - Verify: `netstat -ano | findstr :5432`
- [x] Ensure `psql` is available in PATH:
  - Verify: `psql --version`
- [x] Validate repo `.env` values for local DB remain correct:
  - `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric`
  - `ADMIN_KEY=<non-empty>`
- [x] Make local bootstrap rerunnable:
  - `npm run db:bootstrap` succeeded twice after idempotent trigger fix in `docs/specs/21__db-ddl.sql` (commit `9b4b31c`)

## ✅ Completed (P0) — Productionization execution (Supabase + Cloud Run)
- [x] Lock production decisions in-thread:
  - Supabase Postgres as provider
  - Direct connection string (non-pooler)
  - Supabase Data API disabled
  - Cloud Run as deploy target
- [x] Land deployment prep artifacts:
  - `Dockerfile` + `.dockerignore`
  - `docs/env-vars.md`, `docs/prod-runbook.md`, `docs/deploy-cloud-run.md`
  - `scripts/validate-env.ps1`, `scripts/deploy-cloud-run.ps1`
  - Hermetic test env reset in `tests/api.test.mjs`
- [x] Authenticate GCP CLI and set active project:
  - `gcloud auth login`
  - `gcloud config set project fabric-487608`
- [x] Build and deploy container image to Cloud Run:
  - `.\scripts\deploy-cloud-run.ps1 -ProjectId fabric-487608`
- [x] Set Cloud Run runtime env vars with real values:
  - Done: `DATABASE_URL`, `ADMIN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_SSL_CA` (secret-backed)
- [x] Complete Stripe production wiring:
  - Done: webhook destination + event selection + webhook secret configured
  - Done: deterministic Node mapping for subscription/invoice lifecycle updates
  - Done: production TLS trust chain fix for Supabase Postgres (`DATABASE_SSL_CA`) eliminated webhook 500 TLS failures
- [x] Run post-deploy smoke tests:
  - Done: bootstrap + `GET /v1/me`, admin projections rebuild, webhook signature 200 deliveries
  - Done: real Stripe webhook deliveries return 200 after TLS CA pinning; DB webhook insert path succeeds in Cloud Run
  - Done (historical pre-plan-cleanup): paid-node verification after `invoice.paid` replay showed `/v1/me` active paid state with `credits_balance=1700`
  - Done: idempotency verification after re-resend of same `invoice.paid` event left paid-node `/v1/me` unchanged (`credits_balance` remained `1700`)
- [x] Resolve production schema drift and confirm deployed smoke:
  - Done: Supabase schema updated for `nodes.legal_accepted_at`, `nodes.legal_version`, `nodes.legal_ip`, `nodes.legal_user_agent`
  - Done: deployed smoke on `https://fabric-api-393345198409.us-west1.run.app` progressed end-to-end to active subscription after checkout completion

## ✅ Completed (P0) — Stripe diagnostics + canonical plan cleanup
- [x] Diagnose live checkout failures with actionable env visibility:
  - Added `GET /v1/admin/diagnostics/stripe` and included safe `missing[]` env names for `stripe_not_configured`.
  - Added tests for diagnostics shape/auth and checkout missing-list behavior.
- [x] Remove legacy `plus` plan and align to canonical plans:
  - Enforced plan surface as `free|basic|pro|business` in code and docs/specs.
  - Updated Stripe diagnostics to supported SKUs only (no plus vars/counts).
  - Updated tests and smoke tooling; `npm test` passed (`45/45`).

## ✅ Completed (P0) — Legal/meta/bootstrap gating (A1+B1)
- [x] Decision: host legal/docs same-origin on Cloud Run; require legal assent during `POST /v1/bootstrap`.
- [x] Implement public HTML routes:
  - `GET /legal/terms`, `GET /legal/privacy`, `GET /legal/aup`, `GET /support`, `GET /docs/agents` (placeholder)
- [x] Implement unauthenticated `GET /v1/meta` returning:
  - `api_version`, `required_legal_version` (`2026-02-17`), absolute `legal_urls`, `support_url`, `docs_urls.agents_url`
- [x] Gate `POST /v1/bootstrap` on explicit legal assent/version:
  - `legal_required`, `legal_version_mismatch`
  - persist `legal_accepted_at`, `legal_version`, optional `legal_ip`, `legal_user_agent`
- [x] Update Stripe smoke script to fetch `/v1/meta` and send legal assent.
- [x] Verify: typecheck PASS; db:bootstrap PASS; tests PASS.

## Phase 0.5 — Go-live ASAP (next threads)
### Docs + legal + operability
- [x] Publish OpenAPI on same origin:
  - add `GET /openapi.json` (or `/docs/openapi.json`)
  - add `openapi_url` to `GET /v1/meta`
  - keep consistent with `docs/specs/20__api-contracts.md`
- [x] Upgrade `/docs/agents` from placeholder → real Agent Quickstart:
  - bootstrap → create unit/request → publish → search → offer → accept/reject → contact reveal
  - include canonical error envelope, idempotency/retries, credits exhausted behavior
- [x] Legal content pass (documents still need real text):
  - ToS / Privacy / AUP / Developer-Agent policy text (not placeholders)
  - document how `required_legal_version` changes
- [x] Support page content pass:
  - support contact, billing support, abuse/takedown instructions, security reporting instructions
- [x] Ops minimum runbook (docs-only):
  - key rotation procedure
  - manual suspension procedure
  - incident basics (logs, triage)

### Implementation verification vs specs (must confirm real enforcement)
- [x] Verify trial/gating enforcement in code matches `docs/specs/25__plans-credits-gating.md` and `docs/specs/20__api-contracts.md`; implement missing gates + tests.
- [x] Verify rate-limit enforcement in code matches `docs/specs/10__invariants.md`; implement missing limits + tests.
- [x] Verify audit/ledger retention behavior is implemented; if not automated, document as ops policy.
- [x] Search: exclude caller node’s own published listings/requests by default (opt-in `include_self` flag if needed later).

### Suspension (MVP approach)
- [x] Implement/document manual suspension (recommended):
  - set `nodes.suspended_at`
  - revoke node API keys
  - ensure suspended nodes cannot call authed endpoints
  - ensure suspended nodes are excluded from projections/search
  - document unsuspend steps

### Live Stripe SKU wiring + smoke (current blocker)
- [ ] Set Cloud Run Stripe price env vars for supported live SKUs:
  - `STRIPE_PRICE_IDS_BASIC=price_1T1tO2K3gJAgZl81QzBXfPIf`
  - `STRIPE_PRICE_IDS_PRO=price_1T1wL1K3gJAgZl81IYKvjCsD`
  - `STRIPE_PRICE_IDS_BUSINESS=price_1T1wLgK3gJAgZl81450PfCc3`
  - `STRIPE_TOPUP_PRICE_100=price_1T1wMGK3gJAgZl817t4OWdnM`
  - `STRIPE_TOPUP_PRICE_300=price_1T1wMbK3gJAgZl81uWQJtoqH`
  - `STRIPE_TOPUP_PRICE_1000=price_1T1wNBK3gJAgZl81ixDfggz3`
- [ ] Verify diagnostics after deploy:
  - `GET /v1/admin/diagnostics/stripe` should return `stripe_configured=true` and `missing=[]`.
- [ ] Run live checkout smoke for subscriptions and top-ups:
  - subscriptions: `basic`, `pro`, `business`
  - top-ups: `credits_100`, `credits_300`, `credits_1000`
  - verify webhook deliveries are 2xx and `/v1/me` reflects active subscriber state.

### Decisions locked
- Subscription-only gating (credits do not unlock subscriber-gated actions).

## Phase 1 — Near-term product completeness
### Credits UX
- [x] Add server-side quote endpoint (no search execution):
  - `POST /v1/credits/quote` accepts same params as search
  - returns `estimated_cost` + breakdown; does not depend on result count
  - free but rate-limited + cached (short TTL)

### Top-ups (credit packs)
- [x] Specify + implement 3 credit packs:
  - pricing rule: ~2× subscription implied cost-per-credit (incentivize subscription)
  - Stripe Checkout flow + webhook grant into credits ledger (invoice/session idempotency)
  - velocity limits (anti-fraud) + refund/chargeback policy

### Plan changes + credits (decision locked)
- [x] Upgrade credits are difference-based and granted immediately on paid upgrade invoice:
  - on upgrade, create proration invoice; on `invoice.paid`, grant credit difference for the cycle
  - enforce idempotency by invoice id
- [x] Define downgrade semantics (recommended: apply at next renewal)

## Phase 2 — Agent adoption acceleration
- [ ] SDKs (full): TS + Python, versioned, CI publish, examples
- [ ] MCP server (official): hosted on Cloud Run; discoverable via `/v1/meta`
- [ ] Docs portal expansion: `/docs/api`, `/docs/errors`, `/docs/security`, `/docs/credits`, `/docs/webhooks`

## Phase 3 — Hardening / abuse / trust
- [ ] Abuse controls: tiered limits by plan; anomaly detection; automated suspension triggers + review
- [ ] Admin endpoints for suspension (optional later)
- [ ] Audit & compliance: retention enforcement, deletion/export flows, security disclosure policy
- [ ] Backups / restore drill: documented restore; periodic verification

## Consolidated phased list (canonical)
- Phase 0.5: OpenAPI publish, real /docs/agents, legal/support content, ops runbooks, verify gating + rate limits + retention, manual suspension
- Phase 1: /v1/credits/quote, credit packs top-ups, plan-change credit semantics
- Phase 2: SDKs + MCP + expanded docs
- Phase 3: hardening + admin endpoints + anomaly detection + compliance
