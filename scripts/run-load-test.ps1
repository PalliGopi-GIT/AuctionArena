param(
  [int[]]$Levels = @(100, 250, 500, 1000),
  [int]$DurationMs = 40000,
  [int]$Bids = 8,
  [ValidateRange(3,20)][int]$RoomSize = 20,
  [ValidateRange(10,120)][int]$TimerSeconds = 30,
  [ValidateSet('sample','quick','standard','mega')][string]$Mode = 'sample',
  [switch]$SeparateStart,
  [switch]$Trace,
  [switch]$CacheSnapshots,
  [string]$DirectBundle,
  [ValidateRange(0,119999)][int]$BidSpreadMs = 0,
  [ValidateRange(1024,65536)][int]$FreeMemoryFloorMiB = 1536,
  [int]$BasePort = 8801,
  [string]$EvidenceDir = 'docs/reports/evidence/AUCTIONARENA-LOAD-TEST',
  [string]$RuntimeDir = 'C:\Users\palli\AppData\Local\Temp\opencode\auctionarena-load-runtime',
  [string]$WranglerBin = 'C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime\node_modules\.bin\wrangler.cmd'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$evidence = if ([System.IO.Path]::IsPathRooted($EvidenceDir)) { $EvidenceDir } else { Join-Path $repo $EvidenceDir }
if (Test-Path -LiteralPath $evidence) {
  throw 'Choose a new evidence directory. Existing load-test evidence is preserved.'
}
New-Item -ItemType Directory -Path $evidence | Out-Null
$baseVars = Get-Content (Join-Path $RuntimeDir 'base.dev.vars') -Raw
$keyPath = Join-Path $RuntimeDir 'clerk-private.pem'
$wranglerVersion = [string](& $WranglerBin --version 2>$null)
$manifest = [ordered]@{
  task = 'AUCTIONARENA-LOAD-TEST'
  generatedAt = (Get-Date).ToString('o')
  environment = 'loopback workerd with fresh SQLite state per level'
  wrangler = $wranglerVersion
  durationMs = $DurationMs
  bids = $Bids
  roomSize = $RoomSize
  timerSeconds = $TimerSeconds
  mode = $Mode
  separateStart = [bool]$SeparateStart
  trace = [bool]$Trace
  cacheSnapshots = [bool]$CacheSnapshots
  runtime = if ($DirectBundle) { 'direct Miniflare' } else { 'Wrangler dev' }
  bidSpreadMs = $BidSpreadMs
  freeMemoryFloorMiB = $FreeMemoryFloorMiB
  levels = @()
}
$port = $BasePort
$failed = $false

try {
foreach ($users in $Levels) {
  $stray = @(Get-Process workerd -ErrorAction SilentlyContinue)
  if ($stray.Count -gt 0) {
    throw "workerd is already running (PIDs $($stray.Id -join ',')); refusing to contaminate the memory sample"
  }
  $freeMiB = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
  if ($freeMiB -lt $FreeMemoryFloorMiB) { throw "Host has only $freeMiB MiB available before $users-user run" }
  $expectedRooms = [int][math]::Ceiling($users / $RoomSize)
  $levelDir = Join-Path $RuntimeDir "level-$users-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $levelDir | Out-Null
  $levelVars = $baseVars -replace 'ALLOWED_ORIGINS=.*', "ALLOWED_ORIGINS=http://127.0.0.1:$port"
  # Windows PowerShell's utf8 encoder emits a BOM that the dotenv parser would
  # otherwise treat as part of the first variable name.
  [System.IO.File]::WriteAllText((Join-Path $levelDir '.dev.vars'), $levelVars,
    (New-Object System.Text.UTF8Encoding($false)))
  $state = Join-Path $levelDir 'state'
  $stdout = Join-Path $levelDir 'wrangler.out.log'
  $stderr = Join-Path $levelDir 'wrangler.err.log'
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use"
  }
  $env:CI = '1'
  $env:WRANGLER_SEND_METRICS = 'false'
  $startedAt = Get-Date
  if ($DirectBundle) {
    $modules = Split-Path -Parent (Split-Path -Parent $WranglerBin)
    $executable = (Get-Command node.exe).Source
    $arguments = @('scripts/serve-local-load-bundle.mjs', ('"' + (Join-Path $modules 'miniflare') + '"'),
      ('"' + (Resolve-Path -LiteralPath $DirectBundle).Path + '"'), ('"' + $state + '"'),
      ('"' + (Join-Path $levelDir '.dev.vars') + '"'), "$port")
  } else {
    $executable = $WranglerBin
    $arguments = @('dev', '--local', '--config', 'wrangler.jsonc', '--persist-to', ('"' + $state + '"'),
      '--env-file', ('"' + (Join-Path $levelDir '.dev.vars') + '"'), '--ip', '127.0.0.1', '--port', "$port", '--log-level', 'warn')
  }
  $process = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $repo -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($process.HasExited) { break }
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content -match '"maxMembers":20') { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    & taskkill /PID $process.Id /T /F 2>$null | Out-Null
    Get-Content $stdout -Tail 30 -ErrorAction SilentlyContinue
    Get-Content $stderr -Tail 30 -ErrorAction SilentlyContinue
    throw "Worker on port $port did not become healthy for $users users"
  }

  $output = Join-Path $evidence "load-$users.json"
  $integrityOutput = Join-Path $evidence "integrity-$users.json"
  $exit = $null
  $failures = @()
  try {
    $load = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(
      'scripts/load-worker.mjs', "--base=http://127.0.0.1:$port", "--users=$users", "--roomSize=$RoomSize",
      "--duration=$DurationMs", "--timerSeconds=$TimerSeconds", "--mode=$Mode", "--separateStart=$($SeparateStart.IsPresent.ToString().ToLowerInvariant())", "--trace=$($Trace.IsPresent.ToString().ToLowerInvariant())", "--cacheSnapshots=$($CacheSnapshots.IsPresent.ToString().ToLowerInvariant())", "--bidSpreadMs=$BidSpreadMs", "--bids=$Bids", "--label=auctionarena-$users",
      ('--key="' + $keyPath + '"'), ('--output="' + $output + '"')
    ) -WorkingDirectory $repo -RedirectStandardOutput (Join-Path $levelDir 'harness.out.log') -RedirectStandardError (Join-Path $levelDir 'harness.err.log') -PassThru -WindowStyle Hidden
    # Retain the process handle so Windows PowerShell can retrieve ExitCode
    # even after the child has exited.
    $null = $load.Handle
    while (-not $load.WaitForExit(1000)) {
      $freeMiB = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)
      if ($freeMiB -lt $FreeMemoryFloorMiB) {
        $failures += "host memory guard: $freeMiB MiB available; floor $FreeMemoryFloorMiB MiB"
        & taskkill /PID $load.Id /T /F 2>$null | Out-Null
        $load.WaitForExit()
        break
      }
    }
    $load.WaitForExit()
    $exit = $load.ExitCode
  } finally {
    & taskkill /PID $process.Id /T /F 2>$null | Out-Null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Milliseconds 500
      $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      $running = Get-Process workerd -ErrorAction SilentlyContinue
      if (-not $listening -and -not $running) { break }
    }
  }

  if ($exit -ne 0) { $failures += "harness exit $exit" }
  $report = $null
  try { $report = Get-Content $output -Raw | ConvertFrom-Json } catch { $failures += 'missing or unreadable harness JSON' }
  if ($report) {
    if ($report.failed) { $failures += "harness error: $($report.error)" }
    if ($report.connections.connected -ne $report.connections.attempted) { $failures += "connected $($report.connections.connected)/$($report.connections.attempted)" }
    if ($report.connections.attempted -ne $users) { $failures += "attempted $($report.connections.attempted) of $users users" }
    if ($report.setup.rooms -ne $expectedRooms) { $failures += "rooms $($report.setup.rooms), expected $expectedRooms" }
    if ($users % $RoomSize -eq 0 -and @($report.setup.membersPerRoom | Where-Object { $_ -ne $RoomSize }).Count -gt 0) { $failures += 'room membership did not match the requested uniform room size' }
    if ($report.claims.errors -ne 0) { $failures += "claim/start errors $($report.claims.errors)" }
    if ($report.http.errors -ne 0) { $failures += "http errors $($report.http.errors)" }
    if ($report.ping.errors -ne 0) { $failures += "ping errors $($report.ping.errors)" }
    if ($report.actions.errors -ne 0) { $failures += "action errors $($report.actions.errors)" }
    if ($report.broadcast.missing -ne 0) { $failures += "missing broadcasts $($report.broadcast.missing)" }
    if ($report.sockets.errors -ne 0) { $failures += "socket errors $($report.sockets.errors)" }
    if ($report.sockets.closedEarly -ne 0) { $failures += "closed early $($report.sockets.closedEarly)" }
    $expectedActions = $report.setup.rooms * $Bids
    if ($report.actions.accepted -ne $expectedActions) { $failures += "accepted $($report.actions.accepted)/$expectedActions actions" }
    if ($report.actions.expectedConflicts -ne $report.setup.rooms) { $failures += "race conflicts $($report.actions.expectedConflicts)/$($report.setup.rooms)" }
    $settled = @($report.settlement | Where-Object { $_.status -eq 'RESULT' -and -not $_.timeout -and $_.clients -eq $_.expectedClients -and -not $_.diverged }).Count
    if ($settled -ne $report.setup.rooms) { $failures += "settled $settled/$($report.setup.rooms) rooms" }
    if ($null -eq $report.ping.summary.p95 -or $report.ping.summary.p95 -gt 1000) { $failures += "ping p95 $($report.ping.summary.p95) ms" }
    if ($null -eq $report.broadcast.deliverySummary.p95 -or $report.broadcast.deliverySummary.p95 -gt 2000) { $failures += "broadcast p95 $($report.broadcast.deliverySummary.p95) ms" }
    if (-not $report.memory.workerd) { $failures += 'missing workerd memory sample' }
  }

  $integrityText = & node --no-warnings scripts/check-load-integrity.mjs $state $expectedRooms | Out-String
  [System.IO.File]::WriteAllText($integrityOutput, $integrityText, (New-Object System.Text.UTF8Encoding($false)))
  $integrity = $null
  try { $integrity = $integrityText | ConvertFrom-Json } catch { $failures += 'unreadable integrity JSON' }
  if ($integrity) {
    if (-not $integrity.pass) { $failures += "integrity: $($integrity.problems.Count) problems, $($integrity.errors.Count) errors, rooms $($integrity.rooms)/$expectedRooms" }
  }

  $entry = [ordered]@{
    users = $users
    expectedRooms = $expectedRooms
    port = $port
    state = $state
    startedAt = $startedAt.ToString('o')
    finishedAt = (Get-Date).ToString('o')
    exitCode = $exit
    harness = "load-$users.json"
    integrity = "integrity-$users.json"
    pass = ($failures.Count -eq 0)
    failures = $failures
  }
  $manifest.levels += $entry
  $status = if ($entry.pass) { 'PASS' } else { 'FAIL' }
  $roomsForLog = if ($report) { $report.setup.rooms } else { '?' }
  $pingForLog = if ($report) { $report.ping.summary.p95 } else { '?' }
  $actionForLog = if ($report) { $report.actions.latencySummary.p95 } else { '?' }
  $broadcastForLog = if ($report) { $report.broadcast.deliverySummary.p95 } else { '?' }
  Write-Output ("{0} {1} users / {2} rooms: ping p95 {3} ms, action p95 {4} ms, broadcast p95 {5} ms, {6}" -f `
    $status, $users, $roomsForLog, $pingForLog, $actionForLog, $broadcastForLog, ($failures -join '; '))
  if (-not $entry.pass) { $failed = $true; break }
  $port++
}
} catch {
  $failed = $true
  throw
} finally {
  $manifest.pass = -not $failed
  [System.IO.File]::WriteAllText((Join-Path $evidence 'run-manifest.json'),
    ($manifest | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}
if ($failed) { throw "Load level failed; evidence and manifest were still written to $evidence" }
Write-Output "Load evidence written to $evidence"
