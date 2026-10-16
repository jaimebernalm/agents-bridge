import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import net from 'node:net';
import { Database } from 'bun:sqlite';
import { Bridge } from '../src/bridge';
import { inspectProject, compareProjects } from '../src/project';
import { discoverParticipants, inspectParticipant } from '../src/participants';
import { frameSchema, processStart } from '../src/claude';
import { receiver } from './desktop-fixture';

async function git(root: string,args: string[]) {
  const child=Bun.spawn(['git','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Bridge test','-c','user.email=bridge@example.invalid','-C',root,...args],{stdout:'pipe',stderr:'pipe'});
  const [code,text,error]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  if(code!==0) throw new Error(error); return text.trim();
}

test('Git identity pins worktree, common repo, diff and explicit comparison base without reading remotes',async()=>{
  const root=mkdtempSync('/tmp/phase1-git-'); const second=join(root,'second');
  try {
    await git(root,['init','--template=']); writeFileSync(join(root,'file.txt'),'base\n');
    await git(root,['add','file.txt']); await git(root,['commit','-m','base']);
    const clean=await inspectProject(root); expect(clean.dirty).toBe(false); expect(clean.head).toHaveLength(40);
    await git(root,['worktree','add','-b','other',second]);
    const worktree=await inspectProject(second); expect(worktree.commonGitDir).toBe(clean.commonGitDir);
    expect((await compareProjects(clean,worktree,'same')).base).toBe(clean.head);
    writeFileSync(join(second,'file.txt'),'new\n'); const dirty=await inspectProject(second);
    expect(dirty.diffHash).not.toBe(clean.diffHash);
    await expect(compareProjects(clean,dirty,'same')).rejects.toThrow('differ');
    await expect(compareProjects(clean,dirty,'compare')).rejects.toThrow('explicit');
    expect((await compareProjects(clean,dirty,'compare',clean.head!)).base).toBe(clean.head);
    await expect(compareProjects(clean,dirty,'compare','--help')).rejects.toThrow('explicit');
    writeFileSync(join(root,'untracked.txt'),'private content not snapshotted');
    const untracked=await inspectProject(root); expect(untracked.untrackedPaths).toContain('untracked.txt'); expect(untracked.untrackedSnapshot).toBeNull();
    expect(JSON.stringify(untracked)).not.toContain('private content');
    const other=mkdtempSync('/tmp/phase1-othergit-');
    try {await git(other,['init','--template=']);await expect(compareProjects(clean,await inspectProject(other),'same')).rejects.toThrow('different repositories');}
    finally {rmSync(other,{recursive:true,force:true});}
  } finally {rmSync(root,{recursive:true,force:true});}
});

async function liveFixture() {
  const root=mkdtempSync('/tmp/phase1-native-'); const desktop=await receiver('idle',false,false,root);
  const configDir=join(root,'claude'); const stateDir=join(root,'plugin-state','claude-uds-bridge'); const sockets=join(root,'s');
  mkdirSync(join(configDir,'sessions'),{recursive:true,mode:0o700});mkdirSync(sockets,{mode:0o700});
  const peerId=randomUUID(); const peerPath=join(sockets,`${process.ppid}.sock`); const frames: ReturnType<typeof frameSchema.parse>[]=[];
  const connections=new Set<net.Socket>(); const server=net.createServer(socket=>{
    connections.add(socket);socket.once('close',()=>connections.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');let buffer='';
    socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))!==-1){frames.push(frameSchema.parse(JSON.parse(buffer.slice(0,end))));buffer=buffer.slice(end+1);}});
  });server.listen(peerPath);await once(server,'listening');chmodSync(peerPath,0o600);
  const record={pid:process.ppid,sessionId:peerId,messagingSocketPath:peerPath,cwd:root,peerProtocol:1,name:'Repeated name',entrypoint:'claude-desktop',status:'idle',procStart:await processStart(process.ppid),version:'2.1.286'};
  const write=(extra:Record<string,unknown>={})=>writeFileSync(join(configDir,'sessions',`${process.ppid}.json`),JSON.stringify({...record,...extra}),{mode:0o600});write();
  const bridge=new Bridge(desktop.threadId,configDir,stateDir,desktop.path);await bridge.start(sockets,root,bridge.beginSession());bridge.updateRuntime({status:'idle',mode:'prompting'});await bridge.setPolicy('accept');
  const options={configDir,stateDir,ipcPath:desktop.path};
  return {root,desktop,configDir,stateDir,options,bridge,peerId,frames,write,
    async close(){await bridge.close();for(const socket of connections)socket.destroy();await new Promise<void>(done=>server.close(()=>done()));await desktop.close();}};
}

test('Desktop selection verifies surface, process and engine version without sending',async()=>{
  const f=await liveFixture();
  try {
    const discovered=await discoverParticipants(f.configDir); expect(discovered.some(p=>p.sessionId===f.peerId && p.surface==='claude-desktop')).toBe(true);
    const inspect=()=>inspectParticipant(f.options,f.peerId,'claude');
    f.write({entrypoint:'claude-vscode'}); await expect(inspect()).rejects.toThrow('Desktop');
    // A terminal chat counts only when interactive; print mode and records without a kind are other surfaces.
    for(const kind of [undefined,'print']){f.write({entrypoint:'cli',kind});await expect(inspect()).rejects.toThrow('not substituted');
      expect((await discoverParticipants(f.configDir)).find(p=>p.sessionId===f.peerId)).toMatchObject({surface:'cli',surfaceLabel:'Claude CLI',eligibleSurface:false});}
    f.write({entrypoint:'cli',kind:'interactive'});expect(await inspect()).toMatchObject({sessionId:f.peerId,provider:'claude',surface:'cli'});
    expect((await discoverParticipants(f.configDir)).find(p=>p.sessionId===f.peerId)).toMatchObject({surface:'cli',surfaceLabel:'Claude CLI',eligibleSurface:true});
    f.write({entrypoint:'cli',kind:'interactive',version:'2.1.223'});await expect(inspect()).rejects.toThrow('Claude CLI engine is unsupported');
    f.write({procStart:'different'}); await expect(inspect()).rejects.toThrow('stale');
    f.write({version:'2.1.223'}); await expect(inspect()).rejects.toThrow('unsupported');
    f.write(); expect((await inspect()).sessionId).toBe(f.peerId);
    expect(f.frames).toHaveLength(0);expect(f.desktop.submissions).toHaveLength(0);
  } finally {await f.close();}
});

test('homonymous Desktop conversations require exact IDs; duplicate registrations and old receivers are rejected',async()=>{
  const f=await liveFixture();const child=Bun.spawn([process.execPath,'-e','await Bun.sleep(60000)'],{stdout:'ignore',stderr:'ignore'});
  const socketPath=join(f.root,'s',`${child.pid}.sock`);const secondSocket=net.createServer(socket=>socket.end());secondSocket.listen(socketPath);await once(secondSocket,'listening');chmodSync(socketPath,0o600);
  try {
    const secondId=randomUUID();const file=join(f.configDir,'sessions',`${child.pid}.json`);
    const base=JSON.parse(readFileSync(join(f.configDir,'sessions',`${process.ppid}.json`),'utf8'));
    const second={...base,pid:child.pid,sessionId:secondId,messagingSocketPath:socketPath,procStart:await processStart(child.pid)};
    writeFileSync(file,JSON.stringify(second),{mode:0o600});
    expect((await discoverParticipants(f.configDir)).filter(p=>p.name==='Repeated name')).toHaveLength(2);
    expect((await inspectParticipant(f.options,f.peerId,'claude')).pid).toBe(process.ppid);
    expect((await inspectParticipant(f.options,secondId,'claude')).pid).toBe(child.pid);
    writeFileSync(file,JSON.stringify({...second,sessionId:f.peerId}));await expect(inspectParticipant(f.options,f.peerId,'claude')).rejects.toThrow('ambiguous');
    const capabilityDb=new Database(join(f.stateDir,`${f.desktop.threadId}.sqlite`));
    const original=capabilityDb.query<{pid:number;proc_start:string},[]>('SELECT pid,proc_start FROM receiver_capabilities').get()!;
    capabilityDb.run('DELETE FROM receiver_capabilities');
    await expect(inspectParticipant(f.options,f.desktop.threadId,'codex')).rejects.toThrow('reload');
    capabilityDb.run("INSERT INTO receiver_capabilities VALUES ('managed_runs_v1',?,?)",[original.pid,original.proc_start]);capabilityDb.close();
  } finally {child.kill();await child.exited;await new Promise<void>(done=>secondSocket.close(()=>done()));await f.close();}
});
