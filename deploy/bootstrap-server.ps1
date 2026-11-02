#Requires -Version 5.1
<#
.SYNOPSIS
    Primera instalacion de Inteligencia Digna en un servidor Windows.
.DESCRIPTION
    Genera .env con secretos aleatorios, levanta PostgreSQL, aplica migraciones,
    crea el bucket de MinIO, arranca la app y crea el super administrador.
    No borra volumenes existentes. Si .env ya existe, usa -Force para regenerarlo.
.EXAMPLE
    .\deploy\bootstrap-server.ps1 -Branch experimental
.EXAMPLE
    .\deploy\bootstrap-server.ps1 -PublicUrl http://192.168.1.50:3000 -OllamaUrl http://10.0.201.10:51234
#>
param(
    [string]$PublicUrl = "",
    [string]$OllamaUrl = "http://127.0.0.1:1",
    [string]$GoogleClientId = "",
    [string]$GoogleClientSecret = "",
    [string]$AdminEmail = "admin@digna.super",
    [string]$AdminName = "Administracion",
    [string]$AdminPassword = "",
    [string]$Branch = "experimental",
    [string]$PublicDomain = "",
    [switch]$SkipMinio,
    [switch]$EnableCaddy,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$root = Get-ProjectRoot
Set-Location $root
$envPath = Join-Path $root ".env"
$templatePath = Join-Path $root ".env.example"

Write-Host ""
Write-Host "=== Bootstrap de Inteligencia Digna ===" -ForegroundColor Cyan
Write-Host "Carpeta: $root"
Write-Host "Rama:    $Branch"
Write-Host ""

if (-not $DryRun) {
    $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $dockerCommand) {
        throw "docker no esta en PATH. Instala Docker y vuelve a intentar."
    }
    & docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker compose v2 no esta disponible." }

    if (-not (Test-IsAdmin)) {
        Write-Host "ADVERTENCIA: no estas en PowerShell como Administrador." -ForegroundColor Yellow
        Write-Host "             El firewall y algunas ACL pueden quedar sin aplicar." -ForegroundColor Yellow
        Write-Host ""
    }
}

if ($EnableCaddy -and -not $PublicDomain) {
    throw "Para -EnableCaddy necesitas -PublicDomain (ej. digna.midominio.com)."
}
if ($EnableCaddy) {
    $PublicUrl = "https://$PublicDomain"
}

if (-not $PublicUrl) {
    $ip = Get-PrimaryIPv4
    $suggested = "http://${ip}:3000"
    $answer = Read-Host "URL publica interna (Enter para $suggested)"
    if ([string]::IsNullOrWhiteSpace($answer)) {
        $PublicUrl = $suggested
    }
    else {
        $PublicUrl = $answer.Trim()
    }
}
if ($PublicUrl -notmatch '^https?://') {
    $PublicUrl = "http://$PublicUrl"
}
$PublicUrl = $PublicUrl.TrimEnd("/")

if ($PublicUrl -match '^http://' -and $PublicUrl -notmatch 'localhost|127\.0\.0\.1') {
    Write-Host "ADVERTENCIA: NEXTAUTH_URL usara HTTP. El login por email funciona," -ForegroundColor Yellow
    Write-Host "             pero Google OAuth necesita HTTPS (Caddy o un proxy TLS)." -ForegroundColor Yellow
    Write-Host ""
}

if (-not $AdminPassword) {
    $secure = Read-Host "Password para $AdminEmail" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
    throw "La password del administrador no puede estar vacia."
}

$servicePassword = New-RandomHex -Bytes 24
$jwtSecret = New-RandomHex -Bytes 32
$minioUser = "digna" + (New-RandomHex -Bytes 4)
$databaseUrl = "postgresql://inteligencia_digna:$servicePassword@127.0.0.1:5433/inteligencia_digna?sslmode=disable"
$databaseUrlInternal = "postgresql://inteligencia_digna:$servicePassword@postgres:5432/inteligencia_digna?sslmode=disable"
$ollamaUrl = $OllamaUrl.TrimEnd("/")

$values = @{
    NODE_ENV = "production"
    NEXTAUTH_URL = $PublicUrl
    APP_BIND_ADDRESS = "0.0.0.0"
    APP_PORT = "3000"
    JWT_SECRET = $jwtSecret
    GOOGLE_CLIENT_ID = $GoogleClientId
    GOOGLE_CLIENT_SECRET = $GoogleClientSecret
    NGROK_DOMAIN = ""
    ADMIN_EMAIL = $AdminEmail
    ADMIN_PASSWORD = ""
    ADMIN_NAME = $AdminName
    ADMIN_ROLE = "super_admin"
    POSTGRES_DB = "inteligencia_digna"
    POSTGRES_USER = "inteligencia_digna"
    POSTGRES_PASSWORD = $servicePassword
    POSTGRES_PORT = "5433"
    DATABASE_URL = $databaseUrl
    DATABASE_URL_INTERNAL = $databaseUrlInternal
    DATABASE_POOL_MAX = "10"
    DATABASE_SSL = "false"
    PGADMIN_EMAIL = "admin@digna.com"
    PGADMIN_PASSWORD = $servicePassword
    PGADMIN_PORT = "5050"
    MINIO_ROOT_USER = $minioUser
    MINIO_ROOT_PASSWORD = $servicePassword
    MINIO_HOST = "127.0.0.1"
    MINIO_PORT = "9000"
    MINIO_CONSOLE_PORT = "9001"
    MINIO_ENDPOINT = "http://127.0.0.1:9000"
    MINIO_ENDPOINT_INTERNAL = "http://minio:9000"
    MINIO_ACCESS_KEY = $minioUser
    MINIO_SECRET_KEY = $servicePassword
    MINIO_BUCKET = "attachments"
    MINIO_REGION = "us-east-1"
    MINIO_FORCE_PATH_STYLE = "true"
    LOG_LEVEL = "info"
    OLLAMA_URL = $ollamaUrl
    OLLAMA_TIMEOUT_MS = "5000"
    OLLAMA_EMBEDDING_TIMEOUT_MS = "5000"
    OLLAMA_CHAT_MODEL = "inteligencia-digna:qwen3.8-chat"
    OLLAMA_AGENT_MODEL = "inteligencia-digna:qwen3.6-agents"
    OLLAMA_EMBEDDING_MODEL = "inteligencia-digna:bge-m3-rag"
    OLLAMA_CHAT_CONTEXT_LENGTH = "32768"
    OLLAMA_AGENT_CONTEXT_LENGTH = "49152"
    OLLAMA_NUM_PREDICT = "4096"
    OLLAMA_TEMPERATURE = "0.3"
    OLLAMA_CHAT_KEEP_ALIVE = "-1"
    OLLAMA_AGENT_KEEP_ALIVE = "5m"
    OLLAMA_EMBEDDING_KEEP_ALIVE = "0"
    MAX_UPLOAD_MB = "20"
    SEARXNG_URL = "http://127.0.0.1:4000"
    PUBLIC_DOMAIN = $PublicDomain
    DEPLOY_BRANCH = $Branch
}

if ($DryRun) {
    Write-Host "DRY RUN: no se escribio nada." -ForegroundColor Cyan
    Write-Host "  NEXTAUTH_URL:           $PublicUrl"
    Write-Host "  DEPLOY_BRANCH:          $Branch"
    Write-Host "  POSTGRES_PASSWORD:      <generado, $($servicePassword.Length) caracteres>"
    Write-Host "  JWT_SECRET:             <generado, $($jwtSecret.Length) caracteres>"
    Write-Host "  MINIO_ROOT_USER:        $minioUser"
    Write-Host "  MINIO_ROOT_PASSWORD:    <generado>"
    Write-Host "  ADMIN_EMAIL:            $AdminEmail"
    Write-Host "  ADMIN_PASSWORD:         <no se guarda en .env>"
    $publicDomainText = "(vacio)"
    if ($PublicDomain) { $publicDomainText = $PublicDomain }
    Write-Host "  PUBLIC_DOMAIN:          $publicDomainText"
    Write-Host ""
    exit 0
}

if ((Test-Path -LiteralPath $envPath) -and -not $Force) {
    throw "Ya existe .env. Usa deploy.ps1 para actualizar o -Force para regenerar (pierdes los secretos actuales)."
}

Write-DotEnv -Path $envPath -Values $values -TemplatePath $templatePath
Write-Host ".env generado: $envPath" -ForegroundColor Green

try {
    Protect-FileAcl -Path $envPath
    Write-Host ".env: ACL restringida al usuario actual, Administradores y SYSTEM" -ForegroundColor Green
}
catch {
    Write-Host "ADVERTENCIA: no se pudo restringir la ACL de .env: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

& docker compose config --quiet
if ($LASTEXITCODE -ne 0) {
    throw "docker compose config fallo. Revisa .env antes de continuar."
}

Write-Host "1/6 PostgreSQL..." -ForegroundColor Cyan
& docker compose up -d postgres
if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar postgres." }
$pgId = Get-ComposeContainerId "postgres"
if (-not $pgId) { throw "postgres no aparece en docker compose ps." }
if (-not (Wait-ContainerHealthy -ContainerId $pgId -TimeoutSeconds 180)) {
    & docker compose logs --tail=100 postgres
    throw "postgres no quedo healthy."
}
Write-Host "    PostgreSQL listo" -ForegroundColor Green

Write-Host "2/6 Migraciones y seed..." -ForegroundColor Cyan
& docker compose run --rm migrate
if ($LASTEXITCODE -ne 0) { throw "Las migraciones fallaron." }
Write-Host "    Esquema listo" -ForegroundColor Green

if (-not $SkipMinio) {
    Write-Host "3/6 MinIO..." -ForegroundColor Cyan
    & docker compose --profile local-storage up -d minio
    if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar minio." }
    $minioId = Get-ComposeContainerId "minio"
    if (-not $minioId) { throw "minio no aparece en docker compose ps." }
    if (-not (Wait-ContainerHealthy -ContainerId $minioId -TimeoutSeconds 180)) {
        & docker compose logs --tail=100 minio
        throw "minio no quedo healthy."
    }
    & docker compose --profile local-storage run --rm storage-init
    if ($LASTEXITCODE -ne 0) { throw "storage-init fallo." }
    Write-Host "    MinIO y bucket listos" -ForegroundColor Green
}
else {
    Write-Host "3/6 MinIO omitido (-SkipMinio)" -ForegroundColor Yellow
}

Write-Host "4/6 Aplicacion..." -ForegroundColor Cyan
& docker compose up -d --no-deps app
if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar la app." }
$appId = Get-ComposeContainerId "app"
if (-not $appId) { throw "app no aparece en docker compose ps." }
if (-not (Wait-ContainerHealthy -ContainerId $appId -TimeoutSeconds 180)) {
    & docker compose logs --tail=120 app
    throw "La app no quedo healthy."
}
Write-Host "    App lista" -ForegroundColor Green

Write-Host "5/6 Super administrador..." -ForegroundColor Cyan
$env:ADMIN_EMAIL = $AdminEmail
$env:ADMIN_PASSWORD = $AdminPassword
$env:ADMIN_NAME = $AdminName
$env:ADMIN_ROLE = "super_admin"
try {
    & docker compose run --rm --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD -e ADMIN_NAME -e ADMIN_ROLE app npm run db:create-admin
    if ($LASTEXITCODE -ne 0) { throw "db:create-admin fallo." }
}
finally {
    Remove-Item Env:ADMIN_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:ADMIN_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:ADMIN_ROLE -ErrorAction SilentlyContinue
}
Write-Host "    Administrador creado" -ForegroundColor Green

Write-Host "6/6 Firewall y salud..." -ForegroundColor Cyan
if (Test-IsAdmin) {
    $ports = @(3000)
    if ($EnableCaddy) { $ports += 80; $ports += 443 }
    foreach ($port in $ports) {
        $displayName = "Inteligencia Digna ($port)"
        $rule = Get-NetFirewallRule -DisplayName $displayName -ErrorAction SilentlyContinue
        if (-not $rule) {
            New-NetFirewallRule -DisplayName $displayName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
            Write-Host "    Firewall: puerto $port abierto" -ForegroundColor Green
        }
        else {
            Write-Host "    Firewall: regla $port existente" -ForegroundColor Green
        }
    }
}

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
if ($healthOk) {
    Write-Host "    Health check: OK" -ForegroundColor Green
}
else {
    Write-Host "    ADVERTENCIA: no respondio http://127.0.0.1:3000/" -ForegroundColor Yellow
}

if ($EnableCaddy) {
    Write-Host "Iniciando Caddy para https://$PublicDomain ..." -ForegroundColor Cyan
    & docker compose -f compose.yaml -f compose.proxy.yaml --profile proxy up -d caddy
    if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar Caddy." }
    Write-Host "    Caddy iniciado" -ForegroundColor Green
}

$commit = ""
if (Test-Path (Join-Path $root ".git")) {
    $commit = ((& git rev-parse --short HEAD 2>$null) -join "").Trim()
}

$credentialsDir = "C:\ProgramData\InteligenciaDigna"
New-Item -ItemType Directory -Force -Path $credentialsDir | Out-Null
$credentialsPath = Join-Path $credentialsDir "CREDENTIALS.txt"
$googleIdText = "(no configurado)"
if ($GoogleClientId) { $googleIdText = $GoogleClientId }
$googleSecretText = "(no configurado)"
if ($GoogleClientSecret) { $googleSecretText = "(configurado)" }
$caddyText = "(sin dominio publico)"
if ($PublicDomain) { $caddyText = "https://$PublicDomain" }

$credentials = @"
Inteligencia Digna - Credenciales del servidor
Generado: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Equipo: $env:COMPUTERNAME
URL publica: $PublicUrl
Dominio/Caddy: $caddyText
Rama: $Branch
Commit: $commit

Aplicacion
  URL: $PublicUrl
  Admin email: $AdminEmail
  Admin password: $AdminPassword

PostgreSQL
  Host: 127.0.0.1
  Puerto: 5433
  Base: inteligencia_digna
  Usuario: inteligencia_digna
  Password: $servicePassword

pgAdmin (solo 127.0.0.1, por RDP)
  URL: http://127.0.0.1:5050
  Email: admin@digna.com
  Password: $servicePassword

MinIO (solo 127.0.0.1, por RDP)
  Consola: http://127.0.0.1:9001
  API: http://127.0.0.1:9000
  Usuario: $minioUser
  Password: $servicePassword
  Bucket: attachments

Secretos de la aplicacion
  JWT_SECRET: $jwtSecret
  Google Client ID: $googleIdText
  Google Client Secret: $googleSecretText

Notas
  - Cambia la password del admin antes de datos reales.
  - Rota el token de ngrok y este archivo si se compartio por chat.
  - No copies este archivo al repositorio.
  - PostgreSQL, pgAdmin y MinIO escuchan solo en 127.0.0.1.
"@

[IO.File]::WriteAllText($credentialsPath, $credentials, (New-Object System.Text.UTF8Encoding($false)))
try {
    Protect-FileAcl -Path $credentialsPath
}
catch {
    Write-Host "ADVERTENCIA: no se pudo restringir la ACL de $credentialsPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Bootstrap completado ===" -ForegroundColor Green
Write-Host "App:         $PublicUrl"
Write-Host "Credenciales: $credentialsPath"
Write-Host ""
Write-Host "Siguiente paso: prueba el login con $AdminEmail."
Write-Host "Para actualizar: .\deploy\deploy.ps1"
Write-Host ""
