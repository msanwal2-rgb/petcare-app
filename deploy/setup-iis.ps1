#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time setup of the Leash IIS site. Run as Administrator on the IIS machine.

.DESCRIPTION
  1. Turns on IIS (with Application Initialization).
  2. Stops if the ASP.NET Core Hosting Bundle is missing — install it, re-run.
  3. Creates an app pool (No Managed Code, always running, never idles out —
     the fulfilment job is a background service and stops when the pool does).
  4. Creates the site on the given port, grants the pool read access, and
     opens the port in Windows Firewall.
  5. Writes appsettings.Production.json with a freshly generated auth secret,
     unless one is already there.

  Safe to re-run: every step skips what already exists.

.EXAMPLE
  .\deploy\setup-iis.ps1 -Port 8080 -DbPassword "<leash user's password>"
#>
param(
    [string]$SiteName = "Leash",
    [string]$Path = "C:\inetpub\leash",
    [int]$Port = 8080,
    [string]$Database = "leash_review",
    [string]$DbUser = "leash",
    [string]$DbPassword = "CHANGE_ME",
    # Where emailed links point. Set it to the address the client uses.
    [string]$Origin = "http://localhost:$Port"
)
$ErrorActionPreference = "Stop"

# ── 1. IIS ───────────────────────────────────────────────────────────────
$isServer = (Get-CimInstance Win32_OperatingSystem).ProductType -ne 1
if ($isServer) {
    Install-WindowsFeature Web-Server, Web-AppInit -IncludeManagementTools | Out-Null
} else {
    Enable-WindowsOptionalFeature -Online -All -NoRestart -FeatureName `
        IIS-WebServerRole, IIS-WebServer, IIS-ApplicationInit, IIS-ManagementConsole | Out-Null
}
Write-Host "IIS is on."

# ── 2. ASP.NET Core Module ───────────────────────────────────────────────
if (-not (Test-Path "$env:ProgramFiles\IIS\Asp.Net Core Module\V2\aspnetcorev2.dll")) {
    Write-Host ""
    Write-Host "The ASP.NET Core 10 Hosting Bundle is missing." -ForegroundColor Yellow
    Write-Host "Download 'Hosting Bundle' under ASP.NET Core Runtime 10.0 from"
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/10.0"
    Write-Host "install it, run 'iisreset', then run this script again."
    exit 1
}

# ── 3. App pool ──────────────────────────────────────────────────────────
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
if ((& $appcmd list apppool /text:name) -notcontains $SiteName) {
    & $appcmd add apppool "/name:$SiteName" "/managedRuntimeVersion:" | Out-Null
}
& $appcmd set apppool $SiteName "/startMode:AlwaysRunning" `
    "/processModel.idleTimeout:00:00:00" "/recycling.periodicRestart.time:00:00:00" | Out-Null
Write-Host "App pool '$SiteName' ready."

# ── 4. Site ──────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force $Path | Out-Null
if ((& $appcmd list site /text:name) -notcontains $SiteName) {
    & $appcmd add site "/name:$SiteName" "/physicalPath:$Path" "/bindings:http/*:${Port}:" | Out-Null
}
& $appcmd set app "$SiteName/" "/applicationPool:$SiteName" "/preloadEnabled:true" | Out-Null
icacls $Path /grant "IIS AppPool\${SiteName}:(OI)(CI)RX" | Out-Null

$rule = "Leash (IIS port $Port)"
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}
Write-Host "Site '$SiteName' on port $Port -> $Path"

# ── 5. Production settings ───────────────────────────────────────────────
$settings = Join-Path $Path "appsettings.Production.json"
if (-not (Test-Path $settings)) {
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    $json = @"
{
  "ConnectionStrings": {
    "Default": "Host=localhost;Port=5432;Database=$Database;Username=$DbUser;Password=$DbPassword"
  },
  "Auth": {
    "Secret": "$secret"
  },
  "App": {
    "Origin": "$Origin"
  }
}
"@
    [IO.File]::WriteAllText($settings, $json)
    # Holds the auth secret: readable by the app pool and admins only.
    icacls $settings /inheritance:r /grant "IIS AppPool\${SiteName}:R" "Administrators:F" "SYSTEM:F" | Out-Null
    Write-Host "Wrote $settings"
    if ($DbPassword -eq "CHANGE_ME") {
        Write-Host "  -> edit it and set the real database password." -ForegroundColor Yellow
    }
} else {
    Write-Host "Kept the existing $settings"
}

Write-Host ""
Write-Host "Done. Next: .\deploy\publish-iis.ps1 -Out $Path" -ForegroundColor Green
