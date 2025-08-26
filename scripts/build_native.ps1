#requires -Version 5.1
param(
    [ValidateSet('arm64','x64')] [string]$Arch = 'arm64',
    [string]$Solution  # 선택: 명시적으로 .sln 경로 지정
)
Import-Module "$PSScriptRoot\helpers.psm1" -Force
Start-InstallLog -Name "build_native"

function Get-RelativePath {
    param([Parameter(Mandatory=$true)][string]$FromDir,
          [Parameter(Mandatory=$true)][string]$ToPath)
    $fromUri = New-Object System.Uri((Resolve-Path -LiteralPath $FromDir).ProviderPath + [IO.Path]::DirectorySeparatorChar)
    $toUri   = New-Object System.Uri((Resolve-Path -LiteralPath $ToPath).ProviderPath)
    $relUri  = $fromUri.MakeRelativeUri($toUri).ToString()
    # Uri는 / 사용 → Windows 백슬래시로
    return $relUri -replace '/', '\'
}

function Fix-VcxprojPaths {
    param(
        [Parameter(Mandatory=$true)][string]$VcxPath,
        [Parameter(Mandatory=$true)][string]$RepoRoot
    )
    if (-not (Test-Path -LiteralPath $VcxPath)) { return }
    $projDir = Split-Path -Parent $VcxPath
    Write-InstallLog "Patching project paths: $VcxPath" "INFO"

    $xml = New-Object System.Xml.XmlDocument
    $xml.PreserveWhitespace = $true
    $xml.Load($VcxPath)
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('msb', $xml.DocumentElement.NamespaceURI)

    $nativeRoot = Join-Path $RepoRoot 'native'

    # --- 1) ClCompile Include 경로 보정 ---
    $changed = $false
    $clNodes = $xml.SelectNodes('//msb:ClCompile', $ns)
    foreach ($n in $clNodes) {
        $inc = $n.GetAttribute('Include')
        if ([string]::IsNullOrWhiteSpace($inc)) { continue }
        $candidate = Join-Path $projDir $inc
        if (Test-Path -LiteralPath $candidate) { continue }

        # 파일명만으로 native 이하에서 탐색
        $leaf = Split-Path -Leaf $inc
        $hit = Get-ChildItem -Path $nativeRoot -Filter $leaf -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit) {
            $rel = Get-RelativePath -FromDir $projDir -ToPath $hit.FullName
            Write-InstallLog "Fix ClCompile: '$inc' -> '$rel'" "OK"
            [void]$n.SetAttribute('Include', $rel)
            $changed = $true
        } else {
            Write-InstallLog "Missing source (not found anywhere): $inc" "WARN"
        }
    }

    # --- 2) AdditionalIncludeDirectories 보정 ---
    $incNodes = $xml.SelectNodes('//msb:ItemDefinitionGroup/msb:ClCompile/msb:AdditionalIncludeDirectories', $ns)
    foreach ($ide in $incNodes) {
        $text = $ide.InnerText
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        $parts = $text -split ';'
        $updated = $false
        for ($i=0; $i -lt $parts.Count; $i++) {
            $p = $parts[$i].Trim()
            if ($p -eq '%(AdditionalIncludeDirectories)' -or $p -eq '') { continue }
            # 절대경로가 아니고, 현재 vcx 기준 존재하지 않으면 보정 시도
            if (-not ([IO.Path]::IsPathRooted($p))) {
                $try1 = Join-Path $projDir $p
                if (-not (Test-Path -LiteralPath $try1)) {
                    # 폴더명만 따와서 native 이하에서 탐색
                    $leaf = Split-Path -Leaf $p
                    $dirHit = Get-ChildItem -Path $nativeRoot -Directory -Recurse -ErrorAction SilentlyContinue |
                              Where-Object { $_.Name -ieq $leaf } |
                              Select-Object -First 1
                    if ($dirHit) {
                        $relDir = Get-RelativePath -FromDir $projDir -ToPath $dirHit.FullName
                        Write-InstallLog "Fix IncludeDir: '$p' -> '$relDir'" "OK"
                        $parts[$i] = $relDir
                        $updated = $true
                    }
                }
            }
        }
        if ($updated) {
            $newText = ($parts -join ';')
            $ide.InnerText = $newText
            $changed = $true
        }
    }

    if ($changed) {
        $xml.Save($VcxPath)
        Write-InstallLog "Project patched: $VcxPath" "OK"
    } else {
        Write-InstallLog "No patch needed: $VcxPath" "INFO"
    }
}

try {
    $repo = Get-RepoRoot
    $platform = if ($Arch -eq 'arm64') { 'ARM64' } else { 'x64' }

    $slnToBuild = $null
    $projList   = @()

    if ($Solution) {
        $slnToBuild = (Resolve-Path -LiteralPath $Solution).ProviderPath
        Write-InstallLog "Using explicit solution: $slnToBuild" "INFO"
    } else {
        $projectsDir = Join-Path $repo 'native\projects'
        $slns = @()
        if (Test-Path -LiteralPath $projectsDir) {
            $slns = Get-ChildItem -Path $projectsDir -Filter *.sln -Recurse -ErrorAction SilentlyContinue
        }
        if ($slns.Count -gt 0) {
            # PaperClip.sln -> PoliteRewrite.sln -> 기타
            $pref = @('PaperClip.sln','PoliteRewrite.sln')
            $pick = $null
            foreach ($name in $pref) {
                $match = $slns | Where-Object { $_.Name -ieq $name } | Select-Object -First 1
                if ($match) { $pick = $match; break }
            }
            if (-not $pick) { $pick = $slns | Select-Object -First 1 }
            $slnToBuild = $pick.FullName
            Write-InstallLog "Auto-detected solution: $slnToBuild" "INFO"
        } else {
            # 솔루션이 없으면 vcxproj 개별 빌드
            $vcx = Get-ChildItem -Path (Join-Path $repo 'native') -Filter *.vcxproj -Recurse -ErrorAction SilentlyContinue
            if ($vcx.Count -eq 0) {
                throw "No solution (.sln) or project (*.vcxproj) files found under: $($repo)\native"
            }
            $order = @('PoliteRewriteHost.vcxproj','PaperClipHost.vcxproj','PoliteRewrite.vcxproj','PaperClipNative.vcxproj')
            foreach ($o in $order) {
                $hit = $vcx | Where-Object { $_.Name -ieq $o }
                foreach ($h in $hit) { $projList += $h.FullName }
            }
            $rest = $vcx | Where-Object { $_.FullName -notin $projList }
            foreach ($r in $rest) { $projList += $r.FullName }

            Write-InstallLog "Building projects (no .sln found):`n - $($projList -join "`n - ")" "INFO"
        }
    }

    # --- 경로 보정: 선택된 솔루션 아래의 모든 .vcxproj 또는 projList ---
    $targets = @()
    if ($slnToBuild) {
        $slnDir = Split-Path -Parent $slnToBuild
        $targets = Get-ChildItem -Path $slnDir -Filter *.vcxproj -Recurse -ErrorAction SilentlyContinue | Select-Object -Expand FullName
    } else {
        $targets = $projList
    }
    foreach ($proj in $targets) { Fix-VcxprojPaths -VcxPath $proj -RepoRoot $repo }

    # --- 빌드 ---
    if ($slnToBuild) {
        Invoke-MSBuild -Solution $slnToBuild -Configuration 'Release' -Platform $platform
    } else {
        foreach ($p in $projList) {
            Invoke-MSBuild -Solution $p -Configuration 'Release' -Platform $platform
        }
    }

    # 산출물 힌트 로그 (install 단계에서도 다시 찾지만, 여기서도 알려줌)
    $defaultOut = Join-Path $repo "native\projects\bin\$Arch\Release"
    $dllExp = @('PoliteRewrite.dll','PaperClipNative.dll')
    $exeExp = @('PoliteRewriteHost.exe','PaperClipHost.exe')

    foreach ($n in $dllExp) {
        $p = Join-Path $defaultOut $n
        if (Test-Path -LiteralPath $p) { Write-InstallLog "DLL artifact: $p" "OK" }
    }
    foreach ($n in $exeExp) {
        $p = Join-Path $defaultOut $n
        if (Test-Path -LiteralPath $p) { Write-InstallLog "EXE artifact: $p" "OK" }
    }

    Write-InstallLog "build_native completed." "OK"
}
catch {
    Write-InstallLog "build_native failed: $($_.Exception.Message)" "ERROR"
    throw
}
