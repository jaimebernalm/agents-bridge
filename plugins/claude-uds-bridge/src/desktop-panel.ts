import {realpathSync} from 'node:fs';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {CreationTickets,ticketInputSchema,grantInputSchema,type PanelActor,type Candidate} from './creation-tickets';
import {inspectParticipant,discoverParticipants,type ParticipantOptions} from './participants';
import type {Principal} from './desktop-runs';
import {consumeCorrelation,peekCorrelation} from './claude-sidecar';
import {bootstrapPrompt} from './desktop-creation';
import {newConversationLink,openWithSystem,type AppLauncher} from './app-link';
import {codexRolloutReceipt} from './codex-rollout';
import {homedir} from 'node:os';
import {join} from 'node:path';

export type DesktopPanelAdapter={principal:Principal;project:string;invoke:(name:string,args:Record<string,unknown>,panelSessionId:string)=>Promise<unknown>};
/** The HTTP router supplies its authenticated panel session, never a model argument. */
export function desktopPanelRoutes(options:ParticipantOptions&{codexHome?:string},adapter:DesktopPanelAdapter,panelSessionId:string,launch:AppLauncher=openWithSystem){
 const codexHome=options.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex');
 const tickets=new CreationTickets(options.stateDir),actor:PanelActor={kind:'panel_session',id:panelSessionId,scope:{project:adapter.project}};
 const selected=async(ticketId:string,sessionId:string)=>{const t=tickets.get(ticketId),p=await inspectParticipant(options,sessionId,t.targetProvider),native=(await discoverParticipants(options.configDir,options.stateDir)).find(x=>x.sessionId===sessionId&&x.provider===t.targetProvider);if(!native?.startedAt)throw new Error('Host session start time is unavailable; do not infer freshness');return {provider:p.provider,sessionId:p.sessionId,pid:p.pid,procStart:p.procStart,project:p.project.directory,branch:p.project.branch,head:p.project.head,startedAt:native.startedAt} satisfies Candidate;};

 const check=async(id:string)=>{const t=tickets.get(id);if(t.project!==realpathSync(adapter.project))throw new Error('Panel project mismatch');if(t.state==='bound'){if(t.correlationId){const receipt=peekCorrelation(options.stateDir,t.correlationId);if(receipt&&receipt.sessionId===t.bound?.sessionId&&receipt.enginePid===t.bound.pid&&receipt.procStart===t.bound.procStart)consumeCorrelation(options.stateDir,t.correlationId);}return {ticket:t,observed:{decision:'already_bound',candidates:[]}};}const available=(await discoverParticipants(options.configDir,options.stateDir)).filter(p=>p.provider===t.targetProvider&&p.cwd===t.project&&p.eligibleSurface&&p.startedAt!==null&&p.startedAt>=t.createdAt);const candidates=await Promise.all(available.map(p=>selected(t.id,p.sessionId)));const observed=tickets.observe(t.id,candidates);if(t.correlationId&&t.targetProvider==='claude'){const receipt=peekCorrelation(options.stateDir,t.correlationId),match=receipt&&candidates.find(c=>c.sessionId===receipt.sessionId);if(receipt&&match)try{const bound=tickets.bindVerified(t.id,match,receipt);consumeCorrelation(options.stateDir,t.correlationId);return {observed,ticket:bound}}catch(error){const current=tickets.get(t.id);if(current.state==='bound'&&current.bound?.sessionId===match.sessionId)return {observed,ticket:current};return {observed,ticket:current,bindingError:error instanceof Error?error.message:'Host receipt rejected'}}}if(t.correlationId&&t.targetProvider==='codex'){const matches=candidates.flatMap(c=>{const record=codexRolloutReceipt(codexHome,c.sessionId,t.correlationId!,t.authorizedAt??t.createdAt);return record?[{candidate:c,record}]:[]});if(matches.length===1)try{return {observed,ticket:tickets.bindCodexRecord(t.id,matches[0]!.candidate,matches[0]!.record)}}catch(error){return {observed,ticket:tickets.get(t.id),bindingError:error instanceof Error?error.message:'Codex chat record rejected'}}}return {observed,ticket:tickets.get(t.id),freshness:t.targetProvider==='codex'?'codex_record_or_manual_binding':'native_engine_start'};};
 return {async handle(path:string,method:string,read:()=>Promise<unknown>){
  if(path==='state'&&method==='GET'){
   const runs=await adapter.invoke('status',{},panelSessionId),participants=await adapter.invoke('discover',{},panelSessionId);
   // Only a host receipt can bind automatically. Polling never starts creation, sends a prompt,
   // changes a grant or guesses Codex freshness from a receiver restart.
   const bindingErrors:Record<string,string>={};
   for(const ticket of tickets.list(adapter.project).filter(t=>['awaiting_receiver','ambiguous','creation_uncertain'].includes(t.state)&&t.correlationId)){
    try{const result=await check(ticket.id);if('bindingError' in result&&result.bindingError)bindingErrors[ticket.id]=result.bindingError;}catch(error){bindingErrors[ticket.id]=error instanceof Error?error.message:'Host receipt rejected';}
   }
   // Older runtimes have no proposals; the panel then simply shows none.
   const proposals=await adapter.invoke('proposals',{},panelSessionId).catch(()=>[]),startQueue=await adapter.invoke('start_queue',{},panelSessionId).catch(()=>({waiting:{},ended:{}}));
   return {principal:adapter.principal,project:adapter.project,runs,participants,proposals,startQueue,tickets:tickets.list(adapter.project),grants:tickets.grants(adapter.project),bindingErrors};
  }
  if(method!=='POST')throw new Error('Unknown Desktop panel route');
  const raw=await read();
  if(path==='tickets/request'){const input=ticketInputSchema.parse(raw);if(realpathSync(input.project)!==realpathSync(adapter.project))throw new Error('Panel project mismatch');return tickets.requestFromPanel(actor,input);}
  if(path==='tickets/authorize'){const a=z.object({id:z.string().uuid(),revision:z.number().int()}).strict().parse(raw);return tickets.authorize(actor,a.id,a.revision);}
  if(path==='tickets/cancel'){const a=z.object({id:z.string().uuid()}).strict().parse(raw);return tickets.cancel(actor,a.id);}
  if(path==='tickets/bind'){const a=z.object({id:z.string().uuid(),sessionId:z.string().uuid()}).strict().parse(raw);return tickets.bindManual(actor,a.id,await selected(a.id,a.sessionId));}
  // The panel opens the other app on a new chat with the bootstrap filled in; the person sends it. One claim per ticket, as for any creation.
  if(path==='tickets/open'){const a=z.object({id:z.string().uuid()}).strict().parse(raw),t=tickets.get(a.id);
   if(t.project!==realpathSync(adapter.project))throw new Error('Panel project mismatch');
   if(t.adapter!=='manual'||t.mode!=='local')throw new Error('Only a local manual ticket can be opened in the app');
   const claim=tickets.claimCreating(t.id,`panel:${panelSessionId.slice(0,32)}`),prompt=bootstrapPrompt(claim.ticket,claim.correlationId);
   try{await launch(newConversationLink(t.targetProvider==='claude'?'claude':'codex',t.project,prompt))}
   catch(error){tickets.markFailed(t.id,claim.epoch,{effect:'none',reason:'app_link_failed'});throw error}
   return {ticket:tickets.markCreated(t.id,claim.epoch,{hostRef:null,degradation:'app_link_human_send'}),bootstrapPrompt:prompt};}
  // A blank chat of the panel owner's own app, for starting another collaboration there. Creates no ticket and grants nothing.
  if(path==='apps/new_chat'){z.object({}).strict().parse(raw);await launch(newConversationLink(adapter.principal.provider,realpathSync(adapter.project)));return {opened:adapter.principal.provider};}
  if(path==='tickets/check'){const a=z.object({id:z.string().uuid()}).strict().parse(raw);return check(a.id);}
  if(path==='grants/create')return tickets.grant(actor,grantInputSchema.parse(raw));
  if(path==='grants/revoke'){const a=z.object({id:z.string().uuid()}).strict().parse(raw);return tickets.revokeGrant(actor,a.id);}
  if(!['prepare','preflight','start','control','export','notify','consent','edit_authorization','creation_dispatch','implementation','proposal_resolve','start_when_idle'].includes(path))throw new Error('Unknown Desktop operation');
  const args=z.record(z.string(),z.unknown()).parse(raw);if(path==='prepare')args.openPanel=false;return adapter.invoke(path,args,panelSessionId);
 },close(){tickets.close();}};
}
