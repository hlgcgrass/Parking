$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inputPath = if ($args.Count -ge 1) { Join-Path $root $args[0] } else { Join-Path $root 'server\xhs-processed-selected-20260913-import.json' }
$outputPath = if ($args.Count -ge 2) { Join-Path $root $args[1] } else { Join-Path $root 'server\xhs-processed-selected-20260913-geocoded.json' }
$keyPath = Join-Path $root 'server\keys\tencent-map.key'
$apiKey = if ($env:TENCENT_MAP_KEY) { $env:TENCENT_MAP_KEY.Trim() } elseif (Test-Path -LiteralPath $keyPath) { (Get-Content -Raw -LiteralPath $keyPath).Trim() } else { '' }
if (!$apiKey) { throw '缺少腾讯位置服务 Key：请设置 TENCENT_MAP_KEY 或 server/keys/tencent-map.key' }

$data = Get-Content -Raw -Encoding UTF8 -LiteralPath $inputPath | ConvertFrom-Json
$coordinateFields = @('lng', 'lat', 'coordinate_status', 'navigation_available', 'coordinate_source', 'coordinate_poi_name', 'coordinate_poi_id', 'coordinate_address', 'coordinate_match_score', 'coordinate_verified_at', 'entrance_verified')
foreach ($place in @($data.places)) {
  foreach ($field in $coordinateFields) {
    if (-not $place.PSObject.Properties[$field]) { $place | Add-Member -NotePropertyName $field -NotePropertyValue $null }
  }
  foreach ($parking in @($place.parkings)) {
    foreach ($field in $coordinateFields) {
      if (-not $parking.PSObject.Properties[$field]) { $parking | Add-Member -NotePropertyName $field -NotePropertyValue $null }
    }
  }
}

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return (($value.ToLowerInvariant() -replace '[（）()\s·、，,。/\\\-号栋室]', '') -replace '停车场|地下车库|地面车库|立体车库|车库|停车位|出入口|入口|出口', '')
}

function LongestShared([string]$left, [string]$right) {
  if ([string]::IsNullOrEmpty($left) -or [string]::IsNullOrEmpty($right)) { return 0 }
  $best = 0
  for ($i = 0; $i -lt $left.Length; $i++) {
    for ($j = 0; $j -lt $right.Length; $j++) {
      $k = 0
      while (($i + $k) -lt $left.Length -and ($j + $k) -lt $right.Length -and $left[$i + $k] -eq $right[$j + $k]) { $k++ }
      if ($k -gt $best) { $best = $k }
    }
  }
  return $best
}

function SearchTencent([string]$keyword) {
  $encoded = [uri]::EscapeDataString($keyword)
  $url = "https://apis.map.qq.com/ws/place/v1/search?keyword=$encoded&boundary=region(广州,0)&page_size=20&page_index=1&key=$apiKey"
  $response = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'ParkingCoordinateImporter/1.0' } -TimeoutSec 20
  if ([int]$response.status -ne 0) { throw "腾讯位置服务返回异常：$($response.message)" }
  return @($response.data)
}

function PlaceCandidate($place, $candidate) {
  $wanted = Normalize ([string]$place.name)
  $title = Normalize ([string]$candidate.title)
  $score = 0
  if ($title -eq $wanted) { $score += 60 }
  elseif ($title.Contains($wanted) -or $wanted.Contains($title)) { $score += 40 }
  $score += [Math]::Min(20, (LongestShared $wanted $title) * 3)
  if ([string]$candidate.address -match [regex]::Escape(([string]$place.district).Replace('区',''))) { $score += 8 }
  if ([string]$candidate.category -match '景点|商圈|公园|博物馆|动物园|地标|步行街|岛') { $score += 4 }
  [pscustomobject]@{ candidate = $candidate; score = $score; entrance = $false }
}

function ParkingCandidate($parking, $place, $candidate) {
  $wanted = Normalize ([string]$parking.name)
  $title = Normalize ([string]$candidate.title)
  $score = 0
  $category = [string]$candidate.category
  if ($category -match '停车场|停车库|停车场入口|通行设施') { $score += 12 } else { return $null }
  if ($title -eq $wanted) { $score += 60 }
  elseif ($title.Contains($wanted) -or $wanted.Contains($title)) { $score += 42 }
  $score += [Math]::Min(24, (LongestShared $wanted $title) * 4)
  if ($title -match '入口|出入口') { $score += 8 }
  if ([string]$candidate.address -match [regex]::Escape(([string]$place.district).Replace('区',''))) { $score += 6 }
  if ([string]$candidate.address -match [regex]::Escape(([string]$place.name))) { $score += 4 }
  [pscustomobject]@{ candidate = $candidate; score = $score; entrance = ($title -match '入口|出入口' -or $category -match '停车场入口') }
}

function ResolvePlace($place) {
  $candidates = SearchTencent ("广州 $([string]$place.name)")
  $ranked = @($candidates | ForEach-Object { PlaceCandidate $place $_ } | Sort-Object score -Descending)
  if (!$ranked.Count -or $ranked[0].score -lt 40) { return $null }
  return $ranked[0]
}

function ResolveParking($parking, $place) {
  $queries = @(
    "广州 $([string]$parking.name) $([string]$place.name)",
    "广州 $([string]$parking.name)",
    "广州 $([string]$parking.name) 入口"
  )
  $ranked = @()
  foreach ($query in $queries) {
    $candidates = SearchTencent $query
    $ranked = @($candidates | ForEach-Object { ParkingCandidate $parking $place $_ } | Where-Object { $null -ne $_ } | Sort-Object score -Descending)
    if ($ranked.Count -and $ranked[0].score -ge 55) { break }
    Start-Sleep -Milliseconds 350
  }
  $aliases = @{
    '越秀尚御大厦停车场' = '文德先生地下停车场'
    '广州货运保信息技术有限公司旁停车场' = '水荫直街36号地上停车场'
  }
  if (!$ranked.Count -and $aliases.ContainsKey([string]$parking.name)) {
    $aliasName = $aliases[[string]$parking.name]
    $aliasParking = [pscustomobject]@{ name = $aliasName }
    $aliasCandidates = SearchTencent ("广州 $aliasName")
    $ranked = @($aliasCandidates | ForEach-Object { ParkingCandidate $aliasParking $place $_ } | Where-Object { $null -ne $_ } | Sort-Object score -Descending)
  }
  if (!$ranked.Count -or $ranked[0].score -lt 45) { return $null }
  return $ranked[0]
}

$total = 0
$ready = 0
$pending = 0
$review = @()
$placeIndex = 0
foreach ($place in @($data.places)) {
  $placeIndex++
  try {
    $result = ResolvePlace $place
    if ($null -ne $result) {
      $candidate = $result.candidate
      $place.lng = [double]$candidate.location.lng
      $place.lat = [double]$candidate.location.lat
      $place.coordinate_status = '待核验'
      $place.navigation_available = $false
      $place.coordinate_source = '腾讯位置服务 WebService 地点搜索'
      $place.coordinate_poi_name = [string]$candidate.title
      $place.coordinate_poi_id = [string]$candidate.id
      $place.coordinate_address = [string]$candidate.address
      $place.coordinate_match_score = $result.score
      $place.coordinate_verified_at = (Get-Date).ToString('o')
      $review += [pscustomobject]@{ level = '地点'; place = $place.name; name = $place.name; poi = $candidate.title; address = $candidate.address; score = $result.score; entrance = $false; status = '待核验' }
      $ready++
    } else {
      $place.coordinate_status = '待补充'; $place.navigation_available = $false; $pending++
      $review += [pscustomobject]@{ level = '地点'; place = $place.name; name = $place.name; poi = ''; address = ''; score = 0; entrance = $false; status = '待补充' }
    }
  } catch {
    $place.coordinate_status = '待补充'; $place.navigation_available = $false; $pending++
    $review += [pscustomobject]@{ level = '地点'; place = $place.name; name = $place.name; poi = ''; address = $_.Exception.Message; score = 0; entrance = $false; status = '待补充' }
  }
  Start-Sleep -Milliseconds 350

  foreach ($parking in @($place.parkings)) {
    $total++
    try {
      $result = ResolveParking $parking $place
      if ($null -ne $result) {
        $candidate = $result.candidate
        $parking.lng = [double]$candidate.location.lng
        $parking.lat = [double]$candidate.location.lat
        $parking.coordinate_status = '待核验'
        $parking.navigation_available = $false
        $parking.coordinate_source = '腾讯位置服务 WebService 地点搜索'
        $parking.coordinate_poi_name = [string]$candidate.title
        $parking.coordinate_poi_id = [string]$candidate.id
        $parking.coordinate_address = [string]$candidate.address
        $parking.coordinate_match_score = $result.score
        $parking.entrance_verified = [bool]$result.entrance
        $parking.coordinate_verified_at = (Get-Date).ToString('o')
        $review += [pscustomobject]@{ level = '停车场'; place = $place.name; name = $parking.name; poi = $candidate.title; address = $candidate.address; score = $result.score; entrance = [bool]$result.entrance; status = '待核验' }
        $ready++
      } else {
        $parking.coordinate_status = '待补充'; $parking.navigation_available = $false; $pending++
        $review += [pscustomobject]@{ level = '停车场'; place = $place.name; name = $parking.name; poi = ''; address = ''; score = 0; entrance = $false; status = '待补充' }
      }
    } catch {
      $parking.coordinate_status = '待补充'; $parking.navigation_available = $false; $pending++
      $review += [pscustomobject]@{ level = '停车场'; place = $place.name; name = $parking.name; poi = ''; address = $_.Exception.Message; score = 0; entrance = $false; status = '待补充' }
    }
    if (($total % 5) -eq 0) { Write-Output ("processed={0} matched={1} pending={2}" -f $total,$ready,$pending) }
    Start-Sleep -Milliseconds 450
  }
}

$data | Add-Member -NotePropertyName coordinate_run_at -NotePropertyValue (Get-Date).ToString('o') -Force
$data | Add-Member -NotePropertyName coordinates_ready -NotePropertyValue $ready -Force
$data | Add-Member -NotePropertyName coordinates_pending -NotePropertyValue $pending -Force
$data | Add-Member -NotePropertyName coordinate_provider -NotePropertyValue '腾讯位置服务 WebService 地点搜索' -Force
$data | Add-Member -NotePropertyName coordinate_review -NotePropertyValue $review -Force
$data | ConvertTo-Json -Depth 40 | Set-Content -Encoding UTF8 -LiteralPath $outputPath

$reviewPath = [System.IO.Path]::ChangeExtension($outputPath, '.review.json')
$review | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $reviewPath
Write-Output ("output={0} review={1} total={2} matched={3} pending={4}" -f $outputPath,$reviewPath,$total,$ready,$pending)
