import {z} from 'zod';
import type {Database} from 'bun:sqlite';
import type {Principal} from './desktop-runs';

// What a chat may suggest for a new collaboration. A proposal grants nothing and starts nothing:
// the panel shows it prefilled, the person may change any field, and only their click authorizes.
export const proposalShape={
 requestId:z.string().uuid(),
 objective:z.string().trim().min(1).max(16000),
 newChat:z.boolean().default(true).describe('Open a new chat in the other app (default) instead of using an existing one'),
 peerId:z.string().uuid().optional().describe('Existing peer chat to use when newChat is false'),
 allowEdits:z.boolean().default(true).describe('Suggest letting the peer edit files and make local commits'),
 editScope:z.string().trim().min(1).max(4000).optional().describe('What the peer may do when edits are allowed'),
 maxMessages:z.number().int().min(2).max(500).nullable().default(24).describe('null means no message-count limit'),
 minutes:z.number().int().min(1).max(1440).default(30),
 initialBarrier:z.boolean().default(false).describe('Each analyses first, then they compare'),
};
export const proposalInputSchema=z.object(proposalShape).strict().refine(p=>p.newChat||!!p.peerId,{message:'Name the existing peer chat (peerId) or leave newChat true',path:['peerId']});
export type ProposalInput=z.infer<typeof proposalInputSchema>;
export type Proposal=Omit<ProposalInput,'requestId'>&{id:string;requester:Principal;createdAt:number};
type Row={id:string;project:string;requester:string;payload:string;state:string;created_at:number};

const key=(p:Principal)=>`${p.provider}:${p.sessionId}`;
const proposal=(row:Row):Proposal=>{const [provider,sessionId]=row.requester.split(':') as [Principal['provider'],string];return {...JSON.parse(row.payload),id:row.id,requester:{provider,sessionId},createdAt:row.created_at}};

export class DesktopProposals{
 constructor(private db:Database,private now=()=>Date.now()){
  db.exec('CREATE TABLE IF NOT EXISTS desktop_proposals(id TEXT PRIMARY KEY,project TEXT NOT NULL,requester TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER,resolved_by TEXT)');
 }
 /** Idempotent by requestId; a newer proposal from the same chat and folder replaces the open one. */
 propose(requester:Principal,project:string,raw:unknown){
  const {requestId,...input}=proposalInputSchema.parse(raw),payload=JSON.stringify(input);
  return this.db.transaction(()=>{
   const old=this.db.query<Row,[string]>('SELECT * FROM desktop_proposals WHERE id=?').get(requestId);
   if(old){if(old.payload!==payload||old.requester!==key(requester)||old.project!==project)throw new Error('Proposal request ID reused with different content');return proposal(old);}
   this.db.run("UPDATE desktop_proposals SET state='replaced',resolved_at=?,resolved_by='core' WHERE requester=? AND project=? AND state='open'",[this.now(),key(requester),project]);
   this.db.run("INSERT INTO desktop_proposals VALUES(?,?,?,?,'open',?,NULL,NULL)",[requestId,project,key(requester),payload,this.now()]);
   return proposal(this.db.query<Row,[string]>('SELECT * FROM desktop_proposals WHERE id=?').get(requestId)!);
  }).immediate();
 }
 open(requester:Principal,project:string){
  return this.db.query<Row,[string,string]>("SELECT * FROM desktop_proposals WHERE requester=? AND project=? AND state='open' ORDER BY created_at DESC").all(key(requester),project).map(proposal);
 }
 get(requester:Principal,project:string,id:string){
  const row=this.db.query<Row,[string,string,string]>("SELECT * FROM desktop_proposals WHERE id=? AND requester=? AND project=? AND state='open'").get(id,key(requester),project);
  return row?proposal(row):undefined;
 }
 /** Only the person resolves a proposal, in the panel or by answering its question: used when they started from it, dismissed otherwise. */
 resolve(requester:Principal,project:string,id:string,state:'used'|'dismissed',actor:string){
  const done=this.db.run("UPDATE desktop_proposals SET state=?,resolved_at=?,resolved_by=? WHERE id=? AND requester=? AND project=? AND state='open'",[state,this.now(),actor,id,key(requester),project]);
  return {id,state:done.changes===1?state:'unchanged'};
 }
}
