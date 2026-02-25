# Go-Live Runbook: Cloud Run + Stripe

## Scope
- Goal: make production Stripe billing/webhooks work on Cloud Run with the current Fabric API implementation.
- This runbook covers:
  - production env var manifest (from code)
  - human-only console setup steps (Cloud Run + Stripe)
  - deployed smoke verification commands

## Prereqs
- Cloud Run service exists and you know the HTTPS base URL (for example `https://<service>-<hash>-<region>.a.run.app`).
- Stripe account is in the correct mode (test or live) for your keys.
- Stripe Products/Prices already exist for the plans/packs you want to sell.
- `gcloud` and PowerShell available locally.

## Supabase Schema Apply (Human-Only)
- Why: deployed code reads/writes `nodes.legal_accepted_at`, `nodes.legal_version`, `nodes.legal_ip`, `nodes.legal_user_agent`.
- Run this SQL in Supabase SQL Editor (same SQL is also in `docs/runbooks/sql/2026-02-17_nodes_legal_assent_columns.sql`):

```sql
begin;

alter table public.nodes add column if not exists legal_accepted_at timestamptz;
alter table public.nodes add column if not exists legal_version text;
alter table public.nodes add column if not exists legal_ip text;
alter table public.nodes add column if not exists legal_user_agent text;

update public.nodes
set legal_accepted_at = coalesce(legal_accepted_at, created_at, now()),
    legal_version = coalesce(nullif(legal_version, ''), 'legacy')
where legal_accepted_at is null
   or legal_version is null
   or legal_version = '';

alter table public.nodes alter column legal_accepted_at set default now();
alter table public.nodes alter column legal_version set default 'legacy';
alter table public.nodes alter column legal_accepted_at set not null;
alter table public.nodes alter column legal_version set not null;

commit;
```

- Verification query:

```sql
select id, legal_accepted_at, legal_version, legal_ip, legal_user_agent
from public.nodes
limit 1;
```

## Env Var Manifest (Source of Truth: `src/config.ts`)

### A) Core app/runtime

| Env var | Required | Example shape | Used at |
|---|---|---|---|
| `PORT` | Optional (default `8080`) | `8080` | `src/config.ts:19`, `src/server.ts:5` |
| `HOST` | Optional (default `0.0.0.0`) | `0.0.0.0` | `src/config.ts:20`, `src/server.ts:5` |
| `DATABASE_URL` | Required in production | `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres` | `src/config.ts:21`, `src/db/client.ts:29`, `src/db/client.ts:45` |
| `DATABASE_SSL_CA` | Required for strict TLS in production | PEM text (`-----BEGIN CERTIFICATE-----...`) | `src/config.ts:22`, `src/db/client.ts:32`, `src/db/client.ts:33` |
| `ADMIN_KEY` | Required for `/v1/admin/*` | long random string | `src/config.ts:23`, `src/app.ts:433` |

### B) Stripe + billing

| Env var | Required | Example shape | Used at |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Required for checkout creation and Stripe API lookups | `sk_live_...` or `sk_test_...` | `src/config.ts:27`, `src/services/fabricService.ts:71`, `src/services/fabricService.ts:627`, `src/services/fabricService.ts:685` |
| `STRIPE_WEBHOOK_SECRET` | Required for webhook signature verification | `whsec_...` | `src/config.ts:28`, `src/app.ts:834`, `src/app.ts:839` |
| `STRIPE_PRICE_IDS_BASIC` | Required if plan `basic` is sold (or use `STRIPE_PRICE_BASIC`) | `price_abc,price_def` | `src/config.ts:29`, `src/services/fabricService.ts:435`, `src/services/fabricService.ts:443` |
| `STRIPE_PRICE_BASIC` | Optional alias for `basic` single price id | `price_abc` | `src/config.ts:29`, `src/services/fabricService.ts:435`, `src/services/fabricService.ts:443` |
| `STRIPE_PRICE_IDS_PRO` | Required if plan `pro` is sold (or use `STRIPE_PRICE_PRO`) | `price_abc,price_def` | `src/config.ts:30`, `src/services/fabricService.ts:446`, `src/services/fabricService.ts:452` |
| `STRIPE_PRICE_PRO` | Optional alias for `pro` single price id | `price_abc` | `src/config.ts:30`, `src/services/fabricService.ts:446`, `src/services/fabricService.ts:452` |
| `STRIPE_PRICE_IDS_BUSINESS` | Required if plan `business` is sold (or use `STRIPE_PRICE_BUSINESS`) | `price_abc,price_def` | `src/config.ts:31`, `src/services/fabricService.ts:447`, `src/services/fabricService.ts:452` |
| `STRIPE_PRICE_BUSINESS` | Optional alias for `business` single price id | `price_abc` | `src/config.ts:31`, `src/services/fabricService.ts:447`, `src/services/fabricService.ts:452` |
| `STRIPE_CREDIT_PACK_PRICE_500` | Required if `credits_500` credit pack is enabled | `price_1T3tJlK3gJAgZl81iZzGyRaj` | `src/config.ts:62` |
| `STRIPE_CREDIT_PACK_PRICE_1500` | Required if `credits_1500` credit pack is enabled | `price_1T3tQ2K3gJAgZl81JGlIYaSy` | `src/config.ts:63` |
| `STRIPE_CREDIT_PACK_PRICE_4500` | Required if `credits_4500` credit pack is enabled | `price_1T3tKlK3gJAgZl81HBKJ5a8U` | `src/config.ts:64` |

### C) Credit pack credits + pricing (safe defaults exist)

| Env var | Required | Default | Notes |
|---|---|---|---|
| `CREDIT_PACK_500_CREDITS` | Optional | `500` | Credits granted for `credits_500` pack |
| `CREDIT_PACK_1500_CREDITS` | Optional | `1500` | Credits granted for `credits_1500` pack |
| `CREDIT_PACK_4500_CREDITS` | Optional | `4500` | Credits granted for `credits_4500` pack |
| `CREDIT_PACK_500_PRICE_CENTS` | Optional | `999` | Display price for `credits_500` (used in quotes) |
| `CREDIT_PACK_1500_PRICE_CENTS` | Optional | `1999` | Display price for `credits_1500` |
| `CREDIT_PACK_4500_PRICE_CENTS` | Optional | `4999` | Display price for `credits_4500` |

### D) Pricing/credits/rate-limit tuning (safe defaults exist)

| Env var | Required | Example shape | Used at |
|---|---|---|---|
| `DEFAULT_RATE_LIMIT_LIMIT` | Optional (default `1000`) | `1000` | `src/config.ts:24`, `src/app.ts:418` |
| `SEARCH_CREDIT_COST` | Optional (default `5`) | `5` | `src/config.ts:40` |
| `SIGNUP_GRANT_CREDITS` | Optional (default `100`) | `100` | `src/config.ts:51` |
| `CREDIT_PACK_MAX_GRANTS_PER_DAY` | Optional (default `3`) | `3` | `src/config.ts:81`, `src/services/fabricService.ts` |
| `RATE_LIMIT_BOOTSTRAP_PER_HOUR` | Optional (default `3`) | `3` | `src/config.ts:43`, `src/app.ts:252` |
| `RATE_LIMIT_SEARCH_PER_MINUTE` | Optional (default `20`) | `20` | `src/config.ts:44`, `src/app.ts:253` |
| `RATE_LIMIT_CREDITS_QUOTE_PER_MINUTE` | Optional (default `60`) | `60` | `src/config.ts:45`, `src/app.ts:254` |
| `RATE_LIMIT_CREDIT_PACK_CHECKOUT_PER_DAY` | Optional (default `10`) | `10` | `src/config.ts:89`, `src/app.ts` |
| `RATE_LIMIT_INVENTORY_PER_MINUTE` | Optional (default `6`) | `6` | `src/config.ts:47`, `src/app.ts:256` |
| `RATE_LIMIT_OFFER_WRITE_PER_MINUTE` | Optional (default `30`) | `30` | `src/config.ts:48`, `src/app.ts:257` |
| `RATE_LIMIT_OFFER_DECISION_PER_MINUTE` | Optional (default `60`) | `60` | `src/config.ts:49`, `src/app.ts:258` |
| `RATE_LIMIT_REVEAL_CONTACT_PER_HOUR` | Optional (default `10`) | `10` | `src/config.ts:50`, `src/app.ts:259` |
| `RATE_LIMIT_API_KEY_ISSUE_PER_DAY` | Optional (default `10`) | `10` | `src/config.ts:51`, `src/app.ts:260` |

## Human-Only Console Steps

### 1) Set Cloud Run env vars
1. Open Google Cloud Console -> Cloud Run -> `fabric-api` -> Edit and deploy new revision.
2. Set secret-backed env vars (recommended):
   - `DATABASE_URL`
   - `DATABASE_SSL_CA`
   - `ADMIN_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
3. Set plain env vars for any plan/credit pack price IDs you are enabling:
   - plan prices: `STRIPE_PRICE_*` or `STRIPE_PRICE_IDS_*`
   - credit pack prices: `STRIPE_CREDIT_PACK_PRICE_500`, `STRIPE_CREDIT_PACK_PRICE_1500`, `STRIPE_CREDIT_PACK_PRICE_4500`
4. Deploy revision and wait for `latestReadyRevisionName` to become ready.

### 2) Configure Stripe webhook endpoint
1. Stripe Dashboard -> Developers -> Webhooks -> Add endpoint.
2. Endpoint URL:
   - `<CLOUD_RUN_URL>/v1/webhooks/stripe`
3. Subscribe to the event types the backend handles:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy endpoint signing secret (`whsec_...`) and set as `STRIPE_WEBHOOK_SECRET` in Cloud Run.
5. Deploy a new revision if needed.

## Cloud Scheduler Jobs (Human-Only)

Two scheduled jobs are required for correct lifecycle behavior in production.

### 1) Offer + request expiry sweep (every 5 minutes)

Expires stale offers (releases holds) and unpublishes expired requests.

```
POST <CLOUD_RUN_URL>/internal/admin/sweep
Header: X-Admin-Key: <ADMIN_KEY>
Header: Idempotency-Key: sweep-<timestamp>
```

Setup via `gcloud`:
```powershell
gcloud scheduler jobs create http fabric-sweep `
  --location=us-west1 `
  --schedule="*/5 * * * *" `
  --uri="<CLOUD_RUN_URL>/internal/admin/sweep" `
  --http-method=POST `
  --headers="X-Admin-Key=<ADMIN_KEY>,Idempotency-Key=sweep-scheduled" `
  --oidc-service-account-email=<SERVICE_ACCOUNT_EMAIL>
```

### 2) Projection rebuild (every 30 minutes at :07 and :37 PT)

Recomputes `public_listings` and `public_requests` from canonical objects, correcting any drift.

```
POST <CLOUD_RUN_URL>/v1/admin/projections/rebuild?kind=all&mode=full
Header: X-Admin-Key: <ADMIN_KEY>
Header: Idempotency-Key: rebuild-<timestamp>
```

Setup via `gcloud`:
```powershell
gcloud scheduler jobs create http fabric-projection-rebuild `
  --location=us-west1 `
  --schedule="7,37 * * * *" `
  --time-zone="America/Los_Angeles" `
  --uri="<CLOUD_RUN_URL>/v1/admin/projections/rebuild?kind=all&mode=full" `
  --http-method=POST `
  --headers="X-Admin-Key=<ADMIN_KEY>,Idempotency-Key=rebuild-scheduled" `
  --oidc-service-account-email=<SERVICE_ACCOUNT_EMAIL>
```

**Note:** Replace `<CLOUD_RUN_URL>`, `<ADMIN_KEY>`, and `<SERVICE_ACCOUNT_EMAIL>` with your actual values. The service account must have `roles/run.invoker` on the Cloud Run service.

## PowerShell Verification

### Quick ping
```powershell
Invoke-RestMethod "<CLOUD_RUN_URL>/v1/meta" | ConvertTo-Json -Depth 10
```

### Deployed subscription smoke
```powershell
.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "<CLOUD_RUN_URL>" -PlanCode "basic"
```

Expected flow:
1. Script reaches `/v1/meta`.
2. Script creates bootstrap node and checkout session (`checkout_url` printed).
3. Human completes Stripe checkout.
4. Script verifies `/v1/me` and expects `subscription.status="active"`.

## Common Failures and Fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `validation_error` + `stripe_not_configured` | `STRIPE_SECRET_KEY` missing | Set `STRIPE_SECRET_KEY`, redeploy |
| `validation_error` + `missing_price_mapping` | plan price id missing for requested `plan_code` | Set matching `STRIPE_PRICE_*`/`STRIPE_PRICE_IDS_*`, redeploy |
| `validation_error` + `missing_credit_pack_price_mapping` | credit pack price id missing | Set `STRIPE_CREDIT_PACK_PRICE_*`, redeploy |
| webhook 400 + `stripe_signature_invalid` | wrong/missing `STRIPE_WEBHOOK_SECRET` | Set correct endpoint `whsec_...`, redeploy |
| smoke cannot reach service | wrong URL or Cloud Run ingress/IAM issue | verify `<CLOUD_RUN_URL>`, ensure service is invokable for your caller |

## Done Criteria
- `/v1/meta` is reachable on the Cloud Run URL.
- Smoke script prints a valid `checkout_url`.
- After checkout, `/v1/me` shows active subscription state.
- Webhook logs show:
  - `Stripe webhook signature verified`
  - `Stripe webhook processed`
