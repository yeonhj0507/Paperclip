#requires -Version 5.1
param(
    [ValidateSet('arm64','x64')] [string]$Arch = 'arm64',
    [switch]$EdgeAlso = $true
)
Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "install_all"

try {
    $repo = Get-RepoRoot
    Write-InstallLog "Repo: $repo" "INFO"
    Write-InstallLog "Arch: $Arch" "INFO"

    Write-InstallLog "== Step 1: Build native ==" "INFO"
    & "$PSScriptRoot\build_native.ps1" -Arch $Arch

    Write-InstallLog "== Step 2: Install host/runtime ==" "INFO"
    & "$PSScriptRoot\install_host.ps1" -Arch $Arch

    Write-InstallLog "== Step 3: Register native host (Chrome/Edge) ==" "INFO"
    & "$PSScriptRoot\register_native_host.ps1"

    Write-InstallLog "== Step 4: Smoke test ==" "INFO"
    & "$PSScriptRoot\smoke_test.ps1"

    Write-InstallLog "== Step 5: Launch dev browser(s) with extension ==" "INFO"
    $extPath = (Resolve-Path "$repo\extension").ProviderPath
    $chrome  = Get-BrowserPath -Browser 'chrome'
    Start-Process -FilePath $chrome -ArgumentList "--load-extension=`"$extPath`""
    Write-InstallLog "Launched Chrome with extension: $extPath" "OK"

    if ($EdgeAlso) {
        try {
            $edge = Get-BrowserPath -Browser 'edge'
            Start-Process -FilePath $edge -ArgumentList "--load-extension=`"$extPath`""
            Write-InstallLog "Launched Edge with extension: $extPath" "OK"
        } catch {
            Write-InstallLog "Edge launch skipped: $($_.Exception.Message)" "WARN"
        }
    }

    Write-InstallLog "All done. ✅ Open Gmail and check extension background logs." "OK"
}
catch {
    Write-InstallLog "install_all failed: $($_.Exception.Message)" "ERROR"
    throw
}
