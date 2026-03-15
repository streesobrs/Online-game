@echo off
title Game Server
echo ========================================
echo   Multi-Game Server
echo ========================================
echo.

cd /d "%~dp0"

:: Check if port 8080 is in use
echo Checking port 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8080" ^| find "LISTENING"') do (
    set PID=%%a
)

if defined PID (
    echo Port 8080 is in use by process %PID%
    echo Killing process...
    taskkill /F /PID %PID%
    timeout /t 2 /nobreak >nul
    echo Process killed!
    echo.
)

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies!
        pause
        exit /b 1
    )
    echo Dependencies installed!
    echo.
)

echo Starting server...
echo.
echo ========================================
echo   URLs:
echo   Game: http://localhost:8080
echo   Admin: http://localhost:8080/admin
echo   Token: admin-secret-token
echo ========================================
echo.

npm start

if errorlevel 1 (
    echo.
    echo Server startup failed!
    pause
)
