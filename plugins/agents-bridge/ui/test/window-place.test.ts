import {describe,expect,test} from 'bun:test';
import {placePanelWindow,topRight} from '../src/lib/window-place';

// The 16-inch MacBook screen the probe measured: a menu bar on top and the Dock below.
const laptop={availLeft:0,availTop:33,availWidth:1728,availHeight:986};
// A window that records where it was sent and lets the test fire its events.
function fakeWindow(options:{standalone?:boolean;cookie?:string;area?:typeof laptop;at?:{x:number;y:number;w:number;h:number}}={}){
 const listeners:Record<string,()=>void>={},moves:string[]=[];
 const at=options.at??{x:22,y:55,w:1200,h:942};
 const win={screen:options.area??laptop,document:{cookie:options.cookie??''},screenX:at.x,screenY:at.y,outerWidth:at.w,outerHeight:at.h,
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
 test('it always opens in the corner at the default size, however the last window was moved or enlarged',()=>{
  const corner='agents_bridge_panel_window=956_45_760_611; Path=/; Max-Age=31536000; SameSite=Strict';
  const first=fakeWindow();expect(first.win.document.cookie).toBe(corner);
  first.win.screenX=300;first.win.screenY=200;first.win.outerWidth=1400;first.win.outerHeight=900;first.fire('blur');first.fire('pagehide');
  expect(first.win.document.cookie).toBe(corner);
  // The bridge opened the next window where an earlier version had remembered it: it goes back to the corner.
  const next=fakeWindow({cookie:'agents_bridge_panel_window=300_200_1400_900',at:{x:300,y:200,w:1400,h:900}});
  expect(next.moves).toEqual(['size 760x611','at 956,45']);expect(next.win.document.cookie).toBe(corner);
 });
 test('a window the bridge already opened in the corner is not moved',()=>{
  expect(fakeWindow({at:{x:956,y:45,w:760,h:611}}).moves).toEqual([]);
 });
});
