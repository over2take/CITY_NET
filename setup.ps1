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

# --- Install mode: Docker (recommended) or Manual (Node.js) ------------------

$hasDocker = $false
try { docker --version | Out-Null; $hasDocker = $true } catch {}

$hasNode = $false
try {
    $nodeMajor = [int]((node -v) -replace '^v' -split '\.')[0]
    if ($nodeMajor -ge 18) { $hasNode = $true }
} catch {}

$mode = ""
if ($hasDocker -and $hasNode) {
    Write-Host "  Two install options are available:" -ForegroundColor DarkGray
    Write-Host "   - Docker (recommended): runs in containers, auto-restarts, includes DuckDNS" -ForegroundColor DarkGray
    Write-Host "   - Manual: runs directly with Node.js in a terminal" -ForegroundColor DarkGray
    Write-Host ""
    if (Read-YesNo "  Use Docker? (recommended)" $true) { $mode = "docker" } else { $mode = "manual" }
} elseif ($hasDocker) {
    $mode = "docker"
} elseif ($hasNode) {
    Write-Host "  Docker was not found, but Node.js $(node -v) is installed." -ForegroundColor Yellow
    if (Read-YesNo "  Continue with a manual (Node.js) install?" $true) {
        $mode = "manual"
    } else {
        Write-Host "  Install Docker Desktop first: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  Neither Docker nor Node.js (v18+) was found." -ForegroundColor Red
    Write-Host "  Install one of them first, then re-run this script:" -ForegroundColor Yellow
    Write-Host "   - Docker Desktop (recommended): https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
    Write-Host "   - Node.js v18+:                 https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host ""

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
if ($mode -eq "docker") {
    $portDefault = "8080"
    Write-Host "  App port: the port players connect on. 80 gives the cleanest URL," -ForegroundColor DarkGray
    Write-Host "  but many home ISPs block inbound 80, so 8080 is the safe default." -ForegroundColor DarkGray
} else {
    $portDefault = "5000"
    Write-Host "  App port: the port players connect on (the Node server listens here)." -ForegroundColor DarkGray
}

# Warn if another program already owns the chosen port (e.g. NVIDIA Broadcast
# holds 127.0.0.1:8080 - localhost would then hit that app instead of City_Net).
do {
    $appPort = Read-Default "  App port" $portDefault
    $portOk = $true
    try {
        $conflicts = Get-NetTCPConnection -LocalPort ([int]$appPort) -State Listen -ErrorAction SilentlyContinue |
                     Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -notmatch 'docker|wslrelay|vpnkit' }
        if ($conflicts) {
            $names = ($conflicts | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } | Sort-Object -Unique) -join ', '
            Write-Host ""
            Write-Host "  WARNING: port $appPort is already in use by: $names" -ForegroundColor Yellow
            Write-Host "  Connections on this port may reach that app instead of City_Net." -ForegroundColor Yellow
            if (-not (Read-YesNo "  Use port $appPort anyway?" $false)) { $portOk = $false; Write-Host "" }
        }
    } catch {}
} while (-not $portOk)

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

if ($mode -eq "docker") {
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
} else {
    Write-Host ""
    Write-Host "  NOTE: the bundled DuckDNS service (automatic internet domain) requires" -ForegroundColor Yellow
    Write-Host "  Docker and is not available with a manual install. For internet play," -ForegroundColor Yellow
    Write-Host "  see the 'Connectivity & Deployment' section of the README - Cloudflare" -ForegroundColor Yellow
    Write-Host "  Tunnel works well with a manual install and needs no port forwarding." -ForegroundColor Yellow
}

# --- Write .env -------------------------------------------------------------

if ($mode -eq "docker") {
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
} else {
    $envContent = @"
JWT_SECRET=$jwtSecret
ADMIN_USER=$adminUser
ADMIN_PASS=$adminPass

# Require player registration and approval before joining (default false)
SECURE_MODE=$secureMode

# Port the Node server listens on
PORT=$appPort
"@

    Set-Content -Path ".\backend\.env" -Value $envContent -Encoding utf8 -NoNewline

    Write-Host ""
    Write-Host "  Configuration written to backend\.env" -ForegroundColor Green
}

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
    Write-Host "  This machine and your home network (LAN):" -ForegroundColor White
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
    } elseif ($mode -eq "docker") {
        Write-Host "  Over the internet: not configured (re-run setup and enable DuckDNS," -ForegroundColor DarkGray
        Write-Host "  or see the Connectivity section of the README for other options)." -ForegroundColor DarkGray
    } else {
        Write-Host "  Over the internet: see the 'Connectivity & Deployment' section of the" -ForegroundColor DarkGray
        Write-Host "  README - Cloudflare Tunnel is the easiest option for a manual install." -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Admin login:  $adminUser" -ForegroundColor White
    Write-Host ""
}

# --- Launch -----------------------------------------------------------------

Write-Host ""
if ($mode -eq "docker") {
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
} else {
    if (Read-YesNo "  Install dependencies and build now? (takes a few minutes)" $true) {
        Write-Host ""
        Write-Host "  Installing backend dependencies..." -ForegroundColor Green
        Push-Location backend;  npm install; Pop-Location
        Write-Host "  Installing frontend dependencies..." -ForegroundColor Green
        Push-Location frontend; npm install; Pop-Location
        Write-Host "  Building frontend..." -ForegroundColor Green
        Push-Location frontend; npm run build; Pop-Location

        Write-Host ""
        Write-Host "  ============================================" -ForegroundColor Green
        Write-Host "        CITY_NET IS BUILT" -ForegroundColor Green
        Write-Host "  ============================================" -ForegroundColor Green
        Show-ConnectionInfo
        Write-Host "  NOTE: with a manual install the server runs in this terminal." -ForegroundColor Yellow
        Write-Host "  Closing the terminal stops City_Net. It will not restart on reboot." -ForegroundColor Yellow
        Write-Host ""
        if (Read-YesNo "  Start the server now?" $true) {
            Write-Host ""
            Write-Host "  Starting City_Net... (press Ctrl+C to stop)" -ForegroundColor Green
            Set-Location backend
            node server.js
        } else {
            Write-Host ""
            Write-Host "  Start the server any time with:" -ForegroundColor Green
            Write-Host "     cd backend; node server.js" -ForegroundColor White
            Write-Host ""
        }
    } else {
        Write-Host ""
        Write-Host "  Setup complete. Install and run manually with:" -ForegroundColor Green
        Write-Host "     cd backend; npm install" -ForegroundColor White
        Write-Host "     cd ..\frontend; npm install; npm run build" -ForegroundColor White
        Write-Host "     cd ..\backend; node server.js" -ForegroundColor White
        Show-ConnectionInfo
        Write-Host "  NOTE: with a manual install the server runs in a terminal." -ForegroundColor Yellow
        Write-Host "  Closing that terminal stops City_Net." -ForegroundColor Yellow
        Write-Host ""
    }
}
