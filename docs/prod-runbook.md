# Production Runbook

## Overview
- Goal: run Fabric API against Supabase Postgres using DIRECT (non-pooler) connections.
- Keep secrets in deployment environment variables only (no committed `.env` files).

## Provision Supabase Postgres (Direct)
- Create a Supabase project.
- Set the database password.
- Choose the production region.
- Open Supabase Dashboard -> Project -> Connect.
- Copy the DIRECT Postgres connection string.
- Set `DATABASE_URL` to the direct string in deployment config.
- Use provider defaults / SSL required.

## Store secrets in deployment env vars
- Required:
  - `DATABASE_URL`
  - `ADMIN_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
- Recommended preflight:
  - `npm run validate:env`

## Migrations procedure
- Existing DB bootstrap command:
  - `npm run db:bootstrap`
- TBD: migrations command

## Smoke tests (minimal)
- Start server:
  - `npm run start`
- Health check:
  - `GET /healthz` (expects `{ "ok": true }`)
- DB connectivity:
  - TBD: no dedicated DB connectivity endpoint currently exists.
