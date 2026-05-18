param(
    [int]$Port = 8000,
    [switch]$InstallSemanticDeps,
    [switch]$SkipInstall,
    [switch]$SkipIndex
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

$Python = $VenvPython

if (-not $SkipInstall) {
    Write-Host "Installing base dependencies..."
    & $Python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Base dependency install failed. Stop startup."
        exit 1
    }

    if ($InstallSemanticDeps) {
        Write-Host "Installing semantic retrieval dependencies..."
        & $Python -m pip install -r requirements.semantic.txt
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Semantic dependency install failed. Stop startup."
            exit 1
        }
    }
}

if (-not $SkipIndex) {
    Write-Host "Building knowledge index..."
    & $Python knowledge\build_index.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Knowledge index build failed. Stop startup."
        exit 1
    }
}

Write-Host "Starting AlgoGuide Agent at http://127.0.0.1:$Port"
& $Python -m uvicorn app:app --reload --host 127.0.0.1 --port $Port
