$ErrorActionPreference = 'Stop'

# P0 前 10 个地点：严格串行处理，每次等待页面内容完成后再进行下一步。
$places = @(
  '白云山', '陈家祠', '大夫山森林公园', '二沙岛', '广东省博物馆',
  '广州动物园', '广州塔', '广州图书馆', '海心沙', '海珠湖'
)

$outputDir = Join-Path $PSScriptRoot 'xhs-p0-first10-restart'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$collector = Join-Path $PSScriptRoot 'xhs-cdp-collector.ps1'
$index = @()

for ($i = 0; $i -lt $places.Count; $i++) {
  $place = $places[$i]
  $query = "广州 $place 停车攻略"
  $safeName = $place -replace '[\\/:*?"<>|]', '_'
  $outputPath = Join-Path $outputDir (('{0:D2}-{1}.json' -f ($i + 1), $safeName))
  Write-Host ("[{0:D2}/{1}] 开始：{2}" -f ($i + 1), $places.Count, $query)
  try {
    & $collector -Query $query -WaitSeconds 4 -PageReadyTimeoutSeconds 45 -OpenNotes 5 -OutputPath $outputPath
    $index += [ordered]@{ place = $place; query = $query; status = 'captured'; file = $outputPath }
  } catch {
    Write-Warning ("{0} 抓取失败：{1}" -f $place, $_.Exception.Message)
    $index += [ordered]@{ place = $place; query = $query; status = 'failed'; error = $_.Exception.Message }
  }
  Start-Sleep -Seconds 3
}

$index | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $outputDir 'index.json') -Encoding UTF8
Write-Host ("P0 前 10 个地点抓取完成，结果目录：{0}" -f $outputDir)
