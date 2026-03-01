param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-west1",
  [string]$ServiceName = "fabric-api",
  [Parameter(Mandatory = $true)]
  [string]$AdminKey,
  [string]$SchedulerServiceAccount = "fabric-scheduler-sa@$ProjectId.iam.gserviceaccount.com"
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
Write-Host "[INFO] Scheduler SA: $SchedulerServiceAccount"
Write-Host "[INFO] Setting up Cloud Scheduler jobs with OIDC auth..."

# --- Ensure scheduler SA exists and has invoker permission ---
$saExists = gcloud iam service-accounts describe $SchedulerServiceAccount --project $ProjectId 2>$null
if (-not $saExists) {
  Write-Host "[INFO] Creating scheduler service account..."
  gcloud iam service-accounts create fabric-scheduler-sa `
    --project $ProjectId `
    --display-name "Fabric Scheduler Service Account" `
    --description "SA for Cloud Scheduler -> Cloud Run invocation"
  gcloud run services add-iam-policy-binding $ServiceName `
    --project $ProjectId `
    --region $Region `
    --member "serviceAccount:$SchedulerServiceAccount" `
    --role "roles/run.invoker" --quiet
  Write-Host "[OK] Scheduler SA created with Cloud Run invoker permission."
} else {
  Write-Host "[OK] Scheduler SA already exists."
}

# NOTE: The Admin Key is still sent in headers because the application requires it for admin route auth.
# However, with OIDC, the scheduler identity is also verified by Cloud Run IAM (defense in depth).
# The admin key value is stored in each job definition — consider migrating to a Secret Manager reference.

function New-OrUpdateSchedulerJob {
  param(
    [string]$JobName,
    [string]$Schedule,
    [string]$TimeZone,
    [string]$Uri,
    [int]$DeadlineSeconds,
    [string]$Description,
    [string]$MessageBody = $null
  )

  $commonArgs = @(
    "--project", $ProjectId,
    "--location", $Region,
    "--schedule", $Schedule,
    "--time-zone", $TimeZone,
    "--http-method", "POST",
    "--uri", $Uri,
    "--headers", "X-Admin-Key=$AdminKey,Content-Type=application/json",
    "--oidc-service-account-email", $SchedulerServiceAccount,
    "--oidc-token-audience", $ServiceUrl,
    "--attempt-deadline", "${DeadlineSeconds}s",
    "--description", $Description,
    "--quiet"
  )
  if ($MessageBody) {
    $commonArgs += @("--message-body", $MessageBody)
  }

  gcloud scheduler jobs create http $JobName @commonArgs 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARN] Job '$JobName' may already exist. Updating..."
    $updateArgs = $commonArgs.Clone()
    $headerIdx = [array]::IndexOf($updateArgs, "--headers")
    if ($headerIdx -ge 0) {
      $updateArgs[$headerIdx] = "--update-headers"
    }
    gcloud scheduler jobs update http $JobName @updateArgs
  }
  Write-Host "[OK] $JobName"
}

# 1) Projection rebuild — every 30 min at :07 and :37 America/Los_Angeles
New-OrUpdateSchedulerJob `
  -JobName "fabric-projections-rebuild" `
  -Schedule "7,37 * * * *" `
  -TimeZone "America/Los_Angeles" `
  -Uri "$ServiceUrl/v1/admin/projections/rebuild?kind=all&mode=full" `
  -DeadlineSeconds 120 `
  -Description "Rebuild public projections (drift correction)"

# 2) Sweep (expire stale offers + requests) — every 5 minutes
New-OrUpdateSchedulerJob `
  -JobName "fabric-sweep" `
  -Schedule "*/5 * * * *" `
  -TimeZone "UTC" `
  -Uri "$ServiceUrl/internal/admin/sweep" `
  -DeadlineSeconds 60 `
  -Description "Expire stale offers and requests"

# 3) Retention — daily at 03:00 UTC
New-OrUpdateSchedulerJob `
  -JobName "fabric-retention" `
  -Schedule "0 3 * * *" `
  -TimeZone "UTC" `
  -Uri "$ServiceUrl/internal/admin/retention" `
  -DeadlineSeconds 120 `
  -Description "Search log retention: delete >1yr, archive >30d"

# 4) Daily digest — daily at 06:00 UTC
New-OrUpdateSchedulerJob `
  -JobName "fabric-daily-digest" `
  -Schedule "0 6 * * *" `
  -TimeZone "UTC" `
  -Uri "$ServiceUrl/internal/admin/daily-digest" `
  -DeadlineSeconds 120 `
  -Description "Daily operational metrics digest (Cloud Logging + email)"

# 5) Health pulse — every 10 minutes
New-OrUpdateSchedulerJob `
  -JobName "fabric-health-pulse" `
  -Schedule "*/10 * * * *" `
  -TimeZone "UTC" `
  -Uri "$ServiceUrl/internal/admin/health-pulse" `
  -DeadlineSeconds 60 `
  -Description "Payment and webhook health check (alerts on degraded)" `
  -MessageBody "{}"

Write-Host ""
Write-Host "[DONE] All 5 Cloud Scheduler jobs configured with OIDC authentication."
Write-Host "  - fabric-projections-rebuild (every 30min at :07/:37 America/Los_Angeles)"
Write-Host "  - fabric-sweep (every 5min UTC)"
Write-Host "  - fabric-retention (daily 03:00 UTC)"
Write-Host "  - fabric-daily-digest (daily 06:00 UTC)"
Write-Host "  - fabric-health-pulse (every 10min UTC)"
Write-Host ""
Write-Host "[NOTE] Scheduler uses OIDC for Cloud Run invocation + X-Admin-Key for application-level auth."
Write-Host "       Consider storing the admin key in Secret Manager and referencing it instead of passing as a parameter."
