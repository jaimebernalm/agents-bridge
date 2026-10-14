import {test,expect,spyOn} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,mkdirSync,symlinkSync,renameSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {once} from 'node:events';
import {ProjectAuthorizations} from '../src/project-authorization';
import {nativeFixture,until} from './collaboration-fixture';
import {DesktopRunStore,desktopPrefix} from '../src/desktop-runs';
import {findPeer,peerAddress,sendFrames,userFrame} from '../src/claude';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerDesktopTools} from '../src/desktop-runtime';
import {inspectParticipant} from '../src/participants';
import {tools} from '../src/names';
const pluginRoot=resolve(import.meta.dir,'..');

test('project grant persists, aliases share scope, recreated folders and other worktrees do not; CAS and old actions cannot regrant',()=>{
 const root=mkdtempSync('/tmp/project-auth-'),project=join(root,'project'),other=join(root,'other');mkdirSync(project);mkdirSync(other);symlinkSync(project,join(root,'alias'));
 let now=100;let store=new ProjectAuthorizations(join(root,'state'),()=>now);const change={project,ownerThread:randomUUID(),actionId:randomUUID(),enabled:true,expectedRevision:0,confirmed:true as const};
 try {
  expect(store.status(project).enabled).toBe(false);expect(store.change(change).revision).toBe(1);expect(store.allows(project,100)).toBe(false);expect(store.allows(join(root,'alias'),101)).toBe(true);expect(store.allows(other,101)).toBe(false);
  expect(statSync(join(root,'state/project-authorizations.sqlite')).mode&0o077).toBe(0);
  store.close();store=new ProjectAuthorizations(join(root,'state'),()=>now);expect(store.status(project).enabled).toBe(true);
  expect(store.change(change).reused).toBe(true);expect(()=>store.change({...change,enabled:false})).toThrow('reused');
  expect(()=>store.change({...change,actionId:randomUUID(),expectedRevision:0})).toThrow('revision');
  now=200;store.change({...change,actionId:randomUUID(),enabled:false,expectedRevision:1});expect(store.allows(project,201)).toBe(false);
  expect(store.change(change).enabled).toBe(false);expect(store.status(project).revision).toBe(2);
  now=300;store.change({...change,actionId:randomUUID(),expectedRevision:2});expect(store.allows(project,150)).toBe(false);expect(store.allows(project,301)).toBe(true);
  // macOS may number the same volume differently after a restart; the same folder keeps its grant.
  store.close();const db=new Database(join(root,'state/project-authorizations.sqlite'));db.run("UPDATE project_authorizations SET device='1'");db.close();
  store=new ProjectAuthorizations(join(root,'state'),()=>now);expect(store.status(project)).toMatchObject({enabled:true,folderChanged:false});expect(store.allows(project,301)).toBe(true);
  renameSync(project,join(root,'old-project'));mkdirSync(project);expect(store.status(project).folderChanged).toBe(true);expect(store.status(project).enabled).toBe(false);expect(store.allows(project,400)).toBe(false);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

async function running(){const f=await nativeFixture(false,{reception:'default'});f.desktop.setPermissions({approvalPolicy:'never',sandboxPolicy:{type:'dangerFullAccess'}});f.bridge.updateRuntime({status:'idle',mode:'bypass'});const codex=await f.connect();
 // The Claude chat runs the bridge too; the collaboration needs it before it can start.
 const p=await inspectParticipant({configDir:f.config,stateDir:f.state,ipcPath:f.desktop.path},f.peerId,'claude'),server=new McpServer({name:'claude-fixture',version:'1'}),client=new Client({name:'fixture',version:'1'});
 const runtime=registerDesktopTools(server,{configDir:f.config,stateDir:f.state,ipcPath:f.desktop.path,codexHome:f.root,pluginRoot,authenticate:async()=>({provider:'claude',sessionId:p.sessionId,pid:p.pid,procStart:p.procStart,project:f.root,binding:{method:'fixture',generation:'fixture',surface:'claude-desktop',evidence:[]}})}),[a,b]=InMemoryTransport.createLinkedPair();
 await Promise.all([server.connect(a),client.connect(b)]);await client.callTool({name:tools.discover,arguments:{}});
 const authorizations=new ProjectAuthorizations(f.state);const change=(project:string,enabled:boolean)=>authorizations.change({project,ownerThread:f.desktop.threadId,actionId:randomUUID(),enabled,expectedRevision:authorizations.status(project).revision,confirmed:true});
 const grant=()=>change(f.root,true),revoke=()=>change(f.root,false);grant();
 const run=(await f.call(codex,'prepare_collaboration',{requestId:randomUUID(),peerId:f.peerId,context:{objective:'Project authorization acceptance'},openPanel:false})).data as {id:string};
 expect((await f.call(codex,'start_collaboration',{runId:run.id,supervised:true})).error).toBeFalsy();
 const ask=async()=>{const messageId=randomUUID();expect((await f.call(codex,'send_message',{runId:run.id,messageId,text:'Read only check'})).error).toBeFalsy();return messageId;};
 // Claude's reply is written as in-flight work, after its own checks, so only the Codex receiver decides:
 // it models a reply that arrives after the person changed reception.
 const reply=async(replyTo:string,text:string,contextVersion?:number)=>{const store=new DesktopRunStore(f.state),claude={provider:'claude' as const,sessionId:f.peerId};
  try{const reserved=store.reserve(run.id,claude,randomUUID(),text,replyTo),transportId=randomUUID(),receiver=findPeer(f.config,f.desktop.threadId);
   const frame=userFrame(receiver,peerAddress(findPeer(f.config,f.peerId).messagingSocketPath),'Claude test',f.peerId,transportId,desktopPrefix+JSON.stringify({...reserved.header!,...(contextVersion?{contextVersion}:{})})+'\n'+text,'prompting',null);
   store.claim(run.id,claude,reserved.message.id,transportId,reserved.message.epoch,frame.message.content);
   expect(await sendFrames(f.config,receiver,[frame])).toBe(true);store.transport(transportId,'socket-written');return transportId;}
  finally{store.close();}};
 const inbound=(id:string)=>f.bridge.status().messages.find(m=>m.id===id)?.status;
 return {f,codex,run,ask,reply,inbound,grant,revoke,change,authorizations,async close(){authorizations.close();await client.close();await server.close();await runtime.close();await codex.close();await f.close();}};
}
test('default receiver inherits only new verified replies; revocation stops inheritance without changing the chat policy',async()=>{
 const x=await running();try {
  const first=await x.ask(),second=await x.ask();await Bun.sleep(3);
  await x.reply(first,'AUTHORIZED_REPLY');await until(()=>x.f.desktop.submissions.length===1);expect(x.f.bridge.policy()).toBe('default');expect(JSON.stringify(x.f.desktop.submissions)).toContain('AUTHORIZED_REPLY');
  x.revoke();const revoked=await x.reply(second,'REVOKED_REPLY');await until(()=>x.inbound(revoked)==='held');expect(x.f.desktop.submissions).toHaveLength(1);expect(x.f.bridge.policy()).toBe('default');
  x.grant();await Bun.sleep(50);expect(x.f.desktop.submissions).toHaveLength(1); // No retroactive replay of a held reply.
 }finally{await x.close();}
},15000);
for(const policy of ['hold','refuse'] as const)test(`project authorization respects explicit ${policy}`,async()=>{
 const x=await running();try {const asked=await x.ask();await x.f.bridge.setPolicy(policy);await Bun.sleep(3);const id=await x.reply(asked,'EXPLICIT_OVERRIDE');await until(()=>x.inbound(id)===(policy==='hold'?'held':'refused'));expect(x.f.desktop.submissions).toHaveLength(0);expect(x.f.bridge.policy()).toBe(policy);}finally{await x.close();}
},15000);
test('project grant does not accept ordinary peer traffic or stale-context responses',async()=>{
 const x=await running();try {const asked=await x.ask();await Bun.sleep(3);const stale=await x.reply(asked,'STALE_REPLY',2);await until(()=>x.inbound(stale)==='dropped');expect(x.f.desktop.submissions).toHaveLength(0);
  const revision=(await x.f.call(x.codex,'get_status',{runId:x.run.id})).data.coordination.revision;expect((await x.f.call(x.codex,'control_collaboration',{runId:x.run.id,commandId:randomUUID(),expectedRevision:revision,control:{action:'cancel'}})).error).toBeFalsy();
  const ordinary=randomUUID(),socket=net.createConnection(x.f.bridge.status().replyAddress!.slice(4));await once(socket,'connect');socket.end(JSON.stringify({msgV:1,type:'user',msg_id:ordinary,from:'uds:'+join(x.f.root,'s',process.ppid+'.sock'),from_mode:'prompting',session_id:x.f.desktop.threadId,message:{role:'user',content:'ORDINARY_UNCORRELATED'}})+'\n');await once(socket,'close');
  await until(()=>x.inbound(ordinary)==='held');expect(x.f.desktop.submissions).toHaveLength(0);
 }finally{await x.close();}
},15000);
test('a grant for a different folder does not authorize this receiver',async()=>{
 const x=await running();try {const asked=await x.ask();const other=join(x.f.root,'other');mkdirSync(other);x.revoke();x.change(other,true);await Bun.sleep(3);const id=await x.reply(asked,'OTHER_PROJECT');await until(()=>x.inbound(id)==='held');expect(x.f.desktop.submissions).toHaveLength(0);}finally{await x.close();}
},15000);


test('revocation between routing decision and delivery entry cannot leave a stale acceptance',async()=>{
 const x=await running();const original=ProjectAuthorizations.prototype.allows;let revoked=false;
 try {const asked=await x.ask();await Bun.sleep(3);
  const lookup=spyOn(ProjectAuthorizations.prototype,'allows').mockImplementation(function(this:ProjectAuthorizations,path:string,receivedAt:number){
   const allowed=original.call(this,path,receivedAt);
   if(allowed&&!revoked){revoked=true;x.revoke();}
   return allowed;
  });
  try {const id=await x.reply(asked,'REVOKED_DURING_ROUTE');await until(()=>revoked);await until(()=>['held','denied'].includes(x.inbound(id)??''));expect(x.f.desktop.submissions).toHaveLength(0);expect(x.f.bridge.policy()).toBe('default');}
  finally{lookup.mockRestore();}
 }finally{await x.close();}
},15000);
