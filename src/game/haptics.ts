import type { SfxName } from './world';

/**
 * Vibration on a phone for the moments that matter, felt through the steering thumb: taking a
 * hit, a level-up, an ultimate, the way down, an Archmage falling, and the serpent's own fall.
 * A single number is one buzz in milliseconds; a list alternates buzz and pause.
 */
export const HAPTIC_PATTERNS: Partial<Record<SfxName, number | readonly number[]>> = {
  hurt: 35,
  levelup: [20, 60, 30],
  ultimate: 45,
  descend: [30, 50, 30],
  bossDie: [60, 50, 120],
  death: [120, 60, 220],
};

/** The shortest gap between two single buzzes, so a swarm biting at once is felt as one hit. */
export const HAPTIC_GAP_MS = 150;

/** The device can vibrate at all (Android browsers can; iPhones and desktops can't). */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

let lastBuzz = -Infinity;

/**
 * Buzzes for a sound the game just played, if it has a pattern. A pattern (a list) always plays;
 * a single buzz waits out the gap after the last one.
 */
export function buzzFor(name: SfxName, now: number = performance.now()): boolean {
  const pattern = HAPTIC_PATTERNS[name];
  if (pattern === undefined || !canVibrate()) return false;
  if (typeof pattern === 'number' && now - lastBuzz < HAPTIC_GAP_MS) return false;
  lastBuzz = now;
  try {
    // Refused before the first tap, or when the page is hidden: nothing to do.
    return navigator.vibrate(pattern as number | number[]);
  } catch {
    return false;
  }
}
