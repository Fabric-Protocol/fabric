# Fabric - Decision Log

Format: newest first. Keep entries short; link to spec sections when applicable.

## 2026-02-19 - 402 is economic gating; 403 is entitlement gating
Decision:
- Use HTTP `402` only for economic gating (e.g., `credits_exhausted`) and HTTP `403` for permission/entitlement gating.
Rationale:
- Keeps "payment required" semantics consistent for machine customers.
- Separates entitlement failure from credit-balance failure.
Scope/impact:
- API, economics, onboarding.

## 2026-02-19 - Phase 2 payment rails: crypto top-up rail and Stripe off-session top-ups
Decision:
- Add Phase 2 crypto pay-per-use (x402-like) rail for wallet-based top-ups/payment-required flows.
- Add Phase 2 support for saved payment method + Stripe off-session top-ups (auto-top-up logic).
Rationale:
- Crypto rail enables machine-native payment without bank-controlled SCA events.
- Stripe off-session top-ups provide near-autonomous operation with lower integration complexity.
Scope/impact:
- API, economics, infra.

## 2026-02-19 - Onboarding payment guidance is required in Phase 0.5/1
Decision:
- Onboarding/docs must recommend dedicated payment methods, corporate/virtual cards with limits, and owner-side spending controls.
Rationale:
- Reduces fraud/SCA friction while preserving safe delegation.
- Keeps responsibility framing explicit without "bypass bank controls" messaging.
Scope/impact:
- Onboarding, economics.

## 2026-02-19 - Offer/deal progression is not subscriber-gated
Decision:
- Remove subscriber-only gating from offer create/counteroffer/accept/contact reveal.
- Enforce not-suspended, legal-accepted, and rate-limit/throttle controls instead.
Rationale:
- Credit-pack-only nodes must still be able to complete core marketplace dealflow.
- Subscription is a recurring grant mechanism, not a prerequisite for core actions.
Scope/impact:
- API, economics, enforcement.

## 2026-02-19 - Offer/request expiration contract is hours-input, server-authoritative storage
Decision:
- Offers accept `expires_in_hours`; server stores authoritative `expires_at`; clients do not set `expires_at` directly.
- Offer bounds: default 8h, floor 15m, ceiling 7d; requests gain expiration with default 1 week and configurable `expires_in_hours`.
Rationale:
- Reduces ambiguity and simplifies expiry-sweep behavior.
- Limits stale supply/demand while keeping agent control simple.
Scope/impact:
- API, infra, economics.

## 2026-02-19 - Expiry and digest jobs run via Cloud Scheduler on Cloud Run
Decision:
- Run a 5-minute offer expiry sweep to expire offers and release holds.
- Use Cloud Scheduler to invoke internal job endpoints for offer sweep and daily digest.
Rationale:
- Avoids relying on read-time checks for lifecycle correctness.
- Fits Cloud Run's request-driven execution model.
Scope/impact:
- Infra, enforcement.

## 2026-02-19 - Add thread history endpoint for negotiation visibility
Decision:
- Add `GET /v1/threads/{thread_id}` returning ordered negotiation chain plus current active offer.
Rationale:
- Avoids client-side reconstruction across multiple calls.
- Improves agent integration reliability and speed.
Scope/impact:
- API, onboarding.

## 2026-02-19 - Contact reveal remains non-paywalled in MVP with anti-abuse controls
Decision:
- Do not require "ever paid" for contact reveal in MVP.
- Apply revealer-focused rate limits, idempotent per-thread reveal, and progressive trust-tier limit relaxation.
Rationale:
- Preserves low-friction first-deal path for network growth.
- Adds abuse resistance without reintroducing subscription paywall gating.
Scope/impact:
- API, economics, enforcement.

## 2026-02-19 - Bootstrap and enforcement persistence policy
Decision:
- Bootstrap rate limits are per-IP: 5/hour and 20/day, returning 429 when exceeded.
- Implement `node_suspensions` history and keep IP data hashed in bootstrap/abuse tracking (not core business tables).
Rationale:
- Reduces node-farming risk where identity is weak at bootstrap.
- Preserves enforcement history/escalation while minimizing sensitive data spread.
Scope/impact:
- Enforcement, infra, API.

## 2026-02-19 - Moderation policy split across Phase 1 and Phase 2
Decision:
- Phase 1 bans via reports + manual review cover controlled substances, pornography, sale of sexual activities, and illegal activity.
- Phase 2 adds heuristic/pattern flags and escalation logic.
Rationale:
- Establishes immediate baseline enforcement with minimal automation.
- Defers heavier automation to a later phase.
Scope/impact:
- Enforcement, infra, onboarding.

## 2026-02-19 - Daily metrics endpoint is pre-go-live operational blocker
Decision:
- Add `GET /internal/admin/daily-metrics` as the single source for daily digest reporting.
Rationale:
- Centralizes abuse, billing/credits, liquidity, reliability, and webhook-health operational visibility.
- Explicitly identified as the last TODO before go-live in thread notes.
Scope/impact:
- Infra, ops, economics.

## 2026-02-19 - Auth factor and email role boundary locked
Decision:
- Runtime auth remains API-key only: `Authorization: ApiKey <api_key>`.
- Email is required at account creation as backup/recovery, not as a normal request auth factor.
Rationale:
- Keeps agent auth deterministic and automation-friendly.
- Preserves a recovery lane without coupling request auth to inbox access.
Scope/impact:
- API, onboarding, infra.

## 2026-02-19 - Recovery lanes locked to self-serve pubkey + email
Decision:
- Fabric supports two self-serve recovery lanes: recovery public-key signature and email code recovery.
- Normal recovery flows should not require manual operator intervention.
Rationale:
- Reduces recovery friction and support burden.
- Maintains recoverability when one factor is unavailable.
Scope/impact:
- API, onboarding, ops.

## 2026-02-19 - Offer lifecycle updates are eventing, not in-app messaging
Decision:
- Near-real-time offer lifecycle updates use webhooks with `/events?since=cursor` polling fallback.
- This replaces in-platform messaging for go-live offer status propagation.
Rationale:
- Reduces polling/wait friction with a simpler delivery model.
- Avoids introducing chat/moderation scope in MVP paths.
Scope/impact:
- API, infra, onboarding.

## 2026-02-19 - Contact reveal includes unverified messaging handles
Decision:
- Nodes can publish `messaging_handles[]` entries (`kind`, `handle`, optional `url`) as user-provided unverified data.
- `reveal-contact` returns `messaging_handles[]` in addition to required email and optional phone.
Rationale:
- Speeds post-accept coordination without requiring in-app messaging.
- Keeps trust boundaries explicit by marking handles as unverified.
Scope/impact:
- API, onboarding.

## 2026-02-19 - Onboarding lock: multi-dimensional trading guidance required
Decision:
- Onboarding/docs must explicitly teach multi-dimensional trading (physical, digital, services/experience/time, and monetary terms).
- Include concrete examples and clarify that Fabric enforces state/holds while settlement is off-platform after contact reveal.
Rationale:
- Reduces confusion in non-standard deal construction.
- Improves first-run success for agent implementers.
Scope/impact:
- Onboarding, API usage guidance.

## 2026-02-19 - Phase 2 trust model direction locked
Decision:
- Treat mutual acceptance as assumed completed for analytics (no completion-step dependency).
- Add time-bounded post-accept reporting and derive trust from multi-counterparty patterns rather than arbitration.
Rationale:
- Enables practical reliability signals without escrow/arbitration scope.
- Prioritizes scalable pattern-based trust over case-by-case adjudication.
Scope/impact:
- API, economics, infra.

## 2026-02-18 - Search Budget Contract is top-level and budget-capped
Decision:
- Search responses must expose the Search Budget Contract at top-level, and `credits_requested` is a hard ceiling (`credits_charged <= credits_requested` always).
Rationale:
- Prevents agent credit shock and makes spend auditable.
- Keeps credit-charged endpoint behavior consistent and machine-readable.
Scope/impact:
- API contracts, economics, onboarding guidance.

## 2026-02-18 - Go-live matching stays deterministic and infra-light
Decision:
- Go-live search uses structured eligibility filters plus keyword ranking only; no lexical override/expansion and no semantic/vector infra.
Rationale:
- Keeps billing and coverage behavior deterministic and explainable.
- Avoids early model lock-in and re-embedding operational overhead.
Scope/impact:
- Search API behavior, economics, infra complexity.

## 2026-02-18 - Structured scoring required; deep match explanations deferred
Decision:
- Structured scoring is required now; "why this matched" is deferred as optional drilldown without special DB additions.
Rationale:
- Preserves future explainability while keeping base payload small.
- Avoids heavy trace storage in the go-live phase.
Scope/impact:
- Search API payload shape, performance, future explainability work.

## 2026-02-18 - Node-targeted search added as cheap second-order query
Decision:
- Add top-level `target { node_id?, username? }` to restrict search to one node while still honoring scope filters; price it as a low-cost follow-up path.
Rationale:
- Supports "work with known seller again" workflows efficiently.
- Distinguishes drilldown behavior from global discovery cost.
Scope/impact:
- Search request contract, pricing model, onboarding flow.

## 2026-02-18 - Broadening and pagination use explicit anti-scrape economics
Decision:
- Broadening defaults to strict/low and costs more as broadening increases; page 1 is included in base search cost, with escalating add-on costs for later pages.
Rationale:
- Prioritizes precision and ROI by default.
- Deters deep scraping while allowing shallow legitimate pagination.
Scope/impact:
- Search economics, abuse controls, query UX.

## 2026-02-18 - Category-count summaries and paid drilldowns are mandatory
Decision:
- Primary search results always include per-node categories with non-zero counts; node follow-up per-category drilldown is cheap, paginated, and rate-limited (no free full inventory dump).
Rationale:
- Enables multi-item viability checks with low payload overhead.
- Balances discovery utility with abuse resistance.
Scope/impact:
- Search response schema, drilldown endpoints, anti-abuse controls.

## 2026-02-18 - Supply/demand parity at go-live; alerting deferred
Decision:
- Supply and demand search share identical mechanics and pricing at go-live; saved searches/alerts are confirmed future work and deferred until corpus density improves.
Rationale:
- Reduces early cognitive and implementation complexity.
- Avoids poor paid-alert experience in sparse-corpus conditions.
Scope/impact:
- API/economics parity, roadmap sequencing, onboarding expectations.

## 2026-02-18 - Visibility scoring uses capture-now, surface-later policy
Decision:
- Capture visibility inputs now (impressions, detail views, offer outcomes) and defer score computation/surfacing to Phase 2; no rejection-weighting decision yet.
Rationale:
- Historical data must exist before scoring is useful.
- Prevents premature scoring policy lock without observed behavior.
Scope/impact:
- Data capture plumbing, analytics roadmap, ranking/trust systems.

## 2026-02-18 - Media shape is locked; storage provider remains open
Decision:
- Lock DB shape to references/metadata only (future `unit_media`, no blobs in DB) and defer storage provider choice (R2/GCS/etc.).
Rationale:
- Avoids near-term provider lock-in and migration pain.
- Keeps multimodal readiness without premature infra commitment.
Scope/impact:
- Data model, infra roadmap, cost strategy.

## 2026-02-18 - Unit estimated value and onboarding messaging are go-live requirements
Decision:
- Add a non-binding unit estimated-value field now, and include explicit onboarding messaging: create both units/requests early, use concrete examples, disclose anti-scrape rate-limit rationale, mention planned alerts, and invite category suggestions.
Rationale:
- Improves negotiation starting points with low build cost.
- Reduces user confusion for a non-intuitive marketplace and sparse early network.
Scope/impact:
- Units schema/API, onboarding docs, go-to-market messaging.

## 2026-02-18 - Agent-commerce positioning baseline locked
Decision:
- Fabric's primary moat is network coverage + trust/policy + protocol correctness.
- Speed/latency remains important for pipeline performance but is not the primary moat.
Reason: Explicitly stated in thread notes as clarified positioning after "How to Sell to Agents" alignment.
Where captured:
- `docs/project-files/thread-notes.md` (What we did section)
Impact:
- Go-live prioritization should bias toward coverage, trust diagnostics, and coordination correctness over speed-only optimization work.

## 2026-02-18 - Collaboration invariants for thread execution locked
Decision:
- Keep responses concise to conserve context budget.
- Do not assume missing source content; request the missing artifact/text instead.
Reason: Explicitly recorded in thread notes as new workflow/collaboration invariants.
Where captured:
- `docs/project-files/thread-notes.md` (Workflow / collaboration updates section)
Impact:
- Future thread execution should be shorter by default and avoid speculative assumptions when source artifacts are unavailable.
- Track this guidance as an explicit TODO item in `docs/project-files/todo.md` to avoid silent drift.

## 2026-02-18 - Legal policy constants for hosted pages locked
Decision:
- MVP hosted legal/support pages use operator identity `Pilsang Park (operating the Fabric Protocol)`.
- Effective date is fixed to `2026-02-17` across legal/support pages.
- Support/legal contact is `mapmoiras@gmail.com`.
- Legal policy text explicitly locks top-up/subscription credit policy and prohibited-use categories captured in thread notes.
Reason: Explicitly documented as finalized legal decisions in the period-fix/legal-finalization thread and deployed/verified live.
Where captured:
- `docs/project-files/thread-notes.md` (Decisions + legal finalization sections)
Impact:
- Public legal text is no longer placeholder and becomes the operational baseline for MVP enforcement/communications.

## 2026-02-18 - Holds ownership invariant locked
Decision:
- Only the owner/seller may lock their own units; buyer-side bids/requests must not create holds on seller inventory.
Reason: Explicitly captured as an anti-abuse invariant in thread notes.
Where captured:
- `docs/project-files/thread-notes.md` (Abuse-vector design invariant section)
Impact:
- Next enforcement/test work must preserve seller-owned locking semantics and block buyer inventory locking paths.

## 2026-02-18 - Self-serve recovery factors and key-rotation policy locked
Decision:
- Self-serve API key recovery supports two factors: recovery public-key signature (`pubkey`) and verified email OTP (`email`); either method can complete recovery.
- Successful recovery must revoke all prior active API keys for the node and mint one new plaintext API key.
Reason: Explicitly documented in thread notes and validated in live Cloud Run smoke for the `pubkey` path.
Where captured:
- `docs/project-files/thread-notes.md` ("What was decided" + live verification sections)
Impact:
- Recovery does not require admin/manual intervention when a configured factor is available.
- Compromised/old keys are immediately invalidated on recovery completion.

## 2026-02-18 - Trial/referral policy and wrapper deferral locked
Decision:
- Trial entitlement bridge policy is fixed at: trigger on 10 uploads, grant 7-day trial entitlement, and grant +100 credits.
- Referral incentive policy is fixed at: award on first paid invoice only, with idempotent dedupe by claimer + payment reference.
- Major runtime skill/plugin wrapper work is deferred to Phase 2.
Reason: These were explicitly recorded as decisions/notes in the go-live thread summary and validated during production verification.
Where captured:
- `docs/project-files/thread-notes.md` ("Decisions / notes")
Impact:
- Billing entitlement behavior and incentives are now stable inputs for downstream docs/SDK/MCP work.
- Wrapper publishing/expansion remains out of current go-live scope.

## 2026-02-17 - Canonical paid-plan surface excludes plus
Decision: Canonical plan set is `free|basic|pro|business`; remove legacy `plus` from backend plan enums, Stripe diagnostics requirements, and checkout validation.
Reason: `docs/specs/00__read-first.md` defines canonical plans without `plus`, and live diagnostics showed `plus` env drift causing operational confusion.
Where captured:
- `docs/project-files/thread-notes.md` (Plan surface cleanup section)
- code/spec updates merged in commit `f155980`
Impact:
- `/v1/billing/checkout-session` accepts only `basic|pro|business`.
- Stripe diagnostics now report required env vars/counts for supported SKUs only.
- Existing legacy decisions referencing `plus` are superseded by this canonical rule.

## 2026-02-17 - Suspension enforcement boundary is runtime, not procedural
Decision: Suspension must be enforced in runtime paths: auth middleware, publish path, and public projection/search visibility.
Reason: Manual suspension existed operationally but was previously inconsistent in code enforcement.
Where captured:
- `docs/project-files/thread-notes.md` (Manual suspension enforcement section)
Impact:
- Suspended API keys receive `403`.
- Suspended nodes are blocked from publish paths and excluded from public search/listings and rebuild outputs.

## 2026-02-17 - Production schema drift handling for legal assent columns
Decision: Treat `nodes` legal assent columns as required production schema and remediate drift with an idempotent SQL patch (`add column if not exists` + backfill + not-null/default) before rerunning smoke.
Reason: Cloud Run `/v1/bootstrap` and `/v1/me` paths failed when `legal_accepted_at` / related columns were missing in Supabase.
Where captured:
- `docs/runbooks/sql/2026-02-17_nodes_legal_assent_columns.sql`
- `docs/runbooks/go-live-cloudrun-stripe.md` (Supabase schema apply section)
Impact:
- Production schema can be repaired without code fallback.
- Deployed smoke resumed and validated successfully after schema apply.

## 2026-02-17 — Go-live ASAP follow-ons (post P0 legal/meta/bootstrap)
- **Docs/hosting:** Publish OpenAPI on the same origin as the API (Cloud Run), exposed at `GET /openapi.json` (or `/docs/openapi.json`) and linked from `GET /v1/meta` as `openapi_url`.
- **Gating rule (confirmed):** Subscriber-gated actions remain **subscription-only** (credits balance does not unlock gated actions). Rationale: simplest UX + strongest subscription incentive.
- **Upgrade credits (plan change semantics):** On upgrade, grant **difference-based credits immediately** when the **upgrade/proration invoice is paid** (ledger idempotency keyed by `invoice_id`). Downgrades apply at next renewal (MVP).
- **Suspension (MVP ops):** Use **manual suspension** initially (set `nodes.suspended_at`, revoke keys) with a documented runbook; defer admin suspension endpoints to later hardening.
- **Verification TODOs:** Audit that (a) plan/gating enforcement and (b) rate limits are actually implemented everywhere required by `10__invariants.md` and `25__plans-credits-gating.md`; implement missing coverage + tests.
- **Top-ups:** Implement **3 credit-pack top-ups** (priced ~2× subscription implied cost-per-credit) as Phase 1, with Stripe Checkout + webhook credit grants + velocity limits.


## 2026-02-17 - Codex operational protocol: run-to-completion with bounded retries
Decision: Operational Codex tasks should run to completion with a bounded diagnose/fix/retry loop (up to 3 cycles per failing step), and stop only for true human-only blockers (UI/credentials/2FA). Avoid non-required cosmetic edits; only change files needed to satisfy TODOs or fix failing verification.
Reason: Reduce avoidable back-and-forth during CLI-heavy setup/deploy verification and keep diffs focused.
Impact: Future instruction blocks and execution reports should follow SUCCESS/BLOCKED outcomes with concrete command evidence.

## 2026-02-17 - Local DB bootstrap DDL trigger creation is idempotent
Decision: For bootstrap DDL, recreate triggers using `DROP TRIGGER IF EXISTS ... ON <table>; CREATE TRIGGER ...` across `nodes`, `subscriptions`, `units`, `requests`, and `offers`.
Reason: Re-running `npm run db:bootstrap` failed with Postgres `42710` (`trigger already exists`).
Impact: Local bootstrap is rerunnable; `npm run db:bootstrap` now succeeds on repeated runs against an already-initialized DB.

## 2026-02-17 - Project-files update cadence is thread-switch only
Decision: Do not manually update `docs/project-files/*` during normal coding work; update them only in the dedicated thread-switch step and separate project-files commit.
Reason: Keep product/code changes decoupled from handoff bookkeeping and maintain consistent thread transitions.
Impact: Day-to-day commits stay focused on code/spec changes; thread-switch handles synchronized TODO/decision/handoff refresh.

## 2026-02-17 - Cloud Run smoke flow requires public invoke access
Decision: For the current smoke/bootstrap flow, Cloud Run must allow invoke for unauthenticated callers; if deployed with `--no-allow-unauthenticated`, add `allUsers` `roles/run.invoker` before running smoke.
Reason: `scripts/smoke-stripe-subscription.ps1` starts at unauthenticated `POST /v1/bootstrap`, which fails when invoke is restricted.
Impact: Deployment/runbook steps now include an explicit invoker-permission check/fix before smoke validation.

## 2026-02-17 - Stripe invoice price-id mapping is canonical for paid plan resolution
Decision: Resolve `invoice.paid` plan from Stripe line-item price IDs via env mapping (`STRIPE_PRICE_*` / `STRIPE_PRICE_IDS_*`), with the $19.99 price mapped to internal `plus`.
Reason: Real `invoice.paid` payloads did not consistently carry `metadata.plan_code`, causing fallback to `free`.
Impact: Paid invoice processing now maps to the intended paid plan deterministically and `/v1/me` reflects paid-state plan results for mapped prices.

## 2026-02-17 - Billing compatibility rule: store plus as pro + ignore zero-amount monthly grants in dedupe
Decision: Keep DB compatibility by storing `plus` as `pro` in `subscriptions.plan_code` while returning `plus` in API response when plus mapping is configured; monthly grant dedupe treats only prior positive `grant_subscription_monthly` rows as already granted.
Reason: Current DB check constraint excludes `plus`, and historical zero-amount monthly grants blocked later paid grants for the same billing period.
Impact: No immediate schema migration required for this rollout; paid-node plan/credits now converge correctly and replayed paid events remain idempotent.

## 2026-02-16 - Enforce strict DB TLS with secret-backed CA pinning on Cloud Run
Decision: Production DB connections use explicit TLS verification (`rejectUnauthorized: true`) with `DATABASE_SSL_CA` injected from GCP Secret Manager; SSL query params are stripped from `DATABASE_URL` before pg Pool config so runtime TLS settings are deterministic.
Reason: Stripe webhook processing on Cloud Run was failing at DB insert with `SELF_SIGNED_CERT_IN_CHAIN` despite valid `DATABASE_URL`.
Impact: Webhook deliveries moved from 500 to 200 in production, DB writes succeed under strict TLS, and CA rotation is now managed as Secret Manager version updates.

## 2026-02-16 - Stripe webhook node mapping fallback order
Decision: Webhook processing maps Stripe events to a Node in this order: `metadata.node_id`, then stored `stripe_customer_id`, then stored `stripe_subscription_id`; if still unmapped, log `unmapped_stripe_customer` and return 200.
Reason: Real Stripe subscription events can arrive without node metadata, but webhook handling must stay idempotent and non-failing while preserving observability.
Impact: Subscription and invoice events update the correct Node when any mapping exists; unmapped events no longer hard-fail and can be triaged from logs.

## 2026-02-16 - Production schema baseline from canonical DDL
Decision: Initialize the Supabase production database from `docs/specs/21__db-ddl.sql` before Cloud Run smoke tests.
Reason: Ensure deployed API behavior runs against the canonical MVP schema.
Impact: Base production tables are now present (including `nodes`); future schema changes should continue from this baseline.

## 2026-02-16 - Production target locked: Supabase direct + Cloud Run
Decision: Production deployment uses Supabase Postgres via direct connection string (non-pooler), with Supabase Data API disabled, and deploy target set to GCP Cloud Run (container-first).
Reason: Keep API-to-DB connectivity explicit through `DATABASE_URL` and standardize deployment path for productionization.
Impact: Production rollout should proceed via Cloud Run image deploy + Cloud Run env var wiring (`DATABASE_URL`, `ADMIN_KEY`, Stripe secrets); no Data API dependency in runtime path.

## 2026-02-16 - ADMIN_KEY boundary (API auth only)
Decision: Treat `ADMIN_KEY` strictly as an API/admin authentication secret, not a PostgreSQL credential.
Reason: Avoid cross-system secret coupling and prevent mistaken DB password rotations during API key changes.
Impact: Postgres authentication remains exclusively governed by `DATABASE_URL`; rotate `ADMIN_KEY` independently.

## 2026-02-16 - Track package-lock.json (repo policy)
Decision: Commit and maintain package-lock.json in git.
Reason: Deterministic installs/CI; avoid dependency drift across machines.
Impact: Any dependency change requires running npm install and committing lockfile changes.

Track package-lock.json (repo policy), merged PR #2, rationale: deterministic installs/CI
ADMIN_KEY is API-only; rotate before deploy; never reuse DB creds.

## 2026-02-16 - Track package-lock.json (repo policy)
Decision: Commit and maintain package-lock.json in git (merged PR #2).
Reason: Deterministic installs/CI; avoids dependency drift.
Impact: Any dependency change requires committing lockfile updates.


## 2026-02-16 - Keep local project-files workflow artifacts untracked
Decision: Local workflow artifacts under `docs/project-files` (workflow/prompt/archive files) and `scripts/thread-switch.ps1` should stay local-only and not be tracked in repo commits.
Reason: Keep shared git history focused on product code/spec/docs changes while allowing local thread workflow files.
Where captured:
- `docs/project-files/thread-notes.md` (2026-02-15/16 merge + cleanup thread)
Impact:
- Local excludes were added via `.git/info/exclude`; `git status` remains clean locally.

## 2026-02-15 - Local verification baseline set to PostgreSQL 17 + `fabric` database
Decision: Local MVP verification uses PostgreSQL 17 with a local `fabric` database on `localhost:5432`.
Reason: `npm run db:bootstrap` failed with `ECONNREFUSED` until a local Postgres instance was installed and initialized.
Where captured:
- `docs/project-files/thread-notes.md` (What changed, Errors / fixes, Next step)
Impact:
- `.env` must set `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric` before bootstrap/tests.

## 2026-02-15 - MVP backend stack locked (Stack A)
Decision: MVP backend stack is:
- Node.js (LTS) + TypeScript
- Fastify
- Postgres
- Cloud Run-compatible Dockerfile (container-first deploy)

Where captured:
- `docs/specs/30__mvp-scope.md` (Stack locked)
- `docs/specs/01__implementation-map.md` (Runtime/DB assumptions)
- `docs/specs/20__api-contracts.md` (removed "Vercel Cron" wording)

Implementation note:
- Docs stack-lock commit: `e26d7c7`
- Merged to `main` via merge commit: `12fb556`

## 2026-02-15 - Specs bundle is the source of truth for agents/Codex
Decision: Specs live under `docs/specs/` and are the canonical reference for implementation and changes.

Where captured:
- `docs/specs/00__read-first.md` precedence list
- `AGENTS.md` pointers and doc mapping

## 2026-02-15 - Local verification required before merging backend scaffold PR
Decision: Do not merge code scaffold PR until `npm run db:bootstrap` + `npm test` pass locally with a real Postgres instance.

Reason:
- tests fail with 500s if DATABASE_URL / Postgres is not available.

## 2026-02-15 - Git hygiene decisions (temporary)
Decision:
- Do not commit unrelated/unplanned artifacts into docs-only changes.
- Keep build outputs out of git via `.gitignore` (`node_modules/`, `dist/`, `coverage/`, `.env*`).

Open decision:
- Whether `package-lock.json` is committed as policy (recommended) vs kept untracked.

## (Add future decisions below)
Template:
## YYYY-MM-DD - <Decision title>
Decision:
Reason:
Where captured:
Impact:
