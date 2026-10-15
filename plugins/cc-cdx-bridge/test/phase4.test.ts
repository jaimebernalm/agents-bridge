import {test,expect} from 'bun:test';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startPanel} from '../src/panel';
import {panelPlaceFromCookie,readPanelPlace} from '../src/panel-preferences';
import {nativeFixture} from './collaboration-fixture';
import {Database} from 'bun:sqlite';
import {statSync,writeFileSync} from 'node:fs';
const root=resolve(import.meta.dir,'..');
async function fixture(dropAcknowledgement=false,reception:'accept'|'default'='accept'){const f=await nativeFixture(dropAcknowledgement,{reception});const p=startPanel({configDir:f.config,stateDir:f.state,codexHome:f.root,pluginRoot:root,ipcPath:f.desktop.path});
 const token=new URL(p.url).hash.slice(7);const auth=await fetch(p.origin+'/api/v1/session',{method:'POST',headers:{Origin:p.origin,'Content-Type':'application/json'},body:JSON.stringify({token})});expect(auth.status).toBe(200);
 const {csrf}=await auth.json() as {csrf:string};const cookie=auth.headers.get('set-cookie')!.split(';')[0]!;
 const call=(path:string,body?:unknown,headers:Record<string,string>={})=>fetch(p.origin+'/api/v1/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:p.origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {f,p,call,cookie,csrf,async close(){await p.close();await f.close();}};
}
test('panel guards tokens, Origin, CSRF, paths and body size; earlier routes are gone',async()=>{const x=await fixture();try{
 expect((await fetch(x.p.origin+'/api/v1/participants')).status).toBe(401);
 expect((await x.call('participants',undefined,{Origin:'https://evil.example'})).status).toBe(403);
 expect((await x.call('diagnostic',{ownerThread:x.f.desktop.threadId,project:x.f.root},{'X-CSRF-Token':''})).status).toBe(403);
 expect((await fetch(x.p.origin+'/api/v1/session',{method:'POST',headers:{Origin:x.p.origin},body:JSON.stringify({token:'invalid'})})).status).toBe(401);
 expect((await fetch(x.p.origin+'/src/panel.ts')).status).toBe(404);
 expect((await fetch(x.p.origin+'/')).headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
 // Opening the page from another app or extension shows the panel; the API stays same-site only.
 expect((await fetch(x.p.origin+'/',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}})).status).toBe(200);
 expect((await x.call('participants',undefined,{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'})).status).toBe(403);
 expect((await fetch(x.p.origin+'/',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors'}})).status).toBe(403);
 const oldToken=new URL(x.p.url).hash.slice(7),freshToken=new URL(x.p.reopenUrl()).hash.slice(7);expect(freshToken).not.toBe(oldToken);expect((await x.call('health')).status).toBe(200);const exchange=(token:string)=>fetch(x.p.origin+'/api/v1/session',{method:'POST',headers:{Origin:x.p.origin},body:JSON.stringify({token})});expect((await exchange(oldToken)).status).toBe(401);expect((await exchange(freshToken)).status).toBe(200);expect((await exchange(freshToken)).status).toBe(401);
 expect((await x.call('participants')).status).toBe(200);
 for(const route of ['runs','commands','presets'])expect((await x.call(route)).status).toBe(404);
 const huge='x'.repeat(262145);expect((await fetch(x.p.origin+'/api/v1/diagnostic',{method:'POST',headers:{Cookie:x.cookie,Origin:x.p.origin,'X-CSRF-Token':x.csrf},body:huge})).status).toBe(409);
 }finally{await x.close();}});






test('two local panels use separate cookie names and survive parallel browser sessions',async()=>{const x=await fixture();const other=startPanel({configDir:x.f.config,stateDir:x.f.state,codexHome:x.f.root,pluginRoot:root,ipcPath:x.f.desktop.path});try{
 const auth=await fetch(other.origin+'/api/v1/session',{method:'POST',headers:{Origin:other.origin},body:JSON.stringify({token:new URL(other.url).hash.slice(7)})});expect(auth.status).toBe(200);const second=auth.headers.get('set-cookie')!.split(';')[0]!;
 expect(second.split('=')[0]).not.toBe(x.cookie.split('=')[0]);const combined=x.cookie+'; '+second;
 expect((await x.call('health',undefined,{Cookie:combined})).status).toBe(200);expect((await fetch(other.origin+'/api/v1/health',{headers:{Cookie:combined}})).status).toBe(200);
 expect((await fetch(other.origin+'/api/v1/health',{headers:{Cookie:x.cookie}})).status).toBe(401);
 }finally{await other.close();await x.close();}});

test('language and theme are saved for this computer, so every panel opens with them from its first frame',async()=>{const x=await fixture();const other=startPanel({configDir:x.f.config,stateDir:x.f.state,codexHome:x.f.root,pluginRoot:root,ipcPath:x.f.desktop.path});try{
 const page=async(origin:string)=>(await (await fetch(origin+'/')).text()).match(/<html[^>]*>/)![0];
 expect(await page(x.p.origin)).toBe('<html lang="en">');
 expect((await fetch(x.p.origin+'/api/v1/preferences',{method:'POST',headers:{Origin:x.p.origin,'Content-Type':'application/json'},body:'{"theme":"dark"}'})).status).toBe(401);
 expect((await x.call('preferences',{theme:'dark'},{'X-CSRF-Token':''})).status).toBe(403);
 expect(await (await x.call('preferences',{theme:'dark'})).json()).toEqual({language:'en',theme:'dark'});
 expect(await (await x.call('preferences',{language:'es'})).json()).toEqual({language:'es',theme:'dark'});
 for(const invalid of [{language:'fr'},{theme:'blue'},{other:true}])expect((await x.call('preferences',invalid)).status).toBe(409);
 const file=join(x.f.state,'panel-preferences.json');expect(statSync(file).mode&0o077).toBe(0);
 expect(await page(x.p.origin)).toBe('<html lang="es" class="dark">');expect(await page(other.origin)).toBe('<html lang="es" class="dark">');
 writeFileSync(file,'{broken');expect(await page(other.origin)).toBe('<html lang="en">');
 }finally{await other.close();await x.close();}});

test('the panel window\'s place is remembered from the page\'s cookie, so the next window opens there',async()=>{const x=await fixture();try{
 expect(readPanelPlace(x.f.state)).toBeUndefined();
 await fetch(x.p.origin+'/',{headers:{Cookie:'other=1; cc_cdx_panel_window=2690_-218_845_651'}});
 expect(readPanelPlace(x.f.state)).toEqual({x:2690,y:-218,w:845,h:651});expect(statSync(join(x.f.state,'panel-window.json')).mode&0o077).toBe(0);
 // Malformed or implausible values never replace a good place.
 for(const bad of ['cc_cdx_panel_window=1_2_3','cc_cdx_panel_window=1_2_50_50','cc_cdx_panel_window=a_b_c_d','xcc_cdx_panel_window=1_2_900_900'])await fetch(x.p.origin+'/',{headers:{Cookie:bad}});
 expect(readPanelPlace(x.f.state)).toEqual({x:2690,y:-218,w:845,h:651});
 expect(panelPlaceFromCookie('cc_cdx_panel_window=10_20_900_700')).toEqual({x:10,y:20,w:900,h:700});
 }finally{await x.close();}});

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
