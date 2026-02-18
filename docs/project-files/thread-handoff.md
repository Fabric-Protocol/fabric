# Thread Handoff

Last updated: 2026-02-18

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main` (recommended: do next work on feature branch, then merge back)

## Current snapshot
- Snapshot commands run:
  - `git status -sb` -> `## main...origin/main`
  - `git log -1 --oneline` -> `1f954c2 merge: feat/self-serve-recovery`
- Cloud Run service:
  - Service: `fabric-api`
  - Region: `us-west1`
  - URL: `https://fabric-api-2x2ettafia-uw.a.run.app`
  - Active revision after post-merge deploy: `fabric-api-00048-cx9`

## What just changed
- Fixed Stripe subscription period mapping bug (`period_start == period_end` issue) and added regression coverage.
- Finalized legal/support HTML pages in backend (`src/app.ts`) with non-placeholder content and clean encoding.
- Deployed feature branch, verified legal/support/docs routes return HTTP 200 without `PLACEHOLDER` and without mojibake.
- Merged `feat/self-serve-recovery` into `main` and redeployed from `main`.

## Current blocker
- No blocker for period fix or legal pages.
- Remaining go-live blocker: production email provider secrets for full email recovery smoke are not configured.
- Remaining implementation TODOs: holds ownership invariant enforcement and display-name uniqueness enforcement.

## Exact next command sequence (PowerShell)
1) Baseline + branch:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c feat/phase05-email-holds-uniqueness`
   - `git status -sb`
2) GCP context:
   - `gcloud config set project fabric-487608`
   - `$PROJECT="fabric-487608"`
   - `$REGION="us-west1"`
   - `$BASE=(gcloud run services describe fabric-api --region $REGION --project $PROJECT --format "value(status.url)")`
3) Configure production email provider (choose one):
   - SendGrid:
     - `gcloud run services update fabric-api --project $PROJECT --region $REGION --update-env-vars EMAIL_PROVIDER=sendgrid,EMAIL_FROM=<from_email> --set-secrets SENDGRID_API_KEY=<sendgrid_secret_name>:latest`
   - SMTP:
     - `gcloud run services update fabric-api --project $PROJECT --region $REGION --update-env-vars EMAIL_PROVIDER=smtp,EMAIL_FROM=<from_email>,SMTP_HOST=<smtp_host>,SMTP_PORT=<smtp_port>,SMTP_USER=<smtp_user>,SMTP_SECURE=<true_or_false> --set-secrets SMTP_PASS=<smtp_pass_secret_name>:latest`
4) Confirm env wiring:
   - `gcloud run services describe fabric-api --project $PROJECT --region $REGION --format="get(spec.template.spec.containers[0].env[].name)"`
5) Run live email recovery smoke:
   - `$META=Invoke-RestMethod "$BASE/v1/meta"`
   - `$EMAIL="<real_inbox_you_can_read>"`
   - `$BOOT_BODY=@{ display_name="email-smoke-$(Get-Date -Format yyyyMMddHHmmss)"; email=$EMAIL; referral_code=$null; recovery_public_key=$null; legal=@{ accepted=$true; version=$META.required_legal_version } } | ConvertTo-Json -Depth 6 -Compress`
   - `$BOOT=Invoke-RestMethod "$BASE/v1/bootstrap" -Method Post -Headers @{ "Idempotency-Key"="boot-email-$(New-Guid)"; "Content-Type"="application/json" } -Body $BOOT_BODY`
   - `$API_KEY_1=$BOOT.api_key.api_key`
   - `$NODE_ID=$BOOT.node.id`
   - `Invoke-RestMethod "$BASE/v1/email/start-verify" -Method Post -Headers @{ Authorization="ApiKey $API_KEY_1"; "Idempotency-Key"="email-start-$(New-Guid)"; "Content-Type"="application/json" } -Body (@{ email=$EMAIL } | ConvertTo-Json -Compress)`
   - `$CODE="<otp_from_email>"`
   - `Invoke-RestMethod "$BASE/v1/email/complete-verify" -Method Post -Headers @{ Authorization="ApiKey $API_KEY_1"; "Idempotency-Key"="email-complete-$(New-Guid)"; "Content-Type"="application/json" } -Body (@{ email=$EMAIL; code=$CODE } | ConvertTo-Json -Compress)`
   - `$REC_START=Invoke-RestMethod "$BASE/v1/recovery/start" -Method Post -Headers @{ "Idempotency-Key"="recovery-email-start-$(New-Guid)"; "Content-Type"="application/json" } -Body (@{ node_id=$NODE_ID; method="email" } | ConvertTo-Json -Compress)`
   - `$REC_COMPLETE=Invoke-RestMethod "$BASE/v1/recovery/complete" -Method Post -Headers @{ "Idempotency-Key"="recovery-email-complete-$(New-Guid)"; "Content-Type"="application/json" } -Body (@{ challenge_id=$REC_START.challenge_id; code=$CODE } | ConvertTo-Json -Compress)`
   - `$API_KEY_2=$REC_COMPLETE.api_key`
   - `try { Invoke-WebRequest "$BASE/v1/me" -Headers @{ Authorization="ApiKey $API_KEY_1" } -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }`
   - `Invoke-RestMethod "$BASE/v1/me" -Headers @{ Authorization="ApiKey $API_KEY_2" } | ConvertTo-Json -Depth 20`
6) Start remaining Phase 0.5 audits:
   - `rg -n "lock|hold|offer|unit_ids|owner|node_id|display_name|unique" src tests`
   - `npm test`

## Carry-forward notes
- Non-blocking GCP warning still appears: project lacks `environment` tag metadata.
