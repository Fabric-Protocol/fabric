# Fabric - Decision Log

Format: newest first. Keep entries short; link to spec sections when applicable.

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
