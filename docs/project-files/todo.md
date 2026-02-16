# Fabric - TODO (thread-active)

Last updated: 2026-02-16

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
- [ ] Ensure PostgreSQL service is running and listening on port 5432:
  - Verify: `netstat -ano | findstr :5432`
- [ ] Ensure `psql` is available in PATH:
  - Verify: `psql --version`
- [ ] Validate repo `.env` values for local DB remain correct:
  - `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric`
  - `ADMIN_KEY=<non-empty>`

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
- [ ] Authenticate GCP CLI and set active project:
  - `gcloud auth login`
  - `gcloud config set project <PROJECT_ID>`
- [ ] Build and deploy container image to Cloud Run:
  - `.\scripts\deploy-cloud-run.ps1 -ProjectId <PROJECT_ID>`
- [ ] Set Cloud Run runtime env vars with real values:
  - `DATABASE_URL`, `ADMIN_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- [ ] Complete Stripe production wiring:
  - Configure products/prices + webhook destination/secret
- [ ] Run post-deploy smoke tests:
  - `GET /healthz`
  - bootstrap + auth-keys flow against deployed Cloud Run URL

## P1 - Backend branch follow-ups
- [x] Merge backend API contract/test gap work into `main` (PR #1 merged).
- [ ] If new backend changes are needed, branch from updated `main` and rerun:
  - `npm run typecheck`
  - `npm test`

## P1 - Repo hygiene
- [ ] Ensure `.gitignore` includes: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`
