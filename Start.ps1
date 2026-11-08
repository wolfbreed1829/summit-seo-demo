$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command ucm -ErrorAction SilentlyContinue)) {
    throw 'Install Unison UCM 1.3 or later and add ucm to PATH. See README.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'build/summit.uc'))) {
    throw 'Compile the Unison application first using the commands in README.md.'
}
# UCM prints Unicode characters; use a UTF-8 console on Windows.
chcp.com 65001 | Out-Null
Write-Host 'Open http://127.0.0.1:4174. Press Ctrl+C to stop.'
ucm run.compiled build/summit.uc
