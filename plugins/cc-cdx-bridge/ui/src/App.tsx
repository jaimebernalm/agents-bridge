import {DesktopCollaboration} from './DesktopCollaboration';
import {t, getLanguage, useLanguage} from './lib/i18n';
import {useCallback,useEffect,useRef,useState,useId} from 'react';
import {Check,Loader2,Moon,RefreshCw,Sun,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import {Label} from '@/components/ui/label';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {independentRefresh,panelNavigation,PanelOffline,offlineNotice} from './lib/live-refresh';
import {claimPanelWindow} from './lib/single-window';
import {hasDraft,trackDrafts} from './lib/drafts';
import {useCompact} from './lib/compact';
import {pagePreferences,remember,saveWith} from './lib/preferences';
import {brandName} from '../../src/names';

type Participant={sessionId:string;name:string;cwd:string;provider:'codex'|'claude';status:string;eligibleSurface:boolean;projectAuthorizationReceiver:boolean|null;implementationReceiver?:boolean|null};
// A name is a label, not an identity. Expand the suffix if homonyms share a prefix.
function participantLabel(p:Participant,participants:Participant[]){
 const homonyms=participants.filter(other=>other.provider===p.provider&&other.name===p.name&&other.sessionId!==p.sessionId);
 if(!homonyms.length)return p.name;
 let length=Math.min(8,p.sessionId.length);
 while(length<p.sessionId.length&&homonyms.some(other=>other.sessionId.slice(0,length)===p.sessionId.slice(0,length)))length++;
 return `${p.name} · ${p.sessionId.slice(0,length)}`;
}
const date=(time:number)=>new Intl.DateTimeFormat(getLanguage(),{dateStyle:'medium',timeStyle:'short'}).format(time);
let csrf='';
const initialNavigation=panelNavigation(location.hash);
async function api<T>(path:string,body?:unknown):Promise<T>{let response:Response;try{response=await fetch('/api/v1/'+path,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(18000),headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)})}catch{throw new PanelOffline(t(offlineNotice))}if(!response.ok){const err=await response.json().catch(()=>({error:t("No se pudo conectar")}));throw new Error(t(err.error))}return response.json()}
saveWith(change=>api('preferences',change));
function Field({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}){return <div className="space-y-2"><Label>{label}</Label>{children}{hint&&<p className="text-xs text-muted-foreground">{hint}</p>}</div>}
function LanguageSelector(){
 const [language,setLanguage]=useLanguage();
 return <div className="space-y-2"><Label htmlFor="panel-language">{t('Idioma')}</Label><NativeSelect id="panel-language" aria-label={t('Idioma')} className="w-full" value={language} onChange={e=>setLanguage(e.target.value==='es'?'es':'en')}><NativeSelectOption value="en" lang="en">English</NativeSelectOption><NativeSelectOption value="es" lang="es">Español</NativeSelectOption></NativeSelect></div>;
}
// Shown when a newer window of this panel took over and the browser kept this one open.
export function ReplacedWindow(){
 return <main className="mx-auto max-w-lg p-10"><Mark className="mb-6 size-10"/><h1 className="text-2xl font-semibold">{t("Este panel se abrió en otra ventana.")}</h1><p className="mt-3 text-muted-foreground">{t("Puedes cerrar esta. La otra muestra lo mismo y sigue al día.")}</p><Button className="mt-6" variant="outline" onClick={()=>location.reload()}>{t("Usar esta ventana")}</Button></main>;
}
// The Agents Bridge mark, as on the landing page: an orange conversation cut by one in the current text color.
function Mark({className}:{className?:string}){
 const id=useId();
 return <svg viewBox="4 4 24 24" className={className} aria-hidden="true"><mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"/><path d="M14 25h9a3 3 0 0 0 3-3V13.5l-2.5 2.5h-9.5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3Z" stroke="#000" strokeWidth="5.5" strokeLinejoin="round"/></mask><path d="M18 7H9a3 3 0 0 0-3 3v10l4-4h8a3 3 0 0 0 3-3v-3a3 3 0 0 0-3-3Z" fill="none" stroke="#ff7a3d" strokeWidth="2.5" strokeLinejoin="round" mask={`url(#${id})`}/><path d="M14 25h9a3 3 0 0 0 3-3V13.5l-2.5 2.5h-9.5a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/></svg>;
}

export default function App({onReplaced}:{onReplaced?:()=>void}){
 const [language,setLanguage]=useLanguage(),compact=useCompact();
 useEffect(()=>{document.documentElement.lang=language;document.title=brandName+' · '+t('Colaboraciones')},[language]);
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[view,setView]=useState<'diagnostic'|'authorization'|'desktop'>(initialNavigation.view),[bound,setBound]=useState<string|null>(null),[participants,setParticipants]=useState<Participant[]>([]),[connected,setConnected]=useState(false),[dark,setDark]=useState(()=>pagePreferences(document.documentElement).theme==='dark');
 const [desktop,setDesktop]=useState(false),[ownerProvider,setOwnerProvider]=useState('codex');const [serviceVersion,setServiceVersion]=useState('');const [lastUpdated,setLastUpdated]=useState<number|null>(null),[sectionErrors,setSectionErrors]=useState<Record<string,string>>({});const refreshErrors=[...new Set(Object.values(sectionErrors))],refreshError=refreshErrors.map(e=>t(e)).join(' ');
 useEffect(()=>{document.documentElement.classList.toggle('dark',dark)},[dark]);
 const toggleTheme=()=>{const root=document.documentElement;root.classList.add('theme-transition');setDark(!dark);remember({theme:dark?'light':'dark'});setTimeout(()=>root.classList.remove('theme-transition'),300)};
 useEffect(()=>{(async()=>{try{const token=new URLSearchParams(location.hash.slice(1)).get('token');let spent:unknown;if(token){/* A spent link still opens in the browser that already holds this panel's session. */try{const auth=await api<{csrf:string;ownerThread:string|null}>('session',{token});csrf=auth.csrf;setBound(auth.ownerThread)}catch(e){spent=e}const route=new URLSearchParams(location.hash.slice(1));route.delete('token');history.replaceState(null,'',location.pathname+(route.size?'#'+route.toString():''));}const health=await api<{csrf:string;ownerThread:string|null;version:string;ownerProvider?:string;desktop?:boolean}>('health').catch(e=>{throw spent??e});csrf=health.csrf;setBound(health.ownerThread);setServiceVersion(health.version);setDesktop(health.desktop===true);setOwnerProvider(health.ownerProvider??'codex');if(!health.desktop&&initialNavigation.view==='desktop')setView('authorization');setReady(true)}catch(e){setError((e as Error).message)}})()},[]);
 const loader=useRef<{request:()=>Promise<void>}|null>(null);
 const load=useCallback(()=>loader.current?.request()??Promise.resolve(),[]);
 useEffect(()=>{if(!ready)return;
  const success=(key:string)=>setSectionErrors(previous=>{if(!previous[key])return previous;const next={...previous};delete next[key];return next});
  const section=(key:string,refresh:()=>Promise<void>)=>async()=>{try{await refresh();success(key)}catch(e){setSectionErrors(previous=>({...previous,[key]:e instanceof PanelOffline?offlineNotice:(e as Error).message}));setConnected(false)}};
  const worker=independentRefresh([
   section('participants',async()=>{setParticipants(await api<Participant[]>('participants'));setConnected(true);setLastUpdated(Date.now())}),
  ]);
  loader.current=worker;void worker.request();
  const timer=setInterval(()=>void worker.request(),2500);
  const resume=()=>{if(document.visibilityState==='visible')void worker.request()};
  window.addEventListener('focus',resume);window.addEventListener('online',resume);document.addEventListener('visibilitychange',resume);
  return()=>{worker.stop();clearInterval(timer);window.removeEventListener('focus',resume);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',resume);if(loader.current===worker)loader.current=null};
 },[ready]);
 // A newer window of this panel takes over. One holding unsent text stays and lets the person choose.
 const [superseded,setSuperseded]=useState(false);const windowClaim=useRef<ReturnType<typeof claimPanelWindow>|null>(null);
 useEffect(()=>trackDrafts(),[]);
 useEffect(()=>{if(!ready||!onReplaced)return;const claim=claimPanelWindow({hasDraft:()=>hasDraft(),onReplaced,onSuperseded:()=>setSuperseded(true)});windowClaim.current=claim;return()=>{claim.release();windowClaim.current=null}},[ready,onReplaced]);
 useEffect(()=>{const navigate=()=>setView(panelNavigation(location.hash).view);window.addEventListener('hashchange',navigate);return()=>window.removeEventListener('hashchange',navigate)},[]);

 if(!ready)return <main className="mx-auto max-w-lg p-10"><div className="mb-6"><LanguageSelector/></div><Mark className="mb-6 size-10"/><h1 className="text-2xl font-semibold">{t("Conectar al puente")}</h1><p className="mt-3 text-muted-foreground">{t("Este panel privado se abre desde tu chat. El acceso se limita a este servicio local.")}</p>{error?<><Alert className="mt-6"><AlertDescription>{t(error)}</AlertDescription></Alert><div className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm"><p className="font-medium">{t("Cómo entrar")}</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground"><li>{t("Vuelve a tu chat de Claude o Codex.")}</li><li>{t("Escribe: «abre el panel del puente».")}</li><li>{t("El panel se abrirá solo en tu navegador, ya conectado.")}</li></ol><p className="mt-3 text-xs text-muted-foreground">{t("Por seguridad, cada enlace funciona una sola vez y solo en el navegador donde se abrió. Copiar esta dirección en otra ventana no da acceso.")}</p></div></>:<Loader2 className="mt-6 animate-spin"/>}</main>;
 const tabs:[string,string,()=>void][]=[...(desktop?[['desktop',t("Colaboraciones"),()=>setView('desktop')] as [string,string,()=>void]]:[]),...(ownerProvider==='codex'?[['authorization',t("Autorización"),()=>setView('authorization')],['diagnostic',t("Diagnóstico"),()=>setView('diagnostic')]] as [string,string,()=>void][]:[])];
 const nav=tabs.length>1&&<nav className="flex flex-wrap gap-1">{tabs.map(([id,label,go])=><Button key={id} size="sm" variant={view===id?'secondary':'ghost'} onClick={go}>{label}</Button>)}</nav>;
 const controls=<div className="ml-auto flex items-center gap-1"><button className="pressable flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted" title={lastUpdated?t('Última actualización: {time}', {time:new Date(lastUpdated).toLocaleTimeString(getLanguage())})+' · v'+serviceVersion:t("Esperando datos actuales")} onClick={()=>void load()}><span className={`size-2 rounded-full ${connected?'bg-success':'bg-warning'}`}/>{connected?t("En directo"):t("Sin conexión")}</button><NativeSelect aria-label={t('Idioma')} size="sm" value={language} onChange={e=>setLanguage(e.target.value==='es'?'es':'en')}><NativeSelectOption value="es" lang="es">ES</NativeSelectOption><NativeSelectOption value="en" lang="en">EN</NativeSelectOption></NativeSelect><Button variant="ghost" size="icon" aria-label={dark?t("Usar tema claro"):t("Usar tema oscuro")} onClick={toggleTheme}>{dark?<Sun/>:<Moon/>}</Button></div>;
 // The small window keeps most of its height for the work: a panel with several pages shows them, with the
 // bar's controls, in one slim line fixed on top, so they stay in view whichever page it opened on; a
 // single page has no bar, status shows only as the offline notice, and language and theme come back with a larger window.
 return <div className="app">{compact&&nav&&<header className="topbar compact-bar"><div className="mx-auto flex h-11 max-w-3xl items-center gap-1 px-3 text-muted-foreground">{nav}{controls}</div></header>}{!compact&&<header className="topbar"><div className="topbar-inner"><div className="flex items-center gap-2.5"><Mark className="size-6"/><span className="font-semibold tracking-tight">{brandName}</span></div>{nav}{controls}</div></header>}
 <main className="workspace"><div aria-live="polite" className={view==='desktop'?'mx-auto max-w-3xl':undefined}>{superseded&&<Alert className="mb-6"><AlertDescription><p>{t("Se abrió otra ventana de este panel. Esta sigue abierta porque tiene texto sin enviar.")}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={()=>{windowClaim.current?.reclaim();setSuperseded(false)}}>{t("Seguir en esta ventana")}</Button><Button size="sm" variant="outline" onClick={()=>onReplaced?.()}>{t("Descartar y cerrar")}</Button></div></AlertDescription></Alert>}{/* Every section fails with the same notice when the service is gone; it shows once, and the header already says offline. */}{refreshError&&<Alert className="mb-6 compact:mb-3 compact:py-2 compact:text-xs"><AlertDescription>{refreshError}{refreshErrors.some(e=>e!==offlineNotice)&&' '+(connected?t("Algunas secciones no se han actualizado; el intercambio sigue disponible."):t("La vista conserva los últimos datos recibidos. Reintentando sin reenviar órdenes."))}</AlertDescription></Alert>}</div>
 {view==='desktop'&&<DesktopCollaboration api={api} onError={setError} initialRun={initialNavigation.selected}/>}
 {view==='authorization'&&<AuthorizationPage participants={participants} bound={bound} onError={setError}/>}
 {view==='diagnostic'&&<Diagnostic participants={participants} bound={bound} onError={setError}/>}
 </main>
 {/* One corner for every notice and error, stacked, so none of them covers the content. */}
 <div id="toasts" className="fixed bottom-6 right-6 z-50 flex w-[min(28rem,calc(100vw-3rem))] flex-col gap-2">{error&&<Alert variant="destructive" role="alert" className="toast"><AlertDescription className="flex items-start justify-between gap-3">{t(error)}<button className="pressable -m-1.5 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>setError('')} aria-label={t("Cerrar error")}><X className="size-3.5"/></button></AlertDescription></Alert>}</div></div>
}
function Diagnostic({participants,bound,onError}:{participants:Participant[];bound:string|null;onError:(e:string)=>void}){
 const chats=participants.filter(p=>p.provider==='codex'&&(!bound||p.sessionId===bound));const [owner,setOwner]=useState(bound??chats[0]?.sessionId??''),[report,setReport]=useState<{checks:{code:string;level:string;message:string;remedy?:string}[]}|null>(null),[loading,setLoading]=useState(false);
 const check=async()=>{setLoading(true);try{setReport(await api('diagnostic',{ownerThread:owner,project:chats.find(c=>c.sessionId===owner)?.cwd}))}catch(e){onError((e as Error).message)}finally{setLoading(false)}};
 return <><p className="eyebrow mb-2">{t("Conexión y compatibilidad")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("Diagnóstico")}</h1><p className="mb-8 mt-2 text-muted-foreground">{t("Consulta el estado sin cambiar ajustes ni enviar mensajes.")}</p><Card><CardHeader><CardTitle>{t("Revisar una conversación")}</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-3"><NativeSelect aria-label={t("Chat para diagnóstico")} value={owner} onChange={e=>setOwner(e.target.value)}>{chats.map(c=><NativeSelectOption key={c.sessionId} value={c.sessionId}>{participantLabel(c,participants)}</NativeSelectOption>)}</NativeSelect><Button disabled={!owner||loading} onClick={check}>{loading?<Loader2 className="animate-spin"/>:<RefreshCw/>}{t("Comprobar")}</Button></div></CardContent></Card>{report&&<Card className="mt-6"><CardContent className="space-y-5 pt-6">{report.checks.map(c=><div key={c.code} className="flex gap-3"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${c.level==='ok'?'bg-success':c.level==='blocked'?'bg-danger':'bg-warning'}`}/><div><p className="text-sm font-medium">{c.level==='ok'?t("Correcto"):c.level==='blocked'?t("Requiere atención"):t("No verificable automáticamente")} · {c.code.replaceAll('_',' ')}</p><p className="prose-text mt-1 text-sm text-muted-foreground">{t(c.message)}</p>{c.remedy&&<p className="prose-text mt-2 text-xs text-muted-foreground">{t(c.remedy)}</p>}</div></div>)}<Button variant="outline" onClick={()=>navigator.clipboard.writeText(JSON.stringify(report,null,2)).catch(e=>onError(e.message))}>{t("Copiar diagnóstico")}</Button></CardContent></Card>}</>
}

type Authorization={project:string;enabled:boolean;revision:number;updatedAt:number|null;actor:string|null;folderChanged:boolean;chatPolicy:string;receiverSupported:boolean};
function ProjectAuthorization({owner,project,onError}:{owner:string;project:string;onError:(e:string)=>void}){
 const [state,setState]=useState<Authorization|null>(null),[confirm,setConfirm]=useState<number|null>(null),[busy,setBusy]=useState(false);
 const lock=useRef(false),request=useRef<{key:string;actionId:string}|null>(null);
 const path='project-authorization?'+new URLSearchParams({ownerThread:owner,project});
 useEffect(()=>{let active=true;const load=()=>api<Authorization>(path).then(s=>{if(active)setState(s)}).catch(e=>{if(active&&!(e instanceof PanelOffline))onError(e.message)});void load();const timer=setInterval(()=>void load(),5000);return()=>{active=false;clearInterval(timer)}},[path,onError]);
 const change=async(enabled:boolean,expectedRevision=state?.revision)=>{
  if(!state||lock.current)return;lock.current=true;setBusy(true);
  const key=JSON.stringify({owner,project,enabled,revision:expectedRevision});if(request.current?.key!==key)request.current={key,actionId:crypto.randomUUID()};
  try {const result=await api<Authorization>('project-authorization',{ownerThread:owner,project,enabled,expectedRevision,actionId:request.current.actionId,confirmed:true});setState(result);setConfirm(null)}
  catch(e){onError((e as Error).message);try{setState(await api<Authorization>(path))}catch{}}finally{lock.current=false;setBusy(false)}
 };
 return <Card className="mt-6"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{t("Autorización del proyecto")}</CardTitle><Badge variant={state?.enabled?'secondary':'outline'}>{state?state.enabled?t("Recordada"):t("No recordada"):t("Consultando…")}</Badge></div><CardDescription>{t("Recibir respuestas de Claude en los chats Codex de esta carpeta, incluidos los nuevos.")}</CardDescription></CardHeader><CardContent className="space-y-4">
 <p className="break-all rounded-md bg-muted p-3 text-xs">{state?.project??project}</p>
 <p className="text-sm text-muted-foreground">{t("Solo respuestas verificadas de colaboraciones gestionadas en esta misma carpeta. Se conserva al reiniciar y puedes revocarla aquí. Los permisos de ejecución y edición siguen aplicándose; la recepción de Claude se configura en Claude.")}</p>
 {state&&<p className="text-xs text-muted-foreground">{t("Ajuste propio de este chat:")} <strong>{({default:t("predeterminado; puede heredar"),accept:t("aceptar; no depende de esta autorización"),hold:t("retener; tiene prioridad sobre el proyecto"),refuse:t("rechazar; tiene prioridad sobre el proyecto")} as Record<string,string>)[state.chatPolicy]??state.chatPolicy}</strong>.{state.updatedAt&&<> {t("Última elección:")} {date(state.updatedAt)}.</>}</p>}
 {state&&!state.receiverSupported&&<Alert><AlertDescription>{t("Este receptor necesita recargar el plugin actualizado para heredar la autorización. Puedes revocar una autorización existente.")}</AlertDescription></Alert>}
 {state?.folderChanged&&<Alert><AlertDescription>{t("La carpeta ha cambiado de identidad. El permiso anterior no se hereda; confirma de nuevo para esta carpeta.")}</AlertDescription></Alert>}
 {confirm!==null&&!state?.enabled?<Alert><AlertDescription><p>{t("¿Recordar la autorización para esta carpeta? Los chats Codex con recepción predeterminada podrán recibir futuras respuestas del participante Claude verificado en sus colaboraciones. Otros proyectos y mensajes retenidos anteriores quedan fuera.")}</p><div className="mt-4 flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={()=>void change(true,confirm)}>{busy&&<Loader2 className="animate-spin"/>}{t("Confirmar autorización")}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>setConfirm(null)}>{t("Volver")}</Button></div></AlertDescription></Alert>:
 <Button type="button" variant={state?.enabled?'outline':'default'} disabled={!state||busy||!state.enabled&&!state.receiverSupported} onClick={()=>state?.enabled?void change(false):setConfirm(state!.revision)}>{busy?<Loader2 className="animate-spin"/>:<Check/>}{state?.enabled?t("Revocar para este proyecto"):t("Recordar autorización para este proyecto")}</Button>}
 {state?.enabled&&<p className="text-xs text-muted-foreground">{t("Revocar elimina la herencia. Un chat con «aceptar» propio, de una versión anterior, lo conserva; abre un chat nuevo para quitarlo.")}</p>}
 </CardContent></Card>
}
function AuthorizationPage({participants,bound,onError}:{participants:Participant[];bound:string|null;onError:(e:string)=>void}){
 const chats=participants.filter(p=>p.provider==='codex'&&(!bound||p.sessionId===bound));const [owner,setOwner]=useState(bound??chats[0]?.sessionId??'');const selected=chats.find(p=>p.sessionId===owner);
 return <div className="mx-auto max-w-3xl"><p className="eyebrow mb-2">{t("Recepción de mensajes")}</p><h1 className="text-3xl font-semibold tracking-tight">{t("Autorizaciones")}</h1><p className="mb-7 mt-2 text-muted-foreground">{t("Decide qué proyecto puede recordar tu elección.")}</p><Field label={t("Conversación Codex")}><NativeSelect aria-label={t("Chat para autorización")} className="w-full" value={owner} onChange={e=>setOwner(e.target.value)}><NativeSelectOption value="">{t("Seleccionar conversación")}</NativeSelectOption>{chats.map(p=><NativeSelectOption key={p.sessionId} value={p.sessionId}>{participantLabel(p,participants)}</NativeSelectOption>)}</NativeSelect></Field>{selected&&<ProjectAuthorization key={owner+selected.cwd} owner={owner} project={selected.cwd} onError={onError}/>}</div>
}
