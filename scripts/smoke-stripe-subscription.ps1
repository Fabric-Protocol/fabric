param(
  [string]$BaseUrl,
  [string]$BillingPath = "/v1/billing/checkout-session",
  [string]$PlanCode = "basic",
  [string]$SuccessUrl = "https://example.com/success",
  [string]$CancelUrl = "https://example.com/cancel"
)

$ErrorActionPreference = "Stop"

function New-IdempotencyKey {
  return [guid]::NewGuid().ToString()
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  if (-not [string]::IsNullOrWhiteSpace($env:FABRIC_BASE_URL)) {
    $BaseUrl = $env:FABRIC_BASE_URL
  } else {
    $BaseUrl = "http://localhost:8080"
  }
}

$BaseUrl = $BaseUrl.Trim().TrimEnd('/')
Write-Host "[INFO] BaseUrl=$BaseUrl"

try {
  $baseUri = [Uri]$BaseUrl
} catch {
  Write-Host "[FAIL] BaseUrl is not a valid URI: $BaseUrl"
  exit 1
}

$hostName = $baseUri.Host
$port = if ($baseUri.IsDefaultPort) {
  if ($baseUri.Scheme -eq "https") { 443 } else { 80 }
} else {
  $baseUri.Port
}

Write-Host "[STEP] Connectivity preflight..."
if ($baseUri.Scheme -eq "https") {
  try {
    Resolve-DnsName -Name $hostName -ErrorAction Stop | Out-Null
    Write-Host "[PASS] DNS resolved for $hostName"
  } catch {
    Write-Host "[FAIL] DNS resolution failed for $hostName"
    Write-Host "[NEXT] Verify BaseUrl and DNS records."
    exit 1
  }

  $tcp = Test-NetConnection -ComputerName $hostName -Port $port -WarningAction SilentlyContinue
  if (-not $tcp.TcpTestSucceeded) {
    Write-Host "[FAIL] TCP connectivity failed to $hostName`:$port"
    Write-Host "[NEXT] Verify network egress/firewall and service availability."
    exit 1
  }
  Write-Host "[PASS] TCP connectivity OK to $hostName`:$port"
} elseif ($hostName -in @("localhost", "127.0.0.1")) {
  $listening = netstat -ano | findstr ":$port"
  if (-not $listening) {
    Write-Host "[FAIL] No listener found on localhost:$port"
    if (Test-Path ".env") {
      $portLine = Select-String -Path ".env" -Pattern "^PORT=" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($portLine) {
        $envPort = ($portLine.Line -split "=", 2)[1]
        if (-not [string]::IsNullOrWhiteSpace($envPort) -and [string]$envPort -ne [string]$port) {
          Write-Host "[HINT] .env sets PORT=$envPort. Try: .\\scripts\\smoke-stripe-subscription.ps1 -BaseUrl http://localhost:$envPort"
        }
      }
    }
    Write-Host "[NEXT] Start API first (example: npm run start), or pass -BaseUrl explicitly."
    exit 1
  }
  Write-Host "[PASS] Listener detected on localhost:$port"
}

Write-Host "[STEP] Bootstrap node..."
try {
  $meta = Invoke-RestMethod -Uri "$BaseUrl/v1/meta" -Method Get -TimeoutSec 30
} catch {
  Write-Host "[WARN] GET $BaseUrl/v1/meta failed: $($_.Exception.Message)"
  if ($baseUri.Scheme -eq "https") {
    Write-Host "[INFO] Retrying /v1/meta with TLS 1.2..."
    try {
      $meta = Invoke-RestMethod -Uri "$BaseUrl/v1/meta" -Method Get -SslProtocol Tls12 -TimeoutSec 30 -Verbose
    } catch {
      Write-Host "[FAIL] /v1/meta failed after TLS 1.2 retry."
      Write-Host "[NEXT] Verify endpoint health and TLS configuration."
      exit 1
    }
  } else {
    Write-Host "[FAIL] /v1/meta unreachable."
    exit 1
  }
}
$requiredLegalVersion = $meta.required_legal_version

$bootstrapBody = @{
  display_name = "Stripe Smoke"
  email = $null
  referral_code = $null
  legal = @{
    accepted = $true
    version = $requiredLegalVersion
  }
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
