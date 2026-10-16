import {describe,expect,test} from 'bun:test';
import {syncEditAuthorization} from '../src/lib/collaboration-form';

describe('authorization on a retried start',()=>{
 const run={id:'run',coordination:{revision:1},editAuthorization:{valid:true,scope:'Whole project'}};
 const recorder=()=>{const calls:unknown[]=[];return {calls,api:async<T>(path:string,body?:unknown)=>{calls.push({path,body});return undefined as T}}};
 test('turning edits off revokes the persisted grant',async()=>{const {api,calls}=recorder();await syncEditAuthorization(api,run,{enabled:false,scope:''});expect(calls).toEqual([{path:'desktop/edit_authorization',body:{runId:'run',expectedRevision:1,revoke:true}}])});
 test('narrowing scope replaces the persisted grant',async()=>{const {api,calls}=recorder();await syncEditAuthorization(api,run,{enabled:true,scope:'  Only ui/  '});expect(calls).toEqual([{path:'desktop/edit_authorization',body:{runId:'run',expectedRevision:1,scope:'Only ui/'}}])});
 test('unchanged scope needs no new grant',async()=>{const {api,calls}=recorder();await syncEditAuthorization(api,run,{enabled:true,scope:'Whole project'});expect(calls).toEqual([])});
 test('blank enabled scope cannot authorize anything',async()=>{const {api,calls}=recorder();await expect(syncEditAuthorization(api,run,{enabled:true,scope:'  '})).rejects.toThrow();expect(calls).toEqual([])});
});
