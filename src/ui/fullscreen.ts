import { useEffect, useState } from 'react';

/**
 * Fullscreen, for phones above all: it hides the browser's address bar and tabs. Uses the
 * standard API, or Safari's prefixed one on iPad. iPhone Safari has neither (installing the game
 * to the home screen is the way to play full screen there), so the button isn't shown.
 */

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = () => document as FsDocument;

function isFullscreen(): boolean {
  return !!(doc().fullscreenElement ?? doc().webkitFullscreenElement);
}

/** Whether a button can make the page fullscreen: the API is there, and it isn't installed and already opened full screen. */
function available(): boolean {
  const api = !!(doc().fullscreenEnabled || doc().webkitFullscreenEnabled);
  const installed = !isFullscreen() && typeof matchMedia === 'function' && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
  return api && !installed;
}

export function toggleFullscreen(): void {
  const settle = (p: Promise<void> | void) => void Promise.resolve(p).catch(() => undefined);
  if (isFullscreen()) {
    settle(doc().exitFullscreen ? doc().exitFullscreen() : doc().webkitExitFullscreen?.());
    return;
  }
  const el = document.documentElement as FsElement;
  settle(el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
}

/** The fullscreen button's state, following the page in and out of fullscreen; null where there is no button. */
export function useFullscreen(): { on: boolean; toggle(): void } | null {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return available() ? { on, toggle: toggleFullscreen } : null;
}
