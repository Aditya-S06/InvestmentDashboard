# Local setup for Market Intel Dashboard (Windows PowerShell)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

. "$PSScriptRoot\docker-common.ps1"

Write-Host "==> Checking Docker..." -ForegroundColor Cyan
if ((Invoke-Docker -Arguments @('info')) -ne 0) {
  Write-Host "Docker is not running. Start Docker Desktop, then run this script again." -ForegroundColor Red
  exit 1
}

Write-Host "==> Starting Postgres (docker compose)..." -ForegroundColor Cyan
if ((Invoke-Docker -Arguments @('compose', 'up', '-d')) -ne 0) { exit 1 }

Write-Host "==> Waiting for database..." -ForegroundColor Cyan
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  if ((Invoke-Docker -Arguments @('compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'market_intel')) -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Host "Postgres did not become ready in time." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example" -ForegroundColor Yellow
}

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  Write-Host "==> Creating Python venv..." -ForegroundColor Cyan
  python -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}

Write-Host "==> Prisma generate + db push + seed..." -ForegroundColor Cyan
npx prisma generate
npx prisma db push
npx prisma db seed

Write-Host ""
Write-Host "Setup complete. Run: npm run dev" -ForegroundColor Green
Write-Host "Login: john@doe.com / johndoe123" -ForegroundColor Green
