<#
.SYNOPSIS
  Bootstrap OpenFrost on Windows from a single PowerShell command.

.DESCRIPTION
  Designed to be run via:
    irm https://raw.githubusercontent.com/ParasRana1729/openfrost/main/scripts/bootstrap.ps1 | iex

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

  $isWindowsHost = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) {
    [bool]$IsWindows
  } else {
    $env:OS -eq 'Windows_NT'
  }
  if (-not $isWindowsHost) {
    throw 'OpenFrost bootstrap currently targets Windows. See README.md for source instructions.'
  }

  function Test-RequiredCommand {
    param(
      [Parameter(Mandatory = $true)][string]$Name,
      [Parameter(Mandatory = $true)][string]$InstallHint
    )
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
      return "  - $Name : $InstallHint"
    }
    return $null
  }

  $missing = @()
  $missing += Test-RequiredCommand 'git' 'Install Git for Windows (winget install Git.Git)'
  $missing += Test-RequiredCommand 'node' 'Install Node.js 24+ (winget install OpenJS.NodeJS)'
  $missing += Test-RequiredCommand 'pnpm' 'Install pnpm 10.34.7 (npm install --global pnpm@10.34.7)'
  $missing += Test-RequiredCommand 'cargo' 'Install Rust stable (winget install Rustlang.Rustup)'
  $missing = @($missing | Where-Object { $_ })

  if ($missing.Count -gt 0) {
    $list = $missing -join "`n"
    throw "Missing required prerequisites:`n$list`nInstall the missing tools, open a new terminal so PATH refreshes, and re-run."
  }

  $nodeVersionRaw = (& node -v).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to query Node.js version (`node -v`).'
  }
  $nodeMajor = 0
  if ($nodeVersionRaw -match '^v?(\d+)\.') {
    $nodeMajor = [int]$Matches[1]
  }
  if ($nodeMajor -lt 24 -or $nodeMajor -ge 27) {
    throw "OpenFrost requires Node.js 24-26 (found $nodeVersionRaw)."
  }

  $openfrostHome = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_HOME)) {
    $env:OPENFROST_HOME.Trim()
  } else {
    Join-Path $env:USERPROFILE '.openfrost'
  }

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

  $repoUrl = 'https://github.com/ParasRana1729/openfrost.git'

  if (-not (Test-Path -LiteralPath $openfrostHome)) {
    New-Item -ItemType Directory -Path $openfrostHome -Force | Out-Null
  }

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
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm install failed with exit code $LASTEXITCODE."
    }

    & $installScript
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
}
