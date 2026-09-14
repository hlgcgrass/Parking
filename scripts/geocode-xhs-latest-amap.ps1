$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inputPath = if ($args.Count -ge 1) { Join-Path $root $args[0] } else { Join-Path $root 'server\xhs-p0-latest-20260914-import.json' }
$outputPath = if ($args.Count -ge 2) { Join-Path $root $args[1] } else { Join-Path $root 'server\xhs-p0-latest-20260914-geocoded.json' }
$apiKey = 'ab403a9b356e63c917ff05b037cd3e7d'
$apiVersion = '2.3.5.6'

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return (($value.ToLowerInvariant() -replace '[（）()\s·、，,。/\\\-号栋室]', '') -replace '华南国家植物园', '华南植物园' -replace '停车场|地下车库|地面车库|立体车库|车库|停车位|出入口|入口|出口', '')
}
function LongestShared([string]$left, [string]$right) {
  if ([string]::IsNullOrEmpty($left) -or [string]::IsNullOrEmpty($right)) { return 0 }
  $best = 0
  for ($i = 0; $i -lt $left.Length; $i++) { for ($j = 0; $j -lt $right.Length; $j++) { $k = 0; while (($i + $k) -lt $left.Length -and ($j + $k) -lt $right.Length -and $left[$i + $k] -eq $right[$j + $k]) { $k++ }; if ($k -gt $best) { $best = $k } } }
  return $best
}
function SearchPoi([string]$query) {
  $encoded = [uri]::EscapeDataString($query)
  $url = "https://m.amap.com/_AMapService/v3/place/text?platform=JS&s=rsv3&logversion=2.0&key=$apiKey&sdkversion=$apiVersion&appname=AMap.PlaceSearch&csid=$([guid]::NewGuid())&keywords=$encoded&city=440100&citylimit=true&offset=20&page=1&extensions=all&language=zh_cn&children=1"
  $response = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' } -TimeoutSec 20
  if ([string]$response.status -ne '1') { return @() }
  return @($response.pois)
}
function Coordinate($candidate) {
  $main = ([string]$candidate.location) -split ','
  $entrance = ([string]$candidate.entr_location) -split ','
  $useEntrance = $entrance.Count -eq 2 -and $entrance[0] -match '^\d+\.\d+$' -and $entrance[1] -match '^\d+\.\d+$'
  [pscustomobject]@{
    lng = [double](if ($useEntrance) { $entrance[0] } else { $main[0] })
    lat = [double](if ($useEntrance) { $entrance[1] } else { $main[1] })
    coordinate_status = '已核验'
    navigation_available = $true
    coordinate_source = if ($useEntrance) { '高德地图停车场POI入口坐标' } else { '高德地图停车场POI中心坐标（入口未单独提供）' }
    coordinate_poi_name = [string]$candidate.name
    coordinate_poi_id = [string]$candidate.id
    coordinate_address = [string]$candidate.address
    coordinate_verified_at = (Get-Date).ToString('o')
  }
}
function PickPlace($place, $candidates) {
  $wanted = Normalize ([string]$place.name)
  $district = ([string]$place.district) -replace '区$',''
  $ranked = foreach ($candidate in $candidates) {
    $title = Normalize ([string]$candidate.name)
    $score = 0
    if ($title -eq $wanted) { $score += 60 } elseif ($title.Contains($wanted) -or $wanted.Contains($title)) { $score += 40 }
    $score += [Math]::Min(24, (LongestShared $wanted $title) * 3)
    if ([string]$candidate.address -match [regex]::Escape($district)) { $score += 8 }
    [pscustomobject]@{ candidate = $candidate; score = $score }
  }
  @($ranked | Sort-Object score -Descending)[0]
}
function PickParking($parking, $place, $candidates) {
  $wanted = Normalize ([string]$parking.name)
  $placeWanted = Normalize ([string]$place.name)
  $district = ([string]$place.district) -replace '区$',''
  $ranked = foreach ($candidate in $candidates) {
    $title = Normalize ([string]$candidate.name)
    $type = [string]$candidate.type
    if ($type -notmatch '停车场|停车库|通行设施' -and $title -notmatch '停车|车库|P\d') { continue }
    $shared = LongestShared $wanted $title
    $score = $shared * 5
    if ($title -eq $wanted) { $score += 60 } elseif ($title.Contains($wanted) -or $wanted.Contains($title)) { $score += 42 }
    if ($title -match '入口|出入口') { $score += 8 }
    if ([string]$candidate.address -match [regex]::Escape($district)) { $score += 6 }
    if ([string]$candidate.address -match [regex]::Escape(([string]$place.name).Replace('（珠江新城院区）',''))) { $score += 4 }
    [pscustomobject]@{ candidate = $candidate; score = $score; shared = $shared }
  }
  $top = @($ranked | Sort-Object score -Descending)[0]
  if ($null -eq $top -or ($top.shared -lt 3 -and $top.score -lt 45) -or $top.score -lt 45) { return $null }
  $top
}

$data = Get-Content -Raw -Encoding UTF8 -LiteralPath $inputPath | ConvertFrom-Json
$review = @()
$total = 0; $ready = 0; $pending = 0
foreach ($place in @($data.places)) {
  try {
    $result = PickPlace $place (SearchPoi ("广州 $([string]$place.name)"))
    if ($null -ne $result -and $result.score -ge 40) {
      $place.lng = [double]$result.candidate.location.Split(',')[0]
      $place.lat = [double]$result.candidate.location.Split(',')[1]
      $place.coordinate_status = '已核验'; $place.navigation_available = $true
      $place.coordinate_source = '高德地图地点POI名称与地址复核'; $place.coordinate_poi_name = [string]$result.candidate.name; $place.coordinate_poi_id = [string]$result.candidate.id; $place.coordinate_address = [string]$result.candidate.address; $place.coordinate_verified_at = (Get-Date).ToString('o')
      $review += [pscustomobject]@{ level='地点'; place=$place.name; name=$place.name; poi=$result.candidate.name; address=$result.candidate.address; score=$result.score; status='已核验' }
    } else { $place.coordinate_status = '待补充'; $place.navigation_available = $false; $review += [pscustomobject]@{ level='地点'; place=$place.name; name=$place.name; poi=''; address='无高置信候选'; score=0; status='待补充' }; $pending++ }
  } catch { $place.coordinate_status='待补充'; $place.navigation_available=$false; $review += [pscustomobject]@{ level='地点'; place=$place.name; name=$place.name; poi=''; address=$_.Exception.Message; score=0; status='待补充' }; $pending++ }
  Start-Sleep -Milliseconds 250
  foreach ($parking in @($place.parkings)) {
    $total++
    try {
      $picked = $null
      foreach ($query in @("广州 $([string]$parking.name) $([string]$place.name)", "广州 $([string]$parking.name)", "广州 $([string]$parking.location)")) {
        $picked = PickParking $parking $place (SearchPoi $query)
        if ($null -ne $picked) { break }
        Start-Sleep -Milliseconds 200
      }
      if ($null -ne $picked) {
        $c = Coordinate $picked.candidate
        foreach ($prop in $c.PSObject.Properties) { $parking | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value -Force }
        $review += [pscustomobject]@{ level='停车场'; place=$place.name; name=$parking.name; poi=$picked.candidate.name; address=$picked.candidate.address; score=$picked.score; status='已核验' }; $ready++
      } else { $parking.coordinate_status='待补充'; $parking.navigation_available=$false; $review += [pscustomobject]@{ level='停车场'; place=$place.name; name=$parking.name; poi=''; address='无高置信候选'; score=0; status='待补充' }; $pending++ }
    } catch { $parking.coordinate_status='待补充'; $parking.navigation_available=$false; $review += [pscustomobject]@{ level='停车场'; place=$place.name; name=$parking.name; poi=''; address=$_.Exception.Message; score=0; status='待补充' }; $pending++ }
    if (($total % 5) -eq 0) { Write-Output ("processed={0} ready={1} pending={2}" -f $total,$ready,$pending) }
    Start-Sleep -Milliseconds 300
  }
}
$data | Add-Member -NotePropertyName coordinate_run_at -NotePropertyValue (Get-Date).ToString('o') -Force
$data | Add-Member -NotePropertyName coordinates_ready -NotePropertyValue $ready -Force
$data | Add-Member -NotePropertyName coordinates_pending -NotePropertyValue $pending -Force
$data | Add-Member -NotePropertyName coordinate_review -NotePropertyValue $review -Force
$data | ConvertTo-Json -Depth 40 | Set-Content -Encoding UTF8 -LiteralPath $outputPath
$reviewPath = [System.IO.Path]::ChangeExtension($outputPath, '.review.json')
$review | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -LiteralPath $reviewPath
Write-Output ("output={0} review={1} total={2} ready={3} pending={4}" -f $outputPath,$reviewPath,$total,$ready,$pending)
