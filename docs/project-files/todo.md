# Fabric - TODO (thread-active)

Last updated: 2026-02-17

## P0 - Post-merge decisions and hygiene
- [x] Decide repo policy for `package-lock.json` and record it in `docs/project-files/decision-log.md`:
  - Policy chosen: commit it and keep it updated.
- [x] Apply the chosen lockfile policy in a clean follow-up PR (merged to `main`).
- [x] Keep local-only project-files artifacts out of git using `.git/info/exclude` (done in this thread).

## P0 - Keep local verification baseline healthy
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
- [ ] Validate repo `.env` values for local DB remain correct:
  - `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric`
  - `ADMIN_KEY=<non-empty>`
- [x] Make local bootstrap rerunnable:
  - `npm run db:bootstrap` succeeded twice after idempotent trigger fix in `docs/specs/21__db-ddl.sql` (commit `9b4b31c`)

## P0 - Productionization execution (Supabase + Cloud Run)
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
  - Done: paid-node verification after `invoice.paid` replay shows `/v1/me` `subscription.plan=plus`, `subscription.status=active`, `credits_balance=1700`
  - Done: idempotency verification after re-resend of same `invoice.paid` event left paid-node `/v1/me` unchanged (`credits_balance` remained `1700`)

## P1 - Backend branch follow-ups
- [x] Merge backend API contract/test gap work into `main` (PR #1 merged).
- [ ] If new backend changes are needed, branch from updated `main` and rerun:
  - `npm run typecheck`
  - `npm test`
- [x] Validate full production flow for a brand-new node:
  - New node bootstrap -> start checkout/payment -> Stripe customer/subscription creation -> webhook mapping to node -> `/v1/me` paid state
- [x] Resend a non-entitlement Stripe event (for example `customer.created`) and confirm no subscription/credits mutation.

## P1 - Repo hygiene
- [ ] Ensure `.gitignore` includes: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`
