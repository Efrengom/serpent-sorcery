/**
 * The desktop program (desktop/, Electron, for Steam) puts one small object on the page,
 * `window.serpentDesktop`, from its preload script. On the web there is none. Everything the game
 * does differently on the desktop asks `desktop()` first, so the web build behaves as it always has.
 */

export interface DesktopBridge {
  /**
   * The save, kept in a file (which Steam Cloud can sync) rather than in the browser's storage.
   * `setItem` throws when the last write didn't reach the file, so `writeSave` reports it.
   */
  store: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
  /** The window's fullscreen, which F11 and Alt+Enter also toggle. */
  fullscreen: {
    get(): boolean;
    set(on: boolean): void;
    /** Calls back whenever the window goes in or out of fullscreen; returns the unsubscribe. */
    onChange(f: (on: boolean) => void): () => void;
  };
  steam: {
    /** Unlocks these achievements on Steam (the ones already unlocked are skipped). */
    unlock(ids: readonly string[]): void;
    /** Whether Steam Cloud is on for this account and game, as Steam said at launch. */
    cloud: boolean;
  };
  /** Closes the program. */
  quit(): void;
}

/** The desktop program's bridge, or null on the web. */
export function desktop(): DesktopBridge | null {
  try {
    return (globalThis as { serpentDesktop?: DesktopBridge }).serpentDesktop ?? null;
  } catch {
    return null;
  }
}
