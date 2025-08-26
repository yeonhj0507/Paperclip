#requires -Version 5.1
param(
    [ValidateSet('chrome','edge')] [string]$Browser = 'chrome',
    [string]$ExtensionPath = "$PSScriptRoot\..\extension",
    [int]$BootSeconds = 5
)
Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "detect_extension_id_$Browser"

try {
    $repo   = Get-RepoRoot
    $extAbs = (Resolve-Path -LiteralPath $ExtensionPath).ProviderPath
    if (-not (Test-Path -LiteralPath $extAbs)) { throw "Extension path not found: $extAbs" }

    $exe = Get-BrowserPath -Browser $Browser
    Write-InstallLog "$Browser path: $exe" "INFO"

    $tempProfile = Join-Path $env:TEMP ("igr_ext_profile_{0}_{1}" -f $Browser, [Guid]::NewGuid().ToString('N'))
    Ensure-Directory $tempProfile

    $args = @(
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-background-networking",
        "--disable-features=Translate",
        "--user-data-dir=`"$tempProfile`"",
        "--load-extension=`"$extAbs`""
    )
    Write-InstallLog "Launching $Browser with extension (temp profile): $tempProfile" "INFO"
    $proc = Start-Process -FilePath $exe -ArgumentList $args -PassThru -WindowStyle Minimized

    Start-Sleep -Seconds $BootSeconds

    # Kill the browser so Preferences is flushed
    Stop-Browser -Browser $Browser

    $prefs = Join-Path $tempProfile 'Default\Preferences'
    Write-InstallLog "Parsing Preferences: $prefs" "INFO"
    $id = Get-ExtensionIdFromPreferences -PreferencesPath $prefs -ExtensionPath $extAbs
    Write-Host $id
    Write-InstallLog "Detected extension id: $id" "OK"

    # Cleanup temp profile (best-effort)
    try { Remove-Item -LiteralPath $tempProfile -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}
catch {
    Write-InstallLog "detect_extension_id failed: $($_.Exception.Message)" "ERROR"
    throw
}
