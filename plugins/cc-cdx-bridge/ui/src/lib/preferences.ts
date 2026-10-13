export type Language = 'en' | 'es';
export type Preferences = { language: Language; theme: 'light' | 'dark' };
type Page = { lang: string; classList: { contains(name: string): boolean } };

// The panel service writes the choice saved on this computer into the page it serves,
// so every panel, in either app, opens with it. English and light until the person picks.
export function pagePreferences(page?: Page): Preferences {
  return { language: page?.lang === 'es' ? 'es' : 'en', theme: page?.classList.contains('dark') ? 'dark' : 'light' };
}
let save: (change: Partial<Preferences>) => Promise<unknown> = async () => {};
export function saveWith(next: typeof save) { save = next; }
// A choice that cannot be saved still applies to this window.
export function remember(change: Partial<Preferences>) { save(change).catch(() => {}); }
