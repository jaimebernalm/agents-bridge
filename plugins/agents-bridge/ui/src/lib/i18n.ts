import {useSyncExternalStore} from 'react';
import {english} from './messages';
import {pagePreferences,remember,type Language} from './preferences';

export type {Language};
let language: Language = pagePreferences(typeof document === 'undefined' ? undefined : document.documentElement).language;
const spanish = Object.fromEntries(Object.entries(english).map(([es, en]) => [en, es]));
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  language = next;
  remember({language: next});
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
