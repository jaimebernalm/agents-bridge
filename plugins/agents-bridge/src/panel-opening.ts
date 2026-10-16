import { spawn } from 'node:child_process';

// This requests navigation in the local default browser, never changes reception.
// Headless clients and tests explicitly disable it. A successful dispatch is not
// evidence that a human saw the page.
export class PanelOpening {
  private opened = new Map<string, Promise<{requested: boolean; error?: string}>>();
  constructor(private launch: (url: string) => Promise<unknown> = url => launchLocalBrowser(url)) {}
  open(key: string, url: string, enabled = true, force = false): Promise<{requested: boolean; error?: string}> {
    if (!enabled || process.env.AGENTS_BRIDGE_PANEL_AUTO_OPEN === '0') return Promise.resolve({requested: false});
    const previous = this.opened.get(key); if (previous && !force) return previous;
    // A launcher that throws synchronously still reports {requested:false} instead of escaping.
    const pending = Promise.resolve().then(() => this.launch(url)).then(() => ({requested: true}), () => ({requested: false, error: 'No se pudo abrir el navegador. Abre el enlace privado del panel.'}));
    this.opened.set(key, pending); return pending;
  }
}
export type Run = (command: string, args: string[], timeoutMs: number) => Promise<string>;
const run: Run = (command, args, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'ignore']});
  let output = '';
  child.stdout.on('data', chunk => {output += chunk;});
  const timer = setTimeout(() => {child.kill(); reject(new Error(`${command} timed out`));}, timeoutMs);
  child.once('error', error => {clearTimeout(timer); reject(error);});
  child.once('exit', code => {clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(`${command} failed`));});
});

// Chromium browsers show the panel as an app window, without tabs or address bar, so it reads as
// the bridge's own window rather than one more tab among the person's. Other browsers get a tab.
const appWindowBrowsers = new Set(['com.google.chrome', 'com.google.chrome.beta', 'com.google.chrome.dev', 'com.google.chrome.canary',
  'com.microsoft.edgemac', 'com.microsoft.edgemac.beta', 'com.microsoft.edgemac.dev', 'com.microsoft.edgemac.canary',
  'com.brave.browser', 'com.brave.browser.beta', 'com.brave.browser.nightly', 'org.chromium.chromium', 'com.vivaldi.vivaldi']);
// Launch Services answers which app opens the panel's own kind of link; no extra permission needed.
const defaultBrowserScript = "ObjC.import('AppKit');const app=$.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('http://127.0.0.1/'));app?$.NSBundle.bundleWithURL(app).bundleIdentifier.js:''";

// With a profile of its own the panel runs in a browser instance that holds only panel windows: opening one brings
// nothing else forward, and closing the last one leaves the person's own browser windows where they were.
// A known place opens the window there at its size, so the page has nothing left to move.
type Place = {x: number; y: number; w: number; h: number};
const appWindowArgs = (url: string, profile?: string, place?: Place) => [
  ...(profile ? [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'] : []),
  ...(place ? [`--window-position=${place.x},${place.y}`, `--window-size=${place.w},${place.h}`] : []), `--app=${url}`];

export async function launchLocalBrowser(url: string, exec: Run = run, platform: string = process.platform, env: Record<string, string | undefined> = process.env, profile?: string, place?: Place): Promise<'app' | 'tab'> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') throw new Error('Only the private local panel can be opened');
  if (platform === 'darwin') {
    if (env.AGENTS_BRIDGE_PANEL_APP_WINDOW !== '0') {
      const browser = await exec('osascript', ['-l', 'JavaScript', '-e', defaultBrowserScript], 2000).catch(() => '');
      // -n hands the flag to a browser that is already running. Its single-use token is spent on first load.
      if (appWindowBrowsers.has(browser.toLowerCase()) && await exec('open', ['-n', '-b', browser, '--args', ...appWindowArgs(url, profile, place)], 3000).then(() => true, () => false)) return 'app';
    }
    await exec('open', [url], 3000); return 'tab';
  }
  if (platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY)) {await exec('xdg-open', [url], 3000); return 'tab';}
  throw new Error('No desktop browser launcher available');
}

// A card's button reaches the bridge through the default browser when the app shows the card as a still page (Claude
// does), and that browser brings its own window over the chat. Bringing the chat's app back first, by its bundle so no
// Apple event or permission is involved, leaves the panel window on top of the chat rather than behind the browser.
const chatApps = {claude: 'com.anthropic.claudefordesktop', codex: 'com.openai.codex'} as const;
export async function bringAppForward(provider: 'claude' | 'codex', exec: Run = run, platform: string = process.platform, env: Record<string, string | undefined> = process.env) {
  if (platform !== 'darwin' || env.AGENTS_BRIDGE_PANEL_AUTO_OPEN === '0') return;
  if (await exec('open', ['-b', chatApps[provider]], 2000).then(() => true, () => false)) await Bun.sleep(150);
}

export function panelLink(url: string, target: {runId?: string; authorization?: boolean} = {}) {
  const link = new URL(url), hash = new URLSearchParams(link.hash.slice(1));
  if (target.runId) hash.set('run', target.runId);
  if (target.authorization) hash.set('view', 'authorization');
  link.hash = hash.toString(); return link.toString();
}
