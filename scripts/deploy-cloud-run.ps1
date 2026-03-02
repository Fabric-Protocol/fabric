param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-west1",
  [string]$ServiceName = "fabric-api",
  [string]$ImageName,
  [string]$ServiceAccount = "fabric-api-sa@$ProjectId.iam.gserviceaccount.com"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ImageName)) {
  $ImageName = "gcr.io/$ProjectId/fabric-api"
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "[FAIL] gcloud CLI not found in PATH."
  exit 1
}

Write-Host "[INFO] Project: $ProjectId"
Write-Host "[INFO] Region: $Region"
Write-Host "[INFO] Service: $ServiceName"
Write-Host "[INFO] Image: $ImageName"
Write-Host "[INFO] Service Account: $ServiceAccount"

# --- Step 1: Ensure dedicated service account exists ---
$saExists = gcloud iam service-accounts describe $ServiceAccount --project $ProjectId 2>$null
if (-not $saExists) {
  Write-Host "[INFO] Creating dedicated service account..."
  gcloud iam service-accounts create fabric-api-sa `
    --project $ProjectId `
    --display-name "Fabric API Service Account" `
    --description "Least-privilege SA for Fabric API Cloud Run service"
  gcloud projects add-iam-policy-binding $ProjectId `
    --member "serviceAccount:$ServiceAccount" `
    --role "roles/secretmanager.secretAccessor" --quiet
  Write-Host "[OK] Service account created and granted Secret Manager access."
} else {
  Write-Host "[OK] Service account already exists."
}

# --- Step 2: Build and deploy ---
gcloud builds submit --project $ProjectId --tag $ImageName
gcloud run deploy $ServiceName `
  --project $ProjectId `
  --image $ImageName `
  --region $Region `
  --platform managed `
  --allow-unauthenticated `
  --max-instances=1 `
  --min-instances=1 `
  --service-account $ServiceAccount `
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,DATABASE_SSL_CA=DATABASE_SSL_CA:latest,ADMIN_KEY=ADMIN_KEY:latest,STRIPE_SECRET_KEY=STRIPE_SECRET_KEY:latest,STRIPE_WEBHOOK_SECRET=STRIPE_WEBHOOK_SECRET:latest,NOWPAYMENTS_API_KEY=NOWPAYMENTS_API_KEY:latest,NOWPAYMENTS_IPN_SECRET=NOWPAYMENTS_IPN_SECRET:latest"

Write-Host ""
Write-Host "[INFO] Secrets are loaded from GCP Secret Manager. Ensure these secrets exist:"
Write-Host "  - DATABASE_URL"
Write-Host "  - DATABASE_SSL_CA"
Write-Host "  - ADMIN_KEY"
Write-Host "  - STRIPE_SECRET_KEY"
Write-Host "  - STRIPE_WEBHOOK_SECRET"
Write-Host "  - NOWPAYMENTS_API_KEY"
Write-Host "  - NOWPAYMENTS_IPN_SECRET"
Write-Host ""
Write-Host "[NEXT] Set remaining non-secret env vars (email config, rate limits, etc.) via:"
Write-Host "  gcloud run services update $ServiceName --project $ProjectId --region $Region --set-env-vars `"NODE_ENV=production,BASE_URL=https://YOUR_DOMAIN,...`""
