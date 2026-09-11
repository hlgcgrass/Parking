param(
  [string]$InputDirectory = '.image-candidates',
  [string]$OutputDirectory = '.image-contact-sheets'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = (Get-Location).Path
$input = [System.IO.Path]::GetFullPath((Join-Path $root $InputDirectory))
$output = [System.IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
New-Item -ItemType Directory -Force -Path $output | Out-Null

function Make-Sheet([string]$folder, [string]$name) {
  $files = @(Get-ChildItem -LiteralPath $folder -File -Filter '*.jpg' | Sort-Object Name)
  if (!$files.Count) { return }
  $tileW = 320; $tileH = 240; $cols = 4; $rows = [Math]::Ceiling($files.Count / $cols)
  $bitmap = [System.Drawing.Bitmap]::new($tileW * $cols, $tileH * $rows)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $font = [System.Drawing.Font]::new('Microsoft YaHei', 11, [System.Drawing.FontStyle]::Bold)
  $brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $back = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(175, 0, 0, 0))
  for ($i = 0; $i -lt $files.Count; $i++) {
    $x = ($i % $cols) * $tileW; $y = [Math]::Floor($i / $cols) * $tileH
    try {
      $image = [System.Drawing.Image]::FromFile($files[$i].FullName)
      $scale = [Math]::Max($tileW / $image.Width, ($tileH - 28) / $image.Height)
      $drawW = [int]($image.Width * $scale); $drawH = [int]($image.Height * $scale)
      $drawX = $x + [int](($tileW - $drawW) / 2); $drawY = $y + [int](($tileH - 28 - $drawH) / 2)
      $graphics.DrawImage($image, $drawX, $drawY, $drawW, $drawH)
      $image.Dispose()
      $graphics.FillRectangle($back, $x, $y + $tileH - 28, $tileW, 28)
      $graphics.DrawString($files[$i].BaseName, $font, $brush, $x + 8, $y + $tileH - 25)
    } catch { }
  }
  $path = Join-Path $output "$name.jpg"
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $font.Dispose(); $brush.Dispose(); $back.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
  Write-Output $path
}

$folders = @(Get-Item -LiteralPath $input) + @(Get-ChildItem -LiteralPath $input -Directory | Sort-Object Name)
foreach ($folder in $folders) { Make-Sheet $folder.FullName ($folder.Name -replace '[^a-zA-Z0-9_-]', '_') }
