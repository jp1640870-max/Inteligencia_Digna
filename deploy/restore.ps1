#Requires -Version 5.1
<#
.SYNOPSIS
    Restaura PostgreSQL y opcionalmente MinIO desde un backup.
.DESCRIPTION
    Detiene la app, restaura el dump con pg_restore --clean y, si se indica,
    reemplaza el volumen de MinIO con el archivo .tgz. Operacion destructiva.
.EXAMPLE
    .\deploy\restore.ps1 -PostgresDump .\deploy\backups\postgres-20261101T120000.dump
.EXAMPLE
    .\deploy\restore.ps1 -PostgresDump .\deploy\backups\postgres-20261101T120000.dump -MinioArchive .\deploy\backups\minio-20261101T120000.tgz
#>
param(
    [Parameter(Mandatory = $true)][string]$PostgresDump,
    [string]$MinioArchive = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$root = Get-ProjectRoot
Set-Location $root

if (-not (Test-Path -LiteralPath $PostgresDump)) {
    throw "No existe el dump: $PostgresDump"
}
$PostgresDump = (Resolve-Path -LiteralPath $PostgresDump).Path

if ($MinioArchive) {
    if (-not (Test-Path -LiteralPath $MinioArchive)) {
        throw "No existe el archivo de MinIO: $MinioArchive"
    }
    $MinioArchive = (Resolve-Path -LiteralPath $MinioArchive).Path
}

Write-Host ""
Write-Host "=== RESTAURACION DE INTELIGENCIA DIGNA ===" -ForegroundColor Yellow
Write-Host "PostgreSQL: $PostgresDump"
if ($MinioArchive) {
    Write-Host "MinIO:      $MinioArchive (se reemplaza el volumen)" -ForegroundColor Yellow
}
else {
    Write-Host "MinIO:      no se toca"
}
Write-Host ""
Write-Host "Esta operacion reemplaza datos. No se puede deshacer." -ForegroundColor Red
Write-Host ""

if (-not $Force) {
    $answer = Read-Host "Escribe RESTAURAR para continuar"
    if ($answer -ne "RESTAURAR") {
        throw "Restauracion cancelada."
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "docker no esta en PATH."
}

Write-Host "Deteniendo la app..." -ForegroundColor Cyan
& docker compose stop app | Out-Null
if ($LASTEXITCODE -ne 0) { throw "No se pudo detener la app." }

$pgId = Get-ComposeContainerId "postgres"
if (-not $pgId) { throw "postgres no esta corriendo." }

Write-Host "Restaurando PostgreSQL..." -ForegroundColor Cyan
& docker cp $PostgresDump "${pgId}:/tmp/restore.dump"
if ($LASTEXITCODE -ne 0) { throw "No se pudo copiar el dump al contenedor." }

& docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl /tmp/restore.dump'
if ($LASTEXITCODE -ne 0) {
    & docker compose exec -T postgres rm -f /tmp/restore.dump | Out-Null
    throw "pg_restore fallo. La app sigue detenida; revisa los logs."
}
& docker compose exec -T postgres rm -f /tmp/restore.dump | Out-Null
Write-Host "    PostgreSQL restaurado" -ForegroundColor Green

if ($MinioArchive) {
    $minioId = Get-ComposeContainerId "minio"
    if (-not $minioId) { throw "minio no esta corriendo; no se puede restaurar su volumen." }

    Write-Host "Restaurando MinIO..." -ForegroundColor Cyan
    & docker compose stop minio | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo detener minio." }

    $archiveDir = Split-Path -Parent $MinioArchive
    $archiveName = Split-Path -Leaf $MinioArchive
    & docker run --rm --volumes-from $minioId -v "${archiveDir}:/backup:ro" alpine:3.20 sh -c "rm -rf /data/* && tar xzf /backup/$archiveName -C /data"
    if ($LASTEXITCODE -ne 0) { throw "La restauracion de MinIO fallo." }

    & docker compose --profile local-storage up -d minio
    if ($LASTEXITCODE -ne 0) { throw "No se pudo reiniciar minio." }
    $minioId = Get-ComposeContainerId "minio"
    if ($minioId) {
        if (-not (Wait-ContainerHealthy -ContainerId $minioId -TimeoutSeconds 180)) {
            throw "minio no quedo healthy despues de la restauracion."
        }
    }
    Write-Host "    MinIO restaurado" -ForegroundColor Green
}

Write-Host "Iniciando la app..." -ForegroundColor Cyan
& docker compose up -d --no-deps app
if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar la app." }
$appId = Get-ComposeContainerId "app"
if ($appId) {
    if (-not (Wait-ContainerHealthy -ContainerId $appId -TimeoutSeconds 180)) {
        & docker compose logs --tail=150 app
        throw "La app no quedo healthy."
    }
}

Write-Host ""
Write-Host "=== Restauracion completada ===" -ForegroundColor Green
Write-Host "Verifica el login y los datos antes de volver a operar."
Write-Host ""
