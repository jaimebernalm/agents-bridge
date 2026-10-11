import {useEffect,useRef,useState} from 'react';
import {getLanguage,useLanguage} from './lib/i18n';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {Badge} from '@/components/ui/badge';
import {Alert,AlertDescription} from '@/components/ui/alert';
import {Play,Pause,RefreshCw,Download,Plus,Minus,Check,ArrowLeft,ChevronRight,X,Loader2} from 'lucide-react';
import {DesktopTickets,FirstMessage,openNewChat} from './DesktopTickets';
import {Switch} from '@/components/ui/switch';
import {serializedRefresh} from './lib/live-refresh';
import {State as RunState,providerName} from './RunState';
import {syncEditAuthorization,type EditChoice} from './lib/collaboration-form';

const l=(en:string,es:string)=>getLanguage()==='es'?es:en;
type Principal={provider:'codex'|'claude';sessionId:string};
type Peer=Principal&{name:string;cwd:string;status:string;symmetricDesktop:boolean;eligibleSurface:boolean;startedAt:number|null};
type Run={id:string;createdAt:number;initiator:Principal;state:string;reason:string|null;context:{objective:string;constraints:string[];references:string[];priorAnalysis:{codex?:string;claude?:string}};contextVersion:number;deadline:number|null;limits:{maxMessages:number|null;maxSeconds:number};messagesUsed:number;coordination:{revision:number;barrierOpen:boolean;structured:{structured:boolean;phase?:string;tasks?:{id:string;assignee:string;state:string;task:{intent:string}}[];closure?:{consensus:string;derivedReviewState:string;closure:{summary:string;disposition:string};disagreements:string[]}|null};lease:{epoch:number;expiresAt:number|null}};messages:{id:string;src:Principal;dst:Principal;text:string|null;status:string}[];reports:{id:string;author:string;body:string;report:{kind:string;version?:number;verdict?:string}}[];results:{author:string;report:{resultId:string;version:number;title:string}}[];implementation:{candidate:{contentHash:string;resultId:string;version:number}|null;checks:{name:string;exitCode:number;executedByCore:false}[];plan:{requiredChecks:string[]}}|null;reviews:{id:string;current:boolean;targetHash:string|null}[];validatedConsensus:false;consent:{valid:boolean;actor:string|null;expiresAt:number|null;coversLaterContexts?:boolean};editAuthorization?:{valid:boolean;grantee:Principal|null;scope:string|null;revokedAt:number|null};preflight?:{readyForCheck:boolean;message:string};events?:{type:string;at:number}[]};
type Ticket={id:string;adapter:string;targetProvider:string;project:string;state:string;revision:number;correlationId:string|null;createdAt:number;expiresAt:number;bound:{sessionId:string}|null;reason:string|null};
type Proposal={id:string;requester:Principal;createdAt:number;objective:string;newChat:boolean;peerId?:string;allowEdits:boolean;editScope?:string;maxMessages:number|null;minutes:number;initialBarrier:boolean};
type State={principal:Principal;project:string;runs:Run[];participants:Peer[];proposals?:Proposal[];tickets:Ticket[];grants:{id:string;targetProvider:string;adapter:string;revokedAt:number|null;expiresAt:number|null}[];bindingErrors?:Record<string,string>};
type Api=<T>(path:string,body?:unknown)=>Promise<T>;
const defaultScope=()=>l('Implement the agreed plan in this project: edit files and make local commits. No push, pull requests or merges.','Implementar el plan acordado en este proyecto: editar archivos y hacer commits locales. Sin push, PR ni merges.');
const otherOf=(r:Run)=>r.initiator.provider==='claude'?'codex':'claude';
const needsApproval=(r:Run)=>r.state==='prepared'&&r.initiator.provider==='claude'&&!r.consent.valid;
const terminal=(state:string)=>['completed','cancelled','limit_reached'].includes(state);
const opened=(ms:number|null)=>ms?new Date(ms).toLocaleString(getLanguage(),{weekday:'short',hour:'2-digit',minute:'2-digit'}):'';
const ago=(ms:number)=>{const m=Math.round((Date.now()-ms)/60000);return m<1?l('just now','ahora'):m<60?l(`${m} min ago`,`hace ${m} min`):new Date(ms).toLocaleString(getLanguage(),{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})};
const delivery=():Record<string,string>=>({reserved:l('Queued','En cola'),submitting:l('Sending','Enviando'),'socket-written':l('Sent','Enviado'),started:l('Delivered','Entregado'),steered:l('Delivered','Entregado'),delivered:l('Delivered','Entregado'),consumed:l('Read','Leído'),held:l('Held by the other chat','Retenido por el otro chat'),denied:l('Denied','Denegado'),expired:l('Expired','Caducado'),unknown:l('Uncertain — not resent','Incierto — no se reenvía')});

export function DesktopCollaboration({api,onError,initialRun=''}:{api:Api;onError:(s:string)=>void;initialRun?:string}){
 useLanguage();
 const [state,setState]=useState<State|null>(null),[selected,setSelectedRun]=useState(''),[composing,setComposing]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[direction,setDirection]=useState<'forward'|'back'|null>(null);
 // Remember which way the user travelled so the next view enters along that path.
 const setSelected=(id:string)=>{setDirection(id?'forward':'back');setSelectedRun(id)};
 const refresh=useRef<()=>Promise<void>>(()=>Promise.resolve()),focused=useRef(false),actionLock=useRef(false);
 useEffect(()=>{let alive=true;const worker=serializedRefresh(async()=>{try{const value=await api<State>('desktop/state');if(alive)setState(value)}catch(e){if(alive)onError((e as Error).message)}});refresh.current=worker.request;void worker.request();const timer=setInterval(()=>void worker.request(),2500),focus=()=>{if(document.visibilityState==='visible')void worker.request()};window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{alive=false;worker.stop();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)}},[api,onError]);
 // A focus link opens on its run once; later selections are the human's.
 useEffect(()=>{if(focused.current||!state||!initialRun)return;focused.current=true;if(state.runs.some(r=>r.id===initialRun))setSelected(initialRun)},[state,initialRun]);
 useEffect(()=>{window.scrollTo({top:0})},[selected,composing]);
 const act=async(fn:()=>Promise<void>)=>{if(actionLock.current)return;actionLock.current=true;setBusy(true);try{onError('');await fn();await refresh.current()}catch(e){onError((e as Error).message)}finally{actionLock.current=false;setBusy(false)}};
 if(!state)return <p className="text-muted-foreground">{l('Loading…','Cargando…')}</p>;
 const run=state.runs.find(r=>r.id===selected),other=state.principal.provider==='codex'?'claude':'codex';
 const toast=notice&&<Alert role="status" className="toast fixed right-6 top-20 z-50 max-w-md"><AlertDescription className="flex items-start justify-between gap-3">{notice}<button className="pressable -m-1.5 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>setNotice('')} aria-label={l('Close','Cerrar')}><X className="size-3.5"/></button></AlertDescription></Alert>;
 if(run)return <>{toast}<div key={run.id} className={direction==='forward'?'view-forward':''}><RunView run={run} api={api} busy={busy} act={act} onBack={()=>setSelected('')}/></div></>;
 // A chat's suggestion opens the form prefilled; the person decides from there.
 // One chat runs one collaboration at a time; while it is busy, new ones start from another chat.
 const ownerBusy=state.runs.find(r=>['active','paused','blocked'].includes(r.state)),own=providerName(state.principal.provider);
 const approvals=state.runs.filter(needsApproval),proposal=state.proposals?.[0],showComposer=!ownerBusy&&(composing||state.runs.length===0||!!proposal);
 return <div className={`mx-auto max-w-3xl space-y-6 ${direction==='back'?'view-back':''}`}>{toast}
  {approvals.map(r=><ApprovalCard key={r.id} run={r} api={api} busy={busy} act={act} onDetails={()=>setSelected(r.id)}/>)}
  <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold tracking-tight">{l('Collaborations','Colaboraciones')}</h1>{!showComposer&&!ownerBusy&&<Button onClick={()=>setComposing(true)}><Plus/>{l('New','Nueva')}</Button>}</div>
  {ownerBusy&&<div className="reveal flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm shadow-sm"><div className="min-w-0 flex-1"><p className="font-medium">{l(`This ${own} chat is busy with a collaboration`,`Este chat de ${own} está ocupado con una colaboración`)}</p><p className="mt-1 text-muted-foreground">{l(`This panel belongs to it and it is working on “${ownerBusy.context.objective}”. To start another collaboration, open a new ${own} chat and ask there.`,`Este panel le pertenece y está trabajando en «${ownerBusy.context.objective}». Para empezar otra colaboración, abre un chat nuevo de ${own} y pídela allí.`)}</p></div><Button variant="outline" disabled={busy} onClick={()=>void act(async()=>{await api('desktop/apps/new_chat',{})})}><Plus/>{l(`Open a new ${own} chat`,`Abrir un chat nuevo de ${own}`)}</Button></div>}
  {showComposer&&<Composer key={proposal?.id??'blank'} proposal={proposal} state={state} other={other} api={api} busy={busy} act={act} onCancel={state.runs.length?()=>setComposing(false):undefined} onStarted={(id,text)=>{setComposing(false);setSelected(id);setNotice(text)}}/>}
  {state.runs.length>0&&<div className="overflow-hidden rounded-xl border bg-card">{state.runs.map(r=><button key={r.id} onClick={()=>setSelected(r.id)} className="pressable flex w-full items-center gap-4 border-b px-5 py-4 text-left last:border-0 hover:bg-muted/60 active:bg-muted"><div className="min-w-0 flex-1"><p className="truncate font-medium">{r.context.objective}</p><p className="mt-0.5 text-xs text-muted-foreground">{providerName(r.initiator.provider)} ↔ {providerName(r.initiator.provider==='claude'?'codex':'claude')} · {r.messagesUsed}/{r.limits.maxMessages??'∞'} {l('messages','mensajes')} · {ago(r.createdAt)}</p></div>{needsApproval(r)?<Badge className="bg-warning text-warning-foreground">{l('Needs approval','Requiere aprobación')}</Badge>:<RunState state={r.state}/>}<ChevronRight className="size-4 text-muted-foreground"/></button>)}</div>}
 </div>;
}

// One approval covers the whole plan: later phases update this run's context instead of starting another run.
async function approveAndStart(api:Api,run:Run,edit?:EditChoice,allowBusyPeer=false){
 if(run.initiator.provider==='claude'&&!run.consent.valid)await api('desktop/consent',{runId:run.id,expectedRevision:run.coordination.revision,coversLaterContexts:true});
 if(edit)await syncEditAuthorization(api,run,edit);
 await api('desktop/start',{runId:run.id,supervised:true,allowBusyPeer});
 return api<{state:string}>('desktop/notify',{runId:run.id,commandId:crypto.randomUUID()});
}

function EditOption({peer,value,onChange}:{peer:string;value:EditChoice;onChange:(v:EditChoice)=>void}){
 return <div className="space-y-2 text-sm"><label className="flex gap-2"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/>{l(`Let ${peer} edit files and make local commits`,`Permitir que ${peer} edite archivos y haga commits locales`)}</label>
  {value.enabled&&<><Textarea rows={2} maxLength={4000} value={value.scope} onChange={e=>onChange({...value,scope:e.target.value})} aria-label={l('What it may do','Qué puede hacer')}/><p className="text-xs text-muted-foreground">{l('Covers every phase of this collaboration until you revoke it. Never covers push, pull requests, merges, deploys or paid API calls unless you write them here.','Cubre todas las fases de esta colaboración hasta que lo revoques. Nunca cubre push, PR, merges, despliegues ni llamadas de pago a APIs salvo que lo escribas aquí.')}</p></>}
 </div>;
}

function ApprovalCard({run,api,busy,act,onDetails}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onDetails:()=>void}){
 const [edit,setEdit]=useState<EditChoice>({enabled:true,scope:defaultScope()});
 return <div className="reveal space-y-4 rounded-xl border border-warning/35 bg-warning/[.07] p-5"><div><p className="text-sm font-medium text-warning">{l('Waiting for your approval','Esperando tu aprobación')}</p><p className="mt-1 text-base">{run.context.objective}</p><p className="mt-1 text-xs text-muted-foreground">{l('Covers every phase of this collaboration; you will not be asked again for the next one.','Cubre todas las fases de esta colaboración; no se te volverá a pedir para la siguiente.')}</p></div>
  <EditOption peer={providerName(otherOf(run))} value={edit} onChange={setEdit}/>
  <div className="flex gap-2"><Button disabled={busy||edit.enabled&&!edit.scope.trim()} onClick={()=>void act(async()=>{await approveAndStart(api,run,edit)})}><Play/>{l('Approve and start','Aprobar e iniciar')}</Button><Button variant="ghost" onClick={onDetails}>{l('See details','Ver detalles')}</Button></div></div>;
}

function EditAuthorization({run,api,busy,act,edit,setEdit}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;edit:EditChoice;setEdit:(v:EditChoice)=>void}){
 const peer=providerName(otherOf(run)),grant=run.editAuthorization;
 const send=(body:Record<string,unknown>)=>act(async()=>{await api('desktop/edit_authorization',{runId:run.id,expectedRevision:run.coordination.revision,...body})});
 if(grant?.valid)return <div className="space-y-2 rounded-xl border p-4 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-medium">{l(`${peer} may edit and commit locally`,`${peer} puede editar y hacer commits locales`)}</p><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void send({revoke:true})}>{l('Revoke','Revocar')}</Button></div><p className="whitespace-pre-wrap text-muted-foreground">{grant.scope}</p></div>;
 return <div className="space-y-3 rounded-xl border p-4">{grant?.revokedAt&&<p className="text-sm text-muted-foreground">{l('Editing permission revoked.','Permiso de edición revocado.')}</p>}<EditOption peer={peer} value={edit} onChange={setEdit}/>{run.state!=='prepared'&&edit.enabled&&<Button size="sm" disabled={busy||!edit.scope.trim()} onClick={()=>void send({scope:edit.scope}).then(()=>setEdit({...edit,enabled:false}))}>{l('Authorize','Autorizar')}</Button>}</div>;
}

// A setting that reads as a choice: title, consequence, and a switch on the same surface.
function Choice({checked,onChange,title,detail,children}:{checked:boolean;onChange:(v:boolean)=>void;title:string;detail:string;children?:React.ReactNode}){
 return <div className={`rounded-xl border p-4 transition-colors duration-200 ${checked?'border-primary/40 bg-primary/[.05]':'bg-background'}`}>
  <label className="flex cursor-pointer items-start justify-between gap-3"><span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{detail}</span></span><Switch className="mt-0.5" checked={checked} onCheckedChange={onChange}/></label>
  {children}
 </div>;
}

function Stepper({label,value,onChange,step,min,max,unit,action}:{label:string;value:string;onChange:(v:string)=>void;step:number;min:number;max:number;unit:string;action?:React.ReactNode}){
 const n=Number(value),limited=value!=='';
 const set=(next:number)=>onChange(String(Math.min(max,Math.max(min,next))));
 return <div className="space-y-1.5"><div className="flex items-center justify-between gap-2"><Label>{label}</Label>{action}</div>
  <div className="flex h-10 items-center rounded-lg border bg-background focus-within:ring-[3px] focus-within:ring-ring/40">
   <button type="button" className="pressable flex h-full items-center px-3 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={!limited||n<=min} aria-label={l(`Fewer ${unit}`,`Menos ${unit}`)} onClick={()=>set(n-step)}><Minus className="size-4"/></button>
   <input inputMode="numeric" aria-label={label} className="w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none placeholder:text-foreground" placeholder={l('No limit','Sin límite')} value={value} onChange={e=>onChange(e.target.value.replace(/\D/g,''))}/>
   {limited&&<span className="pr-1 text-xs text-muted-foreground">{unit}</span>}
   <button type="button" className="pressable flex h-full items-center px-3 text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={limited&&n>=max} aria-label={l(`More ${unit}`,`Más ${unit}`)} onClick={()=>set(limited?n+step:min)}><Plus className="size-4"/></button>
  </div></div>;
}

function Composer({proposal,state,other,api,busy,act,onCancel,onStarted}:{proposal?:Proposal;state:State;other:string;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onCancel?:()=>void;onStarted:(id:string,notice:string)=>void}){
 const peers=state.participants.filter(p=>p.provider===other&&p.cwd===state.project&&p.eligibleSurface),ready=peers.filter(p=>p.symmetricDesktop),peerName=providerName(other);
 // Defaults: a fresh chat for each collaboration, allowed to edit and commit locally.
 const [newChat,setNewChat]=useState(proposal?.newChat??true),[peer,setPeer]=useState(proposal?.peerId??''),[objective,setObjective]=useState(proposal?.objective??''),[messages,setMessages]=useState(proposal?(proposal.maxMessages===null?'':String(proposal.maxMessages)):'24'),[minutes,setMinutes]=useState(String(proposal?.minutes??30)),[busyPeer,setBusyPeer]=useState(false),[initialBarrier,setInitialBarrier]=useState(proposal?.initialBarrier??false),[priorCodex,setPriorCodex]=useState(''),[priorClaude,setPriorClaude]=useState(''),[implementation,setImplementation]=useState(''),[advancedTicket,setAdvancedTicket]=useState(''),[edit,setEdit]=useState<EditChoice>({enabled:proposal?.allowEdits??true,scope:proposal?.editScope??defaultScope()}),[scopeOpen,setScopeOpen]=useState(!!proposal?.editScope),[opening,setOpening]=useState<{ticketId:string;prompt:string}|null>(null),[candidate,setCandidate]=useState('');
 const request=useRef<{payload:string;id:string;notifyId:string}|null>(null),openRequest=useRef(crypto.randomUUID()),autoStart=useRef(false);
 const ticket=opening?state.tickets.find(t=>t.id===opening.ticketId):undefined,boundId=ticket?.bound?.sessionId??'',ticketEnded=!!ticket&&['failed','expired','cancelled'].includes(ticket.state);
 const candidates=ticket&&!ticket.bound?peers.filter(p=>p.symmetricDesktop&&p.startedAt!==null&&p.startedAt>=ticket.createdAt):[];
 const chosen=newChat?boundId:(peer||(ready.length===1?ready[0]!.sessionId:''));
 const ticketId=newChat?(boundId?opening!.ticketId:''):advancedTicket;
 const limits=()=>{const maxMessages=messages===''?null:Number(messages),maxSeconds=Number(minutes)*60;if(maxMessages!==null&&(!Number.isSafeInteger(maxMessages)||maxMessages<2)||!Number.isInteger(maxSeconds)||maxSeconds<60)throw new Error(l('Enter valid limits: at least 2 messages and 1 minute.','Indica límites válidos: al menos 2 mensajes y 1 minuto.'));return {maxMessages,maxSeconds}};
 const ready2go=!!objective.trim()&&(!edit.enabled||!!edit.scope.trim());
 const start=()=>act(async()=>{if(!objective.trim()||!chosen)throw new Error(l('Choose a conversation and an objective.','Elige una conversación y un objetivo.'));if(edit.enabled&&!edit.scope.trim())throw new Error(l('Describe what it may edit first.','Describe primero qué puede editar.'));
  const payload={peerId:chosen,context:{objective:objective.trim(),constraints:[],references:[],priorAnalysis:{...(priorCodex.trim()?{codex:priorCodex}:{}),...(priorClaude.trim()?{claude:priorClaude}:{})}},limits:limits(),routine:{mode:'free'},...(initialBarrier?{coordination:{initialBarrier:true}}:{}),...(ticketId?{ticketId}:{}),...(implementation.trim()?{implementation:JSON.parse(implementation)}:{}),openPanel:false};
  const key=JSON.stringify(payload);if(request.current?.payload!==key)request.current={payload:key,id:crypto.randomUUID(),notifyId:crypto.randomUUID()};
  const prepared=await api<Run>('desktop/prepare',{...payload,requestId:request.current.id});
  if(proposal)await api('desktop/proposal_resolve',{id:proposal.id,state:'used'}).catch(()=>{});
  // A human pressing start here is the approval itself for a Claude-initiated run.
  if(prepared.preflight&&!prepared.preflight.readyForCheck&&(prepared.initiator.provider!=='claude'||prepared.consent.valid)){onStarted(prepared.id,l('Prepared. Check the details before starting.','Preparada. Revisa los detalles antes de iniciarla.'));return;}
  if(prepared.initiator.provider==='claude'&&!prepared.consent.valid)await api('desktop/consent',{runId:prepared.id,expectedRevision:prepared.coordination.revision,coversLaterContexts:true});
  await syncEditAuthorization(api,prepared,edit);
  await api('desktop/start',{runId:prepared.id,supervised:true,allowBusyPeer:busyPeer});
  const job=await api<{state:string}>('desktop/notify',{runId:prepared.id,commandId:request.current.notifyId});
  onStarted(prepared.id,job.state==='unknown'?l('Started, but the chat could not be woken for sure. Open it to check.','Iniciada, pero no se pudo confirmar el aviso al chat. Ábrelo para comprobarlo.'):l('Started. Both chats are working on it.','Iniciada. Los dos chats ya están en ello.'))});
 // The person asked to start when they opened the new chat; start as soon as it is linked.
 // A new chat is still answering its first message right after it links; start once it is idle.
 const boundIdle=!!boundId&&(busyPeer||state.participants.find(p=>p.sessionId===boundId)?.status==='idle');
 useEffect(()=>{if(autoStart.current&&boundIdle&&!busy){autoStart.current=false;void start()}},[boundIdle,busy]);
 const openAndStart=()=>act(async()=>{if(!objective.trim())throw new Error(l('Write what they should work on first.','Escribe primero en qué tienen que trabajar.'));limits();
  const opened=await openNewChat(api,state.project,other,openRequest.current);openRequest.current=crypto.randomUUID();autoStart.current=true;setOpening({ticketId:opened.ticket.id,prompt:opened.bootstrapPrompt})});
 const startOver=()=>act(async()=>{autoStart.current=false;if(ticket&&!ticket.bound&&!ticketEnded&&ticket.state!=='creating')await api('desktop/tickets/cancel',{id:ticket.id});setOpening(null);setCandidate('')});

 const dismiss=()=>act(async()=>{if(proposal)await api('desktop/proposal_resolve',{id:proposal.id,state:'dismissed'});onCancel?.()});
 const suggester=proposal?providerName(proposal.requester.provider):'';
 return <div className={`reveal space-y-6 rounded-xl border bg-card p-6 shadow-sm ${proposal?'border-primary/40':''}`}>
  <fieldset disabled={busy} className="min-w-0 space-y-6">
  {proposal&&<div className="-mx-6 -mt-6 flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-primary/20 bg-primary/[.06] px-6 py-3"><div><p className="text-sm font-medium text-primary">{l(`Suggested by ${suggester} · ${ago(proposal.createdAt)}`,`Sugerida por ${suggester} · ${ago(proposal.createdAt)}`)}</p><p className="text-xs text-muted-foreground">{l('Change anything below. Nothing happens until you press start.','Cambia lo que quieras. No pasa nada hasta que pulses empezar.')}</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void dismiss()}>{l('Dismiss','Descartar')}</Button></div>}
  <div className="space-y-2"><Label htmlFor="objective">{l('What should they work on?','¿En qué tienen que trabajar?')}</Label><Textarea id="objective" value={objective} onChange={e=>setObjective(e.target.value)} rows={3} maxLength={16000} placeholder={l('E.g. Review the panel design together and propose improvements.','Ej.: Revisad juntos el diseño del panel y proponed mejoras.')}/></div>

  <div className="grid items-start gap-3 sm:grid-cols-2">
   <Choice checked={newChat} onChange={v=>{setNewChat(v);if(!v)autoStart.current=false}} title={l(`Open a new ${peerName} chat`,`Abrir un chat nuevo de ${peerName}`)} detail={newChat?l(`${peerName} opens in this folder with the first message ready. You press send.`,`${peerName} se abre en esta carpeta con el primer mensaje listo. Tú pulsas enviar.`):l('Work with a chat that is already open.','Trabajar con un chat que ya está abierto.')}>
    {!newChat&&<div className="mt-3">{ready.length===0?<p className="text-xs text-muted-foreground">{l(`No ${peerName} chat is open in this folder.`,`No hay ningún chat de ${peerName} abierto en esta carpeta.`)}</p>
     :<NativeSelect size="sm" className="w-full" aria-label={l(`${peerName} chat`,`Chat de ${peerName}`)} value={chosen} onChange={e=>{setPeer(e.target.value);setAdvancedTicket('')}}><NativeSelectOption value="">{l('Choose…','Elige…')}</NativeSelectOption>{peers.map(p=><NativeSelectOption key={p.sessionId} value={p.sessionId} disabled={!p.symmetricDesktop}>{p.name}{p.startedAt?' · '+opened(p.startedAt):''}{p.symmetricDesktop?(p.status==='busy'?' · '+l('busy','ocupado'):''):' · '+l('reload plugin','recarga el plugin')}</NativeSelectOption>)}</NativeSelect>}</div>}
   </Choice>
   <Choice checked={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})} title={l(`${peerName} can edit and commit`,`${peerName} puede editar y hacer commits`)} detail={edit.enabled?l('Local edits and commits only. No push, pull requests or merges.','Solo ediciones y commits locales. Sin push, PR ni merges.'):l('Read and discuss only.','Solo leer y debatir.')}>
    {edit.enabled&&<div className="mt-2"><button type="button" className="text-xs font-medium text-primary hover:underline" onClick={()=>setScopeOpen(!scopeOpen)}>{scopeOpen?l('Hide details','Ocultar detalles'):l('Change what it may do','Cambiar qué puede hacer')}</button>
     {scopeOpen&&<div className="reveal mt-2 space-y-1.5"><Textarea rows={3} maxLength={4000} value={edit.scope} onChange={e=>setEdit({...edit,scope:e.target.value})} aria-label={l('What it may do','Qué puede hacer')}/><p className="text-xs text-muted-foreground">{l('Covers every phase until you revoke it. Push, PRs, merges, deploys and paid API calls only if you write them here.','Cubre todas las fases hasta que lo revoques. Push, PR, merges, despliegues y APIs de pago solo si los escribes aquí.')}</p></div>}</div>}
   </Choice>
  </div>

  <div className="grid grid-cols-2 gap-3 sm:max-w-md">
   <Stepper label={l('Messages','Mensajes')} unit={l('msgs','msjs')} value={messages} onChange={setMessages} step={4} min={2} max={500} action={<button type="button" className="text-xs text-primary hover:underline" onClick={()=>setMessages(messages===''?'24':'')}>{messages===''?l('Set a limit','Poner límite'):l('No limit','Sin límite')}</button>}/>
   <Stepper label={l('Time','Tiempo')} unit="min" value={minutes} onChange={setMinutes} step={5} min={5} max={1440}/>
  </div>

  {newChat&&opening&&boundId&&autoStart.current&&!boundIdle?<p className="reveal flex items-center gap-2 rounded-xl border bg-muted/50 p-4 text-sm"><Loader2 className="size-4 animate-spin text-primary"/>{l(`Linked. Starting as soon as ${peerName} finishes its first reply…`,`Vinculado. Empieza en cuanto ${peerName} termine su primera respuesta…`)}</p>
  :newChat&&opening&&!boundId?<div className="reveal space-y-3 rounded-xl border bg-muted/50 p-4 text-sm">
    {ticketEnded?<><p className="font-medium">{l('That new chat request ended before it was linked.','La solicitud del chat nuevo terminó antes de vincularse.')}</p><Button size="sm" disabled={busy} onClick={()=>void startOver()}>{l('Try again','Intentar de nuevo')}</Button></>
    :<><p className="flex items-center gap-2 font-medium"><Loader2 className="size-4 animate-spin text-primary"/>{l(`Press send in the new ${peerName} chat`,`Pulsa enviar en el chat nuevo de ${peerName}`)}</p>
     <p className="text-muted-foreground">{l('It links here on its own and the collaboration starts. You can stay in that chat.','Se vincula aquí solo y la colaboración empieza. Puedes quedarte en ese chat.')}</p>
     {other==='codex'&&candidates.length>0&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{l('Not linking? Choose the chat yourself','¿No se vincula? Elige el chat tú')}</summary><div className="mt-2 flex flex-wrap items-center gap-2"><NativeSelect size="sm" aria-label={l('New chat','Chat nuevo')} value={candidate} onChange={e=>setCandidate(e.target.value)}><NativeSelectOption value="">{l('Choose the new chat','Elige el chat nuevo')}</NativeSelectOption>{candidates.map(p=><NativeSelectOption key={p.sessionId} value={p.sessionId}>{p.name} · {opened(p.startedAt)}</NativeSelectOption>)}</NativeSelect><Button size="sm" disabled={busy||!candidate} onClick={()=>void act(async()=>{await api('desktop/tickets/bind',{id:opening.ticketId,sessionId:candidate})})}>{l('Link and start','Vincular y empezar')}</Button></div></details>}
     <FirstMessage text={opening.prompt}/>
     <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={()=>void startOver()}>{l('Start over','Empezar de nuevo')}</button></>}
   </div>
  :<div className="flex flex-wrap items-center gap-2">
    {newChat&&!boundId?<Button disabled={busy||!ready2go} onClick={()=>void openAndStart()}><Play/>{l(`Open ${peerName} and start`,`Abrir ${peerName} y empezar`)}</Button>
     :<Button disabled={busy||!chosen||!ready2go} onClick={()=>void start()}><Play/>{l('Start','Empezar')}</Button>}
    {onCancel&&!proposal&&<Button variant="ghost" onClick={onCancel}>{l('Cancel','Cancelar')}</Button>}
   </div>}

  <details className="border-t pt-4 text-sm"><summary className="cursor-pointer select-none text-muted-foreground">{l('More options','Más opciones')}</summary><div className="mt-4 space-y-4">
   <label className="flex gap-2"><input type="checkbox" checked={busyPeer} onChange={e=>setBusyPeer(e.target.checked)}/>{l('Start even if the other chat is busy','Empezar aunque el otro chat esté ocupado')}</label>
   <label className="flex gap-2"><input type="checkbox" checked={initialBarrier} onChange={e=>setInitialBarrier(e.target.checked)}/>{l('Each analyses first, then they compare','Que cada uno analice primero y luego comparen')}</label>
   <details><summary className="cursor-pointer text-muted-foreground">{l('Continue earlier analyses','Continuar análisis anteriores')}</summary><div className="mt-3 space-y-3"><Label>Codex</Label><Textarea value={priorCodex} onChange={e=>setPriorCodex(e.target.value)} maxLength={32000}/><Label>Claude</Label><Textarea value={priorClaude} onChange={e=>setPriorClaude(e.target.value)} maxLength={32000}/></div></details>
   <details><summary className="cursor-pointer text-muted-foreground">{l('Implementation contract (advanced)','Contrato de implementación (avanzado)')}</summary><p className="my-2 text-xs text-muted-foreground">{l('Clean Git base; separate files or worktrees; required checks. Grants no editing permission.','Base Git limpia; archivos o worktrees separados; comprobaciones obligatorias. No da permisos de edición.')}</p><Textarea className="font-mono text-xs" rows={8} value={implementation} onChange={e=>setImplementation(e.target.value)} placeholder={JSON.stringify({strategy:'files',workspaces:{codex:{root:state.project,paths:['src/a.ts']},claude:{root:state.project,paths:['src/b.ts']}},requiredChecks:['tests']},null,2)}/></details>
   <details><summary className="cursor-pointer text-muted-foreground">{l(`Other ways to get a ${peerName} chat`,`Otras formas de conseguir un chat de ${peerName}`)}</summary><div className="mt-4"><DesktopTickets state={state} api={api} busy={busy} act={act} onBound={(id,ticket)=>{setNewChat(false);setPeer(id);setAdvancedTicket(ticket)}} onNotice={()=>{}}/></div></details>
  </div></details>
  </fieldset>
 </div>;
}

function RunView({run,api,busy,act,onBack}:{run:Run;api:Api;busy:boolean;act:(fn:()=>Promise<void>)=>Promise<void>;onBack:()=>void}){
 const [closing,setClosing]=useState(false),[summary,setSummary]=useState(''),[disposition,setDisposition]=useState('proposal'),[inspection,setInspection]=useState<{hash:string;ready:boolean;reasons:string[]}|null>(null),[edit,setEdit]=useState<EditChoice>({enabled:false,scope:defaultScope()});
 const control=(action:string,extra:Record<string,unknown>={})=>act(async()=>{await api('desktop/control',{runId:run.id,commandId:crypto.randomUUID(),expectedRevision:run.coordination.revision,control:{action,...extra}})});
 const finish=()=>control('finish',{closure:{summary:summary.trim()||l('Closed from the panel without a final proposal.','Cerrada desde el panel sin propuesta final.'),disposition:summary.trim()?disposition:'incomplete'}}).then(()=>setClosing(false));
 const exportRun=()=>act(async()=>{const value=await api<{content:string}>('desktop/export',{runId:run.id,format:'markdown'});const url=URL.createObjectURL(new Blob([value.content],{type:'text/markdown'})),a=document.createElement('a');a.href=url;a.download=`desktop-${run.id}.md`;a.click();URL.revokeObjectURL(url)});
 const inFlight=run.messages.some(m=>['reserved','submitting','unknown'].includes(m.status)),leaseLive=run.state==='active'&&!!run.coordination.lease.expiresAt&&run.coordination.lease.expiresAt>Date.now();
 const closure=run.coordination.structured.closure,moves=(run.events??[]).filter(e=>e.type==='project_revision_moved');
 return <div className="mx-auto max-w-3xl space-y-6">
  <button onClick={onBack} className="pressable -ml-2 flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4"/>{l('All collaborations','Todas las colaboraciones')}</button>
  <div className="space-y-3"><div className="flex items-start justify-between gap-4"><h1 className="text-xl font-semibold leading-snug">{run.context.objective}</h1>{needsApproval(run)?<Badge className="bg-warning text-warning-foreground">{l('Needs approval','Requiere aprobación')}</Badge>:<RunState state={run.state}/>}</div>
   <p className="text-sm text-muted-foreground">{providerName(run.initiator.provider)} ↔ {providerName(run.initiator.provider==='claude'?'codex':'claude')} · {run.messagesUsed}/{run.limits.maxMessages??'∞'} {l('messages','mensajes')}{run.deadline&&!terminal(run.state)?' · '+l('ends at','termina a las')+' '+new Date(run.deadline).toLocaleTimeString(getLanguage(),{hour:'2-digit',minute:'2-digit'}):''}</p>
   <div className="flex flex-wrap items-center gap-2">
    {run.state==='prepared'&&<Button disabled={busy||edit.enabled&&!edit.scope.trim()} onClick={()=>void act(async()=>{await approveAndStart(api,run,edit)})}><Play/>{needsApproval(run)?l('Approve and start','Aprobar e iniciar'):l('Start','Iniciar')}</Button>}
    {run.state==='active'&&<Button variant="outline" disabled={busy} onClick={()=>void control('pause')}><Pause/>{l('Pause','Pausar')}</Button>}
    {run.state==='paused'&&<Button disabled={busy||inFlight} onClick={()=>void control('resume')}><Play/>{l('Resume','Reanudar')}</Button>}
    {['active','paused','blocked','recovery_required'].includes(run.state)&&!leaseLive&&run.state!=='paused'&&<Button variant="outline" disabled={busy} onClick={()=>void control('recover')}><RefreshCw/>{l('Recover','Recuperar')}</Button>}
    {!terminal(run.state)&&run.state!=='prepared'&&<Button variant="outline" disabled={busy} onClick={()=>setClosing(!closing)}><Check/>{l('Finish','Finalizar')}</Button>}
    {!terminal(run.state)&&<Button variant="ghost" disabled={busy} onClick={()=>void control('cancel')}>{run.state==='prepared'?l('Discard','Descartar'):l('Cancel','Cancelar')}</Button>}
    <Button variant="ghost" size="sm" disabled={busy} onClick={()=>void exportRun()}><Download/>{l('Export','Exportar')}</Button>
   </div>
   {closing&&<div className="reveal space-y-3 rounded-lg border bg-card p-4"><Label htmlFor="closing">{l('Outcome (optional)','Resultado (opcional)')}</Label><Textarea id="closing" rows={3} maxLength={4000} value={summary} onChange={e=>setSummary(e.target.value)} placeholder={l('What did they conclude?','¿A qué conclusión llegaron?')}/><div className="flex flex-wrap items-center gap-2"><NativeSelect size="sm" value={disposition} onChange={e=>setDisposition(e.target.value)}><NativeSelectOption value="proposal">{l('Proposal','Propuesta')}</NativeSelectOption><NativeSelectOption value="with_disagreements">{l('With disagreements','Con desacuerdos')}</NativeSelectOption><NativeSelectOption value="incomplete">{l('Incomplete','Incompleta')}</NativeSelectOption></NativeSelect><Button size="sm" disabled={busy} onClick={()=>void finish()}>{l('Finish','Finalizar')}</Button></div></div>}
  </div>
  {!terminal(run.state)&&<EditAuthorization run={run} api={api} busy={busy} act={act} edit={edit} setEdit={setEdit}/>}
  {closure&&<div className="rounded-xl border border-success/25 bg-success/[.06] p-5"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{l('Outcome','Resultado')} · {({proposal:l('Proposal','Propuesta'),with_disagreements:l('With disagreements','Con desacuerdos'),incomplete:l('Incomplete','Incompleta')} as Record<string,string>)[closure.closure.disposition]??closure.closure.disposition}</p><p className="mt-2 whitespace-pre-wrap">{closure.closure.summary}</p>{closure.disagreements.map((text,i)=><p className="mt-2 text-sm text-muted-foreground" key={i}>• {text}</p>)}</div>}
  {run.reason&&!closure&&!['finish','cancel'].includes(run.reason)&&<p className="text-sm text-muted-foreground">{run.reason}</p>}
  {moves.length>0&&<p className="text-sm text-muted-foreground">{l(`The folder changed outside this collaboration ${moves.length===1?'once':moves.length+' times'} (last ${ago(moves.at(-1)!.at)}). It kept going; the chats were told with the next message.`,`La carpeta cambió fuera de esta colaboración ${moves.length===1?'una vez':moves.length+' veces'} (la última ${ago(moves.at(-1)!.at)}). Siguió adelante; se avisó a los chats en el siguiente mensaje.`)}</p>}
  {run.coordination.structured.structured&&<p className="text-sm text-muted-foreground">{run.coordination.barrierOpen?l('Both analyses are in; they can compare now.','Los dos análisis están listos; ya pueden comparar.'):l('Waiting for both independent analyses.','Esperando los dos análisis independientes.')}</p>}
  {run.implementation&&<div className="space-y-2 rounded-xl border p-4 text-sm"><div className="flex items-center justify-between gap-3"><p className="font-medium">{l('Implementation','Implementación')}</p><Button variant="outline" size="sm" disabled={busy} onClick={()=>void act(async()=>{const value=await api<{ready:boolean;reasons:string[];candidate:{contentHash:string}|null}>('desktop/implementation',{runId:run.id,operationId:crypto.randomUUID(),action:{action:'inspect'}});setInspection({hash:value.candidate?.contentHash??'',ready:value.ready,reasons:value.reasons})})}>{l('Check readiness','Comprobar si está lista')}</Button></div><p className="text-muted-foreground">{run.implementation.candidate?`${l('Version','Versión')} ${run.implementation.candidate.version}`:l('No candidate yet','Todavía no hay candidato')}{run.implementation.checks.length?' · '+run.implementation.checks.map(c=>`${c.name} ${c.exitCode===0?'✓':'✗'}`).join(' · '):''}</p>{inspection&&inspection.hash===run.implementation.candidate?.contentHash&&<div><p>{inspection.ready?l('Ready to integrate right now.','Lista para integrar ahora mismo.'):l('Not ready yet:','Todavía no está lista:')}</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{inspection.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div>}</div>}
  <div className="space-y-3">{run.messages.length===0&&!closure&&<p className="py-8 text-center text-sm text-muted-foreground">{terminal(run.state)?l('No messages were sent.','No se envió ningún mensaje.'):run.state==='prepared'?l('Nothing has been sent yet.','Todavía no se ha enviado nada.'):l('Waiting for the first message…','Esperando el primer mensaje…')}</p>}
   {run.messages.map(m=>{const mine=m.src.provider===run.initiator.provider;return <div key={m.id} className={`flex ${mine?'justify-start':'justify-end'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine?'rounded-tl-sm bg-card border':'rounded-tr-sm bg-primary/10'}`}><p className="mb-1 text-xs text-muted-foreground"><strong className="text-foreground">{providerName(m.src.provider)}</strong> · {delivery()[m.status]??m.status}</p><p className="whitespace-pre-wrap break-words text-sm">{m.text??l('Content withheld until both analyses are in','Contenido retenido hasta tener ambos análisis')}</p></div></div>})}
   {run.reports.map(r=><div key={r.id} className="rounded-xl border-l-4 border-primary bg-card p-4"><p className="mb-1 text-xs text-muted-foreground"><strong className="text-foreground">{r.author.startsWith('codex')?'Codex':r.author.startsWith('claude')?'Claude':r.author}</strong> · {({response:l('Report','Informe'),result:l('Result','Resultado'),review:l('Review','Revisión')} as Record<string,string>)[r.report.kind]??r.report.kind}{r.report.version?` v${r.report.version}`:''}{r.report.verdict?' · '+(({agree:l('agrees','de acuerdo'),revise:l('asks for changes','pide cambios'),disagree:l('disagrees','en desacuerdo')} as Record<string,string>)[r.report.verdict]??r.report.verdict):''}</p><p className="whitespace-pre-wrap text-sm">{r.body}</p></div>)}
  </div>
 </div>;
}
