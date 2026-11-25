<#
.SYNOPSIS
  Bootstrap OpenFrost on Windows from a single PowerShell command.

.DESCRIPTION
  Designed to be run via:
    irm https://raw.githubusercontent.com/ParasRana1729/openfrost/main/scripts/bootstrap.ps1 | iex

  Automatically ensures all required build/runtime tools are present on Windows
  (Git, Node.js 24-26, pnpm 10.x, Rust/Cargo, and a Windows C/C++ linker such
  as MSVC or WinLibs MinGW-w64) without requiring administrator privileges when
  user-scoped or portable installers are available.

  Clones (or fast-forwards) the OpenFrost repository into
  `%USERPROFILE%\.openfrost\source` (or `$env:OPENFROST_REPO_DIR`), installs
  workspace dependencies with `pnpm install --frozen-lockfile`, and runs
  `scripts\install.ps1` to build the local API, record `runtime.json`, and
  install the `openfrost` CLI/TUI binary.

  Optional environment overrides:
    OPENFROST_HOME      Override data directory (default: %USERPROFILE%\.openfrost)
    OPENFROST_REPO_DIR  Override clone directory (default: <OPENFROST_HOME>\source)
    OPENFROST_BRANCH    Override branch to install (default: main)
#>
& {
  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'
  $prevProgress = $ProgressPreference
  $ProgressPreference = 'SilentlyContinue'
  $prevCorepackPrompt = $env:COREPACK_ENABLE_DOWNLOAD_PROMPT
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

  try {
    [Net.ServicePointManager]::SecurityProtocol = (
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    )

    $isWindowsHost = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
      [bool]$IsWindows
    } else {
      $env:OS -eq 'Windows_NT'
    }
    if (-not $isWindowsHost) {
      throw 'OpenFrost bootstrap currently targets Windows. See README.md for source instructions.'
    }

    $archRaw = if ($env:PROCESSOR_ARCHITEW6432) {
      $env:PROCESSOR_ARCHITEW6432
    } else {
      $env:PROCESSOR_ARCHITECTURE
    }
    $isArm64 = ($archRaw -match 'ARM64')
    $nodeArch = if ($isArm64) { 'arm64' } else { 'x64' }
    $gitArch = if ($isArm64) { 'arm64' } else { '64-bit' }
    $rustArch = if ($isArm64) { 'aarch64' } else { 'x86_64' }

    $defaultHome = Join-Path $env:USERPROFILE '.openfrost'
    $openfrostHome = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_HOME)) {
      $env:OPENFROST_HOME.Trim()
    } else {
      $defaultHome
    }
    $persistUserPath = ($openfrostHome.TrimEnd('\') -ieq $defaultHome.TrimEnd('\'))

    $repoDir = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_REPO_DIR)) {
      $env:OPENFROST_REPO_DIR.Trim()
    } else {
      Join-Path $openfrostHome 'source'
    }

    $branch = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_BRANCH)) {
      $env:OPENFROST_BRANCH.Trim()
    } else {
      'main'
    }

    $toolsDir = Join-Path $openfrostHome 'tools'
    $tempStage = Join-Path ([System.IO.Path]::GetTempPath()) ("openfrost-setup-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $openfrostHome, $toolsDir, $tempStage -Force | Out-Null

    try {
      $sessionAddedPaths = [System.Collections.Generic.List[string]]::new()

      function Add-PathEntry {
        param(
          [Parameter(Mandatory = $true)][string]$Dir,
          [switch]$Prepend,
          [switch]$Persist
        )
        if ([string]::IsNullOrWhiteSpace($Dir) -or -not (Test-Path -LiteralPath $Dir)) {
          return
        }
        $normalized = (Resolve-Path -LiteralPath $Dir).Path.TrimEnd('\')
        if (-not ($sessionAddedPaths -contains $normalized)) {
          $sessionAddedPaths.Add($normalized)
        }
        $currentParts = @($env:PATH -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $filtered = @($currentParts | Where-Object { $_.Trim().TrimEnd('\') -ine $normalized })
        if ($Prepend) {
          $env:PATH = (@($normalized) + $filtered) -join ';'
        } else {
          $env:PATH = ($filtered + @($normalized)) -join ';'
        }

        if ($Persist -and $persistUserPath) {
          $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
          $userParts = @()
          if (-not [string]::IsNullOrWhiteSpace($userPath)) {
            $userParts = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
          }
          $existsInUser = $false
          foreach ($entry in $userParts) {
            if ($entry.Trim().TrimEnd('\') -ieq $normalized) {
              $existsInUser = $true
              break
            }
          }
          if (-not $existsInUser) {
            $newUserPath = ($userParts + @($normalized)) -join ';'
            [Environment]::SetEnvironmentVariable('PATH', $newUserPath, 'User')
          }
        }
      }

      function Sync-SessionPath {
        $machinePath = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
        $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
        $combined = @()
        foreach ($raw in @($sessionAddedPaths.ToArray()) + @($userPath -split ';') + @($machinePath -split ';')) {
          if ([string]::IsNullOrWhiteSpace($raw)) { continue }
          $trimmed = $raw.Trim().TrimEnd('\')
          $already = $false
          foreach ($item in $combined) {
            if ($item -ieq $trimmed) { $already = $true; break }
          }
          if (-not $already) {
            $combined += $trimmed
          }
        }
        $env:PATH = $combined -join ';'
      }

      function Invoke-WingetInstall {
        param(
          [Parameter(Mandatory = $true)][string]$PackageId,
          [switch]$UserScope
        )
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if (-not $wingetCmd) {
          return $false
        }
        $baseArgs = @(
          'install', '--id', $PackageId, '-e', '--source', 'winget', '--silent',
          '--accept-source-agreements', '--accept-package-agreements'
        )
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          if ($UserScope) {
            & $wingetCmd.Source @($baseArgs + @('--scope', 'user'))
            if ($LASTEXITCODE -eq 0) {
              Sync-SessionPath
              return $true
            }
          }
          & $wingetCmd.Source @baseArgs
          if ($LASTEXITCODE -eq 0) {
            Sync-SessionPath
            return $true
          }
          return $false
        } finally {
          $ErrorActionPreference = $prevEap
        }
      }

      function Invoke-DownloadFile {
        param(
          [Parameter(Mandatory = $true)][string]$Uri,
          [Parameter(Mandatory = $true)][string]$OutFile
        )
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
          & $curl.Source -fL --retry 3 --progress-bar -A 'OpenFrost-Bootstrap' -o $OutFile $Uri
          if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile -PathType Leaf)) {
            return
          }
        }
        $wc = [System.Net.WebClient]::new()
        try {
          $wc.Headers['User-Agent'] = 'OpenFrost-Bootstrap'
          $wc.DownloadFile($Uri, $OutFile)
        } finally {
          $wc.Dispose()
        }
      }

      function Expand-ZipFast {
        param(
          [Parameter(Mandatory = $true)][string]$ZipPath,
          [Parameter(Mandatory = $true)][string]$Destination
        )
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        if (Test-Path -LiteralPath $Destination) {
          Remove-Item -LiteralPath $Destination -Recurse -Force
        }
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
      }

      function Get-NodeMajor {
        param([string]$NodeExe)
        if ([string]::IsNullOrWhiteSpace($NodeExe)) { return $null }
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $ver = (& $NodeExe -v 2>$null)
          if ($LASTEXITCODE -ne 0 -or -not $ver) { return $null }
          if ($ver.Trim() -match '^v?(\d+)\.') {
            return [int]$Matches[1]
          }
          return $null
        } finally {
          $ErrorActionPreference = $prevEap
        }
      }

      function Get-CommandPreferCmd {
        param([Parameter(Mandatory = $true)][string]$BaseName)
        $cmdShim = Get-Command "$BaseName.cmd" -ErrorAction SilentlyContinue
        if ($cmdShim) { return $cmdShim }
        return (Get-Command $BaseName -ErrorAction SilentlyContinue)
      }

      function Test-ValidPnpm {
        param([string]$PnpmExe)
        if ([string]::IsNullOrWhiteSpace($PnpmExe)) { return $false }
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $verRaw = if ($PnpmExe -match '\.ps1$') {
            & cmd.exe /d /c pnpm --version 2>$null
          } else {
            & $PnpmExe --version 2>$null
          }
          if ($LASTEXITCODE -ne 0 -or -not $verRaw) { return $false }
          $ver = $null
          if ([version]::TryParse(($verRaw -join '').Trim(), [ref]$ver)) {
            return ($ver -ge [version]'10.34.7' -and $ver -lt [version]'11.0.0')
          }
          return $false
        } finally {
          $ErrorActionPreference = $prevEap
        }
      }

      function Test-MsvcAvailable {
        $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
        $link = Get-Command link.exe -ErrorAction SilentlyContinue
        if ($cl -and $link) { return $true }
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
          $prevEap = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          try {
            $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($installPath -join ''))) {
              return $true
            }
          } finally {
            $ErrorActionPreference = $prevEap
          }
        }
        return $false
      }

      function Test-Valid64BitMinGw {
        param([string]$BinDir)
        if ([string]::IsNullOrWhiteSpace($BinDir)) { return $false }
        $gccExe = Join-Path $BinDir 'gcc.exe'
        $dlltoolExe = Join-Path $BinDir 'dlltool.exe'
        if (-not (Test-Path -LiteralPath $gccExe -PathType Leaf) -or -not (Test-Path -LiteralPath $dlltoolExe -PathType Leaf)) {
          return $false
        }
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $machine = ((& $gccExe -dumpmachine 2>$null) -join '').Trim()
          if ($LASTEXITCODE -ne 0 -or $machine -notmatch '^x86_64-') {
            return $false
          }
          $dllHelp = ((& $dlltoolExe --help 2>$null) -join "`n")
          return ($LASTEXITCODE -eq 0 -and $dllHelp -match 'x86-64')
        } finally {
          $ErrorActionPreference = $prevEap
        }
      }

      function Find-GccBinDir {
        $candidates = [System.Collections.Generic.List[string]]::new()
        $gcc = Get-Command gcc.exe -ErrorAction SilentlyContinue
        if ($gcc) {
          $candidates.Add((Split-Path -Parent $gcc.Source))
        }
        $candidates.Add((Join-Path $toolsDir 'mingw64\bin'))
        $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path -LiteralPath $wingetPackages) {
          $winlibsDirs = Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter 'BrechtSanders.WinLibs*' -ErrorAction SilentlyContinue
          foreach ($dir in $winlibsDirs) {
            $candidates.Add((Join-Path $dir.FullName 'mingw64\bin'))
          }
        }
        $candidates.Add('C:\msys64\ucrt64\bin')
        $candidates.Add('C:\msys64\mingw64\bin')

        foreach ($candidate in $candidates) {
          if (Test-Valid64BitMinGw $candidate) {
            return $candidate
          }
        }
        return $null
      }

      function Get-LatestGitHubReleaseTag {
        param([Parameter(Mandatory = $true)][string]$RepoSlug)
        $uri = "https://github.com/$RepoSlug/releases/latest"
        try {
          $req = [System.Net.HttpWebRequest]::Create($uri)
          $req.AllowAutoRedirect = $false
          $req.UserAgent = 'OpenFrost-Bootstrap'
          $resp = $req.GetResponse()
          try {
            $loc = $resp.Headers['Location']
            if ($loc -and $loc -match '/releases/tag/([^/?#]+)$') {
              return $Matches[1]
            }
          } finally {
            $resp.Close()
          }
        } catch [System.Net.WebException] {
          if ($_.Exception.Response) {
            $loc = $_.Exception.Response.Headers['Location']
            $_.Exception.Response.Close()
            if ($loc -and $loc -match '/releases/tag/([^/?#]+)$') {
              return $Matches[1]
            }
          }
        }
        return $null
      }

      # 1. Ensure Git
      if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        foreach ($gitCandidate in @(
          (Join-Path $env:ProgramFiles 'Git\cmd'),
          (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd'),
          (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd'),
          (Join-Path $toolsDir 'git\cmd')
        )) {
          if (Test-Path -LiteralPath (Join-Path $gitCandidate 'git.exe') -PathType Leaf) {
            Add-PathEntry -Dir $gitCandidate -Persist
            break
          }
        }
      }
      if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host 'Git not found. Installing Git for Windows...' -ForegroundColor Cyan
        $null = Invoke-WingetInstall -PackageId 'Git.Git' -UserScope
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
          foreach ($gitCandidate in @(
            (Join-Path $env:ProgramFiles 'Git\cmd'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd')
          )) {
            if (Test-Path -LiteralPath (Join-Path $gitCandidate 'git.exe') -PathType Leaf) {
              Add-PathEntry -Dir $gitCandidate -Persist
              break
            }
          }
        }
      }
      if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host 'Downloading portable MinGit...' -ForegroundColor Cyan
        $gitTag = Get-LatestGitHubReleaseTag -RepoSlug 'git-for-windows/git'
        if (-not $gitTag) { $gitTag = 'v2.56.1.windows.1' }
        $assetsHtml = (Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/expanded_assets/$gitTag" -UseBasicParsing).Content
        $match = [regex]::Match($assetsHtml, "MinGit-[0-9.]+-$gitArch\.zip")
        if (-not $match.Success) {
          $match = [regex]::Match($assetsHtml, "MinGit-[^""'<>]+-$gitArch\.zip")
        }
        if (-not $match.Success) {
          throw "Could not locate portable MinGit archive ($gitArch) for release $gitTag."
        }
        $zipName = $match.Value
        $zipPath = Join-Path $tempStage $zipName
        Invoke-DownloadFile -Uri "https://github.com/git-for-windows/git/releases/download/$gitTag/$zipName" -OutFile $zipPath
        $gitTarget = Join-Path $toolsDir 'git'
        $gitStage = Join-Path $tempStage 'git-extract'
        Expand-ZipFast -ZipPath $zipPath -Destination $gitStage
        if (Test-Path -LiteralPath $gitTarget) {
          Remove-Item -LiteralPath $gitTarget -Recurse -Force
        }
        Move-Item -LiteralPath $gitStage -Destination $gitTarget
        Add-PathEntry -Dir (Join-Path $gitTarget 'cmd') -Persist
      }
      if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Failed to install or locate Git. Install Git for Windows and re-run.'
      }

      # 2. Ensure Node.js 24-26
      $hadAnyGlobalNode = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
      $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
      $nodeMajor = if ($nodeCmd) { Get-NodeMajor $nodeCmd.Source } else { $null }
      if ($null -eq $nodeMajor -or $nodeMajor -lt 24 -or $nodeMajor -ge 27) {
        $toolsNodeDir = Join-Path $toolsDir 'node'
        $toolsNodeExe = Join-Path $toolsNodeDir 'node.exe'
        $toolsMajor = if (Test-Path -LiteralPath $toolsNodeExe -PathType Leaf) { Get-NodeMajor $toolsNodeExe } else { $null }
        if ($null -eq $toolsMajor -or $toolsMajor -lt 24 -or $toolsMajor -ge 27) {
          Write-Host "Installing portable Node.js 24 ($nodeArch) into $toolsNodeDir..." -ForegroundColor Cyan
          $shasums = Invoke-RestMethod -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt'
          $line = ($shasums -split "`n") | Where-Object { $_ -match "([0-9a-fA-F]{64})\s+(node-v24\.[^/\s]+-win-$nodeArch\.zip)$" } | Select-Object -First 1
          if (-not $line -or -not ($line -match '([0-9a-fA-F]{64})\s+(node-v24\.[^/\s]+-win-[^\s]+\.zip)$')) {
            throw "Could not resolve Node.js 24 Windows ($nodeArch) archive from nodejs.org."
          }
          $expectedHash = $Matches[1].ToLowerInvariant()
          $zipName = $Matches[2]
          $zipPath = Join-Path $tempStage $zipName
          Invoke-DownloadFile -Uri "https://nodejs.org/dist/latest-v24.x/$zipName" -OutFile $zipPath
          $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
          if ($actualHash -ne $expectedHash) {
            throw "SHA-256 verification failed for $zipName (expected $expectedHash, got $actualHash)."
          }
          $nodeStage = Join-Path $tempStage 'node-extract'
          Expand-ZipFast -ZipPath $zipPath -Destination $nodeStage
          $extractedRoot = Get-ChildItem -LiteralPath $nodeStage -Directory | Select-Object -First 1
          if (-not $extractedRoot) {
            throw "Unexpected archive layout in $zipName."
          }
          if (Test-Path -LiteralPath $toolsNodeDir) {
            Remove-Item -LiteralPath $toolsNodeDir -Recurse -Force
          }
          Move-Item -LiteralPath $extractedRoot.FullName -Destination $toolsNodeDir
        }
        if ($hadAnyGlobalNode) {
          # Keep the user's existing global Node default untouched; prepend Node 24 for this session.
          Add-PathEntry -Dir $toolsNodeDir -Prepend
        } else {
          Add-PathEntry -Dir $toolsNodeDir -Prepend -Persist
        }
      }
      $activeNode = Get-Command node -ErrorAction SilentlyContinue
      $activeNodeMajor = if ($activeNode) { Get-NodeMajor $activeNode.Source } else { $null }
      if ($null -eq $activeNodeMajor -or $activeNodeMajor -lt 24 -or $activeNodeMajor -ge 27) {
        throw 'OpenFrost requires Node.js 24-26, and automatic Node.js 24 setup failed.'
      }

      # 3. Ensure pnpm 10.34.7+ (<11)
      $toolsPnpmDir = Join-Path $toolsDir 'pnpm'
      $toolsPnpmCmd = Join-Path $toolsPnpmDir 'pnpm.cmd'
      $pnpmCmd = Get-CommandPreferCmd 'pnpm'
      $pnpmValid = if ($pnpmCmd) { Test-ValidPnpm $pnpmCmd.Source } else { $false }
      if (-not $pnpmValid) {
        if ((Test-Path -LiteralPath $toolsPnpmCmd -PathType Leaf) -and (Test-ValidPnpm $toolsPnpmCmd)) {
          Add-PathEntry -Dir $toolsPnpmDir -Prepend -Persist
        } else {
          Write-Host 'Installing pnpm 10.34.7...' -ForegroundColor Cyan
          $nodeDir = Split-Path -Parent $activeNode.Source
          $npmCmd = Join-Path $nodeDir 'npm.cmd'
          if (-not (Test-Path -LiteralPath $npmCmd -PathType Leaf)) {
            $npmFound = Get-CommandPreferCmd 'npm'
            if (-not $npmFound) {
              throw 'npm was not found alongside Node.js.'
            }
            $npmCmd = $npmFound.Source
          }
          New-Item -ItemType Directory -Path $toolsPnpmDir -Force | Out-Null
          & $npmCmd install --global --prefix $toolsPnpmDir pnpm@10.34.7 --no-audit --no-fund --loglevel=error
          if ($LASTEXITCODE -ne 0) {
            throw "Failed to install pnpm@10.34.7 via npm (exit code $LASTEXITCODE)."
          }
          Add-PathEntry -Dir $toolsPnpmDir -Prepend -Persist
        }
      }
      $activePnpm = Get-CommandPreferCmd 'pnpm'
      if (-not $activePnpm -or -not (Test-ValidPnpm $activePnpm.Source)) {
        throw 'Failed to provision pnpm 10.34.7+ (<11).'
      }

      # 4. Ensure C/C++ linker (MSVC or 64-bit WinLibs MinGW-w64) and Rust/Cargo
      $hasMsvc = Test-MsvcAvailable
      $gccBin = Find-GccBinDir
      if ($gccBin) {
        # Prepend so 64-bit MinGW-w64 precedes any legacy 32-bit C:\MinGW\bin on PATH.
        Add-PathEntry -Dir $gccBin -Prepend -Persist
      }

      if (-not $isArm64 -and -not $hasMsvc -and -not $gccBin) {
        Write-Host 'No C/C++ linker detected. Installing WinLibs MinGW-w64 (user-scoped)...' -ForegroundColor Cyan
        $null = Invoke-WingetInstall -PackageId 'BrechtSanders.WinLibs.POSIX.UCRT'
        $gccBin = Find-GccBinDir
        if (-not $gccBin) {
          Write-Host 'Downloading portable WinLibs MinGW-w64...' -ForegroundColor Cyan
          $winlibsTag = Get-LatestGitHubReleaseTag -RepoSlug 'brechtsanders/winlibs_mingw'
          if (-not $winlibsTag) { $winlibsTag = '16.2.0posix-23.1.3-14.0.0-ucrt-r3' }
          $assetsHtml = (Invoke-WebRequest -Uri "https://github.com/brechtsanders/winlibs_mingw/releases/expanded_assets/$winlibsTag" -UseBasicParsing).Content
          # Prefer the lean gcc+mingw-w64ucrt zip (without llvm), falling back to any x86_64 posix seh ucrt zip.
          $match = [regex]::Match($assetsHtml, 'winlibs-x86_64-posix-seh-gcc-[0-9.]+-mingw-w64ucrt-[^"''<>]+\.zip')
          if (-not $match.Success) {
            $match = [regex]::Match($assetsHtml, 'winlibs-x86_64-posix-seh-gcc-[^"''<>]*ucrt[^"''<>]*\.zip')
          }
          if (-not $match.Success) {
            throw "Could not locate portable WinLibs archive for release $winlibsTag."
          }
          $zipName = $match.Value
          $zipPath = Join-Path $tempStage $zipName
          Invoke-DownloadFile -Uri "https://github.com/brechtsanders/winlibs_mingw/releases/download/$winlibsTag/$zipName" -OutFile $zipPath
          $winlibsStage = Join-Path $tempStage 'winlibs-extract'
          Expand-ZipFast -ZipPath $zipPath -Destination $winlibsStage
          $mingwRoot = Join-Path $winlibsStage 'mingw64'
          if (-not (Test-Path -LiteralPath $mingwRoot)) {
            $firstDir = Get-ChildItem -LiteralPath $winlibsStage -Directory | Select-Object -First 1
            if ($firstDir) { $mingwRoot = $firstDir.FullName }
          }
          $mingwTarget = Join-Path $toolsDir 'mingw64'
          if (Test-Path -LiteralPath $mingwTarget) {
            Remove-Item -LiteralPath $mingwTarget -Recurse -Force
          }
          Move-Item -LiteralPath $mingwRoot -Destination $mingwTarget
          $gccBin = Join-Path $mingwTarget 'bin'
        }
        if ($gccBin) {
          Add-PathEntry -Dir $gccBin -Prepend -Persist
        }
      } elseif ($isArm64 -and -not $hasMsvc) {
        Write-Host 'No MSVC Build Tools detected on ARM64. Installing Visual Studio C++ Build Tools...' -ForegroundColor Cyan
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
          $prevEap = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          try {
            & $wingetCmd.Source install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
          } finally {
            $ErrorActionPreference = $prevEap
          }
          Sync-SessionPath
          $hasMsvc = Test-MsvcAvailable
        }
        if (-not $hasMsvc) {
          throw 'OpenFrost on Windows ARM64 requires Visual Studio C++ Build Tools (VCTools). Install it and re-run.'
        }
      }

      $cargoHome = if (-not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
        $env:CARGO_HOME.Trim()
      } else {
        Join-Path $env:USERPROFILE '.cargo'
      }
      $cargoBin = Join-Path $cargoHome 'bin'
      if (Test-Path -LiteralPath (Join-Path $cargoBin 'cargo.exe') -PathType Leaf) {
        Add-PathEntry -Dir $cargoBin -Persist
      }

      if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -or -not (Get-Command rustc -ErrorAction SilentlyContinue)) {
        Write-Host 'Rust/Cargo not found. Installing Rust toolchain via rustup...' -ForegroundColor Cyan
        $rustHostTriple = if ($hasMsvc) {
          "$rustArch-pc-windows-msvc"
        } elseif (-not $isArm64 -and $gccBin) {
          'x86_64-pc-windows-gnu'
        } else {
          "$rustArch-pc-windows-msvc"
        }
        $rustupInit = Join-Path $tempStage 'rustup-init.exe'
        Invoke-DownloadFile -Uri "https://win.rustup.rs/$rustArch" -OutFile $rustupInit
        & $rustupInit -y --default-host $rustHostTriple --default-toolchain stable
        if ($LASTEXITCODE -ne 0) {
          throw "rustup-init.exe failed with exit code $LASTEXITCODE."
        }
        Add-PathEntry -Dir $cargoBin -Persist
      }

      # If Rust is installed with an MSVC default toolchain but no MSVC linker exists on x64,
      # switch/use the GNU toolchain paired with WinLibs so linking succeeds cleanly.
      if (-not $isArm64 -and -not $hasMsvc -and $gccBin -and (Get-Command rustup -ErrorAction SilentlyContinue)) {
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $activeToolchain = ''
        try {
          $activeToolchain = ((& rustup show active-toolchain 2>$null) -join "`n")
        } finally {
          $ErrorActionPreference = $prevEap
        }
        if ($activeToolchain -match 'windows-msvc') {
          Write-Host 'MSVC linker not found; ensuring stable-x86_64-pc-windows-gnu Rust toolchain...' -ForegroundColor Cyan
          & rustup toolchain install stable-x86_64-pc-windows-gnu
          if ($LASTEXITCODE -ne 0) {
            throw "Failed to install stable-x86_64-pc-windows-gnu toolchain."
          }
          $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
        }
      }

      if (-not (Get-Command cargo -ErrorAction SilentlyContinue) -or -not (Get-Command rustc -ErrorAction SilentlyContinue)) {
        throw 'Failed to install or locate Rust/Cargo.'
      }

      # 5. Clone or update OpenFrost source checkout
      $repoUrl = 'https://github.com/ParasRana1729/openfrost.git'
      if (Test-Path -LiteralPath $repoDir) {
        $gitDir = Join-Path $repoDir '.git'
        if (-not (Test-Path -LiteralPath $gitDir)) {
          $existingItems = @(Get-ChildItem -LiteralPath $repoDir -Force -ErrorAction SilentlyContinue)
          if ($existingItems.Count -gt 0) {
            throw "Target directory '$repoDir' already exists and is not an OpenFrost git checkout. Set OPENFROST_REPO_DIR or clear it first."
          }
          Write-Host "Cloning OpenFrost ($branch) into $repoDir..." -ForegroundColor Cyan
          & git clone --branch $branch $repoUrl $repoDir
          if ($LASTEXITCODE -ne 0) {
            throw "git clone failed with exit code $LASTEXITCODE."
          }
        } else {
          Write-Host "Updating existing OpenFrost checkout at $repoDir..." -ForegroundColor Cyan
          $dirty = & git -C $repoDir status --porcelain --untracked-files=no
          if ($LASTEXITCODE -ne 0) {
            throw "Failed to inspect git status in '$repoDir'."
          }
          if (-not [string]::IsNullOrWhiteSpace(($dirty -join "`n"))) {
            throw "Checkout '$repoDir' has uncommitted tracked changes. Commit or stash them before re-running bootstrap."
          }
          & git -C $repoDir fetch origin $branch
          if ($LASTEXITCODE -ne 0) {
            throw "git fetch failed with exit code $LASTEXITCODE."
          }
          & git -C $repoDir checkout $branch
          if ($LASTEXITCODE -ne 0) {
            throw "git checkout $branch failed with exit code $LASTEXITCODE."
          }
          & git -C $repoDir pull --ff-only origin $branch
          if ($LASTEXITCODE -ne 0) {
            throw "git pull --ff-only failed with exit code $LASTEXITCODE."
          }
        }
      } else {
        Write-Host "Cloning OpenFrost ($branch) into $repoDir..." -ForegroundColor Cyan
        & git clone --branch $branch $repoUrl $repoDir
        if ($LASTEXITCODE -ne 0) {
          throw "git clone failed with exit code $LASTEXITCODE."
        }
      }

      $installScript = Join-Path $repoDir 'scripts\install.ps1'
      if (-not (Test-Path -LiteralPath $installScript -PathType Leaf)) {
        throw "Expected installer script not found at '$installScript'."
      }

      Push-Location $repoDir
      try {
        Write-Host 'Installing workspace dependencies (pnpm install --frozen-lockfile)...' -ForegroundColor Cyan
        & $activePnpm.Source install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
          throw "pnpm install failed with exit code $LASTEXITCODE."
        }

        $psExe = (Get-Process -Id $PID).Path
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $installScript
        if ($LASTEXITCODE -ne 0) {
          throw "scripts\install.ps1 failed with exit code $LASTEXITCODE."
        }
      } finally {
        Pop-Location
      }

      Write-Host ''
      Write-Host 'OpenFrost is ready.' -ForegroundColor Green
      Write-Host 'Run `openfrost` to start the local API and launch the Control Center TUI.'
      Write-Host 'Run `openfrost update` anytime to pull, rebuild, and update your install.'
      Write-Host '(If `openfrost` is not recognized in this window, open a new terminal so User PATH reloads.)'
    } finally {
      Remove-Item -LiteralPath $tempStage -Recurse -Force -ErrorAction SilentlyContinue
    }
  } finally {
    $ProgressPreference = $prevProgress
    if ($null -eq $prevCorepackPrompt) {
      Remove-Item Env:COREPACK_ENABLE_DOWNLOAD_PROMPT -ErrorAction SilentlyContinue
    } else {
      $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = $prevCorepackPrompt
    }
  }
}
