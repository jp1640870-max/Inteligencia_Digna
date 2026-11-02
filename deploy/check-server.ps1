#Requires -Version 5.1
<#
.SYNOPSIS
    Diagnostico previo del servidor Windows para Inteligencia Digna.
.DESCRIPTION
    No modifica nada. Verifica Docker, contenedores Linux, Git, disco, puertos
    y el estado basico del repositorio. Ejecutalo por RDP antes del bootstrap.
#>
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "lib.ps1")

$root = Get-ProjectRoot
Set-Location $root

Write-Host ""
Write-Host "=== Inteligencia Digna: diagnostico del servidor ===" -ForegroundColor Cyan
Write-Host "Equipo:      $env:COMPUTERNAME"
Write-Host "Usuario:     $env:USERNAME"
Write-Host "PowerShell:  $($PSVersionTable.PSVersion)"
Write-Host "Carpeta:     $root"
Write-Host ""

$dockerOk = $false
$linuxOk = $false

Write-Host "--- Docker ---" -ForegroundColor Cyan
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCommand) {
    Write-Host "ERROR: docker no esta en PATH." -ForegroundColor Red
    Write-Host "       Agrega C:\Program Files\Docker\Docker\resources\bin al PATH o instala Docker." -ForegroundColor Yellow
}
else {
    Write-Host "docker: $($dockerCommand.Source)"
    & docker version --format "Cliente {{.Client.Version}} / Servidor {{.Server.Version}}"
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
    & docker compose version
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: falta el plugin docker compose v2." -ForegroundColor Red
    }
    $osType = (& docker info --format "{{.OSType}}" 2>$null) -join ""
    Write-Host "OSType del daemon: $($osType.Trim())"
    if ($osType.Trim() -eq "linux") {
        $linuxOk = $true
    }
    else {
        Write-Host "ADVERTENCIA: el daemon no reporta Linux. La app usa contenedores Linux." -ForegroundColor Yellow
    }
}
Write-Host ""

Write-Host "--- Contenedores Linux ---" -ForegroundColor Cyan
if ($dockerOk) {
    & docker run --rm alpine:3.20 echo "Linux containers OK"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Ejecucion de contenedor Linux: OK" -ForegroundColor Green
    }
    else {
        Write-Host "ERROR: no se pudo ejecutar un contenedor Linux de prueba." -ForegroundColor Red
    }
}
else {
    Write-Host "Se omite: Docker no responde." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "--- Git y repositorio ---" -ForegroundColor Cyan
$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand) {
    Write-Host "ERROR: Git no esta instalado o no esta en PATH." -ForegroundColor Red
}
else {
    & git --version
    if (Test-Path (Join-Path $root ".git")) {
        $branch = (& git branch --show-current 2>$null) -join ""
        $commit = (& git rev-parse --short HEAD 2>$null) -join ""
        Write-Host "Rama:   $($branch.Trim())"
        Write-Host "Commit: $($commit.Trim())"
        & git status --short --branch
        & git remote -v
    }
    else {
        Write-Host "ADVERTENCIA: esta carpeta no es un clon de Git." -ForegroundColor Yellow
    }
}
Write-Host ""

Write-Host "--- Disco ---" -ForegroundColor Cyan
Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "C" } |
    ForEach-Object {
        $freeGb = [math]::Round($_.Free / 1GB, 1)
        Write-Host "C: libre $freeGb GB"
        if ($freeGb -lt 20) {
            Write-Host "ADVERTENCIA: quedan menos de 20 GB libres." -ForegroundColor Yellow
        }
    }
Write-Host ""

Write-Host "--- Puertos ---" -ForegroundColor Cyan
foreach ($port in @(3000, 5433, 5050, 9000, 9001, 80, 443)) {
    # Get-NetTCPConnection no siempre ve los listeners de Docker/Next en
    # Windows. Una conexion TCP real es mas fiable para el diagnostico.
    $open = $false
    try {
        $open = Test-NetConnection -ComputerName "127.0.0.1" -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
    }
    catch {
        $open = $false
    }
    if ($open) {
        Write-Host "  $port OCUPADO (TCP conecta)" -ForegroundColor Yellow
    }
    else {
        Write-Host "  $port libre"
    }
}
Write-Host ""

Write-Host "--- Firewall ---" -ForegroundColor Cyan
if (Test-IsAdmin) {
    $rule = Get-NetFirewallRule -DisplayName "Inteligencia Digna (3000)" -ErrorAction SilentlyContinue
    if ($rule) {
        Write-Host "Regla de firewall para 3000: existe"
    }
    else {
        Write-Host "Regla de firewall para 3000: no existe (el bootstrap la crea)"
    }
}
else {
    Write-Host "Se omite: ejecuta PowerShell como Administrador para revisar el firewall." -ForegroundColor Yellow
}
Write-Host ""

Write-Host "--- Archivos de entorno ---" -ForegroundColor Cyan
if (Test-Path (Join-Path $root ".env")) {
    Write-Host ".env: existe" -ForegroundColor Green
    try {
        $acl = Get-Acl -LiteralPath (Join-Path $root ".env")
        $usersRule = $acl.Access | Where-Object { $_.IdentityReference -match "Users|Usuarios" }
        if ($usersRule) {
            Write-Host "ADVERTENCIA: el grupo Users tiene acceso a .env. Revisa las ACL." -ForegroundColor Yellow
        }
        else {
            Write-Host ".env: sin acceso para el grupo Users" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "No se pudo leer la ACL de .env." -ForegroundColor Yellow
    }
}
else {
    Write-Host ".env: no existe (normal antes del bootstrap)"
}
Write-Host ""

Write-Host "--- Resumen ---" -ForegroundColor Cyan
if ($dockerOk -and $linuxOk) {
    Write-Host "Docker Linux: OK" -ForegroundColor Green
}
else {
    Write-Host "Docker Linux: REVISAR" -ForegroundColor Red
}
if ($gitCommand) {
    Write-Host "Git: OK" -ForegroundColor Green
}
else {
    Write-Host "Git: REVISAR" -ForegroundColor Red
}
Write-Host ""
Write-Host "Siguiente paso (como Administrador):" -ForegroundColor Cyan
Write-Host "  .\deploy\bootstrap-server.ps1 -Branch experimental"
Write-Host ""
