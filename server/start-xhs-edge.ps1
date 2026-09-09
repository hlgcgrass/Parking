<#
  启动一个独立的 Edge 调试窗口，避免影响用户现有浏览器。
  首次使用需要在新窗口中手动登录小红书；登录状态会保存在项目目录下的 .xhs-edge-profile。
#>
[CmdletBinding()]
param([int]$DebugPort = 9222)

$ErrorActionPreference = 'Stop'
$edgeCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$edge = $edgeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge was not found.' }

$profile = Join-Path (Split-Path $PSScriptRoot -Parent) '.xhs-edge-profile'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$arguments = @(
  "--remote-debugging-port=$DebugPort",
  "--user-data-dir=$profile",
  '--new-window',
  'https://www.xiaohongshu.com'
)
Start-Process -FilePath $edge -ArgumentList $arguments
Write-Host "Started debug Edge on port: $DebugPort"
Write-Host 'Sign in to Xiaohongshu in the new window, then run xhs-cdp-collector.ps1.'
