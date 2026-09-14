<#
  启动独立的 Chrome 小红书采集窗口。
  使用全新配置目录，不读取或复制现有浏览器登录态。
#>
[CmdletBinding()]
param([int]$DebugPort = 9222)

$ErrorActionPreference = 'Stop'
$chromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome was not found.' }

$profile = Join-Path (Split-Path $PSScriptRoot -Parent) '.xhs-chrome-profile'
New-Item -ItemType Directory -Path $profile -Force | Out-Null
$arguments = @(
  "--remote-debugging-port=$DebugPort",
  '--remote-debugging-address=127.0.0.1',
  "--user-data-dir=$profile",
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--new-window',
  'https://www.xiaohongshu.com'
)
Start-Process -FilePath $chrome -ArgumentList $arguments
Write-Host "Started dedicated Chrome on port: $DebugPort"
Write-Host 'Sign in to Xiaohongshu in the new window, then tell Codex: 已登录.'
