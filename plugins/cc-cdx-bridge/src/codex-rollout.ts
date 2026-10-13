import {closeSync,existsSync,openSync,readdirSync,readSync} from 'node:fs';
import {join} from 'node:path';

// Codex Desktop records each chat under <codexHome>/sessions/YYYY/MM/DD/rollout-…-<threadId>.jsonl.
// The first message a person sends from the composer is written there by the host, so it is
// evidence the model cannot supply through a tool argument. Any format surprise yields no receipt,
// which leaves binding to the person in the panel.
export type CodexRolloutReceipt={correlationId:string;sessionId:string;cwd:string;priorUserTurns:number;at:number};

const day=(time:number)=>{const d=new Date(time);return [String(d.getFullYear()),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')]};
// A new chat's record is small; reading a bounded prefix keeps polling cheap on long chats.
const head=(path:string,limit=512*1024)=>{const fd=openSync(path,'r');try{const buffer=Buffer.alloc(limit),read=readSync(fd,buffer,0,limit,0);return buffer.subarray(0,read).toString('utf8')}finally{closeSync(fd)}};

export function findCodexRollout(codexHome:string,threadId:string,since:number,now=Date.now()){
 for(let time=since-86400000;time<=now+86400000;time+=86400000){
  const directory=join(codexHome,'sessions',...day(time));if(!existsSync(directory))continue;
  const file=readdirSync(directory).find(name=>name.startsWith('rollout-')&&name.endsWith(`-${threadId}.jsonl`));
  if(file)return join(directory,file);
 }
 return null;
}

export function codexRolloutReceipt(codexHome:string,threadId:string,correlationId:string,since:number):CodexRolloutReceipt|null{
 const path=findCodexRollout(codexHome,threadId,since);if(!path)return null;
 let meta:{id?:string;cwd?:string;timestamp?:string}|undefined,firstTrigger:string|undefined,parent:unknown=null;const messages:string[]=[];
 for(const line of head(path).split('\n')){
  let entry:{type?:string;payload?:Record<string,any>};try{entry=JSON.parse(line)}catch{continue}
  const payload=entry.payload??{};
  if(entry.type==='session_meta'&&!meta)meta=payload;
  else if(payload.type==='task_started'&&firstTrigger===undefined){firstTrigger=payload.turn_attribution?.turn_trigger;parent=payload.turn_attribution?.parent_turn_id??null}
  else if(payload.type==='item_completed'&&payload.item?.type==='UserMessage')messages.push((payload.item.content??[]).filter((c:any)=>c?.type==='text').map((c:any)=>String(c.text)).join(''));
  if(messages.length)break;
 }
 const marker=`CCDX-CORR-${correlationId}`,first=messages[0];
 if(!meta||meta.id!==threadId||!meta.cwd||!first)return null;
 // Typed and sent by the person, as the chat's very first turn.
 if(firstTrigger!=='composer'||parent!==null)return null;
 if(first!==marker&&!first.startsWith(marker+'\n'))return null;
 const at=Date.parse(meta.timestamp??'');if(!Number.isFinite(at))return null;
 return {correlationId,sessionId:threadId,cwd:meta.cwd,priorUserTurns:0,at};
}
