// The panel's own app window always opens in the top-right corner, under half the screen's width and about
// three fifths of its height, so the Claude or Codex chat stays in view; a window the person enlarged or moved is not
// remembered. That corner is kept in a cookie (unlike storage, cookies are shared by every port on 127.0.0.1) so the
// bridge opens the next window right there, with nothing left to move. A normal browser tab is never moved.
export type Rect = {x: number; y: number; w: number; h: number};
// availLeft and availTop are Chromium extensions that place the screen among several; one screen starts at 0.
type Area = {availLeft?: number; availTop?: number; availWidth: number; availHeight: number};
type PanelWindow = Pick<Window, 'resizeTo' | 'moveTo' | 'matchMedia' | 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'> & {screen: Area; document: {cookie: string}};
const cookie = 'agents_bridge_panel_window', gap = 12;

// The smallest window that still shows the tabs and a page's main action without much scrolling.
const minimum = {w: 520, h: 600};

export function topRight(area: Area): Rect {
  const w = Math.min(area.availWidth, Math.max(minimum.w, Math.round(area.availWidth * 0.44)));
  const h = Math.min(area.availHeight, Math.max(minimum.h, Math.round(area.availHeight * 0.62)));
  const left = area.availLeft ?? 0, top = area.availTop ?? 0;
  return {x: left + Math.max(0, area.availWidth - w - gap), y: top + Math.max(0, Math.min(gap, area.availHeight - h)), w, h};
}

export function placePanelWindow(win: PanelWindow = window) {
  if (!win.matchMedia('(display-mode: standalone)').matches) return;
  const place = topRight(win.screen);
  if (win.screenX !== place.x || win.screenY !== place.y || win.outerWidth !== place.w || win.outerHeight !== place.h) {
    win.resizeTo(place.w, place.h); win.moveTo(place.x, place.y);
  }
  win.document.cookie = `${cookie}=${[place.x, place.y, place.w, place.h].join('_')}; Path=/; Max-Age=31536000; SameSite=Strict`;
}
