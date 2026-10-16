// Claude Code command hook (PostToolUse on the bridge tools that hand back the panel's link). Claude treats an instruction
// inside a tool result as untrusted, so it kept skipping the link it was asked to show; this hook shows it to the person
// itself, as a message from Claude Code, once per link and chat. Codex needs no hook: its chat shows the link it is given.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { hookPaths, privateSubdirectory, writeAtomic } from './claude-sidecar';
import { panelTexts } from './panel-card';
import { readPanelPreferences } from './panel-preferences';

const openLink = /^http:\/\/127\.0\.0\.1:\d+\/open\?k=[0-9a-f]{32}$/;

// MCP results arrive as content blocks whose text is the tool's own JSON; the link is its panel.link.
export function panelLinkIn(response: unknown): string | undefined {
  const texts: string[] = [], walk = (v: unknown) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(response);
  for (const text of texts) {
    try { const link = JSON.parse(text)?.panel?.link; if (typeof link === 'string' && openLink.test(link)) return link; } catch {}
  }
  return undefined;
}

export function panelNotice(stateDir: string, event: {session_id?: unknown; tool_response?: unknown}): string | undefined {
  const link = panelLinkIn(event.tool_response);
  if (!link || typeof event.session_id !== 'string') return undefined;
  const file = join(privateSubdirectory(stateDir, 'panel-notices'), createHash('sha256').update(event.session_id).digest('hex').slice(0, 32) + '.json');
  let shown: string[] = [];
  try { if (existsSync(file)) shown = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (shown.includes(link)) return undefined;
  writeAtomic(file, [...shown.slice(-20), link]);
  return `▶️ ${panelTexts[readPanelPreferences(stateDir).language].link}: ${link}`;
}

if (import.meta.main) {
  try {
    const notice = panelNotice(hookPaths().stateDir, JSON.parse(await Bun.stdin.text()));
    if (notice) process.stdout.write(JSON.stringify({ systemMessage: notice }));
  } catch { /* A broken or unrelated event shows nothing. */ }
  process.exitCode = 0;
}
