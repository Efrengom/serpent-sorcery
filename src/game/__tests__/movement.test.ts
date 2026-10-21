import { describe, expect, it } from 'vitest';
import { ARENA, SNAKE } from '../config';
import { PLAY_AREA, Snake } from '../snake';
import { aimAngle } from '../spells';

function run(snake: Snake, seconds: number, dir: { x: number; y: number }, dt = 1 / 120): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) snake.update(dt, dir.x, dir.y);
}

describe('snake movement', () => {
  it('keeps moving and keeps its heading when no keys are held', () => {
    const s = new Snake();
    s.heading = 0.3;
    const x0 = s.x;
    run(s, 0.5, { x: 0, y: 0 });
    expect(s.heading).toBeCloseTo(0.3, 6);
    expect(s.x - x0).toBeCloseTo(Math.cos(0.3) * SNAKE.speed * 0.5, 0);
  });

  it('turns toward held directions at a limited rate, including diagonals', () => {
    const s = new Snake();
    s.heading = 0;
    s.update(1 / 120, 0, 1);
    expect(s.heading).toBeCloseTo(SNAKE.turnRate / 120, 6);
    run(s, 1, { x: 1, y: 1 });
    expect(s.heading).toBeCloseTo(Math.PI / 4, 3);
  });

  it('reverses with a curved U-turn rather than flipping in place', () => {
    const s = new Snake();
    s.x = ARENA.width / 2;
    s.y = ARENA.height / 2;
    s.heading = 0;
    const y0 = s.y;
    run(s, Math.PI / SNAKE.turnRate + 0.1, { x: -1, y: 0 });
    expect(Math.abs(Math.cos(s.heading) + 1)).toBeLessThan(0.01);
    // The turn swept sideways by roughly the turning diameter.
    expect(Math.abs(s.y - y0)).toBeGreaterThan(40);
  });

  it('bounces off walls back into the arena and briefly locks steering', () => {
    const s = new Snake();
    s.x = PLAY_AREA.minX + SNAKE.headRadius + 1;
    s.y = ARENA.height / 2;
    s.heading = Math.PI - 0.2; // heading into the left wall at a shallow angle
    const hit = s.update(1 / 60, -1, 0);
    expect(hit).toBe('wall');
    expect(s.x).toBeGreaterThanOrEqual(PLAY_AREA.minX + SNAKE.headRadius);
    expect(Math.cos(s.heading)).toBeGreaterThanOrEqual(ARENA.wallMinInward - 1e-9);
    expect(s.steerLock).toBeGreaterThan(0);
  });

  it('places body segments along the travelled path at fixed spacing', () => {
    const s = new Snake();
    s.segmentTarget = 20;
    run(s, 3, { x: 1, y: 0 });
    expect(s.segments.length).toBe(20);
    for (let i = 1; i < s.segments.length; i++) {
      const a = s.segments[i - 1];
      const b = s.segments[i];
      // Chord distance can only be shorter than arc spacing on curves.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(SNAKE.segmentSpacing + 0.01);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(SNAKE.segmentSpacing * 0.8);
    }
  });

  it('is frame-rate independent', () => {
    const a = new Snake();
    const b = new Snake();
    run(a, 1, { x: 1, y: 0 }, 1 / 120);
    run(b, 1, { x: 1, y: 0 }, 1 / 30);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(4);
  });
});

describe('aiming', () => {
  it('aims from the head toward the recorded target', () => {
    const head = { x: 100, y: 100, heading: 0 };
    expect(aimAngle(head, { x: 100, y: 300 })).toBeCloseTo(Math.PI / 2, 6);
  });

  it('falls back to the heading when the target is missing or too close', () => {
    const head = { x: 100, y: 100, heading: 1.2 };
    expect(aimAngle(head, null)).toBe(1.2);
    expect(aimAngle(head, { x: 110, y: 105 })).toBe(1.2);
  });
});
