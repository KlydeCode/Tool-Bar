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
#   apps                                 -> applis du menu Démarrer en JSON [{ name, id }] (liste gardée ici)
#   app-icon 12                          -> icône de l'appli n° 12 de cette liste, en PNG base64
#   app-path 12                          -> fichier de l'appli n° 12 (.exe, ou dossier pour le Microsoft Store)
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

# Icônes des applis (y compris celles du Microsoft Store), avec leur transparence.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItemImageFactory {
  [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr hbitmap);
}
[StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
[StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }

public static class BarAppIcons {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bmp);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

  public static Bitmap Get(string appId, int size) {
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out factory);
    IntPtr hbmp;
    Marshal.ThrowExceptionForHR(factory.GetImage(new SIZE { cx = size, cy = size }, 0, out hbmp));
    try {
      BITMAP bm;
      GetObject(hbmp, Marshal.SizeOf(typeof(BITMAP)), out bm);
      var result = new Bitmap(bm.bmWidth, bm.bmHeight, PixelFormat.Format32bppArgb);
      var data = result.LockBits(new Rectangle(0, 0, bm.bmWidth, bm.bmHeight), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
      var row = new byte[bm.bmWidthBytes];
      for (int y = 0; y < bm.bmHeight; y++) {
        // L'image de Windows est rangée de bas en haut.
        Marshal.Copy(new IntPtr(bm.bmBits.ToInt64() + (long)(bm.bmHeight - 1 - y) * bm.bmWidthBytes), row, 0, bm.bmWidthBytes);
        Marshal.Copy(row, 0, new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), Math.Min(row.Length, data.Stride));
      }
      result.UnlockBits(data);
      return result;
    } finally {
      DeleteObject(hbmp);
    }
  }
}
'@

# Emplacement d'une appli du menu Démarrer, demandé à Windows.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] public struct BAR_PROPKEY { public Guid fmtid; public uint pid; }

[ComImport, Guid("7e9fb0d3-919f-4307-ab2e-9b1860310c93"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem2 {
  // Méthodes non utilisées, déclarées seulement pour garder l'ordre de l'interface Windows.
  void BindToHandler(); void GetParent(); void GetDisplayName(); void GetAttributes(); void Compare();
  void GetPropertyStore(); void GetPropertyStoreWithCreateObject(); void GetPropertyStoreForKeys();
  void GetPropertyDescriptionList(); void Update(); void GetProperty(); void GetCLSID(); void GetFileTime(); void GetInt32();
  [PreserveSig] int GetString(ref BAR_PROPKEY key, [MarshalAs(UnmanagedType.LPWStr)] out string value);
}

public static class BarAppPath {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr bc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItem2 item);

  static string Get(IShellItem2 item, string fmtid, uint pid) {
    var key = new BAR_PROPKEY { fmtid = new Guid(fmtid), pid = pid };
    string value;
    return item.GetString(ref key, out value) == 0 && value != null ? value : "";
  }

  public static string Find(string appId) {
    IShellItem2 item;
    SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, typeof(IShellItem2).GUID, out item);
    // System.Link.TargetParsingPath (applis classiques), sinon System.AppUserModel.PackageInstallPath (Microsoft Store).
    var target = Get(item, "B9B4B3FC-2B51-4A42-B5D8-324146AFCF25", 2);
    return target != "" ? target : Get(item, "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3", 15);
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

# Applis du PC : la liste du menu Démarrer (applis classiques et du Microsoft Store).
# main.js désigne ensuite une appli par son numéro dans cette liste, jamais par un texte.
$appList = @()

function Get-Apps {
  $script:appList = @(Get-StartApps | Sort-Object Name)
  ConvertTo-Json -Compress -InputObject @($appList | ForEach-Object { [ordered]@{ name = [string]$_.Name; id = [string]$_.AppID } })
}

function Test-AppIndex($index) {
  if ($index -lt 0 -or $index -ge $appList.Count -or $index -ne [Math]::Floor($index)) { throw 'numéro' }
}

function Get-AppPath($index) {
  Test-AppIndex $index
  [BarAppPath]::Find($appList[[int]$index].AppID)
}

function Get-AppIcon($index) {
  Test-AppIndex $index
  $icon = [BarAppIcons]::Get($appList[[int]$index].AppID, 48)
  $ms = New-Object System.IO.MemoryStream
  $icon.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  [Convert]::ToBase64String($ms.ToArray())
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
      'apps' { Get-Apps }
      'app-icon' { Get-AppIcon (Get-Numbers $parts 1) }
      'app-path' { Get-AppPath (Get-Numbers $parts 1) }
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
