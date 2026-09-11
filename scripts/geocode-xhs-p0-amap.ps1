$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inputPath = Join-Path $root 'server\xhs-p0-import-41.json'
$outputPath = Join-Path $root 'server\xhs-p0-import-41-geocoded.json'
$data = Get-Content -Raw -Encoding UTF8 $inputPath | ConvertFrom-Json

$apiKey = 'ab403a9b356e63c917ff05b037cd3e7d'
$apiVersion = '2.3.5.6'
$generic = '^(地下停车场|地面停车场|医院停车场|广州停车场|停车场|体育公园停车场|沙面停车场|公园停车场|村民停车场|官方停车场|本院停车场|本部停车场)$'

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return (($value.ToLowerInvariant() -replace '[（）()\s·、，,。/\\\-号栋室]', '') -replace '停车场|地下车库|地面车库|车库|停车位', '')
}

function Tokens([string]$value) {
  return @((Normalize $value) -split '[^\p{IsCJKUnifiedIdeographs}A-Za-z0-9]+' | Where-Object { $_.Length -ge 2 })
}

function Anchor([string]$value) {
  if ($null -eq $value) { return '' }
  $clean = $value.ToLowerInvariant()
  $clean = $clean -replace '提前码住这些|往前走一点到员村地铁站门口前面这个|新外科大楼住院部有三层|长时间停车比其他停车场|终于找到一个便宜停车场|类似商业中心|大坦沙院区自带充电|所有合规|景区外有免费|景区外有|左右两边各有|自驾建议|建议停在|停车优先|自驾|建议|推荐|导航|搜|停好车原路|停在|停车场|停车库|停车位|停车|出入口|入口|出口|地下|地面|室内|露天|户外|旁边|免费|有|这个|医院|病区|住院部|门诊|急诊|本院|本部|官方|核心|以上两个|号栋室', ''
  return Normalize $clean
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

function SearchAmAPoi([string]$query) {
  $encoded = [uri]::EscapeDataString($query)
  $url = "https://m.amap.com/_AMapService/v3/place/text?platform=JS&s=rsv3&logversion=2.0&key=$apiKey&sdkversion=$apiVersion&appname=AMap.PlaceSearch&csid=$([guid]::NewGuid())&keywords=$encoded&city=440100&citylimit=true&offset=10&page=1&extensions=all&language=zh_cn&children=1"
  return Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'Mozilla/5.0' } -TimeoutSec 20
}

function PickParking($row, $place, $response) {
  if ($null -eq $response -or [string]$response.status -ne '1') { return $null }
  $rowNorm = Normalize ([string]$row.name)
  $rowAnchor = Anchor ([string]$row.name)
  $candidates = @($response.pois | Where-Object {
    $type = [string]$_.type
    $code = [string]$_.typecode
    $type -match '停车场|停车库' -or $code -match '^1509'
  })
  if ($candidates.Count -eq 0) { return $null }
  $scored = foreach ($candidate in $candidates) {
    $candidateName = [string]$candidate.name
    $candidateNorm = Normalize $candidateName
    $candidateAddress = [string]$candidate.address
    $candidateText = Normalize "$candidateName $candidateAddress"
    $shared = LongestShared $rowAnchor $candidateNorm
    $score = $shared
    if ($rowAnchor.Length -ge 4 -and ($candidateNorm.Contains($rowAnchor) -or $rowAnchor.Contains($candidateNorm))) { $score += 10 }
    if ($candidateName -match '停车场|停车库') { $score += 2 }
    [pscustomobject]@{ candidate = $candidate; score = $score; shared = $shared }
  }
  $top = @($scored | Sort-Object score -Descending)[0]
  $nameMatch = $false
  if ($null -ne $top -and $rowAnchor.Length -ge 3) {
    $candidateAnchor = Normalize ([string]$top.candidate.name)
    $candidateAnchor = $candidateAnchor -replace '华南国家植物园', '华南植物园' -replace '广州市妇女儿童医疗中心', '市妇幼' -replace '中山大学附属眼科医院', '中山眼科' -replace '出入口|入口|出口', ''
    $placeAnchor = Normalize ([string]$place.name)
    $placeRelated = $placeAnchor.Length -ge 3 -and ((Normalize ([string]$top.candidate.name)).Contains($placeAnchor) -or ([string]$top.candidate.address).Contains([string]$place.name))
    $direct = $candidateAnchor.Contains($rowAnchor) -or ($rowAnchor.Contains($candidateAnchor) -and $candidateAnchor.Length -ge 3)
    $nameMatch = $direct -and ($rowAnchor.Length -ge 4 -or $placeRelated)
  }
  if ($null -eq $top -or !$nameMatch -or $top.score -lt 4) { return $null }
  $candidate = $top.candidate
  $main = ([string]$candidate.location) -split ','
  $entrance = ([string]$candidate.entr_location) -split ','
  $useEntrance = $entrance.Count -eq 2 -and $entrance[0] -match '^\d+\.\d+$' -and $entrance[1] -match '^\d+\.\d+$'
  $lng = if ($useEntrance) { [double]$entrance[0] } else { [double]$main[0] }
  $lat = if ($useEntrance) { [double]$entrance[1] } else { [double]$main[1] }
  return [pscustomobject]@{
    lng = $lng
    lat = $lat
    coordinate_status = '已核验'
    navigation_available = $true
    coordinate_source = '高德地图网页端停车场 POI（入口坐标优先）'
    coordinate_address = [string]$candidate.address
    coordinate_poi_name = [string]$candidate.name
    coordinate_poi_id = [string]$candidate.id
    coordinate_poi_location = [string]$candidate.location
    coordinate_entrance_location = [string]$candidate.entr_location
    coordinate_verified_at = (Get-Date).ToString('o')
  }
}

function ResolveCoordinate($row, $place) {
  $queries = @(
    "广州 $([string]$row.name) $([string]$place.name)",
    "广州 $([string]$row.name)",
    "广州 $([string]$place.name) 停车场"
  )
  $last = $null
  foreach ($query in $queries) {
    $last = PickParking $row $place (SearchAmAPoi $query)
    if ($null -ne $last) { return $last }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

$total = 0
$ready = 0
$pending = 0
$errors = 0
$placeMap = @{}
foreach ($place in @($data.places)) { $placeMap[[string]$place.id] = $place }

foreach ($property in $data.parkingsByPlace.PSObject.Properties) {
  $place = $placeMap[[string]$property.Name]
  foreach ($row in @($property.Value)) {
    $total++
    try {
      $result = ResolveCoordinate $row $place
      if ($null -ne $result) {
        foreach ($prop in $result.PSObject.Properties) { $row | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value -Force }
        $ready++
      } else {
        $row.coordinate_status = '待补充'
        $row.navigation_available = $false
        $pending++
      }
    } catch {
      $row.coordinate_status = '待补充'
      $row.navigation_available = $false
      $row | Add-Member -NotePropertyName coordinate_error -NotePropertyValue $_.Exception.Message -Force
      $pending++
      $errors++
    }
    if (($total % 10) -eq 0) { Write-Output ("processed={0} ready={1} pending={2} errors={3}" -f $total,$ready,$pending,$errors) }
    Start-Sleep -Milliseconds 450
  }
}

foreach ($metaField in @{
  coordinate_run_at = (Get-Date).ToString('o')
  coordinates_ready = $ready
  coordinates_pending = $pending
  coordinate_errors = $errors
  coordinate_provider = '高德地图网页端公开 POI 代理'
}.GetEnumerator()) {
  $data.meta | Add-Member -NotePropertyName $metaField.Key -NotePropertyValue $metaField.Value -Force
}
$data | ConvertTo-Json -Depth 40 | Set-Content -Encoding UTF8 $outputPath
Write-Output ("output={0} total={1} ready={2} pending={3} errors={4}" -f $outputPath,$total,$ready,$pending,$errors)
