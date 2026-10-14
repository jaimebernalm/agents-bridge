import {describe,expect,test} from 'bun:test';
import {placePanelWindow,savedPlace,topRight} from '../src/lib/window-place';

// The 16-inch MacBook screen the probe measured: a menu bar on top and the Dock below.
const laptop={availLeft:0,availTop:33,availWidth:1728,availHeight:986};
// A window that records where it was sent and lets the test fire its events.
function fakeWindow(options:{standalone?:boolean;cookie?:string;area?:typeof laptop}={}){
 const listeners:Record<string,()=>void>={},moves:string[]=[];
 const win={screen:options.area??laptop,document:{cookie:options.cookie??''},screenX:22,screenY:55,outerWidth:1200,outerHeight:942,
  matchMedia:(query:string)=>({matches:query==='(display-mode: standalone)'&&(options.standalone??true)}),
  resizeTo(w:number,h:number){moves.push(`size ${w}x${h}`);win.outerWidth=w;win.outerHeight=h},
  moveTo(x:number,y:number){moves.push(`at ${x},${y}`);win.screenX=x;win.screenY=y},
  addEventListener(event:string,listener:()=>void){listeners[event]=listener}};
 placePanelWindow(win as never);
 return {win,moves,fire:(event:string)=>listeners[event]?.()};
}

describe('panel window placement',()=>{
 test('the default sits in the top-right corner, under half the width and about three fifths of the height',()=>{
  const place=topRight(laptop);
  expect(place).toEqual({x:1728-760-12,y:33+12,w:760,h:611});
  expect(place.w).toBeLessThan(1728/2);expect(place.h).toBeLessThan(986*0.65);
 });
 test('a small screen keeps a usable size inside the screen',()=>{
  const small={availLeft:0,availTop:25,availWidth:1280,availHeight:700},place=topRight(small);
  expect(place).toEqual({x:1280-563-12,y:25+12,w:563,h:600});
  const tiny={availLeft:0,availTop:0,availWidth:500,availHeight:400};
  expect(topRight(tiny)).toEqual({x:0,y:0,w:500,h:400});
 });
 test('a second screen to the left keeps its own coordinates',()=>{
  expect(topRight({availLeft:-1920,availTop:0,availWidth:1920,availHeight:1050})).toMatchObject({x:-1920+1920-845-12,y:12});
 });
 test('the panel app window moves to the corner when it opens',()=>{
  const {moves}=fakeWindow();
  expect(moves).toEqual(['size 760x611','at 956,45']);
 });
 test('a normal browser tab is never moved',()=>{
  const {moves,fire,win}=fakeWindow({standalone:false});
  fire('pagehide');expect(moves).toEqual([]);expect(win.document.cookie).toBe('');
 });
 test('the place the person leaves the window is where the next panel opens',()=>{
  const first=fakeWindow();
  first.win.screenX=300;first.win.screenY=200;first.win.outerWidth=900;first.win.outerHeight=600;first.fire('blur');
  expect(first.win.document.cookie).toBe('cc_cdx_panel_window=300_200_900_600; Path=/; Max-Age=31536000; SameSite=Strict');
  const next=fakeWindow({cookie:'cc_cdx_panel_49999=secret; cc_cdx_panel_window=300_200_900_600'});
  expect(next.moves).toEqual(['size 900x600','at 300,200']);
 });
 test('closing the window also keeps its place',()=>{
  const {win,fire}=fakeWindow();win.screenX=100;fire('pagehide');
  expect(savedPlace(win.document.cookie)).toEqual({x:100,y:45,w:760,h:611});
 });
 test('a place from another screen layout, or one too small, falls back to the corner',()=>{
  for(const cookie of ['cc_cdx_panel_window=2400_100_800_600','cc_cdx_panel_window=10_40_200_100','cc_cdx_panel_window=0_0_800_600','cc_cdx_panel_window=956_45_760_463','cc_cdx_panel_window=797_138_845_494'])
   expect(fakeWindow({cookie}).moves).toEqual(['size 760x611','at 956,45']);
 });
 test('a damaged cookie is ignored',()=>{
  for(const cookie of ['cc_cdx_panel_window=','cc_cdx_panel_window=a_b_c_d','cc_cdx_panel_window=1_2_3','other=1_2_3_4'])expect(savedPlace(cookie)).toBeUndefined();
 });
});
