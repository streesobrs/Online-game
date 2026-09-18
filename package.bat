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

REM Regenerate changelog from git history (fails safely, keeps existing file)
echo Generating changelog...
node scripts\gen-changelog.js
echo.

if exist "temp-package" rmdir /s /q "temp-package"
mkdir "temp-package"

echo Copying client folder...
xcopy "client" "temp-package\client\" /E /I /Y >nul

echo Copying client-v2 folder...
xcopy "client-v2" "temp-package\client-v2\" /E /I /Y >nul

echo Copying server folder...
xcopy "server" "temp-package\server\" /E /I /Y >nul

echo Removing runtime data and logs...
if exist "temp-package\server\logs" rmdir /s /q "temp-package\server\logs"
if exist "temp-package\data" rmdir /s /q "temp-package\data"

echo Copying updater folder...
xcopy "updater" "temp-package\updater\" /E /I /Y >nul

echo Copying root files...
copy "package.json" "temp-package\" >nul
copy "start.bat" "temp-package\" >nul
copy "start.ps1" "temp-package\" >nul

REM 打包产物不带 scripts/ 目录，去掉依赖它的开发期脚本，
REM 否则部署后 npm start 会在 prestart 阶段报 MODULE_NOT_FOUND 直接退出
echo Patching package.json for runtime...
node -e "const fs=require('fs');const p='temp-package/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));for(const k of ['prestart','predev','changelog'])delete j.scripts[k];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
if errorlevel 1 echo [Warning] package.json patch failed, npm start may break on the target machine

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