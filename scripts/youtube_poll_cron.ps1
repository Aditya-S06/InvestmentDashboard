# Nightly YouTube poll for Windows Task Scheduler.
# Example: schtasks /Create /TN "YouTubePoll" /SC DAILY /ST 06:00 /TR "powershell -File C:\path\to\scripts\youtube_poll_cron.ps1"
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { $Py = "python" }

$ChannelsFile = if ($env:YOUTUBE_CHANNELS_FILE) { $env:YOUTUBE_CHANNELS_FILE } else { "conf\youtube_channels.json" }
if (-not (Test-Path $ChannelsFile)) {
  if (Test-Path "conf\youtube_channels.json.example") {
    New-Item -ItemType Directory -Force -Path "conf" | Out-Null
    Copy-Item "conf\youtube_channels.json.example" "conf\youtube_channels.json"
    $ChannelsFile = "conf\youtube_channels.json"
  } else {
    throw "No channels file at $ChannelsFile"
  }
}

& $Py scripts\youtube_ingest.py poll $ChannelsFile
