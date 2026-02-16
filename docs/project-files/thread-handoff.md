# Thread Handoff

Last updated: 2026-02-16

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Last commit: `6ff7a6f` (`deploy: Cloud Run container + make tests hermetic`)
- Working tree: clean (`git status --short --branch` reports only `## main...origin/main`)

## What just changed in this thread
- Locked productionization decisions:
  - Supabase as prod Postgres provider
  - Direct (non-pooler) DB connection
  - Supabase Data API disabled
  - GCP Cloud Run as deploy target
- Added productionization docs/tooling:
  - `docs/env-vars.md`, `docs/prod-runbook.md`, `docs/deploy-cloud-run.md`
  - `scripts/validate-env.ps1`, `scripts/deploy-cloud-run.ps1`
  - `Dockerfile`, `.dockerignore`
- Runtime bind alignment for Cloud Run:
  - `src/config.ts` default `PORT` is now `8080`
  - `HOST` remains `0.0.0.0`
- Test reliability fix:
  - `tests/api.test.mjs` now deletes shell-provided `DATABASE_URL` / admin / Stripe env vars at top before app setup.
- Validation outcome:
  - `npm test` passes after hermetic env fix.

## Current blocker
- First production deploy has not been executed yet.
- Remaining blockers: Cloud Run env var injection with real secrets, Stripe product/webhook setup, and deployed smoke checks.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `npm test`
4. `gcloud auth login`
5. `gcloud config set project <PROJECT_ID>`
6. `.\scripts\deploy-cloud-run.ps1 -ProjectId <PROJECT_ID>`
7. `gcloud run services update fabric-api --region us-west1 --set-env-vars "DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres,ADMIN_KEY=[ADMIN_KEY],STRIPE_SECRET_KEY=[STRIPE_SECRET_KEY],STRIPE_WEBHOOK_SECRET=[STRIPE_WEBHOOK_SECRET]"`
8. `# Configure Stripe products/prices and webhook secret in Stripe + Cloud Run`
9. `# Smoke test deployed service: GET /healthz and bootstrap/auth-key flow`

## Handoff objective for next thread
- Execute first Cloud Run deploy and complete post-deploy env/Stripe/smoke-test checklist.
