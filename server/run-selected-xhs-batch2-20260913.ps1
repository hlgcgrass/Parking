$ErrorActionPreference = 'Stop'

$queries = @(
  '广州 白云山 停车攻略',
  '广州 陈家祠 停车攻略',
  '广州 越秀公园 停车攻略',
  '广州 花城广场 停车攻略',
  '广州 海心沙 停车攻略'
)

$collector = Join-Path $PSScriptRoot 'xhs-cdp-collector.ps1'
$outputPath = Join-Path $PSScriptRoot 'xhs-captures-selected-batch2-20260913.json'
$rawOutputDir = Join-Path $PSScriptRoot 'xhs-raw\selected-batch2-20260913'

& $collector -Query $queries -WaitSeconds 8 -PageReadyTimeoutSeconds 60 -OpenNotes 10 -OutputPath $outputPath -RawOutputDir $rawOutputDir
