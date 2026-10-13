import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {codexRolloutReceipt} from '../src/codex-rollout';
import {CreationTickets} from '../src/creation-tickets';

// A minimal Codex chat record: metadata, the first turn, injected context, then the person's message.
function rollout(home:string,threadId:string,cwd:string,text:string,{trigger='composer',at=Date.now()}:{trigger?:string;at?:number}={}){
 const d=new Date(at),dir=join(home,'sessions',String(d.getFullYear()),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0'));mkdirSync(dir,{recursive:true});
 const lines=[{type:'session_meta',payload:{id:threadId,timestamp:new Date(at).toISOString(),cwd,originator:'Codex Desktop'}},
  {type:'event_msg',payload:{type:'task_started',turn_attribution:{turn_trigger:trigger,parent_turn_id:null}}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'<environment_context>…</environment_context>'}]}},
  {type:'event_msg',payload:{type:'item_completed',thread_id:threadId,item:{type:'UserMessage',content:[{type:'text',text}]}}}];
 writeFileSync(join(dir,`rollout-test-${threadId}.jsonl`),lines.map(l=>JSON.stringify(l)).join('\n')+'\n');
}

test('a Codex chat record binds only when the person sent the exact marker as the first composer message',()=>{
 const home=mkdtempSync(join(tmpdir(),'codex-home-')),project=realpathSync(mkdtempSync(join(tmpdir(),'project-'))),correlation=randomUUID(),since=Date.now()-1000;
 const good=randomUUID(),other=randomUUID(),automated=randomUUID(),late=randomUUID();
 rollout(home,good,project,`CCDX-CORR-${correlation}\nThis conversation was opened…`);
 rollout(home,other,project,`CCDX-CORR-${randomUUID()}\nanother ticket`);
 rollout(home,automated,project,`CCDX-CORR-${correlation}\n…`,{trigger:'automation'});
 rollout(home,late,project,`Hello first\nCCDX-CORR-${correlation}`);
 expect(codexRolloutReceipt(home,good,correlation,since)).toMatchObject({sessionId:good,cwd:project,priorUserTurns:0});
 expect(codexRolloutReceipt(home,other,correlation,since)).toBeNull();
 expect(codexRolloutReceipt(home,automated,correlation,since)).toBeNull();
 expect(codexRolloutReceipt(home,late,correlation,since)).toBeNull();
 expect(codexRolloutReceipt(home,randomUUID(),correlation,since)).toBeNull();

 const state=mkdtempSync(join(tmpdir(),'tickets-')),tickets=new CreationTickets(state),actor={kind:'panel_session' as const,id:randomUUID(),scope:{project}};
 try{
  const ticket=tickets.requestFromPanel(actor,{requestId:randomUUID(),targetProvider:'codex',project,adapter:'manual',mode:'local'}).ticket;
  const claim=tickets.claimCreating(ticket.id,'panel:test'),created=tickets.markCreated(ticket.id,claim.epoch,{});
  const fresh=randomUUID();rollout(home,fresh,project,`CCDX-CORR-${created.correlationId}\n…`);
  const record=codexRolloutReceipt(home,fresh,created.correlationId!,since)!;expect(record).not.toBeNull();
  const candidate={provider:'codex' as const,sessionId:fresh,pid:process.pid,procStart:'start',project,branch:null,head:null,startedAt:Date.now()+1};
  expect(()=>tickets.bindCodexRecord(ticket.id,{...candidate,sessionId:other},record)).toThrow('disagree');
  expect(()=>tickets.bindCodexRecord(ticket.id,candidate,{...record,correlationId:randomUUID()})).toThrow('another ticket');
  const bound=tickets.bindCodexRecord(ticket.id,candidate,record);
  expect(bound.state).toBe('bound');expect(bound.bound).toMatchObject({sessionId:fresh,binding:'codex_record'});
 }finally{tickets.close()}
});
