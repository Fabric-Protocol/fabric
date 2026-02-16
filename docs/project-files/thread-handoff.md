# Thread Handoff

Last updated: 2026-02-16

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Last commit: `e92df2a` (`project-files: update handoff/todo/decisions from thread notes`)
- Working tree: not clean (untracked: `tmp-bootstrap.json`, `tmp/`)

## What just changed in this thread
- Confirmed Cloud Run deployment is live in `us-west1`:
  - Service URL: `https://fabric-api-393345198409.us-west1.run.app`
- Wired production DB credentials to Cloud Run:
  - `DATABASE_URL` set to Supabase direct connection
  - `ADMIN_KEY` set on Cloud Run
- Resolved deployment blockers in sequence:
  - Missing `DATABASE_URL` caused localhost DB attempts
  - Supabase password mismatch was corrected
  - Missing schema (`relation "nodes" does not exist`) fixed by running `docs/specs/21__db-ddl.sql` in Supabase SQL editor
- Production smoke checks now passing:
  - `POST /v1/bootstrap` returns node + api key + signup credits
  - `GET /v1/me` succeeds with returned `ApiKey`
  - `POST /v1/admin/projections/rebuild?kind=all&mode=full` succeeds with admin key

## Current blocker
- Stripe production setup is still pending:
  - Cloud Run missing `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
  - Stripe products/prices and webhook wiring not completed yet

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `gcloud config set project fabric-487608`
4. `gcloud run services update fabric-api --project fabric-487608 --region us-west1 --update-env-vars "STRIPE_SECRET_KEY=[STRIPE_SECRET_KEY],STRIPE_WEBHOOK_SECRET=[STRIPE_WEBHOOK_SECRET]"`
5. `# Configure Stripe products/prices in Stripe dashboard`
6. `# Configure webhook endpoint: https://fabric-api-393345198409.us-west1.run.app/v1/webhooks/stripe`
7. `# Run webhook smoke tests and verify subscription state transitions`

## Handoff objective for next thread
- Complete Stripe wiring on the deployed Cloud Run service and validate end-to-end subscription flows.
