#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$assets = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'assets'
$sourcePath = Join-Path $assets 'logo-big.png'
$pngPath = Join-Path $assets 'icon.png'
$icoPath = Join-Path $assets 'icon.ico'
if (-not (Test-Path $sourcePath)) { Write-Error "Missing assets\logo-big.png" }

Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($sourcePath)
try {
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $pad = 16
    $inner = $size - (2 * $pad)
    $scale = [Math]::Min($inner / $src.Width, $inner / $src.Height)
    $drawW = [int][Math]::Round($src.Width * $scale)
    $drawH = [int][Math]::Round($src.Height * $scale)
    $x = [int][Math]::Round(($size - $drawW) / 2)
    $y = [int][Math]::Round(($size - $drawH) / 2)
    $g.DrawImage($src, $x, $y, $drawW, $drawH)
    $g.Dispose()
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

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
        $writer.Write($w); $writer.Write($w)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([int16]1); $writer.Write([int16]32)
        $writer.Write([int32]$img.Data.Length); $writer.Write([int32]$offset)
        $offset += $img.Data.Length
    }
    foreach ($img in $images) { $writer.Write($img.Data) }
    [System.IO.File]::WriteAllBytes($icoPath, $iconStream.ToArray())
    $writer.Close(); $iconStream.Close(); $bmp.Dispose()
    Write-Host "Created icon from logo-big.png"
} finally { $src.Dispose() }
