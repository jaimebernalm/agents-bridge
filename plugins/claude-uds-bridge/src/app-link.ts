// Opens a new conversation through each Desktop app's own registered link, with the folder and the
// first message filled in. The person still presses send, so the app link creates nothing by itself.
export type AppLauncher = (url: string) => Promise<void>;

export function newConversationLink(provider: 'codex' | 'claude', project: string, prompt: string) {
  if (provider === 'codex') return `codex://threads/new?${new URLSearchParams({ path: project, prompt })}`;
  return `claude://code/new?${new URLSearchParams({ folder: project, q: prompt })}`;
}

// The URL is passed as one argument, never through a shell. `open` fails when no app handles the scheme.
export const openWithSystem: AppLauncher = async url => {
  if (process.platform !== 'darwin') throw new Error('Opening the app from the panel is only supported on macOS');
  const child = Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'pipe' });
  if (await child.exited !== 0) throw new Error(`The app could not be opened: ${(await new Response(child.stderr).text()).trim() || 'no app handles this link'}`);
};
