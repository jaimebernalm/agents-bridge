import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Database} from 'bun:sqlite';
import {nativeFixture} from './collaboration-fixture';
import {doctor} from '../src/doctor';
import {ProjectAuthorizations,observeProjectAuthorization} from '../src/project-authorization';
import {inspectProject,compareProjects} from '../src/project';
import {version} from '../src/version';
const pluginRoot=resolve(import.meta.dir,'..');

test('diagnosis observes inherited reception and live distribution without creating state or changing policies',async()=>{
 const f=await nativeFixture(false,{reception:'default'});try{
  const options={configDir:f.config,project:f.root,threadId:f.desktop.threadId,peerId:f.peerId,codexHome:f.root,pluginRoot};
  const missing=join(f.root,'not-created');expect(observeProjectAuthorization(missing,f.root).enabled).toBe(false);expect(existsSync(missing)).toBe(false);
  const before=readFileSync(join(f.state,'project-authorizations.sqlite'));
  const initial=await doctor(options);expect(initial.codex?.receiverVersion).toBe(version);expect(initial.codex?.projectReceptionRemembered).toBe(false);
  expect(readFileSync(join(f.state,'project-authorizations.sqlite'))).toEqual(before);
  const grants=new ProjectAuthorizations(f.state);grants.change({project:f.root,ownerThread:f.desktop.threadId,actionId:randomUUID(),enabled:true,expectedRevision:0,confirmed:true});grants.close();
  const enabled=await doctor(options);expect(enabled.codex?.projectReceptionRemembered).toBe(true);expect(enabled.codex?.receiverPolicy).toBe('default');expect(enabled.codex?.inboundFromClaude).toBe('unknown');
  expect(enabled.checks.find(c=>c.code==='project_reception')?.message).toContain('Ordinary messages are not covered');
  const db=new Database(join(f.state,f.desktop.threadId+'.sqlite'));db.run("DELETE FROM receiver_capabilities WHERE capability LIKE 'distribution_version:%'");db.run("UPDATE inbound_policy SET policy='refuse'");db.close();
  const explicit=await doctor(options);expect(explicit.checks.some(c=>c.code==='receiver_update_pending')).toBe(true);expect(explicit.codex?.inboundFromClaude).toBe('refuse');expect(explicit.codex?.projectReceptionRemembered).toBe(true);
  expect(f.desktop.submissions).toHaveLength(0);expect(f.frames).toHaveLength(0);
 }finally{await f.close();}
});

test('worktrees with spaces compare Git bases explicitly and never inherit another folder grant',async()=>{
 const root=mkdtempSync('/tmp/bridge worktrees-'),repo=join(root,'main project'),other=join(root,'second project'),state=join(root,'state');mkdirSync(repo,{mode:0o700});
 const git=async(args:string[])=>{const p=Bun.spawn(['git','-C',repo,...args],{stdout:'pipe',stderr:'pipe'});const [code,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);if(code)throw new Error(err);return out.trim();};
 try{
  await git(['init','-b','main']);writeFileSync(join(repo,'content.txt'),'one\n');await git(['add','.']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);
  await git(['worktree','add','-b','feature/test',other]);const first=await inspectProject(repo),second=await inspectProject(other);expect((await compareProjects(first,second,'same')).reproducible).toBe(true);
  const grants=new ProjectAuthorizations(state);grants.change({project:repo,ownerThread:randomUUID(),actionId:randomUUID(),enabled:true,expectedRevision:0,confirmed:true});expect(grants.status(other).enabled).toBe(false);grants.close();
  writeFileSync(join(other,'content.txt'),'two\n');const dirty=await inspectProject(other);await expect(compareProjects(first,dirty,'same')).rejects.toThrow('differ');
  expect((await compareProjects(first,dirty,'compare',first.head!)).base).toBe(first.head);await expect(compareProjects(first,dirty,'compare','--help')).rejects.toThrow('explicit');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('shareable pilot evidence projects only allowlisted facts and refuses free text in trusted fields',async()=>{
 const {publicPilotEvidence}=await import('../src/pilot-evidence');
 const secret='secret-token-/Users/person/private-project';
 const raw={schemaVersion:1,version,platform:'darwin',runtime:Bun.version,token:secret,project:secret,transcript:secret,checks:[{check:'source_suite',passed:true,count:131,error:secret,metadata:{socket:secret}}],realCases:[{case:'L01',outcome:'passed',version,sessionId:secret,text:secret}]};
 const safe=publicPilotEvidence(raw);expect(JSON.stringify(safe)).not.toContain(secret);expect(safe.checks[0]?.count).toBe(131);
 expect(()=>publicPilotEvidence({...raw,version:secret})).toThrow();expect(()=>publicPilotEvidence({...raw,checks:[{check:secret,passed:true}]})).toThrow();
});
