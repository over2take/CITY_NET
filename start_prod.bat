@echo off
title CITY_NET // PRODUCTION SERVER

echo [SYSTEM] CHECKING FOR UPDATES...
git pull origin main

if exist backend\.env goto skip_setup

echo.
echo ==================================================
echo [SYSTEM] FIRST-TIME SETUP: ADMIN CREDENTIALS
echo ==================================================
set /p ADMIN_USER="Enter Admin Username (leave blank for default): "
set /p ADMIN_PASS="Enter Admin Password (leave blank for default): "

if "%ADMIN_USER%"=="" set ADMIN_USER=admin
if "%ADMIN_PASS%"=="" set ADMIN_PASS=cyberpunk_password

echo.
if "%ADMIN_USER%"=="admin" if "%ADMIN_PASS%"=="cyberpunk_password" (
    echo [NOTICE] No input detected. Default credentials have been set.
)
echo Username: %ADMIN_USER%
echo Password: [HIDDEN]

echo JWT_SECRET=citynet_secret_%RANDOM%%RANDOM%%RANDOM% > backend\.env
echo ADMIN_USER=%ADMIN_USER%>> backend\.env
echo ADMIN_PASS=%ADMIN_PASS%>> backend\.env
echo ==================================================
echo.

:skip_setup

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

set CF_CMD=cloudflared
if exist cloudflared.exe set CF_CMD=.\cloudflared.exe

if not exist cloudflared_token.txt goto quick_tunnel

set /p CF_TOKEN=<cloudflared_token.txt
echo [SYSTEM] STARTING CLOUDFLARE (PERSISTENT TUNNEL)...
start "CITY_NET_CLOUDFLARE" cmd /k "%CF_CMD% tunnel run %CF_TOKEN%"
goto end_tunnel

:quick_tunnel
echo [SYSTEM] STARTING CLOUDFLARE (RANDOM QUICK TUNNEL)...
start "CITY_NET_CLOUDFLARE" cmd /k "%CF_CMD% tunnel --url http://localhost:5000"

:end_tunnel

echo.
echo [SUCCESS] PRODUCTION SYSTEMS NOMINAL.
echo [LINK] APP IS RUNNING ON PORT 5000 (LOCAL) AND VIA TUNNELS.
echo.
pause
