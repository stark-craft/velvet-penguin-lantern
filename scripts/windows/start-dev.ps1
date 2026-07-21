[CmdletBinding()]
param(
    [switch]$UseSystemCA,
    [switch]$StartScheduler
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$LocalSettings = Join-Path $PSScriptRoot "local-settings.ps1"
if (Test-Path -LiteralPath $LocalSettings -PathType Leaf) {
    . $LocalSettings
    Write-Host "Loaded local settings: $LocalSettings"
}
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Missing virtual environment: $Python"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules") -PathType Container)) {
    throw "Missing node_modules. Run npm ci from $RepoRoot first."
}

$nodeText = (& node --version).TrimStart("v")
$nodeVersion = [version]$nodeText
$systemCASupported = $nodeVersion.Major -gt 22 -or ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 15)
if ($UseSystemCA) {
    if (-not $systemCASupported) {
        throw "Node $nodeText does not support the requested system-CA mode. Upgrade to supported Node 22.15+ first."
    }
    $env:NODE_USE_SYSTEM_CA = "1"
}

$env:SIGNALROOM_ROOT = Join-Path $RepoRoot "backend"
$env:SIGNALROOM_HOST = "127.0.0.1"
$env:SIGNALROOM_PORT = "8000"
$env:SIGNALROOM_SCHEDULER_ENABLED = "false"
$env:NEXT_PUBLIC_SIGNALROOM_DIRECT_API_PORT = "8000"
if (-not $env:SIGNALROOM_HF_LOCAL_ONLY) { $env:SIGNALROOM_HF_LOCAL_ONLY = "true" }
if (-not $env:SIGNALROOM_EMBEDDING_MODEL_PATH) { $env:SIGNALROOM_EMBEDDING_MODEL_PATH = "model_weights/all-MiniLM-L6-v2" }
if (-not $env:SIGNALROOM_SUMMARIZATION_MODEL_PATH) { $env:SIGNALROOM_SUMMARIZATION_MODEL_PATH = "model_weights/distilbart-cnn-12-6" }
if (-not $env:SIGNALROOM_APPROVAL_KEY) { $env:SIGNALROOM_APPROVAL_KEY = "2741" }
if (-not $env:SIGNALROOM_GATEKEEPER_KEY) { $env:SIGNALROOM_GATEKEEPER_KEY = "6384" }

Write-Host "newsScrapper development startup"
Write-Host "Frontend URL: http://localhost:3000/"
Write-Host "Backend URL:  http://127.0.0.1:8000/"
Write-Host "Node version: $nodeText"
Write-Host "System CA enabled: $UseSystemCA"
Write-Host "Request.cf metadata: Cloudflare local placeholder; the application does not read Request.cf"

$api = Start-Process -FilePath $Python -ArgumentList @("backend\main.py", "api", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory $RepoRoot -PassThru -NoNewWindow
$frontend = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory $RepoRoot -PassThru -NoNewWindow
$scheduler = $null
if ($StartScheduler) {
    Write-Warning "The scheduler should be used only after a manual profile run succeeds."
    $env:SIGNALROOM_SCHEDULER_ENABLED = "true"
    $scheduler = Start-Process -FilePath $Python -ArgumentList @("backend\main.py", "scheduler", "--force") -WorkingDirectory $RepoRoot -PassThru -NoNewWindow
}

try {
    $healthy = $false
    foreach ($attempt in 1..15) {
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -TimeoutSec 2 | Out-Null
            $healthy = $true
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    Write-Host "Backend health check succeeded: $healthy"
    Write-Host "Processes: API PID $($api.Id), frontend PID $($frontend.Id)$(if ($scheduler) { ", scheduler PID $($scheduler.Id)" })"
    Write-Host "Press Ctrl+C to stop processes started by this script."
    while (-not $api.HasExited -and -not $frontend.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    foreach ($process in @($scheduler, $frontend, $api)) {
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
}
