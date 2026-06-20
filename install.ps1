Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   CITY NET // REMOTE DEPLOYMENT SETUP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for Node.js and ensure it is version 22+
$needsNodeUpdate = $false
if (!(Get-Command "node" -ErrorAction SilentlyContinue)) {
    $needsNodeUpdate = $true
} else {
    $nodeVersion = node -v
    $majorVersion = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
    if ($majorVersion -lt 22) {
        Write-Host "[SYSTEM] Node.js is outdated (v$majorVersion). Upgrading..." -ForegroundColor Yellow
        $needsNodeUpdate = $true
    }
}

if ($needsNodeUpdate) {
    Write-Host "[SYSTEM] Installing/Upgrading Node.js via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS -e --silent --accept-package-agreements --accept-source-agreements
    Write-Host "[SYSTEM] Node.js installed. You MUST restart this PowerShell window for the new version to take effect!" -ForegroundColor Red
    pause
    exit
}

# 2. Check for Git
if (!(Get-Command "git" -ErrorAction SilentlyContinue)) {
    Write-Host "[SYSTEM] Git not found. Installing via winget..." -ForegroundColor Yellow
    winget install Git.Git -e --silent
}

Write-Host "`n[SYSTEM] INSTALLING DEPENDENCIES..." -ForegroundColor Cyan
# Install backend dependencies
cd backend
npm install
cd ..

# Install frontend dependencies
cd frontend
npm install

Write-Host "`n[SYSTEM] BUILDING FRONTEND PRODUCTION BUNDLE..." -ForegroundColor Cyan
npm run build
cd ..

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "       TUNNEL CONFIGURATION (OPTIONAL)    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Leave blank and press Enter to skip." -ForegroundColor Gray

# Download Cloudflared automatically if it's missing
if (!(Test-Path "cloudflared.exe") -and !(Get-Command "cloudflared" -ErrorAction SilentlyContinue)) {
    Write-Host "`n[SYSTEM] cloudflared not found. Downloading the latest version..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
    Write-Host "[SUCCESS] cloudflared downloaded!" -ForegroundColor Green
}

# 3. Configure Ngrok
$ngrokToken = Read-Host "Enter your Ngrok Auth Token"
if ($ngrokToken) {
    Set-Content -Path "ngrok.yml" -Value "authtoken: $ngrokToken`nversion: '2'"
    Write-Host "[SUCCESS] Ngrok configured!" -ForegroundColor Green
} else {
    Write-Host "[SKIP] Ngrok configuration skipped." -ForegroundColor DarkGray
}

# 4. Configure Cloudflared
$cfToken = Read-Host "Enter your Cloudflared Tunnel Token"
if ($cfToken) {
    Set-Content -Path "cloudflared_token.txt" -Value $cfToken
    Write-Host "[SUCCESS] Cloudflared configured!" -ForegroundColor Green
} else {
    Write-Host "[SKIP] Cloudflared configuration skipped." -ForegroundColor DarkGray
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] INSTALLATION COMPLETE." -ForegroundColor Green
Write-Host "To launch the server, run: start_prod.bat" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
pause
