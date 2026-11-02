#Requires -Version 5.1
<#
.SYNOPSIS
    Actualiza Inteligencia Digna en el servidor.
.DESCRIPTION
    Hace backup, git pull --ff-only, build, migraciones, storage-init, reinicia
    la app y verifica salud. No borra volumenes ni datos.
.EXAMPLE
    .\deploy\deploy.ps1
.EXAMPLE
    .\deploy\deploy.ps1 -Branch experimental -SkipBackup
#>
param(
    [string]$Branch = "",
    [switch]$SkipBackup,
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$root = Get-ProjectRoot
Set-Location $root
$envPath = Join-Path $root ".env"

Write-Host ""
Write-Host "=== Despliegue de Inteligencia Digna ===" -ForegroundColor Cyan
Write-Host "Carpeta: $root"
Write-Host ""

function Fail-Deploy {
    param([string]$Message)
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    Write-Host ""
    exit 1
}

if (-not (Test-Path -LiteralPath $envPath)) {
    Fail-Deploy "No existe .env. Ejecuta primero deploy\bootstrap-server.ps1."
}
if (-not (Test-Path -LiteralPath (Join-Path $root ".git"))) {
    Fail-Deploy "Esta carpeta no es un clon de Git."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail-Deploy "docker no esta en PATH."
}
if (-not (Test-IsAdmin)) {
    Write-Host "ADVERTENCIA: no estas como Administrador. No es obligatorio para desplegar." -ForegroundColor Yellow
    Write-Host ""
}

$envVars = Read-DotEnv $envPath
if (-not $Branch) {
    $Branch = $envVars["DEPLOY_BRANCH"]
}
if (-not $Branch) {
    $Branch = "main"
}
Write-Host "Rama objetivo: $Branch"

$dirty = (& git status --porcelain 2>$null) -join ""
if ($dirty.Trim().Length -gt 0) {
    Write-Host $dirty
    Fail-Deploy "Hay cambios sin commitear. El servidor no debe editar codigo. Resuelvelos o descartalos."
}

& git fetch origin $Branch
if ($LASTEXITCODE -ne 0) { Fail-Deploy "git fetch origin $Branch fallo." }

$currentBranch = ((& git branch --show-current 2>$null) -join "").Trim()
if ($currentBranch -ne $Branch) {
    & git checkout $Branch
    if ($LASTEXITCODE -ne 0) { Fail-Deploy "git checkout $Branch fallo." }
}

& git pull --ff-only origin $Branch
if ($LASTEXITCODE -ne 0) {
    Fail-Deploy "git pull --ff-only fallo. La rama local divergio o hay cambios incompatibles."
}

$commit = ((& git rev-parse --short HEAD 2>$null) -join "").Trim()
Write-Host "Commit: $commit"
Write-Host ""

if (-not $SkipBackup) {
    Write-Host "=== Backup previo ===" -ForegroundColor Cyan
    $backupOk = $true
    try {
        & (Join-Path $PSScriptRoot "backup.ps1")
        if ($LASTEXITCODE -ne 0) { $backupOk = $false }
    }
    catch {
        Write-Host "Backup fallo: $($_.Exception.Message)" -ForegroundColor Yellow
        $backupOk = $false
    }
    if (-not $backupOk) {
        Write-Host ""
        Write-Host "ADVERTENCIA: el backup no se completo." -ForegroundColor Yellow
        $answer = Read-Host "Escribe SI para continuar sin backup"
        if ($answer -ne "SI") {
            Fail-Deploy "Despliegue cancelado por el usuario."
        }
    }
    Write-Host ""
}

if (-not $NoBuild) {
    Write-Host "=== Build ===" -ForegroundColor Cyan
    & docker compose build
    if ($LASTEXITCODE -ne 0) { Fail-Deploy "docker compose build fallo." }
    Write-Host ""
}

Write-Host "=== PostgreSQL ===" -ForegroundColor Cyan
& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { Fail-Deploy "No se pudo iniciar postgres." }
$pgId = Get-ComposeContainerId "postgres"
if (-not $pgId) { Fail-Deploy "postgres no aparece en docker compose ps." }
if (-not (Wait-ContainerHealthy -ContainerId $pgId -TimeoutSeconds 180)) {
    & docker compose logs --tail=100 postgres
    Fail-Deploy "postgres no quedo healthy."
}
Write-Host ""

Write-Host "=== Migraciones y seed ===" -ForegroundColor Cyan
& docker compose run --rm migrate
if ($LASTEXITCODE -ne 0) { Fail-Deploy "Las migraciones fallaron." }
Write-Host ""

if ($envVars["MINIO_ROOT_USER"]) {
    Write-Host "=== MinIO ===" -ForegroundColor Cyan
    & docker compose --profile local-storage up -d minio
    if ($LASTEXITCODE -ne 0) { Fail-Deploy "No se pudo iniciar minio." }
    $minioId = Get-ComposeContainerId "minio"
    if (-not $minioId) { Fail-Deploy "minio no aparece en docker compose ps." }
    if (-not (Wait-ContainerHealthy -ContainerId $minioId -TimeoutSeconds 180)) {
        & docker compose logs --tail=100 minio
        Fail-Deploy "minio no quedo healthy."
    }
    & docker compose --profile local-storage run --rm storage-init
    if ($LASTEXITCODE -ne 0) { Fail-Deploy "storage-init fallo." }
    Write-Host ""
}

Write-Host "=== Verificacion de entorno ===" -ForegroundColor Cyan
& docker compose run --rm --no-deps app npm run env:check
if ($LASTEXITCODE -ne 0) {
    Fail-Deploy "env:check fallo. Revisa .env antes de reiniciar la app."
}
Write-Host ""

Write-Host "=== Reinicio de la app ===" -ForegroundColor Cyan
& docker compose up -d --no-deps app
if ($LASTEXITCODE -ne 0) { Fail-Deploy "No se pudo reiniciar la app." }
$appId = Get-ComposeContainerId "app"
if (-not $appId) { Fail-Deploy "app no aparece en docker compose ps." }
if (-not (Wait-ContainerHealthy -ContainerId $appId -TimeoutSeconds 180)) {
    & docker compose logs --tail=150 app
    Fail-Deploy "La app no quedo healthy."
}
Write-Host ""

Write-Host "=== Salud ===" -ForegroundColor Cyan
$healthOk = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $healthOk = $true
            break
        }
    }
    catch {
    }
    Start-Sleep -Seconds 2
}
if (-not $healthOk) {
    & docker compose logs --tail=150 app
    Fail-Deploy "La app no responde en http://127.0.0.1:3000/."
}

& docker compose ps

$logPath = Join-Path $PSScriptRoot "deploy.log"
Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format "yyyy-MM-dd HH:mm:ss") branch=$Branch commit=$commit ok" -Encoding UTF8

Write-Host ""
Write-Host "=== Despliegue completado ===" -ForegroundColor Green
Write-Host "Rama:   $Branch"
Write-Host "Commit: $commit"
Write-Host ""
