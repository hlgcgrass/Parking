$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$inputPath = Join-Path $root 'server\xhs-p0-import-41.json'
$outputPath = Join-Path $root 'server\xhs-p0-import-41-geocoded.json'
$data = Get-Content -Raw -Encoding UTF8 $inputPath | ConvertFrom-Json
$total = 0; $ready = 0; $pending = 0; $errors = 0
$generic = '^(地下停车场|地面停车场|医院停车场|广州停车场|停车场|体育公园停车场|沙面停车场|公园停车场|村民停车场|官方停车场|本院停车场|本部停车场)$'

foreach ($property in $data.parkingsByPlace.PSObject.Properties) {
  foreach ($row in @($property.Value)) {
    $total++
    try {
      $name = [string]$row.name
      $result = $null
      if ($name -notmatch $generic) {
        $query = [uri]::EscapeDataString("广州 $name")
        $url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&accept-language=zh-CN&countrycodes=cn&q=$query"
        $items = @(Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'ParkingMiniappCoordinateReview/1.0' } -TimeoutSec 10)
        $tokens = @($name -replace '停车场|地下车库|地面车库|车库|停车位', '' -split '[（）()\s·、，,。/\\-]' | Where-Object { $_.Length -ge 2 })
        foreach ($item in $items) {
          $display = [string]$item.display_name
          $hits = @($tokens | Where-Object { $display -like "*$($_)*" }).Count
          if ($hits -gt 0) {
            $row.lng = [double]$item.lon
            $row.lat = [double]$item.lat
            $row.coordinate_status = '已核验'
            $row.navigation_available = $true
            $row.coordinate_source = 'OpenStreetMap Nominatim 名称检索'
            $row.coordinate_address = $display
            $row.coordinate_verified_at = (Get-Date).ToString('o')
            $result = $item
            break
          }
        }
      }
      if ($null -eq $result) { $row.coordinate_status = '待补充'; $row.navigation_available = $false; $pending++ } else { $ready++ }
    } catch {
      $row.coordinate_status = '待补充'; $row.navigation_available = $false; $row | Add-Member -NotePropertyName coordinate_error -NotePropertyValue $_.Exception.Message -Force; $pending++; $errors++
    }
    if (($total % 10) -eq 0) { Write-Output ("processed={0} ready={1} pending={2} errors={3}" -f $total,$ready,$pending,$errors) }
    Start-Sleep -Milliseconds 1100
  }
}
$data.meta.coordinate_run_at = (Get-Date).ToString('o')
$data.meta.coordinates_ready = $ready
$data.meta.coordinates_pending = $pending
$data.meta.coordinate_errors = $errors
$data | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 $outputPath
Write-Output ("output={0} total={1} ready={2} pending={3} errors={4}" -f $outputPath,$total,$ready,$pending,$errors)
