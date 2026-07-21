[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Missing virtual environment: $Python"
}
& $Python (Join-Path $RepoRoot "backend\scripts\download_models.py") --verify-only
exit $LASTEXITCODE
