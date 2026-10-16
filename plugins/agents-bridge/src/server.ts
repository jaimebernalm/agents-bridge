import { version } from './version';
import { registerDesktopTools } from './desktop-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { uuid } from './claude';
import { Bridge } from './bridge';
import { HeldDialogs } from './held-dialogs';
import { activateReceiver } from './activation';
import { doctor } from './doctor';
import { ownCodexParticipant } from './participants';
import { setReaderApp } from './project';
import { diagnoseTool, serverInstructions, serverName, stateFolder } from './names';

setReaderApp('Codex');
const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
const stateDir = join(codexHome, 'plugin-state', stateFolder);
let bridge: Bridge | undefined;
let dialogs: HeldDialogs | undefined;

export function callerThread(meta: Record<string, unknown> | undefined): string {
  let turn: unknown = meta?.['x-codex-turn-metadata'];
  if (typeof turn === 'string') { try { turn = JSON.parse(turn); } catch { turn = undefined; } }
  const parsed = z.object({ thread_id: uuid }).safeParse(turn);
  const candidate = parsed.success ? parsed.data.thread_id :
    meta?.['openai/threadId'] ?? meta?.['openai/thread_id'] ?? meta?.codexThreadId ?? meta?.codex_thread_id ?? meta?.threadId ?? meta?.thread_id;
  return uuid.parse(candidate);
}

function current(meta: Record<string, unknown> | undefined) {
  const id = callerThread(meta);
  if (bridge && bridge.threadId !== id) throw new Error('This MCP process is already bound to another Codex task');
  if (!bridge) {
    bridge = new Bridge(id, configDir, stateDir, join(codexHome, 'ipc', 'ipc.sock'));
    dialogs = new HeldDialogs(bridge, server);
  }
  return bridge;
}

function result(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }; }

// Codex reaches the other chat only through the collaboration tools; this server adds the receiver
// that lets Claude's messages into this chat, and the tools to check and connect it.
const server = new McpServer({ name: serverName, version }, { instructions: serverInstructions(
  `If ${diagnoseTool} finds no receiver for this chat, connect_this_chat connects it without losing the conversation.`) });

server.registerTool('session_start', { description: 'Bind the native SessionStart lifecycle hook and start the receiver.',
  inputSchema: { cwd: z.string().refine(isAbsolute) }, _meta: { ui: { visibility: [] } } }, async ({ cwd }, extra) => {
  const threadId = callerThread(extra._meta);
  if (bridge && bridge.threadId !== threadId) throw new Error('This MCP process is already bound to another Codex task');
  await activateReceiver({ threadId, project: cwd, configDir, codexHome, hookPath: join(import.meta.dir, `hook${extname(import.meta.path)}`) });
  current(extra._meta);
  dialogs?.start();
  return { content: [] };
});

server.registerTool('connect_this_chat', { description: 'Connect this existing Codex chat to the bridge so the other chat can reach it, for a chat opened before the plugin’s hooks were trusted. Use it when the person asks or diagnose reports no receiver. Keeps the conversation and changes no permission or reception setting.',
  inputSchema: { cwd: z.string().refine(isAbsolute) }, annotations: { openWorldHint: false } }, async ({ cwd }, extra) => {
  const threadId = callerThread(extra._meta);
  if (bridge && bridge.threadId !== threadId) throw new Error('This MCP process is already bound to another Codex task');
  const attached = await activateReceiver({ threadId, project: cwd, configDir, codexHome, hookPath: join(import.meta.dir, `hook${extname(import.meta.path)}`) });
  current(extra._meta); dialogs?.start();
  return result(attached);
});

server.registerTool(diagnoseTool, { description: 'Check why the bridge works or not in this Codex chat and project: runtime, installation, receiver and reception. Optionally checks one other chat by peerId. Read-only: sends nothing and changes no setting.',
  inputSchema: { cwd: z.string().refine(isAbsolute), peerId: uuid.optional() }, annotations: { readOnlyHint: true, openWorldHint: false } },
  async ({ cwd, peerId }, extra) => result(await doctor({ project: cwd, threadId: callerThread(extra._meta), peerId,
    configDir, codexHome, pluginRoot: dirname(import.meta.dir) })));

const desktopRuntime=registerDesktopTools(server,{configDir,stateDir,ipcPath:join(codexHome,'ipc','ipc.sock'),codexHome,pluginRoot:dirname(import.meta.dir),authenticate:async(meta)=>{
  const id=callerThread(meta);current(meta);
  const participant=await ownCodexParticipant({configDir,stateDir,ipcPath:join(codexHome,'ipc','ipc.sock')},id);
  return {provider:'codex',sessionId:id,pid:participant.pid,procStart:participant.procStart,project:participant.project.directory,
    binding:{method:'codex_meta',generation:id+'|'+participant.procStart,surface:participant.surface,evidence:['native_turn_metadata','process_verified_receiver']}};
}});
server.server.onclose = () => { void (async () => { await desktopRuntime.close(); await dialogs?.close(); await bridge?.close(); })()
  .catch(() => console.error('Bridge shutdown failed.')); };
await server.connect(new StdioServerTransport());
