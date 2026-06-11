function Get-DockerExecutable {
  $candidates = @(
    "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
    "${env:ProgramFiles}\Docker\Docker\resources\docker.exe"
  )

  foreach ($path in $candidates) {
    if (Test-Path $path) { return $path }
  }

  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  return $null
}

function Invoke-Docker {
  param([string[]]$Arguments)

  $docker = Get-DockerExecutable
  if (-not $docker) {
    Write-Host ""
    Write-Host "Docker CLI not found." -ForegroundColor Red
    Write-Host "1. Open Docker Desktop and wait until it says 'Engine running'." -ForegroundColor Yellow
    Write-Host "2. Close this terminal, open a NEW PowerShell window, and try again." -ForegroundColor Yellow
    Write-Host "3. Test manually:" -ForegroundColor Yellow
    Write-Host '   & "C:\Program Files\Docker\Docker\resources\bin\docker.exe" version' -ForegroundColor Gray
    Write-Host "4. Or install PostgreSQL locally (see README.md)." -ForegroundColor Yellow
    exit 1
  }

  & $docker @Arguments
  return $LASTEXITCODE
}
