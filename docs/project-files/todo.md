# Fabric - TODO (thread-active)

Last updated: 2026-02-20

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

## ✅ Completed (P0) — Self-serve recovery implementation + live pubkey validation
- [x] Implement self-serve API key recovery on `feat/self-serve-recovery`:
  - Email verification endpoints: `POST /v1/email/start-verify`, `POST /v1/email/complete-verify`
  - Recovery endpoints: `POST /v1/recovery/start`, `POST /v1/recovery/complete` (`pubkey|email`)
  - Security controls: challenge TTL, attempt limits, per-IP/per-node rate limiting
  - Recovery success policy: revoke all prior API keys, mint one new plaintext API key
- [x] Add pluggable email provider wiring (`stub|smtp|sendgrid`) with stub default for tests/dev.
- [x] Update specs/onboarding to reflect recovery contracts and invariants.
- [x] Verify local recovery branch quality gates:
  - `npm test`
  - `npm run lint`
  - `npm run build`
- [x] Deploy recovery branch to Cloud Run and verify service sanity:
  - revision observed: `fabric-api-00046-vpx`
  - `GET /v1/meta` = 200
  - `GET /openapi.json` = 200
- [x] Resolve production DB schema prerequisites for recovery in Supabase:
  - `nodes.email`, `nodes.email_verified_at`, `nodes.recovery_public_key`
  - `recovery_challenges` table + indexes
  - `recovery_events` table + indexes
- [x] Verify live pubkey recovery end-to-end:
  - bootstrap 200 -> recovery start (pubkey) 200 -> recovery complete 200
  - old key `/v1/me` = 403
  - new key `/v1/me` = 200
- [x] Merge recovery work to `main` and redeploy:
  - merged to `main` via `1f954c2 merge: feat/self-serve-recovery`
  - Cloud Run redeployed from `main` and legal/support/docs routes verified HTTP 200

## Phase 0.5 — Go-live ASAP (next threads)
### Docs + legal + operability
- [x] Publish OpenAPI on same origin:
  - add `GET /openapi.json` (or `/docs/openapi.json`)
  - add `openapi_url` to `GET /v1/meta`
  - keep consistent with `docs/specs/20__api-contracts.md`
- [x] Upgrade `/docs/agents` from placeholder → real Agent Quickstart:
  - bootstrap → create unit/request → publish → search → offer → accept/reject → contact reveal
  - include canonical error envelope, idempotency/retries, credits exhausted behavior
- [x] Legal content finalized and verified on Cloud Run:
  - ToS / Privacy / AUP / Refunds / Agent Terms / Support pages replaced with final text in `src/app.ts`
  - effective date locked to `2026-02-17`
  - rendered pages verified with no `PLACEHOLDER` and no mojibake
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

### Live Stripe SKU wiring + smoke (completed)
- [x] Set Cloud Run Stripe price env vars for supported live SKUs:
  - `STRIPE_PRICE_IDS_BASIC=price_1T1tO2K3gJAgZl81QzBXfPIf`
  - `STRIPE_PRICE_IDS_PRO=price_1T1wL1K3gJAgZl81IYKvjCsD`
  - `STRIPE_PRICE_IDS_BUSINESS=price_1T1wLgK3gJAgZl81450PfCc3`
  - `STRIPE_TOPUP_PRICE_100=price_1T1wMGK3gJAgZl817t4OWdnM`
  - `STRIPE_TOPUP_PRICE_300=price_1T1wMbK3gJAgZl81uWQJtoqH`
  - `STRIPE_TOPUP_PRICE_1000=price_1T1wNBK3gJAgZl81ixDfggz3`
- [x] Verify diagnostics after deploy:
  - `GET /v1/admin/diagnostics/stripe` should return `stripe_configured=true` and `missing=[]`.
- [x] Run live checkout smoke for subscriptions and top-ups:
  - subscriptions: `basic`, `pro`, `business`
  - top-ups: `credits_100`, `credits_300`, `credits_1000`
  - verify webhook deliveries are 2xx and `/v1/me` reflects active subscriber state.

### Phase 0.5 — Remaining blockers from latest thread
- [x] Audit and enforce holds invariant:
  - only owner/seller can lock their own unit(s)
  - buyers must not be able to lock seller inventory via offers/requests
  - add/adjust tests to prevent regression
- [x] Enforce `display_name` uniqueness:
  - add/verify DB constraint + API behavior + tests
  - verified: case-insensitive unique index and duplicate folded-name check

### Phase 0.5 — Search economics + onboarding (latest thread notes)
- [x] Apply workflow guidance from thread notes explicitly:
  - keep responses concise to conserve context
  - request missing source artifacts/text instead of making assumptions
- [ ] Add top-level Search Budget Contract object to search responses:
  - include `credits_requested`, `credits_charged`, coverage fields, and page/broadening breakdown
  - keep this contract at top-level (not nested under metadata)
- [ ] Enforce hard spend ceiling:
  - `credits_charged` must always be `<= credits_requested`
  - return actionable insufficient-budget guidance when cap blocks full execution
- [ ] Implement broadening economics defaults:
  - default broadening to strict/low
  - charge more as broadening increases
- [ ] Implement pagination add-on economics:
  - page 1 included in base search cost
  - pages 2-3 small add-on, 4-5 medium, 6-10 large, 11+ prohibitive
- [ ] Lock go-live matching behavior:
  - structured eligibility filters + keyword ranking only
  - no lexical override/expansion and no semantic/vector infrastructure at go-live
- [ ] Keep go-live supply-vs-demand parity:
  - same mechanics and pricing for both sides in Phase 0.5
- [ ] Define canonical pricing rule for target-constrained search (`target { node_id?, username? }`) in specs, then implement and test low-cost follow-up pricing.
- [ ] Ensure primary search results include per-node non-zero category counts.
- [ ] Implement node per-category drilldown behavior:
  - cheap pricing, paginated, rate-limited
- [ ] Add visibility data capture plumbing:
  - log search impressions (unit returned in results)
  - log detail views (via detail GET path)
  - ensure offer outcomes persist `accepted|rejected|expired|cancelled`
- [ ] Add non-binding `estimated_value` field to units.
- [ ] Update onboarding docs and examples:
  - explain budget-vs-results behavior and query adjustment using budget fields
  - encourage early creation of units + requests (cheap/free)
  - include concrete category/deal examples (including Delivery/Transport)
  - mention anti-scrape rate-limit rationale and category suggestion intake
  - mention saved searches/alerts as planned future capability (no timeline promises)
- [ ] Review agent onboarding docs and flows for gaps (separate pass after copy updates).
- [ ] Review full agent workflows for MVP feature/anti-abuse gaps:
  - search -> offer -> acceptance -> contact reveal -> fulfillment

### Phase 0.5 / Phase 1 — Contact/comms + recovery docs (thread notes)
- [x] Lock docs precedence guidance:
  - treat `docs/specs/*` as normative source-of-truth
  - treat `docs/runbooks/*` as operational checklists with lower precedence
- [x] Document auth and email role explicitly:
  - `Authorization: ApiKey <api_key>` is the only normal auth factor
  - email is required at account creation as backup/recovery, not as runtime auth
- [x] Add/ensure doc note for recovery policy:
  - MVP recovery is pubkey-only
  - pre-Phase-2 manual exception requires email-on-file + Stripe `pi_...` or `in_...` proof
- [x] Add optional node `messaging_handles[]` with validation/sanitization rules; treat handles as unverified user-provided contact data.
- [x] Update reveal-contact contract to return `messaging_handles[]` alongside required email and optional phone.
- [x] Add near-real-time offer lifecycle eventing:
  - webhooks plus `/events?since=cursor` polling fallback
  - events for `offer_created|offer_countered|offer_accepted|offer_cancelled|offer_contact_revealed`
- [x] Add legal/docs disclaimer:
  - contact/messaging identity is user-provided
  - Fabric does not guarantee identity or fulfillment; settlement is off-platform
- [ ] Expand onboarding docs:
  - add "multi-dimensional trading flexibility"
  - add 5-8 concrete mixed-consideration examples and how terms live in offer notes

### Phase 0.5 — Eventing smoke follow-up (latest thread notes)
- [x] Run end-to-end eventing smoke (offers -> events -> webhook) on deployment where offers are not blocked by `subscriber_required`:
  - verified offer lifecycle generates events
  - verified `/events` returns event envelopes
  - verified webhook delivery rows recorded
  - verified signed webhook headers when secret present; headers omitted after clearing secret
- [x] Remove subscriber-only gating from offer create/counteroffer/accept/contact reveal; enforce `not_suspended`, legal accepted, and rate limits/throttles instead.
- [x] Fix OpenAPI export so it includes offer + events routes, and add an automated smoke runner:
  - `POST /v1/offers`
  - `POST /v1/offers/{offer_id}/counter`
  - `POST /v1/offers/{offer_id}/accept`
  - `POST /v1/offers/{offer_id}/reveal-contact`
  - `GET /events`
  - add `scripts/smoke-offers-eventing.mjs` writing artifacts under `artifacts/`

### Phase 0.5 — Eventing/webhook follow-up (next thread)
- [ ] Add self-serve webhook configuration endpoints (remove SQL/admin-only setup):
  - authenticated set/clear webhook URL
  - optional set/rotate webhook secret
  - OpenAPI + tests + rate-limit/validation/SSRF protections
- [ ] Update agent onboarding docs and `/docs/agents` for eventing/webhooks:
  - webhook vs `/events` polling fallback
  - metadata-only payload (no offer snapshots, no contact PII)
  - reveal-contact remains separate
  - signing headers behavior (present only when secret set; omitted when null)
  - at-least-once delivery + dedupe by event id

### Phase 0.5 / Phase 1 — Payments + enforcement (latest thread notes)
- [x] Remove subscriber-only gating from offer create/counteroffer/accept/contact reveal; enforce `not_suspended`, legal accepted, and rate limits/throttles instead.
- [ ] Keep "credit packs" terminology consistent in Stripe display naming and docs.
- [ ] Add onboarding payment guidance:
  - recommend dedicated payment method for agent usage
  - prefer corporate/virtual cards with spending limits
  - emphasize owner controls (spending caps/monitoring) and avoid "bypass bank controls" framing
- [ ] Add `GET /internal/admin/daily-metrics` as the source for daily email digest:
  - abuse/throttles/suspensions
  - Stripe + credits health
  - liquidity/reliability metrics
  - webhook health (when applicable)

### Phase 0.5 — Workflow hardening (latest thread notes)
- [x] Update `docs/project-files/00__read-first__workflow.md`:
  - require DB/DDL APPLY + VERIFY SQL script handoff for manual Supabase execution
  - require end-of-thread "project files to refresh" list derived from git
- [ ] Update `AGENTS.md` DB/DDL wording:
  - explicitly state generated SQL scripts are for manual Supabase execution, not agent execution
- [x] Thread-switch hygiene:
  - include unique changed paths from `docs/spec/**` plus refresh-set files (`AGENTS.md`, `docs/project-files/00__read-first__workflow.md`, `docs/project-files/agent-commerce-fit.md`, `docs/project-files/decision-log.md`, `docs/project-files/todo.md`)

### Next Phase (ranked by likelihood)
High likelihood:
- [ ] Internationalization baseline (Phase 1):
  - verify Supabase/Postgres UTF-8 encoding (manual SQL check)
  - add optional `language_tag` (BCP-47) for user-entered free-text in units/requests
  - ensure Unicode-safe normalization for matching while preserving original text
  - keep structured discovery fields language-neutral and first-class (categories/capabilities/regions)
- [ ] Add crypto pay-per-use rail (x402-like) for wallet-based top-ups/payment-required flows with node credit-attribution mapping.
- [ ] Support saved payment method + Stripe off-session top-ups for agents (auto-top-up product logic on low-credit threshold).
- [ ] Saved searches / scheduled alerts after corpus density improves.
- [ ] Revisit supply-vs-demand pricing divergence using observed market behavior.
- [ ] Compute and surface visibility/discoverability scoring (private first; weighting to be decided).
- [ ] Implement photos/media using future `unit_media` references (no DB blobs); select storage provider later.
- [ ] Revisit basket/bundle pricing mode once sparse-corpus risk is lower.
- [ ] Add post-accept report/complaint endpoint with one-report-per-side-per-offer uniqueness and reason enum (`no_show|unresponsive|refused_after_accept|fraud_suspected|other`).
- [ ] Define trust policy constants:
  - `REPORT_WINDOW_DAYS` (suggested default: 14)
  - per-node report rate limits
  - conservative enforcement threshold based on unique counterparties
- [ ] Add trust enforcement ladder and routing effects:
  - `good|watch|limited|suspended|banned`
  - admin override path and audit logging
Medium likelihood:
- [ ] Cross-language free-text discovery (Phase Next):
  - decide bridging approach (pivot MT fields vs multilingual embeddings vs hybrid) with search budget/credit metering integration
  - add indexing/storage, abuse controls, and diagnostics for cross-language matches
- [ ] Add moderation heuristics/pattern flags and escalation logic (Phase 2).
- [ ] Add bounded lexical expansion mode as opt-in, while preserving diagnostics.
- [ ] Refine search-by-node operational pricing (cheap shallow pages + anti-scrape guardrails).
- [ ] Add storefront-tier higher limits for paid/verified nodes after abuse controls mature.
- [ ] Add messaging/negotiation threads for nuanced deals with moderation safeguards.
Low likelihood:
- [ ] No additional low-likelihood items locked in current thread notes.

### Decisions locked
- Offer/deal progression is not subscriber-gated; use suspension/legal/rate-limit controls.

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
- [ ] Enable email recovery lane in Phase 2:
  - choose delivery provider (SendGrid or SMTP)
  - set Cloud Run email env/secrets
  - run live email verification + recovery smoke (`/v1/email/*`, `/v1/recovery/*` with `method=email`)
  - reconfirm pubkey recovery in final smoke sequence
- [ ] Add pre-charge search quote/preview:
  - estimated credits, expected result band, likely coverage before charging
- [ ] Separate search `effort` from `selectivity`:
  - higher credits increase effort without implicit narrowing unless requested
- [ ] Add per-node reputation metrics plus routing:
  - success rate, response timeliness, dispute rate
- [ ] Add `offers_accepted_total` to network stats after metric definition is finalized

## Phase 3 — Hardening / abuse / trust
- [ ] Abuse controls: tiered limits by plan; anomaly detection; automated suspension triggers + review
- [ ] Admin endpoints for suspension (optional later)
- [ ] Audit & compliance: retention enforcement, deletion/export flows, security disclosure policy
- [ ] Backups / restore drill: documented restore; periodic verification
- [ ] Add machine-readable compliance metadata:
  - retention, licensing, and data-handling declarations
- [ ] Add verification/provenance framework and dispute/recourse primitives

## Consolidated phased list (canonical)
- Phase 0.5: OpenAPI publish, real /docs/agents, legal/support content, ops runbooks, verify gating + rate limits + retention, manual suspension
- Phase 1: /v1/credits/quote, credit packs top-ups, plan-change credit semantics
- Phase 2: SDKs + MCP + expanded docs + search quote/preview + effort/selectivity split + reputation/routing
- Phase 3: hardening + admin endpoints + anomaly detection + compliance + compliance metadata + provenance/recourse
