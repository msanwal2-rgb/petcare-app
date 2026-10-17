<#
.SYNOPSIS
  Builds Leash and publishes it to the two IIS sites: the API and the SPA.

.DESCRIPTION
  The two-site layout deploy/README.md describes:

    API       C:\inetpub\wwwroot\leash          (:8080)  dotnet publish of Leash.Api
    Frontend  C:\inetpub\wwwroot\leashfrontend  (:8081)  web\dist

  What a redeploy keeps on the server, never overwriting it:
    - the API's appsettings.Production.json (connection string, auth secret,
      Cors:Origins, Payments:*);
    - the frontend's config.js (apiBaseUrl, stripePublishableKey). The build
      ships the development copy; the server's edited one wins. On a first
      deploy, when there is none, the build's copy is installed — edit it.

  The API is taken offline with app_offline.htm while its files are replaced,
  which makes IIS stop the app and release its DLLs.

  Writing to C:\inetpub needs an elevated shell. -StageOnly builds and
  publishes into the staging folder and stops there, which needs nothing.

  Database changes are NOT applied by this script. Run each new
  db\changes\NNN_*.sql once against the site's database (deploy/README.md).

.EXAMPLE
  .\deploy\publish-iis.ps1                 # build and deploy both sites (elevated)
  .\deploy\publish-iis.ps1 -StageOnly      # build and publish to the staging folder only
#>
param(
    [string]$ApiPath = "C:\inetpub\wwwroot\leash",
    [string]$WebPath = "C:\inetpub\wwwroot\leashfrontend",
    [string]$Staging = (Join-Path $PSScriptRoot "..\API\src\Leash.Api\bin\iis-staging"),
    [switch]$StageOnly
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")

# Native tools are judged by exit code alone. Windows PowerShell 5.1 turns
# their stderr into errors when output is redirected, and Vite writes harmless
# warnings there.
function Invoke-Tool([string]$What, [scriptblock]$Command) {
    $ErrorActionPreference = "Continue"
    & $Command
    if ($LASTEXITCODE) { throw "$What failed (exit $LASTEXITCODE)" }
}

# Robocopy's exit codes 0-7 are degrees of success; 8 and up are failures.
function Invoke-Mirror([string]$From, [string]$To, [string[]]$KeepFiles) {
    $args = @($From, $To, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    if ($KeepFiles.Count -gt 0) { $args += "/XF"; $args += $KeepFiles }
    & robocopy @args | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copying $From to $To failed (robocopy $LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

# ── 1. Build the SPA ─────────────────────────────────────────────────────
Push-Location (Join-Path $root "web")
try {
    if (-not (Test-Path node_modules)) { Invoke-Tool "npm ci" { npm ci } }
    Invoke-Tool "web build" { npm run build }
} finally { Pop-Location }

# ── 2. Publish the API to staging ────────────────────────────────────────
$apiStaging = Join-Path $Staging "api"
if (Test-Path $apiStaging) { Remove-Item $apiStaging -Recurse -Force }
Invoke-Tool "dotnet publish" {
    dotnet publish (Join-Path $root "API\src\Leash.Api\Leash.Api.csproj") -c Release -o $apiStaging
}
# Development settings carry the dev auth key; never ship them. The API does
# not serve the SPA in this layout, so it gets no wwwroot.
Remove-Item (Join-Path $apiStaging "appsettings.Development.json") -ErrorAction SilentlyContinue

$webStaging = Join-Path $root "web\dist"
Write-Host "Staged: API in $(Resolve-Path $apiStaging), SPA in $webStaging" -ForegroundColor Green
if ($StageOnly) { return }

# ── 3. The API site ──────────────────────────────────────────────────────
New-Item -ItemType Directory -Force $ApiPath | Out-Null
$offline = Join-Path $ApiPath "app_offline.htm"
$live = Test-Path (Join-Path $ApiPath "web.config")
if ($live) {
    Set-Content $offline "<h1>Leash is updating. Back in a minute.</h1>" -Encoding utf8
    Start-Sleep -Seconds 3   # give IIS time to shut the app down
}
try {
    Invoke-Mirror $apiStaging $ApiPath @("appsettings.Production.json", "app_offline.htm")
} finally {
    if ($live) { Remove-Item $offline -ErrorAction SilentlyContinue }
}
Write-Host "API published to $ApiPath" -ForegroundColor Green
if (-not (Test-Path (Join-Path $ApiPath "appsettings.Production.json"))) {
    Write-Host "  No appsettings.Production.json there yet - see deploy/README.md." -ForegroundColor Yellow
}

# ── 4. The frontend site ─────────────────────────────────────────────────
New-Item -ItemType Directory -Force $WebPath | Out-Null
$serverConfig = Join-Path $WebPath "config.js"
$firstDeploy = -not (Test-Path $serverConfig)
Invoke-Mirror $webStaging $WebPath @("config.js")
if ($firstDeploy) {
    Copy-Item (Join-Path $webStaging "config.js") $serverConfig
    Write-Host "  Installed the development config.js - set apiBaseUrl in $serverConfig." -ForegroundColor Yellow
} else {
    Write-Host "  Kept the server's config.js." -ForegroundColor Green
}
Write-Host "Frontend published to $WebPath" -ForegroundColor Green
