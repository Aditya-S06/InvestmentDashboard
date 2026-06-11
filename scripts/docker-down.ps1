Set-Location $PSScriptRoot\..
. "$PSScriptRoot\docker-common.ps1"
exit (Invoke-Docker -Arguments @('compose', 'down'))
