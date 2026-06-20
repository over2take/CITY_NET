@echo off
title CITY_NET // PRODUCTION SERVER

echo [SYSTEM] CHECKING FOR UPDATES...
git pull origin main

echo [SYSTEM] INSTALLING DEPENDENCIES...
call npm install --prefix backend
call npm install --prefix frontend

echo [SYSTEM] BUILDING FRONTEND...
call npm run build --prefix frontend

echo [SYSTEM] STARTING BACKEND (API + FRONTEND HOST)...
:: Using node instead of nodemon for production performance
start "CITY_NET_BACKEND" cmd /k "cd backend && node server.js"

if exist ngrok.yml (
    echo [SYSTEM] STARTING NGROK TUNNEL...
    start "CITY_NET_NGROK" cmd /k "ngrok http --config=ngrok.yml 5000"
)

if exist cloudflared_token.txt (
    set /p CF_TOKEN=<cloudflared_token.txt
    echo [SYSTEM] STARTING CLOUDFLARE (PERSISTENT TUNNEL)...
    start "CITY_NET_CLOUDFLARE" cmd /k "cloudflared tunnel run %CF_TOKEN%"
) else (
    echo [SYSTEM] STARTING CLOUDFLARE (RANDOM QUICK TUNNEL)...
    start "CITY_NET_CLOUDFLARE" cmd /k "cloudflared tunnel --url http://localhost:5000"
)

echo.
echo [SUCCESS] PRODUCTION SYSTEMS NOMINAL.
echo [LINK] APP IS RUNNING ON PORT 5000 (LOCAL) AND VIA TUNNELS.
echo.
pause
