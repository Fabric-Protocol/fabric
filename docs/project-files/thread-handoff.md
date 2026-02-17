# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Snapshot branch: `main`
- Snapshot at sync start:
  - Last commit: `020e4b5` (`billing: map Stripe price to plus; fix monthly grant dedupe; admin key support`)
  - Working tree: clean
- Latest production-facing docs commit in this thread:
  - `963193c` (`docs: add PowerShell-safe gcloud logging queries`)

## What just changed
- Production webhook + billing path was stabilized and verified:
  - Stripe webhook deliveries return 200 with signature verification passing.
  - Supabase TLS trust is fixed via `DATABASE_SSL_CA` + strict TLS verification.
  - `invoice.paid` now resolves plan from Stripe price IDs and maps expected $19.99 price to paid plan semantics (`plus` response behavior).
  - Monthly credit grant dedupe now ignores historical zero-amount grant rows.
- Admin API key mint endpoint is available for existing nodes:
  - `POST /v1/admin/nodes/:nodeId/api-keys` (admin auth via `X-Admin-Key`).
- Verified paid-node state after resend:
  - Node `84c3d128-ff65-4fdd-b2f7-0f4ccb7c23d3`
  - `/v1/me` => `subscription.plan=plus`, `subscription.status=active`, `credits_balance=1700`
  - Re-resend idempotency check kept state unchanged.
- Cloud Run latest observed:
  - Revision: `fabric-api-00032-245`
  - Service URL (`gcloud`): `https://fabric-api-2x2ettafia-uw.a.run.app`
  - Canonical URL used in tests: `https://fabric-api-393345198409.us-west1.run.app`

## Current blocker
- No active production incident blocker.
- Remaining validation gap:
  - Full net-new flow still untested end-to-end: new node -> checkout/payment start -> Stripe customer/subscription linkage -> webhook mapping -> final `/v1/me` paid state.
  - Nice-to-have: resend a non-entitlement event (for example `customer.created`) and confirm no subscription/credits mutation.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `git status --short`
4. `npm test`
5. `$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"`
6. `gcloud config set project fabric-487608 | Out-Null`
7. `gcloud run services describe fabric-api --region us-west1 --format="value(status.latestReadyRevisionName,status.url)"`
8. `$eventId="evt_1T1Qr9K3gJAgZl81iD1oE6Nz"; $filter='resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND jsonPayload.event_id="' + $eventId + '"'; $raw=gcloud logging read "$filter" --project fabric-487608 --freshness=6h --limit 200 --format=json; $logs=$raw | ConvertFrom-Json; $logs | Where-Object { $_.jsonPayload.msg -eq "Stripe webhook processed" } | Sort-Object timestamp | ForEach-Object { "{0}`t{1}`t{2}" -f $_.timestamp, $_.jsonPayload.event_id, $_.jsonPayload.event_type }`
9. `# Execute net-new paid flow: bootstrap a new node, run checkout/payment path, complete payment in Stripe test mode`
10. `$filter='resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api"'; $raw=gcloud logging read "$filter" --project fabric-487608 --freshness=24h --limit 1000 --format=json; $logs=$raw | ConvertFrom-Json; $logs | Where-Object { $_.jsonPayload.msg -eq "Stripe webhook processed" } | Sort-Object timestamp -Descending | Select-Object -First 10 | ForEach-Object { "{0}`t{1}`t{2}" -f $_.timestamp, $_.jsonPayload.event_id, $_.jsonPayload.event_type }`
11. `$admin=(Select-String -Path .env -Pattern '^\\s*ADMIN_KEY\\s*=' | Select-Object -First 1).Line -replace '^\\s*ADMIN_KEY\\s*=\\s*',''; $nodeId="<NEW_NODE_ID>"; $idem=[guid]::NewGuid().ToString(); $mint=Invoke-RestMethod "https://fabric-api-393345198409.us-west1.run.app/v1/admin/nodes/$nodeId/api-keys" -Method Post -Headers @{ "X-Admin-Key"=$admin; "Idempotency-Key"=$idem } -ContentType "application/json" -Body (@{label="e2e-verify"}|ConvertTo-Json); $me=Invoke-RestMethod "https://fabric-api-393345198409.us-west1.run.app/v1/me" -Method Get -Headers @{ Authorization="ApiKey $($mint.api_key)" }; $me | ConvertTo-Json -Depth 10`

## Handoff objective for next thread
- Validate the first-time paid-node onboarding path end-to-end and confirm no regressions in webhook idempotency or non-entitlement event handling.
