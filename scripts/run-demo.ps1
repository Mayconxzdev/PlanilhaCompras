[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 8090
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root '.venv'
$Python = Join-Path $Venv 'Scripts\python.exe'

if (-not (Test-Path $Python)) {
    python -m venv $Venv
}

& $Python -m pip install --disable-pip-version-check -q -r (Join-Path $Root 'requirements.txt')

$env:PROCUREFLOW_DEMO = '1'
$env:PROCUREFLOW_HOST = '127.0.0.1'
$env:PORT = "$Port"
$env:PROCUREFLOW_RUNTIME_DIR = Join-Path $Root '.runtime'

Write-Host "ProcureFlow demo disponível em http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host 'Use Ctrl+C para encerrar. Os dados desta demonstração ficam somente em .runtime/.' -ForegroundColor DarkGray
& $Python -m uvicorn server.main:app --host $env:PROCUREFLOW_HOST --port $Port
