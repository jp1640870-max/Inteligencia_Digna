# Funciones compartidas por los scripts de despliegue.
# Compatible con Windows PowerShell 5.1 (sin sintaxis de PowerShell 7).
$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

function Read-DotEnv {
    param([string]$Path)
    $result = @{}
    if (-not (Test-Path -LiteralPath $Path)) { return $result }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) { continue }
        $key = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        $result[$key] = $value
    }
    return $result
}

function Write-DotEnv {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Values,
        [string]$TemplatePath
    )
    $lines = New-Object System.Collections.Generic.List[string]
    $seen = @{}
    if ($TemplatePath -and (Test-Path -LiteralPath $TemplatePath)) {
        foreach ($line in Get-Content -LiteralPath $TemplatePath) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
                $key = $Matches[1]
                if ($Values.ContainsKey($key)) {
                    $lines.Add("$key=$($Values[$key])")
                    $seen[$key] = $true
                }
                else {
                    $lines.Add($line)
                }
            }
            else {
                $lines.Add($line)
            }
        }
    }
    foreach ($key in $Values.Keys) {
        if (-not $seen.ContainsKey($key)) {
            $lines.Add("$key=$($Values[$key])")
        }
    }
    $content = ($lines -join "`n") + "`n"
    [IO.File]::WriteAllText($Path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function New-RandomHex {
    param([int]$Bytes = 24)
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
}

function Get-ComposeContainerId {
    param([string]$Service)
    $id = & docker compose ps -q $Service 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    if (-not $id) { return $null }
    return (($id | Select-Object -First 1) + "").Trim()
}

function Wait-ContainerHealthy {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerId,
        [int]$TimeoutSeconds = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerId 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $status = (($status | Select-Object -First 1) + "").Trim()
        if ($status -eq "healthy" -or $status -eq "running") { return $true }
        if ($status -eq "unhealthy" -or $status -eq "exited" -or $status -eq "dead") { return $false }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Protect-FileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) {
        [void]$acl.RemoveAccessRule($rule)
    }
    # Usar el SID evita fallos de resolucion de nombres en equipos unidos a un
    # dominio cuyo controlador no esta accesible.
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $adminSid = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
    $systemSid = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
    $inheritance = [Security.AccessControl.InheritanceFlags]::None
    $propagation = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($userSid, "Read,Write", $inheritance, $propagation, $allow)))
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($adminSid, "Read,Write", $inheritance, $propagation, $allow)))
    [void]$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($systemSid, "Read,Write", $inheritance, $propagation, $allow)))
    try {
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
    catch {
        # En equipos unidos a un dominio sin controlador accesible, Set-Acl
        # puede fallar al resolver nombres. icacls trabaja con SIDs.
        $sidText = $userSid.Value
        & icacls $Path /inheritance:r /grant:r "*${sidText}:(F)" "*S-1-5-32-544:(F)" "*S-1-5-18:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "No se pudo aplicar la ACL con Set-Acl ni con icacls: $($_.Exception.Message)"
        }
    }
}

function Get-PrimaryIPv4 {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric |
        Select-Object -First 1
    if ($route) {
        $address = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
            Select-Object -First 1
        if ($address) { return $address.IPAddress }
    }
    $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
        Select-Object -First 1
    if ($fallback) { return $fallback.IPAddress }
    return "127.0.0.1"
}
