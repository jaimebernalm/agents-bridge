import {test,expect} from 'bun:test';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PanelCommands} from '../src/panel-commands';
import {startPanel} from '../src/panel';
import {nativeFixture,until} from './collaboration-fixture';
import {Database} from 'bun:sqlite';
const root=resolve(import.meta.dir,'..');
async function fixture(dropAcknowledgement=false,reception:'accept'|'default'='accept'){const f=await nativeFixture(dropAcknowledgement,{reception});const p=startPanel({configDir:f.config,stateDir:f.state,codexHome:f.root,pluginRoot:root,ipcPath:f.desktop.path});
 const token=new URL(p.url).hash.slice(7);const auth=await fetch(p.origin+'/api/v1/session',{method:'POST',headers:{Origin:p.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});expect(auth.status).toBe(200);
 const {csrf}=await auth.json() as {csrf:string};const cookie=auth.headers.get('set-cookie')!.split(';')[0]!;
 const call=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(p.origin+'/api/v1/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:p.origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const create=()=>({commandId:randomUUID(),ownerThread:f.desktop.threadId,project:f.root,command:{action:'create' as const,peerId:f.peerId,context:{objective:'Panel smoke <script>alert(1)</script>',constraints:['Read only'],references:[],priorAnalysis:{}},routine:{mode:'free' as const,starts:{codex:'new' as const,claude:'new' as const}},limits:{maxMessages:8,maxSeconds:300},coordination:{initialBarrier:false,leaseSeconds:300},revisionPolicy:'same' as const,allowBusyPeer:false}});
 return {f,p,call,create,cookie,csrf,async close(){await p.close();await f.close();}};
}
test('panel guards tokens, Origin, CSRF, paths and preserves existing private run state',async()=>{const x=await fixture();try{
 expect((await fetch(x.p.origin+'/api/v1/runs')).status).toBe(401);
 expect((await x.call('runs',undefined,{Origin:'https://evil.example'})).status).toBe(403);
 expect((await x.call('commands',x.create(),{'X-CSRF-Token':''})).status).toBe(403);
 expect((await fetch(x.p.origin+'/api/v1/session',{method:'POST',headers:{Origin:x.p.origin},body:JSON.stringify({token:'invalid'})})).status).toBe(401);
 expect((await fetch(x.p.origin+'/src/panel.ts')).status).toBe(404);
 expect((await fetch(x.p.origin+'/')).headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
 // Opening the page from another app or extension shows the panel; the API stays same-site only.
 expect((await fetch(x.p.origin+'/',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}})).status).toBe(200);
 expect((await x.call('runs',undefined,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'})).status).toBe(403);
 expect((await fetch(x.p.origin+'/',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors'}})).status).toBe(403);
 const oldToken=new URL(x.p.url).hash.slice(7),freshToken=new URL(x.p.reopenUrl()).hash.slice(7);expect(freshToken).not.toBe(oldToken);expect((await x.call('health')).status).toBe(200);const exchange=(token:string)=>fetch(x.p.origin+'/api/v1/session',{method:'POST',headers:{Origin:x.p.origin},body:JSON.stringify({token})});expect((await exchange(oldToken)).status).toBe(401);expect((await exchange(freshToken)).status).toBe(200);expect((await exchange(freshToken)).status).toBe(401);
 expect((await x.call('participants')).status).toBe(200);expect(await (await x.call('runs')).json()).toEqual([]);
 const huge='x'.repeat(262145);expect((await fetch(x.p.origin+'/api/v1/commands',{method:'POST',headers:{Cookie:x.cookie,Origin:x.p.origin,'X-CSRF-Token':x.csrf},body:huge})).status).toBe(409);
 }finally{await x.close();}});


test('panel commands reject changed IDs and old receivers, and keep unfinished applications across restart',async()=>{const x=await fixture();try{
 const input=x.create();const q=new PanelCommands(x.f.state);q.enqueue(input);
 expect(()=>q.enqueue({...input,command:{...input.command,context:{...input.command.context,objective:'different'}}})).toThrow('reused');
 const db=new Database(join(x.f.state,'panel.sqlite'));db.run("UPDATE panel_commands SET owner=? WHERE id=?",[randomUUID(),input.commandId]);
 db.run("UPDATE panel_commands SET owner=?,state='applying' WHERE id=?",[input.ownerThread,input.commandId]);
 q.close();const restarted=new PanelCommands(x.f.state);expect(restarted.get(input.commandId)!.state).toBe('applying');restarted.close();db.close();
 const receiver=new Database(join(x.f.state,x.f.desktop.threadId+'.sqlite'));receiver.run("DELETE FROM receiver_capabilities WHERE capability='panel_commands_v1'");receiver.close();
 expect((await x.call('preflight',x.create())).status).toBe(409);expect(x.f.desktop.submissions).toHaveLength(0);
 }finally{await x.close();}});

test('lost native ACK keeps a single wake and reconciles only the exact persisted client input',async()=>{const x=await fixture(true);try{
 const data=x.create();expect((await x.call('commands',data)).status).toBe(202);await until(()=>x.p.commands.get(data.commandId)?.state==='unknown');
 expect(x.f.desktop.submissions).toHaveLength(1);await x.call('commands',data);expect(x.f.desktop.submissions).toHaveLength(1);
 x.f.desktop.setHistory({turns:[{turnId:randomUUID(),items:[{type:'userMessage',id:randomUUID(),clientId:randomUUID()}]}]});await x.p.reconcileCommand(data.commandId);expect(x.p.commands.get(data.commandId)!.state).toBe('unknown');
 const exact=x.p.commands.get(data.commandId)!.input_id;x.f.desktop.setHistory({turns:[{turnId:randomUUID(),items:[{type:'userMessage',id:randomUUID(),clientId:exact}]}]});await x.p.reconcileCommand(data.commandId);expect(x.p.commands.get(data.commandId)!.state).toBe('notified');expect(x.f.desktop.submissions).toHaveLength(1);
 }finally{await x.close();}});

test('interrupted applications are visible but not replayable; a live worker is not reclaimed',async()=>{const x=await fixture();try{
 const input=x.create();x.p.commands.enqueue(input);const db=new Database(join(x.f.state,'panel.sqlite'));db.run("UPDATE panel_commands SET state='applying',processor_pid=?,processor_start=? WHERE id=?",[process.pid,await (await import('../src/claude')).processStart(process.pid),input.commandId]);
 await x.p.commands.inspectApplications();expect(x.p.commands.get(input.commandId)!.state).toBe('applying');
 db.run('UPDATE panel_commands SET processor_pid=? WHERE id=?',[2147483647,input.commandId]);await x.p.commands.inspectApplications();expect(x.p.commands.get(input.commandId)!.state).toBe('application_uncertain');
 expect((await (await x.call('commands')).json() as {state:string}[])[0]!.state).toBe('application_uncertain');expect(x.f.desktop.submissions).toHaveLength(0);db.close();
 }finally{await x.close();}});


test('two local panels use separate cookie names and survive parallel browser sessions',async()=>{const x=await fixture();const other=startPanel({configDir:x.f.config,stateDir:x.f.state,codexHome:x.f.root,pluginRoot:root,ipcPath:x.f.desktop.path});try{
 const auth=await fetch(other.origin+'/api/v1/session',{method:'POST',headers:{Origin:other.origin},body:JSON.stringify({token:new URL(other.url).hash.slice(7)})});expect(auth.status).toBe(200);const second=auth.headers.get('set-cookie')!.split(';')[0]!;
 expect(second.split('=')[0]).not.toBe(x.cookie.split('=')[0]);const combined=x.cookie+'; '+second;
 expect((await x.call('health',undefined,{Cookie:combined})).status).toBe(200);expect((await fetch(other.origin+'/api/v1/health',{headers:{Cookie:combined}})).status).toBe(200);
 expect((await fetch(other.origin+'/api/v1/health',{headers:{Cookie:x.cookie}})).status).toBe(401);
 }finally{await other.close();await x.close();}});

test('human project authorization API is scoped, authenticated, confirmed, versioned and revocable without rewriting chat policy',async()=>{
 const x=await fixture(false,'default');try {
  const path='project-authorization?'+new URLSearchParams({ownerThread:x.f.desktop.threadId,project:x.f.root});
  expect((await fetch(x.p.origin+'/api/v1/'+path)).status).toBe(401);
  const state=await (await x.call(path)).json() as {enabled:boolean;revision:number;chatPolicy:string;receiverSupported:boolean};expect(state.enabled).toBe(false);expect(state.chatPolicy).toBe('default');expect(state.receiverSupported).toBe(true);
  const change={project:x.f.root,ownerThread:x.f.desktop.threadId,actionId:randomUUID(),enabled:true,expectedRevision:0,confirmed:true};
  expect((await x.call('project-authorization',change,{'X-CSRF-Token':''})).status).toBe(403);
  expect((await x.call('project-authorization',change,{Origin:'https://evil.example'})).status).toBe(403);
  expect((await x.call('project-authorization',{...change,confirmed:false})).status).toBe(409);
  expect((await x.call('project-authorization',{...change,project:join(x.f.root,'s')})).status).toBe(409);
  expect((await x.call('project-authorization',{...change,ownerThread:randomUUID()})).status).toBe(409);
  expect((await x.call('project-authorization',change)).status).toBe(200);expect((await (await x.call('project-authorization',change)).json() as {reused:boolean}).reused).toBe(true);
  expect(x.f.bridge.policy()).toBe('default');expect(x.f.desktop.submissions).toHaveLength(0);
  expect((await x.call('project-authorization',{...change,actionId:randomUUID()})).status).toBe(409);
  expect((await (await x.call('project-authorization',{...change,actionId:randomUUID(),enabled:false,expectedRevision:1})).json() as {enabled:boolean}).enabled).toBe(false);
  expect((await (await x.call('project-authorization',change)).json() as {enabled:boolean}).enabled).toBe(false);
  const db=new Database(join(x.f.state,x.f.desktop.threadId+'.sqlite'));db.run("DELETE FROM receiver_capabilities WHERE capability='project_authorization_v1'");db.close();
  expect((await x.call('project-authorization',{...change,actionId:randomUUID(),expectedRevision:2})).status).toBe(409);
  expect((await (await x.call(path)).json() as {receiverSupported:boolean}).receiverSupported).toBe(false);
 }finally{await x.close();}
});
