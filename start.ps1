# Game Server Startup Script
$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Multi-Game Server" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Check if port 8080 is in use
Write-Host "Checking port 8080..." -ForegroundColor Yellow
$portProcess = Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }

if ($portProcess) {
    $pid = $portProcess.OwningProcess
    Write-Host "Port 8080 is in use by process $pid" -ForegroundColor Magenta
    Write-Host "Killing process..." -ForegroundColor Yellow
    Stop-Process -Id $pid -Force
    Start-Sleep -Seconds 2
    Write-Host "Process killed!" -ForegroundColor Green
    Write-Host ""
}

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    Write-Host ""
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Failed to install dependencies!" -ForegroundColor Red
        Read-Host "Press any key to exit"
        exit 1
    }
    Write-Host ""
    Write-Host "Dependencies installed!" -ForegroundColor Green
    Write-Host ""
}

Write-Host "Starting server..." -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  URLs:" -ForegroundColor Magenta
Write-Host "  Game: http://localhost:8080" -ForegroundColor White
Write-Host "  Admin: http://localhost:8080/admin" -ForegroundColor White
Write-Host "  Token: admin-secret-token" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm start

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Server startup failed!" -ForegroundColor Red
    Read-Host "Press any key to exit"
}
