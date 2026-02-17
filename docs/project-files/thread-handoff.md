# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current snapshot
- Snapshot commands run:
  - `git branch --show-current` -> `main`
  - `git log -1 --oneline` -> `f155980 billing: remove plus plan; align stripe diagnostics + tests`
  - `git status --short` -> clean at snapshot capture
- Latest code state from thread notes:
  - Suspension enforcement is implemented end-to-end and tested.
  - Agent discovery/docs/legal-support routes are implemented.
  - Stripe diagnostics endpoint exists: `GET /v1/admin/diagnostics/stripe`.
  - Canonical plans are now `free|basic|pro|business`; legacy `plus` removed.

## What changed most recently
- Project files were synchronized from `docs/project-files/thread-notes.md`.
- TODO now reflects current live blocker:
  - Cloud Run still needs supported live Stripe price env vars wired.
  - Live diagnostics/smoke must be re-run after env update.
- Decision log now records:
  - canonical plan surface excludes `plus`
  - suspension enforcement boundary is runtime (auth + publish + public/search)

## Current blocker
- Human/ops blocker (Cloud Run config): supported live Stripe SKU env vars must be set in Cloud Run.
- Human action blocker (checkout completion): live checkout URLs must be opened/completed in browser to validate subscription activation.

## Exact next command sequence (PowerShell)
1) Baseline + context:
   - `git switch main`
   - `git pull --ff-only`
   - `git status -sb`
   - `git log -5 --oneline`
2) Set deployment vars:
   - `$PROJECT="fabric-487608"`
   - `$REGION="us-west1"`
   - `$SERVICE="fabric-api"`
   - `$BASE="https://fabric-api-393345198409.us-west1.run.app"`
   - `$ADMIN_KEY="<ADMIN_KEY>"`
3) Set live Stripe price env vars on Cloud Run:
   - `gcloud run services update $SERVICE --project $PROJECT --region $REGION --update-env-vars STRIPE_PRICE_IDS_BASIC=price_1T1tO2K3gJAgZl81QzBXfPIf,STRIPE_PRICE_IDS_PRO=price_1T1wL1K3gJAgZl81IYKvjCsD,STRIPE_PRICE_IDS_BUSINESS=price_1T1wLgK3gJAgZl81450PfCc3,STRIPE_TOPUP_PRICE_100=price_1T1wMGK3gJAgZl817t4OWdnM,STRIPE_TOPUP_PRICE_300=price_1T1wMbK3gJAgZl81uWQJtoqH,STRIPE_TOPUP_PRICE_1000=price_1T1wNBK3gJAgZl81ixDfggz3`
4) Verify Stripe diagnostics (must show configured true):
   - `curl.exe -sS -H "X-Admin-Key: $ADMIN_KEY" "$BASE/v1/admin/diagnostics/stripe"`
5) Run live subscription smoke per supported plan:
   - `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "$BASE" -PlanCode "basic"`
   - `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "$BASE" -PlanCode "pro"`
   - `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "$BASE" -PlanCode "business"`
6) Human-only action for each returned checkout:
   - Open each returned `checkout_url` and complete checkout in Stripe.
7) Verify subscriber state:
   - `Invoke-RestMethod "$BASE/v1/me" -Method Get -Headers @{ Authorization = "ApiKey <LIVE_NODE_API_KEY>" } | ConvertTo-Json -Depth 20`
8) Run live top-up checkout smoke (repeat for 100/300/1000):
   - `$NODE_ID="<LIVE_NODE_ID>"`
   - `$NODE_API_KEY="<LIVE_NODE_API_KEY>"`
   - `$IDK="smoke-topup-100-$(Get-Date -Format yyyyMMddHHmmss)"`
   - `$BODY = @{ node_id=$NODE_ID; pack_code="credits_100"; success_url="$BASE/docs/agents?checkout=success-live"; cancel_url="$BASE/docs/agents?checkout=cancel-live" } | ConvertTo-Json`
   - `Invoke-RestMethod "$BASE/v1/billing/topups/checkout-session" -Method Post -Headers @{ Authorization = "ApiKey $NODE_API_KEY"; "Idempotency-Key" = $IDK; "Content-Type" = "application/json" } -Body $BODY | ConvertTo-Json -Depth 20`
   - Human completes returned `checkout_url`; then verify `/v1/me` again.

## Carry-forward notes
- Deferred:
  - Fix Cursor terminal `gcloud` PATH/tooling parity.
  - Investigate occasional `/v1/me` `period_start == period_end` observation.
