$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$extensionDir = Join-Path $projectRoot "extension"
$distDir = Join-Path $extensionDir "dist"
$manifestPath = Join-Path $distDir "manifest.json"
$releaseDir = Join-Path $projectRoot "release"

if (!(Test-Path -LiteralPath $manifestPath)) {
  throw "Missing dist manifest. Run npm.cmd run build in extension first."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$displayName = $manifest.short_name
if (!$displayName) {
  $displayName = $manifest.name
}
$safeName = $displayName.ToLowerInvariant() -replace "[^a-z0-9]+", "-"
$safeName = $safeName.Trim("-")
$zipPath = Join-Path $releaseDir "$safeName-v$($manifest.version).zip"

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $distDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Packaged Chrome Web Store ZIP:"
Write-Host $zipPath
