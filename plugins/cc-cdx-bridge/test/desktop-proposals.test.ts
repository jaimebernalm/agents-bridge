import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {randomUUID} from 'node:crypto';
import {DesktopProposals} from '../src/desktop-proposals';

const claude={provider:'claude' as const,sessionId:randomUUID()},codex={provider:'codex' as const,sessionId:randomUUID()};

test('a proposal is a scoped, replaceable suggestion that only the panel resolves',()=>{
 const proposals=new DesktopProposals(new Database(':memory:'));
 const first=proposals.propose(claude,'/work/app',{requestId:randomUUID(),objective:'Fix duplicate deliveries'});
 // Defaults match the panel: a new chat that may edit and commit, 24 messages, 30 minutes.
 expect(first).toMatchObject({newChat:true,allowEdits:true,maxMessages:24,minutes:30,requester:claude});
 const again=randomUUID(),second=proposals.propose(claude,'/work/app',{requestId:again,objective:'Fix it with limits',maxMessages:null,minutes:90,allowEdits:false});
 expect(proposals.propose(claude,'/work/app',{requestId:again,objective:'Fix it with limits',maxMessages:null,minutes:90,allowEdits:false}).id).toBe(second.id);
 expect(()=>proposals.propose(claude,'/work/app',{requestId:again,objective:'Something else'})).toThrow('reused');
 // The newer suggestion replaces the open one; other chats and folders never see it.
 expect(proposals.open(claude,'/work/app').map(p=>p.id)).toEqual([second.id]);
 expect(proposals.open(codex,'/work/app')).toEqual([]);expect(proposals.open(claude,'/work/other')).toEqual([]);
 expect(()=>proposals.propose(claude,'/work/app',{requestId:randomUUID(),objective:'x',newChat:false})).toThrow('peerId');
 expect(proposals.resolve(codex,'/work/app',second.id,'used','panel_session:x').state).toBe('unchanged');
 expect(proposals.resolve(claude,'/work/app',second.id,'used','panel_session:x').state).toBe('used');
 expect(proposals.open(claude,'/work/app')).toEqual([]);
});
