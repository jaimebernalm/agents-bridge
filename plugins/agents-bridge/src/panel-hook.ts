// Claude Code command hook for the panel's link. Claude treats an instruction inside a tool result as untrusted, and it
// also assumed the person could see the link in the tool result, so it kept skipping the lines it was asked to show.
// PostToolUse (on the bridge tools that hand back the link) repeats those lines as hook context, once per link and chat;
// Stop keeps the turn going once if the agent's messages still lack the link. A hook's systemMessage is not shown in
// Claude Desktop's chat, so the agent has to write it there. A terminal chat does show it, so in the Claude CLI the hook
// shows the link itself and the agent is told not to repeat it; there is nothing to enforce at Stop. Codex needs no hook:
// its chat shows the lines it is given.
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { hookPaths, privateSubdirectory, writeAtomic } from './claude-sidecar';
import { panelTexts } from './panel-card';
import { readPanelPreferences } from './panel-preferences';

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

type Notices = {shown: string[]; pending?: {link: string; markdown: string; at?: number}};
// A turn the person interrupts ends without Stop; past this, its reminder is dropped rather than added to a later turn.
const pendingFor = 2 * 60 * 60 * 1000;

function noticesFile(stateDir: string, session: string) {
  return join(privateSubdirectory(stateDir, 'panel-notices'), createHash('sha256').update(session).digest('hex').slice(0, 32) + '.json');
}
function readNotices(file: string): Notices {
  try {
    if (existsSync(file)) {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (Array.isArray(value)) return { shown: value };
      if (Array.isArray(value?.shown)) return value;
    }
  } catch {}
  return { shown: [] };
}

const showLines = (markdown: string) => 'The person sees neither tool results nor this note: the panel\'s link reaches them only if '
  + 'your own message contains it. Begin your next message to the person with these lines, exactly as they are; they open this '
  + 'collaboration\'s panel, the only way to watch it from this chat. Do not paraphrase them, and do not say you opened the panel yourself.\n\n' + markdown;

// What the hook hands over for a new link: context for the agent and, in a terminal, a notice the person sees.
export type PanelHandOff = {context: string; notice?: string};

export function panelContext(stateDir: string, event: {session_id?: unknown; tool_response?: unknown}, now = Date.now(), terminal = false): PanelHandOff | undefined {
  const panel = panelIn(event.tool_response);
  if (!panel || typeof event.session_id !== 'string') return undefined;
  const file = noticesFile(stateDir, event.session_id), notices = readNotices(file);
  if (notices.shown.includes(panel.link)) return undefined;
  const shown = [...notices.shown.slice(-20), panel.link];
  if (terminal) {
    writeAtomic(file, { shown });
    return { notice: `▶️ ${panelTexts[readPanelPreferences(stateDir).language].link}: ${panel.link}`,
      context: 'From the Agents Bridge plugin: the person already sees this collaboration\'s panel link in the terminal, shown by the plugin. Do not repeat it, and do not say you opened the panel.' };
  }
  writeAtomic(file, { shown, pending: { ...panel, at: now } });
  return { context: 'From the Agents Bridge plugin: ' + showLines(panel.markdown) };
}

// A chat in a terminal (Claude CLI) rather than Claude Desktop: Claude Code tells its hooks where it runs.
export const inTerminal = (env: Record<string, string | undefined> = process.env) => env.CLAUDE_CODE_ENTRYPOINT === 'cli';

// The agent's own words in this chat, from its transcript: the text blocks of its messages.
function agentText(transcript: string) {
  let text = '';
  for (const line of readFileSync(transcript, 'utf8').split('\n')) {
    if (!line.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) if (block?.type === 'text' && typeof block.text === 'string') text += block.text + '\n';
      }
    } catch {}
  }
  return text;
}

// At the end of a turn: when a link was handed over and the agent has not written it, keep the turn going once to write it.
export function panelReminder(stateDir: string, event: {session_id?: unknown; transcript_path?: unknown; last_assistant_message?: unknown}, now = Date.now()): string | undefined {
  if (typeof event.session_id !== 'string') return undefined;
  const file = noticesFile(stateDir, event.session_id), notices = readNotices(file);
  if (!notices.pending) return undefined;
  const { link, markdown, at } = notices.pending;
  writeAtomic(file, { shown: notices.shown });
  if (typeof at !== 'number' || now - at > pendingFor) return undefined;
  const written = (typeof event.last_assistant_message === 'string' && event.last_assistant_message.includes(link))
    || (typeof event.transcript_path === 'string' && event.transcript_path.endsWith('.jsonl') && existsSync(event.transcript_path) && agentText(event.transcript_path).includes(link));
  return written ? undefined : 'Before you stop, the Agents Bridge plugin needs one short message from you. ' + showLines(markdown)
    .replace('Begin your next message to the person with these lines', 'Write a message to the person made of these lines');
}

if (import.meta.main) {
  try {
    const event = JSON.parse(await Bun.stdin.text()), { stateDir } = hookPaths();
    if (event.hook_event_name === 'Stop') {
      const reason = panelReminder(stateDir, event);
      if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    } else {
      const handOff = panelContext(stateDir, event, Date.now(), inTerminal());
      if (handOff) process.stdout.write(JSON.stringify({ ...(handOff.notice ? { systemMessage: handOff.notice } : {}),
        hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: handOff.context } }));
    }
  } catch { /* A broken or unrelated event shows nothing. */ }
  process.exitCode = 0;
}
