import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {appendFileSync,existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registerDesktopTools} from '../src/desktop-runtime';
import {inspectParticipant} from '../src/participants';
import {questionLifetimeMs,readQuestion,recordAnswer} from '../src/bridge-questions';
import {writeAtomic} from '../src/claude-sidecar';
import {join} from 'node:path';
import {limitsFromText} from '../src/chat-approval';
import {bootstrapPrompt} from '../src/desktop-creation';
import {nativeFixture} from './collaboration-fixture';
import {tools as toolNames,type Operation} from '../src/names';
const root=resolve(import.meta.dir,'..');

type Question={header:string;question:string;options:{label:string;description:string}[]};
type Asked={proposal:{id:string};questionId:string;ask:{questions:Question[]}};

// A Claude chat with the bridge, next to an idle Codex chat. The person's answers arrive as the Claude hook hands them over.
async function fixture(){
 // Opening windows goes to the stubs below, so the run may "open" them.
 const auto=process.env.CC_CDX_PANEL_AUTO_OPEN;delete process.env.CC_CDX_PANEL_AUTO_OPEN;
 const f=await nativeFixture(false,{reception:'default'}),codex=await f.connect();
 const p=await inspectParticipant({configDir:f.config,stateDir:f.state,ipcPath:f.desktop.path},f.peerId,'claude');f.bridge.updateRuntime({status:'idle',mode:'bypass'});
 const panels:string[]=[],apps:string[]=[];
 // This chat's bridge; restart() replaces it with a fresh one on the same saved state, as a reload of the chat's MCP does.
 const connect=async()=>{
  const server=new McpServer({name:'claude-fixture',version:'1'}),client=new Client({name:'fixture',version:'1'});
  const runtime=registerDesktopTools(server,{configDir:f.config,stateDir:f.state,ipcPath:f.desktop.path,codexHome:f.root,pluginRoot:root,openPrivatePanel:async url=>{panels.push(url)},openApp:async url=>{apps.push(url)},
   authenticate:async()=>({provider:'claude',sessionId:p.sessionId,pid:p.pid,procStart:p.procStart,project:f.root,binding:{method:'fixture',generation:'fixture',surface:'claude-desktop',evidence:[]}})});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
  return {server,client,runtime,close:async()=>{await client.close();await server.close();await runtime.close();}};
 };
 let live=await connect();
 const call=async(name:string,args:Record<string,unknown>)=>{const r=await live.client.callTool({name:toolNames[name as Operation]??name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));return JSON.parse((r.content as {text:string}[])[0]!.text)};
 const restart=async()=>{await live.close();live=await connect();};
 await call('discover',{});await f.call(codex,'list_chats',{});
 const propose=async(extra:Record<string,unknown>={}):Promise<Asked>=>call('propose',{requestId:randomUUID(),objective:'Review the parser together',newChat:false,peerId:f.desktop.threadId,allowEdits:false,maxMessages:8,minutes:5,...extra});
 // What Claude's PostToolUse hook hands over after AskUserQuestion, one answer per question; the agent never touches it.
 const answer=(asked:Asked,answers:(string|undefined)[],shown=asked.ask.questions.map(q=>q.question))=>recordAnswer(f.state,{session_id:p.sessionId,hook_event_name:'PostToolUse',tool_name:'AskUserQuestion',
  tool_input:{questions:shown.map((question,i)=>({...asked.ask.questions[i],question,multiSelect:false}))},tool_response:{answers:Object.fromEntries(shown.flatMap((question,i)=>answers[i]===undefined?[]:[[question,answers[i]]]))}});
 const close=async()=>{await live.close();await codex.close();await f.close();if(auto===undefined)delete process.env.CC_CDX_PANEL_AUTO_OPEN;else process.env.CC_CDX_PANEL_AUTO_OPEN=auto;};
 return {f,p,get runtime(){return live.runtime},call,propose,answer,restart,panels,apps,close};
}

const labels=(q:Question)=>q.options.map(o=>o.label);
const proposedLimits='8 messages · 5 min (proposed)';

test('the person’s Start in their own chat starts the collaboration as the panel would, and leaves the panel as a card to open',async()=>{
 const x=await fixture();try{
  const asked=await x.propose({allowEdits:true});
  const [edit,limits,start]=asked.ask.questions as [Question,Question,Question];
  expect(asked.ask.questions.map(q=>q.header)).toEqual(['Editing','Limits','Start']);
  // Short questions: no scope unless one was asked for, no code, no objective (the person asked for it in their own words).
  expect(edit.question).toBe('May Codex edit files and make local commits? No push, pull requests or merges.');
  expect(labels(edit)).toEqual(['Yes (proposed)','No']);expect(edit.options[0]!.description).toContain('e.g. add push and pull requests');
  // Limits climb from the proposed ones, larger in both messages and time.
  expect(labels(limits)).toEqual([proposedLimits,'24 messages · 30 min','50 messages · 2 h','Unlimited messages · 24 h']);
  expect(start.question).toMatch(/^Start with the Codex chat “.+”\?$/);expect(JSON.stringify(asked.ask)).not.toMatch(/B-[0-9A-F]{4}|Review the parser/);
  // One panel option covers picking another chat and any other change; Cancel says plainly that it discards (a plain No could read as "not a new chat").
  expect(labels(start)).toEqual(['Yes','Change chat or details in the panel','Cancel']);
  // Proposing asks in the chat: no panel opens and nothing starts.
  expect(x.panels).toEqual([]);expect(x.runtime.store.list(x.p)).toHaveLength(0);
  expect(await x.call('confirm',{questionId:asked.questionId})).toMatchObject({state:'waiting_for_answer'});
  x.answer(asked,['Yes (proposed)',proposedLimits,'Yes']);
  const confirmed=await x.call('confirm',{questionId:asked.questionId});
  expect(confirmed).toMatchObject({state:'started',chosen:{allowEdits:true,limits:{maxMessages:8,minutes:5}}});
  const run=x.runtime.store.status(confirmed.launch.runId,x.p),actor='person_answer:'+asked.questionId;
  expect(run.state).toBe('active');expect(run.context.objective).toBe('Review the parser together');expect(run.limits).toMatchObject({maxMessages:8,maxSeconds:300});
  expect(run.consent).toMatchObject({valid:true,actor});expect(run.events.find(e=>e.type==='started')!.actor).toBe(actor);
  expect(x.runtime.store.editStatus(run.id)).toMatchObject({valid:true,actor,scope:expect.stringContaining('Implement the agreed plan')});
  // The card is a private page with only the link that opens the panel window; the link carries no panel credential.
  const {file,link,markdown}=confirmed.panel;
  expect(file).toEndWith('/Bridge panel.html');expect(statSync(file).mode&0o077).toBe(0);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/open\?k=[0-9a-f]{32}$/);expect(readFileSync(file,'utf8')).toContain(`href="${link}"`);
  expect(markdown).toBe(`**[Open the bridge panel](${link})**`);expect(confirmed.instruction).toContain('SendUserFile');
  expect((await fetch(link.replace(/k=.*/,'k=0'))).status).toBe(404);expect((await fetch(link.replace(/\?.*/,''))).status).toBe(404);expect(x.panels).toEqual([]);
  // The page opened from the card is a file, so the browser follows the link cross-site; the key is what makes it count.
  const page=await fetch(link,{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}});
  const html=await page.text(),nonce=/script-src 'nonce-([^']+)'/.exec(page.headers.get('content-security-policy')??'')?.[1];
  expect(page.status).toBe(200);expect(html).toContain('opens in its own window');expect(x.panels).toHaveLength(1);
  // The tab the link opened closes itself, with the only script the page's policy allows.
  expect(nonce).toBeString();expect(html).toContain(`<script nonce="${nonce}">setTimeout(()=>window.close(),700)</script>`);
  // A page opened from a file has no origin; the key alone lets it ask, and a burst of asks opens one window.
  expect((await fetch(link,{headers:{Origin:'null','Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'no-cors'}})).status).toBe(200);expect(x.panels).toHaveLength(1);
  // One decision per answer: asking again only reads it back, and starts nothing else.
  expect(await x.call('confirm',{questionId:asked.questionId})).toMatchObject({state:'starting',choice:'start',launch:{state:'started',runId:run.id},panel:{link}});
  expect(x.runtime.store.list(x.p)).toHaveLength(1);
  // An agent need not make up an ID to propose (no shell command to get one).
  expect((await x.call('propose',{objective:'Say hello',newChat:true})).questionId).toBeString();
 }finally{await x.close()}
},20000);

test('the person may choose editing and limits other than proposed, picking them or writing them out',async()=>{
 const x=await fixture();try{
  const more=await x.propose({maxMessages:24,minutes:30});
  expect(labels(more.ask.questions[0]!)).toEqual(['No (proposed)','Yes']);
  // Proposed limits equal to a preset show once, first.
  expect(labels(more.ask.questions[1]!)).toEqual(['24 messages · 30 min (proposed)','50 messages · 2 h','100 messages · 4 h','Unlimited messages · 24 h']);
  x.answer(more,['Yes','Unlimited messages · 24 h','Yes']);
  const started=await x.call('confirm',{questionId:more.questionId});
  expect(started.chosen).toEqual({allowEdits:true,limits:{maxMessages:null,minutes:1440}});
  expect(x.runtime.store.status(started.launch.runId,x.p).limits).toMatchObject({maxMessages:null,maxSeconds:86400});
  expect(x.runtime.store.editStatus(started.launch.runId)).toMatchObject({valid:true,scope:expect.stringContaining('No push')});
  await x.call('control',{runId:started.launch.runId,commandId:randomUUID(),expectedRevision:x.runtime.store.status(started.launch.runId,x.p).coordination.revision,control:{action:'finish'}});
  const written=await x.propose({allowEdits:true});
  x.answer(written,['No','40 messages, 45 min','Yes']);
  const second=await x.call('confirm',{questionId:written.questionId});
  expect(second.chosen).toEqual({allowEdits:false,limits:{maxMessages:40,minutes:45}});
  expect(x.runtime.store.status(second.launch.runId,x.p).limits).toMatchObject({maxMessages:40,maxSeconds:2700});
  expect(x.runtime.store.editStatus(second.launch.runId)).toMatchObject({valid:false,grantee:null});
 }finally{await x.close()}
},20000);

test('limits written out are read only when they are limits',()=>{
 const proposed={maxMessages:10,minutes:15};
 expect(limitsFromText('40 mensajes, 45 min',proposed)).toEqual({maxMessages:40,minutes:45});
 expect(limitsFromText('Sin límite, 3 horas',proposed)).toEqual({maxMessages:null,minutes:180});
 expect(limitsFromText('1 h y 30 minutos',proposed)).toEqual({maxMessages:10,minutes:90});
 expect(limitsFromText('1,5 h',proposed)).toEqual({maxMessages:10,minutes:90});
 expect(limitsFromText('100 messages',proposed)).toEqual({maxMessages:100,minutes:15});
 expect(limitsFromText('unlimited messages',proposed)).toEqual({maxMessages:null,minutes:15});
 expect(limitsFromText('more please',proposed)).toBeNull();
 expect(limitsFromText('1 message',proposed)).toBeNull();
 expect(limitsFromText('30 h',proposed)).toBeNull();
 // The whole answer must read as limits: a fraction of a minute, seconds or a condition leave it unread.
 expect(limitsFromText('40 messages, 2.5 min',proposed)).toBeNull();
 expect(limitsFromText('40 messages, 30 seconds',proposed)).toBeNull();
 expect(limitsFromText('40 mensajes si Codex está libre',proposed)).toBeNull();
 expect(limitsFromText('40 messages, 50 messages',proposed)).toBeNull();
 expect(limitsFromText('Mensajes sin límite · 24 h',proposed)).toEqual({maxMessages:null,minutes:1440});
 expect(limitsFromText('como máximo 2 horas.',proposed)).toEqual({maxMessages:10,minutes:120});
 expect(limitsFromText('24h',proposed)).toEqual({maxMessages:10,minutes:1440});
 expect(limitsFromText('40 messages and at most 45 minutes',proposed)).toEqual({maxMessages:40,minutes:45});
 expect(limitsFromText('40 mensajes y como mucho 45 minutos',proposed)).toEqual({maxMessages:40,minutes:45});
 expect(limitsFromText('1.01 h',proposed)).toBeNull();expect(limitsFromText('1,01 horas',proposed)).toBeNull();expect(limitsFromText('0.01 hours',proposed)).toBeNull();
});

test('No discards, the panel option opens it on the choices made, and words, gaps or a reworded question never start anything',async()=>{
 const x=await fixture();try{
  const declined=await x.propose();x.answer(declined,['No (proposed)',proposedLimits,'Cancel']);
  expect(await x.call('confirm',{questionId:declined.questionId})).toMatchObject({state:'declined'});
  const panel=await x.propose();x.answer(panel,['Yes','50 messages · 2 h','Change chat or details in the panel']);
  expect(await x.call('confirm',{questionId:panel.questionId})).toMatchObject({state:'panel_opened'});expect(x.panels).toHaveLength(1);
  // The panel shows the proposal with what they chose in the card.
  expect(x.runtime.proposals.open({provider:'claude',sessionId:x.p.sessionId},realpathSync(x.f.root))).toMatchObject([{allowEdits:true,maxMessages:50,minutes:120,objective:'Review the parser together'}]);
  const words=await x.propose();x.answer(words,['No (proposed)',proposedLimits,'Start, but ask me first']);
  expect(await x.call('confirm',{questionId:words.questionId})).toMatchObject({state:'changes_requested',answers:['No (proposed)',proposedLimits,'Start, but ask me first']});
  // Words in the editing question that start by refusing allow nothing.
  const refused=await x.propose();x.answer(refused,['No, just look',proposedLimits,'Yes']);
  expect(await x.call('confirm',{questionId:refused.questionId})).toMatchObject({state:'changes_requested'});
  const gap=await x.propose();x.answer(gap,['No (proposed)',undefined,'Yes']);
  expect(await x.call('confirm',{questionId:gap.questionId})).toMatchObject({state:'changes_requested'});
  const reworded=await x.propose(),shown=reworded.ask.questions.map(q=>q.question);shown[0]='May Codex edit?';x.answer(reworded,['No (proposed)',proposedLimits,'Yes'],shown);
  expect(await x.call('confirm',{questionId:reworded.questionId})).toMatchObject({state:'not_confirmed'});
  // A newer proposal from this chat replaces the open one, so an answer to the older card starts nothing.
  const older=await x.propose();await x.propose({objective:'Something else'});x.answer(older,['No (proposed)',proposedLimits,'Yes']);
  expect(await x.call('confirm',{questionId:older.questionId})).toMatchObject({state:'proposal_changed'});
  expect(x.runtime.store.list(x.p)).toHaveLength(0);
  // The sample test question is not a collaboration question.
  const sample=await x.call('test_question',{});
  await expect(x.call('confirm',{questionId:sample.questionId})).rejects.toThrow('No collaboration question');
 }finally{await x.close()}
},20000);

test('Start with a new chat opens the other app as the panel does and waits for that chat to be linked',async()=>{
 const x=await fixture();try{
  const asked=await x.propose({newChat:true,peerId:undefined,initialBarrier:true});
  expect(asked.ask.questions[2]!.question).toBe('Start with a new Codex chat?');
  expect(labels(asked.ask.questions[2]!)).toEqual(['Yes','Change chat or details in the panel','Cancel']);
  const asked2=await x.propose({newChat:true,peerId:undefined,initialBarrier:true});x.answer(asked2,['No (proposed)',proposedLimits,'Yes']);
  const confirmed=await x.call('confirm',{questionId:asked2.questionId});
  expect(confirmed).toMatchObject({state:'waiting_for_new_chat',launch:{state:'waiting_for_new_chat'}});
  expect(existsSync(confirmed.panel.file)).toBe(true);
  // The chat whose person asked for the new chat may follow it, though the person's answer requested it.
  expect(await x.call('ticket_status',{ticketId:confirmed.launch.ticketId})).toMatchObject({id:confirmed.launch.ticketId,requester:'person_answer:'+asked2.questionId});
  expect(x.apps).toHaveLength(1);expect(x.apps[0]).toStartWith('codex://threads/new?');expect(decodeURIComponent(x.apps[0]!)).toContain('CCDX-CORR-');
  // The new chat checks its folder first: an app that opens it elsewhere leaves the person a way to link a chat in the right one.
  expect(new URL(x.apps[0]!).searchParams.get('prompt')).toContain('send it this same message');
  expect(x.runtime.store.list(x.p)).toHaveLength(0);
 }finally{await x.close()}
},20000);

test('a card nobody answered within a day expires, and an answer after that starts nothing',async()=>{
 const x=await fixture();try{
  const asked=await x.propose(),stored=readQuestion(x.f.state,asked.questionId)!;
  writeAtomic(join(x.f.state,'bridge-questions',`${asked.questionId}.json`),{...stored,askedAt:Date.now()-questionLifetimeMs-1000});
  x.answer(asked,['No (proposed)',proposedLimits,'Yes']);
  expect(await x.call('confirm',{questionId:asked.questionId})).toMatchObject({state:'expired'});
  expect(x.runtime.store.list(x.p)).toHaveLength(0);
 }finally{await x.close()}
},20000);

test('the start reports what the run really did: waiting for a busy chat, then started',async()=>{
 const x=await fixture();try{
  x.f.bridge.updateRuntime({status:'busy',mode:'bypass'});
  const asked=await x.propose();x.answer(asked,['No (proposed)',proposedLimits,'Yes']);
  const waiting=await x.call('confirm',{questionId:asked.questionId}),runId:string=waiting.launch.runId;
  expect(waiting.state).toBe('waiting_for_idle_chat');expect(x.runtime.store.status(runId,x.p).state).toBe('prepared');
  x.f.bridge.updateRuntime({status:'idle',mode:'bypass'});
  const deadline=Date.now()+10000;while(x.runtime.store.status(runId,x.p).state!=='active'&&Date.now()<deadline)await Bun.sleep(100);
  expect(await x.call('confirm',{questionId:asked.questionId})).toMatchObject({state:'starting',launch:{state:'started',runId}});
 }finally{await x.close()}
},20000);

test('after a restart of this chat’s bridge, an answer is never acted on again: a start that went through is reported, an unfinished one goes to the panel',async()=>{
 const x=await fixture();try{
  const fresh=await x.propose({newChat:true,peerId:undefined});x.answer(fresh,['No (proposed)',proposedLimits,'Yes']);
  const waiting=await x.call('confirm',{questionId:fresh.questionId});
  expect(waiting).toMatchObject({state:'waiting_for_new_chat'});expect(x.apps).toHaveLength(1);
  await x.restart();
  const after=await x.call('confirm',{questionId:fresh.questionId});
  expect(after).toMatchObject({state:'starting',launch:{state:'interrupted',ticketId:waiting.launch.ticketId}});expect(after.instruction).toContain('open_panel');
  expect(x.apps).toHaveLength(1);
  const existing=await x.propose();x.answer(existing,['No (proposed)',proposedLimits,'Yes']);
  const started=await x.call('confirm',{questionId:existing.questionId});expect(started.state).toBe('started');
  await x.restart();
  expect(await x.call('confirm',{questionId:existing.questionId})).toMatchObject({state:'starting',launch:{state:'started',runId:started.launch.runId}});
  expect(x.runtime.store.list(x.p)).toHaveLength(1);
 }finally{await x.close()}
},20000);

test('a card with a question added or repeated is not the card the bridge wrote',async()=>{
 const x=await fixture();try{
  const asked=await x.propose(),[edit,limits,start]=asked.ask.questions as [Question,Question,Question];
  // A second editing question with the meanings swapped, answered "Yes", next to the real one answered "No".
  const swapped={...edit,question:edit.question+' ',options:[{label:'No (proposed)',description:'Lets it edit'},{label:'Yes',description:'Keeps it from editing'}]};
  recordAnswer(x.f.state,{session_id:x.p.sessionId,hook_event_name:'PostToolUse',tool_name:'AskUserQuestion',tool_input:{questions:[edit,swapped,limits,start]},
   tool_response:{answers:{[edit.question]:'No (proposed)',[swapped.question]:'Yes',[limits.question]:proposedLimits,[start.question]:'Yes'}}});
  expect(await x.call('confirm',{questionId:asked.questionId})).toMatchObject({state:'not_confirmed'});
  expect(x.runtime.store.list(x.p)).toHaveLength(0);
 }finally{await x.close()}
},20000);

test('editing widened in the person’s own words starts with what they wrote added to the scope',async()=>{
 const x=await fixture();try{
  const asked=await x.propose();x.answer(asked,['add push and pull requests',proposedLimits,'Yes']);
  const started=await x.call('confirm',{questionId:asked.questionId});
  expect(started.chosen).toMatchObject({allowEdits:true});
  const grant=x.runtime.store.editStatus(started.launch.runId);
  expect(grant.valid).toBe(true);expect(grant.scope).toBe('Implement the agreed plan in this project: edit files and make local commits. The person added: add push and pull requests');
 }finally{await x.close()}
},20000);

test('an existing Codex chat is named on the card by the title Codex shows for it',async()=>{
 const x=await fixture();try{
  // Codex keeps the sidebar title of each chat in session_index.jsonl; the latest entry wins.
  appendFileSync(join(x.f.root,'session_index.jsonl'),JSON.stringify({id:x.f.desktop.threadId,thread_name:'Old name'})+'\n'+JSON.stringify({id:x.f.desktop.threadId,thread_name:'Responder saludo'})+'\n');
  const asked=await x.propose();
  expect(asked.ask.questions[2]!.question).toBe('Start with the Codex chat “Responder saludo”?');
  expect((await x.call('discover',{})).find((p:{sessionId:string})=>p.sessionId===x.f.desktop.threadId)).toMatchObject({title:'Responder saludo'});
 }finally{await x.close()}
},20000);

test('a new Claude chat the app started without its folder moves itself there; a Codex chat is not told to',()=>{
 const ticket={targetProvider:'claude',requester:'person_answer:'+randomUUID(),project:'/work/app'} as Parameters<typeof bootstrapPrompt>[0];
 const claude=bootstrapPrompt(ticket,randomUUID()).split('\n'),codex=bootstrapPrompt({...ticket,targetProvider:'codex'},randomUUID());
 expect(claude[0]).toMatch(/^CCDX-CORR-/);expect(claude[1]).toContain('the person, answering in their other chat');
 expect(claude[2]).toContain('change_directory tool, passing exactly that path');expect(claude[2]).toContain('If this chat runs in the Claude Desktop app and');expect(claude[2]).toContain('a terminal chat stays in the folder where claude was started');expect(claude[2]).toContain('ask for the collaboration again in their other chat');expect(claude[2]).not.toContain('same message');
 expect(codex).not.toContain('change_directory');expect(codex).toContain('send it this same message');
 // The person's own words travel along only so the new chat answers them in their language.
 expect(codex).not.toContain('language');expect(bootstrapPrompt(ticket,randomUUID(),'Prueba del bridge:\n un saludo')).toContain('in the language of their request, which was: «Prueba del bridge: un saludo»');
});
