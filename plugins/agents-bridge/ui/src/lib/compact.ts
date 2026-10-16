import {useSyncExternalStore} from 'react';

// The panel's own window opens small in a corner of the screen (see window-place). There the panel
// drops its top bar and folds each form into rows that fit without scrolling. It matches the
// compact: variant in index.css, so markup and styles switch together; a larger window gets the full layout.
export const compactQuery = '(max-width:899px),(max-height:639px)';

export function useCompact() {
  return useSyncExternalStore(listener => {
    const media = matchMedia(compactQuery);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, () => matchMedia(compactQuery).matches, () => false);
}
