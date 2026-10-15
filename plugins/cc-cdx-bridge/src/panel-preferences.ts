import {join} from 'node:path';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ownedJson,privateDirectory} from './claude';

// Language and theme belong to the person at this computer, not to one panel: every panel of
// either app reads them from the shared state folder, so a new chat opens the way they left it.
export const panelPreferencesSchema=z.object({language:z.enum(['en','es']),theme:z.enum(['light','dark'])}).strict();
export type PanelPreferences=z.infer<typeof panelPreferencesSchema>;
const defaults:PanelPreferences={language:'en',theme:'light'};
const file=(stateDir:string)=>join(stateDir,'panel-preferences.json');

export function readPanelPreferences(stateDir:string):PanelPreferences{
 try{const saved=panelPreferencesSchema.partial().safeParse(ownedJson(file(stateDir),4096));return {...defaults,...(saved.success?saved.data:{})};}
 catch{return defaults;}
}
export function savePanelPreferences(stateDir:string,change:unknown):PanelPreferences{
 const next={...readPanelPreferences(stateDir),...panelPreferencesSchema.partial().parse(change)};
 mkdirSync(stateDir,{recursive:true,mode:0o700});privateDirectory(stateDir);
 const target=file(stateDir),temp=target+'.'+randomUUID()+'.tmp';
 writeFileSync(temp,JSON.stringify(next),{mode:0o600,flag:'wx'});renameSync(temp,target);
 return next;
}
// Where the person left the panel window, as the page keeps it in a cookie (ui/src/lib/window-place.ts). Requests from
// the window carry it, so the next window can open there at its size instead of opening at the browser's default and moving.
const placeSchema=z.object({x:z.number().int(),y:z.number().int(),w:z.number().int().min(200).max(20000),h:z.number().int().min(200).max(20000)}).strict();
export type PanelPlace=z.infer<typeof placeSchema>;
const placeFile=(stateDir:string)=>join(stateDir,'panel-window.json');
export function readPanelPlace(stateDir:string):PanelPlace|undefined{
 try{const saved=placeSchema.safeParse(ownedJson(placeFile(stateDir),1024));return saved.success?saved.data:undefined;}catch{return undefined;}
}
export function panelPlaceFromCookie(cookies:string|null):PanelPlace|undefined{
 const m=/(?:^|;\s*)cc_cdx_panel_window=(-?\d+)_(-?\d+)_(\d+)_(\d+)(?:;|$)/.exec(cookies??'');if(!m)return undefined;
 const saved=placeSchema.safeParse({x:+m[1]!,y:+m[2]!,w:+m[3]!,h:+m[4]!});return saved.success?saved.data:undefined;
}
export function savePanelPlace(stateDir:string,place:PanelPlace){
 mkdirSync(stateDir,{recursive:true,mode:0o700});privateDirectory(stateDir);
 const target=placeFile(stateDir),temp=target+'.'+randomUUID()+'.tmp';
 writeFileSync(temp,JSON.stringify(placeSchema.parse(place)),{mode:0o600,flag:'wx'});renameSync(temp,target);
}
// The page carries the saved choice from its first frame, before the panel connects.
export function withPanelPreferences(html:string,p:PanelPreferences){
 return html.replace(/<html lang="en">/,`<html lang="${p.language}"${p.theme==='dark'?' class="dark"':''}>`);
}
