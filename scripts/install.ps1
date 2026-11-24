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
$nodePath = Require-Command 'node'
if (-not $SkipBuild) {
  $null = Require-Command 'pnpm'
}
if (-not $SkipCargo) {
  $null = Require-Command 'cargo'
}

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    Write-Host 'Building OpenFrost TypeScript workspace (pnpm build)...' -ForegroundColor Cyan
    & pnpm build
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm build failed with exit code $LASTEXITCODE."
    }
  }

  $apiEntry = Join-Path $repoRoot 'apps\api\dist\main.js'
  if (-not (Test-Path -LiteralPath $apiEntry -PathType Leaf)) {
    throw "Compiled API entrypoint not found at '$apiEntry'. Run 'pnpm build' first."
  }

  $openfrostHome = if (-not [string]::IsNullOrWhiteSpace($env:OPENFROST_HOME)) {
    $env:OPENFROST_HOME.Trim()
  } else {
    Join-Path $env:USERPROFILE '.openfrost'
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
