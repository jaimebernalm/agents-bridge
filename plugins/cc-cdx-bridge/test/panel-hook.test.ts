import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { panelContext, panelIn, panelReminder } from '../src/panel-hook';

const link = 'http://127.0.0.1:49595/open?k=' + 'a'.repeat(32);
// What Claude Code hands a PostToolUse hook for an MCP tool: content blocks whose text is the tool's JSON.
const response = (panel: unknown) => [{ type: 'text', text: JSON.stringify({ state: 'started', panel, instruction: 'x' }) }];

const markdown = `> ### ▶️ [Open the bridge panel](${link})\n> Pause, finish or export it there.`;

test('the link is read only from the panel of a bridge result', () => {
  expect(panelIn(response({ link, markdown }))).toEqual({ link, markdown });
  expect(panelIn({ content: response({ link, markdown }) })?.link).toBe(link);
  expect(panelIn(response({ link: 'https://example.com/open?k=' + 'a'.repeat(32), markdown }))).toBeUndefined();
  expect(panelIn(response({ link, markdown: '[elsewhere](https://example.com)' }))).toBeUndefined();
  expect(panelIn([{ type: 'text', text: 'not json ' + link }])).toBeUndefined();
  expect(panelIn(response(undefined))).toBeUndefined();
});

test('the agent is handed each link once per chat', () => {
  const state = mkdtempSync('/tmp/panel-hook-');
  try {
    const event = { session_id: 'chat-1', tool_response: response({ link, markdown }) };
    const context = panelContext(state, event)!;
    expect(context).toStartWith('From the Claude ⇄ Codex Bridge plugin: The person sees neither tool results nor this note');
    expect(context).toEndWith('\n\n' + markdown);
    expect(panelContext(state, event)).toBeUndefined();
    expect(statSync(join(state, 'panel-notices')).mode & 0o077).toBe(0);
    expect(panelContext(state, { ...event, session_id: 'chat-2' })).toBe(context);
    expect(panelContext(state, { session_id: 'chat-3', tool_response: [{ type: 'text', text: '{}' }] })).toBeUndefined();
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test('a turn that ends without the link is kept going once to write it', () => {
  const state = mkdtempSync('/tmp/panel-hook-');
  try {
    const transcript = join(state, 'chat.jsonl');
    const said = (text: string) => writeFileSync(transcript, [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: JSON.stringify({ panel: { link } }) }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
    ].join('\n'));
    const stop = { session_id: 'chat-1', transcript_path: transcript };
    expect(panelReminder(state, stop)).toBeUndefined();
    panelContext(state, { session_id: 'chat-1', tool_response: response({ link, markdown }) });
    said('Codex is answering.');
    const reason = panelReminder(state, stop)!;
    expect(reason).toStartWith('Before you stop, the Claude ⇄ Codex Bridge plugin needs one short message from you.');
    expect(reason).toEndWith('\n\n' + markdown);
    expect(panelReminder(state, stop)).toBeUndefined();
    // Already written: in this turn's last message or anywhere in the agent's own words.
    panelContext(state, { session_id: 'chat-2', tool_response: response({ link, markdown }) });
    expect(panelReminder(state, { session_id: 'chat-2', last_assistant_message: markdown })).toBeUndefined();
    panelContext(state, { session_id: 'chat-3', tool_response: response({ link, markdown }) });
    said(markdown + '\nCodex is answering.');
    expect(panelReminder(state, { ...stop, session_id: 'chat-3' })).toBeUndefined();
  } finally { rmSync(state, { recursive: true, force: true }); }
});
