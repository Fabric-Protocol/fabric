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
  - `DATABASE_SSL_CA`
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

## Stripe webhook signature verification check
- Ensure `STRIPE_WEBHOOK_SECRET` is set for the target environment.
- Send a signed test webhook from PowerShell:
  - `.\scripts\verify-stripe-webhook.ps1 -Url "http://localhost:8080/v1/webhooks/stripe" -Secret "<STRIPE_WEBHOOK_SECRET>" -NodeId "<EXISTING_NODE_ID>"`
- Expected result:
  - HTTP `200` and `{ "ok": true }`
  - Server logs include structured webhook fields (`event_type`, `event_id`, `signature_verified`) without exposing secrets.

## Stripe node mapping requirements
- Webhook mapping order is:
  - `metadata.node_id` from event payload
  - stored `stripe_customer_id`
  - stored `stripe_subscription_id`
  - fetched Stripe Customer `metadata.node_id` (when `customer` id exists)
  - fetched Stripe Subscription `metadata.node_id` (when `subscription` id exists)
- When fallback metadata resolves a Node, mapping is persisted deterministically:
  - set `stripe_customer_id` / `stripe_subscription_id` only when current value is null or the same value
  - never remap an existing Stripe id to a different Node
- If no mapping is found, webhook still returns `200` and logs `reason=unmapped_stripe_customer`.

## Stripe subscription smoke test (PowerShell)
- Run:
  - `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "https://<api-host>" -BillingPath "/v1/billing/checkout-session" -PlanCode "basic"`
- Flow:
  - Bootstraps a node and captures `api_key`
  - Calls configured billing checkout endpoint (if present)
  - Prompts you to complete Stripe test checkout
  - Verifies `GET /v1/me` and checks subscription status
