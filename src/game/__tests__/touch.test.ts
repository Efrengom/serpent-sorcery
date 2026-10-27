import { afterEach, describe, expect, it, vi } from 'vitest';
import { BREAKABLES, SNAKE, TOUCH } from '../config';
import { spawnEnemy } from '../enemies';
import type { Pt } from '../gesture';
import { InputManager, type InputCallbacks } from '../input';
import { defaultOptions } from '../options';
import { defaultSave, optionsOf, parseSave } from '../persistence';
import { emptyMetaLevels } from '../progression';
import { autoAimPoint, autoAimTarget, castSpell, updateBolts } from '../spells';
import { createWorld } from '../world';

/** An input manager on a 1000×600 canvas with no DOM: handlers are called directly. */
function setup() {
  const canvas = {
    clientWidth: 1000,
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
  const log = { starts: [] as Pt[], ends: [] as Pt[][], cancels: 0 };
  const cb: InputCallbacks = {
    onPause() {},
    onUltimate() {},
    onToggleMute() {},
    onGestureStart: (p) => {
      log.starts.push(p);
      return true;
    },
    onGestureEnd: (pts) => log.ends.push(pts),
    onGestureCancel: () => log.cancels++,
    onFocusLost() {},
    onResize() {},
    onUserGesture() {},
  };
  const input = new InputManager(canvas, cb);
  const handlers = input as unknown as Record<'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onKeyDown', (e: object) => void>;
  const ev = (id: number, x: number, y: number, pointerType = 'touch') => ({
    pointerId: id,
    pointerType,
    clientX: x,
    clientY: y,
    button: 0,
    preventDefault() {},
    getCoalescedEvents: () => [],
  });
  const touch = {
    down: (id: number, x: number, y: number, type?: string) => handlers.onPointerDown(ev(id, x, y, type)),
    move: (id: number, x: number, y: number, type?: string) => handlers.onPointerMove(ev(id, x, y, type)),
    up: (id: number, x: number, y: number, type?: string) => handlers.onPointerUp(ev(id, x, y, type)),
    cancel: (id: number) => handlers.onPointerCancel(ev(id, 0, 0)),
  };
  return { input, touch, log, handlers };
}

describe('touch controls', () => {
  it('steer with a stick wherever a thumb lands on the steering side, in any direction', () => {
    const { input, touch, log } = setup();
    touch.down(1, 100, 300);
    expect(input.touchView.stick).toMatchObject({ ox: 100, oy: 300 });
    expect(log.starts).toHaveLength(0);
    // Inside the dead zone it keeps heading.
    touch.move(1, 100 + TOUCH.deadzone - 2, 300);
    expect(input.direction()).toEqual({ x: 0, y: 0 });
    touch.move(1, 140, 340);
    const d = input.direction();
    expect(d.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(d.y).toBeCloseTo(Math.SQRT1_2, 6);
    // Lifting the thumb keeps the heading (no input), like letting go of the keys.
    touch.up(1, 140, 340);
    expect(input.touchView.stick).toBeNull();
    expect(input.direction()).toEqual({ x: 0, y: 0 });
  });

  it('pull the base along on a long drag, so turning back is immediate', () => {
    const { input, touch } = setup();
    touch.down(1, 100, 300);
    touch.move(1, 300, 300);
    expect(input.touchView.stick!.ox).toBeCloseTo(300 - TOUCH.radius, 6);
    touch.move(1, 300 - TOUCH.radius - 20, 300);
    expect(input.direction()).toEqual({ x: -1, y: 0 });
  });

  it('draw with another finger on the other side while steering, and a third finger leaves the sigil alone', () => {
    const { input, touch, log } = setup();
    touch.down(1, 100, 300);
    touch.move(1, 160, 300);
    touch.down(2, 700, 200);
    expect(log.starts).toEqual([{ x: 700, y: 200 }]);
    touch.move(2, 760, 260);
    touch.down(3, 800, 400);
    expect(log.cancels).toBe(0);
    touch.move(2, 820, 200);
    touch.up(2, 830, 190);
    expect(log.ends).toHaveLength(1);
    expect(log.ends[0].length).toBeGreaterThanOrEqual(3);
    // Steering went on throughout.
    expect(input.direction()).toEqual({ x: 1, y: 0 });
  });

  it('let the right thumb steer instead, and leave the mouse and keys alone', () => {
    const { input, touch, log, handlers } = setup();
    input.setSteerSide('right');
    touch.down(1, 900, 300);
    expect(input.touchView).toMatchObject({ side: 'right', seen: true });
    expect(input.touchView.stick).not.toBeNull();
    touch.down(2, 100, 300);
    expect(log.starts).toEqual([{ x: 100, y: 300 }]);
    touch.up(2, 100, 300);
    // A mouse press on the steering side draws: zones are for touch only.
    touch.down(5, 950, 300, 'mouse');
    expect(log.starts).toHaveLength(2);
    touch.up(5, 950, 300, 'mouse');
    // Keys win over the stick while held.
    touch.move(1, 960, 300);
    handlers.onKeyDown({ code: 'KeyW', repeat: false, target: null, preventDefault() {} });
    expect(input.direction()).toEqual({ x: 0, y: -1 });
  });

  it('drop the stick when the phase changes (clearAll) or the touch is cancelled', () => {
    const { input, touch } = setup();
    touch.down(1, 100, 300);
    touch.move(1, 160, 300);
    input.clearAll();
    expect(input.touchView.stick).toBeNull();
    touch.down(2, 100, 300);
    touch.cancel(2);
    expect(input.touchView.stick).toBeNull();
  });
});

describe('auto-aim', () => {
  afterEach(() => vi.unstubAllGlobals());
  const pointer = (coarse: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }));

  it('starts on for a phone or tablet and off for a mouse, and a choice is kept', () => {
    pointer(true);
    expect(defaultOptions().autoAim).toBe(true);
    // A save from before the option takes the device's default; a saved choice stays.
    expect(optionsOf(parseSave(JSON.stringify({ settings: {} })).settings).autoAim).toBe(true);
    expect(optionsOf(parseSave(JSON.stringify({ settings: { autoAim: false } })).settings).autoAim).toBe(false);
    pointer(false);
    expect(defaultOptions().autoAim).toBe(false);
    expect(optionsOf(defaultSave().settings).autoAim).toBe(false);
    expect(optionsOf(parseSave(JSON.stringify({ settings: { autoAim: 'yes' } })).settings).autoAim).toBe(false);
  });

  /** A world with the serpent at the start heading right, and no foes yet. */
  function arena() {
    const w = createWorld(emptyMetaLevels(), () => undefined, 5);
    w.enemies.length = 0;
    w.breakables.length = 0;
    w.snake.reset(w.map.start.x, w.map.start.y, 0);
    w.camera.x = w.snake.x;
    w.camera.y = w.snake.y;
    return w;
  }

  it('picks the nearest foe in view that a bolt can reach, passing over what can’t be hit', () => {
    const w = arena();
    const { x, y } = w.snake;
    expect(autoAimTarget(w)).toBeNull();
    const far = spawnEnemy(w, 'chaser', x - 300, y);
    const near = spawnEnemy(w, 'chaser', x + 200, y);
    expect(autoAimTarget(w)).toBe(near);
    // Behind stone (no line for a bolt), the nearer one gives way to one in the open.
    near.nav.sight = false;
    expect(autoAimTarget(w)).toBe(far);
    far.nav.sight = false;
    expect(autoAimTarget(w)).toBe(near);
    near.nav.sight = far.nav.sight = true;
    // Underground, dead, or out of view: passed over.
    near.hidden = true;
    expect(autoAimTarget(w)).toBe(far);
    far.dead = true;
    expect(autoAimTarget(w)).toBeNull();
    spawnEnemy(w, 'chaser', x + 5000, y);
    expect(autoAimTarget(w)).toBeNull();
  });

  it('aims a bolt behind the serpent, and carries a foe at the head out to a direction', () => {
    const w = arena();
    const { x, y } = w.snake;
    spawnEnemy(w, 'brute', x - 250, y);
    // Heading right, the foe is behind: the bolt flies left at it.
    castSpell(w, 'bolt', autoAimPoint(w));
    expect(w.bolts.length).toBeGreaterThan(0);
    expect(w.bolts.every((b) => b.vx < 0 && Math.abs(b.vy) < Math.abs(b.vx) * 0.3)).toBe(true);
    // Right against the head, the point goes out along the line to the foe, past the heading fallback.
    w.enemies.length = 0;
    spawnEnemy(w, 'chaser', x, y + 20);
    const p = autoAimPoint(w)!;
    expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThan(SNAKE.aimMinDistance);
    expect(Math.abs(p.x - x)).toBeLessThan(1e-6);
    expect(p.y).toBeGreaterThan(y);
  });

  it('sends Bolt and Frost Field at breakables as well as foes, and Lightning only at foes', () => {
    const w = arena();
    const { x, y } = w.snake;
    const foe = spawnEnemy(w, 'chaser', x + 300, y);
    const hp = BREAKABLES.large.hp;
    const reliquary = { id: 999, slot: -1, size: 'large' as const, look: 'reliquary' as const, x: x - 160, y, r: BREAKABLES.large.radius, hp, maxHp: hp, flash: 0, lastNovaId: -1, variant: 0 };
    w.breakables.push(reliquary);
    // Nearer than the foe, so the spells that break things go for it; Lightning can't, so it takes the foe.
    expect(autoAimTarget(w, 'bolt')).toBe(reliquary);
    expect(autoAimTarget(w, 'frost')).toBe(reliquary);
    expect(autoAimTarget(w, null)).toBe(reliquary);
    expect(autoAimTarget(w, 'lightning')).toBe(foe);
    // A bolt sent there, behind the serpent, cracks it.
    castSpell(w, 'bolt', autoAimPoint(w, autoAimTarget(w, 'bolt')));
    for (let i = 0; i < 30; i++) updateBolts(w, 1 / 60);
    expect(reliquary.hp).toBeLessThan(hp);
  });
});
