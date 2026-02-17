# Fabric - Decision Log

Format: newest first. Keep entries short; link to spec sections when applicable.

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
