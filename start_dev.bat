@echo off
title CITY_NET // DEV SERVER

echo [SYSTEM] CURRENT BRANCH:
git branch --show-current

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

echo [SYSTEM] STARTING BACKEND (DEV MODE)...
start "CITY_NET_BACKEND" cmd /k "cd backend && npx nodemon server.js"

echo [SYSTEM] STARTING FRONTEND (DEV MODE)...
start "CITY_NET_FRONTEND" cmd /k "cd frontend && npm run dev"

echo.
echo [SUCCESS] DEV SYSTEMS NOMINAL.
echo [LINK] BACKEND RUNNING ON 5000 / FRONTEND ON 5173
echo.
pause
