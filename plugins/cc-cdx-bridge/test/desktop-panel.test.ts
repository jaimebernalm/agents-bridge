import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {nativeFixture} from './collaboration-fixture';
import {CreationTickets} from '../src/creation-tickets';
import {desktopPanelRoutes} from '../src/desktop-panel';
import {peekCorrelation,privateSubdirectory,writeAtomic,writeOnce} from '../src/claude-sidecar';

// What the Claude hook keeps for a chat's process; a receipt binds only while this still names its session and generation.
const hookSession=(state:string,record:{pid:number;procStart:string},sessionId:string,generation:string,extra:Record<string,unknown>={})=>
 writeAtomic(join(privateSubdirectory(state,'claude-callers'),`${record.pid}.json`),{enginePid:record.pid,procStart:record.procStart,sessionId,generation,cwd:'/',source:'startup',model:null,startedAt:Date.now(),updatedAt:Date.now(),ended:false,...extra});

test('panel polling binds a verified Claude host receipt and preserves a rejected receipt for a corrected check',async()=>{
 const f=await nativeFixture(),actor={kind:'panel_session' as const,id:randomUUID(),scope:{project:f.root}},tickets=new CreationTickets(f.state,()=>Date.now()-2000);
 const nativePath=join(f.config,'sessions',process.ppid+'.json'),record=JSON.parse(readFileSync(nativePath,'utf8'));record.startedAt=Date.now()-1000;writeFileSync(nativePath,JSON.stringify(record),{mode:0o600});
 const ticket=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'claude',project:f.root,adapter:'assisted_ui',mode:'local'}).ticket;
 const attempt=tickets.claimCreating(ticket.id,'fixture'),created=tickets.markCreated(ticket.id,attempt.epoch,{});
 const directory=privateSubdirectory(f.state,'claude-correlations'),receipt={correlationId:created.correlationId!,sessionId:f.peerId,enginePid:record.pid,procStart:record.procStart,cwd:f.root,priorUserTurns:1,generation:randomUUID(),at:Date.now()};
 const path=join(directory,created.correlationId!+'.json');writeOnce(path,receipt);hookSession(f.state,record,f.peerId,receipt.generation);
 const router=desktopPanelRoutes({stateDir:f.state,configDir:f.config,ipcPath:f.desktop.path},{principal:{provider:'codex',sessionId:f.desktop.threadId},project:f.root,invoke:async()=>[]},actor.id);
 try{
  const rejected=await router.handle('state','GET',async()=>null) as any;expect(rejected.bindingErrors[ticket.id]).toContain('already had a conversation');expect(tickets.get(ticket.id).state).not.toBe('bound');expect(peekCorrelation(f.state,created.correlationId!)).toBeTruthy();expect(f.desktop.submissions).toHaveLength(0);
  writeFileSync(path,JSON.stringify({...receipt,priorUserTurns:0}),{mode:0o600});
  const bound=await router.handle('state','GET',async()=>null) as any;expect(bound.tickets.find((t:any)=>t.id===ticket.id).bound.sessionId).toBe(f.peerId);expect(peekCorrelation(f.state,created.correlationId!)).toBeUndefined();expect(f.frames).toHaveLength(0);expect(f.desktop.submissions).toHaveLength(0);
  await router.handle('state','GET',async()=>null);expect(tickets.get(ticket.id).state).toBe('bound');
  writeOnce(path,{...receipt,priorUserTurns:0});const replay=await router.handle('tickets/check','POST',async()=>({id:ticket.id})) as any;expect(replay.observed.decision).toBe('already_bound');expect(replay.bindingError).toBeUndefined();expect(peekCorrelation(f.state,created.correlationId!)).toBeUndefined();
 }finally{router.close();tickets.close();await f.close()}
},15000);

test('a new Claude chat the app started in its own empty folder links once it moved to the project',async()=>{
 const f=await nativeFixture(),actor={kind:'panel_session' as const,id:randomUUID(),scope:{project:f.root}},tickets=new CreationTickets(f.state,()=>Date.now()-2000);
 const nativePath=join(f.config,'sessions',process.ppid+'.json'),record=JSON.parse(readFileSync(nativePath,'utf8'));record.startedAt=Date.now()-1000;writeFileSync(nativePath,JSON.stringify(record),{mode:0o600});
 const ticket=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'claude',project:f.root,adapter:'assisted_ui',mode:'local'}).ticket;
 const attempt=tickets.claimCreating(ticket.id,'fixture'),created=tickets.markCreated(ticket.id,attempt.epoch,{});
 const scratchRoot=mkdtempSync(join(tmpdir(),'ccdx-scratch-')),scratch=join(scratchRoot,'account','org','scratch-2026-10-14-abc123');mkdirSync(scratch,{recursive:true});
 const generation=randomUUID();writeOnce(join(privateSubdirectory(f.state,'claude-correlations'),created.correlationId!+'.json'),{correlationId:created.correlationId!,sessionId:f.peerId,enginePid:record.pid,procStart:record.procStart,cwd:realpathSync(scratch),priorUserTurns:0,generation,at:Date.now()});
 const routes=(claudeScratchRoot?:string)=>desktopPanelRoutes({stateDir:f.state,configDir:f.config,ipcPath:f.desktop.path,...(claudeScratchRoot?{claudeScratchRoot}:{})},{principal:{provider:'codex',sessionId:f.desktop.threadId},project:f.root,invoke:async()=>[]},actor.id);
 const elsewhere=routes(),router=routes(scratchRoot);
 try{
  hookSession(f.state,record,f.peerId,generation);
  const refused=await elsewhere.handle('tickets/check','POST',async()=>({id:ticket.id})) as any;expect(refused.bindingError).toContain('another project');expect(tickets.get(ticket.id).state).not.toBe('bound');
  // A /clear since the message starts another conversation in the same process; an ended chat is gone.
  for(const changed of [{generation:randomUUID()},{sessionId:randomUUID()},{ended:true}]){hookSession(f.state,record,f.peerId,generation,changed);
   const stale=await router.handle('tickets/check','POST',async()=>({id:ticket.id})) as any;expect(stale.bindingError).toContain('cleared or ended');expect(tickets.get(ticket.id).state).not.toBe('bound');}
  hookSession(f.state,record,f.peerId,generation);
  const bound=await router.handle('tickets/check','POST',async()=>({id:ticket.id})) as any;expect(bound.ticket.bound.sessionId).toBe(f.peerId);expect(peekCorrelation(f.state,created.correlationId!)).toBeUndefined();
 }finally{elsewhere.close();router.close();tickets.close();rmSync(scratchRoot,{recursive:true,force:true});await f.close()}
},15000);

test('the panel opens the other app once on a new chat with the folder and bootstrap filled in',async()=>{
 const f=await nativeFixture(),actor={kind:'panel_session' as const,id:randomUUID(),scope:{project:f.root}},tickets=new CreationTickets(f.state);
 const opened:string[]=[];let fail=false;
 const router=desktopPanelRoutes({stateDir:f.state,configDir:f.config,ipcPath:f.desktop.path},{principal:{provider:'claude',sessionId:f.peerId},project:f.root,invoke:async()=>[]},actor.id,async url=>{if(fail)throw new Error('no app');opened.push(url)});
 try{
  const codex=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'codex',project:f.root,adapter:'manual',mode:'local'}).ticket;
  const result=await router.handle('tickets/open','POST',async()=>({id:codex.id})) as any;
  const link=new URL(opened[0]!);expect(link.protocol).toBe('codex:');expect(link.host).toBe('threads');expect(link.pathname).toBe('/new');
  expect(link.searchParams.get('path')).toBe(codex.project);expect(link.searchParams.get('prompt')).toBe(result.bootstrapPrompt);expect(result.bootstrapPrompt).toContain(`CCDX-CORR-${result.ticket.correlationId}`);
  expect(result.ticket.state).toBe('awaiting_receiver');expect(f.desktop.submissions).toHaveLength(0);
  // A second click must not open a second chat for the same ticket.
  await expect(router.handle('tickets/open','POST',async()=>({id:codex.id}))).rejects.toThrow();expect(opened).toHaveLength(1);
  const claude=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'claude',project:f.root,adapter:'manual',mode:'local'}).ticket;
  await router.handle('tickets/open','POST',async()=>({id:claude.id}));const claudeLink=new URL(opened[1]!);
  expect(claudeLink.protocol).toBe('claude:');expect(claudeLink.host).toBe('code');expect(claudeLink.searchParams.get('folder')).toBe(claude.project);expect(claudeLink.searchParams.get('q')).toContain('CCDX-CORR-');
  // When no app takes the link nothing was created, so the ticket fails instead of waiting.
  fail=true;const broken=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'codex',project:f.root,adapter:'manual',mode:'local'}).ticket;
  await expect(router.handle('tickets/open','POST',async()=>({id:broken.id}))).rejects.toThrow('no app');expect(tickets.get(broken.id).state).toBe('failed');
  // A blank chat of the panel owner's own app: folder only, no prompt, no ticket.
  fail=false;await router.handle('apps/new_chat','POST',async()=>({}));const blank=new URL(opened.at(-1)!);
  expect(blank.protocol).toBe('claude:');expect(blank.searchParams.get('folder')).toBe(codex.project);expect(blank.searchParams.has('q')).toBe(false);
  const assisted=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'claude',project:f.root,adapter:'assisted_ui',mode:'local'}).ticket;
  await expect(router.handle('tickets/open','POST',async()=>({id:assisted.id}))).rejects.toThrow('Only a local manual ticket');
 }finally{router.close();tickets.close();await f.close()}
},15000);
