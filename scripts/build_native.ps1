#requires -Version 5.1
param(
    [ValidateSet('arm64','x64')] [string]$Arch = 'arm64'
)

Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "install_host"

function Find-LatestFile {
    param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string[]]$Patterns)
    $hits = @()
    foreach ($pat in $Patterns) { $hits += Get-ChildItem -Path $Root -Filter $pat -Recurse -ErrorAction SilentlyContinue }
    if ($hits.Count -eq 0) { return $null }
    return ($hits | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

try {
    $repo        = Get-RepoRoot
    $nativeRoot  = Join-Path $repo 'native'
    $runtimeDir  = Join-Path $repo 'runtime'
    $bundleSrc   = Join-Path $runtimeDir 'genie_bundle'
    $cfgSrc      = Join-Path $runtimeDir 'genie_config.json'

    # === 설치 루트: %LOCALAPPDATA%\PaperClip (요구사항) ===
    $installRoot = Join-Path $env:LOCALAPPDATA 'PaperClip'
    Ensure-Directory $installRoot

    # (마이그레이션) 예전 IGR 폴더가 있으면 필요한 파일만 가져온다
    $legacy = Join-Path $env:LOCALAPPDATA 'IGR'
    if ((Test-Path -LiteralPath $legacy) -and -not (Test-Path -LiteralPath (Join-Path $installRoot 'PaperClipHost.exe'))) {
        Write-InstallLog "Migrating artifacts from old folder: $legacy -> $installRoot" "INFO"
        foreach ($n in @('PaperClipHost.exe','PaperClipNative.dll','genie_config.json')) {
            $src = Join-Path $legacy $n
            if (Test-Path -LiteralPath $src) {
                Copy-Safe -Source $src -Destination (Join-Path $installRoot $n)
            }
        }
        if (Test-Path -LiteralPath (Join-Path $legacy 'genie_bundle')) {
            Copy-Safe -Source (Join-Path $legacy 'genie_bundle') -Destination (Join-Path $installRoot 'genie_bundle')
        }
    }

    # === 산출물 탐색 (우선 종전 빌드 힌트 경로) ===
    $archFolder = if ($Arch -eq 'arm64') { 'ARM64' } else { 'x64' }

    # DLL (PaperClipNative.dll 선호, 없으면 PoliteRewrite.dll)
    $dllSrc = $null
    foreach ($n in @('PaperClipNative.dll','PoliteRewrite.dll')) {
        $dllSrc = Find-LatestFile -Root $nativeRoot -Patterns @($n)
        if ($dllSrc) { break }
    }

    # EXE (반드시 PaperClipHost.exe)
    $exeSrc = $null
    $hint1 = Join-Path $repo ("native\projects\bin\{0}\Release" -f $archFolder)
    if (Test-Path -LiteralPath $hint1) { $exeSrc = Find-LatestFile -Root $hint1 -Patterns @('PaperClipHost.exe') }
    if (-not $exeSrc) { $exeSrc = Find-LatestFile -Root $nativeRoot -Patterns @('PaperClipHost.exe') }

    # 없으면 Host만 추가 빌드
    if (-not $exeSrc) {
        Write-InstallLog "PaperClipHost.exe not found. Building host project..." "WARN"
        $hostProj = Get-ChildItem -Path $nativeRoot -Filter '*Host.vcxproj' -Recurse -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -ieq 'PaperClipHost.vcxproj' } | Select-Object -First 1
        if (-not $hostProj) { throw "Host project not found: PaperClipHost.vcxproj under $nativeRoot" }
        $platform = if ($Arch -eq 'arm64') { 'ARM64' } else { 'x64' }
        Invoke-MSBuild -Solution $hostProj.FullName -Configuration 'Release' -Platform $platform
        $exeSrc = Find-LatestFile -Root $nativeRoot -Patterns @('PaperClipHost.exe')
    }

    # === 소스 확인 ===
    if (-not (Test-Path -LiteralPath $bundleSrc)) { throw "Missing bundle: $bundleSrc" }
    if (-not (Test-Path -LiteralPath $cfgSrc))    { throw "Missing config: $cfgSrc" }
    if (-not $dllSrc) { throw "Missing DLL artifact (PaperClipNative.dll / PoliteRewrite.dll) under $nativeRoot" }
    if (-not $exeSrc) { throw "Missing EXE artifact: PaperClipHost.exe under $nativeRoot" }

    Write-InstallLog "Using DLL: $dllSrc" "INFO"
    Write-InstallLog "Using EXE: $exeSrc" "INFO"

    # === 복사 대상 경로 ===
    $bundleDst = Join-Path $installRoot 'genie_bundle'
    $cfgDst    = Join-Path $installRoot 'genie_config.json'
    $dllDst    = Join-Path $installRoot (Split-Path -Leaf $dllSrc)
    $exeDst    = Join-Path $installRoot 'PaperClipHost.exe'

    # === 복사 ===
    Copy-Safe -Source $bundleSrc -Destination $bundleDst
    Copy-Safe -Source $cfgSrc    -Destination $cfgDst
    Copy-Safe -Source $dllSrc    -Destination $dllDst
    Copy-Safe -Source $exeSrc    -Destination $exeDst

    # === 환경변수 (User) — PaperClip 기준으로 정리 ===
    [Environment]::SetEnvironmentVariable('PC_MODEL_BASE_DIR', $installRoot, 'User')
    [Environment]::SetEnvironmentVariable('PC_CONFIG_PATH',    $cfgDst,      'User')
    [Environment]::SetEnvironmentVariable('PC_SUGGESTION_DLL', $dllDst,      'User')

    Write-InstallLog "Set env: PC_MODEL_BASE_DIR=$installRoot" "OK"
    Write-InstallLog "Set env: PC_CONFIG_PATH=$cfgDst"         "OK"
    Write-InstallLog "Set env: PC_SUGGESTION_DLL=$dllDst"      "OK"

    # 브로드캐스트
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
        Write-InstallLog "Broadcast WM_SETTINGCHANGE (Environment) done." "OK"
    } catch {
        Write-InstallLog "Broadcast WM_SETTINGCHANGE failed: $($_.Exception.Message)" "WARN"
    }

    Write-InstallLog "install_host completed." "OK"
}
catch {
    Write-InstallLog "install_host failed: $($_.Exception.Message)" "ERROR"
    throw
}
