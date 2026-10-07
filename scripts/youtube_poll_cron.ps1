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

# ProcessStartInfo works on Windows PowerShell 5.1 as well as PowerShell 7.
# Keep these runtime names in sync with lib/subprocess-env.ts.
$AllowedNames = @(
  'PATH', 'SystemRoot', 'WINDIR', 'COMSPEC',
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'PYTHONIOENCODING', 'PYTHONUTF8', 'PYTHONUNBUFFERED',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'YOUTUBE_API_KEY', 'OPENROUTER_API_KEY', 'YOUTUBE_CACHE_DIR', 'YOUTUBE_CHANNELS_FILE',
  'YOUTUBE_POLL_SINCE_DAYS', 'YOUTUBE_RATE_LIMIT_PER_MIN', 'YOUTUBE_SUMMARY_MODEL'
)
$StartInfo = New-Object System.Diagnostics.ProcessStartInfo
$StartInfo.FileName = $Py
$StartInfo.WorkingDirectory = $Root
$StartInfo.UseShellExecute = $false
$StartInfo.CreateNoWindow = $true
$StartInfo.RedirectStandardOutput = $true
$StartInfo.RedirectStandardError = $true
# Escape quotes and trailing backslashes using Windows argv quoting rules.
$QuotedChannelsFile = '"' + ($ChannelsFile -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
$StartInfo.Arguments = 'scripts\youtube_ingest.py poll ' + $QuotedChannelsFile
$StartInfo.EnvironmentVariables.Clear()
foreach ($Name in $AllowedNames) {
  $Value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ($null -ne $Value) { $StartInfo.EnvironmentVariables[$Name] = $Value }
}
$StartInfo.EnvironmentVariables['PYTHON_DOTENV_DISABLED'] = '1'
$PollProcess = [System.Diagnostics.Process]::Start($StartInfo)
try {
  # Drain both streams concurrently so a full stderr pipe cannot block stdout.
  $StdoutTask = $PollProcess.StandardOutput.ReadToEndAsync()
  $StderrTask = $PollProcess.StandardError.ReadToEndAsync()
  $PollProcess.WaitForExit()
  [Console]::Out.Write($StdoutTask.Result)
  [Console]::Error.Write($StderrTask.Result)
  $global:LASTEXITCODE = $PollProcess.ExitCode
} finally {
  $PollProcess.Dispose()
}
