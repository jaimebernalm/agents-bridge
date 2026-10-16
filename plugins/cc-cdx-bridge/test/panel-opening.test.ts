import { describe, expect, test } from 'bun:test';
import { bringAppForward, coveredApp, launchLocalBrowser, type Run, type ScreenWindow } from '../src/panel-opening';

const url = 'http://127.0.0.1:4100/#token=abc';
function recorder(defaultBrowser: string | Error, failing: string[] = []) {
  const calls: string[][] = [];
  const exec: Run = async (command, args) => {
    calls.push([command, ...args]);
    if (command === 'osascript') { if (defaultBrowser instanceof Error) throw defaultBrowser; return defaultBrowser; }
    if (failing.includes(args[0]!)) throw new Error(`${command} failed`);
    return '';
  };
  return { calls, exec, launches: () => calls.filter(c => c[0] !== 'osascript') };
}

describe('opening the panel window', () => {
  test('a Chromium default browser opens the panel as its own app window', async () => {
    const r = recorder('com.google.Chrome');
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {})).toBe('app');
    expect(r.launches()).toEqual([['open', '-n', '-b', 'com.google.Chrome', '--args', `--app=${url}`]]);
  });
  test('with a profile, the app window runs in a browser instance of its own', async () => {
    const r = recorder('com.google.Chrome');
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {}, '/state/panel-browser')).toBe('app');
    expect(r.launches()).toEqual([['open', '-n', '-b', 'com.google.Chrome', '--args', '--user-data-dir=/state/panel-browser', '--no-first-run', '--no-default-browser-check', `--app=${url}`]]);
  });
  test('a remembered place opens the app window there at its size', async () => {
    const r = recorder('com.google.Chrome');
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {}, '/state/panel-browser', {x: 2690, y: -218, w: 845, h: 651})).toBe('app');
    expect(r.launches()).toEqual([['open', '-n', '-b', 'com.google.Chrome', '--args', '--user-data-dir=/state/panel-browser', '--no-first-run', '--no-default-browser-check', '--window-position=2690,-218', '--window-size=845,651', `--app=${url}`]]);
  });
  test('other default browsers keep a normal tab', async () => {
    const r = recorder('com.apple.Safari');
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {})).toBe('tab');
    expect(r.launches()).toEqual([['open', url]]);
  });
  test('a failed app window falls back to a tab', async () => {
    const r = recorder('com.brave.Browser', ['-n']);
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {})).toBe('tab');
    expect(r.launches()).toEqual([['open', '-n', '-b', 'com.brave.Browser', '--args', `--app=${url}`], ['open', url]]);
  });
  test('an unknown default browser keeps a tab', async () => {
    const r = recorder(new Error('osascript timed out'));
    expect(await launchLocalBrowser(url, r.exec, 'darwin', {})).toBe('tab');
    expect(r.launches()).toEqual([['open', url]]);
  });
  test('the app window can be turned off', async () => {
    const r = recorder('com.google.Chrome');
    expect(await launchLocalBrowser(url, r.exec, 'darwin', { CC_CDX_PANEL_APP_WINDOW: '0' })).toBe('tab');
    expect(r.calls).toEqual([['open', url]]);
  });
  test('Linux keeps its default opener', async () => {
    const r = recorder('unused');
    expect(await launchLocalBrowser(url, r.exec, 'linux', { DISPLAY: ':0' })).toBe('tab');
    expect(r.calls).toEqual([['xdg-open', url]]);
    await expect(launchLocalBrowser(url, r.exec, 'linux', {})).rejects.toThrow('No desktop browser launcher');
  });
  test('only the private local panel can be opened', async () => {
    const r = recorder('com.google.Chrome');
    await expect(launchLocalBrowser('https://example.com/', r.exec, 'darwin', {})).rejects.toThrow('Only the private local panel');
    await expect(launchLocalBrowser('http://localhost:4100/', r.exec, 'darwin', {})).rejects.toThrow('Only the private local panel');
    expect(r.calls).toEqual([]);
  });
});

describe('bringing the chat back before the panel opens', () => {
  test('macOS brings each chat app forward by its bundle, and nothing happens elsewhere', async () => {
    const r = recorder('');
    await bringAppForward('claude', r.exec, 'darwin', {});
    await bringAppForward('codex', r.exec, 'darwin', {});
    await bringAppForward('claude', r.exec, 'linux', {});
    await bringAppForward('claude', r.exec, 'darwin', {CC_CDX_PANEL_AUTO_OPEN: '0'});
    expect(r.launches()).toEqual([['open', '-b', 'com.anthropic.claudefordesktop'], ['open', '-b', 'com.openai.codex']]);
  });

  test('an app that cannot be brought forward does not stop the panel from opening', async () => {
    const r = recorder('', ['-b']);
    await expect(bringAppForward('claude', r.exec, 'darwin', {})).resolves.toBeUndefined();
  });

  test('the app the browser\'s window came over, on any screen, comes back before the chat', async () => {
    const windows: ScreenWindow[] = [
      {pid: 2, bundle: 'com.google.Chrome', x: 0, y: 33, w: 1728, h: 985},
      {pid: 1, bundle: 'com.anthropic.claudefordesktop', x: 1728, y: -273, w: 1920, h: 1050},
      {pid: 3, bundle: 'com.openai.codex', x: 0, y: 33, w: 1728, h: 986}];
    const calls: string[][] = [];
    const exec: Run = async (command, args) => {
      calls.push([command, ...args]);
      if (command !== 'osascript') return '';
      return args[3]!.includes('CGWindowList') ? JSON.stringify(windows) : 'com.google.Chrome';
    };
    await bringAppForward('claude', exec, 'darwin', {});
    expect(calls.filter(c => c[0] === 'open')).toEqual([['open', '-b', 'com.openai.codex'], ['open', '-b', 'com.anthropic.claudefordesktop']]);
  });
});

describe('what the browser covered', () => {
  const at = (pid: number, bundle: string, x: number) => ({pid, bundle, x, y: 0, w: 100, h: 100});
  test('only a window under the browser\'s front window counts, and only when the browser is in front', () => {
    expect(coveredApp([at(2, 'com.google.Chrome', 0), at(1, 'chat', 500), at(3, 'other', 50)], 'com.google.chrome', 'chat')).toBe('other');
    expect(coveredApp([at(2, 'com.google.Chrome', 0), at(2, 'com.google.Chrome', 20), at(1, 'chat', 0)], 'com.google.Chrome', 'chat')).toBeUndefined();
    expect(coveredApp([at(1, 'chat', 0), at(2, 'com.google.Chrome', 0), at(3, 'other', 0)], 'com.google.Chrome', 'chat')).toBeUndefined();
    expect(coveredApp([at(2, 'com.google.Chrome', 0), at(3, 'other', 500)], 'com.google.Chrome', 'chat')).toBeUndefined();
    expect(coveredApp([], 'com.google.Chrome', 'chat')).toBeUndefined();
  });
});
