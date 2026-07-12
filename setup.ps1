# ============================================================================
#  City_Net - Guided Setup
#  Generates your .env configuration and (optionally) launches the app.
#  Run from the project root:  powershell -ExecutionPolicy Bypass -File setup.ps1
# ============================================================================

$ErrorActionPreference = 'Stop'

function Write-Header {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "        CITY_NET  //  GUIDED SETUP" -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host ""
}

function Read-Default {
    param([string]$Prompt, [string]$Default)
    $answer = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer
}

function Read-Required {
    param([string]$Prompt)
    do {
        $answer = Read-Host $Prompt
        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-Host "  This field is required." -ForegroundColor Yellow
        }
    } while ([string]::IsNullOrWhiteSpace($answer))
    return $answer
}

function Read-Password {
    param([string]$Prompt)
    do {
        $secure = Read-Host "$Prompt (input hidden)" -AsSecureString
        $answer = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-Host "  This field is required." -ForegroundColor Yellow
        }
    } while ([string]::IsNullOrWhiteSpace($answer))
    return $answer
}

function Read-YesNo {
    param([string]$Prompt, [bool]$DefaultYes = $false)
    $hint = if ($DefaultYes) { "Y/n" } else { "y/N" }
    $answer = Read-Host "$Prompt [$hint]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
    return $answer -match '^(y|yes)$'
}

# --- Preflight --------------------------------------------------------------

Write-Header

if (-not (Test-Path ".\docker-compose.yml")) {
    Write-Host "  ERROR: run this from the City_Net project root (docker-compose.yml not found)." -ForegroundColor Red
    exit 1
}

$dockerOk = $false
try { docker --version | Out-Null; $dockerOk = $true } catch {}
if (-not $dockerOk) {
    Write-Host "  Docker was not found on your system." -ForegroundColor Yellow
    Write-Host "  Install Docker Desktop first: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    Write-Host "  Then re-run this script." -ForegroundColor Yellow
    exit 1
}

if (Test-Path ".\backend\.env") {
    Write-Host "  A configuration already exists (backend\.env)." -ForegroundColor Yellow
    if (-not (Read-YesNo "  Overwrite it?" $false)) {
        Write-Host "  Setup cancelled - existing config kept." -ForegroundColor Green
        exit 0
    }
    Write-Host ""
}

# --- Required settings ------------------------------------------------------

Write-Host "  --- Required settings ---" -ForegroundColor Cyan
Write-Host ""

$adminUser = Read-Default  "  Admin username" "admin"
$adminPass = Read-Password "  Admin password"

Write-Host ""
Write-Host "  App port: the port players connect on. 80 gives the cleanest URL," -ForegroundColor DarkGray
Write-Host "  but many home ISPs block inbound 80, so 8080 is the safe default." -ForegroundColor DarkGray
$appPort = Read-Default "  App port" "8080"

Write-Host ""
Write-Host "  Secure Mode: if ON, players must register an account and be approved." -ForegroundColor DarkGray
Write-Host "  If OFF, players just type a name to join (simplest)." -ForegroundColor DarkGray
$secureMode = if (Read-YesNo "  Enable Secure Mode?" $false) { "true" } else { "false" }

# JWT secret - auto-generated, never prompted
$bytes = New-Object 'System.Byte[]' 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$jwtSecret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

# --- Optional settings ------------------------------------------------------

$duckSub = "yourname"
$duckTok = "your-duckdns-token"
$tz = "America/Chicago"
$useDuck = $false

Write-Host ""
Write-Host "  --- Optional: internet access via DuckDNS ---" -ForegroundColor Cyan
Write-Host "  DuckDNS gives you a free domain (e.g. yourcity.duckdns.org) so players" -ForegroundColor DarkGray
Write-Host "  can connect over the internet. Skip this for LAN-only play." -ForegroundColor DarkGray
Write-Host ""

if (Read-YesNo "  Set up DuckDNS now?" $false) {
    $useDuck = $true
    Write-Host "  Get your subdomain and token at https://www.duckdns.org" -ForegroundColor DarkGray
    $duckSub = Read-Required "  DuckDNS subdomain (the part before .duckdns.org)"
    $duckTok = Read-Required "  DuckDNS token"
    $tz      = Read-Default  "  Timezone" "America/Chicago"
}

# --- Write .env -------------------------------------------------------------

$envContent = @"
JWT_SECRET=$jwtSecret
ADMIN_USER=$adminUser
ADMIN_PASS=$adminPass

# Require player registration and approval before joining (default false)
SECURE_MODE=$secureMode

# Port the app is exposed on
APP_PORT=$appPort

# DuckDNS - optional
DUCKDNS_SUBDOMAINS=$duckSub
DUCKDNS_TOKEN=$duckTok

# Timezone for DuckDNS container
TZ=$tz
"@

# Root .env is only used by docker-compose for variable substitution -
# it gets the non-secret values only (no JWT_SECRET / ADMIN_PASS).
$rootEnvContent = @"
APP_PORT=$appPort
DUCKDNS_SUBDOMAINS=$duckSub
DUCKDNS_TOKEN=$duckTok
TZ=$tz
"@

Set-Content -Path ".\backend\.env" -Value $envContent     -Encoding utf8 -NoNewline
Set-Content -Path ".\.env"         -Value $rootEnvContent -Encoding utf8 -NoNewline

Write-Host ""
Write-Host "  Configuration written to backend\.env and .env" -ForegroundColor Green

# --- Connection info ---------------------------------------------------------

function Get-LanIP {
    # Prefer the interface that owns the default route; fall back to any private IPv4
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
                 Sort-Object RouteMetric | Select-Object -First 1
        $ip = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction Stop |
               Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
               Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
               Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
               Select-Object -First 1).IPAddress
        if ($ip) { return $ip }
    } catch {}
    return $null
}

function Show-ConnectionInfo {
    $lanIP = Get-LanIP
    Write-Host ""
    Write-Host "  --- How to connect ---" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  On this machine:" -ForegroundColor White
    Write-Host "     http://localhost:$appPort" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Same network (other devices in your home/LAN):" -ForegroundColor White
    if ($lanIP) {
        Write-Host "     http://$lanIP`:$appPort" -ForegroundColor Green
    } else {
        Write-Host "     http://<this-machine's-IP>:$appPort" -ForegroundColor Green
        Write-Host "     (couldn't auto-detect your LAN IP - run 'ipconfig' and look for IPv4 Address)" -ForegroundColor DarkGray
    }
    Write-Host ""
    if ($useDuck) {
        Write-Host "  Over the internet (players anywhere):" -ForegroundColor White
        Write-Host "     http://$duckSub.duckdns.org`:$appPort" -ForegroundColor Green
        Write-Host ""
        Write-Host "     Internet play also needs:" -ForegroundColor DarkGray
        Write-Host "      1. A port-forward rule on your router: external $appPort -> this machine's IP" -ForegroundColor DarkGray
        Write-Host "      2. A firewall rule allowing inbound connections on port $appPort" -ForegroundColor DarkGray
        Write-Host "         (Windows: Windows Defender Firewall > Advanced Settings > Inbound Rules)" -ForegroundColor DarkGray
    } else {
        Write-Host "  Over the internet: not configured (re-run setup and enable DuckDNS," -ForegroundColor DarkGray
        Write-Host "  or see the Connectivity section of the README for other options)." -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Admin login:  $adminUser" -ForegroundColor White
    Write-Host ""
}

# --- Launch -----------------------------------------------------------------

Write-Host ""
if (Read-YesNo "  Build and start City_Net now?" $true) {
    Write-Host ""
    Write-Host "  Starting containers (first build can take a few minutes)..." -ForegroundColor Green
    docker compose up -d --build

    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "        CITY_NET IS RUNNING" -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Show-ConnectionInfo
} else {
    Write-Host ""
    Write-Host "  Setup complete. Start the app any time with:" -ForegroundColor Green
    Write-Host "     docker compose up -d --build" -ForegroundColor White
    Show-ConnectionInfo
}
