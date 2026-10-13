import {useSyncExternalStore} from 'react';
import {english} from './messages';

export type Language = 'en' | 'es';
const preference = 'cc-cdx-language';
// English unless the person chose another language in the panel.
export function readLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try { const stored = storage?.getItem(preference); if (stored === 'es' || stored === 'en') return stored; }
  catch { /* Use the default. */ }
  return 'en';
}
function initialLanguage(): Language {
  return readLanguage(typeof window === 'undefined' ? undefined : window.localStorage);
}
let language: Language = initialLanguage();
const spanish = Object.fromEntries(Object.entries(english).map(([es, en]) => [en, es]));
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  try { localStorage.setItem(preference, next); } catch { /* Still usable without browser storage. */ }
  listeners.forEach(listener => listener());
}
export function useLanguage() {
  return [useSyncExternalStore(listener => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, getLanguage, () => 'en' as Language), setLanguage] as const;
}
export function translate(message: string, locale: Language, values: Record<string, string | number> = {}): string {
  const known = Object.hasOwn(english, message) || Object.hasOwn(spanish, message);
  // Server errors may chain several known sentences; translate each one.
  if (!known && /\.\s/.test(message)) return message.split(/(?<=\.)\s+/).map(part => translate(part, locale, values)).join(' ');
  const key = Object.hasOwn(english, message) ? message : Object.hasOwn(spanish, message) ? spanish[message] : message;
  const text = locale === 'en' && Object.hasOwn(english, key) ? english[key] : key;
  return text.replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
export const t = (message: string, values?: Record<string, string | number>) => translate(message, language, values);
