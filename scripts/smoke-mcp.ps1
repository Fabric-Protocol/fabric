param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,
  [Parameter(Mandatory = $true)]
  [string]$ApiKey
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Write-Step {
  param([string]$Msg)
  Write-Host "`n--- $Msg ---" -ForegroundColor Cyan
}

function Write-Pass {
  param([string]$Msg)
  Write-Host "[PASS] $Msg" -ForegroundColor Green
}

function Write-Fail {
  param([string]$Msg)
  Write-Host "[FAIL] $Msg" -ForegroundColor Red
}

function Invoke-McpPost {
  param([string]$Url, [hashtable]$Body, [string]$ApiKey)
  $json = $Body | ConvertTo-Json -Depth 10 -Compress
  $response = Invoke-RestMethod -Uri $Url -Method POST `
    -Headers @{ Authorization = "ApiKey $ApiKey"; "Content-Type" = "application/json" } `
    -Body $json
  return $response
}

$failures = 0

# -----------------------------------------------------------------------
# Step 1: GET /v1/meta - confirm mcp_url is present and points to /mcp
# -----------------------------------------------------------------------
Write-Step "GET /v1/meta - confirm mcp_url"
try {
  $meta = Invoke-RestMethod -Uri "$BaseUrl/v1/meta" -Method GET
  if (-not $meta.mcp_url) {
    Write-Fail "mcp_url missing from /v1/meta response"
    $failures++
  } else {
    Write-Pass "mcp_url = $($meta.mcp_url)"
    if ($meta.mcp_url -notmatch '/mcp$') {
      Write-Fail "mcp_url does not end with /mcp: $($meta.mcp_url)"
      $failures++
    } else {
      Write-Pass "mcp_url format OK"
    }
  }
  $mcpUrl = if ($meta.mcp_url) { $meta.mcp_url } else { "$BaseUrl/mcp" }
} catch {
  Write-Fail "GET /v1/meta failed: $_"
  $failures++
  $mcpUrl = "$BaseUrl/mcp"
}

# -----------------------------------------------------------------------
# Step 2: POST /mcp initialize
# -----------------------------------------------------------------------
Write-Step "POST $mcpUrl - initialize"
try {
  $initResult = Invoke-McpPost -Url $mcpUrl -Body @{
    jsonrpc = "2.0"
    id      = 1
    method  = "initialize"
  } -ApiKey $ApiKey

  if ($initResult.jsonrpc -ne "2.0") {
    Write-Fail "initialize: expected jsonrpc=2.0, got $($initResult.jsonrpc)"
    $failures++
  } elseif (-not $initResult.result.serverInfo) {
    Write-Fail "initialize: missing serverInfo in result"
    $failures++
  } else {
    Write-Pass "initialize OK - server=$($initResult.result.serverInfo.name) protocol=$($initResult.result.protocolVersion)"
  }
} catch {
  Write-Fail "initialize failed: $_"
  $failures++
}

# -----------------------------------------------------------------------
# Step 3: POST /mcp tools/list - confirm allowlist
# -----------------------------------------------------------------------
Write-Step "POST $mcpUrl - tools/list"
$expectedTools = @(
  "fabric_search_listings",
  "fabric_search_requests",
  "fabric_get_unit",
  "fabric_get_request",
  "fabric_get_offer",
  "fabric_get_events",
  "fabric_get_credits"
)
try {
  $listResult = Invoke-McpPost -Url $mcpUrl -Body @{
    jsonrpc = "2.0"
    id      = 2
    method  = "tools/list"
  } -ApiKey $ApiKey

  $toolNames = $listResult.result.tools | ForEach-Object { $_.name }
  Write-Pass "tools/list returned $($toolNames.Count) tool(s): $($toolNames -join ', ')"

  foreach ($expected in $expectedTools) {
    if ($toolNames -notcontains $expected) {
      Write-Fail "tools/list missing expected tool: $expected"
      $failures++
    }
  }
  if ($failures -eq 0) {
    Write-Pass "All 7 expected tools present"
  }
} catch {
  Write-Fail "tools/list failed: $_"
  $failures++
}

# -----------------------------------------------------------------------
# Step 4: POST /mcp fabric_get_credits - happy path
# -----------------------------------------------------------------------
Write-Step "POST $mcpUrl - tools/call fabric_get_credits"
try {
  $creditsResult = Invoke-McpPost -Url $mcpUrl -Body @{
    jsonrpc = "2.0"
    id      = 3
    method  = "tools/call"
    params  = @{
      name      = "fabric_get_credits"
      arguments = @{}
    }
  } -ApiKey $ApiKey

  if ($creditsResult.result.isError -eq $true) {
    $errText = $creditsResult.result.content[0].text
    Write-Fail "fabric_get_credits returned isError=true: $errText"
    $failures++
  } else {
    $data = $creditsResult.result.content[0].text | ConvertFrom-Json
    if ($null -eq $data.credits_balance) {
      Write-Fail "fabric_get_credits: credits_balance missing in response"
      $failures++
    } else {
      Write-Pass "fabric_get_credits OK - credits_balance=$($data.credits_balance)"
    }
  }
} catch {
  Write-Fail "fabric_get_credits failed: $_"
  $failures++
}

# -----------------------------------------------------------------------
# Step 5: POST /mcp - unknown tool rejected
# -----------------------------------------------------------------------
Write-Step "POST $mcpUrl - unknown tool rejected"
try {
  $rejectResult = Invoke-McpPost -Url $mcpUrl -Body @{
    jsonrpc = "2.0"
    id      = 4
    method  = "tools/call"
    params  = @{
      name      = "fabric_nuke_everything"
      arguments = @{}
    }
  } -ApiKey $ApiKey

  if ($rejectResult.result.isError -ne $true) {
    Write-Fail "unknown tool should return isError=true"
    $failures++
  } else {
    $errData = $rejectResult.result.content[0].text | ConvertFrom-Json
    if ($errData.error -ne "unknown_tool") {
      Write-Fail "unknown tool error code unexpected: $($errData.error)"
      $failures++
    } else {
      Write-Pass "unknown tool correctly rejected with error=unknown_tool"
    }
  }
} catch {
  Write-Fail "unknown tool check failed: $_"
  $failures++
}

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
Write-Host ""
if ($failures -eq 0) {
  Write-Host "=== MCP SMOKE: ALL CHECKS PASSED ===" -ForegroundColor Green
  exit 0
} else {
  Write-Host "=== MCP SMOKE: $failures CHECK(S) FAILED ===" -ForegroundColor Red
  exit 1
}

