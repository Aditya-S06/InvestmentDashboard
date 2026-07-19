# Links local .env to the InvestmentDashboard Supabase project.
# Usage:
#   .\scripts\link-supabase.ps1
#   .\scripts\link-supabase.ps1 -DatabasePassword 'YOUR_DB_PASSWORD'
#   .\scripts\link-supabase.ps1 -Repair
#       (reuses password already in DATABASE_URL and finds a working pooler host)
#
# Get the password from:
#   Supabase Dashboard -> Project Settings -> Database -> Database password
# Or copy full Prisma URIs from:
#   Dashboard -> Connect -> ORM -> Prisma

param(
  [string]$DatabasePassword = '',
  [string]$ProjectRef = 'yqugkmikyfpmgjawebfr',
  [string]$Region = 'us-east-2',
  [switch]$Repair
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root '.env'

if (-not (Test-Path $EnvFile)) {
  throw ".env not found at $EnvFile - copy .env.example first."
}

function Get-EnvValue([string]$content, [string]$key) {
  $match = [regex]::Match($content, "(?m)^\s*$([regex]::Escape($key))\s*=\s*(.*)$")
  if (-not $match.Success) { return $null }
  return $match.Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Set-EnvLine([string]$content, [string]$key, [string]$value) {
  $pattern = "(?m)^\s*$([regex]::Escape($key))\s*=.*$"
  $line = "$key=`"$value`""
  if ($content -match $pattern) {
    return [regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $line })
  }
  if (-not $content.EndsWith("`n")) { $content += "`r`n" }
  return $content + $line + "`r`n"
}

function Get-PasswordFromDatabaseUrl([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return $null }
  # postgresql://user:pass@host/db
  $m = [regex]::Match($url, '^[^:]+:\/\/(?:[^:\/?#]+):([^@\/]+)@')
  if (-not $m.Success) { return $null }
  return [Uri]::UnescapeDataString($m.Groups[1].Value)
}

function Test-PrismaConnection([string]$databaseUrl, [string]$directUrl) {
  $env:DATABASE_URL = $databaseUrl
  $env:DIRECT_URL = $directUrl
  $tmp = Join-Path $env:TEMP ("prisma-conn-test-" + [guid]::NewGuid().ToString('N') + ".sql")
  Set-Content -Path $tmp -Value 'SELECT 1;' -Encoding ascii
  # npm writes warnings to stderr; with $ErrorActionPreference=Stop that becomes a terminating NativeCommandError
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $prisma = Join-Path $Root 'node_modules\.bin\prisma.cmd'
    if (-not (Test-Path $prisma)) { $prisma = Join-Path $Root 'node_modules\.bin\prisma' }
    $output = & $prisma db execute --file $tmp --schema (Join-Path $Root 'prisma\schema.prisma') 2>&1
    $code = $LASTEXITCODE
    if ($code -eq 0) { return $true }
    $joined = (($output | ForEach-Object { "$_" }) -join ' ').Trim() -replace '\s+', ' '
    Write-Host ("  probe failed: " + $joined) -ForegroundColor DarkYellow
    return $false
  } catch {
    Write-Host ("  probe failed: " + $_.Exception.Message) -ForegroundColor DarkYellow
    return $false
  } finally {
    $ErrorActionPreference = $prevEap
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  }
}

$raw = Get-Content -Raw $EnvFile

if ($Repair -and [string]::IsNullOrWhiteSpace($DatabasePassword)) {
  $DatabasePassword = Get-PasswordFromDatabaseUrl (Get-EnvValue $raw 'DATABASE_URL')
  if ([string]::IsNullOrWhiteSpace($DatabasePassword)) {
    throw 'Repair mode could not read a password from DATABASE_URL. Re-run without -Repair and paste the password.'
  }
  Write-Host 'Repair mode: reusing password already stored in DATABASE_URL' -ForegroundColor Cyan
}

if ([string]::IsNullOrWhiteSpace($DatabasePassword)) {
  $secure = Read-Host -AsSecureString 'Paste Supabase database password (hidden)'
  $DatabasePassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )
}

if ([string]::IsNullOrWhiteSpace($DatabasePassword)) {
  throw 'Database password is required.'
}

$encoded = [Uri]::EscapeDataString($DatabasePassword)
$supabaseUrl = "https://$ProjectRef.supabase.co"

# Prefer shared pooler (IPv4). Direct db.*.supabase.co is often IPv6-only on free tier.
# Newer projects are frequently on aws-1-<region>, not aws-0-<region>.
$poolerCandidates = @(
  "aws-1-$Region.pooler.supabase.com",
  "aws-0-$Region.pooler.supabase.com"
)

$chosen = $null
foreach ($poolerHost in $poolerCandidates) {
  Write-Host "Testing pooler $poolerHost ..." -ForegroundColor Cyan

  # Transaction mode for app runtime
  $databaseUrl = "postgresql://postgres.$ProjectRef`:$encoded@$poolerHost`:6543/postgres?pgbouncer=true&connection_limit=1"
  # Session mode for migrations / seed
  $directUrl = "postgresql://postgres.$ProjectRef`:$encoded@$poolerHost`:5432/postgres"

  if (Test-PrismaConnection $databaseUrl $directUrl) {
    $chosen = @{ Host = $poolerHost; DatabaseUrl = $databaseUrl; DirectUrl = $directUrl }
    break
  }
}

if (-not $chosen) {
  Write-Host 'Pooler probes failed. Trying direct db host (may require IPv6)...' -ForegroundColor Yellow
  $databaseUrl = "postgresql://postgres:$encoded@db.$ProjectRef.supabase.co:5432/postgres?sslmode=require"
  $directUrl = $databaseUrl
  if (Test-PrismaConnection $databaseUrl $directUrl) {
    $chosen = @{ Host = "db.$ProjectRef.supabase.co"; DatabaseUrl = $databaseUrl; DirectUrl = $directUrl }
  }
}

if (-not $chosen) {
  throw @"
Could not connect to Supabase with the password provided.

Open the dashboard Connect panel and copy the Prisma URLs exactly:
  https://supabase.com/dashboard/project/${ProjectRef}?showConnect=true&method=transaction

Then either:
  1) Paste those into .env as DATABASE_URL / DIRECT_URL, or
  2) Re-run this script after resetting the database password.
"@
}

$raw = Set-EnvLine $raw 'DATABASE_URL' $chosen.DatabaseUrl
$raw = Set-EnvLine $raw 'DIRECT_URL' $chosen.DirectUrl
$raw = Set-EnvLine $raw 'SUPABASE_URL' $supabaseUrl
$raw = Set-EnvLine $raw 'NEXT_PUBLIC_SUPABASE_URL' $supabaseUrl
Set-Content -Path $EnvFile -Value $raw -NoNewline

Write-Host ''
Write-Host 'Updated .env (secrets not printed):' -ForegroundColor Green
Write-Host ("  pooler host   -> " + $chosen.Host)
Write-Host '  DATABASE_URL  -> transaction pooler :6543 (or direct)'
Write-Host '  DIRECT_URL    -> session/direct :5432'
Write-Host "  SUPABASE_URL  -> $supabaseUrl"
Write-Host ''
Write-Host 'Next:' -ForegroundColor Cyan
Write-Host '  npx prisma generate'
Write-Host '  npx prisma db seed'
Write-Host '  npm run dev'
Write-Host ''
Write-Host 'You can quit Docker Desktop - local Postgres is no longer required.' -ForegroundColor Yellow
