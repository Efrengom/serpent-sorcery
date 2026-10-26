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
  /** On a touch screen, the right thumb steers and the left draws. */
  steerRight: boolean;
  /**
   * Spells aim at the nearest foe in view instead of where the stroke began (Nova and Ward still
   * surround the serpent). On a phone the steering thumb covers its side of the screen, so a stroke
   * can't begin there.
   */
  autoAim: boolean;
}

export const GAME_SPEED = { min: 0.5, max: 1, step: 0.1 };

export const DEFAULT_VIEW: ViewOptions = { shake: 1, reduceFlashing: false, safeWarnings: false, minimap: true, steadyCamera: false };

/** A phone or tablet: its main pointer is a finger. Auto-aim starts on there. */
export function touchFirst(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function defaultOptions(): GameOptions {
  return { ...DEFAULT_VIEW, gameSpeed: 1, bindings: copyBindings(DEFAULT_BINDINGS), steerRight: false, autoAim: touchFirst() };
}

/** Snaps a speed to the slider's steps and range. */
export function clampSpeed(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const snapped = Math.round(v / GAME_SPEED.step) * GAME_SPEED.step;
  return Math.min(GAME_SPEED.max, Math.max(GAME_SPEED.min, Math.round(snapped * 100) / 100));
}
