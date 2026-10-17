<#
.SYNOPSIS
  Builds the SPA and the API into one folder that an IIS site serves.

.DESCRIPTION
  The API serves the built SPA from wwwroot (BUILD_PLAN.md §2), so the output
  is a single folder: Leash.Api.dll, web.config, and wwwroot\.

  Publishing straight into a live site is safe: the script drops
  app_offline.htm first, which makes IIS stop the app and release its files,
  and removes it at the end.

  The site's appsettings.Production.json (connection string, auth secret) is
  not part of the build, so a redeploy never overwrites it.

.EXAMPLE
  .\deploy\publish-iis.ps1                          # to API\src\Leash.Api\bin\iis
  .\deploy\publish-iis.ps1 -Out C:\inetpub\leash    # straight into the site
#>
param(
    [string]$Out = (Join-Path $PSScriptRoot "..\API\src\Leash.Api\bin\iis")
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

# ── 1. The SPA ───────────────────────────────────────────────────────────
Push-Location (Join-Path $root "web")
try {
    if (-not (Test-Path node_modules)) { Invoke-Tool "npm ci" { npm ci } }
    Invoke-Tool "web build" { npm run build }
} finally { Pop-Location }

# ── 2. Take the site offline if it is live ───────────────────────────────
New-Item -ItemType Directory -Force $Out | Out-Null
$offline = Join-Path $Out "app_offline.htm"
$live = Test-Path (Join-Path $Out "web.config")
if ($live) {
    Set-Content $offline "<h1>Leash is updating. Back in a minute.</h1>" -Encoding utf8
    Start-Sleep -Seconds 3   # give IIS time to shut the app down
}

try {
    # ── 3. The API ───────────────────────────────────────────────────────
    Invoke-Tool "dotnet publish" {
        dotnet publish (Join-Path $root "API\src\Leash.Api\Leash.Api.csproj") -c Release -o $Out
    }

    # ── 4. The SPA into wwwroot ──────────────────────────────────────────
    $wwwroot = Join-Path $Out "wwwroot"
    if (Test-Path $wwwroot) { Remove-Item $wwwroot -Recurse -Force }
    Copy-Item (Join-Path $root "web\dist") $wwwroot -Recurse

    # Development settings carry the dev auth key; never ship them.
    Remove-Item (Join-Path $Out "appsettings.Development.json") -ErrorAction SilentlyContinue
} finally {
    if ($live) { Remove-Item $offline -ErrorAction SilentlyContinue }
}

Write-Host "Published to $(Resolve-Path $Out)" -ForegroundColor Green
if (-not (Test-Path (Join-Path $Out "appsettings.Production.json"))) {
    Write-Host "No appsettings.Production.json there yet - setup-iis.ps1 creates one." -ForegroundColor Yellow
}
