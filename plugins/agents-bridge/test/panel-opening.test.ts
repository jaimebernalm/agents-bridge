import { describe, expect, test } from 'bun:test';
import { launchLocalBrowser, type Run } from '../src/panel-opening';

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
    expect(await launchLocalBrowser(url, r.exec, 'darwin', { AGENTS_BRIDGE_PANEL_APP_WINDOW: '0' })).toBe('tab');
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
