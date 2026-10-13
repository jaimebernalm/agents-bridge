// Coalesce timers/SSE/focus into one refresh plus at most one trailing refresh.
// Serializing prevents old HTTP snapshots from overwriting a newer selection.
export function serializedRefresh(refresh: () => Promise<void>) {
  let current: Promise<void> | null = null, again = false, stopped = false;
  return {
    request(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (current) { again = true; return current; }
      current = (async () => {
        do { again = false; await refresh(); } while (again && !stopped);
      })().finally(() => { current = null; });
      return current;
    },
    stop() { stopped = true; again = false; },
  };
}

export function independentRefresh(sections: (() => Promise<void>)[]) {
  const workers = sections.map(serializedRefresh);
  return {
    async request() { await Promise.allSettled(workers.map(worker => worker.request())); },
    stop() { workers.forEach(worker => worker.stop()); },
  };
}

export function panelNavigation(hash: string, savedRun = '') {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const requested = params.get('run') ?? '';
  const selected = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requested) ? requested : savedRun;
  const view = params.get('view') === 'authorization' ? 'authorization' : selected ? 'detail' : 'home';
  return {selected, view: view as 'authorization' | 'detail' | 'home'};
}

// The panel lost its local service: the chat that opened it closed or reloaded. The header and one
// notice already say so, so background refreshes report it there instead of repeating it.
export class PanelOffline extends Error {}
export const offlineNotice = 'El chat que abrió este panel se cerró o se recargó. Para seguir, pide en tu chat «abre el panel del puente».';
