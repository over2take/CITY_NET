@echo off
title CITY_NET // LOCAL_LAUNCHER
echo [SYSTEM] INITIALIZING CITY_NET PROTOCOLS...
echo [SYSTEM] STARTING BACKEND DATA_LINK...

start "CITY_NET_BACKEND" cmd /k "cd backend && npx nodemon server.js"

echo [SYSTEM] STARTING FRONTEND VISUAL_INTERFACE...

start "CITY_NET_FRONTEND" cmd /k "cd frontend && npm run dev"

echo.
echo [SUCCESS] ALL SYSTEMS NOMINAL.
echo [LINK] APP RUNNING AT http://localhost:5173
echo.
pause
