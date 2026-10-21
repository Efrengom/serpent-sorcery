import { describe, expect, it } from 'vitest';
import { shakeOffset } from '../effects';
import {
  bindingMap,
  bindKey,
  clearKey,
  copyBindings,
  DEFAULT_BINDINGS,
  keyLabel,
  sanitizeBindings,
  unboundMoves,
} from '../keys';
import { clampSpeed, defaultOptions } from '../options';
import { COLORS } from '../palette';
import { defaultSave, optionsOf, parseSave } from '../persistence';
import { PX } from '../pixel/palette';
import type { World } from '../world';

describe('key bindings', () => {
  it('defaults to WASD and the arrows, with Escape pausing', () => {
    const map = bindingMap(DEFAULT_BINDINGS);
    expect(map.get('KeyW')).toBe('up');
    expect(map.get('ArrowLeft')).toBe('left');
    expect(map.get('Escape')).toBe('pause');
    expect(map.get('KeyM')).toBe('mute');
    expect(map.get('KeyP')).toBe('art');
  });

  it('moves a key that was already in use, leaving its old slot empty', () => {
    const out = bindKey(DEFAULT_BINDINGS, 'up', 0, 'KeyD')!;
    expect(out.movedFrom).toBe('right');
    expect(out.bindings.up).toEqual(['KeyD', 'ArrowUp']);
    expect(out.bindings.right).toEqual([null, 'ArrowRight']);
    // The defaults themselves are untouched.
    expect(DEFAULT_BINDINGS.right).toEqual(['KeyD', 'ArrowRight']);
    // Swapping slots within one action isn't reported as taking it from another action.
    const within = bindKey(DEFAULT_BINDINGS, 'up', 1, 'KeyW')!;
    expect(within.movedFrom).toBeNull();
    expect(within.bindings.up).toEqual([null, 'KeyW']);
  });

  it('keeps Escape for pausing', () => {
    expect(bindKey(DEFAULT_BINDINGS, 'up', 0, 'Escape')).toBeNull();
    expect(bindKey(DEFAULT_BINDINGS, 'pause', 0, 'KeyQ')).toBeNull();
    expect(clearKey(DEFAULT_BINDINGS, 'pause', 0).pause[0]).toBe('Escape');
    const extra = bindKey(DEFAULT_BINDINGS, 'pause', 1, 'Space')!;
    expect(bindingMap(extra.bindings).get('Space')).toBe('pause');
  });

  it('notices a steering direction with no key', () => {
    let b = clearKey(DEFAULT_BINDINGS, 'left', 0);
    expect(unboundMoves(b)).toEqual([]);
    b = clearKey(b, 'left', 1);
    expect(unboundMoves(b)).toEqual(['left']);
  });

  it('cleans saved bindings: junk, duplicates, a stray Escape and missing actions', () => {
    expect(sanitizeBindings('nope')).toEqual(DEFAULT_BINDINGS);
    const b = sanitizeBindings({
      up: ['KeyI', 'KeyI'],
      down: ['KeyK', 42],
      left: ['Escape', 'KeyJ'],
      right: ['KeyL', '<script>'],
      pause: ['KeyQ', 'Space'],
      mute: ['KeyI', null],
    });
    expect(b.up).toEqual(['KeyI', null]);
    expect(b.down).toEqual(['KeyK', null]);
    expect(b.left).toEqual([null, 'KeyJ']);
    expect(b.right).toEqual(['KeyL', null]);
    expect(b.pause).toEqual(['Escape', 'Space']);
    // KeyI was already taken, so mute ends up with nothing; art was missing and gets P back.
    expect(b.mute).toEqual([null, null]);
    expect(b.art).toEqual(['KeyP', null]);
    // A missing action doesn't get a default key that something else already uses.
    const taken = sanitizeBindings({ ...copyBindings(DEFAULT_BINDINGS), up: ['KeyP', null], art: undefined });
    expect(taken.art).toEqual([null, null]);
  });

  it('labels keys the way a keyboard does', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Numpad8')).toBe('Num 8');
    expect(keyLabel('ShiftLeft')).toBe('L Shift');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel(null)).toBe('—');
  });
});

describe('comfort options', () => {
  it('start at full shake, normal flashing and warnings, full speed', () => {
    expect(optionsOf(defaultSave().settings)).toEqual(defaultOptions());
    expect(defaultOptions()).toMatchObject({ shake: 1, reduceFlashing: false, safeWarnings: false, gameSpeed: 1 });
  });

  it('are saved and validated', () => {
    const save = parseSave(
      JSON.stringify({
        settings: { shake: 0.3, reduceFlashing: true, safeWarnings: true, gameSpeed: 0.74, bindings: { up: ['KeyI', null] } },
      }),
    );
    expect(save.settings.shake).toBe(0.3);
    expect(save.settings.reduceFlashing).toBe(true);
    expect(save.settings.safeWarnings).toBe(true);
    expect(save.settings.gameSpeed).toBe(0.7);
    expect(save.settings.bindings.up).toEqual(['KeyI', null]);
    expect(save.settings.bindings.down).toEqual(['KeyS', 'ArrowDown']);
    const junk = parseSave(JSON.stringify({ settings: { shake: 9, reduceFlashing: 'yes', gameSpeed: 0.1 } }));
    expect(junk.settings.shake).toBe(1);
    expect(junk.settings.reduceFlashing).toBe(false);
    expect(junk.settings.gameSpeed).toBe(0.5);
  });

  it('snaps game speed to 10% steps between 50% and 100%', () => {
    expect(clampSpeed(0.84)).toBe(0.8);
    expect(clampSpeed(0.2)).toBe(0.5);
    expect(clampSpeed(3)).toBe(1);
    expect(clampSpeed(NaN)).toBe(1);
  });

  it('scale screen shake, down to none', () => {
    const world = { shake: 1 } as World;
    const full = shakeOffset(world, 0.37);
    const half = shakeOffset(world, 0.37, 0.5);
    expect(Math.hypot(full.x, full.y)).toBeGreaterThan(1);
    expect(half.x).toBeCloseTo(full.x / 2);
    expect(half.y).toBeCloseTo(full.y / 2);
    expect(shakeOffset(world, 0.37, 0)).toEqual({ x: 0, y: 0 });
  });
});

/**
 * Colour-vision simulation (Machado, Oliveira & Fernandes 2009, full severity, applied in linear
 * RGB) and WCAG contrast. The safe warnings are meant to be told apart by brightness, which every
 * kind of colour vision keeps.
 */
const VISION = {
  typical: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(c: number[], m: number[]): number {
  const l = c.map(linear);
  const s = [0, 1, 2].map((r) => Math.min(1, Math.max(0, m[r * 3] * l[0] + m[r * 3 + 1] * l[1] + m[r * 3 + 2] * l[2])));
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}
function contrast(a: number[], b: number[], m: number[]): number {
  const [hi, lo] = [luminance(a, m), luminance(b, m)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg: number[], alpha: number, bg: number[]) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
/** Floor tones: the classic arena's mid gradient per area, and the pixel floors' main stone. */
const FLOORS = ['#24153d', '#2b130e', PX.stone1, '#3a1610'];

describe('colorblind-safe warnings', () => {
  it('stand out from every floor by at least 7:1 under every kind of colour vision', () => {
    for (const m of Object.values(VISION)) {
      for (const floor of FLOORS) {
        expect(contrast(rgb(COLORS.warn), rgb(floor), m)).toBeGreaterThan(7);
        expect(contrast(rgb(PX.warn2), rgb(floor), m)).toBeGreaterThan(7);
      }
      // The stripes themselves: yellow against near-black.
      expect(contrast(rgb(COLORS.warn), rgb(COLORS.warnDark), m)).toBeGreaterThan(7);
    }
  });

  it('fix a real gap: the standard red lane edge falls below 3:1 for protanopia', () => {
    const red = rgb(PX.tele);
    const worst = Math.min(...FLOORS.map((f) => contrast(over(red, 0.7, rgb(f)), rgb(f), VISION.protanopia)));
    expect(worst).toBeLessThan(3);
  });
});
