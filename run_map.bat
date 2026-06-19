@echo off
title CITY_NET // NAV_OS_LAUNCHER
echo [SYSTEM] INITIALIZING CITY_NET PROTOCOLS...
echo [SYSTEM] STARTING BACKEND DATA_LINK...

:: Start the backend and keep the window open if it fails
start "CITY_NET_BACKEND" cmd /k "cd backend && npx nodemon server.js"

echo [SYSTEM] STARTING FRONTEND VISUAL_INTERFACE...

:: Start the frontend
start "CITY_NET_FRONTEND" cmd /k "cd frontend && npm run dev"

echo [SYSTEM] STARTING NGROK TUNNEL...

:: Start Ngrok and keep the window open so you can copy the URL
start "CITY_NET_NGROK" cmd /k "ngrok http 5173"

echo [SYSTEM] STARTING CLOUDFLARE TUNNEL...

:: Start Cloudflare tunnel as backup
start "CITY_NET_CLOUDFLARE" cmd /k "cloudflared tunnel --url http://localhost:5173"

echo.
echo [SUCCESS] ALL SYSTEMS NOMINAL.
echo [LINK] COPY URL FROM "CITY_NET_NGROK" OR "CITY_NET_CLOUDFLARE" WINDOW.
echo.
pause
