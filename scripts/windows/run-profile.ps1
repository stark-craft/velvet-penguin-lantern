[CmdletBinding()]
param(
    [ValidateSet("default", "broadcast")]
    [string]$Profile = "default",
    [ValidatePattern("^[a-z0-9][a-z0-9-]{0,99}$")]
    [string]$Source
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Missing virtual environment: $Python"
}
$arguments = @((Join-Path $RepoRoot "backend\main.py"), "run", "--profile", $Profile)
if ($Source) { $arguments += @("--source", $Source) }
$display = '"{0}" {1}' -f $Python, (($arguments | ForEach-Object { '"{0}"' -f $_ }) -join " ")
Write-Host "Running: $display"
& $Python @arguments
exit $LASTEXITCODE
