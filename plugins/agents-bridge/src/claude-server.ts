// MCP entrypoint for Claude Code (Desktop Code tab or terminal). It neither registers in Claude's session registry nor
// opens an inbox socket: Claude keeps receiving through its native transport. Each tool call
// resolves its caller afresh from process evidence (a /clear keeps the PID but changes the session).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appendObservation } from './claude-sidecar';
import { authenticateClaudeCaller, CallerRejected, metaSessionHints, parentPid, type AncestorStep, type AuthenticatedCaller } from './claude-caller';
import { version } from './version';
import { registerDesktopTools } from './desktop-runtime';
import { diagnoseTool, serverInstructions, serverName, stateFolder } from './names';
import { setReaderApp } from './project';

export type Authenticate = (meta?: Record<string, unknown>) => Promise<AuthenticatedCaller>;
export type ClaudeServerOptions = {
  configDir: string; stateDir: string; pid?: number;
  // Claude exports CLAUDE_PLUGIN_ROOT to plugin MCP servers but not to the Bash tool.
  pluginRootEnv?: boolean;
  // The shared collaboration runtime attaches here; it must derive identity only through `authenticate`.
  register?: (server: McpServer, authenticate: Authenticate) => void;
};

export function claudePaths(env = process.env) {
  return {
    configDir: env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    stateDir: env.AGENTS_BRIDGE_STATE_DIR ?? join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'plugin-state', stateFolder),
  };
}

// Measurement log for the identity spike: identifiers and metadata keys only, never values of
// arbitrary metadata, arguments or conversation text.
export function recordObservation(stateDir: string, entry: Record<string, unknown>) {
  appendObservation(stateDir, 'observations.jsonl', entry);
}

export function metaKeys(meta: Record<string, unknown> | undefined) {
  return Object.keys(meta ?? {}).sort().slice(0, 64);
}

export function createClaudeServer(options: ClaudeServerOptions) {
  const authenticate: Authenticate = meta => authenticateClaudeCaller({ configDir: options.configDir, stateDir: options.stateDir, meta, pid: options.pid });
  const server = new McpServer({ name: serverName, version }, { instructions: serverInstructions(
    `${diagnoseTool} reports whether this chat is connected to the bridge; a rejection means the bridge is unavailable here, not that you should supply an ID.`) });
  server.registerTool(diagnoseTool, {
    description: 'Report whether this Claude chat is connected to the bridge and, if not, why. Takes no input: the bridge finds the chat from its own process. Read-only.',
    inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (_args, extra) => {
    const meta = extra._meta as Record<string, unknown> | undefined, trace: AncestorStep[] = [];
    let caller: AuthenticatedCaller | undefined, rejection: { code: string; message: string } | undefined;
    try { caller = await authenticateClaudeCaller({ configDir: options.configDir, stateDir: options.stateDir, meta, pid: options.pid }, trace); }
    catch (error) {
      if (!(error instanceof CallerRejected)) throw error;
      rejection = { code: error.code, message: error.message };
    }
    // A copy started from the conversation's own shell also descends from the engine; the spike
    // counts only servers the host launched directly.
    const between = trace.filter(step => !step.registered).map(step => step.command);
    const hostLaunch = { pluginRootEnv: options.pluginRootEnv ?? !!process.env.CLAUDE_PLUGIN_ROOT, directChildOfEngine: trace[0]?.registered === true,
      launcherOnly: trace.some(step => step.registered) && between.every(command => command === 'sh' || command === 'bun') };
    const report = { serverPid: options.pid ?? process.pid, ancestors: trace, hostLaunch, metaKeys: metaKeys(meta), metaSessionHints: metaSessionHints(meta), caller, rejection };
    // The log keeps this check's original event name so earlier identity measurements still parse.
    recordObservation(options.stateDir, { event: 'caller_status', ...report });
    return { content: [{ type: 'text' as const, text: JSON.stringify(report) }], ...(rejection ? { isError: true } : {}) };
  });
  options.register?.(server, authenticate);
  return server;
}

if (import.meta.main) {
  setReaderApp('Claude');
  const paths = claudePaths();
  let parent: number | null = null;
  try { parent = await parentPid(process.pid); } catch { /* Recorded as unknown. */ }
  recordObservation(paths.stateDir, { event: 'server_start', serverPid: process.pid, parentPid: parent });
  const codexHome=process.env.CODEX_HOME??join(homedir(),'.codex');let runtime:ReturnType<typeof registerDesktopTools>|undefined;const server=createClaudeServer({...paths,register:(s,authenticate)=>{runtime=registerDesktopTools(s,{...paths,codexHome,ipcPath:join(codexHome,'ipc','ipc.sock'),registerAtStartup:true,pluginRoot:process.env.CLAUDE_PLUGIN_ROOT??join(import.meta.dir,'..'),authenticate});}});const close=async()=>{await runtime?.close();};server.server.onclose=close;process.on('SIGTERM',()=>{void close().finally(()=>process.exit(0));});await server.connect(new StdioServerTransport());
}
