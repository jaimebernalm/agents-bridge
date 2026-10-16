import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {normalizeRoutine,formatWork,reportSchema,taskSchema,type Task} from '../src/routines';

test('free is default; new/existing/mixed starts use actual supplied analyses and reject contradictory starts',()=>{
 expect(normalizeRoutine(undefined,{})).toMatchObject({mode:'free',startMode:'new',independence:'not_guaranteed'});
 expect(normalizeRoutine({mode:'research'},{codex:'A',claude:'B'})).toMatchObject({mode:'research',startMode:'existing'});
 expect(normalizeRoutine({mode:'review'},{codex:'A'}).startMode).toBe('mixed');
 expect(()=>normalizeRoutine({starts:{codex:'existing',claude:'new'}},{})).toThrow('requires explicit');
 expect(()=>normalizeRoutine({starts:{codex:'new',claude:'new'}},{claude:'B'})).toThrow('conflicts');
 expect(()=>normalizeRoutine({mode:'other' as 'free'},{})).toThrow();
});
test('work envelopes reject forged author fields, malformed metadata and review without a version',()=>{
 const task:Task={taskId:randomUUID(),intent:'discuss'};expect(formatWork(task,'Question')).toBe('CC_CDX_WORK_V1 '+JSON.stringify({kind:'task',...task})+'\nQuestion');
 expect(()=>reportSchema.parse({kind:'response',author:'codex',declaredState:'done'})).toThrow();
 expect(()=>formatWork({taskId:randomUUID(),intent:'review'},'Review')).toThrow('exact');
 expect(()=>reportSchema.parse({kind:'response',declaredState:'done',verdict:'agree'})).toThrow();
 expect(()=>taskSchema.parse({taskId:'not-a-uuid',intent:'discuss'})).toThrow();
 expect(()=>formatWork(task,'   ')).toThrow();
});
