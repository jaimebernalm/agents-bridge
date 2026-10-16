// Claude Code command hook (PostToolUse on AskUserQuestion). It hands the person's answer to a bridge question
// straight to the bridge; Codex needs no hook, because it writes the answer into the chat's own history. It never prints, because hook output reaches the model, and it never blocks the chat.
import { recordAnswer } from './bridge-questions';
import { hookPaths } from './claude-sidecar';

if (import.meta.main) {
  try { recordAnswer(hookPaths().stateDir, JSON.parse(await Bun.stdin.text())); }
  catch { /* A broken or unrelated event leaves the question unanswered. */ }
  process.exitCode = 0;
}
