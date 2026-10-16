import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {getLanguage,useLanguage} from './lib/i18n';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Badge} from '@/components/ui/badge';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {Play,Pause,RefreshCw,Download,Plus,Minus,Check,ArrowLeft,ChevronRight,SlidersHorizontal,Sparkles,X,Loader2} from 'lucide-react';
import {DesktopTickets,FirstMessage,openNewChat} from './DesktopTickets';
import {Switch} from '@/components/ui/switch';
import {serializedRefresh,PanelOffline} from './lib/live-refresh';
import {State as RunState,providerName} from './RunState';
import {syncEditAuthorization,type EditChoice} from './lib/collaboration-form';
import {useDraft} from './lib/drafts';
import {useCompact} from './lib/compact';

const l=(en:string,es:string)=>getLanguage()==='es'?es:en;
type Principal={provider:'codex'|'claude';sessionId:string};
type Peer=Principal&{name:string;cwd:string;status:string;symmetricDesktop:boolean;eligibleSurface:boolean;startedAt:number|null};
type Run={id:string;createdAt:number;initiator:Principal;state:string;reason:string|null;context:{objective:string;constraints:string[];references:string[];priorAnalysis:{codex?:string;claude?:string}};contextVersion:number;deadline:number|null;limits:{maxMessages:number|null;maxSeconds:number};messagesUsed:number;coordination:{revision:number;barrierOpen:boolean;structured:{structured:boolean;phase?:string;tasks?:{id:string;assignee:string;state:string;task:{intent:string}}[];closure?:{consensus:string;derivedReviewState:string;closure:{summary:string;disposition:string};disagreements:string[]}|null};lease:{epoch:number;expiresAt:number|null}};messages:{id:string;src:Principal;dst:Principal;text:string|null;status:string}[];reports:{id:string;author:string;body:string;report:{kind:string;version?:number;verdict?:string}}[];results:{author:string;report:{resultId:string;version:number;title:string}}[];implementation:{candidate:{contentHash:string;resultId:string;version:number}|null;checks:{name:string;exitCode:number;executedByCore:false}[];plan:{requiredChecks:string[]}}|null;reviews:{id:string;current:boolean;targetHash:string|null}[];validatedConsensus:false;participants?:{provider:string;sessionId:string;name:string}[];consent:{valid:boolean;actor:string|null;expiresAt:number|null;coversLaterContexts?:boolean};editAuthorization?:{valid:boolean;grantee:Principal|null;scope:string|null;revokedAt:number|null};preflight?:{readyForCheck:boolean;message:string};events?:{type:string;at:number}[]};
type Ticket={id:string;adapter:string;targetProvider:string;project:string;state:string;revision:number;correlationId:string|null;createdAt:number;expiresAt:number;bound:{sessionId:string}|null;reason:string|null};
type Proposal={id:string;requester:Principal;createdAt:number;objective:string;newChat:boolean;peerId?:string;allowEdits:boolean;editScope?:string;maxMessages:number|null;minutes:number;initialBarrier:boolean};
type State={principal:Principal;project:string;runs:Run[];participants:Peer[];proposals?:Proposal[];startQueue?:{waiting:Record<string,number>;ended:Record<string,string>};tickets:Ticket[];grants:{id:string;targetProvider:string;adapter:string;revokedAt:number|null;expiresAt:number|null}[];bindingErrors?:Record<string,string>};
type Api=<T>(path:string,body?:unknown)=>Promise<T>;
const defaultScope=()=>l('Implement the agreed plan in this project: edit files and make local commits. No push, pull requests or merges.','Implementar el plan acordado en este proyecto: editar archivos y hacer commits locales. Sin push, PR ni merges.');
const otherOf=(r:Run)=>r.initiator.provider==='claude'?'codex':'claude';
const needsApproval=(r:Run)=>r.state==='prepared'&&r.initiator.provider==='claude'&&!r.consent.valid;
const terminal=(state:string)=>['completed','cancelled','limit_reached'].includes(state);
const opened=(ms:number|null)=>ms?new Date(ms).toLocaleString(getLanguage(),{weekday:'short',hour:'2-digit',minute:'2-digit'}):'';
const ago=(ms:number)=>{const m=Math.round((Date.now()-ms)/60000);return m<1?l('just now','ahora'):m<60?l(`${m} min ago`,`hace ${m} min`):new Date(ms).toLocaleString(getLanguage(),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})};
const delivery=():Record<string,string>=>({reserved:l('Queued','En cola'),submitting:l('Sending','Enviando'),'socket-written':l('Sent','Enviado'),started:l('Delivered','Entregado'),steered:l('Delivered','Entregado'),delivered:l('Delivered','Entregado'),consumed:l('Read','Leído'),held:l('Held by the other chat','Retenido por el otro chat'),denied:l('Denied','Denegado'),expired:l('Expired','Caducado'),unknown:l('Uncertain — not resent','Incierto — no se reenvía')});

export function DesktopCollaboration({api,onError,initialRun='',pickChat=false}:{api:Api;onError:(s:string)=>void;initialRun?:string;pickChat?:boolean}){
 useLanguage();const compact=useCompact();
 const [draft,setDraft]=useState<Proposal|null>(null),[toastRoot,setToastRoot]=useState<HTMLElement|null>(null),[state,setState]=useState<State|null>(null),[selected,setSelectedRun]=useState(''),[composing,setComposing]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[direction,setDirection]=useState<'forward'|'back'|null>(null);
 // Remember which way the user travelled so the next view enters along that path.
 const setSelected=(id:string)=>{setDirection(id?'forward':'back');setSelectedRun(id)};
 const refresh=useRef<()=>Promise<void>>(()=>Promise.resolve()),focused=useRef(false),actionLock=useRef(false),pickFor=useRef<string|undefined>(undefined);
 useEffect(()=>{let alive=true;const worker=serializedRefresh(async()=>{try{const value=await api<State>('desktop/state');if(alive)setState(value)}catch(e){if(alive&&!(e instanceof PanelOffline))onError((e as Error).message)}});refresh.current=worker.request;void worker.request();const timer=setInterval(()=>void worker.request(),2500),focus=()=>{if(document.visibilityState==='visible')void worker.request()};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{alive=false;worker.stop();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}},[api,onError]);
 // A focus link opens on its run once; later selections are the human's.
 useEffect(()=>{if(focused.current||!state||!initialRun)return;focused.current=true;if(state.runs.some(r=>r.id===initialRun))setSelected(initialRun)},[state,initialRun]);
 useEffect(()=>{window.scrollTo({top:0})},[selected,composing]);
 useEffect(()=>{setToastRoot(document.getElementById('toasts'))},[]);
 const act=async(fn:()=>Promise<void>)=>{if(actionLock.current)return;actionLock.current=true;setBusy(true);try{onError('');await fn();await refresh.current()}catch(e){onError((e as Error).message)}finally{actionLock.current=false;setBusy(false)}};
 if(!state)return <p className="text-muted-foreground">{l('Loading…','Cargando…')}</p>;
 const run=state.runs.find(r=>r.id===selected),other=state.principal.provider==='codex'?'claude':'codex';
 // Notices share the bottom corner with errors so they never cover the content.
 const toastCard=notice&&<Alert role="status" className="toast"><AlertDescription className="flex items-start justify-between gap-3">{notice}<button className="pressable -m-1.5 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>setNotice('')} aria-label={l('Close','Cerrar')}><X className="size-3.5"/></button></AlertDescription></Alert>;
 const toast=toastCard&&(toastRoot?createPortal(toastCard,toastRoot):toastCard);
 const queue=state.startQueue??{waiting:{},ended:{}};
 if(run)return <>{toast}<div key={run.id} className={direction==='forward'?'view-forward':''}><RunView run={run} api={api} busy={busy} act={act} waitingSince={queue.waiting[run.id]} ended={queue.ended[run.id]} onNotice={setNotice} onBack={()=>setSelected('')}/></div></>;
 // A chat's suggestion opens the form prefilled; the person decides from there.
 // One chat runs one collaboration at a time; while it is busy, new ones start from another chat.
 const ownerBusy=state.runs.find(r=>['active','paused','blocked'].includes(r.state)),own=providerName(state.principal.provider);
 // Opened to change the chat: only the suggestion shown then starts on the open chats, not later ones.
 if(pickChat&&pickFor.current===undefined&&state.proposals?.[0])pickFor.current=state.proposals[0].id;
 const approvals=state.runs.filter(needsApproval),proposal=draft??state.proposals?.[0],showComposer=!ownerBusy&&(composing||state.runs.length===0||!!proposal);
 return <div className={`mx-auto max-w-3xl space-y-6 compact:space-y-3 ${direction==='back'?'view-back':''}`}>{toast}
  {approvals.map(r=><ApprovalCard key={r.id} run={r} api={api} busy={busy} act={act} ownerBusy={ownerBusy} onChange={setDraft} onNotice={setNotice} onDetails={()=>setSelected(r.id)}/>)}
  {/* The window title already names the page; the small window keeps only the New button. */}
  {(!compact||!showComposer&&!ownerBusy)&&<div className="flex items-center justify-between gap-4 compact:justify-end"><h1 className="text-2xl font-semibold tracking-tight compact:hidden">{l('Collaborations','Colaboraciones')}</h1>{!showComposer&&!ownerBusy&&<Button size={compact?'sm':'default'} onClick={()=>setComposing(true)}><Plus/>{l('New','Nueva')}</Button>}</div>}
  {ownerBusy&&<div className="reveal flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm compact:gap-2 compact:p-3"><div className="min-w-0 flex-1"><p className="font-medium">{l(`This ${own} chat is busy with a collaboration`,`Este chat de ${own} está ocupado con una colaboración`)}</p><p className="mt-1 text-muted-foreground compact:line-clamp-2 compact:text-xs">{l(`For another one, ask from a new chat. It is working on “${ownerBusy.context.objective}”.`,`Para otra, pídela desde un chat nuevo. Ahora trabaja en «${ownerBusy.context.objective}».`)}</p></div><Button variant="outline" size={compact?'sm':'default'} disabled={busy} onClick={()=>void act(async()=>{await api('desktop/apps/new_chat',{})})}><Plus/>{l(`Open a new ${own} chat`,`Abrir un chat nuevo de ${own}`)}</Button></div>}
  {showComposer&&<Composer key={proposal?.id??'blank'} proposal={proposal} pickChat={!draft&&!!proposal&&proposal.id===pickFor.current} state={state} other={other} api={api} busy={busy} act={act} onCancel={state.runs.length||draft?()=>{setComposing(false);setDraft(null)}:undefined} onStarted={(id,text)=>{setComposing(false);setDraft(null);setSelected(id);setNotice(text)}}/>}
  {state.runs.length>0&&!(compact&&showComposer)&&<div className="overflow-hidden rounded-xl border bg-card">{state.runs.map(r=>{
   // A prepared run that never started is a draft: say so and offer its two actions on the row.
   const waitingFor=queue.waiting[r.id],draftRow=r.state==='prepared'&&!needsApproval(r)&&!waitingFor,peer=providerName(otherOf(r));
   return <div key={r.id} className="flex items-center gap-2 border-b pr-4 last:border-0 hover:bg-muted/60"><button onClick={()=>setSelected(r.id)} className="pressable flex min-w-0 flex-1 items-center gap-4 px-5 py-4 text-left active:bg-muted compact:gap-3 compact:px-4 compact:py-2.5"><div className="min-w-0 flex-1"><p className="truncate font-medium">{r.context.objective}</p><p className="mt-0.5 text-xs text-muted-foreground">{providerName(r.initiator.provider)} ↔ {peer} · {r.messagesUsed}/{r.limits.maxMessages??'∞'} {l('messages','mensajes')} · {ago(r.createdAt)}</p></div>
    {needsApproval(r)?<Badge className="bg-warning text-warning-foreground">{l('Needs approval','Requiere aprobación')}</Badge>:waitingFor?<Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning"><Loader2 className="animate-spin"/>{l(`Waiting for ${peer}`,`Esperando a ${peer}`)}</Badge>:draftRow?<Badge variant="outline" className="text-muted-foreground">{l('Draft','Borrador')}</Badge>:<RunState state={r.state}/>}</button>
    {draftRow&&<><Button size="sm" disabled={busy||!!ownerBusy} onClick={()=>void act(async()=>{setNotice(startedNotice(await approveAndStart(api,r),peer))})}><Play/>{l('Start','Empezar')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act(async()=>{await cancelRun(api,r)})}>{l('Discard','Descartar')}</Button></>}
    <ChevronRight className="size-4 shrink-0 text-muted-foreground"/></div>})}</div>}
 </div>;
}

// One approval covers the whole plan: later phases update this run's context instead of starting another run.
// Starting waits for a busy peer to finish its current reply unless the person chose to add to it.
type StartResult={state:string;job?:{state:string}};
async function approveAndStart(api:Api,run:Run,edit?:EditChoice,allowBusyPeer=false){
 if(run.initiator.provider==='claude'&&!run.consent.valid)await api('desktop/consent',{runId:run.id,expectedRevision:run.coordination.revision,coversLaterContexts:true});
 if(edit)await syncEditAuthorization(api,run,edit);
 return api<StartResult>('desktop/start_when_idle',{runId:run.id,commandId:crypto.randomUUID(),allowBusyPeer});
}
const startedNotice=(result:StartResult,peer:string)=>result.state==='waiting'?l(`${peer} is finishing its current reply; the collaboration starts on its own when it is done.`,`${peer} está terminando su respuesta actual; la colaboración empieza sola cuando acabe.`)
 :result.job?.state==='unknown'?l('Started, but the chat could not be woken for sure. Open it to check.','Iniciada, pero no se pudo confirmar el aviso al chat. Ábrelo para comprobarlo.'):l('Started. Both chats are working on it.','Iniciada. Los dos chats ya están en ello.');
const endedReason=(reason:string,peer:string)=>reason==='peer_still_busy'?l(`${peer} was still busy after 10 minutes. Start again when it is free.`,`${peer} seguía ocupado tras 10 minutos. Vuelve a empezar cuando esté libre.`):reason;
const peerOf=(run:Run)=>run.participants?.find(p=>p.provider!==run.initiator.provider);
const cancelRun=(api:Api,run:Run)=>api('desktop/control',{runId:run.id,commandId:crypto.randomUUID(),expectedRevision:run.coordination.revision,control:{action:'cancel'}});

// The edit rules and the short summary of the default permission, shared by the form and the approval card.
const scopeRules=()=>l('Covers every phase until you revoke it. Push, PRs, merges, deploys and paid API calls only if you write them here.','Cubre todas las fases hasta que lo revoques. Push, PR, merges, despliegues y APIs de pago solo si los escribes aquí.');
const editSummary=(scope:string)=>scope===defaultScope()?l('Local edits and commits only; no push, pull requests or merges.','Solo ediciones y commits locales; sin push, PR ni merges.'):undefined;

// What the peer may do reads as the text that grants it; the rules for writing it show while editing.
// A summary may stand in for the default text, which it restates; any other text shows as written.
function Scope({value,summary,onChange,editing,setEditing,rules}:{value:string;summary?:string;onChange:(v:string)=>void;editing:boolean;setEditing:(v:boolean)=>void;rules:string}){
 const link=(label:string,next:boolean)=><button type="button" className="font-medium text-primary hover:underline" onClick={()=>setEditing(next)}>{label}</button>;
 return editing?<div className="reveal space-y-1.5"><Textarea rows={2} maxLength={4000} className="compact:min-h-12" value={value} onChange={e=>onChange(e.target.value)} aria-label={l('What it may do','Qué puede hacer')}/><p className="text-xs leading-5 text-muted-foreground">{rules} {link(l('Done','Listo'),false)}</p></div>
  :<p className="text-xs leading-5 text-muted-foreground"><span className="whitespace-pre-line">{summary??(value.trim()||l('Describe what it may do.','Describe qué puede hacer.'))}</span> {link(l('Change','Cambiar'),true)}</p>;
}

function EditOption({peer,value,onChange}:{peer:string;value:EditChoice;onChange:(v:EditChoice)=>void}){
 const [editing,setEditing]=useState(false);
 return <div className="space-y-2 text-sm compact:space-y-1"><label className="flex gap-2"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/>{l(`Let ${peer} edit files and make local commits`,`Permitir que ${peer} edite archivos y haga commits locales`)}</label>
  {value.enabled&&<div className="pl-6"><Scope value={value.scope} onChange={scope=>onChange({...value,scope})} editing={editing} setEditing={setEditing} rules={l('Covers every phase of this collaboration until you revoke it. Never covers push, pull requests, merges, deploys or paid API calls unless you write them here.','Cubre todas las fases de esta colaboración hasta que lo revoques. Nunca cubre push, PR, merges, despliegues ni llamadas de pago a APIs salvo que lo escribas aquí.')}/></div>}
 </div>;
}

// Laid out like the form a suggestion opens: the objective, the other chat, the edit switch and the
// limits as tiles, then a wide start. Messages and time can still change here, saved just before approving;
// the objective and the chat stay as prepared, and Change reopens them in that form.
function ApprovalCard({run,api,busy,act,onDetails,ownerBusy,onChange,onNotice}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onDetails:()=>void;ownerBusy?:Run;onChange:(draft:Proposal)=>void;onNotice:(text:string)=>void}){
 const [edit,setEdit]=useState<EditChoice>({enabled:true,scope:defaultScope()}),[scopeOpen,setScopeOpen]=useState(false),peer=providerName(otherOf(run)),with_=peerOf(run)?.name??peer,compact=useCompact();
 const [messages,setMessages]=useState(run.limits.maxMessages===null?'':String(run.limits.maxMessages)),[minutes,setMinutes]=useState(String(Math.round(run.limits.maxSeconds/60)));
 useDraft({edit,messages,minutes});
 const change=()=>act(async()=>{const limits=parseLimits(messages,minutes);await cancelRun(api,run);onChange({id:'draft:'+run.id,requester:run.initiator,createdAt:run.createdAt,objective:run.context.objective,newChat:false,peerId:peerOf(run)?.sessionId,allowEdits:edit.enabled,editScope:edit.scope,maxMessages:limits.maxMessages,minutes:limits.maxSeconds/60,initialBarrier:false})});
 const approve=()=>act(async()=>{const limits=parseLimits(messages,minutes),same=limits.maxMessages===run.limits.maxMessages&&limits.maxSeconds===run.limits.maxSeconds;
  const current=same?run:await api<Run>('desktop/limits',{runId:run.id,expectedRevision:run.coordination.revision,limits});
  onNotice(startedNotice(await approveAndStart(api,current,edit),peer))});
 const prepared=l(`Prepared by ${providerName(run.initiator.provider)} · ${ago(run.createdAt)}`,`Preparada por ${providerName(run.initiator.provider)} · ${ago(run.createdAt)}`);
 const waiting=l('Waiting for your approval','Esperando tu aprobación');
 const tile=compact?'rounded-2xl bg-card p-3.5 shadow-tile':'rounded-xl border bg-background p-4',label=compact?'text-[14px] font-medium tracking-[-0.01em]':'text-sm font-medium';
 const body=<>
  <p className={`whitespace-pre-wrap leading-relaxed ${compact?'rounded-2xl bg-card px-4 py-3 text-[15px] shadow-tile':'rounded-xl border bg-background px-4 py-3 text-base'}`}>{run.context.objective}</p>
  <div className="grid gap-3 sm:grid-cols-2">
   <div className={tile}><p className={label}>{l(`${peer} chat`,`Chat de ${peer}`)}</p><p className="mt-1 truncate text-xs leading-5 text-muted-foreground" title={with_}>{with_}</p></div>
   <Choice checked={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})} title={l(`${peer} can edit and commit`,`${peer} puede editar y hacer commits`)} detail={edit.enabled?undefined:l('Read and discuss only.','Solo leer y debatir.')}>
    {edit.enabled&&<div className="mt-1"><Scope value={edit.scope} summary={compact?editSummary(edit.scope):undefined} onChange={scope=>setEdit({...edit,scope})} editing={scopeOpen} setEditing={setScopeOpen} rules={scopeRules()}/></div>}
   </Choice>
  </div>
  <div className="grid gap-3 sm:grid-cols-2">
   <div className={`flex items-center justify-between gap-3 ${tile}`}><div><p className={label}>{l('Messages','Mensajes')}</p><MessagesShortcut value={messages} onChange={setMessages}/></div><MessagesControl value={messages} onChange={setMessages} className="h-9 w-40 rounded-full bg-muted"/></div>
   <div className={`flex items-center justify-between gap-3 ${tile}`}><div><p className={label}>{l('Time','Tiempo')}</p><TimeShortcut value={minutes} onChange={setMinutes}/></div><TimeControl value={minutes} onChange={setMinutes} className="h-9 w-40 rounded-full bg-muted"/></div>
  </div>
  <p className="text-xs leading-5 text-muted-foreground">{l('Covers every phase of this collaboration; you will not be asked again for the next one.','Cubre todas las fases de esta colaboración; no se te volverá a pedir para la siguiente.')}{ownerBusy&&' '+l('It can start once the collaboration in progress ends.','Podrá empezar cuando termine la colaboración en curso.')}</p>
  <div className="flex items-center gap-2"><Button className="h-11 flex-1 rounded-xl text-[15px] font-semibold shadow-sm" disabled={busy||!!ownerBusy||edit.enabled&&!edit.scope.trim()} onClick={()=>void approve()}><Play/>{l('Approve and start','Aprobar e iniciar')}</Button><Button variant="ghost" className="h-11 rounded-xl" disabled={busy||!!ownerBusy} onClick={()=>void change()}>{l('Change','Cambiar')}</Button><Button variant="ghost" className="h-11 rounded-xl" onClick={onDetails}>{l('See details','Ver detalles')}</Button></div>
 </>;
 if(compact)return <div className="reveal flex min-w-0 flex-col gap-3">
  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Sparkles className="size-3.5 text-primary"/>{prepared}</p><p className="text-[13px] font-medium text-warning">{waiting}</p></div>
  {body}
 </div>;
 return <div className="reveal space-y-5 rounded-xl border border-warning/35 bg-card p-6 shadow-sm">
  <div className="-mx-6 -mt-6 rounded-t-xl border-b border-warning/20 bg-warning/[.07] px-6 py-3"><p className="text-sm font-medium text-warning">{waiting}</p><p className="text-xs text-muted-foreground">{prepared}</p></div>
  {body}
 </div>;
}

function EditAuthorization({run,api,busy,act,edit,setEdit}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;edit:EditChoice;setEdit:(v:EditChoice)=>void}){
 const peer=providerName(otherOf(run)),grant=run.editAuthorization;
 const send=(body:Record<string,unknown>)=>act(async()=>{await api('desktop/edit_authorization',{runId:run.id,expectedRevision:run.coordination.revision,...body})});
 if(grant?.valid)return <div className="space-y-2 rounded-xl border p-4 text-sm compact:space-y-0.5 compact:px-3 compact:py-2"><div className="flex items-center justify-between gap-3"><p className="font-medium">{l(`${peer} may edit and commit locally`,`${peer} puede editar y hacer commits locales`)}</p><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void send({revoke:true})}>{l('Revoke','Revocar')}</Button></div><p className="whitespace-pre-wrap text-muted-foreground compact:text-xs">{grant.scope}</p></div>;
 return <div className="space-y-3 rounded-xl border p-4 compact:space-y-2 compact:px-3 compact:py-2">{grant?.revokedAt&&<p className="text-sm text-muted-foreground">{l('Editing permission revoked.','Permiso de edición revocado.')}</p>}<EditOption peer={peer} value={edit} onChange={setEdit}/>{run.state!=='prepared'&&edit.enabled&&<Button size="sm" disabled={busy||!edit.scope.trim()} onClick={()=>void send({scope:edit.scope}).then(()=>setEdit({...edit,enabled:false}))}>{l('Authorize','Autorizar')}</Button>}</div>;
}

// A setting that reads as a choice: title, consequence, and a switch on the same surface.
// In the small window it is a neutral grouped tile and the switch alone shows the state.
function Choice({checked,onChange,title,detail,children}:{checked:boolean;onChange:(v:boolean)=>void;title:string;detail?:string;children?:React.ReactNode}){
 const compact=useCompact();
 return <div className={compact?'rounded-2xl bg-card p-3.5 shadow-tile':`rounded-xl border p-4 transition-colors duration-200 ${checked?'border-primary/40 bg-primary/[.05]':'bg-background'}`}>
  <label className="flex cursor-pointer items-start justify-between gap-3"><span><span className={`block font-medium ${compact?'text-[14px] tracking-[-0.01em]':'text-sm'}`}>{title}</span>{detail&&<span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span>}</span><Switch className="mt-0.5" aria-label={title} checked={checked} onCheckedChange={onChange}/></label>
  {children}
 </div>;
}

const StepButton=({label,disabled,onClick,children}:{label:string;disabled:boolean;onClick:()=>void;children:React.ReactNode})=><button type="button" className="pressable flex h-full items-center rounded-full px-3 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={disabled} aria-label={label} onClick={onClick}>{children}</button>;

// Minus and plus around the count. Empty means no message limit, and plus brings the usual 24 back.
function MessagesControl({value,onChange,className}:{value:string;onChange:(v:string)=>void;className:string}){
 const n=Number(value),limited=value!=='',set=(next:number)=>onChange(String(Math.min(500,Math.max(2,next))));
 return <div className={`flex items-center focus-within:ring-[3px] focus-within:ring-ring/40 ${className}`}>
  <StepButton label={l('Fewer messages','Menos mensajes')} disabled={!limited||n<=2} onClick={()=>set(n-4)}><Minus className="size-4"/></StepButton>
  <input inputMode="numeric" aria-label={l('Messages','Mensajes')} className="w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none placeholder:text-foreground" placeholder={l('No limit','Sin límite')} value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,''))}/>
  <StepButton label={l('More messages','Más mensajes')} disabled={limited&&n>=500} onClick={()=>limited?set(n+4):onChange('24')}><Plus className="size-4"/></StepButton>
 </div>;
}

// Time moves through the usual durations, up to the bridge's 24-hour maximum.
const durations=[5,10,15,20,30,45,60,90,120,180,240,360,480,720,1440],maxMinutes=1440;
const duration=(m:number)=>m<60?`${m} min`:m%60?`${Math.floor(m/60)} h ${m%60} min`:`${m/60} h`;
function TimeControl({value,onChange,className}:{value:string;onChange:(v:string)=>void;className:string}){
 const n=Number(value),lower=durations.filter(d=>d<n).at(-1),higher=durations.find(d=>d>n);
 return <div role="group" aria-label={l('Time','Tiempo')} className={`flex items-center ${className}`}>
  <StepButton label={l('Less time','Menos tiempo')} disabled={lower===undefined} onClick={()=>onChange(String(lower))}><Minus className="size-4"/></StepButton>
  <span className="w-full text-center text-sm font-semibold tabular-nums" aria-live="polite">{duration(n)}</span>
  <StepButton label={l('More time','Más tiempo')} disabled={higher===undefined} onClick={()=>onChange(String(higher))}><Plus className="size-4"/></StepButton>
 </div>;
}

// Limits as the form and the approval card read them: empty messages means no limit.
const parseLimits=(messages:string,minutes:string)=>{const maxMessages=messages===''?null:Number(messages),maxSeconds=Number(minutes)*60;if(maxMessages!==null&&(!Number.isSafeInteger(maxMessages)||maxMessages<2)||!Number.isInteger(maxSeconds)||maxSeconds<60)throw new Error(l('Enter valid limits: at least 2 messages and 1 minute.','Indica límites válidos: al menos 2 mensajes y 1 minuto.'));return {maxMessages,maxSeconds}};
// Each limit offers one shortcut: no message limit, or the 24-hour maximum for time.
const shortcutLink='text-xs font-medium text-primary hover:underline';
const MessagesShortcut=({value,onChange}:{value:string;onChange:(v:string)=>void})=><button type="button" className={shortcutLink} onClick={()=>onChange(value===''?'24':'')}>{value===''?l('Set a limit','Poner límite'):l('No limit','Sin límite')}</button>;
const TimeShortcut=({value,onChange}:{value:string;onChange:(v:string)=>void})=>value===String(maxMinutes)?<span className="text-xs text-muted-foreground">{l('Maximum','Máximo')}</span>:<button type="button" className={shortcutLink} onClick={()=>onChange(String(maxMinutes))}>{l('Max 24 h','Máx. 24 h')}</button>;

function Composer({proposal,pickChat=false,state,other,api,busy,act,onCancel,onStarted}:{proposal?:Proposal;pickChat?:boolean;state:State;other:string;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onCancel?:()=>void;onStarted:(id:string,notice:string)=>void}){
 const peers=state.participants.filter(p=>p.provider===other&&p.cwd===state.project&&p.eligibleSurface),ready=peers.filter(p=>p.symmetricDesktop),peerName=providerName(other);
 const compact=useCompact(),[more,setMore]=useState(false);
 // Defaults: a fresh chat for each collaboration, allowed to edit and commit locally.
 const [newChat,setNewChat]=useState(pickChat?false:proposal?.newChat??true),[peer,setPeer]=useState(proposal?.peerId??''),[objective,setObjective]=useState(proposal?.objective??''),[messages,setMessages]=useState(proposal?(proposal.maxMessages===null?'':String(proposal.maxMessages)):'24'),[minutes,setMinutes]=useState(String(proposal?.minutes??30)),[busyPeer,setBusyPeer]=useState(false),[initialBarrier,setInitialBarrier]=useState(proposal?.initialBarrier??false),[priorCodex,setPriorCodex]=useState(''),[priorClaude,setPriorClaude]=useState(''),[implementation,setImplementation]=useState(''),[advancedTicket,setAdvancedTicket]=useState(''),[edit,setEdit]=useState<EditChoice>({enabled:proposal?.allowEdits??true,scope:proposal?.editScope??defaultScope()}),[scopeOpen,setScopeOpen]=useState(false),[opening,setOpening]=useState<{ticketId:string;prompt:string}|null>(null),[candidate,setCandidate]=useState('');
 // A chat being opened for an automatic start also counts: closing this window would drop that start.
 useDraft({newChat,peer,objective,messages,minutes,busyPeer,initialBarrier,priorCodex,priorClaude,implementation,edit},!!opening);
 const request=useRef<{payload:string;id:string;notifyId:string}|null>(null),openRequest=useRef(crypto.randomUUID()),autoStart=useRef(false),fromDraft=!!proposal?.id.startsWith('draft:');
 const ticket=opening?state.tickets.find(t=>t.id===opening.ticketId):undefined,boundId=ticket?.bound?.sessionId??'',ticketEnded=!!ticket&&['failed','expired','cancelled'].includes(ticket.state);
 const candidates=ticket&&!ticket.bound?peers.filter(p=>p.symmetricDesktop&&p.startedAt!==null&&p.startedAt>=ticket.createdAt):[];
 const chosen=newChat?boundId:(peer||(ready.length===1?ready[0]!.sessionId:''));
 const ticketId=newChat?(boundId?opening!.ticketId:''):advancedTicket;
 const limits=()=>parseLimits(messages,minutes);
 const ready2go=!!objective.trim()&&(!edit.enabled||!!edit.scope.trim());
 const start=()=>act(async()=>{if(!objective.trim()||!chosen)throw new Error(l('Choose a conversation and an objective.','Elige una conversación y un objetivo.'));if(edit.enabled&&!edit.scope.trim())throw new Error(l('Describe what it may edit first.','Describe primero qué puede editar.'));
  const payload={peerId:chosen,context:{objective:objective.trim(),constraints:[],references:[],priorAnalysis:{...(priorCodex.trim()?{codex:priorCodex}:{}),...(priorClaude.trim()?{claude:priorClaude}:{})}},limits:limits(),routine:{mode:'free'},...(initialBarrier?{coordination:{initialBarrier:true}}:{}),...(ticketId?{ticketId}:{}),...(implementation.trim()?{implementation:JSON.parse(implementation)}:{}),openPanel:false};
  const key=JSON.stringify(payload);if(request.current?.payload!==key)request.current={payload:key,id:crypto.randomUUID(),notifyId:crypto.randomUUID()};
  const prepared=await api<Run>('desktop/prepare',{...payload,requestId:request.current.id});
  if(proposal&&!fromDraft)await api('desktop/proposal_resolve',{id:proposal.id,state:'used'}).catch(()=>{});
  // A human pressing start here is the approval itself for a Claude-initiated run.
  if(prepared.preflight&&!prepared.preflight.readyForCheck&&(prepared.initiator.provider!=='claude'||prepared.consent.valid)){onStarted(prepared.id,l('Prepared. Check the details before starting.','Preparada. Revisa los detalles antes de iniciarla.'));return;}
  if(prepared.initiator.provider==='claude'&&!prepared.consent.valid)await api('desktop/consent',{runId:prepared.id,expectedRevision:prepared.coordination.revision,coversLaterContexts:true});
  await syncEditAuthorization(api,prepared,edit);
  // Waits in the bridge for a busy peer, so a new chat answering its first message is fine.
  const result=await api<StartResult>('desktop/start_when_idle',{runId:prepared.id,commandId:request.current.notifyId,allowBusyPeer:busyPeer});
  onStarted(prepared.id,startedNotice(result,peerName))});
 // The person asked to start when they opened the new chat; start as soon as it is linked.
 useEffect(()=>{if(autoStart.current&&boundId&&!busy){autoStart.current=false;void start()}},[boundId,busy]);
 const openAndStart=()=>act(async()=>{if(!objective.trim())throw new Error(l('Write what they should work on first.','Escribe primero en qué tienen que trabajar.'));limits();
  const opened=await openNewChat(api,state.project,other,openRequest.current);openRequest.current=crypto.randomUUID();autoStart.current=true;setOpening({ticketId:opened.ticket.id,prompt:opened.bootstrapPrompt})});
 const startOver=()=>act(async()=>{autoStart.current=false;if(ticket&&!ticket.bound&&!ticketEnded&&ticket.state!=='creating')await api('desktop/tickets/cancel',{id:ticket.id});setOpening(null);setCandidate('')});

 const dismiss=()=>act(async()=>{if(proposal&&!fromDraft)await api('desktop/proposal_resolve',{id:proposal.id,state:'dismissed'});onCancel?.()});
 const suggester=proposal?providerName(proposal.requester.provider):'';
 const suggested=proposal&&(fromDraft?l(`Prepared by ${suggester} · ${ago(proposal.createdAt)}`,`Preparada por ${suggester} · ${ago(proposal.createdAt)}`):l(`Suggested by ${suggester} · ${ago(proposal.createdAt)}`,`Sugerida por ${suggester} · ${ago(proposal.createdAt)}`));
 const waiting=newChat&&!!opening&&!boundId;
 const objectiveField=(className:string)=><Textarea id="objective" aria-label={l('What should they work on?','¿En qué tienen que trabajar?')} className={className} value={objective} onChange={e=>setObjective(e.target.value)} rows={3} maxLength={16000} placeholder={l('E.g. Review the panel design together and propose improvements.','Ej.: Revisad juntos el diseño del panel y proponed mejoras.')}/>;
 const startButton=(className?:string)=>newChat&&!boundId?<Button className={className} disabled={busy||!ready2go} onClick={()=>void openAndStart()}><Play/>{l(`Open ${peerName} and start`,`Abrir ${peerName} y empezar`)}</Button>
  :<Button className={className} disabled={busy||!chosen||!ready2go} onClick={()=>void start()}><Play/>{l('Start','Empezar')}</Button>;
 const cancel=onCancel&&!proposal&&<Button variant="ghost" onClick={onCancel}>{l('Cancel','Cancelar')}</Button>;
 const chatPicker=ready.length===0?<p className="text-xs text-muted-foreground">{l(`No ${peerName} chat is open in this folder.`,`No hay ningún chat de ${peerName} abierto en esta carpeta.`)}</p>
  :<NativeSelect size="sm" className="w-full" aria-label={l(`${peerName} chat`,`Chat de ${peerName}`)} value={chosen} onChange={e=>{setPeer(e.target.value);setAdvancedTicket('')}}><NativeSelectOption value="">{l('Choose…','Elige…')}</NativeSelectOption>{peers.map(p=><NativeSelectOption key={p.sessionId} value={p.sessionId} disabled={!p.symmetricDesktop}>{p.name}{p.startedAt?' · '+opened(p.startedAt):''}{p.symmetricDesktop?(p.status==='busy'?' · '+l('busy','ocupado'):''):' · '+l('reload plugin','recarga el plugin')}</NativeSelectOption>)}</NativeSelect>;
  // Built only while a new chat is being opened, which is when there is a request to show.
 const waitingBox=(request:{ticketId:string;prompt:string})=><div className="reveal space-y-3 rounded-xl border bg-muted/50 p-4 text-sm compact:space-y-2 compact:p-3">
    {ticketEnded?<><p className="font-medium">{l('That new chat request ended before it was linked.','La solicitud del chat nuevo terminó antes de vincularse.')}</p><Button size="sm" disabled={busy} onClick={()=>void startOver()}>{l('Try again','Intentar de nuevo')}</Button></>
    :<><p className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin text-primary"/>{l(`Press send in the new ${peerName} chat`,`Pulsa enviar en el chat nuevo de ${peerName}`)}</p>
     <p className="text-muted-foreground">{l('It links here on its own and the collaboration starts. You can stay in that chat.','Se vincula aquí solo y la colaboración empieza. Puedes quedarte en ese chat.')}</p>
     {other==='codex'&&candidates.length>0&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{l('Not linking? Choose the chat yourself','¿No se vincula? Elige el chat tú')}</summary><div className="mt-2 flex flex-wrap items-center gap-2"><NativeSelect size="sm" aria-label={l('New chat','Chat nuevo')} value={candidate} onChange={e=>setCandidate(e.target.value)}><NativeSelectOption value="">{l('Choose the new chat','Elige el chat nuevo')}</NativeSelectOption>{candidates.map(p=><NativeSelectOption key={p.sessionId} value={p.sessionId}>{p.name} · {opened(p.startedAt)}</NativeSelectOption>)}</NativeSelect><Button size="sm" disabled={busy||!candidate} onClick={()=>void act(async()=>{await api('desktop/tickets/bind',{id:request.ticketId,sessionId:candidate})})}>{l('Link and start','Vincular y empezar')}</Button></div></details>}
     <FirstMessage text={request.prompt}/>
     <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={()=>void startOver()}>{l('Start over','Empezar de nuevo')}</button></>}
   </div>;
 const moreOptions=<>
   <label className="flex gap-2"><input type="checkbox" checked={busyPeer} onChange={e=>setBusyPeer(e.target.checked)}/><span>{l('Start now, adding to its current reply','Empezar ya, añadiéndolo a su respuesta actual')}<span className="block text-xs text-muted-foreground">{l(`Otherwise it waits until ${peerName} finishes what it is doing.`,`Si no, espera a que ${peerName} termine lo que está haciendo.`)}</span></span></label>
   <label className="flex gap-2"><input type="checkbox" checked={initialBarrier} onChange={e=>setInitialBarrier(e.target.checked)}/>{l('Each analyses first, then they compare','Que cada uno analice primero y luego comparen')}</label>
   <details><summary className="cursor-pointer text-muted-foreground">{l('Continue earlier analyses','Continuar análisis anteriores')}</summary><div className="mt-3 space-y-3"><Label>Codex</Label><Textarea value={priorCodex} onChange={e=>setPriorCodex(e.target.value)} maxLength={32000}/><Label>Claude</Label><Textarea value={priorClaude} onChange={e=>setPriorClaude(e.target.value)} maxLength={32000}/></div></details>
   <details><summary className="cursor-pointer text-muted-foreground">{l('Implementation contract (advanced)','Contrato de implementación (avanzado)')}</summary><p className="my-2 text-xs text-muted-foreground">{l('Clean Git base; separate files or worktrees; required checks. Grants no editing permission.','Base Git limpia; archivos o worktrees separados; comprobaciones obligatorias. No da permisos de edición.')}</p><Textarea className="font-mono text-xs" rows={8} value={implementation} onChange={e=>setImplementation(e.target.value)} placeholder={JSON.stringify({strategy:'files',workspaces:{codex:{root:state.project,paths:['src/a.ts']},claude:{root:state.project,paths:['src/b.ts']}},requiredChecks:['tests']},null,2)}/></details>
   <details><summary className="cursor-pointer text-muted-foreground">{l(`Other ways to get a ${peerName} chat`,`Otras formas de conseguir un chat de ${peerName}`)}</summary><div className="mt-4"><DesktopTickets state={state} api={api} busy={busy} act={act} onBound={(id,ticket)=>{setNewChat(false);setPeer(id);setAdvancedTicket(ticket)}} onNotice={()=>{}}/></div></details>
  </>;

 const messagesShortcut=<MessagesShortcut value={messages} onChange={setMessages}/>,timeShortcut=<TimeShortcut value={minutes} onChange={setMinutes}/>;
 
 // The small window fills its height with only what starting needs: the objective, two switches,
 // two limits and a wide start button. Everything else waits behind Options.
 // The fieldset only disables; it renders as contents because a fieldset box does not hand its height on.
 if(compact)return <div className="reveal flex min-h-[calc(100dvh-24px-var(--bar,0px))] min-w-0 flex-col gap-3"><fieldset disabled={busy} className="contents">
  {proposal&&<div className="flex items-center justify-between gap-3"><p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><Sparkles className="size-3.5 text-primary"/>{suggested}</p><Button variant="ghost" size="sm" className="-mr-2 h-7 text-primary hover:text-primary" disabled={busy} onClick={()=>void dismiss()}>{l('Dismiss','Descartar')}</Button></div>}
  <textarea id="objective" aria-label={l('What should they work on?','¿En qué tienen que trabajar?')} className="min-h-20 w-full flex-1 resize-none rounded-2xl bg-card px-4 py-3 text-[15px] leading-relaxed shadow-tile outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40" value={objective} onChange={e=>setObjective(e.target.value)} maxLength={16000} placeholder={l('E.g. Review the panel design together and propose improvements.','Ej.: Revisad juntos el diseño del panel y proponed mejoras.')}/>
  <div className="grid grid-cols-2 gap-3">
   <Choice checked={newChat} onChange={v=>{setNewChat(v);if(!v)autoStart.current=false}} title={l(`New ${peerName} chat`,`Chat nuevo de ${peerName}`)} detail={newChat?l('Opens with the first message ready.','Se abre con el primer mensaje listo.'):undefined}>
    {!newChat&&<div className="mt-2">{chatPicker}</div>}
   </Choice>
   <Choice checked={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})} title={l(`${peerName} can edit and commit`,`${peerName} puede editar y hacer commits`)} detail={edit.enabled?undefined:l('Read and discuss only.','Solo leer y debatir.')}>
    {edit.enabled&&<div className="mt-1"><Scope value={edit.scope} summary={editSummary(edit.scope)} onChange={scope=>setEdit({...edit,scope})} editing={scopeOpen} setEditing={setScopeOpen} rules={scopeRules()}/></div>}
   </Choice>
  </div>
  <div className="grid grid-cols-2 gap-3">
   <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3.5 shadow-tile"><div><p className="text-[14px] font-medium tracking-[-0.01em]">{l('Messages','Mensajes')}</p>{messagesShortcut}</div><MessagesControl value={messages} onChange={setMessages} className="h-9 w-40 rounded-full bg-muted"/></div>
   <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-3.5 shadow-tile"><div><p className="text-[14px] font-medium tracking-[-0.01em]">{l('Time','Tiempo')}</p>{timeShortcut}</div><TimeControl value={minutes} onChange={setMinutes} className="h-9 w-40 rounded-full bg-muted"/></div>
  </div>
  {waiting&&opening?waitingBox(opening):<div className="flex items-center gap-2">{startButton('h-11 flex-1 rounded-xl text-[15px] font-semibold shadow-sm')}{cancel}<Button variant="ghost" className="h-11 rounded-xl" aria-expanded={more} onClick={()=>setMore(!more)}><SlidersHorizontal/>{l('Options','Opciones')}</Button></div>}
  {more&&<div className="reveal space-y-3 border-t pt-3 text-sm">{moreOptions}</div>}
 </fieldset></div>;

 return <div className={`reveal space-y-6 rounded-xl border bg-card p-6 shadow-sm ${proposal?'border-primary/40':''}`}>
  <fieldset disabled={busy} className="min-w-0 space-y-6">
  {proposal&&<div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-primary/20 bg-primary/[.06] px-6 py-3"><div><p className="text-sm font-medium text-primary">{suggested}</p><p className="text-xs text-muted-foreground">{l('Nothing happens until you press start.','No pasa nada hasta que pulses empezar.')}</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void dismiss()}>{l('Dismiss','Descartar')}</Button></div>}
  <div className="space-y-2"><Label htmlFor="objective">{l('What should they work on?','¿En qué tienen que trabajar?')}</Label>{objectiveField('')}</div>

  <div className="grid items-start gap-3 sm:grid-cols-2">
   <Choice checked={newChat} onChange={v=>{setNewChat(v);if(!v)autoStart.current=false}} title={l(`Open a new ${peerName} chat`,`Abrir un chat nuevo de ${peerName}`)} detail={newChat?l('Opens in this folder with the first message ready; you press send.','Se abre en esta carpeta con el primer mensaje listo; tú pulsas enviar.'):l('Work with a chat that is already open.','Trabajar con un chat que ya está abierto.')}>
    {!newChat&&<div className="mt-3">{chatPicker}</div>}
   </Choice>
   <Choice checked={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})} title={l(`${peerName} can edit and commit`,`${peerName} puede editar y hacer commits`)} detail={edit.enabled?undefined:l('Read and discuss only.','Solo leer y debatir.')}>
    {edit.enabled&&<div className="mt-1"><Scope value={edit.scope} onChange={scope=>setEdit({...edit,scope})} editing={scopeOpen} setEditing={setScopeOpen} rules={scopeRules()}/></div>}
   </Choice>
  </div>

  <div className="grid grid-cols-2 gap-3 sm:max-w-md">
   <div className="space-y-1.5"><div className="flex items-center justify-between gap-2"><Label>{l('Messages','Mensajes')}</Label>{messagesShortcut}</div><MessagesControl value={messages} onChange={setMessages} className="h-10 rounded-lg border bg-background"/></div>
   <div className="space-y-1.5"><div className="flex items-center justify-between gap-2"><Label>{l('Time','Tiempo')}</Label>{timeShortcut}</div><TimeControl value={minutes} onChange={setMinutes} className="h-10 rounded-lg border bg-background"/></div>
  </div>

  {waiting&&opening?waitingBox(opening):<div className="flex flex-wrap items-center gap-2">{startButton()}{cancel}</div>}

  <details className="border-t pt-4 text-sm"><summary className="cursor-pointer select-none text-muted-foreground">{l('More options','Más opciones')}</summary><div className="mt-4 space-y-4">{moreOptions}</div></details>
  </fieldset>
 </div>;
}

function RunView({run,api,busy,act,onBack,waitingSince,ended,onNotice}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onBack:()=>void;waitingSince?:number;ended?:string;onNotice:(text:string)=>void}){
 const peer=providerName(otherOf(run));
 const [closing,setClosing]=useState(false),[summary,setSummary]=useState(''),[disposition,setDisposition]=useState('proposal'),[inspection,setInspection]=useState<{hash:string;ready:boolean;reasons:string[]}|null>(null),[edit,setEdit]=useState<EditChoice>({enabled:false,scope:defaultScope()});
 useDraft({summary:closing?summary.trim():'',edit:edit.enabled?edit:null});
 const control=(action:string,extra:Record<string,unknown>={})=>act(async()=>{await api('desktop/control',{runId:run.id,commandId:crypto.randomUUID(),expectedRevision:run.coordination.revision,control:{action,...extra}})});
 const finish=()=>control('finish',{closure:{summary:summary.trim()||l('Closed from the panel without a final proposal.','Cerrada desde el panel sin propuesta final.'),disposition:summary.trim()?disposition:'incomplete'}}).then(()=>setClosing(false));
 const exportRun=()=>act(async()=>{const value=await api<{content:string}>('desktop/export',{runId:run.id,format:'markdown'});const url=URL.createObjectURL(new Blob([value.content],{type:'text/markdown'})),a=document.createElement('a');a.href=url;a.download=`desktop-${run.id}.md`;a.click();URL.revokeObjectURL(url)});
 const inFlight=run.messages.some(m=>['reserved','submitting','unknown'].includes(m.status)),leaseLive=run.state==='active'&&!!run.coordination.lease.expiresAt&&run.coordination.lease.expiresAt>Date.now();
 const closure=run.coordination.structured.closure,moves=(run.events??[]).filter(e=>e.type==='project_revision_moved');
 // The small window folds the back link into the title row and puts the summary beside the controls.
 const compact=useCompact(),size=compact?'sm':'default';
 return <div className="mx-auto max-w-3xl space-y-6 compact:space-y-3">
  {!compact&&<button onClick={onBack} className="pressable -ml-2 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4"/>{l('All collaborations','Todas las colaboraciones')}</button>}
  <div className="space-y-3 compact:space-y-2"><div className="flex items-start justify-between gap-4 compact:items-center compact:gap-2">{compact&&<Button variant="ghost" size="icon" className="-ml-2 size-7 shrink-0" aria-label={l('All collaborations','Todas las colaboraciones')} title={l('All collaborations','Todas las colaboraciones')} onClick={onBack}><ArrowLeft/></Button>}<h1 className="text-xl font-semibold leading-snug compact:line-clamp-2 compact:flex-1 compact:text-sm" title={run.context.objective}>{run.context.objective}</h1>{needsApproval(run)?<Badge className="bg-warning text-warning-foreground">{l('Needs approval','Requiere aprobación')}</Badge>:<RunState state={run.state}/>}</div>
   <div className="space-y-3 compact:flex compact:flex-wrap compact:items-center compact:justify-between compact:gap-2 compact:space-y-0">
   <p className="text-sm text-muted-foreground compact:text-xs">{providerName(run.initiator.provider)} ↔ {providerName(run.initiator.provider==='claude'?'codex':'claude')} · {run.messagesUsed}/{run.limits.maxMessages??'∞'} {l('messages','mensajes')}{run.deadline&&!terminal(run.state)?' · '+l('ends at','termina a las')+' '+new Date(run.deadline).toLocaleTimeString(getLanguage(),{hour:'2-digit',minute:'2-digit'}):''}</p>
   <div className="flex flex-wrap items-center gap-2 compact:gap-1">
    {run.state==='prepared'&&!waitingSince&&<Button size={size} disabled={busy||edit.enabled&&!edit.scope.trim()} onClick={()=>void act(async()=>{onNotice(startedNotice(await approveAndStart(api,run,edit),peer))})}><Play/>{needsApproval(run)?l('Approve and start','Aprobar e iniciar'):l('Start','Iniciar')}</Button>}
    {run.state==='prepared'&&!!waitingSince&&<><span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary"/>{l(`Waiting for ${peer} to finish its current reply · since ${ago(waitingSince)}`,`Esperando a que ${peer} termine su respuesta actual · desde ${ago(waitingSince)}`)}</span><Button variant="outline" size="sm" disabled={busy} onClick={()=>void act(async()=>{await api('desktop/start_when_idle',{runId:run.id,commandId:crypto.randomUUID(),cancel:true})})}>{l('Stop waiting','Dejar de esperar')}</Button></>}
    {run.state==='prepared'&&!waitingSince&&ended&&<p className="w-full text-sm text-warning">{endedReason(ended,peer)}</p>}
    {run.state==='active'&&<Button size={size} variant="outline" disabled={busy} onClick={()=>void control('pause')}><Pause/>{l('Pause','Pausar')}</Button>}
    {run.state==='paused'&&<Button size={size} disabled={busy||inFlight} onClick={()=>void control('resume')}><Play/>{l('Resume','Reanudar')}</Button>}
    {['active','paused','blocked','recovery_required'].includes(run.state)&&!leaseLive&&run.state!=='paused'&&<Button size={size} variant="outline" disabled={busy} onClick={()=>void control('recover')}><RefreshCw/>{l('Recover','Recuperar')}</Button>}
    {!terminal(run.state)&&run.state!=='prepared'&&<Button size={size} variant="outline" disabled={busy} onClick={()=>setClosing(!closing)}><Check/>{l('Finish','Finalizar')}</Button>}
    {!terminal(run.state)&&<Button size={size} variant="ghost" disabled={busy} onClick={()=>void control('cancel')}>{run.state==='prepared'?l('Discard','Descartar'):l('Cancel','Cancelar')}</Button>}
    <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void exportRun()}><Download/>{l('Export','Exportar')}</Button>
   </div></div>
   {closing&&<div className="reveal space-y-3 rounded-lg border bg-card p-4"><Label htmlFor="closing">{l('Outcome (optional)','Resultado (opcional)')}</Label><Textarea id="closing" rows={3} maxLength={4000} value={summary} onChange={e=>setSummary(e.target.value)} placeholder={l('What did they conclude?','¿A qué conclusión llegaron?')}/><div className="flex flex-wrap items-center gap-2"><NativeSelect size="sm" value={disposition} onChange={e=>setDisposition(e.target.value)}><NativeSelectOption value="proposal">{l('Proposal','Propuesta')}</NativeSelectOption><NativeSelectOption value="with_disagreements">{l('With disagreements','Con desacuerdos')}</NativeSelectOption><NativeSelectOption value="incomplete">{l('Incomplete','Incompleta')}</NativeSelectOption></NativeSelect><Button size="sm" disabled={busy} onClick={()=>void finish()}>{l('Finish','Finalizar')}</Button></div></div>}
  </div>
  {!terminal(run.state)&&<EditAuthorization run={run} api={api} busy={busy} act={act} edit={edit} setEdit={setEdit}/>}
  {closure&&<div className="rounded-xl border border-success/25 bg-success/[.06] p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l('Outcome','Resultado')} · {({proposal:l('Proposal','Propuesta'),with_disagreements:l('With disagreements','Con desacuerdos'),incomplete:l('Incomplete','Incompleta')} as Record<string,string>)[closure.closure.disposition]??closure.closure.disposition}</p><p className="mt-2 whitespace-pre-wrap">{closure.closure.summary}</p>{closure.disagreements.map((text,i)=><p className="mt-2 text-sm text-muted-foreground" key={i}>• {text}</p>)}</div>}
  {run.reason==='finish_participant_closed'&&<p className="text-sm text-muted-foreground">{l(`Finished after the ${peer} chat had closed.`,`Finalizada cuando el chat de ${peer} ya estaba cerrado.`)}</p>}
  {run.reason&&!closure&&!['finish','cancel','finish_participant_closed'].includes(run.reason)&&<p className="text-sm text-muted-foreground">{run.reason}</p>}
  {moves.length>0&&<p className="text-sm text-muted-foreground">{l(`The folder changed outside this collaboration ${moves.length===1?'once':moves.length+' times'} (last ${ago(moves.at(-1)!.at)}). It kept going; the chats were told with the next message.`,`La carpeta cambió fuera de esta colaboración ${moves.length===1?'una vez':moves.length+' veces'} (la última ${ago(moves.at(-1)!.at)}). Siguió adelante; se avisó a los chats en el siguiente mensaje.`)}</p>}
  {run.coordination.structured.structured&&<p className="text-sm text-muted-foreground">{run.coordination.barrierOpen?l('Both analyses are in; they can compare now.','Los dos análisis están listos; ya pueden comparar.'):l('Waiting for both independent analyses.','Esperando los dos análisis independientes.')}</p>}
  {run.implementation&&<div className="space-y-2 rounded-xl border p-4 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-medium">{l('Implementation','Implementación')}</p><Button variant="outline" size="sm" disabled={busy} onClick={()=>void act(async()=>{const value=await api<{ready:boolean;reasons:string[];candidate:{contentHash:string}|null}>('desktop/implementation',{runId:run.id,operationId:crypto.randomUUID(),action:{action:'inspect'}});setInspection({hash:value.candidate?.contentHash??'',ready:value.ready,reasons:value.reasons})})}>{l('Check readiness','Comprobar si está lista')}</Button></div><p className="text-muted-foreground">{run.implementation.candidate?`${l('Version','Versión')} ${run.implementation.candidate.version}`:l('No candidate yet','Todavía no hay candidato')}{run.implementation.checks.length?' · '+run.implementation.checks.map(c=>`${c.name} ${c.exitCode===0?'✓':'✗'}`).join(' · '):''}</p>{inspection&&inspection.hash===run.implementation.candidate?.contentHash&&<div><p>{inspection.ready?l('Ready to integrate right now.','Lista para integrar ahora mismo.'):l('Not ready yet:','Todavía no está lista:')}</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{inspection.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}</div>}
  <div className="space-y-3">{run.messages.length===0&&!closure&&<p className="py-8 text-center text-sm text-muted-foreground compact:py-4">{terminal(run.state)?l('No messages were sent.','No se envió ningún mensaje.'):run.state==='prepared'?l('Nothing has been sent yet.','Todavía no se ha enviado nada.'):l('Waiting for the first message…','Esperando el primer mensaje…')}</p>}
   {run.messages.map(m=>{const mine=m.src.provider===run.initiator.provider;return <div key={m.id} className={`flex ${mine?'justify-start':'justify-end'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 compact:px-3 compact:py-2 ${mine?'rounded-tl-sm bg-card border':'rounded-tr-sm bg-primary/10'}`}><p className="mb-1 text-xs text-muted-foreground"><strong className="text-foreground">{providerName(m.src.provider)}</strong> · {delivery()[m.status]??m.status}</p><p className="whitespace-pre-wrap break-words text-sm">{m.text??l('Content withheld until both analyses are in','Contenido retenido hasta tener ambos análisis')}</p></div></div>})}
   {run.reports.map(r=><div key={r.id} className="rounded-xl border-l-4 border-primary bg-card p-4 compact:p-3"><p className="mb-1 text-xs text-muted-foreground"><strong className="text-foreground">{r.author.startsWith('codex')?'Codex':r.author.startsWith('claude')?'Claude':r.author}</strong> · {({response:l('Report','Informe'),result:l('Result','Resultado'),review:l('Review','Revisión')} as Record<string,string>)[r.report.kind]??r.report.kind}{r.report.version?` v${r.report.version}`:''}{r.report.verdict?' · '+(({agree:l('agrees','de acuerdo'),revise:l('asks for changes','pide cambios'),disagree:l('disagrees','en desacuerdo')} as Record<string,string>)[r.report.verdict]??r.report.verdict):''}</p><p className="whitespace-pre-wrap text-sm">{r.body}</p></div>)}
  </div>
 </div>;
}
