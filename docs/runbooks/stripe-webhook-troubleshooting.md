# Stripe Webhook Troubleshooting and Replay (MVP)

## Common symptoms
- `400 validation_error` with signature failure.
- `200 { ok: true }` but no subscription/credit updates.
- Delayed processing after deploy.

## Quick checks
1. Verify runtime secrets are configured:
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`
2. Confirm endpoint URL matches deployed service:
- `https://<service>/v1/webhooks/stripe`
3. Confirm Cloud Run logs include:
- `Stripe webhook signature verified`
- `Stripe webhook processed`

## Signature failures
- Ensure raw request body is used for verification.
- Ensure Stripe dashboard endpoint secret matches `STRIPE_WEBHOOK_SECRET`.
- Re-send from Stripe Dashboard:
  - Developers -> Webhooks -> endpoint -> event -> Resend.

## Mapping failures
- Check event payload for node mapping fields:
  - `metadata.node_id`
  - customer/subscription ids (`cus_...`, `sub_...`)
- Verify stored mapping in DB subscriptions table for target node.

## Replay guidance
1. Prefer replaying a known event id from Stripe dashboard.
2. Confirm idempotency behavior in logs:
   - event should be processed without duplicate side effects.
3. For invoice events, verify resulting ledger rows by invoice/payment key.

## Post-replay validation
- `GET /v1/me` using the affected node key.
- Verify subscription status/plan and credits balance expectations.
