/**
 * The window as it was left: fullscreen or not, and the windowed size and position. It's kept in
 * `window.json` in the program's data folder, outside the saves, because it belongs to this
 * computer: Steam Cloud doesn't carry it to a Steam Deck.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  fullscreen: boolean;
  /** The windowed size and position, once the window has been windowed. */
  bounds: Bounds | null;
  maximized: boolean;
}

const FILE = 'window.json';

/** A first launch: fullscreen, as a PC game is expected to open. */
export function defaultWindowState(): WindowState {
  return { fullscreen: true, bounds: null, maximized: false };
}

function readBounds(b: unknown): Bounds | null {
  if (!b || typeof b !== 'object') return null;
  const { x, y, width, height } = b as Record<string, unknown>;
  const ok = [x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!ok || (width as number) < 200 || (height as number) < 150) return null;
  return { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number) };
}

export function readWindowState(userData: string): WindowState {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(userData, FILE), 'utf8')) as Record<string, unknown>;
    return { fullscreen: o.fullscreen !== false, bounds: readBounds(o.bounds), maximized: o.maximized === true };
  } catch {
    return defaultWindowState();
  }
}

export function writeWindowState(userData: string, state: WindowState): void {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, FILE), JSON.stringify(state));
  } catch {
    // The window opens as it would the first time.
  }
}
