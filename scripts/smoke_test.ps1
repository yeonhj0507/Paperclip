#requires -Version 5.1
param([ValidateSet('arm64','x64')] [string]$Arch = 'arm64')

Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "smoke_test"

try {
    $repo        = Get-RepoRoot
    $installRoot = Join-Path $env:LOCALAPPDATA 'PaperClip'
    $hostExe     = Join-Path $installRoot 'PaperClipHost.exe'

    if (-not (Test-Path -LiteralPath $hostExe)) {
        $nativeRoot = Join-Path $repo 'native'
        $hostExe = Get-ChildItem -Path $nativeRoot -Filter 'PaperClipHost.exe' -Recurse -ErrorAction SilentlyContinue |
                   Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $hostExe) { throw "Host exe not found: PaperClipHost.exe (searched $installRoot and repo/native)" }

    # Native Messaging ping
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $hostExe
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $p = [System.Diagnostics.Process]::Start($psi)
    $enc = [System.Text.Encoding]::UTF8
    $msg = '{"type":"ping"}'
    $len = [BitConverter]::GetBytes([uint32]$enc.GetByteCount($msg))

    $p.StandardInput.BaseStream.Write($len,0,4)
    $p.StandardInput.Write($msg)
    $p.StandardInput.Flush()

    $lenbuf = New-Object byte[] 4
    $read = $p.StandardOutput.BaseStream.Read($lenbuf,0,4)
    if ($read -ne 4) { throw "No reply frame length from host" }
    $plen = [BitConverter]::ToUInt32($lenbuf,0)
    $buf = New-Object byte[] $plen
    $got = 0
    while ($got -lt $plen) {
        $r = $p.StandardOutput.BaseStream.Read($buf,$got,$plen-$got)
        if ($r -le 0) { break }
        $got += $r
    }
    $resp = $enc.GetString($buf,0,$got)
    Write-InstallLog "Ping response: $resp" "OK"
    try { $p.Kill() | Out-Null } catch {}

    Write-InstallLog "smoke_test completed." "OK"
}
catch {
    Write-InstallLog "smoke_test failed: $($_.Exception.Message)" "ERROR"
    throw
}
