// The panel as a file the agent hands to the person, so it shows in the chat as a card of its own (Claude Code's
// SendUserFile) instead of a link inside a sentence. Its button, or opening the page in a browser, opens the panel window;
// the page holds only the link that does that, while the panel itself, and everything the person can do there, stays in that window.
import { randomUUID } from 'node:crypto';
import { closeSync, constants, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { privateSubdirectory } from './claude-sidecar';
import { displayName } from './names';

const texts = {
  en: { file: 'Bridge panel.html', title: 'Bridge panel', ask: 'Open the panel in its own window to watch this collaboration, pause it or export it.',
    opening: 'Opening the panel in its own window…', opened: 'The panel opens in its own window. You can close this page.', button: 'Open the panel', stale: 'This chat’s bridge is no longer running, so the panel cannot open from here. Ask in your chat to open the bridge panel.',
    link: 'Open the bridge panel' },
  es: { file: 'Panel del bridge.html', title: 'Panel del bridge', ask: 'Abre el panel en su propia ventana para ver esta colaboración, pausarla o exportarla.',
    opening: 'Abriendo el panel en su propia ventana…', opened: 'El panel se abre en su propia ventana. Puedes cerrar esta página.', button: 'Abrir el panel', stale: 'El bridge de este chat ya no está abierto, así que el panel no se puede abrir desde aquí. Pide en tu chat que abra el panel del bridge.',
    link: 'Abrir el panel del bridge' },
};

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const page = (language: 'en' | 'es', url: string) => {
  const t = texts[language];
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(t.title)}</title>
<style>
:root{--bg:#f7f7f8;--card:#fff;--text:#18181b;--muted:#63636b;--line:#e4e4e7;--accent:#ff7a3d;--accent-text:#1a0d06}
@media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--line:#2e2e33;--accent:#ff7a3d;--accent-text:#1a0d06}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{box-sizing:border-box;width:min(28rem,calc(100% - 32px));padding:28px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 20px;color:var(--muted)}
a{display:inline-block;padding:10px 18px;border-radius:9px;background:var(--accent);color:var(--accent-text);font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>${escape(displayName)}</h1>
<p id="status">${escape(t.ask)}</p>
<a id="again" href="${escape(url)}">${escape(t.button)}</a>
</main>
<script>
// Where the page can run (a browser opening the file), opening it is the click. Claude's preview shows it as a still
// page, where the button opens the link in the browser instead.
const link = ${JSON.stringify(url)}, words = ${JSON.stringify({ opened: t.opened, stale: t.stale, opening: t.opening })};
const status = document.getElementById('status');
async function openPanel() {
  status.textContent = words.opening;
  try { await fetch(link, { mode: 'no-cors', cache: 'no-store' }); status.textContent = words.opened; }
  catch { status.textContent = words.stale; }
}
document.getElementById('again').addEventListener('click', event => { event.preventDefault(); openPanel(); });
openPanel();
</script>
</body>
</html>
`;
};

// One file per chat, rewritten whenever its bridge starts a new panel service, since the link changes with it.
export function writePanelCard(stateDir: string, owner: { provider: string; sessionId: string }, url: string, language: 'en' | 'es') {
  const directory = privateSubdirectory(join(stateDir, 'panel-cards'), `${owner.provider}-${owner.sessionId}`);
  const path = join(directory, texts[language].file), temporary = join(directory, `.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeSync(fd, page(language, url)); } finally { closeSync(fd); }
  renameSync(temporary, path);
  return { file: path, link: url, markdown: `**[${texts[language].link}](${url})**` };
}
