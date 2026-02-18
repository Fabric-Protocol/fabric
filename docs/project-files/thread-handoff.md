# Thread Handoff

Last updated: 2026-02-18

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current snapshot
- Snapshot commands run:
  - `git status -sb` -> `## main...origin/main`
  - `git log -1 --oneline` -> `0a75fef mvp: trial bridge + referral award + mcp wrapper + spec alignment`
- Cloud Run service:
  - Service: `fabric-api`
  - Region: `us-west1`
  - URL: `https://fabric-api-393345198409.us-west1.run.app`
  - Active revision after redeploy: `fabric-api-00044-tzz`

## What changed most recently
- Cloud Run redeployed from current source to remove old `plus` drift in runtime behavior.
- Stripe diagnostics verified clean:
  - `stripe_configured=true`
  - `missing=[]`
  - `price_id_counts_by_plan={basic:1,pro:1,business:1}`
- Live checkout-session smoke passed for all 6 paths:
  - subscriptions: `basic`, `pro`, `business`
  - topups: `credits_100`, `credits_300`, `credits_1000`
- Stripe live webhook endpoint was corrected to current Cloud Run URL:
  - `https://fabric-api-393345198409.us-west1.run.app/v1/webhooks/stripe`
- Real live checkout propagation confirmed in logs (all 2xx):
  - `customer.subscription.created`
  - `checkout.session.completed`
  - `invoice.paid`
- `/v1/me` confirmed for checkout node `a72d3d50-3f92-4517-8617-ac81dc138135`:
  - `node.is_subscriber=true`
  - `subscription.status=active`
  - `plan=pro`
  - `credits_balance=1700`

## Current blocker
- No go-live blocker for Stripe checkout/webhooks/subscriber entitlement.
- Current technical follow-up blocker: `/v1/me` sometimes shows `subscription.period_start == subscription.period_end` after webhook processing (needs mapping investigation).

## Exact next command sequence (PowerShell)
1) Baseline context:
   - `git switch main`
   - `git pull --ff-only`
   - `git status -sb`
   - `git log -5 --oneline`
2) Set vars:
   - `$PROJECT="fabric-487608"`
   - `$REGION="us-west1"`
   - `$BASE="https://fabric-api-393345198409.us-west1.run.app"`
   - `$ADMIN_KEY="<ADMIN_KEY>"`
   - `$NODE_ID="a72d3d50-3f92-4517-8617-ac81dc138135"`
3) Re-verify Stripe diagnostics and webhook HTTP status:
   - `curl.exe -sS -H "X-Admin-Key: $ADMIN_KEY" "$BASE/v1/admin/diagnostics/stripe"`
   - `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.location="us-west1" AND httpRequest.requestUrl:"/v1/webhooks/stripe"' --project $PROJECT --freshness=30m --limit 50 --order=desc --format='table(timestamp,httpRequest.status,httpRequest.requestUrl,resource.labels.revision_name)'`
4) Pull checkout-completion Stripe event chain from app logs:
   - `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.location="us-west1" AND jsonPayload.event_id:"evt_1T1yseK3gJAgZl81"' --project $PROJECT --freshness=2h --limit 30 --order=asc --format='table(timestamp,jsonPayload.msg,jsonPayload.event_id,jsonPayload.event_type,jsonPayload.node_id,jsonPayload.plan_code,jsonPayload.invoice_id,jsonPayload.signature_verified,resource.labels.revision_name)'`
5) Mint a fresh API key for the same node and verify `/v1/me`:
   - `$IDK="idem-admin-key-$(New-Guid)"`
   - `$BODY=@{label="period-debug"} | ConvertTo-Json -Compress`
   - `$NEWKEY=(Invoke-RestMethod "$BASE/v1/admin/nodes/$NODE_ID/api-keys" -Method Post -Headers @{ "X-Admin-Key"=$ADMIN_KEY; "Idempotency-Key"=$IDK; "Content-Type"="application/json" } -Body $BODY).api_key`
   - `Invoke-RestMethod "$BASE/v1/me" -Method Get -Headers @{ Authorization = "ApiKey $NEWKEY" } | ConvertTo-Json -Depth 20`
6) Compare Stripe invoice/subscription timestamps vs stored state (for period bug):
   - `$ENV_DUMP=gcloud run services describe fabric-api --region $REGION --format="value(spec.template.spec.containers[0].env)"`
   - `$LIVE_KEY=([regex]::Match($ENV_DUMP,"\\{'name': 'STRIPE_SECRET_KEY', 'value': '([^']+)'\\}")).Groups[1].Value`
   - `stripe events retrieve evt_1T1yseK3gJAgZl81BIYI38Ry --live --api-key $LIVE_KEY`
   - `stripe invoices retrieve in_1T1ysZK3gJAgZl81MX5pUc4w --live --api-key $LIVE_KEY`

## Carry-forward notes
- Optional:
  - publish MCP tool to registry (human account/verification required)
  - fix gcloud "environment tag" warning for project (non-blocking)
