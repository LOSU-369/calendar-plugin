$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionManifestPath = Join-Path $projectRoot "extension/manifest.json"
$publicManifestPath = Join-Path $projectRoot "extension/public/manifest.json"
$distManifestPath = Join-Path $projectRoot "extension/dist/manifest.json"

$extensionManifest = Get-Content -LiteralPath $extensionManifestPath -Raw | ConvertFrom-Json
$publicManifest = Get-Content -LiteralPath $publicManifestPath -Raw | ConvertFrom-Json

$errors = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

if ($extensionManifest.oauth2.client_id -ne $publicManifest.oauth2.client_id) {
  $errors.Add("OAuth client_id differs between extension/manifest.json and extension/public/manifest.json.")
}

if ($extensionManifest.version -ne $publicManifest.version) {
  $errors.Add("Version differs between extension/manifest.json and extension/public/manifest.json.")
}

foreach ($size in @("16", "32", "48", "128")) {
  $iconRelPath = $publicManifest.icons.PSObject.Properties[$size].Value
  $iconPath = Join-Path $projectRoot ("extension/public/" + $iconRelPath)
  if (!(Test-Path -LiteralPath $iconPath)) {
    $errors.Add("Missing public icon: $iconPath")
  }
}

if ($extensionManifest.host_permissions -contains "<all_urls>") {
  $warnings.Add("Manifest uses <all_urls>; keep the Chrome Web Store permission justification clear and narrow.")
}

if (!$env:VITE_BACKEND_BASE_URL -or $env:VITE_BACKEND_BASE_URL -match "localhost|127\.0\.0\.1") {
  $warnings.Add("VITE_BACKEND_BASE_URL is not set to a production HTTPS URL for this shell.")
}

if (Test-Path -LiteralPath $distManifestPath) {
  $distManifest = Get-Content -LiteralPath $distManifestPath -Raw | ConvertFrom-Json
  foreach ($size in @("16", "32", "48", "128")) {
    $distIconRelPath = $distManifest.icons.PSObject.Properties[$size].Value
    $distIconPath = Join-Path (Split-Path -Parent $distManifestPath) $distIconRelPath
    if (!(Test-Path -LiteralPath $distIconPath)) {
      $errors.Add("Missing dist icon after build: $distIconPath")
    }
  }
} else {
  $warnings.Add("extension/dist/manifest.json not found yet. Run npm.cmd run build before packaging.")
}

if ($warnings.Count) {
  Write-Host "Warnings:" -ForegroundColor Yellow
  foreach ($warning in $warnings) {
    Write-Host " - $warning" -ForegroundColor Yellow
  }
}

if ($errors.Count) {
  Write-Host "Release check failed:" -ForegroundColor Red
  foreach ($err in $errors) {
    Write-Host " - $err" -ForegroundColor Red
  }
  exit 1
}

Write-Host "Release check passed."
