# Actions Windows pour la barre (lancé une fois par main.js, reste ouvert).
# Une demande par ligne sur l'entrée standard, une réponse par ligne (ligne vide = erreur) :
#   capture x y largeur hauteur échelle  -> image réduite en JPEG base64
#   volume                               -> volume du haut-parleur, de 0 à 1
#   volume-set 0.65                      -> « ok »
#   mic                                  -> 1 si le micro est coupé, sinon 0
#   mic-set 1                            -> « ok » (1 = couper, 0 = rétablir)
#   media                                -> morceau en cours en JSON ({} si rien)
#   media-art                            -> pochette / miniature en JPEG base64
#   media-play | media-next | media-prev -> « ok »
# Les arguments sont toujours des nombres, vérifiés ici aussi.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
# Titres avec accents ou emojis : la sortie doit être en UTF-8 pour main.js.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

# Volume et micro : API Core Audio de Windows (IAudioEndpointVolume), sans dépendance.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float levelDB, ref Guid context);
  int SetMasterVolumeLevelScalar(float level, ref Guid context);
  int GetMasterVolumeLevel(out float levelDB);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float levelDB, ref Guid context);
  int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
  int GetChannelVolumeLevel(uint channel, out float levelDB);
  int GetChannelVolumeLevelScalar(uint channel, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object endpoint);
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator { }

public static class BarAudio {
  const int Render = 0, Capture = 1, Multimedia = 1, ClsctxAll = 23;

  static IAudioEndpointVolume Endpoint(int flow) {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, Multimedia, out device));
    var iid = typeof(IAudioEndpointVolume).GUID;
    object endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, ClsctxAll, IntPtr.Zero, out endpoint));
    return (IAudioEndpointVolume)endpoint;
  }

  public static float GetVolume() {
    float level;
    Marshal.ThrowExceptionForHR(Endpoint(Render).GetMasterVolumeLevelScalar(out level));
    return level;
  }

  public static void SetVolume(float level) {
    var context = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint(Render).SetMasterVolumeLevelScalar(level, ref context));
  }

  public static bool GetMicMuted() {
    bool muted;
    Marshal.ThrowExceptionForHR(Endpoint(Capture).GetMute(out muted));
    return muted;
  }

  public static void SetMicMuted(bool muted) {
    var context = Guid.Empty;
    Marshal.ThrowExceptionForHR(Endpoint(Capture).SetMute(muted, ref context));
  }
}
'@

$invariant = [Globalization.CultureInfo]::InvariantCulture
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L

function Get-Numbers($parts, $count) {
  if ($parts.Count -ne $count) { throw 'nombre d''arguments' }
  $parts | ForEach-Object { [double]::Parse($_, $invariant) }
}

function Get-Capture($x, $y, $w, $h, $k) {
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
  [Convert]::ToBase64String($ms.ToArray())
}

# Musique : API Windows des contrôles multimédias (celle de l'encart du volume de Windows).
# Spotify, Deezer, Apple Music et les navigateurs (YouTube…) y publient titre, artiste et pochette.
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
# Réflexion obligatoire : PowerShell ne sait pas passer un flux Windows à AsStreamForRead directement.
$asStream = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if (-not $task.Wait(3000)) { throw 'trop long' }
  $task.Result
}

# Sans gestionnaire de médias, la musique est simplement absente : le flou et le volume doivent marcher quand même.
try {
  $sessionManager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  $sessionManager = $null
}

function Get-MediaProperties($session) {
  Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
}

function Get-CurrentSession {
  if ($sessionManager) { $sessionManager.GetCurrentSession() }
}

function Get-Media {
  $session = Get-CurrentSession
  if (-not $session) { return '{}' }
  $props = Get-MediaProperties $session
  $info = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  [ordered]@{
    app      = [string]$session.SourceAppUserModelId
    title    = [string]$props.Title
    artist   = [string]$props.Artist
    status   = [string]$info.PlaybackStatus
    position = $timeline.Position.TotalSeconds
    duration = $timeline.EndTime.TotalSeconds
    updated  = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
    canPrev  = [bool]$info.Controls.IsPreviousEnabled
    canNext  = [bool]$info.Controls.IsNextEnabled
    hasArt   = $null -ne $props.Thumbnail
  } | ConvertTo-Json -Compress
}

function Get-MediaArt {
  $session = Get-CurrentSession
  if (-not $session) { return '' }
  $props = Get-MediaProperties $session
  if (-not $props.Thumbnail) { return '' }
  $raw = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $image = [System.Drawing.Image]::FromStream($asStream.Invoke($null, @($raw)))
  # Réduite à 240 px maximum : assez pour la case de la barre, léger à envoyer.
  $k = [Math]::Min(1.0, 240.0 / [Math]::Max($image.Width, $image.Height))
  $small = New-Object System.Drawing.Bitmap ([Math]::Max(1, [int]($image.Width * $k))), ([Math]::Max(1, [int]($image.Height * $k)))
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($image, 0, 0, $small.Width, $small.Height)
  $g.Dispose()
  $image.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, $codec, $params)
  $small.Dispose()
  [Convert]::ToBase64String($ms.ToArray())
}

function Invoke-MediaControl($action) {
  $session = Get-CurrentSession
  if (-not $session) { return '' }
  $operation = switch ($action) {
    'play' { $session.TryTogglePlayPauseAsync() }
    'next' { $session.TrySkipNextAsync() }
    'prev' { $session.TrySkipPreviousAsync() }
  }
  if (Await $operation ([bool])) { 'ok' } else { '' }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $command, $rest = $line -split ' '
    $parts = @($rest | Where-Object { $_ -ne $null })
    $answer = switch ($command) {
      'capture' {
        $x, $y, $w, $h, $k = Get-Numbers $parts 5
        Get-Capture $x $y $w $h $k
      }
      'volume' { [BarAudio]::GetVolume().ToString($invariant) }
      'volume-set' {
        $level = (Get-Numbers $parts 1)
        # 0.0 et 1.0 (pas 0 et 1) : sinon PowerShell choisit la version entière de Min/Max et arrondit à 0.
        [BarAudio]::SetVolume([float][Math]::Min(1.0, [Math]::Max(0.0, $level)))
        'ok'
      }
      'media' { Get-Media }
      'media-art' { Get-MediaArt }
      'media-play' { Invoke-MediaControl 'play' }
      'media-next' { Invoke-MediaControl 'next' }
      'media-prev' { Invoke-MediaControl 'prev' }
      'mic' { if ([BarAudio]::GetMicMuted()) { '1' } else { '0' } }
      'mic-set' {
        [BarAudio]::SetMicMuted((Get-Numbers $parts 1) -eq 1)
        'ok'
      }
      default { '' }
    }
    [Console]::Out.WriteLine([string]$answer)
  } catch {
    [Console]::Out.WriteLine('')
  }
}
