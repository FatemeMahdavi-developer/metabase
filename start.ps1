param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$env:Path = (Join-Path $PSScriptRoot '.tools\php') + ';' + (Join-Path $PSScriptRoot '.tools\node') + ';' + $env:Path
Push-Location (Join-Path $PSScriptRoot 'app')
try {
    & (Join-Path $PSScriptRoot '.tools\php\php.exe') artisan serve --host=127.0.0.1 --port=$Port
} finally {
    Pop-Location
}