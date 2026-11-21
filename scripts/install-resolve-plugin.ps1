$ErrorActionPreference = 'Stop'

$workspace = Resolve-Path (Join-Path $PSScriptRoot '..')
$buildPath = Join-Path $workspace 'dist'
$examplesRoot = 'C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples'
$sdkCandidates = @(
  (Join-Path $examplesRoot 'SamplePromisePlugin\WorkflowIntegration.node'),
  (Join-Path $examplesRoot 'SamplePlugin\WorkflowIntegration.node'),
  (Join-Path $examplesRoot 'CompatibleSamplePlugin\WorkflowIntegration.node')
)
$sdkPath = $sdkCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$pluginRoot = 'C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins'
$targetPath = Join-Path $pluginRoot 'com.framebase.presets'
$uiTargetPath = Join-Path $targetPath 'ui'

if (-not (Test-Path -LiteralPath $buildPath)) {
  throw 'Primero ejecuta pnpm build para generar la interfaz del panel.'
}
if (-not $sdkPath) {
  throw 'No se encontró WorkflowIntegration.node. Confirma que DaVinci Resolve 21.1+ esté instalado.'
}

New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
if (Test-Path -LiteralPath $uiTargetPath) {
  Remove-Item -LiteralPath $uiTargetPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $uiTargetPath | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\resolve-plugin\manifest.xml') -Destination $targetPath -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\resolve-plugin\package.json') -Destination $targetPath -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\resolve-plugin\main.js') -Destination $targetPath -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\resolve-plugin\preload.js') -Destination $targetPath -Force
Copy-Item -LiteralPath $sdkPath -Destination $targetPath -Force
Copy-Item -Path (Join-Path $buildPath '*') -Destination $uiTargetPath -Recurse -Force

Write-Host "Framebase Presets se instaló en $targetPath"
Write-Host 'Reinicia Resolve Studio para ver el panel en Workspace > Workflow Integrations.'
