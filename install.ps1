Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   CITY NET // REMOTE DEPLOYMENT SETUP" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check for Node.js
if (!(Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Host "[SYSTEM] Node.js not found. Installing via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS -e --silent
    Write-Host "[SYSTEM] Node.js installed. You may need to restart the script if npm is still not found." -ForegroundColor Yellow
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
