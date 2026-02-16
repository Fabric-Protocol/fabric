$required = @(
  "DATABASE_URL",
  "ADMIN_KEY"
)

$hasFailure = $false

foreach ($name in $required) {
  $value = (Get-Item "Env:$name" -ErrorAction SilentlyContinue).Value
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "[FAIL] $name is missing or empty."
    $hasFailure = $true
  } else {
    Write-Host "[PASS] $name is set."
  }
}

if ($hasFailure) {
  Write-Host "[FAIL] Environment validation failed."
  exit 1
}

Write-Host "[PASS] Environment validation passed."
exit 0
