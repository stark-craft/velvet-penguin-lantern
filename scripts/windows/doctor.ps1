[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$Failures = 0

function Write-Check {
    param([string]$Name, [bool]$Passed, [string]$Detail)
    $status = if ($Passed) { "PASS" } else { "FAIL" }
    if (-not $Passed) { $script:Failures++ }
    Write-Host ("[{0}] {1}: {2}" -f $status, $Name, $Detail)
}

function Get-SourceStats {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Valid = $false; Total = 0; Enabled = 0; Usable = 0; Error = "missing" }
    }
    try {
        $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $records = if ($null -ne $document.sites) { @($document.sites) } else { @($document) }
        $enabled = @($records | Where-Object { $_.enabled -eq $true })
        $usable = @($enabled | Where-Object {
            $hasPrimary = $_.rss_url -or $_.feed_url -or $_.feed -or $_.rss -or $_.url
            $hasListing = ($_.homepage -or $_.home_url -or $_.base_url) -and $_.allow_deep_scan -eq $true
            $hasPrimary -or $hasListing
        })
        return [pscustomobject]@{ Valid = $true; Total = $records.Count; Enabled = $enabled.Count; Usable = $usable.Count; Error = "" }
    } catch {
        return [pscustomobject]@{ Valid = $false; Total = 0; Enabled = 0; Usable = 0; Error = $_.Exception.Message }
    }
}

Set-Location $RepoRoot
Write-Host "newsScrapper Windows doctor"
Write-Host "Repository root: $RepoRoot"

$gitStatus = (& git status --short --branch 2>&1) -join " | "
Write-Check "Git repository" ($LASTEXITCODE -eq 0) $gitStatus
Write-Check "Virtual environment" (Test-Path -LiteralPath $Python -PathType Leaf) $Python

if (Test-Path -LiteralPath $Python -PathType Leaf) {
    $pythonVersion = (& $Python --version 2>&1) -join " "
    Write-Check "Python" ($LASTEXITCODE -eq 0) $pythonVersion
    $scrapyVersion = (& $Python -m scrapy version 2>&1) -join " "
    Write-Check "Scrapy" ($LASTEXITCODE -eq 0) $scrapyVersion
    $imports = (& $Python -c "import scrapy, torch, transformers, sentence_transformers, huggingface_hub; print('imports ok')" 2>&1) -join " "
    Write-Check "Python dependencies" ($LASTEXITCODE -eq 0) $imports
}

$nodeVersion = (& node --version 2>&1) -join " "
Write-Check "Node" ($LASTEXITCODE -eq 0) $nodeVersion
$npmVersion = (& npm --version 2>&1) -join " "
Write-Check "npm" ($LASTEXITCODE -eq 0) $npmVersion

$defaultStats = Get-SourceStats (Join-Path $RepoRoot "backend\sites\sites.json")
Write-Check "Default source JSON" $defaultStats.Valid ("total={0} enabled={1} usable={2} {3}" -f $defaultStats.Total, $defaultStats.Enabled, $defaultStats.Usable, $defaultStats.Error)
$broadcastStats = Get-SourceStats (Join-Path $RepoRoot "backend\sites\broadcast_sites.json")
Write-Check "Broadcast source JSON" $broadcastStats.Valid ("total={0} enabled={1} usable={2} {3}" -f $broadcastStats.Total, $broadcastStats.Enabled, $broadcastStats.Usable, $broadcastStats.Error)

if (Test-Path -LiteralPath $Python -PathType Leaf) {
    & $Python (Join-Path $RepoRoot "backend\scripts\download_models.py") --verify-only
    Write-Check "Pinned model files" ($LASTEXITCODE -eq 0) "offline folder/file/hash verification"
}

foreach ($port in 3000, 8000) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    $detail = if ($listener) { "in use by PID $($listener[0].OwningProcess)" } else { "available" }
    Write-Host ("[INFO] Port {0}: {1}" -f $port, $detail)
}

foreach ($name in "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_USE_SYSTEM_CA", "NODE_EXTRA_CA_CERTS") {
    $present = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))
    Write-Host ("[INFO] Certificate setting {0}: {1}" -f $name, $(if ($present) { "set" } else { "not set" }))
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -TimeoutSec 3
    Write-Host "[INFO] Backend health: reachable"
} catch {
    Write-Host "[INFO] Backend health: not running or unreachable"
}

if ($Failures -gt 0) {
    Write-Host "$Failures required check(s) failed."
    exit 1
}
Write-Host "All required doctor checks passed."
exit 0
