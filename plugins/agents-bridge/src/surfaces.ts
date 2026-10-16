// Which Claude Code chats the bridge works with, and the name each surface has where a person reads it.
// Claude Code records its surface in the session registry: the Code tab of Claude Desktop writes entrypoint
// claude-desktop, and an interactive terminal session writes cli with kind interactive. Print mode (-p), IDE
// extensions and SDK sessions are other surfaces and are never substituted for these two.
import { codexEntrypoint } from './names';

export const claudeDesktopSurface = 'claude-desktop', claudeCliSurface = 'cli';
// Surfaces an authenticated Claude caller may have; its kind was checked when it was authenticated.
export const claudeSurfaces: readonly string[] = [claudeDesktopSurface, claudeCliSurface];

export function claudeSurfaceSupported(peer: { entrypoint?: string; kind?: string }) {
  return peer.entrypoint === claudeDesktopSurface || peer.entrypoint === claudeCliSurface && peer.kind === 'interactive';
}

export function surfaceLabel(surface: string | undefined) {
  return surface === codexEntrypoint ? 'Codex Desktop' : surface === claudeDesktopSurface ? 'Claude Desktop'
    : surface === claudeCliSurface ? 'Claude CLI' : surface ?? 'unknown';
}
