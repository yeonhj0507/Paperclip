#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RepoRoot {
    param()
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory=$true)][string]$Path
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

$script:LOG_FILE = $null

function Start-InstallLog {
    param([string]$Name = "install")
    $repo   = Get-RepoRoot
    $logDir = Join-Path $repo 'logs\install'
    Ensure-Directory $logDir
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $script:LOG_FILE = Join-Path $logDir "$($Name)_$($timestamp).log"
    "===== LOG START $([DateTime]::Now) =====" | Out-File -FilePath $script:LOG_FILE -Encoding UTF8 -Append
    return $script:LOG_FILE
}

function Write-InstallLog {
    param(
        [Parameter(Mandatory=$true)][string]$Message,
        [ValidateSet('INFO','WARN','ERROR','OK')] [string]$Level = 'INFO'
    )
    $line = "[$Level] $(Get-Date -Format 'HH:mm:ss') $Message"
    Write-Host $line
    if ($script:LOG_FILE) { $line | Out-File -FilePath $script:LOG_FILE -Encoding UTF8 -Append }
}

function Read-JsonFile {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "JSON file not found: $Path"
    }
    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    return $raw | ConvertFrom-Json -Depth 100
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory=$true)]$Object,
        [Parameter(Mandatory=$true)][string]$Path
    )
    $json = $Object | ConvertTo-Json -Depth 100
    $dir  = Split-Path -Parent $Path
    Ensure-Directory $dir
    $json | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Paths-Equal { param([string]$A, [string]$B)
    try {
        $ra = Resolve-Path -LiteralPath $A -ErrorAction Stop
        $rb = Resolve-Path -LiteralPath $B -ErrorAction Stop
        return ($ra.ProviderPath.ToLowerInvariant() -eq $rb.ProviderPath.ToLowerInvariant())
    } catch { return $false }
}

function Copy-Safe {
    param(
        [Parameter(Mandatory=$true)][string]$Source,
        [Parameter(Mandatory=$true)][string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source)) { throw "Source does not exist: $Source" }

    if (Test-Path -LiteralPath $Destination) {
        if (Paths-Equal -A $Source -B $Destination) {
            Write-InstallLog "Copy-Safe: Skipped (src==dst) $Source" "INFO"
            return
        }
    }

    $attr = Get-Item -LiteralPath $Source
    if ($attr.PSIsContainer) {
        Ensure-Directory $Destination
        $robolog = [System.IO.Path]::GetTempFileName()
        $cmd = @("robocopy", "`"$Source`"", "`"$Destination`"", "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS")
        Write-InstallLog "ROBOCOPY $Source -> $Destination" "INFO"
        $proc = Start-Process -FilePath $cmd[0] -ArgumentList $cmd[1..($cmd.Count-1)] -PassThru -Wait -NoNewWindow -RedirectStandardOutput $robolog
        $code = $proc.ExitCode
        $out  = Get-Content -LiteralPath $robolog -Raw
        Remove-Item -Force $robolog -ErrorAction SilentlyContinue
        if ($code -le 7) {
            Write-InstallLog "ROBOCOPY success (code=$code)" "OK"
        } else {
            Write-InstallLog "ROBOCOPY failed (code=$code)" "ERROR"
            throw "Robocopy failed with code $code"
        }
    } else {
        Ensure-Directory (Split-Path -Parent $Destination)
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        Write-InstallLog "Copy-Item $Source -> $Destination (file)" "OK"
    }
}

function Get-MSBuildPath {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' 2>$null
        if ($msbuild) { return ($msbuild | Select-Object -First 1) }
    }
    $fallbacks = @(
        "$env:ProgramFiles\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
        "$env:ProgramFiles(x86)\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
        "MSBuild.exe"
    )
    foreach ($f in $fallbacks) {
        try {
            $p = (Get-Command $f -ErrorAction Stop).Source
            if ($p) { return $p }
        } catch {}
    }
    throw "MSBuild.exe not found. Install Visual Studio Build Tools."
}

function Invoke-MSBuild {
    param(
        [Parameter(Mandatory=$true)][string]$Solution,
        [ValidateSet('Debug','Release')][string]$Configuration = 'Release',
        [ValidateSet('ARM64','x64')][string]$Platform = 'ARM64'
    )
    if (-not (Test-Path -LiteralPath $Solution)) {
        throw "Solution not found: $Solution"
    }
    $msbuild = Get-MSBuildPath
    Write-InstallLog "MSBuild: $msbuild" "INFO"
    $args = @(
        "`"$Solution`"",
        "/t:Build",
        "/p:Configuration=$Configuration",
        "/p:Platform=$Platform",
        "/m"
    )
    Write-InstallLog "MSBuild args: $($args -join ' ')" "INFO"
    $proc = Start-Process -FilePath $msbuild -ArgumentList $args -PassThru -Wait -NoNewWindow
    if ($proc.ExitCode -ne 0) { throw "MSBuild failed with exit code $($proc.ExitCode)" }
    Write-InstallLog "MSBuild finished successfully." "OK"
}

function Get-BrowserPath {
    param([Parameter(Mandatory=$true)][ValidateSet('chrome','edge')][string]$Browser)

    if ($Browser -eq 'chrome') {
        $candidates = @(
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"
        )
    } else {
        $candidates = @(
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
        )
    }

    foreach ($p in $candidates) { if (Test-Path -LiteralPath $p) { return $p } }

    # PowerShell 5.1 호환: 삼항 대신 if/else 사용
    $name = $null
    if ($Browser -eq 'chrome') { $name = 'chrome.exe' } else { $name = 'msedge.exe' }

    try { return (Get-Command $name -ErrorAction Stop).Source }
    catch { throw "$Browser not found. Install $Browser first." }
}

function Stop-Browser { param([ValidateSet('chrome','edge')][string]$Browser)
    $names = @()
    if ($Browser -eq 'chrome') { $names += 'chrome' }
    if ($Browser -eq 'edge')   { $names += 'msedge' }
    foreach ($n in $names) {
        Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

function Get-ExtensionIdFromPreferences {
    param(
        [Parameter(Mandatory=$true)][string]$PreferencesPath,
        [Parameter(Mandatory=$true)][string]$ExtensionPath
    )
    if (-not (Test-Path -LiteralPath $PreferencesPath)) { throw "Preferences not found: $PreferencesPath" }
    $extPathNorm = (Resolve-Path -LiteralPath $ExtensionPath).ProviderPath.ToLowerInvariant()
    $prefs = Read-JsonFile -Path $PreferencesPath

    if (-not $prefs.extensions -or -not $prefs.extensions.settings) {
        throw "Invalid Preferences structure: extensions.settings missing"
    }

    $settings = $prefs.extensions.settings.PSObject.Properties
    foreach ($prop in $settings) {
        $id   = $prop.Name
        $info = $prop.Value
        $p = $info.path
        if (-not $p) { continue }
        try {
            $pNorm = (Resolve-Path -LiteralPath $p).ProviderPath.ToLowerInvariant()
        } catch {
            $pNorm = $p.ToString().ToLowerInvariant()
        }
        if ($pNorm -eq $extPathNorm) { return $id }
    }
    throw "Could not find extension id for path: $ExtensionPath"
}

function New-RegistryDefaultValue {
    param(
        [Parameter(Mandatory=$true)][string]$KeyPath,
        [Parameter(Mandatory=$true)][string]$Value
    )
    if (-not (Test-Path -LiteralPath $KeyPath)) {
        New-Item -Path $KeyPath -Force | Out-Null
    }
    New-ItemProperty -Path $KeyPath -Name '(default)' -Value $Value -PropertyType String -Force | Out-Null
    Write-InstallLog "Registry $( $KeyPath ) = $Value" "OK"
}

Export-ModuleMember -Function * -Alias *
