// The panel's own app window opens in the top-right corner, under half the screen's width and about
// three fifths of its height, so the Claude or Codex chat stays in view. Each chat's panel gets a new port and Chrome keeps
// no placement for it, so the panel remembers where the person left it in a cookie: unlike storage,
// cookies are shared by every port on 127.0.0.1. A normal browser tab is never moved.
export type Rect = {x: number; y: number; w: number; h: number};
// availLeft and availTop are Chromium extensions that place the screen among several; one screen starts at 0.
type Area = {availLeft?: number; availTop?: number; availWidth: number; availHeight: number};
type PanelWindow = Pick<Window, 'resizeTo' | 'moveTo' | 'matchMedia' | 'addEventListener' | 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'> & {screen: Area; document: {cookie: string}};
const cookie = 'agents_bridge_panel_window', gap = 12;

// The smallest window that still shows the tabs and a page's main action without much scrolling.
const minimum = {w: 520, h: 600};

export function topRight(area: Area): Rect {
  const w = Math.min(area.availWidth, Math.max(minimum.w, Math.round(area.availWidth * 0.44)));
  const h = Math.min(area.availHeight, Math.max(minimum.h, Math.round(area.availHeight * 0.62)));
  const left = area.availLeft ?? 0, top = area.availTop ?? 0;
  return {x: left + Math.max(0, area.availWidth - w - gap), y: top + Math.max(0, Math.min(gap, area.availHeight - h)), w, h};
}

export function savedPlace(cookies: string): Rect | undefined {
  const value = cookies.split(';').map(s => s.trim()).find(s => s.startsWith(cookie + '='))?.slice(cookie.length + 1);
  const [x, y, w, h] = (value ?? '').split('_').map(Number);
  return [x, y, w, h].every(Number.isInteger) ? {x: x!, y: y!, w: w!, h: h!} : undefined;
}

// A placement from another screen layout, or one smaller than the minimum (as earlier versions saved
// their smaller default), gives way to the default corner.
const fits = (r: Rect, {availLeft: left = 0, availTop: top = 0, availWidth, availHeight}: Area) =>
  r.w >= Math.min(minimum.w, availWidth) && r.h >= Math.min(minimum.h, availHeight) && r.x >= left && r.y >= top && r.x + r.w <= left + availWidth && r.y + r.h <= top + availHeight;

export function placePanelWindow(win: PanelWindow = window) {
  if (!win.matchMedia('(display-mode: standalone)').matches) return;
  const saved = savedPlace(win.document.cookie), place = saved && fits(saved, win.screen) ? saved : topRight(win.screen);
  win.resizeTo(place.w, place.h); win.moveTo(place.x, place.y);
  // Moving a window fires no event, so the placement is kept when the person leaves the window or closes it.
  // Not on resize: that event can arrive before our own move lands and would keep a half-placed window.
  const keep = () => {win.document.cookie = `${cookie}=${[win.screenX, win.screenY, win.outerWidth, win.outerHeight].join('_')}; Path=/; Max-Age=31536000; SameSite=Strict`;};
  for (const event of ['blur', 'pagehide']) win.addEventListener(event, keep);
}
