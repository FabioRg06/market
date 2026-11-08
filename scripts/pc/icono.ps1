# Dibuja el icono de Market (puerta blanca sobre azul rey) y lo guarda como .ico con
# varios tamaños. Uso: powershell -File icono.ps1 -Out ruta\market.ico
param([Parameter(Mandatory = $true)][string]$Out)
Add-Type -AssemblyName System.Drawing

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-IconPng([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $f = $s / 256.0
  # Fondo azul rey con degradado suave.
  $bg = New-RoundRect (4 * $f) (4 * $f) (248 * $f) (248 * $f) (56 * $f)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.PointF($s, $s)),
    [System.Drawing.Color]::FromArgb(255, 37, 78, 214), [System.Drawing.Color]::FromArgb(255, 21, 46, 140))
  $g.FillPath($grad, $bg)
  # Puerta: marco blanco, hoja entreabierta y manija.
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [single](16 * $f))
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $door = New-RoundRect (78 * $f) (52 * $f) (100 * $f) (152 * $f) (14 * $f)
  $g.DrawPath($pen, $door)
  $leaf = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
  $g.FillPath($leaf, $door)
  $knob = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillEllipse($knob, (146 * $f), (122 * $f), (16 * $f), (16 * $f))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = foreach ($s in $sizes) { , (New-IconPng $s) }

# Formato .ico: cabecera, una entrada por tamaño y luego los PNG.
$buf = [System.IO.MemoryStream]::new()
$w = [System.IO.BinaryWriter]::new($buf)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $b = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$len); $w.Write([UInt32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes($Out, $buf.ToArray())
# Vista previa para revisar el dibujo.
[System.IO.File]::WriteAllBytes([System.IO.Path]::ChangeExtension($Out, '.png'), $pngs[$sizes.Count - 1])
Write-Output "Icono: $Out"
