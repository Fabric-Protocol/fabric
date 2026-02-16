param(
  [string]$Url = "http://localhost:8080/v1/webhooks/stripe",
  [string]$Secret = $env:STRIPE_WEBHOOK_SECRET,
  [string]$NodeId = "node_test"
)

if ([string]::IsNullOrWhiteSpace($Secret)) {
  Write-Host "[FAIL] Provide -Secret or set STRIPE_WEBHOOK_SECRET in the current session."
  exit 1
}

$event = @{
  id = "evt_" + ([guid]::NewGuid().ToString("N"))
  type = "checkout.session.completed"
  data = @{
    object = @{
      metadata = @{
        node_id = $NodeId
        plan_code = "pro"
      }
      customer = "cus_test"
      subscription = "sub_test"
    }
  }
}

$body = $event | ConvertTo-Json -Compress -Depth 20
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$signedPayload = "$timestamp.$body"

$hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
$signatureBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($signedPayload))
$signature = ($signatureBytes | ForEach-Object { $_.ToString("x2") }) -join ""
$headerValue = "t=$timestamp,v1=$signature"

try {
  $response = Invoke-RestMethod -Uri $Url -Method Post -Headers @{ "Stripe-Signature" = $headerValue } -ContentType "application/json" -Body $body
  Write-Host "[PASS] Webhook request accepted."
  $response | ConvertTo-Json -Depth 10
  exit 0
} catch {
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $errorBody = $reader.ReadToEnd()
    Write-Host "[FAIL] Webhook request failed with HTTP $status."
    Write-Host $errorBody
    exit 1
  }
  Write-Host "[FAIL] Webhook request failed."
  Write-Host $_.Exception.Message
  exit 1
}
