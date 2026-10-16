import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { panelContext, panelIn } from '../src/panel-hook';

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
    expect(context).toStartWith('From the Claude ⇄ Codex Bridge plugin: begin your next message');
    expect(context).toEndWith('\n\n' + markdown);
    expect(panelContext(state, event)).toBeUndefined();
    expect(statSync(join(state, 'panel-notices')).mode & 0o077).toBe(0);
    expect(panelContext(state, { ...event, session_id: 'chat-2' })).toBe(context);
    expect(panelContext(state, { session_id: 'chat-3', tool_response: [{ type: 'text', text: '{}' }] })).toBeUndefined();
  } finally { rmSync(state, { recursive: true, force: true }); }
});
