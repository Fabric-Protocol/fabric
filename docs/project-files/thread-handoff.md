# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Last commit: `a3bad2d` (`billing: add checkout-session endpoint + e2e smoke; guard non-entitlement webhooks`)
- Working tree: clean (`git status --short` empty)

## What just changed
- Net-new paid onboarding was validated end-to-end on Cloud Run:
  - `POST /v1/billing/checkout-session` -> Stripe Checkout -> webhook `checkout.session.completed` -> `/v1/me` paid state (`subscription.status=active`, `subscription.plan=plus`, `credits_balance=1700`).
- Non-entitlement Stripe event behavior was validated:
  - `customer.created` processed without mutating subscription/credits.
- Billing endpoint, tests, and docs updates were committed and pushed to `main` at `a3bad2d`.
- Runbook now explicitly notes Cloud Run invoke access requirement for smoke/bootstrap.

## Current blocker
- No active blocker.
- Only unavoidable manual action in future smoke runs: Stripe checkout completion in browser.

## Operator preferences captured from thread-notes
- Command response format: immediate next commands first; then short follow-up.
- Responsibility split: Codex does all executable local/CLI work; user only handles unavoidable UI/credential actions.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `git status --short`
4. `npm test`
5. `$env:PATH="C:\Users\trade\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"`
6. `gcloud config set project fabric-487608 | Out-Null`
7. `gcloud run services describe fabric-api --region us-west1 --format="value(status.latestReadyRevisionName,status.url)"`
8. `gcloud run services add-iam-policy-binding fabric-api --region us-west1 --member="allUsers" --role="roles/run.invoker"`
9. `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "https://fabric-api-393345198409.us-west1.run.app" -BillingPath "/v1/billing/checkout-session" -PlanCode "plus"`
10. `# User step: open returned checkout_url and complete Stripe test checkout (Stripe Link code: 000000 if prompted).`
11. `$filter='resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api"'; $raw=gcloud logging read "$filter" --project fabric-487608 --freshness=6h --limit 500 --format=json; $logs=$raw | ConvertFrom-Json; $logs | Where-Object { $_.jsonPayload.msg -eq "Stripe webhook processed" } | Sort-Object timestamp -Descending | Select-Object -First 10 | ForEach-Object { "{0}`t{1}`t{2}" -f $_.timestamp, $_.jsonPayload.event_id, $_.jsonPayload.event_type }`

## Handoff objective for next thread
- Re-run paid onboarding smoke on demand and confirm webhook processing plus paid `/v1/me` state remain stable.
