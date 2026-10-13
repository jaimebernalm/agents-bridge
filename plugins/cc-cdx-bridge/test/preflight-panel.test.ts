import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {nativeFixture} from './collaboration-fixture';
import {ProjectAuthorizations} from '../src/project-authorization';
import {startPanel} from '../src/panel';
import {receptionPreflight} from '../src/preflight';
import {PanelOpening,panelLink} from '../src/panel-opening';
import {serializedRefresh,independentRefresh,panelNavigation} from '../ui/src/lib/live-refresh';

const root=resolve(import.meta.dir,'..');
function grant(f:Awaited<ReturnType<typeof nativeFixture>>,enabled=true,project=f.root) {
  const store=new ProjectAuthorizations(f.state);
  try {return store.change({project,ownerThread:f.desktop.threadId,actionId:randomUUID(),enabled,expectedRevision:store.status(project).revision,confirmed:true});}
  finally {store.close();}
}
async function check(f:Awaited<ReturnType<typeof nativeFixture>>) {
  return receptionPreflight({configDir:f.config,stateDir:f.state,ipcPath:f.desktop.path},f.desktop.threadId,f.peerId);
}
test('default reception asks for the project authorization and a remembered project makes the chat ready',async()=>{
 const f=await nativeFixture(false,{reception:'default'});try {
  const blocked=await check(f);expect(blocked.readyForCheck).toBe(false);expect(blocked.code).toBe('reception_authorization_required');
  grant(f);const ready=await check(f);expect(ready.readyForCheck).toBe(true);expect(ready.roundTripVerified).toBe(false);expect(ready.effectiveClaudeInbound).toBe('unknown');expect(f.bridge.policy()).toBe('default');
  grant(f,false);expect((await check(f)).readyForCheck).toBe(false);
  expect(f.frames).toHaveLength(0);expect(f.desktop.submissions).toHaveLength(0);
 }finally{await f.close();}
});
for(const policy of ['hold','refuse'] as const)test(`remembered project cannot override explicit ${policy} at preflight`,async()=>{
 const f=await nativeFixture();try{grant(f);await f.bridge.setPolicy(policy);const result=await check(f);expect(result.readyForCheck).toBe(false);expect(result.code).toBe('explicit_reception_block');expect(f.bridge.policy()).toBe(policy);expect(f.frames).toHaveLength(0);}finally{await f.close();}
});
test('another folder grant and an old receiver do not enable inherited reception',async()=>{
 const f=await nativeFixture(false,{reception:'default'});try{
  const other=join(f.root,'other');mkdirSync(other);grant(f,true,other);
  expect((await check(f)).readyForCheck).toBe(false);
  grant(f);const db=new Database(join(f.state,f.desktop.threadId+'.sqlite'));db.run("DELETE FROM receiver_capabilities WHERE capability='project_authorization_v1'");db.close();
  const result=await check(f);expect(result.readyForCheck).toBe(false);expect(result.projectRemembered).toBe(true);expect(result.receiverSupported).toBe(false);
 }finally{await f.close();}
});
test('observed Claude restrictions stop the check without editing Claude settings',async()=>{
 const f=await nativeFixture();try{const path=join(f.config,'settings.json'),settings=JSON.stringify({crossSessionInbound:'refuse'});writeFileSync(path,settings,{mode:0o600});expect((await check(f)).code).toBe('claude_reception_restricted');expect(await Bun.file(path).text()).toBe(settings);expect(f.frames).toHaveLength(0);}finally{await f.close();}
});
test('panel preflight and command submission stop before waking an unauthorized chat',async()=>{
 const f=await nativeFixture(false,{reception:'default'}),p=startPanel({configDir:f.config,stateDir:f.state,codexHome:f.root,ipcPath:f.desktop.path,pluginRoot:root});try{
  const session=await fetch(p.origin+'/api/v1/session',{method:'POST',headers:{Origin:p.origin},body:JSON.stringify({token:new URL(p.url).hash.slice(7)})});const {csrf}=await session.json() as {csrf:string};const cookie=session.headers.get('set-cookie')!.split(';')[0]!;
  const request={commandId:randomUUID(),ownerThread:f.desktop.threadId,project:f.root,command:{action:'create',peerId:f.peerId,context:{objective:'Read only'},routine:{mode:'free'},coordination:{initialBarrier:false},limits:{maxMessages:8,maxSeconds:300}}};
  for(const path of ['preflight','commands']){const response=await fetch(p.origin+'/api/v1/'+path,{method:'POST',headers:{Origin:p.origin,Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify(request)});expect(response.status).toBe(409);expect((await response.json() as {preflight:{code:string}}).preflight.code).toBe('reception_authorization_required');}
  expect(p.commands.list()).toHaveLength(0);expect(f.desktop.submissions).toHaveLength(0);
 }finally{await p.close();await f.close();}
});
test('panel launch dispatch is once per action; failure retains a usable deep link',async()=>{
 const auto=process.env.CC_CDX_PANEL_AUTO_OPEN;delete process.env.CC_CDX_PANEL_AUTO_OPEN;try{
 const launches:string[]=[];const opening=new PanelOpening(async url=>{launches.push(url)});const url=panelLink('http://127.0.0.1:1234/#token=private',{runId:randomUUID()});
 await Promise.all([opening.open('start',url),opening.open('start',url)]);expect(launches).toHaveLength(1);expect(new URL(url).hash).toContain('run=');expect(new URL(url).hash).toContain('token=private');
 expect(await opening.open('no-open',url,false)).toEqual({requested:false});expect(launches).toHaveLength(1);
 await opening.open('start',url,true,true);expect(launches).toHaveLength(2);
 const failed=new PanelOpening(async()=>{throw new Error('No browser')});expect((await failed.open('start',url)).requested).toBe(false);const thrown=new PanelOpening(()=>{throw new Error('Only the private local panel can be opened')});expect(await thrown.open('sync',url)).toEqual({requested:false,error:'No se pudo abrir el navegador. Abre el enlace privado del panel.'});
 }finally{auto===undefined?delete process.env.CC_CDX_PANEL_AUTO_OPEN:process.env.CC_CDX_PANEL_AUTO_OPEN=auto}
});
test('refresh publishes the current detail even when another section is slow or fails',async()=>{
 const seen:string[]=[];let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
 const loader=independentRefresh([async()=>{await pending;throw new Error('command unavailable')},async()=>{seen.push('completed')}]);
 const refresh=loader.request();await Bun.sleep(0);expect(seen).toEqual(['completed']);release();await refresh;expect(seen).toEqual(['completed']);loader.stop();
});
test('SSE/timer/focus requests coalesce without concurrent snapshots; stop prevents new work',async()=>{
 let calls=0,active=0,max=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
 const loader=serializedRefresh(async()=>{calls++;active++;max=Math.max(max,active);if(calls===1)await pending;active--});
 const first=loader.request();void loader.request();void loader.request();expect(calls).toBe(1);release();await first;expect(calls).toBe(2);expect(max).toBe(1);loader.stop();await loader.request();expect(calls).toBe(2);
});
test('a stalled command section does not delay subsequent live detail refreshes',async()=>{
 let details=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
 const loader=independentRefresh([async()=>{await pending},async()=>{details++}]);
 const first=loader.request();await Bun.sleep(0);expect(details).toBe(1);
 const second=loader.request();await Bun.sleep(0);expect(details).toBe(2);
 release();await Promise.all([first,second]);loader.stop();
});
test('deep links select the exact run or authorization and never mistake a token for an identity',()=>{
 const id=randomUUID();expect(panelNavigation('#token=private&run='+id)).toEqual({selected:id,view:'desktop'});expect(panelNavigation('#token=private')).toEqual({selected:'',view:'desktop'});expect(panelNavigation('#token=private&view=authorization&run='+id).view).toBe('authorization');expect(panelNavigation('#run=not-a-uuid').selected).toBe('');
});
