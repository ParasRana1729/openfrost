<#
.SYNOPSIS
  Build the OpenFrost local API and install the `openfrost` CLI/TUI binary.

.DESCRIPTION
  Compiles the TypeScript workspace (`pnpm build`), writes the resolved local
  runtime paths into `%USERPROFILE%\.openfrost\runtime.json` (or
  `$env:OPENFROST_HOME\runtime.json`), and installs the `openfrost` binary via
  `cargo install --path apps/tui --force`.

.PARAMETER SkipBuild
  Skip running `pnpm build` if `apps/api/dist/main.js` is already up to date.

.PARAMETER SkipCargo
  Skip running `cargo install` (only rebuild API and refresh `runtime.json`).
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipCargo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command '$Name' was not found on PATH."
  }
  return $cmd.Source
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$openfrostHome = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_HOME)) {
  $env:OPENFROST_HOME.Trim()
} else {
  Join-Path $env:USERPROFILE '.openfrost'
}

# Prefer OpenFrost's portable tools if present and the active PATH lacks a compatible version.
$toolsNode = Join-Path $openfrostHome 'tools\node'
if (Test-Path -LiteralPath (Join-Path $toolsNode 'node.exe') -PathType Leaf) {
  $currentNode = Get-Command 'node' -ErrorAction SilentlyContinue
  $needPortableNode = $true
  if ($currentNode) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $verOut = (& $currentNode.Source -v 2>$null)
      if ($LASTEXITCODE -eq 0 -and $verOut -and ($verOut.Trim() -match '^v?(\d+)\.')) {
        $maj = [int]$Matches[1]
        if ($maj -ge 24 -and $maj -lt 27) {
          $needPortableNode = $false
        }
      }
    } finally {
      $ErrorActionPreference = $prevEap
    }
  }
  if ($needPortableNode) {
    $env:PATH = "$toolsNode;$env:PATH"
  }
}
foreach ($toolSub in @('tools\pnpm', 'tools\git\cmd')) {
  $toolDir = Join-Path $openfrostHome $toolSub
  if (Test-Path -LiteralPath $toolDir) {
    $env:PATH = "$env:PATH;$toolDir"
  }
}

# Prepend 64-bit MinGW-w64 if present and active gcc/dlltool is missing or not x86_64
# (for example, when legacy 32-bit C:\MinGW\bin is earlier on Machine PATH).
$activeGcc = Get-Command 'gcc.exe' -ErrorAction SilentlyContinue
$has64BitGcc = $false
if ($activeGcc) {
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $machine = ((& $activeGcc.Source -dumpmachine 2>$null) -join '').Trim()
    $has64BitGcc = ($LASTEXITCODE -eq 0 -and $machine -match '^x86_64-')
  } finally {
    $ErrorActionPreference = $prevEap
  }
}
if (-not $has64BitGcc) {
  $mingwCandidates = [System.Collections.Generic.List[string]]::new()
  $mingwCandidates.Add((Join-Path $openfrostHome 'tools\mingw64\bin'))
  $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path -LiteralPath $wingetPackages) {
    $winlibsDirs = Get-ChildItem -LiteralPath $wingetPackages -Directory -Filter 'BrechtSanders.WinLibs*' -ErrorAction SilentlyContinue
    foreach ($dir in $winlibsDirs) {
      $mingwCandidates.Add((Join-Path $dir.FullName 'mingw64\bin'))
    }
  }
  foreach ($cand in $mingwCandidates) {
    $candGcc = Join-Path $cand 'gcc.exe'
    $candDlltool = Join-Path $cand 'dlltool.exe'
    if ((Test-Path -LiteralPath $candGcc -PathType Leaf) -and (Test-Path -LiteralPath $candDlltool -PathType Leaf)) {
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        $candMachine = ((& $candGcc -dumpmachine 2>$null) -join '').Trim()
        if ($LASTEXITCODE -eq 0 -and $candMachine -match '^x86_64-') {
          $env:PATH = "$cand;$env:PATH"
          break
        }
      } finally {
        $ErrorActionPreference = $prevEap
      }
    }
  }
}

$nodePath = Require-Command 'node'
$pnpmBin = $null
if (-not $SkipBuild) {
  $pnpmCmdShim = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue
  $pnpmBin = if ($pnpmCmdShim) { $pnpmCmdShim.Source } else { Require-Command 'pnpm' }
}
if (-not $SkipCargo) {
  $null = Require-Command 'cargo'
  $hasMsvc = ($null -ne (Get-Command 'cl.exe' -ErrorAction SilentlyContinue)) -and ($null -ne (Get-Command 'link.exe' -ErrorAction SilentlyContinue))
  if (-not $hasMsvc) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
      $prevEap = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        $hasMsvc = ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($vsPath -join '')))
      } finally {
        $ErrorActionPreference = $prevEap
      }
    }
  }
  if (-not $hasMsvc -and -not $env:RUSTUP_TOOLCHAIN -and (Get-Command 'rustup' -ErrorAction SilentlyContinue)) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $active = ((& rustup show active-toolchain 2>$null) -join "`n")
      if ($active -match 'windows-msvc') {
        $installed = ((& rustup toolchain list 2>$null) -join "`n")
        if ($installed -match 'stable-x86_64-pc-windows-gnu') {
          $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
        }
      }
    } finally {
      $ErrorActionPreference = $prevEap
    }
  }
}

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    Write-Host 'Building OpenFrost TypeScript workspace (pnpm build)...' -ForegroundColor Cyan
    & $pnpmBin build
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm build failed with exit code $LASTEXITCODE."
    }
  }

  $apiEntry = Join-Path $repoRoot 'apps\api\dist\main.js'
  if (-not (Test-Path -LiteralPath $apiEntry -PathType Leaf)) {
    throw "Compiled API entrypoint not found at '$apiEntry'. Run 'pnpm build' first."
  }

  if (-not (Test-Path -LiteralPath $openfrostHome)) {
    New-Item -ItemType Directory -Path $openfrostHome -Force | Out-Null
  }

  $runtimeConfigPath = Join-Path $openfrostHome 'runtime.json'
  $runtimeConfig = [ordered]@{
    apiEntry = $apiEntry
    nodePath = $nodePath
    repoRoot = $repoRoot
  }
  $json = ($runtimeConfig | ConvertTo-Json -Depth 4) + "`n"
  # Write UTF-8 without BOM so both Windows PowerShell 5.1 and PowerShell 7+
  # produce standard JSON.
  [System.IO.File]::WriteAllText(
    $runtimeConfigPath,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host "Wrote runtime config: $runtimeConfigPath" -ForegroundColor Green

  if (-not $SkipCargo) {
    $tuiPath = Join-Path $repoRoot 'apps\tui'
    Write-Host 'Installing `openfrost` binary via cargo install...' -ForegroundColor Cyan
    & cargo install --path $tuiPath --force
    if ($LASTEXITCODE -ne 0) {
      throw "cargo install failed with exit code $LASTEXITCODE."
    }
  }

  $cargoHome = if (-not [string]::IsNullOrWhiteSpace($env:CARGO_HOME)) {
    $env:CARGO_HOME.Trim()
  } else {
    Join-Path $env:USERPROFILE '.cargo'
  }
  $cargoBin = Join-Path $cargoHome 'bin'
  $pathEntries = ($env:PATH -split ';') | ForEach-Object { $_.Trim().TrimEnd('\') }
  if ($pathEntries -notcontains $cargoBin.TrimEnd('\')) {
    Write-Warning "Cargo bin directory '$cargoBin' is not currently on PATH. Add it to run `openfrost` from any terminal."
  }

  Write-Host ''
  Write-Host 'OpenFrost CLI installed.' -ForegroundColor Green
  Write-Host 'Run `openfrost` from any terminal to start the local API and open the TUI.'
  Write-Host 'Other commands: `openfrost status`, `openfrost stop`, `openfrost logs`, `openfrost --help`.'
} finally {
  Pop-Location
}
