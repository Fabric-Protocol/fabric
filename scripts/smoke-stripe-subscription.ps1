param(
  [string]$BaseUrl = "http://localhost:8080",
  [string]$BillingPath = "/v1/billing/checkout-session",
  [string]$PlanCode = "basic",
  [string]$SuccessUrl = "https://example.com/success",
  [string]$CancelUrl = "https://example.com/cancel"
)

$ErrorActionPreference = "Stop"

function New-IdempotencyKey {
  return [guid]::NewGuid().ToString()
}

Write-Host "[STEP] Bootstrap node..."
$bootstrapBody = @{
  display_name = "Stripe Smoke"
  email = $null
  referral_code = $null
} | ConvertTo-Json -Compress

$bootstrap = Invoke-RestMethod -Uri "$BaseUrl/v1/bootstrap" -Method Post -Headers @{ "Idempotency-Key" = (New-IdempotencyKey) } -ContentType "application/json" -Body $bootstrapBody
$nodeId = $bootstrap.node.id
$apiKey = $bootstrap.api_key.api_key

Write-Host "[INFO] node_id=$nodeId"
Write-Host "[STEP] Create checkout session via billing endpoint..."

$billingBody = @{
  node_id = $nodeId
  plan_code = $PlanCode
  success_url = $SuccessUrl
  cancel_url = $CancelUrl
} | ConvertTo-Json -Compress

$billingUrl = "$BaseUrl$BillingPath"
$checkout = $null

try {
  $checkout = Invoke-RestMethod -Uri $billingUrl -Method Post -Headers @{
    Authorization = "ApiKey $apiKey"
    "Idempotency-Key" = (New-IdempotencyKey)
  } -ContentType "application/json" -Body $billingBody
  Write-Host "[PASS] Billing endpoint response:"
  $checkout | ConvertTo-Json -Depth 10
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errorBody = $reader.ReadToEnd()
    Write-Host "[WARN] Billing endpoint call failed with HTTP $status"
    Write-Host $errorBody
    if ($status -eq 404) {
      Write-Host "[WARN] No billing checkout endpoint is currently exposed by this API contract."
      Write-Host "[NEXT] Complete Stripe test checkout externally with metadata.node_id=$nodeId and metadata.plan_code=$PlanCode, then continue."
    } else {
      Write-Host "[FAIL] Cannot continue automated smoke flow."
      exit 1
    }
  } else {
    Write-Host "[FAIL] Billing endpoint call failed."
    Write-Host $_.Exception.Message
    exit 1
  }
}

Write-Host "[STEP] Complete test payment in Stripe, then press Enter to verify /v1/me ..."
Read-Host | Out-Null

$me = Invoke-RestMethod -Uri "$BaseUrl/v1/me" -Method Get -Headers @{ Authorization = "ApiKey $apiKey" }
Write-Host "[RESULT] /v1/me:"
$me | ConvertTo-Json -Depth 10

if ($me.subscription.status -eq "active") {
  Write-Host "[PASS] Subscription is active for node $nodeId."
  exit 0
}

Write-Host "[WARN] Subscription is not active yet (status=$($me.subscription.status))."
exit 1
