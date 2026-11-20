import { useEffect, useState } from 'react';

/**
 * Installing the game to the home screen, where it opens full screen and sideways, and plays
 * offline. Chrome and Edge (Android and desktop) offer it with an event the page can keep and
 * replay from its own button; iOS has no such event, so the button there explains Share > Add to
 * Home Screen instead. Once installed, there's no button.
 *
 * main.tsx imports this first, so the browser's offer is caught even if it comes before the title.
 */

/** Chrome's install offer, kept to be shown from the title's button. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // The title's button offers it, rather than the browser's own bar.
    e.preventDefault();
    offer = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installedNow = true;
    changed();
  });
}

export type InstallOffer = 'prompt' | 'ios' | null;

/** What the title offers: the browser's install dialog, the iOS how-to, or nothing (installed already, or a browser that can't). */
export function installOffer({ installed, canPrompt, ios }: { installed: boolean; canPrompt: boolean; ios: boolean }): InstallOffer {
  if (installed) return null;
  if (canPrompt) return 'prompt';
  return ios ? 'ios' : null;
}

/** An iPhone, iPod or iPad (an iPad's browser says it's a Mac, but has a touch screen). */
export function isIos(userAgent: string, platform: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1);
}

function isInstalled(): boolean {
  if (installedNow) return true;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof matchMedia === 'function' && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
}

/** Shows the browser's install dialog; an offer can be shown once, so the button goes either way. */
async function install(): Promise<void> {
  const e = offer;
  if (!e) return;
  offer = null;
  changed();
  try {
    await e.prompt();
    if ((await e.userChoice).outcome === 'accepted') installedNow = true;
  } catch {
    // The browser wouldn't show it.
  }
  changed();
}

export type Install = { kind: 'prompt'; install(): void } | { kind: 'ios' } | null;

/** The title's Install button: what it does, or null where there's nothing to offer. */
export function useInstall(): Install {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  const kind = installOffer({ installed: isInstalled(), canPrompt: offer !== null, ios: isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) });
  if (kind === 'prompt') return { kind, install: () => void install() };
  return kind === 'ios' ? { kind } : null;
}
