import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { receiver } from './desktop-fixture';
import { activateReceiver } from '../src/activation';
import { doctor } from '../src/doctor';
import { ownCodexParticipant } from '../src/participants';
import { inspectProject, ProjectNotReadable, projectDirectory, projectReadError } from '../src/project';

// macOS privacy protection refuses a folder to an app the person has not allowed with EPERM (as Codex got
// for a OneDrive folder) or EACCES; plain permissions give EACCES and sandbox-exec gives the same EPERM.
let root: string, locked: string, project: string;
const options = () => ({ project, configDir: join(root, 'config'), codexHome: join(root, 'codex'), pluginRoot: join(root, 'plugin') });
const failure = (code: string) => Object.assign(new Error(`${code}: operation refused`), { code });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ccdx-access-')));
  locked = join(root, 'locked'); project = join(locked, 'project');
  mkdirSync(project, { recursive: true });
});
afterEach(() => { chmodSync(locked, 0o700); rmSync(root, { recursive: true, force: true }); });

test('EPERM and EACCES name the app and the fix; ENOENT and other errors pass through', () => {
  for (const code of ['EPERM', 'EACCES']) {
    const error = projectReadError(failure(code), '/Users/me/Library/CloudStorage/OneDrive-Personal/app', 'Codex');
    expect(error).toBeInstanceOf(ProjectNotReadable);
    expect((error as ProjectNotReadable).code).toBe('project_not_readable');
    expect((error as Error).message).toContain('macOS does not let Codex read the project folder /Users/me/Library/CloudStorage/OneDrive-Personal/app');
    expect((error as Error).message).toContain('Privacy & Security › Files and Folders (or Full Disk Access), allow Codex');
  }
  for (const code of ['ENOENT', 'ENOTDIR']) { const error = failure(code); expect(projectReadError(error, project)).toBe(error); }
  expect(() => projectDirectory(join(root, 'missing'))).toThrow(expect.objectContaining({ code: 'ENOENT' }));
});

test('a folder the process cannot read is reported as not readable, not as missing', async () => {
  if (process.getuid?.() === 0) return; // root reads any folder.
  expect(projectDirectory(project)).toBe(project);
  chmodSync(project, 0o000);
  expect(() => projectDirectory(project, 'Claude')).toThrow('macOS does not let Claude read the project folder');
  await expect(inspectProject(project)).rejects.toBeInstanceOf(ProjectNotReadable);
  chmodSync(project, 0o700); chmodSync(locked, 0o000);
  expect(() => projectDirectory(project)).toThrow(ProjectNotReadable);
  const report = await doctor(options());
  expect(report.state).toBe('project_not_readable');
  expect(report.checks).toEqual([{ code: 'project_not_readable', level: 'blocked', message: `macOS does not let this app read the project folder ${project}.`,
    remedy: expect.stringContaining('Files and Folders (or Full Disk Access)') }]);
  chmodSync(locked, 0o700); rmSync(project, { recursive: true });
  expect((await doctor(options())).checks).toEqual([expect.objectContaining({ code: 'project_missing', message: 'Project directory is unavailable.' })]);
});

test('an EPERM refusal like Codex got in a cloud-storage folder blocks diagnose with project_not_readable', async () => {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return;
  const script = join(root, 'probe.ts'), source = resolve(import.meta.dir, '../src');
  writeFileSync(script, `
    import { doctor } from ${JSON.stringify(join(source, 'doctor'))};
    import { inspectProject, setReaderApp } from ${JSON.stringify(join(source, 'project'))};
    setReaderApp('Codex');
    const options = ${JSON.stringify(options())};
    let inspected = null;
    try { await inspectProject(options.project); } catch (error) { inspected = { name: error.constructor.name, message: error.message }; }
    console.log(JSON.stringify({ report: await doctor(options), inspected }));`);
  const child = Bun.spawnSync(['/usr/bin/sandbox-exec', '-p', `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(locked)}))`, process.execPath, script],
    { stdout: 'pipe', stderr: 'pipe' });
  expect(child.stderr.toString()).toBe('');
  const { report, inspected } = JSON.parse(child.stdout.toString());
  expect(report.state).toBe('project_not_readable');
  expect(report.checks[0]).toMatchObject({ code: 'project_not_readable', level: 'blocked', message: `macOS does not let Codex read the project folder ${project}.` });
  expect(report.checks[0].remedy).toContain('allow Codex, then quit and reopen Codex');
  expect(inspected).toEqual({ name: 'ProjectNotReadable', message: expect.stringContaining('macOS does not let Codex read') });
});

test('a Codex chat whose folder Codex cannot read says so instead of a missing session', async () => {
  if (process.getuid?.() === 0) return;
  const home = join(root, 'desktop'); mkdirSync(home);
  const desktop = await receiver('idle', false, false, home);
  try {
    const participants = { configDir: join(root, 'config'), stateDir: join(root, 'state'), ipcPath: desktop.path };
    mkdirSync(join(participants.configDir, 'sessions'), { recursive: true, mode: 0o700 });
    desktop.setProject(project);
    await expect(ownCodexParticipant(participants, desktop.threadId)).rejects.toThrow('Claude session is unavailable or ambiguous');
    chmodSync(locked, 0o000);
    await expect(ownCodexParticipant(participants, desktop.threadId)).rejects.toThrow('macOS does not let this app read the project folder ' + project);
    await expect(activateReceiver({ threadId: desktop.threadId, project, configDir: participants.configDir, codexHome: home, hookPath: '/nonexistent' }))
      .rejects.toBeInstanceOf(ProjectNotReadable);
  } finally { chmodSync(locked, 0o700); await desktop.close(); }
});
