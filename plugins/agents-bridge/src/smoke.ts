import type { Peer } from './claude';
import { claudeSurfaceSupported } from './surfaces';

// The caller canonicalizes paths before selecting a peer. Never guess a session from its display
// name or fall back to a VS Code, print-mode or SDK session.
export function selectDesktopPeer(candidates: Peer[], project: string, id?: string): Peer {
  const matches = candidates.filter(peer => claudeSurfaceSupported(peer)
    && peer.cwd === project && (!id || peer.sessionId === id));
  if (matches.length !== 1) throw new Error(matches.length
    ? 'Multiple Claude Code sessions use this project; choose one with --peer UUID.'
    : 'Open a local Claude Desktop Code session, or run claude in a terminal, in this project and send its first prompt.');
  return matches[0]!;
}

export function replyMatches(text: string, nonce: string, answer: number): boolean {
  const body = /^<cross-session-message\s[^>]*>\n([\s\S]*)\n<\/cross-session-message>$/.exec(text)?.[1] ?? text;
  return body.trim() === `BRIDGE_PONG ${nonce} ${answer}`;
}
