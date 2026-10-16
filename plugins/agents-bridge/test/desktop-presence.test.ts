import {test,expect} from 'bun:test';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {registerDesktopTools,type RuntimeCaller} from '../src/desktop-runtime';
import {advertisedOtherVersion,desktopPresent} from '../src/desktop-presence';
import {processStart} from '../src/claude';

test('a verified startup advertises live presence without opening a collaboration database; stale process evidence is rejected',async()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-presence-')),stateDir=join(root,'state'),procStart=await processStart(process.pid);
 const c:RuntimeCaller={provider:'claude',sessionId:randomUUID(),pid:process.pid,procStart,project:root,binding:{method:'isolated_fixture',surface:'claude-desktop',generation:randomUUID(),evidence:[]}};
 const server=new McpServer({name:'presence-fixture',version:'1'}),runtime=registerDesktopTools(server,{configDir:join(root,'config'),stateDir,ipcPath:join(root,'ipc'),codexHome:root,pluginRoot:root,authenticate:async()=>c,registerAtStartup:true});
 const peer={provider:c.provider,sessionId:c.sessionId,pid:c.pid,procStart:c.procStart,cwd:realpathSync(root)};
 try{
  const deadline=Date.now()+2000;while(!await desktopPresent(stateDir,peer)&&Date.now()<deadline)await Bun.sleep(10);
  expect(await desktopPresent(stateDir,peer)).toBe(true);expect(readdirSync(stateDir)).toEqual(['desktop-presence']);
  expect(await desktopPresent(stateDir,{...peer,sessionId:randomUUID()})).toBe(false);expect(await desktopPresent(stateDir,{...peer,cwd:root+'/different'})).toBe(false);
  const path=join(stateDir,'desktop-presence','claude-'+c.sessionId+'.json'),record=JSON.parse(readFileSync(path,'utf8'));writeFileSync(path,JSON.stringify({...record,runtimeStart:'obsolete process'}),{mode:0o600});expect(await desktopPresent(stateDir,peer)).toBe(false);
  // A chat still on an older bridge is not present, and says which version it runs.
  expect(advertisedOtherVersion(stateDir,peer)).toBeNull();writeFileSync(path,JSON.stringify({...record,version:'0.0.1'}),{mode:0o600});expect(await desktopPresent(stateDir,peer)).toBe(false);expect(advertisedOtherVersion(stateDir,peer)).toBe('0.0.1');expect(advertisedOtherVersion(stateDir,{...peer,pid:peer.pid+1})).toBeNull();
 }finally{await runtime.close();await server.close();rmSync(root,{recursive:true,force:true})}
});

test('a Claude chat that moves to another folder advertises itself there without calling a tool',async()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-presence-')),stateDir=join(root,'state'),scratch=join(root,'scratch'),project=join(root,'project'),sessions=join(root,'config','sessions'),procStart=await processStart(process.pid);
 for(const d of [scratch,project,sessions])mkdirSync(d,{recursive:true});
 const registry=join(sessions,process.pid+'.json'),write=(cwd:string)=>writeFileSync(registry,JSON.stringify({pid:process.pid,sessionId:'x',cwd}),{mode:0o600});write(scratch);
 let c:RuntimeCaller={provider:'claude',sessionId:randomUUID(),pid:process.pid,procStart,project:scratch,binding:{method:'isolated_fixture',surface:'claude-desktop',generation:randomUUID(),evidence:[]}};
 const server=new McpServer({name:'presence-fixture',version:'1'}),runtime=registerDesktopTools(server,{configDir:join(root,'config'),stateDir,ipcPath:join(root,'ipc'),codexHome:root,pluginRoot:root,authenticate:async()=>c,registerAtStartup:true});
 const peer=(cwd:string)=>({provider:c.provider,sessionId:c.sessionId,pid:c.pid,procStart:c.procStart,cwd:realpathSync(cwd)});
 const until=async(ok:()=>Promise<boolean>)=>{const deadline=Date.now()+3000;while(!await ok()&&Date.now()<deadline)await Bun.sleep(20);return ok();};
 try{
  expect(await until(()=>desktopPresent(stateDir,peer(scratch)))).toBe(true);
  c={...c,project};write(project);
  expect(await until(()=>desktopPresent(stateDir,peer(project)))).toBe(true);expect(await desktopPresent(stateDir,peer(scratch))).toBe(false);
 }finally{await runtime.close();await server.close();rmSync(root,{recursive:true,force:true})}
});
