<#
.SYNOPSIS
  Creates GitHub issues from backlog/*.md for the OpenFrost project.
.DESCRIPTION
  Reads front-matter (num, title, owner, area, labels, iteration, depends_on)
  from each numbered markdown file and creates issues via the GitHub CLI (gh).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/import-issues.ps1 -Repo ParasRana1729/openfrost -Iteration "Iteration 0" -DryRun
  powershell -ExecutionPolicy Bypass -File scripts/import-issues.ps1 -Repo ParasRana1729/openfrost -Iteration "Iteration 0"
  powershell -ExecutionPolicy Bypass -File scripts/import-issues.ps1 -Repo ParasRana1729/openfrost -All
#>
param(
  [Parameter(Mandatory = $false)][string]$Repo = "ParasRana1729/openfrost",
  [string]$Iteration = "Iteration 0",
  [switch]$DryRun,
  [switch]$All
)

$ErrorActionPreference = 'Stop'

$backlogDir = Join-Path $PSScriptRoot '..\backlog'
$teamFile = Join-Path $PSScriptRoot 'team.json'
$team = Get-Content -Path $teamFile -Raw -Encoding utf8 | ConvertFrom-Json

function Parse-FrontMatter {
  param([string]$Content)
  if ($Content -notmatch '(?ms)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$') { throw 'No front-matter found' }
  $meta = $Matches[1]
  $body = $Matches[2]
  $result = @{}
  foreach ($line in ($meta -split "`r?`n")) {
    if ($line -match '^([a-zA-Z_]+):\s*(.*)$') {
      $key = $Matches[1].Trim()
      $val = $Matches[2].Trim()
      if ($val -match '^\[(.*)\]$') {
        $items = $Matches[1] -split ',\s*' | ForEach-Object { $_.Trim().Trim('"').Trim("'") }
        $val = @($items)
      } else {
        $val = $val.Trim('"').Trim("'")
      }
      $result[$key] = $val
    }
  }
  return @{ meta = $result; body = $body.Trim() }
}

function Resolve-Assignee {
  param([string]$Owner)
  if ($team.$Owner) { return $team.$Owner }
  return $null
}

$labelsToCreate = @('P0','P1','area:product','area:platform','area:agent','area:ui','area:security','type:feature','type:bug','type:task','type:adr')
$milestonesToCreate = @('Iteration 0','Iteration 1','Iteration 2','Iteration 3')

if (-not $DryRun) {
  Write-Host "Creating labels and milestones on $Repo..." -ForegroundColor Cyan
  foreach ($label in $labelsToCreate) {
    gh label create $label --repo $Repo --force 2>$null | Out-Null
  }
  foreach ($m in $milestonesToCreate) {
    gh api --method POST "repos/$Repo/milestones" --field title="$m" 2>$null | Out-Null
  }
}

$files = Get-ChildItem -Path $backlogDir -Filter '*.md' | Where-Object { $_.Name -match '^\d{3}-' } | Sort-Object Name
$created = 0
$skipped = 0

Write-Host "Processing backlog issues for $Repo (Filter: $(if ($All) { 'All' } elseif ($Iteration) { $Iteration } else { 'Ready (no unfulfilled dependencies)' }))...`n" -ForegroundColor Yellow

foreach ($file in $files) {
  $raw = Get-Content -Path $file.FullName -Raw -Encoding utf8
  $parsed = Parse-FrontMatter $raw
  $m = $parsed.meta
  $num = $m.num
  $title = $m.title
  $labels = @($m.labels)
  $assignee = Resolve-Assignee $m.owner
  $issueIteration = $m.iteration
  $depends = @($m.depends_on)

  # Filtering logic:
  if (-not $All) {
    if ($Iteration -and ($issueIteration -ne $Iteration)) {
      $skipped++
      continue
    }
    if (-not $Iteration -and $depends.Count -gt 0) {
      $skipped++
      continue
    }
  }

  $body = $parsed.body
  $body += "`n`n---`n`n**Owner:** $($m.owner) (@$assignee) | **Area:** $($m.area) | **Iteration:** $issueIteration | **Depends on:** $(if ($depends.Count -gt 0) { $depends -join ', ' } else { 'None' })"

  if ($DryRun) {
    Write-Host ("[DRY-RUN] #{0} | {1} | Assignee: @{2} | Iteration: {3}" -f $num, $title, $assignee, $issueIteration) -ForegroundColor Green
    $created++
    continue
  }

  $cmd = @('issue', 'create', '--repo', $Repo, '--title', $title, '--body', $body)
  foreach ($l in $labels) {
    $cmd += @('--label', $l)
  }
  if ($assignee -and $assignee -notmatch 'REPLACE') {
    $cmd += @('--assignee', $assignee)
  }
  if ($issueIteration) {
    $cmd += @('--milestone', $issueIteration)
  }

  try {
    $url = & gh @cmd 2>&1
    if ($LASTEXITCODE -eq 0) {
      $created++
      Write-Host ("[CREATED] #{0} -> {1} (Assigned to @{2})" -f $num, $url, $assignee) -ForegroundColor Green
      Start-Sleep -Milliseconds 400
    } else {
      Write-Host ("[ERROR] #{0} | {1} | {2}" -f $num, $title, $url) -ForegroundColor Red
    }
  } catch {
    Write-Host ("[EXCEPTION] #{0} | {1} | {2}" -f $num, $title, $_.Exception.Message) -ForegroundColor Red
  }
}

Write-Host "`nSummary: $created issue(s) processed, $skipped skipped." -ForegroundColor Cyan