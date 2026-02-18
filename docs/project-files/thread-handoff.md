# Thread Handoff

Last updated: 2026-02-18

## Repo and branches
- Repo: `fabric-api`
- Current branch: `feat/self-serve-recovery`
- Target branch: `main` (merge this branch after email recovery smoke is complete)

## Current snapshot
- Snapshot commands run:
  - `git status -sb` -> `## feat/self-serve-recovery...origin/feat/self-serve-recovery`
  - `git log -1 --oneline` -> `9728d93 mvp: self-serve api key recovery (pubkey+email otp)`
- Cloud Run service:
  - Service: `fabric-api`
  - Region: `us-west1`
  - URL: `https://fabric-api-393345198409.us-west1.run.app`
  - Active revision verified: `fabric-api-00046-vpx`

## What changed most recently
- Deployed `feat/self-serve-recovery` to Cloud Run revision `fabric-api-00046-vpx`.
- Verified service sanity:
  - `GET /v1/meta` -> 200
  - `GET /openapi.json` -> 200
  - `GET /v1/admin/diagnostics/stripe` -> 200 with `stripe_configured=true` and `missing=[]`
- Recovery DB schema patch was applied in Supabase (nodes recovery columns + recovery tables/indexes).
- Verified live pubkey recovery end-to-end:
  - `POST /v1/bootstrap` -> 200
  - `POST /v1/recovery/start` (`pubkey`) -> 200
  - `POST /v1/recovery/complete` -> 200
  - old key `GET /v1/me` -> 403 (`API key is revoked`)
  - new key `GET /v1/me` -> 200
- Verified email path entrypoint:
  - `POST /v1/email/start-verify` -> 200 (challenge created)
  - `POST /v1/recovery/start` (`email`) -> 422 until email is verified

## Current blocker
- Production email provider config is missing on Cloud Run.
- Missing env/secrets: `EMAIL_PROVIDER`, `EMAIL_FROM`, and either `SENDGRID_API_KEY` or SMTP vars.
- Result: email OTP delivery is not available in production, so full email recovery smoke is blocked.

## Exact next command sequence (PowerShell)
1) Baseline context:
   - `git switch feat/self-serve-recovery`
   - `git pull --ff-only`
   - `git status -sb`
   - `gcloud config set project fabric-487608`
   - `$PROJECT="fabric-487608"`
   - `$REGION="us-west1"`
   - `$BASE="https://fabric-api-393345198409.us-west1.run.app"`
2) Configure email provider on Cloud Run (choose one):
   - SendGrid:
     - `gcloud run services update fabric-api --project $PROJECT --region $REGION --update-env-vars EMAIL_PROVIDER=sendgrid,EMAIL_FROM=<from_email> --set-secrets SENDGRID_API_KEY=<sendgrid_secret_name>:latest`
   - SMTP:
     - `gcloud run services update fabric-api --project $PROJECT --region $REGION --update-env-vars EMAIL_PROVIDER=smtp,EMAIL_FROM=<from_email>,SMTP_HOST=<smtp_host>,SMTP_PORT=<smtp_port>,SMTP_USER=<smtp_user>,SMTP_SECURE=<true_or_false> --set-secrets SMTP_PASS=<smtp_pass_secret_name>:latest`
3) Confirm env wiring:
   - `gcloud run services describe fabric-api --project $PROJECT --region $REGION --format="get(spec.template.spec.containers[0].env[].name)"`
4) Run live email verify + email recovery smoke:
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
5) Pull key logs for verification evidence:
   - `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="fabric-api" AND resource.labels.location="us-west1" AND (httpRequest.requestUrl:"/v1/email/start-verify" OR httpRequest.requestUrl:"/v1/email/complete-verify" OR httpRequest.requestUrl:"/v1/recovery/start" OR httpRequest.requestUrl:"/v1/recovery/complete" OR httpRequest.requestUrl:"/v1/me")' --project $PROJECT --freshness=30m --limit 100 --order=desc --format='table(timestamp,httpRequest.status,httpRequest.requestMethod,httpRequest.requestUrl,resource.labels.revision_name)'`

## Carry-forward notes
- Non-blocking warning remains from GCP: project missing `environment` tag.
