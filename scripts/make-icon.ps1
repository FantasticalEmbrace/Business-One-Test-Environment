#Requires -Version 5.1
# Generate 256x256 Business One branded icon for electron-builder
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$assets = Join-Path (Split-Path -Parent $root) 'assets'
$pngPath = Join-Path $assets 'icon.png'
$icoPath = Join-Path $assets 'icon.ico'

Add-Type -AssemblyName System.Drawing

$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.Clear([System.Drawing.Color]::FromArgb(255, 31, 130, 255))

$orange = [System.Drawing.Color]::FromArgb(255, 255, 155, 31)
$blue = [System.Drawing.Color]::FromArgb(255, 31, 130, 255)
$white = [System.Drawing.Color]::White

$brushOrange = New-Object System.Drawing.SolidBrush $orange
$brushBlue = New-Object System.Drawing.SolidBrush $blue
$brushWhite = New-Object System.Drawing.SolidBrush $white
# Orange/blue B1 blocks
$g.FillRectangle($brushOrange, 40, 50, 90, 156)
$g.FillRectangle($brushBlue, 126, 50, 90, 156)

$fontSmall = New-Object System.Drawing.Font('Arial', 72, [System.Drawing.FontStyle]::Bold)
$g.DrawString('B', $fontSmall, $brushWhite, 52, 72)
$g.DrawString('1', $fontSmall, $brushOrange, 138, 72)

$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Build multi-size ICO
$sizes = @(16, 32, 48, 64, 128, 256)
$iconStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter $iconStream
$images = New-Object System.Collections.Generic.List[object]

foreach ($s in $sizes) {
    $thumb = New-Object System.Drawing.Bitmap $bmp, $s, $s
    $ms = New-Object System.IO.MemoryStream
    $thumb.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $thumb.Dispose()
    $images.Add(@{ Size = $s; Data = $ms.ToArray() })
    $ms.Dispose()
}

$writer.Write([int16]0)
$writer.Write([int16]1)
$writer.Write([int16]$images.Count)
$offset = 6 + (16 * $images.Count)

foreach ($img in $images) {
    $w = if ($img.Size -ge 256) { [byte]0 } else { [byte]$img.Size }
    $writer.Write($w)
    $writer.Write($w)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([int16]1)
    $writer.Write([int16]32)
    $writer.Write([int32]$img.Data.Length)
    $writer.Write([int32]$offset)
    $offset += $img.Data.Length
}
foreach ($img in $images) { $writer.Write($img.Data) }

[System.IO.File]::WriteAllBytes($icoPath, $iconStream.ToArray())
$g.Dispose(); $bmp.Dispose(); $writer.Close(); $iconStream.Close()
Write-Host "Created $pngPath and $icoPath"
