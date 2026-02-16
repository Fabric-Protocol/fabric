# Thread Handoff

Last updated: 2026-02-16

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Last commit: `447ad31` (`stripe: verify webhook using raw body + multiple v1 signatures`)
- Working tree: not clean
  - Modified: `src/app.ts`, `src/db/fabricRepo.ts`, `src/services/fabricService.ts`, `tests/api.test.mjs`, `docs/prod-runbook.md`
  - Untracked: `scripts/smoke-stripe-subscription.ps1`

## What just changed in this thread
- Stripe webhook signature verification was fixed for production deliveries:
  - Uses raw body bytes for HMAC verification
  - Supports multiple `v1` values in `Stripe-Signature`
  - Stripe deliveries now return HTTP 200 with `{ "ok": true }` instead of signature-failure 400s
- Stripe webhook node mapping path was implemented in working tree:
  - Mapping order: `metadata.node_id` -> `stripe_customer_id` -> `stripe_subscription_id`
  - Unmapped events log `reason=unmapped_stripe_customer` and still return 200
- Local coverage updated:
  - Tests extended for mapping scenarios
  - PowerShell smoke helper added: `scripts/smoke-stripe-subscription.ps1`
  - Runbook notes updated in `docs/prod-runbook.md`
- Deployed environment status:
  - Cloud Run and Supabase are live
  - Stripe endpoint receives events, including `customer.subscription.created`

## Current blocker
- Dashboard-created Stripe subscriptions are not deterministic for Fabric Node updates unless mapping exists (`metadata.node_id` or stored Stripe customer/subscription IDs).
- Billing checkout/portal endpoints are not present in current contracts/implementation, so there is no canonical API flow yet to establish mapping automatically.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `git status --short`
4. `npm test`
5. `gcloud builds submit --tag gcr.io/fabric-487608/fabric-api .`
6. `gcloud run deploy fabric-api --region us-west1 --image gcr.io/fabric-487608/fabric-api`
7. `# Bootstrap a node and ensure Stripe mapping input exists (metadata.node_id or persisted stripe_customer_id/stripe_subscription_id)`
8. `# Resend Stripe events from Stripe dashboard and check Cloud Run logs for absence of reason=unmapped_stripe_customer`
9. `# Verify GET /v1/me reflects active subscription and invoice.paid credit changes`

## Handoff objective for next thread
- Finalize deterministic Stripe-to-Node mapping path in production and validate subscription/credit lifecycle updates end-to-end.
