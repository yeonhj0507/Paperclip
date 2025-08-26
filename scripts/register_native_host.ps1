#requires -Version 5.1
param(
    [string[]]$ChromeExtIds,
    [string[]]$EdgeExtIds,
    [switch]$RegisterBrave
)

Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "register_native_host"

try {
    $repo        = Get-RepoRoot
    $installRoot = Join-Path $env:LOCALAPPDATA 'PaperClip'
    Ensure-Directory $installRoot

    $hostExe = Join-Path $installRoot 'PaperClipHost.exe'
    if (-not (Test-Path -LiteralPath $hostExe)) {
        $search = Get-ChildItem -Path (Join-Path $repo 'native') -Filter 'PaperClipHost.exe' -Recurse -ErrorAction SilentlyContinue |
                  Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($search) { $hostExe = $search.FullName }
    }
    if (-not (Test-Path -LiteralPath $hostExe)) {
        Write-InstallLog "Host EXE not found yet. Manifest will still point to: $hostExe" "WARN"
    } else {
        Write-InstallLog "Host EXE: $hostExe" "INFO"
    }

    $hostName = 'com.paperclip.host'

    # 확장 ID 수집 (생략 시 placeholder)
    if (-not $ChromeExtIds -or $ChromeExtIds.Count -eq 0) { $ChromeExtIds = ($env:PC_CHROME_EXT_IDS -split '[,\s]+' | Where-Object { $_ }) }
    if (-not $EdgeExtIds   -or $EdgeExtIds.Count   -eq 0) { $EdgeExtIds   = ($env:PC_EDGE_EXT_IDS   -split '[,\s]+' | Where-Object { $_ }) }
    $usedPlaceholder = $false
    if (-not $ChromeExtIds -or $ChromeExtIds.Count -eq 0) { $ChromeExtIds = @('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'); $usedPlaceholder = $true }
    if (-not $EdgeExtIds   -or $EdgeExtIds.Count   -eq 0) { $EdgeExtIds   = @('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'); $usedPlaceholder = $true }
    if ($usedPlaceholder) {
        Write-InstallLog "Using placeholder extension IDs. Re-run with -ChromeExtIds/-EdgeExtIds for real linkage." "WARN"
    }

    $chromeOrigins = $ChromeExtIds | ForEach-Object { "chrome-extension://{0}/" -f $_ }
    $edgeOrigins   = $EdgeExtIds   | ForEach-Object { "chrome-extension://{0}/" -f $_ }

    $common = @{
        name = $hostName
        description = "PaperClip Native Messaging Host"
        type = "stdio"
        path = $hostExe
    }

    $chromeManifest = Join-Path $installRoot "$hostName.chrome.json"
    $edgeManifest   = Join-Path $installRoot "$hostName.edge.json"
    $braveManifest  = Join-Path $installRoot "$hostName.brave.json"

    ($common + @{ allowed_origins = $chromeOrigins }) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $chromeManifest -Encoding UTF8
    ($common + @{ allowed_origins = $edgeOrigins   }) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $edgeManifest   -Encoding UTF8
    if ($RegisterBrave) {
        ($common + @{ allowed_origins = $chromeOrigins }) | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $braveManifest -Encoding UTF8
    }

    $chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
    New-Item -Path $chromeKey -Force | Out-Null
    Set-Item  -Path $chromeKey -Value $chromeManifest

    $edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
    New-Item -Path $edgeKey -Force | Out-Null
    Set-Item  -Path $edgeKey -Value $edgeManifest

    if ($RegisterBrave) {
        $braveKey = "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\$hostName"
        New-Item -Path $braveKey -Force | Out-Null
        Set-Item  -Path $braveKey -Value $braveManifest
    }

    # 알림 (환경변수/레지스트리 반영)
    try {
        Add-Type -Namespace Win32 -Name Native -MemberDefinition @"
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
    public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, int Msg, System.IntPtr wParam, string lParam, int fuFlags, int uTimeout, out System.IntPtr lpdwResult);
"@
        $HWND_BROADCAST = [IntPtr]0xffff
        $WM_SETTINGCHANGE = 0x1A
        $SMTO_ABORTIFHUNG = 0x0002
        $result = [IntPtr]::Zero
        [Win32.Native]::SendMessageTimeout($HWND_BROADCAST, $WM_SETTINGCHANGE, [IntPtr]::Zero, "Environment", $SMTO_ABORTIFHUNG, 5000, [ref]$result) | Out-Null
    } catch {}

    Write-InstallLog "register_native_host completed." "OK"
}
catch {
    Write-InstallLog "register_native_host failed: $($_.Exception.Message)" "ERROR"
    throw
}
