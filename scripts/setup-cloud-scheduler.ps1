param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-west1",
  [string]$ServiceName = "fabric-api",
  [Parameter(Mandatory = $true)]
  [string]$AdminKey
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "[FAIL] gcloud CLI not found in PATH."
  exit 1
}

$ServiceUrl = gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)" 2>$null
if (-not $ServiceUrl) {
  Write-Host "[FAIL] Could not resolve Cloud Run service URL for '$ServiceName'. Is it deployed?"
  exit 1
}

Write-Host "[INFO] Service URL: $ServiceUrl"
Write-Host "[INFO] Setting up Cloud Scheduler jobs..."

# 1) Projection rebuild — every 30 min at :07 and :37 America/Los_Angeles
gcloud scheduler jobs create http fabric-projections-rebuild `
  --project $ProjectId `
  --location $Region `
  --schedule "7,37 * * * *" `
  --time-zone "America/Los_Angeles" `
  --http-method POST `
  --uri "$ServiceUrl/v1/admin/projections/rebuild?kind=all&mode=full" `
  --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
  --attempt-deadline 120s `
  --description "Rebuild public projections (drift correction)" `
  --quiet 2>$null

if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] Job 'fabric-projections-rebuild' may already exist. Updating..."
  gcloud scheduler jobs update http fabric-projections-rebuild `
    --project $ProjectId `
    --location $Region `
    --schedule "7,37 * * * *" `
    --time-zone "America/Los_Angeles" `
    --http-method POST `
    --uri "$ServiceUrl/v1/admin/projections/rebuild?kind=all&mode=full" `
    --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
    --attempt-deadline 120s `
    --description "Rebuild public projections (drift correction)" `
    --quiet
}
Write-Host "[OK] fabric-projections-rebuild"

# 2) Sweep (expire stale offers + requests) — every 5 minutes
gcloud scheduler jobs create http fabric-sweep `
  --project $ProjectId `
  --location $Region `
  --schedule "*/5 * * * *" `
  --time-zone "UTC" `
  --http-method POST `
  --uri "$ServiceUrl/internal/admin/sweep" `
  --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
  --attempt-deadline 60s `
  --description "Expire stale offers and requests" `
  --quiet 2>$null

if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] Job 'fabric-sweep' may already exist. Updating..."
  gcloud scheduler jobs update http fabric-sweep `
    --project $ProjectId `
    --location $Region `
    --schedule "*/5 * * * *" `
    --time-zone "UTC" `
    --http-method POST `
    --uri "$ServiceUrl/internal/admin/sweep" `
    --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
    --attempt-deadline 60s `
    --description "Expire stale offers and requests" `
    --quiet
}
Write-Host "[OK] fabric-sweep"

# 3) Retention — daily at 03:00 UTC (archive/delete old search logs)
gcloud scheduler jobs create http fabric-retention `
  --project $ProjectId `
  --location $Region `
  --schedule "0 3 * * *" `
  --time-zone "UTC" `
  --http-method POST `
  --uri "$ServiceUrl/internal/admin/retention" `
  --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
  --attempt-deadline 120s `
  --description "Search log retention: delete >1yr, archive >30d" `
  --quiet 2>$null

if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] Job 'fabric-retention' may already exist. Updating..."
  gcloud scheduler jobs update http fabric-retention `
    --project $ProjectId `
    --location $Region `
    --schedule "0 3 * * *" `
    --time-zone "UTC" `
    --http-method POST `
    --uri "$ServiceUrl/internal/admin/retention" `
    --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
    --attempt-deadline 120s `
    --description "Search log retention: delete >1yr, archive >30d" `
    --quiet
}
Write-Host "[OK] fabric-retention"

# 4) Daily digest — daily at 06:00 UTC (emits metrics to Cloud Logging + sends email if configured)
gcloud scheduler jobs create http fabric-daily-digest `
  --project $ProjectId `
  --location $Region `
  --schedule "0 6 * * *" `
  --time-zone "UTC" `
  --http-method POST `
  --uri "$ServiceUrl/internal/admin/daily-digest" `
  --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
  --attempt-deadline 120s `
  --description "Daily operational metrics digest (Cloud Logging + email)" `
  --quiet 2>$null

if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] Job 'fabric-daily-digest' may already exist. Updating..."
  gcloud scheduler jobs update http fabric-daily-digest `
    --project $ProjectId `
    --location $Region `
    --schedule "0 6 * * *" `
    --time-zone "UTC" `
    --http-method POST `
    --uri "$ServiceUrl/internal/admin/daily-digest" `
    --headers "X-Admin-Key=$AdminKey,Content-Type=application/json" `
    --attempt-deadline 120s `
    --description "Daily operational metrics digest (Cloud Logging + email)" `
    --quiet
}
Write-Host "[OK] fabric-daily-digest"

Write-Host ""
Write-Host "[DONE] All 4 Cloud Scheduler jobs configured."
Write-Host "  - fabric-projections-rebuild (every 30min at :07/:37 America/Los_Angeles)"
Write-Host "  - fabric-sweep (every 5min UTC)"
Write-Host "  - fabric-retention (daily 03:00 UTC)"
Write-Host "  - fabric-daily-digest (daily 06:00 UTC)"
