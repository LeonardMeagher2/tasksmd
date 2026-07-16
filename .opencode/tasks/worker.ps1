# OpenCode tasks worker — PowerShell
# Scheduled by Task Scheduler. Reads TASKS.md, picks up [ ] tasks.

$PROJECT_ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$TASKS_FILE = Join-Path $PROJECT_ROOT "TASKS.md"
$TASKS_DIR = Join-Path $PROJECT_ROOT ".tasks"
$STATE_DIR = Join-Path $TASKS_DIR ".state"

New-Item -ItemType Directory -Force -Path $STATE_DIR | Out-Null

# ── Helpers ────────────────────────────────────────────

function Slugify($text) {
  $text.ToLower() -replace '[^a-z0-9]', '-' -replace '^-+|-+$', '' -replace '^(.{60}).*', '$1'
}

function Extract-LinkText($line) {
  if ($line -match '\[([^\]]+)\]\([^)]+\)') { return $matches[1] }
  return ""
}

function Extract-LinkPath($line) {
  if ($line -match '\[[^\]]+\]\(([^)]+)\)') { return $matches[1] }
  return ""
}

function Is-ProcessAlive($targetPid) {
  try { $null = Get-Process -Id $targetPid -ErrorAction Stop; return $true }
  catch { return $false }
}

# ── Read file ──────────────────────────────────────────

if (-not (Test-Path $TASKS_FILE)) {
  Write-Host "No TASKS.md found."
  exit 0
}

$fileContent = Get-Content $TASKS_FILE -Raw
$parts = $fileContent -split '(?m)^---\r?\n'
$frontmatter = ""
$body = $fileContent

if ($parts.Count -ge 3) {
  $frontmatter = $parts[1]
  $body = $parts[2]
}

$DEFAULT_MODEL = ""
$MAX_ACTIVE = 1
if ($frontmatter -match '(?m)^model:\s*(.+)$') { $DEFAULT_MODEL = $matches[1].Trim() }
if ($frontmatter -match '(?m)^max_active:\s*(.+)$') { $MAX_ACTIVE = [int]$matches[1] }

# ── Parse body lines ───────────────────────────────────

$bodyLines = $body -split "`n"
$bodyLines = $bodyLines | Where-Object { $_ -ne $null }
$TASK_IDX = -1
$TASK_RAW = ""
$IS_RETRY = $false

# Priority 1: stale [~] whose worker process is dead
for ($i = 0; $i -lt $bodyLines.Count; $i++) {
  $line = $bodyLines[$i]
  $state = ""
  if ($line -match '^- \[~\]') { $state = "active" }
  elseif ($line -match '^- \[ \]') { $state = "pending" }
  elseif ($line -match '^- \[x\]') { $state = "done" }
  if (-not $state) { continue }

  $taskRaw = $line -replace '^- \[[ ~x]\] ', ''

  if ($state -eq "active") {
    $slug = Slugify (Extract-LinkText $taskRaw)
    if (-not $slug) { $slug = Slugify $taskRaw }
    $stateFile = Join-Path $STATE_DIR "$slug.md"
    if (Test-Path $stateFile) {
      $stateContent = Get-Content $stateFile -Raw
      if ($stateContent -match '(?m)^pid:\s*(\d+)') {
        $existingPid = [int]$matches[1]
        if (Is-ProcessAlive $existingPid) {
          Write-Host "Task $slug is still running (pid $existingPid). Skipping."
          exit 0
        }
      }
    }
    $TASK_IDX = $i; $TASK_RAW = $taskRaw; $IS_RETRY = $true
    break
  }
}

# Priority 2: first [ ] if under max_active
if ($TASK_IDX -eq -1 -and -not $IS_RETRY) {
  $activeCount = ($bodyLines | Where-Object { $_ -match '^- \[~\]' }).Count
  if ($activeCount -ge $MAX_ACTIVE) {
    Write-Host "Active tasks ($activeCount) >= max_active ($MAX_ACTIVE). Exiting."
    exit 0
  }

  for ($i = 0; $i -lt $bodyLines.Count; $i++) {
    if ($bodyLines[$i] -match '^- \[ \]') {
      $TASK_IDX = $i
      $TASK_RAW = $bodyLines[$i] -replace '^- \[ \] ', ''
      break
    }
  }
}

if ($TASK_IDX -eq -1) {
  Write-Host "No pending tasks."
  exit 0
}

$linkText = Extract-LinkText $TASK_RAW
$SLUG = Slugify (&{ if ($linkText) { $linkText } else { $TASK_RAW } })
Write-Host "Task: $TASK_RAW"
Write-Host "Slug: $SLUG"
Write-Host "Retry: $IS_RETRY"

# ── Resolve prompt, model, session ────────────────────

$MODEL = $DEFAULT_MODEL
$PROMPT = ""
$SESSION_ID = ""

$linkPath = Extract-LinkPath $TASK_RAW
if ($linkPath) {
  $taskFile = Join-Path $PROJECT_ROOT $linkPath
  if (-not (Test-Path $taskFile)) {
    Write-Host "Linked task file not found: $taskFile"
    exit 1
  }
  $taskContent = Get-Content $taskFile -Raw
  $taskParts = $taskContent -split '(?m)^---\r?\n'
  if ($taskParts.Count -ge 3 -and $taskParts[1] -match '(?m)^model:\s*(.+)$') {
    $MODEL = $matches[1].Trim()
  }
  if ($taskParts.Count -ge 3) {
    $PROMPT = $taskParts[2]
  }
} else {
  $PROMPT = $TASK_RAW
}

$stateFile = Join-Path $STATE_DIR "$SLUG.md"
if ($IS_RETRY -and (Test-Path $stateFile)) {
  $stateContent = Get-Content $stateFile -Raw
  if ($stateContent -match '(?m)^session:\s*(\S+)') {
    $SESSION_ID = $matches[1]
  }
}

# ── Mark as in-progress ───────────────────────────────

if (-not $IS_RETRY) {
  $bodyLineStart = 0
  if ($parts.Count -ge 3) {
    $bodyLineStart = $parts[0].Length + 3 + $parts[1].Length + 3
  }
  $bodyLines[$TASK_IDX] = $bodyLines[$TASK_IDX] -replace '- \[ \]', '- [~]'
  $newBody = $bodyLines -join "`n"
  $newContent = $fileContent.Substring(0, $bodyLineStart) + $newBody
  [System.IO.File]::WriteAllText($TASKS_FILE, $newContent)
}

# ── Run opencode ──────────────────────────────────────

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "opencode"
$psi.Arguments = "run --format json --title task:$SLUG"
if ($MODEL) { $psi.Arguments += " --model $MODEL" }
if ($SESSION_ID) {
  $psi.Arguments += " --session $SESSION_ID"
} else {
  $psi.Arguments += " -p `"$PROMPT`""
}
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.WorkingDirectory = $PROJECT_ROOT

Write-Host "Running: opencode $($psi.Arguments)"

$process = [System.Diagnostics.Process]::Start($psi)
$CHILD_PID = $process.Id

Set-Content -Path $stateFile -Value "pid: $CHILD_PID"

$process.WaitForExit()
$OUTPUT = $process.StandardOutput.ReadToEnd()
$EXIT_CODE = $process.ExitCode

# ── Save final state ──────────────────────────────────

if ($OUTPUT -match '"sessionID":"([^"]+)"') {
  $SESSION_ID = $matches[1]
}

$stateContent = @"
pid: $CHILD_PID
session: $SESSION_ID
exit_code: $EXIT_CODE

output:
$($OUTPUT.Substring(0, [Math]::Min(2000, $OUTPUT.Length)))
"@
Set-Content -Path $stateFile -Value $stateContent

# ── Handle result ─────────────────────────────────────

if ($EXIT_CODE -eq 0) {
  $newLines = Get-Content $TASKS_FILE
  for ($i = 0; $i -lt $newLines.Count; $i++) {
    if ($newLines[$i] -match '^- \[~\]') {
      $rest = $newLines[$i] -replace '^- \[~\] ', ''
      $lt = Extract-LinkText $rest
      $rawSlug = &{ if ($lt) { $lt } else { $rest } }
      $mySlug = Slugify $rawSlug
      if ($mySlug -eq $SLUG) {
        $newLines[$i] = $newLines[$i] -replace '- \[~\]', '- [x]'
        break
      }
    }
  }
  Set-Content -Path $TASKS_FILE -Value ($newLines -join "`n")
  Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue
  Write-Host "Task completed: $SLUG"
} else {
  Write-Host "Failed (exit $EXIT_CODE). State saved."
}

exit $EXIT_CODE
