import {useEffect,useRef} from 'react';

// Text the person typed and has not sent. A field counts once a real keystroke changed it and it
// still holds text, so a sent message that cleared its box stops counting. Prefilled values the person
// never touched don't count. Fields inside [data-draft="ignore"], such as search, never count.
type Field = {isConnected: boolean; value: string; closest(selector: string): unknown};
const typed = new Set<Field>();
const notText = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'hidden']);

export function trackDrafts(root: Pick<Document, 'addEventListener' | 'removeEventListener'> = document) {
  const listener = (event: Event) => {
    const field = event.target;
    if (!event.isTrusted || !(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && !notText.has(field.type))) return;
    for (const old of typed) if (!old.isConnected) typed.delete(old);
    typed.add(field);
  };
  root.addEventListener('input', listener, true);
  return () => root.removeEventListener('input', listener, true);
}

// Forms also report changes they keep in state, which outlive a collapsed section or a value set by a button.
const forms = new Set<object>();
export function reportDraft() {
  const form = {};
  forms.add(form);
  return () => {forms.delete(form);};
}
/** Reports a draft while the values differ from the form's first render, or while busy is true. */
export function useDraft(values: unknown, busy = false) {
  const first = useRef(JSON.stringify(values)), dirty = busy || JSON.stringify(values) !== first.current;
  useEffect(() => dirty ? reportDraft() : undefined, [dirty]);
}

export function hasDraft(fields: Iterable<Field> = typed) {
  if (forms.size) return true;
  for (const field of fields) if (field.isConnected && !field.closest('[data-draft="ignore"]') && field.value.trim() !== '') return true;
  return false;
}
