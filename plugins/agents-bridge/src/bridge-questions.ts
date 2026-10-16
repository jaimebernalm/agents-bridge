// Questions the bridge asks the person through each app's own question tool (AskUserQuestion in Claude
// Code, request_user_input or request_user_input_async in Codex). The agent shows the question, but the
// answer reaches the bridge from the app itself, so the bridge never has to take the agent's word for it:
// Claude's hook after AskUserQuestion hands it over, and Codex writes it into the chat's own history.
import { randomUUID } from 'node:crypto';
import { closeSync, fstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ownedJson, uuid } from './claude';
import { privateSubdirectory, writeAtomic, writeOnce } from './claude-sidecar';
import { findCodexChatRollout } from './codex-rollout';
import { readPanelPreferences } from './panel-preferences';

// A card stays answerable for a day, so a person who steps away can still answer it; past that it expires unanswered.
export const questionLifetimeMs = 24 * 60 * 60_000;
export const questionExpired = (record: QuestionRecord, now = Date.now()) => !record.received && now - record.askedAt > questionLifetimeMs;
const maxRawResponse = 4000;

const optionSchema = z.object({ label: z.string(), description: z.string() }).strict();
// One card asks up to three questions (the most Codex shows at once); every answer is kept by the question's position.
const itemSchema = z.object({ header: z.string(), question: z.string(), options: z.array(optionSchema) }).strict();
export const questionRecordSchema = z.object({
  id: uuid, code: z.string(), provider: z.enum(['claude', 'codex']), sessionId: uuid, askedAt: z.number(),
  // What the card decides: the sample test, or one collaboration proposal pinned by subject (its id and content hash).
  purpose: z.enum(['test', 'collaboration']).default('test'), subject: z.string().nullable().default(null),
  questions: z.array(itemSchema).min(1).max(3),
  received: z.object({ at: z.number(), source: z.enum(['app_hook', 'app_history']).default('app_hook'), tool: z.string(),
    exactQuestion: z.boolean(), answers: z.array(z.string().nullable()), responseShape: z.array(z.string()), rawResponse: z.string().nullable() }).strict().nullable(),
}).strict();
export type QuestionRecord = z.infer<typeof questionRecordSchema>;
export type QuestionItem = z.infer<typeof itemSchema>;

// A tool call shows this card when it carries its code (the test question shows it) or one of its questions word for word.
export type QuestionContent = { purpose: QuestionRecord['purpose']; subject: string | null; questions: (code: string) => QuestionItem[] };
const texts = {
  en: { question: (code: string) => `Bridge test ${code}: can you see this question in the app?`,
    options: [{ label: 'Yes, I see it', description: 'The question shows up in this app' },
      { label: 'Yes, but it is confusing', description: 'It shows up, but it is hard to understand' }] },
  es: { question: (code: string) => `Prueba del bridge ${code}: ¿ves esta pregunta en la app?`,
    options: [{ label: 'Sí, la veo', description: 'La pregunta aparece en esta app' },
      { label: 'Sí, pero es confusa', description: 'Aparece, pero no se entiende bien' }] },
};

const directory = (stateDir: string) => privateSubdirectory(stateDir, 'bridge-questions');

export const questionLanguage = (stateDir: string) => readPanelPreferences(stateDir).language;
export const testQuestion = (stateDir: string): QuestionContent => {
  const t = texts[questionLanguage(stateDir)];
  return { purpose: 'test', subject: null, questions: code => [{ header: 'Bridge', question: t.question(code), options: t.options }] };
};

export function createQuestion(stateDir: string, asker: { provider: 'claude' | 'codex'; sessionId: string }, content = testQuestion(stateDir), now = Date.now()): QuestionRecord {
  const id = randomUUID(), code = 'B-' + id.replace(/-/g, '').slice(0, 4).toUpperCase();
  const record: QuestionRecord = { id, code, provider: asker.provider, sessionId: asker.sessionId, askedAt: now, purpose: content.purpose,
    subject: content.subject, questions: content.questions(code), received: null };
  writeAtomic(join(directory(stateDir), `${id}.json`), record);
  return record;
}

// What the agent passes to its question tool: the shape of AskUserQuestion's input (Codex's tools take the same texts).
export const askOf = (record: QuestionRecord) => ({ questions: record.questions.map(item => ({ ...item, multiSelect: false })) });

export function readQuestion(stateDir: string, id: string): QuestionRecord | undefined {
  try { return questionRecordSchema.parse(ownedJson(join(directory(stateDir), `${uuid.parse(id)}.json`), 65536)); }
  catch { return undefined; }
}

function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, found);
  return found;
}

// The questions as a question tool call showed them: Claude's question, Codex's title, with the id Codex may give each,
// and their options (Claude's labels with descriptions, Codex's plain labels).
type Shown = { id: string | null; text: string; options: { label: string; description: string | null }[] };
function shownQuestions(input: unknown): Shown[] {
  const list = input && typeof input === 'object' ? (input as { questions?: unknown }).questions : undefined;
  return (Array.isArray(list) ? list : []).map(item => {
    const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const text = typeof entry.question === 'string' ? entry.question : typeof entry.title === 'string' ? entry.title : '';
    const options = (Array.isArray(entry.options) ? entry.options : []).map(option => typeof option === 'string' ? { label: option.trim(), description: null }
      : option && typeof option === 'object' ? { label: String((option as { label?: unknown }).label ?? '').trim(),
        description: typeof (option as { description?: unknown }).description === 'string' ? (option as { description: string }).description.trim() : null } : { label: '', description: null });
    return { id: typeof entry.id === 'string' ? entry.id : null, text: text.trim(), options };
  });
}
// Word for word: every question with its own text and exactly its own options, and any description shown is the bridge's.
// A changed option, or a description that says something else, would let the person pick a label believing it means another thing.
const sameOptions = (item: QuestionItem, shown: Shown) => shown.options.length === item.options.length
  && item.options.every(option => shown.options.some(s => s.label === option.label.trim() && (s.description === null || s.description === option.description.trim())));
// Exactly the card: no question left out, repeated or added, since an extra copy of a question could carry another answer.
const showsCard = (record: QuestionRecord, raw: string, shown: Shown[]) => raw.includes(record.code) || record.questions.some(item => shown.some(s => s.text === item.question.trim()));
const exactly = (record: QuestionRecord, shown: Shown[]) => shown.length === record.questions.length
  && record.questions.every(item => shown.filter(s => s.text === item.question.trim() && sameOptions(item, s)).length === 1);

// The value an app keys by this question: Claude's answers map uses the question text, Codex's request_user_input the id it gave it.
function keyed(response: unknown, matches: (key: string) => boolean): string | null {
  if (!response || typeof response !== 'object') return null;
  for (const [key, item] of Object.entries(response)) {
    if (matches(key) && item !== null && item !== undefined) return strings(item).join(', ').trim() || null;
    const nested = keyed(item, matches);
    if (nested) return nested;
  }
  return null;
}
function answersFrom(response: unknown, shown: Shown[], record: QuestionRecord): (string | null)[] {
  // Both apps put the answers under `answers`; anything beside them, such as Claude's notes on an answer, is not one.
  const given = response && typeof response === 'object' && 'answers' in response ? (response as { answers: unknown }).answers : response;
  return record.questions.map(item => {
    const text = item.question.trim(), id = shown.find(s => s.text === text)?.id;
    const found = keyed(given, key => key.trim() === text) ?? (id ? keyed(given, key => key === id) : null);
    if (found || record.questions.length > 1) return found;
    // A single question may also be answered by any string equal to one of its labels.
    const labels = new Set(item.options.map(option => option.label));
    return strings(response).find(value => labels.has(value.trim()))?.trim() ?? null;
  });
}

export const answerHookInputSchema = z.object({ session_id: uuid, hook_event_name: z.literal('PostToolUse'), tool_name: z.string() }).loose();

// Called by Claude's hook after AskUserQuestion. Only a pending question of this same chat whose code the tool
// showed is touched; any other question tool use is ignored and nothing about it is kept. The hook and these files
// belong to the person's own account: what this guards against is an agent's or the other chat's word, while a process
// free to write the bridge's own files is kept out by the app's sandbox, as it is from the bridge's database.
export function recordAnswer(stateDir: string, raw: unknown, now = Date.now()) {
  const input = answerHookInputSchema.parse(raw);
  if (input.tool_name !== 'AskUserQuestion') return [];
  const shown = JSON.stringify(input.tool_input ?? null), questions = shownQuestions(input.tool_input);
  let names: string[];
  try { names = readdirSync(directory(stateDir)).filter(name => name.endsWith('.json')); } catch { return []; }
  const updated: QuestionRecord[] = [];
  for (const name of names) {
    const record = readQuestion(stateDir, name.slice(0, -5));
    if (!record || record.received || record.sessionId !== input.session_id || now - record.askedAt > questionLifetimeMs || !showsCard(record, shown, questions)) continue;
    const response = input.tool_response ?? input.tool_output ?? input.output ?? null;
    const rawResponse = response === null ? null : JSON.stringify(response).slice(0, maxRawResponse);
    const next: QuestionRecord = { ...record, received: { at: now, source: 'app_hook', tool: input.tool_name, exactQuestion: exactly(record, questions),
      answers: answersFrom(response, questions, record), responseShape: Object.keys(input).sort(), rawResponse } };
    writeAtomic(join(directory(stateDir), name), next);
    updated.push(next);
  }
  return updated;
}

const codexQuestionTools = ['request_user_input', 'request_user_input_async'];
const replyBlock = /^<send_user_message_question_reply>\n?([\s\S]*?)\n?<\/send_user_message_question_reply>$/;
const maxRolloutBytes = 64 * 1024 * 1024, clockSlackMs = 5_000;

function tail(path: string) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size, length = Math.min(size, maxRolloutBytes), buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, size - length)).toString('utf8');
  } finally { closeSync(fd); }
}

// Codex records the question call with its call_id, then the person's reply as a user message the app writes:
// only a <send_user_message_question_reply> block naming that call_id. Messages the bridge delivers always start
// with the bridge's own envelope, so text from the other chat can never be read as this reply. The reply holds one
// entry per question, each tied to the call and to the question's position in it.
export function codexAnswer(codexHome: string, record: QuestionRecord, now = Date.now()): QuestionRecord['received'] {
  const path = findCodexChatRollout(codexHome, record.sessionId, record.askedAt, now);
  if (!path) return null;
  const calls = new Map<string, { tool: string; shown: Shown[] }>();
  // Only what happened while this card was open: an older card in the same chat may share its short code and texts.
  const open = (at: number) => at >= record.askedAt - clockSlackMs && at - record.askedAt <= questionLifetimeMs;
  for (const line of tail(path).split('\n')) {
    let entry: { timestamp?: string; type?: string; payload?: Record<string, any> };
    try { entry = JSON.parse(line); } catch { continue; }
    const payload = entry.payload ?? {}, at = Date.parse(entry.timestamp ?? '');
    if (!open(at)) continue;
    if (payload.type === 'function_call' && codexQuestionTools.includes(payload.name) && typeof payload.call_id === 'string' && typeof payload.arguments === 'string') {
      let args: unknown = null;
      try { args = JSON.parse(payload.arguments); } catch { /* Unreadable arguments show no question. */ }
      const shown = shownQuestions(args);
      if (showsCard(record, payload.arguments, shown)) calls.set(payload.call_id, { tool: payload.name, shown });
    } else if (payload.type === 'function_call_output' && calls.get(payload.call_id)?.tool === 'request_user_input') {
      const call = calls.get(payload.call_id)!, raw = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? null);
      let output: unknown = raw;
      try { output = JSON.parse(raw); } catch { /* Plain text output. */ }
      return { at, source: 'app_history', tool: call.tool, exactQuestion: exactly(record, call.shown), answers: answersFrom(output, call.shown, record),
        responseShape: ['function_call_output'], rawResponse: raw.slice(0, maxRawResponse) };
    } else if (entry.type === 'event_msg' && payload.type === 'item_completed' && payload.item?.type === 'UserMessage') {
      const text = (payload.item.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text)).join('').trim();
      const block = replyBlock.exec(text);
      if (!block) continue;
      let replies: unknown;
      try { replies = JSON.parse(block[1]!); } catch { continue; }
      let call: { tool: string; shown: Shown[] } | undefined;
      const answers: (string | null)[] = record.questions.map(() => null);
      for (const reply of Array.isArray(replies) ? replies : []) {
        let id: unknown;
        try { id = JSON.parse(String(reply?.questionItemId)); } catch { continue; }
        if (!Array.isArray(id) || typeof id[1] !== 'string' || !Number.isInteger(id[2])) continue;
        const replied = calls.get(id[1]);
        if (!replied || id[0] !== replied.tool || typeof reply.answer !== 'string' || (call && call !== replied)) continue;
        call = replied;
        // The question this entry answers is the one the call showed at that position; a lone question counts even reworded.
        const index = record.questions.length === 1 && replied.shown.length === 1 ? 0
          : record.questions.findIndex(item => item.question.trim() === replied.shown[id[2] as number]?.text);
        if (index >= 0) answers[index] = reply.answer;
      }
      if (call) return { at, source: 'app_history', tool: call.tool, exactQuestion: exactly(record, call.shown), answers,
        responseShape: ['question_reply'], rawResponse: block[1]!.slice(0, maxRawResponse) };
    }
  }
  return null;
}

// Fills in a Codex answer from the chat's history once, the same way a hook would have.
export function settleQuestion(stateDir: string, codexHome: string, record: QuestionRecord, now = Date.now()): QuestionRecord {
  if (record.received || record.provider !== 'codex') return record;
  const received = codexAnswer(codexHome, record, now);
  if (!received) return record;
  const next = { ...record, received };
  writeAtomic(join(directory(stateDir), `${record.id}.json`), next);
  return next;
}

// One decision per question: the first caller to consume it acts on the answer, any later call only reads it.
export function consumeQuestion(stateDir: string, id: string, outcome: Record<string, unknown>, now = Date.now()) {
  try { writeOnce(join(directory(stateDir), `${uuid.parse(id)}.used`), { at: now, ...outcome }); return true; }
  catch { return false; }
}
export function questionOutcome(stateDir: string, id: string): Record<string, unknown> | undefined {
  try { return ownedJson(join(directory(stateDir), `${uuid.parse(id)}.used`), 65536) as Record<string, unknown>; }
  catch { return undefined; }
}

// How far the start an answer approved has got, kept on disk so a restarted bridge can pick it up where it was.
export function saveLaunch(stateDir: string, id: string, launch: Record<string, unknown>) {
  writeAtomic(join(directory(stateDir), `${uuid.parse(id)}.launch`), launch);
}
export function readLaunch(stateDir: string, id: string): Record<string, unknown> | undefined {
  try { return ownedJson(join(directory(stateDir), `${uuid.parse(id)}.launch`), 65536) as Record<string, unknown>; }
  catch { return undefined; }
}
