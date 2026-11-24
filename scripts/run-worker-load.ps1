param(
  [string]$WranglerBin = 'C:\Users\palli\AppData\Local\Temp\opencode\wrangler-runtime\node_modules\.bin\wrangler.cmd',
  [string]$RuntimeDir = 'C:\Users\palli\AppData\Local\Temp\opencode\worker-runtime',
  [int[]]$Levels = @(100, 250, 500, 1000),
  [int]$DurationMs = 40000,
  [int]$Bids = 8,
  [string]$EvidenceDir = 'docs/reports/evidence/WP-G-WORKERS-RUNTIME'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$evidence = Join-Path $repo $EvidenceDir
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
$baseVars = Get-Content (Join-Path $RuntimeDir '.dev.vars') -Raw
$keyPath = Join-Path $RuntimeDir 'clerk-private.pem'
$results = @()
$port = 8801

foreach ($users in $Levels) {
  $levelDir = Join-Path $RuntimeDir "load-$users"
  New-Item -ItemType Directory -Force -Path $levelDir | Out-Null
  $levelVars = $baseVars -replace 'ALLOWED_ORIGINS=.*', "ALLOWED_ORIGINS=http://127.0.0.1:$port"
  # Windows PowerShell's utf8 encoder emits a BOM that the dotenv parser would
  # otherwise treat as part of the first variable name.
  [System.IO.File]::WriteAllText((Join-Path $levelDir '.dev.vars'), $levelVars,
    (New-Object System.Text.UTF8Encoding($false)))
  $stdout = Join-Path $levelDir 'wrangler.out.log'
  $stderr = Join-Path $levelDir 'wrangler.err.log'
  $state = Join-Path $levelDir 'state'
  Remove-Item -Recurse -Force $state -ErrorAction SilentlyContinue
  node scripts/check-do-state-path.mjs --state $state --config wrangler.jsonc
  if ($LASTEXITCODE -ne 0) { throw "Durable Object state path preflight failed for $state" }
  $env:CI = '1'
  $env:WRANGLER_SEND_METRICS = 'false'
  $process = Start-Process -FilePath $WranglerBin -ArgumentList @(
    'dev', '--config', 'wrangler.jsonc', '--persist-to', $state, '--env-file', (Join-Path $levelDir '.dev.vars'),
    '--ip', '127.0.0.1', '--port', "$port", '--log-level', 'warn'
  ) -WorkingDirectory $repo -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -NoNewWindow
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    Get-Content $stdout -Tail 30
    Get-Content $stderr -Tail 30
    throw "Worker on port $port did not become healthy for $users users"
  }
  $output = Join-Path $evidence "load-$users.json"
  $started = Get-Date
  $exit = $null
  try {
    node scripts/load-worker.mjs --base="http://127.0.0.1:$port" --users=$users --duration=$DurationMs --bids=$Bids --label="worker-$users" --key=$keyPath --output=$output
    $exit = $LASTEXITCODE
  } finally {
    taskkill /PID $process.Id /T /F 2>$null | Out-Null
    Start-Sleep -Seconds 2
  }
  $result = [ordered]@{
    users = $users
    port = $port
    exitCode = $exit
    startedAt = $started.ToString('o')
    finishedAt = (Get-Date).ToString('o')
    output = $output
    stderrTail = @(Get-Content $stderr -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { [string]$_ })
  }
  $results += $result
  $port++
}

# Per-level JSON files are the authoritative measurements. The orchestration
# log stays in the runtime directory so it cannot be mistaken for evidence.
$log = [ordered]@{
  task = 'WP-G-WORKERS-RUNTIME'
  generatedAt = (Get-Date).ToString('o')
  wrangler = [string](& $WranglerBin --version 2>$null)
  levels = $results
}
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$log | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $RuntimeDir "load-run-$stamp.json") -Encoding utf8
node scripts/summarize-load.mjs
Write-Output "Load evidence written to $evidence"
