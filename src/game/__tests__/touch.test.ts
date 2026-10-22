import { describe, expect, it } from 'vitest';
import { TOUCH } from '../config';
import type { Pt } from '../gesture';
import { InputManager, type InputCallbacks } from '../input';

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
    onToggleArt() {},
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
