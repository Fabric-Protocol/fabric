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


**CA Rotation Runbook (fabric-api / Cloud Run)**

Use this exact flow in PowerShell.

```powershell
$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"
gcloud config set project fabric-487608
```

### 1) Verify current CA wiring and runtime usage

1. Confirm Cloud Run is wired to Secret Manager (`DATABASE_SSL_CA`):
```powershell
$svc = gcloud run services describe fabric-api --region us-west1 --format=json | ConvertFrom-Json
$rev = $svc.status.latestReadyRevisionName
$svc.spec.template.spec.containers[0].env | Where-Object { $_.name -eq "DATABASE_SSL_CA" } | ConvertTo-Json -Depth 6
```

2. Confirm app runtime sees CA (`database_ssl_ca_present=true`):
```powershell
$filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.revision_name="' + $rev + '" AND jsonPayload.msg="db env check"'
gcloud logging read $filter --region us-west1 --limit 20 --freshness=1h --format="value(timestamp,jsonPayload.check_point,jsonPayload.database_ssl_ca_present,jsonPayload.config_database_url_host)"
```

3. Secret location and versions:
```powershell
gcloud secrets describe DATABASE_SSL_CA --format="value(name)"
gcloud secrets versions list DATABASE_SSL_CA --format="table(name,state,createTime)"
```
Secret path is: `projects/fabric-487608/secrets/DATABASE_SSL_CA`

---

### 2) Update `DATABASE_SSL_CA` and force a new revision

1. Save new CA bundle PEM to file:
```powershell
@'
-----BEGIN CERTIFICATE-----
...new CA/intermediate/root PEM content...
-----END CERTIFICATE-----
'@ | Set-Content .\database_ssl_ca.pem
```

2. Add new secret version:
```powershell
gcloud secrets versions add DATABASE_SSL_CA --data-file .\database_ssl_ca.pem
```

3. Force new Cloud Run revision to pick latest secret:
```powershell
gcloud run services update fabric-api --region us-west1 --update-secrets DATABASE_SSL_CA=DATABASE_SSL_CA:latest
```

4. Confirm new ready revision:
```powershell
gcloud run services describe fabric-api --region us-west1 --format="value(status.latestReadyRevisionName)"
```

---

### 3) Validate after rotation

1. Trigger Stripe test event:
- Preferred: Stripe Dashboard -> Webhooks -> endpoint `https://fabric-api-393345198409.us-west1.run.app/v1/webhooks/stripe` -> resend recent event.

2. Validate logs on latest revision:
```powershell
$svc = gcloud run services describe fabric-api --region us-west1 --format=json | ConvertFrom-Json
$rev = $svc.status.latestReadyRevisionName
$base = 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.revision_name="' + $rev + '"'

gcloud logging read ($base + ' AND jsonPayload.msg="Stripe webhook signature verified"') --limit 20 --freshness=1h --format="value(timestamp,jsonPayload.event_id,jsonPayload.event_type)"
gcloud logging read ($base + ' AND jsonPayload.msg="Stripe webhook processed"') --limit 20 --freshness=1h --format="value(timestamp,jsonPayload.event_id,jsonPayload.event_type)"
gcloud logging read ($base + ' AND jsonPayload.msg="stripe webhook handler failed"') --limit 20 --freshness=1h --format="value(timestamp,jsonPayload.err.message)"
```

Success criteria:
- `Stripe webhook signature verified` present.
- `Stripe webhook processed` present.
- No `stripe webhook handler failed`.
- No TLS trust errors.

---

### 4) Errors to watch and where

Watch in **Cloud Run logs** (Logs Explorer / `gcloud logging read`) and **Error Reporting** for service `fabric-api`:

- `SELF_SIGNED_CERT_IN_CHAIN`
- `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
- `unable to verify the first certificate`
- `CERT_HAS_EXPIRED`
- `hostname/IP does not match certificate's altnames`

Fast grep query:
```powershell
$svc = gcloud run services describe fabric-api --region us-west1 --format=json | ConvertFrom-Json
$rev = $svc.status.latestReadyRevisionName
$err = 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.revision_name="' + $rev + '" AND (textPayload:"SELF_SIGNED_CERT_IN_CHAIN" OR textPayload:"UNABLE_TO_GET_ISSUER_CERT_LOCALLY" OR textPayload:"unable to verify the first certificate" OR textPayload:"CERT_HAS_EXPIRED" OR jsonPayload.err.message:"SELF_SIGNED_CERT_IN_CHAIN" OR jsonPayload.err.message:"UNABLE_TO_GET_ISSUER_CERT_LOCALLY")'
gcloud logging read $err --limit 50 --freshness=24h --format="value(timestamp,logName,textPayload,jsonPayload.err.message)"
```

---

### 5) Security policy note

Keep `rejectUnauthorized: true` permanently.  
Do **not** use insecure TLS (`rejectUnauthorized:false` / `sslmode=no-verify`) except emergency outage mitigation, and only with a short rollback window and immediate follow-up to restore strict verification.

## PowerShell-safe Cloud Logging queries

Use this pattern in PowerShell:
- Build `$filter` as one string variable.
- Pass it as a single argument: `gcloud logging read "$filter"`.
- Use `--format=json` and post-filter with `ConvertFrom-Json` + `Where-Object` for `jsonPayload.msg`.

### a) Event-specific processed webhook logs (last 6h)

```powershell
$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"
gcloud config set project fabric-487608 | Out-Null

$eventId = "evt_1T1Qr9K3gJAgZl81iD1oE6Nz"
$filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND jsonPayload.event_id="' + $eventId + '"'

$raw = gcloud logging read "$filter" `
  --project fabric-487608 `
  --freshness=6h `
  --limit 200 `
  --format=json

$logs = $raw | ConvertFrom-Json
$processed = $logs |
  Where-Object { $_.jsonPayload.msg -eq "Stripe webhook processed" } |
  Sort-Object timestamp

"count=$($processed.Count)"
$processed | ForEach-Object {
  "{0}`t{1}`t{2}" -f $_.timestamp, $_.jsonPayload.event_id, $_.jsonPayload.event_type
}
```

### b) Service-level recent processed webhook logs (last 24h, newest 5)

```powershell
$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"
gcloud config set project fabric-487608 | Out-Null

$filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api"'

$raw = gcloud logging read "$filter" `
  --project fabric-487608 `
  --freshness=24h `
  --limit 1000 `
  --format=json

$logs = $raw | ConvertFrom-Json
$logs |
  Where-Object { $_.jsonPayload.msg -eq "Stripe webhook processed" } |
  Sort-Object timestamp -Descending |
  Select-Object -First 5 |
  ForEach-Object {
    "{0}`t{1}`t{2}" -f $_.timestamp, $_.jsonPayload.event_id, $_.jsonPayload.event_type
  }
```
