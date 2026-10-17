<#
.SYNOPSIS
  Puts the two IIS sites on public https addresses with Cloudflare quick
  tunnels, and points both sites' settings at them. Run as Administrator.

.DESCRIPTION
  1. Starts one tunnel per site (or reuses the two already running) and reads
     their https://….trycloudflare.com addresses.
  2. Frontend config.js    -> apiBaseUrl = the API tunnel.
  3. Backend appsettings.Production.json (backed up to .bak first)
       App:Origin, Cors:Origins -> the frontend tunnel (+ localhost)
       Auth:CrossSiteCookie     -> true (the two tunnels are different domains)
       Auth:Secret              -> replaced if it is still the dev key
  4. iisreset, then checks the API accepts calls from the frontend tunnel.

  Quick-tunnel addresses change whenever the tunnels restart (a reboot, or
  -Restart). Re-run this script after that — it is safe to run any number of
  times. Stop the tunnels with: Stop-Process -Name cloudflared

.EXAMPLE
  .\deploy\go-public.ps1            # reuse running tunnels, or start them
  .\deploy\go-public.ps1 -Restart   # fresh tunnels, new addresses
#>
param(
    [string]$BackendPath = "C:\inetpub\wwwroot\leash",
    [string]$FrontendPath = "C:\inetpub\wwwroot\leashfrontend",
    [int]$BackendPort = 8080,
    [int]$FrontendPort = 8081,
    [switch]$Restart,
    # For testing against copies of the files; leaves IIS alone.
    [switch]$SkipIisReset
)
$ErrorActionPreference = "Stop"

$dir = Join-Path $env:USERPROFILE "cloudflared"
$exe = Join-Path $dir "cloudflared.exe"
$apiLog = Join-Path $dir "api.log"
$webLog = Join-Path $dir "web.log"

# ── 1. Tunnels ───────────────────────────────────────────────────────────
if (-not (Test-Path $exe)) {
    New-Item -ItemType Directory -Force $dir | Out-Null
    Write-Host "Downloading cloudflared..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
        -OutFile $exe -UseBasicParsing
    if ((Get-AuthenticodeSignature $exe).Status -ne "Valid") { Remove-Item $exe; throw "cloudflared.exe is not validly signed" }
}

function Get-TunnelUrl([string]$log) {
    if (-not (Test-Path $log)) { return $null }
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -Last 1
    if ($m) { return $m.Matches[0].Value }
    return $null
}

$running = @(Get-Process cloudflared -ErrorAction SilentlyContinue)
$api = Get-TunnelUrl $apiLog
$web = Get-TunnelUrl $webLog
if ($Restart -or $running.Count -lt 2 -or -not $api -or -not $web) {
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item $apiLog, $webLog -ErrorAction SilentlyContinue
    Start-Process $exe -WindowStyle Minimized -ArgumentList `
        "tunnel --no-autoupdate --url http://localhost:$BackendPort --logfile `"$apiLog`""
    Start-Process $exe -WindowStyle Minimized -ArgumentList `
        "tunnel --no-autoupdate --url http://localhost:$FrontendPort --logfile `"$webLog`""
    $api = $null; $web = $null
    for ($i = 0; $i -lt 60 -and (-not $api -or -not $web); $i++) {
        Start-Sleep -Seconds 1
        $api = Get-TunnelUrl $apiLog
        $web = Get-TunnelUrl $webLog
    }
    if (-not $api -or -not $web) { throw "Tunnels did not report an address - see $dir\*.log" }
    Write-Host "Started new tunnels."
} else {
    Write-Host "Reusing the running tunnels."
}
Write-Host "  API      $api"
Write-Host "  Frontend $web"

# ── 2. Frontend config.js ────────────────────────────────────────────────
$configJs = Join-Path $FrontendPath "config.js"
$js = [IO.File]::ReadAllText($configJs)
$updated = [regex]::Replace($js, '(?m)^(\s*apiBaseUrl:\s*)".*?"', "`$1`"$api`"")
if ($updated -eq $js -and $js -notmatch [regex]::Escape("`"$api`"")) { throw "No apiBaseUrl line found in $configJs" }
[IO.File]::WriteAllText($configJs, $updated)
Write-Host "Updated $configJs"

# ── 3. Backend appsettings.Production.json ───────────────────────────────
$settingsPath = Join-Path $BackendPath "appsettings.Production.json"
Copy-Item $settingsPath "$settingsPath.bak" -Force
# .NET reads // comments in appsettings; ConvertFrom-Json does not. Whole-line
# comments are dropped (the .bak keeps them).
$raw = ([IO.File]::ReadAllLines($settingsPath) | Where-Object { $_.TrimStart() -notlike "//*" }) -join "`n"
try { $s = $raw | ConvertFrom-Json }
catch { throw "Could not parse $settingsPath as JSON: $($_.Exception.Message)" }

function Set-Prop($obj, [string]$name, $value) {
    if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
}
if (-not $s.App)  { Set-Prop $s "App"  ([pscustomobject]@{}) }
if (-not $s.Auth) { Set-Prop $s "Auth" ([pscustomobject]@{}) }
Set-Prop $s.App "Origin" $web
Set-Prop $s "Cors" ([pscustomobject]@{ Origins = @($web, "http://localhost:$FrontendPort") })
Set-Prop $s.Auth "CrossSiteCookie" $true
if (-not $s.Auth.Secret -or $s.Auth.Secret -like "dev-only-*") {
    # The dev key is in git; anyone holding it can mint a session for any user.
    $bytes = New-Object byte[] 48
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    Set-Prop $s.Auth "Secret" ([Convert]::ToBase64String($bytes))
    Write-Host "Replaced the dev auth secret with a new one (everyone is signed out)."
}
[IO.File]::WriteAllText($settingsPath, ($s | ConvertTo-Json -Depth 10))
Write-Host "Updated $settingsPath (previous version: .bak)"

# ── 4. Restart and check ─────────────────────────────────────────────────
if ($SkipIisReset) { Write-Host "Skipped iisreset."; return }
iisreset | Out-Null
Write-Host "IIS restarted."

$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    try {
        $r = Invoke-WebRequest "$api/api/v1/auth/login" -Method Options -UseBasicParsing -TimeoutSec 30 -Headers @{
            "Origin" = $web; "Access-Control-Request-Method" = "POST"; "Access-Control-Request-Headers" = "content-type" }
        $ok = $r.Headers["Access-Control-Allow-Origin"] -eq $web
    } catch { }
    if (-not $ok) { Start-Sleep -Seconds 2 }
}
Write-Host ""
if ($ok) {
    Write-Host "Public and working. Send this to the client:" -ForegroundColor Green
    Write-Host "  $web" -ForegroundColor Green
    Write-Host "Swagger: $api/swagger"
} else {
    Write-Host "The API is not yet accepting calls from $web - check $settingsPath and the backend's logs." -ForegroundColor Yellow
}
