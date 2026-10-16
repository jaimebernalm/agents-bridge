import {desktopPanelRoutes,type DesktopPanelAdapter} from './desktop-panel';
import { Database } from 'bun:sqlite';
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { discoverParticipants, inspectParticipant, type ParticipantOptions } from './participants';
import { doctor } from './doctor';
import { version } from './version';
import { displayName } from './names';
import { ProjectAuthorizations, authorizationIdentitySchema, authorizationChangeSchema } from './project-authorization';
import { readPanelPreferences, savePanelPreferences, withPanelPreferences } from './panel-preferences';

const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
type Options=ParticipantOptions&{codexHome:string;pluginRoot:string;ownerThread?:string;ownerProvider?:'codex'|'claude';desktop?:DesktopPanelAdapter;port?:number;onOpenRequest?:()=>Promise<boolean>};
const openingPages={
  en:{opened:'The bridge panel opens in its own window. This tab closes by itself.',failed:'The panel window did not open. Ask in your chat to open the bridge panel.',stale:'This link is from an earlier session of the bridge. Ask in your chat to open the bridge panel.'},
  es:{opened:'El panel del bridge se abre en su propia ventana. Esta pestaña se cierra sola.',failed:'No se ha podido abrir la ventana del panel. Pide en tu chat que abra el panel del bridge.',stale:'Este enlace es de una sesión anterior del bridge. Pide en tu chat que abra el panel del bridge.'},
};
// Once the window is asked for, the tab that carried the link closes itself: a tab the link opened has nothing else in
// its history, which is what lets a page close it.
const openingPage=(language:'en'|'es',state:keyof typeof openingPages.en,nonce:string)=>`<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${displayName}</title><body style="font:16px/1.5 system-ui,sans-serif;margin:48px auto;max-width:36em;padding:0 16px"><p>${openingPages[language][state]}</p>${state==='opened'?`<script nonce="${nonce}">setTimeout(()=>window.close(),700)</script>`:''}</body></html>`;
export function startPanel(options:Options){
  const authorizations=new ProjectAuthorizations(options.stateDir);
  let token=randomBytes(32).toString('hex');const session=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  const desktop=options.desktop?desktopPanelRoutes(options,options.desktop,randomBytes(16).toString('hex')):undefined;let exchanged=false,sessionEstablished=false,closed=false,lastOpen:{at:number;opened:Promise<boolean>}|undefined;
  // The key in the link that opens the panel window. It opens only that window, never acts in the panel, so it may
  // sit in the chat and in a page the person opens from a file; it only keeps other pages from opening it.
  const openKey=randomBytes(16).toString('hex');
  const assetRoot=resolve(options.pluginRoot,'panel-dist');
  const headers={ 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
  const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...headers,...extra}});
  const authorizationIdentity=async(raw:unknown)=>{
    const input=authorizationIdentitySchema.parse(raw);
    if(options.ownerThread&&input.ownerThread!==options.ownerThread)throw new Error('Wrong conversation for this panel');
    const codex=await inspectParticipant(options,input.ownerThread,'codex');
    if(codex.project.directory!==realpathSync(input.project))throw new Error('Selected conversation project changed');
    const selected=(await discoverParticipants(options.configDir,options.stateDir)).find(p=>p.sessionId===input.ownerThread);
    const db=new Database(join(options.stateDir,input.ownerThread+'.sqlite'),{readonly:true});
    try {const policy=db.query<{policy:string},[]>('SELECT policy FROM inbound_policy WHERE singleton=1').get()?.policy;
      return {input,project:codex.project.directory,chatPolicy:policy??'default',receiverSupported:selected?.projectAuthorizationReceiver===true};
    }finally{db.close();}
  };
  const body=async(req:Request)=>{const reader=req.body?.getReader();if(!reader)throw new Error('Missing body');let size=0;const chunks:Uint8Array[]=[];
    while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>262144){await reader.cancel();throw new Error('Request body exceeds limit');}chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));};
  const server=Bun.serve({hostname:'127.0.0.1',port:options.port??0,idleTimeout:0,
    async fetch(req):Promise<Response>{const url=new URL(req.url),origin=`http://127.0.0.1:${server.port}`,cookieName=`agents_bridge_panel_${server.port}`;
      if(req.headers.get('host')!==`127.0.0.1:${server.port}`||url.origin!==origin)return json({error:'Invalid Host'},403);
      // The link an agent leaves in the chat, and the card page that calls it on its own: it carries no panel credential and
      // only asks this bridge to show its own panel window to the person, so following it, even by the agent, can open the
      // panel but never act in it. Its key is what lets a page opened from a file, which has no origin, call it.
      if(url.pathname==='/open'&&req.method==='GET'){
        const nonce=randomBytes(16).toString('base64'),page=(state:keyof typeof openingPages.en,status:number)=>new Response(openingPage(readPanelPreferences(options.stateDir).language,state,nonce),{status,headers:{...headers,'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`,'Content-Type':'text/html;charset=utf-8'}});
        if(!equal(url.searchParams.get('k')??'',openKey))return page('stale',404);
        if(!options.onOpenRequest)return page('failed',503);
        if(!lastOpen||Date.now()-lastOpen.at>2000)lastOpen={at:Date.now(),opened:options.onOpenRequest().catch(()=>false)};
        return await lastOpen.opened?page('opened',200):page('failed',503);
      }
      const requestOrigin=req.headers.get('origin');if(requestOrigin&&requestOrigin!==origin)return json({error:'Invalid Origin'},403);
      // A top-level navigation to the page itself (e.g. from a browser extension or another app) is harmless:
      // the API below still rejects cross-site requests and the Strict session cookie is never sent cross-site.
      const pageNavigation=req.method==='GET'&&!url.pathname.startsWith('/api/')&&req.headers.get('sec-fetch-mode')==='navigate';
      if(req.headers.get('sec-fetch-site')==='cross-site'&&!pageNavigation)return json({error:'Cross-site request rejected'},403);
      try{
        if(url.pathname==='/api/v1/session'&&req.method==='POST'){
          if(requestOrigin!==origin)return json({error:'Session requires same origin'},403);
          const supplied=z.object({token:z.string().max(128)}).strict().parse(await body(req)).token;
          if(exchanged)return json({error:'Access token already exchanged; reopen the panel'},401);
          if(!equal(supplied,token))return json({error:'Invalid access token'},401);exchanged=true;sessionEstablished=true;
          return json({csrf,ownerThread:options.ownerThread??null},200,{'Set-Cookie':`${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`});
        }
        if(url.pathname.startsWith('/api/')){
          const cookie=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)??'';
          if(!sessionEstablished||!equal(cookie,session))return json({error:'Open the private panel link to connect'},401);
          if(req.method!=='GET'&&(requestOrigin!==origin||!equal(req.headers.get('x-csrf-token')??'',csrf)))return json({error:'Invalid CSRF token'},403);
          if(url.pathname==='/api/v1/health'&&req.method==='GET')return json({version,csrf,ownerThread:options.ownerThread??null,ownerProvider:options.ownerProvider??'codex',desktop:!!desktop});
          if(url.pathname.startsWith('/api/v1/desktop/')&&desktop)return json(await desktop.handle(url.pathname.slice('/api/v1/desktop/'.length),req.method,()=>body(req)));
          if(url.pathname==='/api/v1/preferences'&&req.method==='POST')return json(savePanelPreferences(options.stateDir,await body(req)));
          if(url.pathname==='/api/v1/participants'&&req.method==='GET')return json(await discoverParticipants(options.configDir,options.stateDir));
          if(url.pathname==='/api/v1/project-authorization'&&req.method==='GET'){
            const id=await authorizationIdentity({ownerThread:url.searchParams.get('ownerThread'),project:url.searchParams.get('project')});
            return json({...authorizations.status(id.project),chatPolicy:id.chatPolicy,receiverSupported:id.receiverSupported});
          }
          if(url.pathname==='/api/v1/project-authorization'&&req.method==='POST'){
            const change=authorizationChangeSchema.parse(await body(req));
            const id=await authorizationIdentity({ownerThread:change.ownerThread,project:change.project});
            if(change.enabled&&!id.receiverSupported)throw new Error('Reload this chat receiver before remembering project authorization');
            return json({...authorizations.change({...change,project:id.project}),chatPolicy:id.chatPolicy,receiverSupported:id.receiverSupported});
          }
          if(url.pathname==='/api/v1/diagnostic'&&req.method==='POST'){
            const input=z.object({ownerThread:z.string().uuid(),project:z.string().min(1),peerId:z.string().uuid().optional()}).strict().parse(await body(req));
            if(options.ownerThread&&options.ownerThread!==input.ownerThread)throw new Error('Wrong conversation');
            const report=await doctor({project:input.project,threadId:input.ownerThread,peerId:input.peerId,configDir:options.configDir,codexHome:options.codexHome,pluginRoot:options.pluginRoot});
            return json({state:report.state,checks:report.checks.map(c=>({code:c.code,level:c.level,message:c.code==='runtime'?`Bun ${Bun.version}; distribution ${version}`:c.message,remedy:c.remedy})),settingsModified:false,messagesSent:false});
          }
          return json({error:'Unknown API route'},404);
        }
        if(req.method!=='GET')return json({error:'Method not allowed'},405);
        const relative=url.pathname==='/'?'index.html':url.pathname.slice(1);
        if(relative!=='index.html'&&!/^assets\/[\w.-]+\.(js|css|woff2)$/.test(relative))return json({error:'Unknown asset'},404);
        const file=join(assetRoot,relative);if(!existsSync(file))return json({error:'Panel assets missing; build the UI'},503);
        if(relative==='index.html')return new Response(withPanelPreferences(await Bun.file(file).text(),readPanelPreferences(options.stateDir)),{headers:{...headers,'Content-Type':'text/html;charset=utf-8'}});
        return new Response(Bun.file(file),{headers:{...headers,'Cache-Control':'public, max-age=31536000, immutable'}});
      }catch(error){return json({error:error instanceof Error?error.message:'Panel request failed'},409);}
    }});
  return {get url(){return `http://127.0.0.1:${server.port}/#token=${token}`;},openUrl:`http://127.0.0.1:${server.port}/open?k=${openKey}`,reopenUrl(){if(closed)throw new Error('Panel closed');token=randomBytes(32).toString('hex');exchanged=false;return `http://127.0.0.1:${server.port}/#token=${token}`;},origin:`http://127.0.0.1:${server.port}`,
    async close(){if(closed)return;closed=true;await server.stop(true);desktop?.close();authorizations.close();}};
}
