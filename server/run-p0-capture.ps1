$ErrorActionPreference = 'Stop'

$places = @(
  '白云山', '陈家祠', '大夫山森林公园', '二沙岛', '广东省博物馆',
  '广州动物园', '广州塔', '广州图书馆', '海心沙', '海珠湖',
  '花城广场', '华南植物园', '黄埔军校', '莲花山', '南越王博物院',
  '沙面', '沙湾古镇', '永庆坊', '余荫山房', '越秀公园',
  '长隆', '中山纪念堂', '广东省妇幼保健院', '广东省人民医院', '广东省中医院',
  '广州市第一人民医院', '广州市妇女儿童医疗中心', '广州医科大学附属第一医院',
  '广州中医药大学第一附属医院', '南方医科大学南方医院', '中山大学附属第六医院',
  '中山大学附属第三医院', '中山大学附属第一医院', '中山大学孙逸仙纪念医院',
  '中山大学肿瘤防治中心'
)

$outputDir = Join-Path $PSScriptRoot 'xhs-p0-35'
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
    & $collector -Query $query -WaitSeconds 1 -OpenNotes 10 -OutputPath $outputPath
    $index += [ordered]@{ place = $place; query = $query; status = 'captured'; file = $outputPath }
  } catch {
    Write-Warning ("{0} 抓取失败：{1}" -f $place, $_.Exception.Message)
    $index += [ordered]@{ place = $place; query = $query; status = 'failed'; error = $_.Exception.Message }
  }
}

$index | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $outputDir 'index.json') -Encoding UTF8
Write-Host ("P0 抓取完成，结果目录：{0}" -f $outputDir)
