import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { panelLinkIn, panelNotice } from '../src/panel-hook';
import { savePanelPreferences } from '../src/panel-preferences';

const link = 'http://127.0.0.1:49595/open?k=' + 'a'.repeat(32);
// What Claude Code hands a PostToolUse hook for an MCP tool: content blocks whose text is the tool's JSON.
const response = (panel: unknown) => [{ type: 'text', text: JSON.stringify({ state: 'started', panel, instruction: 'x' }) }];

test('the link is read only from the panel of a bridge result', () => {
  expect(panelLinkIn(response({ link, markdown: 'm' }))).toBe(link);
  expect(panelLinkIn({ content: response({ link }) })).toBe(link);
  expect(panelLinkIn(response({ link: 'https://example.com/open?k=' + 'a'.repeat(32) }))).toBeUndefined();
  expect(panelLinkIn([{ type: 'text', text: 'not json ' + link }])).toBeUndefined();
  expect(panelLinkIn(response(undefined))).toBeUndefined();
});

test('the person sees each link once per chat, in their language', () => {
  const state = mkdtempSync('/tmp/panel-hook-');
  try {
    const event = { session_id: 'chat-1', tool_response: response({ link }) };
    expect(panelNotice(state, event)).toBe(`▶️ Open the bridge panel: ${link}`);
    expect(panelNotice(state, event)).toBeUndefined();
    expect(statSync(join(state, 'panel-notices')).mode & 0o077).toBe(0);
    savePanelPreferences(state, { language: 'es' });
    expect(panelNotice(state, { ...event, session_id: 'chat-2' })).toBe(`▶️ Abrir el panel del bridge: ${link}`);
    expect(panelNotice(state, { session_id: 'chat-3', tool_response: [{ type: 'text', text: '{}' }] })).toBeUndefined();
  } finally { rmSync(state, { recursive: true, force: true }); }
});
