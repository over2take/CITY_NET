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
    Write-Host ""
    Write-Host "  On this machine:   http://localhost:$appPort" -ForegroundColor White
    Write-Host "  On your network:   http://<your-lan-ip>:$appPort" -ForegroundColor White
    if ($useDuck) {
        Write-Host "  Over the internet: http://$duckSub.duckdns.org`:$appPort" -ForegroundColor White
        Write-Host ""
        Write-Host "  (Internet play also needs a port-forward for $appPort on your router" -ForegroundColor DarkGray
        Write-Host "   and a firewall rule allowing inbound $appPort.)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Admin login:  $adminUser" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  Setup complete. Start the app any time with:" -ForegroundColor Green
    Write-Host "     docker compose up -d --build" -ForegroundColor White
    Write-Host ""
}
