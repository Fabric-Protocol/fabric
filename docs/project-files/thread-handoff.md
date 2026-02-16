# Thread Handoff

Last updated: 2026-02-16

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Snapshot branch: `main`
- Snapshot last commit: `290cbff` (`db: enforce tls ca pinning via DATABASE_SSL_CA`)
- Snapshot working tree: not clean
  - Modified: `docs/prod-runbook.md`

## What just changed
- Stripe webhook crash instrumentation was added and deployed earlier:
  - global unhandled error stack logging
  - webhook-specific crash logging (`stripe webhook handler failed`)
- DB env/pool diagnostics were added:
  - startup + webhook `db env check`
  - `pg pool config` target logging (safe fields only)
- Durable production DB TLS fix was implemented and deployed:
  - `DATABASE_SSL_CA` added to runtime config
  - pg pool now uses explicit strict TLS (`rejectUnauthorized: true`)
  - SSL query params are stripped from `DATABASE_URL` before Pool config
  - Cloud Run wired to Secret Manager secret `DATABASE_SSL_CA`
- Result confirmed in-thread:
  - Webhook deliveries moved from 500 to 200
  - `SELF_SIGNED_CERT_IN_CHAIN` no longer appears in latest revision logs
  - Latest ready revision observed: `fabric-api-00024-wkk`

## Current blocker
- Final business-level validation is still pending:
  - confirm mapped paid Stripe events drive expected subscription/credits state in API responses (`GET /v1/me`) end-to-end.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `git status --short`
4. `npm test`
5. `$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"`
6. `gcloud config set project fabric-487608`
7. `gcloud run services describe fabric-api --region us-west1 --format="value(status.latestReadyRevisionName,status.url)"`
8. `# In Stripe dashboard: resend one recent paid-event webhook to /v1/webhooks/stripe`
9. `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND jsonPayload.msg="Stripe webhook processed"' --project fabric-487608 --limit 50 --freshness=1h --format='value(timestamp,jsonPayload.event_id,jsonPayload.event_type)'`
10. `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND (jsonPayload.err.message:"SELF_SIGNED_CERT_IN_CHAIN" OR jsonPayload.msg="stripe webhook handler failed")' --project fabric-487608 --limit 50 --freshness=1h --format='value(timestamp,jsonPayload.msg,jsonPayload.err.message)'`
11. `$URL="https://fabric-api-393345198409.us-west1.run.app"; $idem=[guid]::NewGuid().ToString(); $body=@{display_name="PostTLS Verify";email=$null;referral_code=$null}|ConvertTo-Json; $b=Invoke-RestMethod "$URL/v1/bootstrap" -Method Post -Headers @{ "Idempotency-Key"=$idem } -ContentType "application/json" -Body $body; $apiKey=$b.api_key; Invoke-RestMethod "$URL/v1/me" -Method Get -Headers @{ Authorization="ApiKey $apiKey" } | ConvertTo-Json -Depth 10`
12. `# Compare /v1/me subscription + credits with expected Stripe event outcomes`

## Handoff objective for next thread
- Close out end-to-end production billing verification: prove webhook processing, node mapping, and resulting subscription/credits API state are consistent for live mapped paid events.
