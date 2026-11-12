param([switch]$InstallTools, [switch]$Login, [switch]$Verify, [switch]$Toolkit, [switch]$VerifyToolkit, [switch]$ConfigureMcpProfile, [switch]$ConfigureRegion, [switch]$ImportGeneratedMcp)
$ErrorActionPreference = 'Stop'
$AwsProjectProfile = 'AuctionArena'
$AwsProjectRegion = 'ap-southeast-2'
. (Join-Path $PSScriptRoot 'aws-mcp-profile.ps1')
Initialize-AwsCliUtf8

# Resolve installed tools even when this long-running host inherited an older PATH.
# Only this process and its children receive the additions; machine/user PATH is untouched.
if ($Login -or $Verify -or $Toolkit -or $VerifyToolkit -or $ConfigureRegion) {
  $AwsCliPath = Resolve-AwsExecutablePath -Name aws
  $env:PATH = [IO.Path]::GetDirectoryName($AwsCliPath) + ';' + $env:PATH
}
if ($Toolkit -or $ConfigureMcpProfile -or $ImportGeneratedMcp) {
  $AwsUvxPath = Resolve-AwsExecutablePath -Name uvx
  $env:PATH = [IO.Path]::GetDirectoryName($AwsUvxPath) + ';' + $env:PATH
  & $AwsUvxPath --version
  if ($LASTEXITCODE -ne 0) { throw 'Installed uvx did not execute. No MCP configuration was changed.' }
}
$AwsToolkitExitCode = 0

# Bootstrap only: no resource creation. After the wizard, merge only the named MCP profile.
if ($InstallTools) {
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw 'Install uv using the official instructions at https://docs.astral.sh/uv/getting-started/installation/ then rerun.'
    }
    & winget install --exact --id astral-sh.uv --source winget
    if ($LASTEXITCODE -ne 0) { throw 'uv installation failed.' }
  }
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    $AwsInstallerPath = Join-Path ([IO.Path]::GetTempPath()) ('AWSCLIV2-' + [guid]::NewGuid() + '.msi')
    Invoke-WebRequest -Uri 'https://awscli.amazonaws.com/AWSCLIV2.msi' -OutFile $AwsInstallerPath
    $AwsInstallerSignature = Get-AuthenticodeSignature -LiteralPath $AwsInstallerPath
    if ($AwsInstallerSignature.Status -ne 'Valid' -or $AwsInstallerSignature.SignerCertificate.Subject -notmatch 'Amazon') {
      throw 'AWS installer signature did not validate. Installation stopped.'
    }
    $AwsInstallerProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $AwsInstallerPath + '"'), '/passive', '/norestart') -WindowStyle Hidden -Wait -PassThru
    if ($AwsInstallerProcess.ExitCode -notin @(0,3010)) { throw ('AWS installer failed: ' + $AwsInstallerProcess.ExitCode) }
    Write-Host 'Open a new terminal so updated PATH entries are available.'
  }
}
if ($ConfigureRegion -or $Login) {
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'AWS CLI is not on PATH. Install it, then open a new terminal.' }
  & aws configure set region $AwsProjectRegion --profile $AwsProjectProfile
  if ($LASTEXITCODE -ne 0) { throw 'AWS profile Region configuration failed.' }
}
if ($Login) {
  Write-Host 'Complete the browser sign-in. Credentials last 12 hours and can renew for 90 days without another browser sign-in.'
  & aws login --profile $AwsProjectProfile --region $AwsProjectRegion
  if ($LASTEXITCODE -ne 0) { throw 'AWS login did not complete. Finish the browser sign-in and retry.' }
}
if ($Verify) {
  $AwsConfiguredRegion = (& aws configure get region --profile $AwsProjectProfile).Trim()
  if ($LASTEXITCODE -ne 0 -or $AwsConfiguredRegion -ne $AwsProjectRegion) { throw 'Profile Region is not Sydney. Rerun with -ConfigureRegion -Verify.' }
  $AwsIdentityRaw = & aws sts get-caller-identity --profile $AwsProjectProfile --region $AwsProjectRegion --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw 'AWS identity verification failed.' }
  $AwsIdentity = ($AwsIdentityRaw -join "`n") | ConvertFrom-Json
  $AwsPlanRaw = & aws freetier get-account-plan-state --profile $AwsProjectProfile --region $AwsProjectRegion --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw 'AWS plan verification failed. No toolkit or resource deployment was performed after this failure.' }
  $AwsPlan = ($AwsPlanRaw -join "`n") | ConvertFrom-Json
  if ($AwsPlan.accountId -and $AwsPlan.accountId -ne $AwsIdentity.Account) { throw 'Identity and plan responses do not match.' }
  $AwsRoleMatch = [regex]::Match($AwsIdentity.Arn, ':assumed-role/([^/]+)/')
  $AwsVerification = [ordered]@{ at=[DateTime]::UtcNow.ToString('o'); profile=$AwsProjectProfile; region=$AwsConfiguredRegion; identityVerified=$true; role=$AwsRoleMatch.Groups[1].Value; planType=$AwsPlan.accountPlanType; planStatus=$AwsPlan.accountPlanStatus; remainingCredits=$AwsPlan.accountPlanRemainingCredits; planExpiration=$AwsPlan.accountPlanExpirationDate; resourceDeployments=0; mcpToolsVerified=$false }
  $AwsEvidenceDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) '.data\aws-setup'
  [void](New-Item -ItemType Directory -Path $AwsEvidenceDirectory -Force)
  [IO.File]::WriteAllText((Join-Path $AwsEvidenceDirectory 'verification.json'),($AwsVerification | ConvertTo-Json -Depth 8),(New-Object System.Text.UTF8Encoding($false)))
  Write-Host ('Identity verified for profile ' + $AwsProjectProfile + '; selected Region ' + $AwsConfiguredRegion + '.')
  Write-Host ('Plan: ' + $AwsPlan.accountPlanType + ' / ' + $AwsPlan.accountPlanStatus)
  Write-Host ('Remaining credits: ' + $AwsPlan.accountPlanRemainingCredits.amount + ' ' + $AwsPlan.accountPlanRemainingCredits.unit)
  Write-Host 'Redacted verification saved to .data/aws-setup/verification.json. Spending limits still need review in AWS Settings > Billing.'
}
if ($Toolkit) {
  if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw 'AWS CLI is not on PATH.' }
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is not on PATH. Install it and open a new terminal first.' }
  $ConfigureMcpProfile = $true
}
if ($ConfigureMcpProfile -or $ImportGeneratedMcp) {
  $AwsCodexRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
  $AwsCodexConfig = [IO.Path]::GetFullPath((Join-Path $AwsCodexRoot 'config.toml'))
  if (-not (Test-Path -LiteralPath $AwsCodexConfig -PathType Leaf)) { throw 'Codex configuration was not found. Finish the toolkit wizard before merging the profile.' }
  $AwsOriginalText = [IO.File]::ReadAllText($AwsCodexConfig)
  $AwsBaseText = $AwsOriginalText
  if ($ImportGeneratedMcp) {
    if ($AwsOriginalText -match '(?m)^\[mcp_servers\.(?:aws-mcp|"aws-mcp")\]') { throw 'An aws-mcp entry already exists. Nothing was overwritten; use -ConfigureMcpProfile after reviewing that existing entry.' }
    $AwsGeneratedConfig = Join-Path $env:USERPROFILE '.claude.json'
    if (-not (Test-Path -LiteralPath $AwsGeneratedConfig -PathType Leaf)) { throw 'The partial wizard generated no visible source entry. No Codex settings changed.' }
    $AwsGeneratedEntry = ([IO.File]::ReadAllText($AwsGeneratedConfig) | ConvertFrom-Json).mcpServers.'aws-mcp'
    if (-not $AwsGeneratedEntry) { throw 'The generated AWS proxy entry was not found. No Codex settings changed.' }
    if (-not $AwsBaseText.EndsWith("`n")) { $AwsBaseText += "`r`n" }
    $AwsBaseText += Convert-AwsGeneratedMcpEntry -Entry $AwsGeneratedEntry
  }
  $AwsUpdatedText = Merge-AwsMcpLauncherText -Text $AwsBaseText -LauncherPath $AwsUvxPath
  $AwsUpdatedText = Merge-AwsMcpProjectText -Text $AwsUpdatedText -Profile $AwsProjectProfile -Region $AwsProjectRegion
  if ($AwsUpdatedText -cne $AwsOriginalText) {
    $AwsBackupConfig = Write-AwsMcpConfigText -Path $AwsCodexConfig -Text $AwsUpdatedText -ExpectedOriginalText $AwsOriginalText
    Write-Host 'The original Codex configuration has a private backup beside it.'
  }
  Write-Host ('Codex aws-mcp uses absolute launcher: ' + $AwsUvxPath)
  Write-Host 'AWS_MCP_PROXY_PROFILES includes AuctionArena; requested AWS_PROFILE/AWS_REGION are retained. Arguments, other variables and unrelated entries are preserved.'
}
if ($Toolkit) {
  # The user explicitly requested this rerun. Back up detected MCP files first.
  foreach ($AwsAgentFile in @('.claude.json','.kiro/settings/mcp.json','.cursor/mcp.json')) {
    $AwsAgentPath = Join-Path $env:USERPROFILE $AwsAgentFile
    if (Test-Path -LiteralPath $AwsAgentPath -PathType Leaf) {
      [IO.File]::Copy($AwsAgentPath,($AwsAgentPath+'.auctionarena-'+[guid]::NewGuid().ToString('N')+'.bak'),$false)
    }
  }
  $AwsBeforeToolkit = [IO.File]::ReadAllText($AwsCodexConfig)
  [IO.File]::Copy($AwsCodexConfig,($AwsCodexConfig+'.auctionarena-toolkit-'+[guid]::NewGuid().ToString('N')+'.bak'),$false)
  Write-Host 'Running the explicitly requested toolkit wizard; no restart or resource deployment is performed.'
  & aws configure agent-toolkit --yes --region us-east-1 --profile $AwsProjectProfile
  $AwsToolkitExitCode = $LASTEXITCODE
  if ($AwsToolkitExitCode -ne 0) { Write-Host ('Toolkit wizard failed with exit code '+$AwsToolkitExitCode+'. Catalog verification will still run independently.') }
  $AwsAfterToolkit = [IO.File]::ReadAllText($AwsCodexConfig)
  if ($AwsAfterToolkit -cne $AwsBeforeToolkit) {
    throw 'Toolkit changed existing Codex config unexpectedly. Private before/after files are preserved; stopped without replacing them.'
  }
}
if ($VerifyToolkit) {
  $AwsCatalogRaw = & aws agent-toolkit list-available-skills --region us-east-1 --profile $AwsProjectProfile --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw 'Agent Toolkit catalog verification failed.' }
  $AwsEvidenceDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) '.data\aws-setup'
  [void](New-Item -ItemType Directory -Path $AwsEvidenceDirectory -Force)
  [IO.File]::WriteAllText((Join-Path $AwsEvidenceDirectory 'skills.json'),($AwsCatalogRaw -join "`n"),(New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'Remote skill catalog retrieved. The MCP tools still need verification after reconnecting Codex.'
}
Write-Host 'Profile: AuctionArena; project Region: ap-southeast-2.'
Write-Host 'Confirm Region in AWS Settings > View all projects > Overview > Additional Info > Region.'
Write-Host 'Review spend/plan in AWS Settings > Billing. No resources are deployed by this script.'
Write-Host 'Toolkit configuration is an interactive, separately reviewed step:'
Write-Host '  aws configure agent-toolkit --yes --region us-east-1 --profile AuctionArena'
Write-Host 'Review existing Codex MCP entries before accepting wizard changes. Preserve unrelated entries.'
Write-Host 'MCP service endpoint: https://aws-mcp.us-east-1.api.aws/mcp'
Write-Host 'Project default Region is ap-southeast-2. Merge env.AWS_MCP_PROXY_PROFILES=AuctionArena into generated aws-mcp entries.'
Write-Host 'The proxy selects profiles with AWS_MCP_PROXY_PROFILES. AWS_PROFILE/AWS_REGION are retained as explicitly requested project env values.'
Write-Host 'Only the AWS launcher is normalized to an absolute installed path; generated args, timeout, transport and unrelated entries remain unchanged.'
Write-Host 'The us-east-1 toolkit endpoint is not permission to deploy regional resources there.'
Write-Host '  aws agent-toolkit list-available-skills --region us-east-1 --profile AuctionArena'
Write-Host 'After reconnecting the toolkit, verify documentation/agent-skills search and STS identity through it.'
if ($AwsToolkitExitCode -ne 0) { throw ('Toolkit wizard exited '+$AwsToolkitExitCode+'; the saved launcher repair remains intact. See the exact wizard error above. No restart or deployment occurred.') }
