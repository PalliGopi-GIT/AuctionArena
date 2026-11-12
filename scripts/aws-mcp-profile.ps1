function Initialize-AwsCliUtf8 {
  # Process-local only. AWS CLI v2 embeds Python and uses this AWS-specific setting.
  $env:AWS_CLI_OUTPUT_ENCODING = 'UTF-8'
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  $global:OutputEncoding = [Console]::OutputEncoding
}

function Resolve-AwsExecutablePath {
  param([Parameter(Mandatory=$true)][ValidateSet('aws','uv','uvx')][string]$Name)
  $AwsFound = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($AwsFound) { return [IO.Path]::GetFullPath($AwsFound.Source) }
  $AwsCandidates = @()
  if ($Name -eq 'aws') {
    if ($env:ProgramFiles) { $AwsCandidates += Join-Path $env:ProgramFiles 'Amazon\AWSCLIV2\aws.exe' }
  } else {
    if ($env:USERPROFILE) { $AwsCandidates += Join-Path $env:USERPROFILE ('.local\bin\' + $Name + '.exe') }
    if ($env:LOCALAPPDATA) {
      $AwsCandidates += Join-Path $env:LOCALAPPDATA ('Microsoft\WinGet\Links\' + $Name + '.exe')
      $AwsPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
      if (Test-Path -LiteralPath $AwsPackages -PathType Container) {
        foreach ($AwsPackage in (Get-ChildItem -LiteralPath $AwsPackages -Directory -Filter 'astral-sh.uv_*' | Sort-Object Name)) {
          $AwsCandidates += Join-Path $AwsPackage.FullName ($Name + '.exe')
        }
      }
    }
  }
  foreach ($AwsCandidate in $AwsCandidates) {
    if (Test-Path -LiteralPath $AwsCandidate -PathType Leaf) { return [IO.Path]::GetFullPath($AwsCandidate) }
  }
  throw ('Installed ' + $Name + ' executable was not found. No tool was installed and no configuration changed.')
}

function Merge-AwsMcpLauncherText {
  param([Parameter(Mandatory=$true)][string]$Text,[Parameter(Mandatory=$true)][string]$LauncherPath)
  if (-not [IO.Path]::IsPathRooted($LauncherPath) -or [IO.Path]::GetFileName($LauncherPath) -notmatch '(?i)^uvx(?:\.exe)?$') { throw 'The AWS launcher must be an absolute uvx executable path.' }
  $AwsParents = [regex]::Matches($Text, '(?m)^\[mcp_servers\.(?:aws-mcp|"aws-mcp")\][ \t]*\r?$')
  if ($AwsParents.Count -ne 1) { throw 'Exactly one existing aws-mcp section is required. No configuration changed.' }
  $AwsStart = $AwsParents[0].Index + $AwsParents[0].Length
  $AwsNext = [regex]::Match($Text.Substring($AwsStart), '(?m)^[ \t]*\[')
  $AwsEnd = if ($AwsNext.Success) { $AwsStart + $AwsNext.Index } else { $Text.Length }
  $AwsBody = $Text.Substring($AwsStart,$AwsEnd-$AwsStart)
  $AwsCommands = [regex]::Matches($AwsBody, '(?m)^([ \t]*command[ \t]*=[ \t]*)("(?:[^"\\\r\n]|\\.)*"|''[^''\r\n]*'')([ \t]*(?:#[^\r\n]*)?)\r?$')
  if ($AwsCommands.Count -ne 1) { throw 'Expected one simple AWS launcher command. No configuration changed.' }
  $AwsCommand = $AwsCommands[0]
  $AwsLiteral = $AwsCommand.Groups[2].Value
  $AwsOldLauncher = if ($AwsLiteral.StartsWith('"')) { $AwsLiteral | ConvertFrom-Json } else { $AwsLiteral.Substring(1,$AwsLiteral.Length-2) }
  if ([IO.Path]::GetFileName($AwsOldLauncher) -notmatch '(?i)^uvx(?:\.exe)?$') { throw 'Existing AWS command is not the reviewed uvx launcher. No configuration changed.' }
  if ($AwsOldLauncher -ceq $LauncherPath) { return $Text }
  $AwsReplacement = $AwsCommand.Groups[1].Value + (ConvertTo-Json -InputObject $LauncherPath -Compress) + $AwsCommand.Groups[3].Value
  if ($AwsCommand.Value.EndsWith("`r")) { $AwsReplacement += "`r" }
  return $Text.Substring(0,$AwsStart+$AwsCommand.Index) + $AwsReplacement + $Text.Substring($AwsStart+$AwsCommand.Index+$AwsCommand.Length)
}

function Merge-AwsMcpProjectText {
  param([Parameter(Mandatory=$true)][string]$Text,
        [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_+=,.@-]+$')][string]$Profile,
        [ValidatePattern('^[a-z]{2}(?:-[a-z]+)+-\d+$')][string]$Region = 'ap-southeast-2')
  $AwsUpdated = Merge-AwsMcpProfileText -Text $Text -Profile $Profile
  $AwsNewline = if ($AwsUpdated.Contains("`r`n")) { "`r`n" } else { "`n" }
  foreach ($AwsVariable in @(@('AWS_PROFILE',$Profile),@('AWS_REGION',$Region))) {
    $AwsHeader = [regex]::Match($AwsUpdated, '(?m)^\[mcp_servers\.(?:aws-mcp|"aws-mcp")\.env\][ \t]*\r?$')
    $AwsStart = $AwsHeader.Index + $AwsHeader.Length
    $AwsNext = [regex]::Match($AwsUpdated.Substring($AwsStart), '(?m)^[ \t]*\[')
    $AwsEnd = if ($AwsNext.Success) { $AwsStart+$AwsNext.Index } else { $AwsUpdated.Length }
    $AwsBody = $AwsUpdated.Substring($AwsStart,$AwsEnd-$AwsStart)
    $AwsAssignments = [regex]::Matches($AwsBody, '(?m)^[ \t]*'+$AwsVariable[0]+'[ \t]*=[ \t]*([''"])([^''"\r\n]*)\1[ \t]*(?:#[^\r\n]*)?\r?$')
    if ($AwsAssignments.Count -eq 1) {
      if ($AwsAssignments[0].Groups[2].Value -cne $AwsVariable[1]) { throw ('Existing '+$AwsVariable[0]+' conflicts with the selected project. No configuration changed.') }
      continue
    }
    if ($AwsBody -match ($AwsVariable[0]+'\s*=')) { throw ('Unrecognized '+$AwsVariable[0]+' assignment. No configuration changed.') }
    $AwsInsert = $AwsVariable[0]+' = "'+$AwsVariable[1]+'"'+$AwsNewline
    if (-not $AwsUpdated.Substring(0,$AwsEnd).EndsWith("`n")) { $AwsInsert = $AwsNewline+$AwsInsert }
    $AwsUpdated = $AwsUpdated.Insert($AwsEnd,$AwsInsert)
  }
  return $AwsUpdated
}

function Merge-AwsMcpProfileText {
  param([Parameter(Mandatory=$true)][string]$Text,
        [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_+=,.@-]+$')][string]$Profile)
  $AwsParent = [regex]::Match($Text, '(?m)^\[mcp_servers\.(?:aws-mcp|"aws-mcp")\][ \t]*\r?$')
  if (-not $AwsParent.Success) { throw 'No generated Codex aws-mcp entry was found. Complete the toolkit wizard first.' }
  $AwsEnv = [regex]::Match($Text, '(?m)^\[mcp_servers\.(?:aws-mcp|"aws-mcp")\.env\][ \t]*\r?$')
  $AwsNewline = if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" }
  if ($AwsEnv.Success) {
    $AwsBodyStart = $AwsEnv.Index + $AwsEnv.Length
    $AwsNext = [regex]::Match($Text.Substring($AwsBodyStart), '(?m)^[ \t]*\[')
    $AwsBodyEnd = if ($AwsNext.Success) { $AwsBodyStart + $AwsNext.Index } else { $Text.Length }
    $AwsBody = $Text.Substring($AwsBodyStart, $AwsBodyEnd - $AwsBodyStart)
    $AwsAssignment = [regex]::Match($AwsBody, '(?m)^([ \t]*AWS_MCP_PROXY_PROFILES[ \t]*=[ \t]*)([''"])([^''"\r\n]*)\2([ \t]*(?:#[^\r\n]*)?)\r?$')
    if ($AwsAssignment.Success) {
      if (($AwsAssignment.Groups[3].Value -split '\s+') -ccontains $Profile) { return $Text }
      $AwsValue = ($AwsAssignment.Groups[3].Value.Trim() + ' ' + $Profile).Trim()
      $AwsReplacement = $AwsAssignment.Groups[1].Value + '"' + $AwsValue + '"' + $AwsAssignment.Groups[4].Value
      if ($AwsAssignment.Value.EndsWith("`r")) { $AwsReplacement += "`r" }
      return $Text.Substring(0,$AwsBodyStart+$AwsAssignment.Index) + $AwsReplacement + $Text.Substring($AwsBodyStart+$AwsAssignment.Index+$AwsAssignment.Length)
    }
    if ($AwsBody -match 'AWS_MCP_PROXY_PROFILES\s*=') { throw 'Unrecognized profile assignment. No configuration was changed; merge the named profile manually.' }
    $AwsInsert = 'AWS_MCP_PROXY_PROFILES = "' + $Profile + '"' + $AwsNewline
    if (-not $Text.Substring(0,$AwsBodyEnd).EndsWith("`n")) { $AwsInsert = $AwsNewline + $AwsInsert }
    return $Text.Insert($AwsBodyEnd,$AwsInsert)
  }
  $AwsParentEnd = $AwsParent.Index + $AwsParent.Length
  $AwsNext = [regex]::Match($Text.Substring($AwsParentEnd), '(?m)^[ \t]*\[')
  $AwsBodyEnd = if ($AwsNext.Success) { $AwsParentEnd + $AwsNext.Index } else { $Text.Length }
  if ($Text.Substring($AwsParentEnd,$AwsBodyEnd-$AwsParentEnd) -match '(?m)^[ \t]*env[ \t]*=') { throw 'An inline env table exists. No configuration was changed; merge the named profile manually.' }
  $AwsHeader = $AwsParent.Value.Trim().TrimEnd(']') + '.env]'
  $AwsInsert = $AwsHeader + $AwsNewline + 'AWS_MCP_PROXY_PROFILES = "' + $Profile + '"' + $AwsNewline
  if (-not $Text.Substring(0,$AwsBodyEnd).EndsWith("`n")) { $AwsInsert = $AwsNewline + $AwsInsert }
  return $Text.Insert($AwsBodyEnd,$AwsInsert)
}

function Convert-AwsGeneratedMcpEntry {
  param([Parameter(Mandatory=$true)]$Entry)
  $AwsKeys = @($Entry.PSObject.Properties.Name | Sort-Object)
  if (($AwsKeys -join ',') -ne 'args,command') { throw 'Unexpected generated entry fields. No configuration was changed.' }
  if ($Entry.command -notmatch '(?i)(^|[\\/])uvx(?:\.exe)?$') { throw 'The generated entry does not use the expected AWS proxy launcher.' }
  $AwsArgs = @($Entry.args)
  if ($AwsArgs.Count -ne 4 -or $AwsArgs[0] -notmatch '^mcp-proxy-for-aws(?:@[A-Za-z0-9._-]+)?$' -or $AwsArgs[1] -ne 'https://aws-mcp.us-east-1.api.aws/mcp' -or $AwsArgs[2] -ne '--metadata' -or $AwsArgs[3] -isnot [string]) { throw 'Generated proxy arguments differ from the reviewed AWS template. No configuration was changed.' }
  $AwsCommandJson = ConvertTo-Json -InputObject ([string]$Entry.command) -Compress
  $AwsArgsJson = ConvertTo-Json -InputObject ([string[]]$AwsArgs) -Compress
  # JSON basic strings/arrays are valid TOML here; opaque metadata remains escaped and unchanged.
  return '[mcp_servers.aws-mcp]' + "`r`n" + 'command = ' + $AwsCommandJson + "`r`n" + 'args = ' + $AwsArgsJson + "`r`n"
}

function Write-AwsMcpConfigText {
  param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Text,[string]$ExpectedOriginalText)
  $AwsTarget = [IO.Path]::GetFullPath($Path)
  if (-not (Test-Path -LiteralPath $AwsTarget -PathType Leaf)) { throw 'The original Codex configuration must exist before replacement.' }
  $AwsOriginal = [IO.File]::ReadAllText($AwsTarget)
  if ($PSBoundParameters.ContainsKey('ExpectedOriginalText') -and $AwsOriginal -cne $ExpectedOriginalText) { throw 'Configuration changed since it was read. Nothing was written.' }
  $AwsWriteId = [guid]::NewGuid().ToString('N')
  $AwsTemp = $AwsTarget + '.auctionarena-' + $AwsWriteId + '.tmp'
  $AwsBackup = $AwsTarget + '.auctionarena-' + $AwsWriteId + '.bak'
  try {
    # Create the private backup BEFORE any write to the original configuration.
    [IO.File]::Copy($AwsTarget,$AwsBackup,$false)
    [IO.File]::WriteAllText($AwsTemp,$Text,(New-Object System.Text.UTF8Encoding($false)))
    if ([IO.File]::ReadAllText($AwsTarget) -cne $AwsOriginal) { throw 'Configuration changed during repair. Original and backup preserved.' }
    # Windows PowerShell 5.1 converts $null to an invalid empty backup path here.
    [IO.File]::Replace($AwsTemp,$AwsTarget,$AwsBackup)
  } finally {
    if (Test-Path -LiteralPath $AwsTemp -PathType Leaf) { Remove-Item -LiteralPath $AwsTemp }
  }
  return $AwsBackup
}
