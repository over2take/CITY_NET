@echo off
REM City_Net - start the app (manual/Node.js install)
REM Docker users don't need this: use  docker compose up -d  instead.

cd /d "%~dp0"

if not exist "backend\.env" (
    echo   No configuration found ^(backend\.env missing^).
    echo   Run setup first: double-click setup.bat
    pause
    exit /b 1
)

if not exist "frontend\dist" (
    echo   Frontend is not built yet ^(frontend\dist missing^).
    echo   Run setup first: double-click setup.bat
    pause
    exit /b 1
)

echo   Starting City_Net... ^(press Ctrl+C to stop; closing this window stops the app^)
cd backend
node server.js
pause
