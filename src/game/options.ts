import { copyBindings, DEFAULT_BINDINGS, type KeyBindings } from './keys';

/** How the arena is drawn: the player's comfort and accessibility choices. */
export interface ViewOptions {
  /** Screen-shake strength, 0 (off) to 1 (full). */
  shake: number;
  /** Swaps blinking and strobing effects for steady ones. */
  reduceFlashing: boolean;
  /** Charge warnings drawn as yellow-and-black hazard stripes instead of red. */
  safeWarnings: boolean;
  /** The map overview in the corner. */
  minimap: boolean;
  /** The camera stays centred on the head, with no lookahead or easing. */
  steadyCamera: boolean;
}

export interface GameOptions extends ViewOptions {
  /**
   * Simulation speed, 0.5 to 1. Drawing happens in real time, so a slower game leaves more
   * time to draw. Rewards and records count game time, so they're unaffected.
   */
  gameSpeed: number;
  bindings: KeyBindings;
}

export const GAME_SPEED = { min: 0.5, max: 1, step: 0.1 };

export const DEFAULT_VIEW: ViewOptions = { shake: 1, reduceFlashing: false, safeWarnings: false, minimap: true, steadyCamera: false };

export function defaultOptions(): GameOptions {
  return { ...DEFAULT_VIEW, gameSpeed: 1, bindings: copyBindings(DEFAULT_BINDINGS) };
}

/** Snaps a speed to the slider's steps and range. */
export function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const snapped = Math.round(v / GAME_SPEED.step) * GAME_SPEED.step;
  return Math.min(GAME_SPEED.max, Math.max(GAME_SPEED.min, Math.round(snapped * 100) / 100));
}
