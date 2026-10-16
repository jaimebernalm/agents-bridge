// The panel as a page the person can open in a browser: opening it, or its button, opens the panel window, while the panel
// itself, and everything the person can do there, stays in that window. The chat shows `markdown` instead of this file:
// Claude shows a file as a still page whose link goes through the default browser, which then comes over other windows.
import { randomUUID } from 'node:crypto';
import { closeSync, constants, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { privateSubdirectory } from './claude-sidecar';
import { displayName } from './names';

export const panelTexts = {
  en: { file: 'Bridge panel.html', title: 'Bridge panel', ask: 'Open the panel in its own window to watch this collaboration, pause it or export it.',
    opening: 'Opening the panel in its own window…', opened: 'The panel opens in its own window. You can close this page.', button: 'Open the panel', stale: 'This chat’s bridge is no longer running, so the panel cannot open from here. Ask in your chat to open the bridge panel.',
    link: 'Open the bridge panel', blurb: 'Watch this collaboration in its own window, and pause or export it from there.' },
  es: { file: 'Panel del bridge.html', title: 'Panel del bridge', ask: 'Abre el panel en su propia ventana para ver esta colaboración, pausarla o exportarla.',
    opening: 'Abriendo el panel en su propia ventana…', opened: 'El panel se abre en su propia ventana. Puedes cerrar esta página.', button: 'Abrir el panel', stale: 'El bridge de este chat ya no está abierto, así que el panel no se puede abrir desde aquí. Pide en tu chat que abra el panel del bridge.',
    link: 'Abrir el panel del bridge', blurb: 'Míralo en su propia ventana, y desde ahí pausa o exporta la colaboración.' },
};

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const page = (language: 'en' | 'es', url: string) => {
  const t = panelTexts[language];
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(t.title)}</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--text:#1f1e1c;--muted:#6b6862;--line:#e3e0da;--accent:#c96442;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#1c1b19;--card:#262522;--text:#f1efe9;--muted:#a8a49c;--line:#3a3834;--accent:#d97757;--accent-text:#1c1b19}}
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
  const path = join(directory, panelTexts[language].file), temporary = join(directory, `.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeSync(fd, page(language, url)); } finally { closeSync(fd); }
  renameSync(temporary, path);
  // What the chat shows. A link in the chat opens in the app's own side browser, never in the default browser, so pressing
  // it brings no other window forward. Claude gets a quoted block with a heading-sized link, so it reads as the thing to
  // press; Codex already adds a preview card of its own under any link, so a plain link keeps it from showing twice.
  const t = panelTexts[language];
  const markdown = owner.provider === 'codex' ? `**[${t.link}](${url})**` : `> ### ▶️ [${t.link}](${url})\n> ${t.blurb}`;
  return { file: path, link: url, markdown };
}
