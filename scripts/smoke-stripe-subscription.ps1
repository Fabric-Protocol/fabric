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

function Read-ErrorResponseBody {
  param([Parameter(Mandatory = $true)]$ErrorRecord)

  if ($null -ne $ErrorRecord.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($ErrorRecord.ErrorDetails.Message)) {
    return $ErrorRecord.ErrorDetails.Message
  }

  if ($null -eq $ErrorRecord.Exception -or $null -eq $ErrorRecord.Exception.Response) {
    return ""
  }

  try {
    $stream = $ErrorRecord.Exception.Response.GetResponseStream()
    if ($null -eq $stream) { return "" }
    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } catch {
    return ""
  }
}

function Get-DotEnvMap {
  $map = @{}
  if (-not (Test-Path ".env")) { return $map }
  foreach ($line in Get-Content ".env") {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith("#")) { continue }
    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) { continue }
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (-not [string]::IsNullOrWhiteSpace($key)) {
      $map[$key] = $value
    }
  }
  return $map
}

function Get-ConfigValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][hashtable]$DotEnv
  )
  $fromEnv = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not [string]::IsNullOrWhiteSpace($fromEnv)) { return $fromEnv }
  $fromMachine = [Environment]::GetEnvironmentVariable($Name, "Machine")
  if (-not [string]::IsNullOrWhiteSpace($fromMachine)) { return $fromMachine }
  $fromUser = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not [string]::IsNullOrWhiteSpace($fromUser)) { return $fromUser }
  if ($DotEnv.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace($DotEnv[$Name])) { return $DotEnv[$Name] }
  return ""
}

function HasAnyConfigValue {
  param(
    [Parameter(Mandatory = $true)][string[]]$Names,
    [Parameter(Mandatory = $true)][hashtable]$DotEnv
  )
  foreach ($n in $Names) {
    if (-not [string]::IsNullOrWhiteSpace((Get-ConfigValue -Name $n -DotEnv $DotEnv))) {
      return $true
    }
  }
  return $false
}

function Get-PlanPriceVarCandidates {
  param([Parameter(Mandatory = $true)][string]$PlanCode)
  switch ($PlanCode.Trim().ToLowerInvariant()) {
    "basic" { return @("STRIPE_PRICE_BASIC", "STRIPE_PRICE_IDS_BASIC") }
    "plus" { return @("STRIPE_PRICE_PLUS", "STRIPE_PRICE_IDS_PLUS") }
    "pro" { return @("STRIPE_PRICE_PRO", "STRIPE_PRICE_IDS_PRO") }
    "business" { return @("STRIPE_PRICE_BUSINESS", "STRIPE_PRICE_IDS_BUSINESS") }
    default { return @() }
  }
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

if ($hostName -in @("localhost", "127.0.0.1") -and $BillingPath -eq "/v1/billing/checkout-session") {
  $dotEnv = Get-DotEnvMap
  $missing = @()

  if ([string]::IsNullOrWhiteSpace((Get-ConfigValue -Name "STRIPE_SECRET_KEY" -DotEnv $dotEnv))) {
    $missing += "STRIPE_SECRET_KEY"
  }

  $priceVarCandidates = Get-PlanPriceVarCandidates -PlanCode $PlanCode
  if ($priceVarCandidates.Count -eq 0) {
    Write-Host "[FAIL] Unsupported PlanCode '$PlanCode' for checkout-session smoke. Use basic|plus|pro|business."
    exit 1
  }
  if (-not (HasAnyConfigValue -Names $priceVarCandidates -DotEnv $dotEnv)) {
    $missing += ($priceVarCandidates -join " or ")
  }

  if ($missing.Count -gt 0) {
    Write-Host "[FAIL] Local Stripe config preflight failed."
    foreach ($item in $missing) {
      Write-Host "  - missing: $item"
    }
    Write-Host "[NEXT] Set these in .env (or environment), restart API, then re-run smoke."
    exit 1
  }
  Write-Host "[PASS] Local Stripe config preflight passed for plan_code=$PlanCode"
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
$billingIdempotencyKey = (New-IdempotencyKey)

Write-Host "[INFO] Billing URL=$billingUrl"
Write-Host "[INFO] Billing request payload:"
try {
  ($billingBody | ConvertFrom-Json) | ConvertTo-Json -Depth 20
} catch {
  Write-Host $billingBody
}

try {
  $checkout = Invoke-RestMethod -Uri $billingUrl -Method Post -Headers @{
    Authorization = "ApiKey $apiKey"
    "Idempotency-Key" = $billingIdempotencyKey
  } -ContentType "application/json" -Body $billingBody
  Write-Host "[PASS] Billing endpoint response:"
  $checkout | ConvertTo-Json -Depth 10
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $errorBody = Read-ErrorResponseBody -ErrorRecord $_
    Write-Host "[WARN] Billing endpoint call failed with HTTP $status"
    Write-Host "[INFO] Billing request idempotency-key=$billingIdempotencyKey"
    if (-not [string]::IsNullOrWhiteSpace($errorBody)) {
      Write-Host "[INFO] Billing error response body:"
      try {
        ($errorBody | ConvertFrom-Json) | ConvertTo-Json -Depth 20
      } catch {
        Write-Host $errorBody
      }
    } else {
      Write-Host "[INFO] Billing error response body is empty."
    }
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
