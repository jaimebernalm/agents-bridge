import {createContext, useContext, type ReactNode} from 'react';

// In the small window with a single page there is no top bar, so the page puts the language and theme buttons in its
// own first row (beside Dismiss, New or the collaboration's state). Elsewhere the bar holds them and this stays empty.
export const InlineToggles = createContext<ReactNode>(null);
export const useInlineToggles = () => useContext(InlineToggles);
