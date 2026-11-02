#Requires -Version 5.1
<#
.SYNOPSIS
    Backup de PostgreSQL y MinIO.
.DESCRIPTION
    Genera deploy\backups\postgres-<fecha>.dump y minio-<fecha>.tgz.
    Conserva los ultimos -Retention backups de cada tipo.
.EXAMPLE
    .\deploy\backup.ps1
.EXAMPLE
    .\deploy\backup.ps1 -OutputDir D:\backups\digna -Retention 30
#>
param(
    [string]$OutputDir = "",
    [int]$Retention = 10
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$root = Get-ProjectRoot
Set-Location $root

if (-not $OutputDir) {
    $OutputDir = Join-Path $PSScriptRoot "backups"
}
if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

Write-Host ""
Write-Host "=== Backup de Inteligencia Digna ===" -ForegroundColor Cyan
Write-Host "Destino: $OutputDir"
Write-Host ""

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "docker no esta en PATH."
}

$timestamp = Get-Date -Format "yyyyMMddTHHmmss"
$created = @()

$pgId = Get-ComposeContainerId "postgres"
if (-not $pgId) {
    throw "postgres no esta corriendo. Inicia el stack antes de hacer backup."
}

$remoteDump = "/tmp/digna-$timestamp.dump"
$localDump = Join-Path $OutputDir "postgres-$timestamp.dump"

Write-Host "1/2 PostgreSQL..." -ForegroundColor Cyan
& docker compose exec -T postgres sh -c "pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB --format=custom --no-owner --no-acl -f $remoteDump"
if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo." }

& docker cp "${pgId}:$remoteDump" $localDump
if ($LASTEXITCODE -ne 0) {
    & docker compose exec -T postgres rm -f $remoteDump | Out-Null
    throw "docker cp del dump fallo."
}

& docker compose exec -T postgres rm -f $remoteDump | Out-Null
$sizeMb = [math]::Round((Get-Item -LiteralPath $localDump).Length / 1MB, 2)
$created += $localDump
Write-Host "    $localDump ($sizeMb MB)" -ForegroundColor Green

$minioId = Get-ComposeContainerId "minio"
if ($minioId) {
    Write-Host "2/2 MinIO..." -ForegroundColor Cyan
    $archive = Join-Path $OutputDir "minio-$timestamp.tgz"
    $archiveName = Split-Path -Leaf $archive
    & docker run --rm --volumes-from $minioId -v "${OutputDir}:/backup" alpine:3.20 tar czf "/backup/$archiveName" -C /data .
    if ($LASTEXITCODE -ne 0) { throw "El backup de MinIO fallo." }
    $sizeMb = [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2)
    $created += $archive
    Write-Host "    $archive ($sizeMb MB)" -ForegroundColor Green
}
else {
    Write-Host "2/2 MinIO: no esta corriendo, se omite." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Retencion: ultimos $Retention backups de cada tipo." -ForegroundColor Cyan
Get-ChildItem -LiteralPath $OutputDir -Filter "postgres-*.dump" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Retention |
    Remove-Item -Force
Get-ChildItem -LiteralPath $OutputDir -Filter "minio-*.tgz" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Retention |
    Remove-Item -Force

Write-Host ""
Write-Host "=== Backup completado ===" -ForegroundColor Green
foreach ($file in $created) {
    Write-Host "  $file"
}
Write-Host ""
