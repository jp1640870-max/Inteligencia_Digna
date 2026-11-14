param(
    [switch]$Stop,
    [string]$SshHost = "dgx-spark",
    [int]$Port = 8188
)

$ErrorActionPreference = "Stop"
$pidFile = Join-Path $env:TEMP "comfy-tunnel.pid"

function Test-LocalPort {
    param([int]$Puerto)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect("127.0.0.1", $Puerto)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

if ($Stop) {
    if (Test-Path -LiteralPath $pidFile) {
        $tunnelPid = [int](Get-Content -LiteralPath $pidFile)
        Stop-Process -Id $tunnelPid -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        Write-Host "Tunel detenido (PID $tunnelPid)."
    } else {
        Write-Host "No hay tunel registrado."
    }
    exit 0
}

if (Test-LocalPort $Port) {
    Write-Host "El puerto $Port ya esta escuchando en localhost."
    exit 0
}

$argumentos = @(
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-L", "${Port}:127.0.0.1:${Port}",
    $SshHost
)

$proceso = Start-Process -FilePath "ssh.exe" -ArgumentList $argumentos -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

if (-not (Test-LocalPort $Port)) {
    Stop-Process -Id $proceso.Id -Force -ErrorAction SilentlyContinue
    throw "No se pudo abrir el tunel SSH. Revisa 'ssh $SshHost' y la configuracion de ~/.ssh."
}

$proceso.Id | Set-Content -LiteralPath $pidFile
Write-Host "Tunel activo: http://127.0.0.1:$Port -> $SshHost ($Port) [PID $($proceso.Id)]"
