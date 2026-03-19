@echo off
title Build Game Server EXE
echo ========================================
echo   Building Game Server EXE
echo ========================================
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
)

:: Check if pkg is installed
echo Checking for pkg...
node -e "require('pkg')" >nul 2>&1
if errorlevel 1 (
    echo Installing pkg...
    call npm install --save-dev pkg
    if errorlevel 1 (
        echo.
        echo Failed to install pkg!
        pause
        exit /b 1
    )
    echo.
)

:: Create dist directory
if not exist "dist" mkdir "dist"

:: Build the EXE
echo Building EXE...
call npm run pkg

if errorlevel 1 (
    echo.
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete!
echo   Output: dist\game-server.exe
echo ========================================
echo.
pause
