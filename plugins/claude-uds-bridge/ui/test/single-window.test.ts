import {describe,expect,test} from 'bun:test';
import {claimPanelWindow} from '../src/lib/single-window';
import {hasDraft,reportDraft} from '../src/lib/drafts';

// Same-origin pages share one channel; delivery is asynchronous and skips the sender, like BroadcastChannel.
function bus(){
 const members=new Set<{onmessage:((event:MessageEvent)=>void)|null}>();
 const channel=()=>{const self={onmessage:null as ((event:MessageEvent)=>void)|null,
  postMessage(data:unknown){for(const other of members)if(other!==self)queueMicrotask(()=>other.onmessage?.({data} as MessageEvent))},
  close(){members.delete(self)}};members.add(self);return self};
 return {channel,members};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
// A window that records what happened to it; draft says whether it holds unsent text.
function page(log:string[],name:string,draft=()=>false){return {hasDraft:draft,onReplaced:()=>log.push(name+' replaced'),onSuperseded:()=>log.push(name+' superseded')}}

describe('one panel window',()=>{
 test('a newer window replaces the one already open',async()=>{
  const {channel}=bus(),log:string[]=[];
  claimPanelWindow(page(log,'old'),channel(),{at:1,id:'a'});
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  await settle();expect(log).toEqual(['old replaced']);
 });
 test('an older window that connects late steps aside',async()=>{
  const {channel}=bus(),log:string[]=[];
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  claimPanelWindow(page(log,'old'),channel(),{at:1,id:'a'});
  await settle();expect(log).toEqual(['old replaced']);
 });
 test('windows opened at the same instant keep exactly one',async()=>{
  const {channel}=bus(),log:string[]=[];
  claimPanelWindow(page(log,'a'),channel(),{at:1,id:'a'});
  claimPanelWindow(page(log,'b'),channel(),{at:1,id:'b'});
  await settle();expect(log).toEqual(['a replaced']);
 });
 test('three windows leave only the newest',async()=>{
  const {channel,members}=bus(),log:string[]=[];
  for(const [at,id] of [[1,'a'],[3,'c'],[2,'b']] as const)claimPanelWindow(page(log,id),channel(),{at,id});
  await settle();expect(log.sort()).toEqual(['a replaced','b replaced']);expect(members.size).toBe(1);
 });
 test('a window with unsent text stays and is told once',async()=>{
  const {channel}=bus(),log:string[]=[];
  claimPanelWindow(page(log,'old',()=>true),channel(),{at:1,id:'a'});
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  claimPanelWindow(page(log,'newer'),channel(),{at:3,id:'c'});
  await settle();expect(log).toEqual(['old superseded','new replaced']);
 });
 test('keeping the window with unsent text sends the other one away',async()=>{
  const {channel}=bus(),log:string[]=[];
  const old=claimPanelWindow(page(log,'old',()=>true),channel(),{at:1,id:'a'},()=>10);
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  await settle();old.reclaim();await settle();
  expect(log).toEqual(['old superseded','new replaced']);
 });
 test('keeping the window wins even when the clock ties with the other claim',async()=>{
  const {channel,members}=bus(),log:string[]=[];
  const old=claimPanelWindow(page(log,'old',()=>true),channel(),{at:1,id:'a'},()=>2);
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  await settle();old.reclaim();await settle();
  expect(log).toEqual(['old superseded','new replaced']);expect(members.size).toBe(1);
 });
 test('once the text is sent, the next newer window replaces it',async()=>{
  const {channel}=bus(),log:string[]=[];let draft=true;
  claimPanelWindow(page(log,'old',()=>draft),channel(),{at:1,id:'a'});
  claimPanelWindow(page(log,'new'),channel(),{at:2,id:'b'});
  await settle();draft=false;
  claimPanelWindow(page(log,'newer'),channel(),{at:3,id:'c'});
  await settle();expect(log).toEqual(['old superseded','old replaced','new replaced']);
 });
 test('unrelated messages change nothing',async()=>{
  const {channel}=bus(),log:string[]=[];
  claimPanelWindow(page(log,'panel'),channel(),{at:1,id:'a'});
  channel().postMessage({hello:'world'});channel().postMessage({at:'9',id:'z'});
  await settle();expect(log).toEqual([]);
 });
 test('releasing the claim leaves the channel',async()=>{
  const {channel,members}=bus();
  claimPanelWindow(page([],'a'),channel(),{at:1,id:'a'}).release();expect(members.size).toBe(0);
 });
});

describe('unsent text',()=>{
 const field=(value:string,options:{connected?:boolean;ignored?:boolean}={})=>({value,isConnected:options.connected??true,closest:(selector:string)=>options.ignored&&selector==='[data-draft="ignore"]'?{}:null});
 test('typed text still in a field counts',()=>{expect(hasDraft([field('Review the cache layer')])).toBe(true)});
 test('a cleared field, a removed field and blank text do not count',()=>{expect(hasDraft([field(''),field('  '),field('sent',{connected:false})])).toBe(false)});
 test('search text never counts',()=>{expect(hasDraft([field('cache',{ignored:true})])).toBe(false)});
 test('a form with changes in state counts even when its field is hidden',()=>{
  const release=reportDraft();expect(hasDraft([])).toBe(true);
  release();expect(hasDraft([])).toBe(false);
 });
});
