$ErrorActionPreference = 'Stop'

$queries = @(
  '广州 北京路 停车攻略',
  '广州 沙面 停车攻略',
  '广州 广州塔 停车攻略',
  '广州 上下九 停车攻略',
  '广州 广东省博物馆 停车攻略',
  '广州 广州动物园 停车攻略'
)

$outputPath = Join-Path $PSScriptRoot 'xhs-captures-selected-20260913.json'
$rawOutputDir = Join-Path $PSScriptRoot 'xhs-raw\selected-20260913'
$collector = Join-Path $PSScriptRoot 'xhs-cdp-collector.ps1'

& $collector -Query $queries -WaitSeconds 8 -PageReadyTimeoutSeconds 60 -OpenNotes 10 -OutputPath $outputPath -RawOutputDir $rawOutputDir
