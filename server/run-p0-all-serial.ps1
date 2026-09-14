$ErrorActionPreference = 'Stop'

# P0 全部45个地点：严格串行处理，每次等待搜索结果和笔记页面完成后再继续。
$places = @(
  # 景点与公共文化
  '白云山', '陈家祠', '大夫山森林公园', '二沙岛', '广东省博物馆',
  '广州动物园', '广州塔', '广州图书馆', '海心沙', '海珠湖',
  '花城广场', '华南植物园', '黄埔军校', '莲花山', '南越王博物院',
  '沙面', '沙湾古镇', '永庆坊', '余荫山房', '越秀公园', '长隆', '中山纪念堂',
  # 医院
  '广东省妇幼保健院', '广东省人民医院', '广东省中医院', '广州市第一人民医院',
  '广州市妇女儿童医疗中心', '广州医科大学附属第一医院', '广州中医药大学第一附属医院',
  '南方医科大学南方医院', '中山大学附属第六医院', '中山大学附属第三医院',
  '中山大学附属第一医院', '中山大学孙逸仙纪念医院', '中山大学肿瘤防治中心',
  # 热门街区、核心片区与商业地标
  '北京路', '体育西路', '珠江新城', '上下九', '番禺万博', '江南西',
  '黄埔大沙地', '岗顶', '五羊新城', '琶洲'
)

$outputDir = Join-Path $PSScriptRoot 'xhs-p0-all-serial-20260910'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$collector = Join-Path $PSScriptRoot 'xhs-cdp-collector.ps1'
$index = @()

for ($i = 0; $i -lt $places.Count; $i++) {
  $place = $places[$i]
  $query = "广州 $place 停车攻略"
  $safeName = $place -replace '[\\/:*?""<>|]', '_'
  $outputPath = Join-Path $outputDir (('{0:D2}-{1}.json' -f ($i + 1), $safeName))
  Write-Host ("[{0:D2}/{1}] 开始：{2}" -f ($i + 1), $places.Count, $query)
  if (Test-Path -LiteralPath $outputPath) {
    try {
      $existing = Get-Content -Raw -LiteralPath $outputPath | ConvertFrom-Json
      if ($existing.sort_mode -eq '最多点赞' -and -not $existing.blocked_or_incomplete -and @($existing.notes).Count -ge 10) {
        $index += [ordered]@{ place = $place; query = $query; status = 'already_captured'; file = $outputPath }
        Write-Host ("[{0:D2}/{1}] 已存在完整抓取结果，跳过：{2}" -f ($i + 1), $places.Count, $place)
        continue
      }
    } catch {
      Write-Warning ("已有文件无法读取，将重新抓取：{0}" -f $outputPath)
    }
  }
  try {
    # 每个地点最多打开排序后的10条笔记；后续整理阶段再按规则过滤、去重。
    # 若页面未稳定或被风控降级为不完整结果，等待后重试一次。
    $captured = $false
    for ($attempt = 1; $attempt -le 2; $attempt++) {
      try {
        & $collector -Query $query -WaitSeconds 8 -PageReadyTimeoutSeconds 60 -OpenNotes 10 -OutputPath $outputPath
        $check = Get-Content -Raw -LiteralPath $outputPath | ConvertFrom-Json
        if ($check.sort_mode -ne '最多点赞' -or $check.blocked_or_incomplete -or @($check.notes).Count -lt 10) {
          throw ("结果不完整：sort_mode={0}; notes={1}; blocked={2}" -f $check.sort_mode, @($check.notes).Count, $check.blocked_or_incomplete)
        }
        $captured = $true
        break
      } catch {
        if ($attempt -lt 2) {
          Write-Warning ("{0} 第{1}次结果不完整，等待后重试：{2}" -f $place, $attempt, $_.Exception.Message)
          Start-Sleep -Seconds 20
        } else {
          throw
        }
      }
    }
    $index += [ordered]@{ place = $place; query = $query; status = 'captured'; file = $outputPath }
    Write-Host ("[{0:D2}/{1}] 完成：{2}" -f ($i + 1), $places.Count, $place)
  } catch {
    Write-Warning ("{0} 抓取失败：{1}" -f $place, $_.Exception.Message)
    $index += [ordered]@{ place = $place; query = $query; status = 'failed'; error = $_.Exception.Message }
  }
  Start-Sleep -Seconds 5
}

$index | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $outputDir 'index.json') -Encoding UTF8
Write-Host ("P0 全部45个地点串行抓取完成，结果目录：{0}" -f $outputDir)
