import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

function merge(text:string){const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; try { Merge-AwsMcpProfileText -Text ([Console]::In.ReadToEnd()) -Profile AuctionArena } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"],{input:text,encoding:'utf8',windowsHide:true,timeout:30000});return {status:result.status,text:result.stdout.trimEnd(),error:result.stderr};}
const parent='[mcp_servers.aws-mcp]\ncommand = "uvx"\nargs = ["proxy", "--region", "us-east-1"]\nstartup_timeout_sec = 90\n';
function transform(command:string,input:object){const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; try { $p=([Console]::In.ReadToEnd()) | ConvertFrom-Json; "+command+" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:30000});return {status:result.status,text:result.stdout.trimEnd(),error:result.stderr};}
describe.skipIf(process.platform!=='win32')('AWS bootstrap profile merge only (no AWS calls)',()=>{
  it('changes only the AWS launcher, preserving arguments, env, comments and unrelated entries',()=>{
    const launcher='C:\\Tools With Spaces\\uvx.exe';
    const input=parent+'[mcp_servers.aws-mcp.env]\nAWS_MCP_PROXY_PROFILES="AuctionArena"\nAWS_PROFILE="AuctionArena"\nAWS_REGION="ap-south-1"\nOTHER="keep"\n[mcp_servers.other]\ncommand="uvx"\n';
    const result=transform('Merge-AwsMcpLauncherText -Text $p.text -LauncherPath $p.launcher',{text:input,launcher});
    expect(result.status,result.error).toBe(0);
    const assignment=result.text.match(/^command = (.+)$/m)?.[1];expect(JSON.parse(assignment!)).toBe(launcher);
    expect(result.text.replace(/^command = .+$/m,'command = "uvx"')).toBe(input.trimEnd());
    const again=transform('Merge-AwsMcpLauncherText -Text $p.text -LauncherPath $p.launcher',{text:result.text,launcher});
    expect(again.status,again.error).toBe(0);expect(again.text).toBe(result.text);
  },90000);
  it('handles quoted AWS sections, literal command strings, CRLF and trailing comments',()=>{
    const input=parent.replace('mcp_servers.aws-mcp','mcp_servers."aws-mcp"').replace('command = "uvx"',"command = 'uvx' # preserve").replaceAll('\n','\r\n');
    const result=transform('Merge-AwsMcpLauncherText -Text $p.text -LauncherPath $p.launcher',{text:input,launcher:'C:\\Tools\\uvx.exe'});
    expect(result.status,result.error).toBe(0);expect(result.text).toContain(' # preserve\r\n');expect(result.text).toContain('args = ["proxy", "--region", "us-east-1"]\r\n');
  },90000);
  it('rejects relative launchers, unknown commands and duplicate AWS sections',()=>{
    for(const [text,launcher] of [[parent,'uvx'],[parent.replace('"uvx"','"other.exe"'),'C:\\Tools\\uvx.exe'],[parent+parent,'C:\\Tools\\uvx.exe']]){
      expect(transform('Merge-AwsMcpLauncherText -Text $p.text -LauncherPath $p.launcher',{text,launcher}).status).toBe(1);
    }
  },90000);
  it('adds the requested project env without replacing existing variables or other profile selections',()=>{
    const input=parent+'[mcp_servers.aws-mcp.env]\nAWS_MCP_PROXY_PROFILES="another-profile"\nAWS_PROFILE="AuctionArena" # keep\nAWS_REGION="ap-south-1"\nOTHER="keep"\n[mcp_servers.other.env]\nAWS_PROFILE="other"\n';
    const result=transform('Merge-AwsMcpProjectText -Text $p.text -Profile AuctionArena -Region ap-south-1',{text:input});
    expect(result.status,result.error).toBe(0);expect(result.text).toContain('another-profile AuctionArena');
    expect(result.text).toContain('AWS_PROFILE="AuctionArena" # keep');expect(result.text).toContain('OTHER="keep"');expect(result.text).toContain('[mcp_servers.other.env]\nAWS_PROFILE="other"');
    const empty=transform('Merge-AwsMcpProjectText -Text $p.text -Profile AuctionArena -Region ap-south-1',{text:parent});
    expect(empty.status,empty.error).toBe(0);expect(empty.text).toContain('AWS_PROFILE = "AuctionArena"');expect(empty.text).toContain('AWS_REGION = "ap-south-1"');
    const again=transform('Merge-AwsMcpProjectText -Text $p.text -Profile AuctionArena -Region ap-south-1',{text:result.text});expect(again.status,again.error).toBe(0);expect(again.text).toBe(result.text);
  },90000);
  it('refuses conflicting project env rather than overwriting an existing selection',()=>{
    expect(transform('Merge-AwsMcpProjectText -Text $p.text -Profile AuctionArena -Region ap-south-1',{text:parent+'[mcp_servers.aws-mcp.env]\nAWS_REGION="us-west-2"\n'}).status).toBe(1);
  },90000);
  it('refuses to replace config changed since the caller read it',()=>{
    const directory=mkdtempSync(join(tmpdir(),'arena-mcp-stale-'));
    try{const path=join(directory,'config.toml');writeFileSync(path,'user edit');
      const result=transform('Write-AwsMcpConfigText -Path $p.path -Text $p.text -ExpectedOriginalText $p.expected',{path,text:'script edit',expected:'older snapshot'});
      expect(result.status).toBe(1);expect(readFileSync(path,'utf8')).toBe('user edit');expect(readdirSync(directory)).toEqual(['config.toml']);
    }finally{if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw new Error('Unexpected cleanup target');rmSync(directory,{recursive:true,force:true});}
  },90000);
  it('uses process-local UTF-8 and preserves redirected Unicode output',()=>{
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; Initialize-AwsCliUtf8; if($env:AWS_CLI_OUTPUT_ENCODING -ne 'UTF-8' -or [Console]::OutputEncoding.CodePage -ne 65001) { exit 1 }; & node -e \"process.stdout.write(String.fromCharCode(8594))\""],{encoding:'utf8',windowsHide:true,timeout:30000});
    expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe(String.fromCharCode(8594));
  },90000);
  it('adds the environment table and preserves generated and unrelated configuration',()=>{
    const other='  [mcp_servers.other]\ncommand = "unrelated"\nAWS_MCP_PROXY_PROFILES = "do-not-touch"\n[ mcp_servers.literal ]\nvalue = "untouched"\n';
    const result=merge(parent+other);expect(result.status).toBe(0);expect(result.text.startsWith(parent)).toBe(true);expect(result.text).toContain('AWS_MCP_PROXY_PROFILES = "AuctionArena"');expect(result.text).toContain(other.trimEnd());
  },90000);
  it('appends the profile to an existing list, retains other variables and is idempotent',()=>{
    const input=parent+'[mcp_servers.aws-mcp.env]\nEXISTING = "fixture-value"\nAWS_MCP_PROXY_PROFILES = "other-profile" # keep\n';const first=merge(input);expect(first.status).toBe(0);expect(first.text).toContain('"other-profile AuctionArena" # keep');expect(first.text).toContain('EXISTING = "fixture-value"');const second=merge(first.text);expect(second.status,second.error).toBe(0);expect(second.text).toBe(first.text);
  },90000);
  it('handles quoted server names and an existing empty env section',()=>{
    const input=parent.replace('mcp_servers.aws-mcp','mcp_servers."aws-mcp"')+'[mcp_servers."aws-mcp".env]\n';const result=merge(input);expect(result.status).toBe(0);expect(result.text).toContain('AWS_MCP_PROXY_PROFILES = "AuctionArena"');
  },90000);
  it('fails without changing unknown/inline configurations',()=>{
    expect(merge('[mcp_servers.other]\ncommand="other"').status).toBe(1);
    expect(merge(parent+'env = { EXISTING = "fixture-value" }\n').status).toBe(1);
  },90000);
  it('translates only the reviewed generated AWS proxy entry without changing its arguments',()=>{
    const entry={command:'uvx',args:['mcp-proxy-for-aws@latest','https://aws-mcp.us-east-1.api.aws/mcp','--metadata','fixture:"opaque"']};
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; Convert-AwsGeneratedMcpEntry -Entry (([Console]::In.ReadToEnd()) | ConvertFrom-Json)"],{input:JSON.stringify(entry),encoding:'utf8',windowsHide:true,timeout:30000});
    expect(result.status).toBe(0);const args=result.stdout.match(/^args = (.+)$/m)?.[1];expect(args).toBeTruthy();expect(JSON.parse(args!)).toEqual(entry.args);expect(result.stdout).toContain('command = "uvx"');
  },90000);
  it('refuses generated entries with unexpected fields or launchers',()=>{
    for(const entry of [{command:'other.exe',args:[]},{command:'uvx',args:[],env:{UNEXPECTED:'fixture'}}]){
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; try { Convert-AwsGeneratedMcpEntry -Entry (([Console]::In.ReadToEnd()) | ConvertFrom-Json) } catch { exit 1 }"],{input:JSON.stringify(entry),encoding:'utf8',windowsHide:true,timeout:30000});expect(result.status).toBe(1);
    }
  },90000);
  it('replaces a real file and preserves its original in a private backup on Windows PowerShell',()=>{
    const directory=mkdtempSync(join(tmpdir(),'arena-mcp-write-'));
    try{
      const path=join(directory,'config.toml');writeFileSync(path,'original fixture');
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',". ./scripts/aws-mcp-profile.ps1; $p=([Console]::In.ReadToEnd()) | ConvertFrom-Json; Write-AwsMcpConfigText -Path $p.path -Text $p.text"],{input:JSON.stringify({path,text:'updated fixture'}),encoding:'utf8',windowsHide:true,timeout:30000});
      expect(result.status,result.stderr).toBe(0);expect(readFileSync(path,'utf8')).toBe('updated fixture');expect(readFileSync(result.stdout.trim(),'utf8')).toBe('original fixture');expect(readdirSync(directory).some(name=>name.endsWith('.tmp'))).toBe(false);
    }finally{if(!resolve(directory).startsWith(resolve(tmpdir())+sep))throw new Error('Unexpected cleanup target');rmSync(directory,{recursive:true,force:true});}
  },90000);
});
