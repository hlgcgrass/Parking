param(
  [string]$ManifestPath = 'data/place-image-selections.json',
  [string[]]$Ids = @(),
  [int]$ThrottleLimit = 8,
  [int]$MaxWidth = 1024,
  [int]$JpegQuality = 78,
  [int]$MaxBytes = 100000
)

# 100KB 是项目硬上限，禁止调用方通过参数放宽。
if ($MaxBytes -gt 100000) { $MaxBytes = 100000 }

$root = (Get-Location).Path
$manifest = [System.IO.Path]::GetFullPath((Join-Path $root $ManifestPath))
$items = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Ids.Count -gt 0) {
  $selectedIds = @($Ids | ForEach-Object { "$($_)".Split(',') } | ForEach-Object { [int]$_.Trim() })
  $items = @($items | Where-Object { $selectedIds -contains [int]$_.id })
}
$assetDirectory = [System.IO.Path]::GetFullPath((Join-Path $root 'parking-miniapp/cloudfunctions/parking/assets/place-images'))
$downloadDirectory = [System.IO.Path]::GetFullPath((Join-Path $root '.image-downloads'))
New-Item -ItemType Directory -Force -Path $assetDirectory, $downloadDirectory | Out-Null

$headers = @{
  'User-Agent' = 'Mozilla/5.0'
  'Accept-Language' = 'zh-CN,zh;q=0.9'
  'Referer' = 'https://www.bing.com/'
}
$result = @($items | ForEach-Object -Parallel {
  $item = $_
  $ErrorActionPreference = 'Stop'
  Add-Type -AssemblyName System.Drawing
  function Save-CompressedJpeg([System.Drawing.Bitmap]$bitmap, [string]$path, [int]$quality) {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
    $encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    try { $bitmap.Save($path, $codec, $encoderParameters) } finally { $encoderParameters.Dispose() }
  }
  $downloadPath = Join-Path $using:downloadDirectory (('{0:D2}.source' -f [int]$item.id))
  $assetPath = Join-Path $using:assetDirectory $item.fileName
  try {
    # 多线程下载；curl 的连接/总超时比 Invoke-WebRequest 更稳定，单张异常不会拖住整批任务。
    $curlOutput = & curl.exe --location --fail --silent --show-error --connect-timeout 10 --max-time 30 --retry 1 --user-agent 'Mozilla/5.0' --output $downloadPath -- $item.image_url 2>&1
    if ($LASTEXITCODE -ne 0) { throw "curl failed: $($curlOutput -join ' ')" }
    $stream = [System.IO.File]::OpenRead($downloadPath)
    try {
      $image = [System.Drawing.Image]::FromStream($stream, $true, $true)
      $sourceWidth = $image.Width
      $sourceHeight = $image.Height
      if ($sourceWidth -lt 600 -or $sourceHeight -lt 360 -or $sourceWidth -le $sourceHeight) { throw "not a usable landscape image: ${sourceWidth}x${sourceHeight}" }
      $scale = [Math]::Min(1.0, [double]$using:MaxWidth / $sourceWidth)
      $width = [Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
      $height = [Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))
      $canvas = [System.Drawing.Bitmap]::new($width, $height)
      $graphics = [System.Drawing.Graphics]::FromImage($canvas)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $width, $height)
      } finally { $graphics.Dispose() }
      if (Test-Path -LiteralPath $assetPath) { Remove-Item -LiteralPath $assetPath -Force }
      $quality = $using:JpegQuality
      Save-CompressedJpeg $canvas $assetPath $quality
      while ((Get-Item -LiteralPath $assetPath).Length -gt $using:MaxBytes -and $quality -gt 62) {
        $quality -= 6
        Save-CompressedJpeg $canvas $assetPath $quality
      }
      if ((Get-Item -LiteralPath $assetPath).Length -gt $using:MaxBytes -and $width -gt 800) {
        $smallWidth = 800
        $smallHeight = [Math]::Max(1, [int][Math]::Round($height * $smallWidth / [double]$width))
        $smallCanvas = [System.Drawing.Bitmap]::new($smallWidth, $smallHeight)
        $smallGraphics = [System.Drawing.Graphics]::FromImage($smallCanvas)
        try {
          $smallGraphics.Clear([System.Drawing.Color]::White)
          $smallGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $smallGraphics.DrawImage($canvas, 0, 0, $smallWidth, $smallHeight)
        } finally { $smallGraphics.Dispose() }
        $canvas.Dispose()
        $canvas = $smallCanvas
        $width = $smallWidth
        $height = $smallHeight
        $quality = 72
        Save-CompressedJpeg $canvas $assetPath $quality
        while ((Get-Item -LiteralPath $assetPath).Length -gt $using:MaxBytes -and $quality -gt 58) {
          $quality -= 5
          Save-CompressedJpeg $canvas $assetPath $quality
        }
      }
      # 最后一层硬约束：即使高细节图片在质量 58 下仍超限，也继续降质量，
      # 仍无法满足体积要求时直接失败，禁止超出 100KB 的文件进入资源目录。
      while ((Get-Item -LiteralPath $assetPath).Length -gt $using:MaxBytes -and $quality -gt 45) {
        $quality = [Math]::Max(45, $quality - 5)
        Save-CompressedJpeg $canvas $assetPath $quality
      }
      if ((Get-Item -LiteralPath $assetPath).Length -gt $using:MaxBytes) {
        throw "compressed image exceeds limit: $([Math]::Round((Get-Item -LiteralPath $assetPath).Length / 1KB, 1))KB > $([Math]::Round($using:MaxBytes / 1KB, 1))KB"
      }
      $bytes = (Get-Item -LiteralPath $assetPath).Length
      $canvas.Dispose()
      $image.Dispose()
    } finally { $stream.Dispose() }
    [pscustomobject]@{ id = [int]$item.id; name = $item.name; source_width = $sourceWidth; source_height = $sourceHeight; width = $width; height = $height; bytes = $bytes; file = $assetPath; ok = $true; error = '' }
  } catch {
    [pscustomobject]@{ id = [int]$item.id; name = $item.name; source_width = 0; source_height = 0; width = 0; height = 0; bytes = 0; file = $assetPath; ok = $false; error = $_.Exception.Message }
  }
} -ThrottleLimit ([Math]::Max(1, $ThrottleLimit)))

$result | Sort-Object id | ForEach-Object {
  if ($_.ok) { Write-Output ('{0:D2}`t{1}`t{2}x{3}`t{4}KB' -f $_.id, $_.name, $_.width, $_.height, [Math]::Round($_.bytes / 1KB)) }
  else { Write-Output ('{0:D2}`t{1}`tFAILED`t{2}' -f $_.id, $_.name, $_.error) }
}
$result | Sort-Object id | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $downloadDirectory 'manifest.json') -Encoding UTF8
$failed = @($result | Where-Object { -not $_.ok })
if ($failed.Count -gt 0) { throw "$($failed.Count) image(s) failed; see .image-downloads/manifest.json" }
Write-Output "download manifest: $([System.IO.Path]::GetFullPath((Join-Path $downloadDirectory 'manifest.json')))"
