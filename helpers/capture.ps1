# Capture d'une zone de l'écran pour le flou du panneau (lancé une fois par main.js, reste ouvert).
# Une demande par ligne sur l'entrée standard : « x y largeur hauteur échelle » (nombres seulement).
# Réponse : une ligne avec l'image réduite en JPEG base64, ou une ligne vide en cas d'erreur.
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $x, $y, $w, $h, $k = $line -split ' ' | ForEach-Object { [double]::Parse($_, [Globalization.CultureInfo]::InvariantCulture) }
    $full = New-Object System.Drawing.Bitmap ([int]$w), ([int]$h)
    $g = [System.Drawing.Graphics]::FromImage($full)
    $g.CopyFromScreen([int]$x, [int]$y, 0, 0, $full.Size)
    $g.Dispose()
    $sw = [Math]::Max(1, [int]($w * $k))
    $sh = [Math]::Max(1, [int]($h * $k))
    $small = New-Object System.Drawing.Bitmap $sw, $sh
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $g.DrawImage($full, 0, 0, $sw, $sh)
    $g.Dispose()
    $full.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $small.Save($ms, $codec, $params)
    $small.Dispose()
    [Console]::Out.WriteLine([Convert]::ToBase64String($ms.ToArray()))
  } catch {
    [Console]::Out.WriteLine('')
  }
}
