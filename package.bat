@echo off
title Package Game Server
echo ========================================
echo   Packaging Game Server
echo ========================================
echo.

cd /d "%~dp0"

REM Read version number from version.json using node
for /f "delims=" %%a in ('node -e "const v = require('./server/version.json'); console.log(v.major + '.' + v.minor + '.' + v.patch + '.' + v.build)"') do set VERSION=%%a

REM Get current date in YYYYMMDD format using PowerShell (locale independent)
for /f %%i in ('powershell -Command "Get-Date -Format yyyyMMdd"') do set TODAY=%%i

set PACKAGE_NAME=game-server-v%VERSION%-%TODAY%
set ZIP_NAME=%PACKAGE_NAME%.zip

echo Preparing package...
echo.

if exist "temp-package" rmdir /s /q "temp-package"
mkdir "temp-package"

echo Copying server folder...
xcopy "server" "temp-package\server\" /E /I /Y >nul

echo Removing logs and data...
if exist "temp-package\server\logs" rmdir /s /q "temp-package\server\logs"
if exist "temp-package\server\data" rmdir /s /q "temp-package\server\data"

echo Copying other files...
copy "index.html" "temp-package\" >nul
copy "package.json" "temp-package\" >nul
copy "start.bat" "temp-package\" >nul
copy "start.ps1" "temp-package\" >nul

echo Creating zip file: %ZIP_NAME%
powershell -Command "Compress-Archive -Path 'temp-package\*' -DestinationPath '%ZIP_NAME%' -Force"

echo Cleaning up...
rmdir /s /q "temp-package"

echo.
echo ========================================
echo   Packaging complete!
echo   File: %ZIP_NAME%
echo ========================================
echo.
pause