$ErrorActionPreference = 'Stop'

$workspace = Resolve-Path (Join-Path $PSScriptRoot '..')
$buildPath = Join-Path $workspace 'dist'
$cepRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$targetPath = Join-Path $cepRoot 'com.framebase.presets.premiere'
$uiTargetPath = Join-Path $targetPath 'ui'

if (-not (Test-Path -LiteralPath $buildPath)) {
  throw 'Primero ejecuta pnpm build para generar la interfaz del panel.'
}

if (Test-Path -LiteralPath $targetPath) {
  Remove-Item -LiteralPath $targetPath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path (Join-Path $targetPath 'CSXS') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $targetPath 'jsx') | Out-Null
New-Item -ItemType Directory -Force -Path $uiTargetPath | Out-Null

Copy-Item -LiteralPath (Join-Path $workspace 'premiere-plugin\CSXS\manifest.xml') -Destination (Join-Path $targetPath 'CSXS\manifest.xml') -Force
Copy-Item -LiteralPath (Join-Path $workspace 'premiere-plugin\jsx\hostscript.jsx') -Destination (Join-Path $targetPath 'jsx\hostscript.jsx') -Force
Copy-Item -LiteralPath (Join-Path $workspace 'premiere-plugin\bridge.js') -Destination (Join-Path $uiTargetPath 'bridge.js') -Force
Copy-Item -Path (Join-Path $buildPath '*') -Destination $uiTargetPath -Recurse -Force

$indexHtmlPath = Join-Path $uiTargetPath 'index.html'
if (Test-Path -LiteralPath $indexHtmlPath) {
  $html = Get-Content -LiteralPath $indexHtmlPath -Raw -Encoding UTF8
  if ($html -notmatch 'bridge\.js') {
    $html = $html -replace '</head>', "  <script src=`"./bridge.js`"></script>`r`n  </head>"
    Set-Content -LiteralPath $indexHtmlPath -Value $html -Encoding UTF8
  }
}

Write-Host "Framebase Presets para Premiere Pro se instaló en $targetPath"
Write-Host 'Abre Premiere Pro > Ventana > Extensiones > Framebase Presets.'
