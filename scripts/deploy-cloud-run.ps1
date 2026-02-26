param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,
  [string]$Region = "us-west1",
  [string]$ServiceName = "fabric-api",
  [string]$ImageName
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

gcloud config set project $ProjectId
gcloud builds submit --project $ProjectId --tag $ImageName
gcloud run deploy $ServiceName --project $ProjectId --image $ImageName --region $Region --platform managed --no-allow-unauthenticated --max-instances=1 --min-instances=1

$setEnvCommand = "gcloud run services update $ServiceName --project $ProjectId --region $Region --set-env-vars `"DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres,ADMIN_KEY=[ADMIN_KEY],STRIPE_SECRET_KEY=[STRIPE_SECRET_KEY],STRIPE_WEBHOOK_SECRET=[STRIPE_WEBHOOK_SECRET]`""

Write-Host ""
Write-Host "[NEXT] Set required env vars with this command:"
Write-Host $setEnvCommand
