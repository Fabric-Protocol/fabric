# Stripe Webhook Troubleshooting and Replay (MVP)

## Common symptoms
- Checkout session is created, but `GET /v1/me` remains `subscription.status="none"`.
- Webhook endpoint returns `400` with `error.code="stripe_signature_invalid"`.
- Cloud/local logs show `Stripe webhook processed without node mapping`.

## Fast local workflow
1. Start local forwarding to your API:
```powershell
stripe listen --forward-to http://localhost:3000/v1/webhooks/stripe
```
2. Copy the printed signing secret (`whsec_...`) into local `.env` as:
```
STRIPE_WEBHOOK_SECRET=whsec_...
```
3. Restart the API process after changing `.env`.
4. Re-run smoke (reuse existing node/key to avoid bootstrap limits):
```powershell
.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "http://localhost:3000" -PlanCode "basic" -SkipBootstrap
```

## What to check in logs
Look for these lines in order:
- `Stripe webhook received` (event arrived)
- `Stripe webhook signature verified` (signature passed)
- `Stripe subscription activated` (node/plan transition happened)
- `Stripe webhook processed` (event processing finished)

If signature fails, you should see:
- `Stripe webhook signature verification failed`
- HTTP `400` with `error.code="stripe_signature_invalid"`

## Replay guidance
Resend a known event id:
```powershell
stripe events resend <evt_id>
```
Then re-check webhook logs and `GET /v1/me` for the same node.

## Quick checks
1. Runtime env vars exist:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
2. Endpoint is correct for environment:
- local: `http://localhost:3000/v1/webhooks/stripe`
- deployed: `https://<service>/v1/webhooks/stripe`
3. Mapping exists or metadata is present:
- `metadata.node_id`, or stored `stripe_customer_id` / `stripe_subscription_id`

## Official references
- Stripe CLI `listen` forwarding + webhook signing secret output:
  https://docs.stripe.com/stripe-cli/use-cli
- Stripe CLI resend command reference:
  https://docs.stripe.com/cli/events/resend
