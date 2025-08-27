#requires -Version 5.1
param(
    [ValidateSet('arm64','x64')] [string]$Arch = 'ARM64'
)
Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "install_host"

try {
    $repo      = Get-RepoRoot
    $install   = Join-Path $env:LOCALAPPDATA 'PaperClip'
    $bundleSrc = Join-Path $repo 'runtime\genie_bundle'
    $cfgSrc    = Join-Path $repo 'runtime\genie_config.json'
    $binDir    = Join-Path $repo "native\projects\bin\$Arch\Release"
    $dllSrc    = Join-Path $binDir 'PaperClipNative.dll'
    $exeSrc    = Join-Path $binDir 'PaperClipHost.exe'

    # Dest
    $bundleDst = Join-Path $install 'genie_bundle'
    $cfgDst    = Join-Path $install 'genie_config.json'
    $dllDst    = Join-Path $install 'PaperClipNative.dll'
    $exeDst    = Join-Path $install 'PaperClipHost.exe'
    $logHost   = Join-Path $install 'host'
    Ensure-Directory $install
    Ensure-Directory $logHost

    # Validate sources
    foreach ($p in @($bundleSrc, $cfgSrc, $dllSrc, $exeSrc)) {
        if (-not (Test-Path -LiteralPath $p)) { throw "Missing source: $p" }
    }

    # Copy runtime & binaries
    Copy-Safe -Source $bundleSrc -Destination $bundleDst
    Copy-Safe -Source $cfgSrc    -Destination $cfgDst
    Copy-Safe -Source $dllSrc    -Destination $dllDst
    Copy-Safe -Source $exeSrc    -Destination $exeDst

    # Environment variables (User scope)
    [Environment]::SetEnvironmentVariable('PC_MODEL_BASE_DIR', $install, 'User')
    [Environment]::SetEnvironmentVariable('PC_CONFIG_PATH',    $cfgDst,  'User')
    Write-InstallLog "Set env: PC_MODEL_BASE_DIR=$install" "OK"
    Write-InstallLog "Set env: PC_CONFIG_PATH=$cfgDst"     "OK"

    Write-InstallLog "install_host completed." "OK"
}
catch {
    Write-InstallLog "install_host failed: $($_.Exception.Message)" "ERROR"
    throw
}
