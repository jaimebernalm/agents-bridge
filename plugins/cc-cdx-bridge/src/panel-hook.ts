// Claude Code command hook (PostToolUse on the bridge tools that hand back the panel's link). Claude treats an instruction
// inside a tool result as untrusted, so it often skipped the link it was asked to show; this hook hands the agent the same
// lines as hook context, once per link and chat. (A hook's systemMessage is not shown in Claude Desktop's chat.) Codex needs
// no hook: its chat shows the lines it is given.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { hookPaths, privateSubdirectory, writeAtomic } from './claude-sidecar';

const openLink = /^http:\/\/127\.0\.0\.1:\d+\/open\?k=[0-9a-f]{32}$/;

// MCP results arrive as content blocks whose text is the tool's own JSON; the link is its panel.link.
export function panelIn(response: unknown): {link: string; markdown: string} | undefined {
  const texts: string[] = [], walk = (v: unknown) => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(response);
  for (const text of texts) {
    try {
      const { link, markdown } = JSON.parse(text)?.panel ?? {};
      if (typeof link === 'string' && openLink.test(link) && typeof markdown === 'string' && markdown.includes(`](${link})`)) return { link, markdown };
    } catch {}
  }
  return undefined;
}

export function panelContext(stateDir: string, event: {session_id?: unknown; tool_response?: unknown}): string | undefined {
  const panel = panelIn(event.tool_response);
  if (!panel || typeof event.session_id !== 'string') return undefined;
  const { link } = panel;
  const file = join(privateSubdirectory(stateDir, 'panel-notices'), createHash('sha256').update(event.session_id).digest('hex').slice(0, 32) + '.json');
  let shown: string[] = [];
  try { if (existsSync(file)) shown = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (shown.includes(link)) return undefined;
  writeAtomic(file, [...shown.slice(-20), link]);
  return 'From the Claude ⇄ Codex Bridge plugin: begin your next message to the person with these lines, exactly as they are. '
    + 'They are the link that opens this collaboration\'s panel, the only way to watch it from this chat; do not paraphrase them, '
    + 'and do not say you opened the panel yourself.\n\n' + panel.markdown;
}

if (import.meta.main) {
  try {
    const context = panelContext(hookPaths().stateDir, JSON.parse(await Bun.stdin.text()));
    if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }));
  } catch { /* A broken or unrelated event shows nothing. */ }
  process.exitCode = 0;
}
