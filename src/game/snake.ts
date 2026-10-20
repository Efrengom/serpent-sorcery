import { ARENA, SNAKE } from './config';
import { angleDiff, clamp, type Vec } from './math';

/**
 * Records the path a head actually travelled so body segments can follow it exactly
 * at fixed arc-length spacing. Shared by the player and by rival/boss snakes.
 */
export class PathTrail {
  private xs: number[] = [];
  private ys: number[] = [];

  constructor(private readonly minStep = 2) {}

  /** Lays a straight trail behind (x, y) so a new snake starts fully stretched out. */
  reset(x: number, y: number, heading: number, length: number): void {
    this.xs = [];
    this.ys = [];
    const steps = Math.ceil(length / this.minStep);
    for (let i = steps; i >= 1; i--) {
      this.xs.push(x - Math.cos(heading) * i * this.minStep);
      this.ys.push(y - Math.sin(heading) * i * this.minStep);
    }
    this.xs.push(x);
    this.ys.push(y);
  }

  record(x: number, y: number): void {
    const n = this.xs.length;
    if (n === 0) {
      this.xs.push(x);
      this.ys.push(y);
      return;
    }
    const dx = x - this.xs[n - 1];
    const dy = y - this.ys[n - 1];
    if (dx * dx + dy * dy >= this.minStep * this.minStep) {
      this.xs.push(x);
      this.ys.push(y);
    }
  }

  /** Writes `count` points spaced `spacing` apart along the path behind (hx, hy). */
  sample(hx: number, hy: number, count: number, spacing: number, out: Vec[]): void {
    out.length = 0;
    let cx = hx;
    let cy = hy;
    let remaining = spacing;
    for (let i = this.xs.length - 1; i >= 0 && out.length < count; i--) {
      const px = this.xs[i];
      const py = this.ys[i];
      let seg = Math.hypot(px - cx, py - cy);
      while (seg >= remaining && out.length < count) {
        const t = remaining / seg;
        cx += (px - cx) * t;
        cy += (py - cy) * t;
        out.push({ x: cx, y: cy });
        seg -= remaining;
        remaining = spacing;
      }
      remaining -= seg;
      cx = px;
      cy = py;
    }
    while (out.length < count) out.push({ x: cx, y: cy });
  }

  /** Drops history older than `maxLength` of arc length to keep memory bounded. */
  trim(maxLength: number): void {
    const n = this.xs.length;
    if (n < 64) return;
    let acc = 0;
    for (let i = n - 1; i > 0; i--) {
      acc += Math.hypot(this.xs[i] - this.xs[i - 1], this.ys[i] - this.ys[i - 1]);
      if (acc > maxLength) {
        if (i > 32) {
          this.xs.splice(0, i - 1);
          this.ys.splice(0, i - 1);
        }
        return;
      }
    }
  }
}

export interface PlayArea {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const PLAY_AREA: PlayArea = {
  minX: ARENA.wall,
  minY: ARENA.wall,
  maxX: ARENA.width - ARENA.wall,
  maxY: ARENA.height - ARENA.wall,
};

/**
 * Turns `heading` toward `desired` by at most `maxTurn`. When the request is an almost
 * exact reversal, the turn bends toward `(towardX, towardY)` (usually the arena centre)
 * so U-turns curve away from walls.
 */
export function steer(
  heading: number,
  desired: number,
  maxTurn: number,
  x: number,
  y: number,
  towardX: number,
  towardY: number,
): number {
  let diff = angleDiff(heading, desired);
  if (Math.abs(diff) > Math.PI - 0.08) {
    const cross = Math.cos(heading) * (towardY - y) - Math.sin(heading) * (towardX - x);
    diff = cross >= 0 ? Math.abs(diff) : -Math.abs(diff);
  }
  return heading + clamp(diff, -maxTurn, maxTurn);
}

export interface WallHit {
  hit: boolean;
}

/**
 * Keeps a circle inside the play area. If it crossed a wall, it is pushed back and
 * its heading is reflected so it travels inward at a clear angle.
 */
export function bounceOffWalls(
  e: { x: number; y: number; heading: number },
  radius: number,
  minInward = ARENA.wallMinInward,
  area: PlayArea = PLAY_AREA,
): boolean {
  let vx = Math.cos(e.heading);
  let vy = Math.sin(e.heading);
  let hit = false;
  if (e.x - radius < area.minX) {
    e.x = area.minX + radius;
    vx = Math.max(Math.abs(vx), minInward);
    hit = true;
  } else if (e.x + radius > area.maxX) {
    e.x = area.maxX - radius;
    vx = -Math.max(Math.abs(vx), minInward);
    hit = true;
  }
  if (e.y - radius < area.minY) {
    e.y = area.minY + radius;
    vy = Math.max(Math.abs(vy), minInward);
    hit = true;
  } else if (e.y + radius > area.maxY) {
    e.y = area.maxY - radius;
    vy = -Math.max(Math.abs(vy), minInward);
    hit = true;
  }
  if (hit) e.heading = Math.atan2(vy, vx);
  return hit;
}

export class Snake {
  x = ARENA.width / 2;
  y = ARENA.height / 2 + 120;
  heading = -Math.PI / 2;
  steerLock = 0;
  /** Smoothly approaches `segmentTarget` so growth is visible rather than instant. */
  segmentCount: number = SNAKE.startSegments;
  segmentTarget: number = SNAKE.startSegments;
  readonly segments: Vec[] = [];
  readonly trail = new PathTrail(2);
  /** Time accumulator used for idle animation (tongue, hat sway). */
  anim = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.x = ARENA.width / 2;
    this.y = ARENA.height / 2 + 120;
    this.heading = -Math.PI / 2;
    this.steerLock = 0;
    this.segmentCount = SNAKE.startSegments;
    this.segmentTarget = SNAKE.startSegments;
    this.trail.reset(this.x, this.y, this.heading, (SNAKE.maxSegments + 2) * SNAKE.segmentSpacing);
    this.updateSegments();
  }

  /**
   * Advances the head. `dirX/dirY` is the held WASD vector (0,0 keeps the current heading).
   * Returns true if the head bounced off a wall this step.
   */
  update(dt: number, dirX: number, dirY: number): boolean {
    this.anim += dt;
    if (this.steerLock > 0) {
      this.steerLock -= dt;
    } else if (dirX !== 0 || dirY !== 0) {
      const desired = Math.atan2(dirY, dirX);
      this.heading = steer(this.heading, desired, SNAKE.turnRate * dt, this.x, this.y, ARENA.width / 2, ARENA.height / 2);
    }
    this.x += Math.cos(this.heading) * SNAKE.speed * dt;
    this.y += Math.sin(this.heading) * SNAKE.speed * dt;
    const hit = bounceOffWalls(this, SNAKE.headRadius);
    if (hit) this.steerLock = ARENA.wallSteerLock;
    this.trail.record(this.x, this.y);
    if (this.segmentCount < this.segmentTarget) {
      this.segmentCount = Math.min(this.segmentTarget, this.segmentCount + SNAKE.segmentGrowRate * dt);
    }
    this.updateSegments();
    return hit;
  }

  updateSegments(): void {
    const count = Math.ceil(this.segmentCount);
    this.trail.sample(this.x, this.y, count, SNAKE.segmentSpacing, this.segments);
    this.trail.trim((SNAKE.maxSegments + 4) * SNAKE.segmentSpacing);
  }

  segmentRadius(i: number): number {
    const n = Math.max(1, Math.ceil(this.segmentCount));
    const t = n <= 1 ? 0 : i / (n - 1);
    let r = SNAKE.segmentRadiusMax + (SNAKE.segmentRadiusMin - SNAKE.segmentRadiusMax) * t * t;
    // The newest tail segment grows in rather than popping.
    if (i === n - 1) {
      const frac = this.segmentCount - Math.floor(this.segmentCount);
      if (frac > 0) r *= 0.3 + 0.7 * frac;
    }
    return r;
  }
}
