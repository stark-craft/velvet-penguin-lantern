param(
    [string]$Source,
    [string]$Destination = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Sense.AI portable application updater" -ForegroundColor Cyan
Write-Host "This copies application code without silently replacing conflicts."
Write-Host ""

if ([string]::IsNullOrWhiteSpace($Source)) {
    $Source = Read-Host "Enter the full path of the NEW extracted legacy_app folder"
}

$Source = [IO.Path]::GetFullPath($Source)
$Destination = [IO.Path]::GetFullPath($Destination)

if (-not (Test-Path -LiteralPath (Join-Path $Source "main.py") -PathType Leaf)) {
    throw "The source is not a legacy_app folder: main.py was not found at $Source"
}
if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
    New-Item -ItemType Directory -Path $Destination | Out-Null
}
if ($Source.TrimEnd("\") -eq $Destination.TrimEnd("\")) {
    throw "Source and destination must be different folders."
}

$protectedPrefixes = @(
    ".env",
    "model_weights",
    "news_scrapper\runtime",
    "venture_lens\runtime",
    "python_embed"
)
$applyToAll = $null
$copied = 0
$kept = 0
$renamed = 0

function Test-ProtectedPath([string]$RelativePath) {
    foreach ($prefix in $protectedPrefixes) {
        if ($RelativePath -eq $prefix -or $RelativePath.StartsWith("$prefix\")) {
            return $true
        }
    }
    return $false
}

Get-ChildItem -LiteralPath $Source -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($Source.Length).TrimStart("\")
    if (Test-ProtectedPath $relative) {
        $kept++
        return
    }

    $target = Join-Path $Destination $relative
    $targetFolder = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetFolder)) {
        New-Item -ItemType Directory -Path $targetFolder | Out-Null
    }

    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        Copy-Item -LiteralPath $_.FullName -Destination $target
        $copied++
        return
    }

    $choice = $applyToAll
    if ($null -eq $choice) {
        Write-Host ""
        Write-Host "Conflict: $relative" -ForegroundColor Yellow
        Write-Host "[K] Keep current  [R] Replace  [N] Save new copy with .incoming"
        Write-Host "[A] Replace all remaining code conflicts  [S] Keep all remaining"
        $choice = (Read-Host "Choose K, R, N, A, or S").Trim().ToUpperInvariant()
    }

    switch ($choice) {
        "R" {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
            $copied++
        }
        "A" {
            $applyToAll = "R"
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
            $copied++
        }
        "N" {
            Copy-Item -LiteralPath $_.FullName -Destination "$target.incoming" -Force
            $renamed++
        }
        "S" {
            $applyToAll = "K"
            $kept++
        }
        default {
            $kept++
        }
    }
}

Write-Host ""
Write-Host "Update finished." -ForegroundColor Green
Write-Host "Copied/replaced: $copied"
Write-Host "Kept/protected:  $kept"
Write-Host "Incoming copies: $renamed"
Write-Host ""
Write-Host "Your .env, model_weights, python_embed, and runtime JSON were protected."
Write-Host "Run scripts\start_windows.bat after reviewing any .incoming files."
