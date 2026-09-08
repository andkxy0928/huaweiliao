# Run from any directory; requires FFmpeg on PATH.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskIconName = [string][char]0x56fe + [char]0x6807 + '.png'
$taskSource = Join-Path $taskRoot ('assets\image\' + $taskIconName)
$taskOutput = Join-Path $taskRoot 'assets\icons'
if (-not (Test-Path -LiteralPath $taskSource)) { throw "Icon source not found: $taskSource" }
$taskFfmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null

$taskFilter = '[0:v]split=4[s16][s32][s48][s256];[s16]scale=16:16:flags=lanczos[v16];[s32]scale=32:32:flags=lanczos[v32];[s48]scale=48:48:flags=lanczos[v48];[s256]scale=256:256:flags=lanczos[v256]'
& $taskFfmpeg -hide_banner -loglevel error -y -i $taskSource -filter_complex $taskFilter -map '[v16]' -map '[v32]' -map '[v48]' -map '[v256]' -c:v bmp -c:v:3 png -pix_fmt bgra -pix_fmt:v:3 rgba -frames:v:0 1 -frames:v:1 1 -frames:v:2 1 -frames:v:3 1 (Join-Path $taskOutput 'favicon.ico')
if ($LASTEXITCODE -ne 0) { throw 'ICO generation failed' }
foreach ($taskIcon in @(@('icon-192.png',192), @('icon-512.png',512), @('apple-touch-icon.png',180))) {
  $taskSize = $taskIcon[1]
  & $taskFfmpeg -hide_banner -loglevel error -y -i $taskSource -vf "scale=${taskSize}:${taskSize}:flags=lanczos" -frames:v 1 (Join-Path $taskOutput $taskIcon[0])
  if ($LASTEXITCODE -ne 0) { throw "PNG generation failed: $($taskIcon[0])" }
}
Write-Output 'Generated favicon.ico (16/32/48/256) and Apple/PWA PNG icons.'
