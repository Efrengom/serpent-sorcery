import { ARENA, TERRAIN } from './config';
import type { Solid, SolidIndex } from './maps/types';

/**
 * Terrain queries: distances to solids, pushing bodies out of them, bounces and ray casts.
 * Every solid has an exact signed distance (negative inside), so one set of functions handles
 * circles, rectangles and capsules alike.
 */

export interface Contact {
  /** Signed distance from the point to the solid's surface (negative inside). */
  d: number;
  /** Outward surface normal at the closest point. */
  nx: number;
  ny: number;
  solid: Solid | null;
}

const scratch: Contact = { d: 0, nx: 0, ny: -1, solid: null };

/** Signed distance from (x, y) to one solid, writing the outward normal into `out`. */
export function solidDistance(s: Solid, x: number, y: number, out: Contact = scratch): number {
  let d: number;
  if (s.shape === 'circle') {
    const dx = x - s.x;
    const dy = y - s.y;
    const len = Math.hypot(dx, dy);
    d = len - s.r;
    if (len > 1e-9) {
      out.nx = dx / len;
      out.ny = dy / len;
    } else {
      out.nx = 0;
      out.ny = -1;
    }
  } else if (s.shape === 'capsule') {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / len2));
    const dx = x - (s.ax + ex * t);
    const dy = y - (s.ay + ey * t);
    const len = Math.hypot(dx, dy);
    d = len - s.r;
    if (len > 1e-9) {
      out.nx = dx / len;
      out.ny = dy / len;
    } else {
      // On the axis: push out sideways.
      const el = Math.sqrt(len2);
      out.nx = -ey / el;
      out.ny = ex / el;
    }
  } else {
    const cx = Math.max(s.x0, Math.min(s.x1, x));
    const cy = Math.max(s.y0, Math.min(s.y1, y));
    if (cx !== x || cy !== y) {
      const dx = x - cx;
      const dy = y - cy;
      d = Math.hypot(dx, dy);
      out.nx = dx / d;
      out.ny = dy / d;
    } else {
      // Inside: the nearest face wins.
      const l = x - s.x0;
      const r = s.x1 - x;
      const t = y - s.y0;
      const b = s.y1 - y;
      const m = Math.min(l, r, t, b);
      d = -m;
      out.nx = m === l ? -1 : m === r ? 1 : 0;
      out.ny = m === l || m === r ? 0 : m === t ? -1 : 1;
    }
  }
  out.d = d;
  out.solid = s;
  return d;
}

/** The axis-aligned box around a solid. */
export function solidBounds(s: Solid): { x0: number; y0: number; x1: number; y1: number } {
  if (s.shape === 'circle') return { x0: s.x - s.r, y0: s.y - s.r, x1: s.x + s.r, y1: s.y + s.r };
  if (s.shape === 'capsule') {
    return {
      x0: Math.min(s.ax, s.bx) - s.r,
      y0: Math.min(s.ay, s.by) - s.r,
      x1: Math.max(s.ax, s.bx) + s.r,
      y1: Math.max(s.ay, s.by) + s.r,
    };
  }
  return { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 };
}

/**
 * Lists every solid in each lookup cell it comes within `margin` of. Any point then finds all
 * solids closer than `margin` in its own cell alone.
 */
export function buildSolidIndex(solids: Solid[], width: number, height: number): SolidIndex {
  const cell = TERRAIN.indexCell;
  const margin = TERRAIN.indexMargin;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const cells: number[][] = Array.from({ length: cols * rows }, () => []);
  solids.forEach((s, i) => {
    const b = solidBounds(s);
    const c0 = Math.max(0, Math.floor((b.x0 - margin) / cell));
    const c1 = Math.min(cols - 1, Math.floor((b.x1 + margin) / cell));
    const r0 = Math.max(0, Math.floor((b.y0 - margin) / cell));
    const r1 = Math.min(rows - 1, Math.floor((b.y1 + margin) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c].push(i);
  });
  return { cell, cols, rows, cells, margin, solids };
}

function cellAt(index: SolidIndex, x: number, y: number): number[] {
  const c = Math.max(0, Math.min(index.cols - 1, Math.floor(x / index.cell)));
  const r = Math.max(0, Math.min(index.rows - 1, Math.floor(y / index.cell)));
  return index.cells[r * index.cols + c];
}

const probe: Contact = { d: 0, nx: 0, ny: -1, solid: null };

/**
 * The nearest solid to (x, y). Distances are exact up to the index margin; with nothing that
 * close, `d` is the margin and `solid` is null.
 */
export function nearestSolid(index: SolidIndex, x: number, y: number, out: Contact = { d: 0, nx: 0, ny: -1, solid: null }): Contact {
  out.d = index.margin;
  out.nx = 0;
  out.ny = -1;
  out.solid = null;
  for (const i of cellAt(index, x, y)) {
    const d = solidDistance(index.solids[i], x, y, probe);
    if (d < out.d) {
      out.d = d;
      out.nx = probe.nx;
      out.ny = probe.ny;
      out.solid = probe.solid;
    }
  }
  return out;
}

/** Distance from (x, y) to the nearest solid, capped at the index margin. */
export function clearanceAt(index: SolidIndex, x: number, y: number): number {
  let best = index.margin;
  for (const i of cellAt(index, x, y)) best = Math.min(best, solidDistance(index.solids[i], x, y, probe));
  return best;
}

const hit: Contact = { d: 0, nx: 0, ny: -1, solid: null };

/** Outward normal of the last push made by pushOut. */
export const lastPush = { nx: 0, ny: -1 };

/**
 * Moves a circle of radius `r` out of every solid it overlaps. Returns the solid it was
 * pushed out of (the first, if several) and leaves its outward normal in `lastPush`.
 */
export function pushOut(index: SolidIndex, body: { x: number; y: number }, r: number): Solid | null {
  let first: Solid | null = null;
  // A corner between two solids can need a second or third push.
  for (let pass = 0; pass < 3; pass++) {
    nearestSolid(index, body.x, body.y, hit);
    if (!hit.solid || hit.d >= r) break;
    const depth = r - hit.d;
    body.x += hit.nx * depth;
    body.y += hit.ny * depth;
    first ??= hit.solid;
    lastPush.nx = hit.nx;
    lastPush.ny = hit.ny;
  }
  return first;
}

/**
 * Keeps a heading circle out of solids. If it hit one, it is pushed out and its heading is
 * reflected so it leaves the surface at a clear angle (like the old wall bounce). Returns the
 * solid hit, or null.
 */
export function bounceOffSolids(
  index: SolidIndex,
  e: { x: number; y: number; heading: number },
  r: number,
  minOut = ARENA.wallMinInward,
): Solid | null {
  const solid = pushOut(index, e, r);
  if (!solid) return null;
  const { nx, ny } = lastPush;
  const vx = Math.cos(e.heading);
  const vy = Math.sin(e.heading);
  const vn = vx * nx + vy * ny;
  // Keep the sideways part of the motion, and make the outward part at least `minOut`.
  const out = Math.max(Math.abs(vn), minOut);
  e.heading = Math.atan2(vy - vn * ny + out * ny, vx - vn * nx + out * nx);
  return solid;
}

/**
 * How far a circle of radius `r` can travel from (x0, y0) toward (x1, y1) before touching a
 * solid (sphere tracing). Returns the full length when the way is clear.
 */
export function castRay(index: SolidIndex, x0: number, y0: number, x1: number, y1: number, r = 0): number {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return 0;
  const dx = (x1 - x0) / len;
  const dy = (y1 - y0) / len;
  let t = 0;
  for (let i = 0; i < 400 && t < len; i++) {
    const d = clearanceAt(index, x0 + dx * t, y0 + dy * t) - r;
    if (d < 0.5) return t;
    t += Math.max(d, 2);
  }
  return Math.min(t, len);
}

/** True when a circle of radius `r` can travel in a straight line from a to b. */
export function clearPath(index: SolidIndex, ax: number, ay: number, bx: number, by: number, r = 0): boolean {
  const len = Math.hypot(bx - ax, by - ay);
  return castRay(index, ax, ay, bx, by, r) >= len - 0.5;
}

/**
 * A point to bend a U-turn toward: straight out from the nearest solid if one is close, else
 * the middle of the map. (Reversals curve away from walls instead of into them.)
 */
export function openSide(index: SolidIndex, x: number, y: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
  const c = nearestSolid(index, x, y, hit);
  if (c.solid && c.d < 300) return { x: x + c.nx * 200, y: y + c.ny * 200 };
  return { x: fallbackX, y: fallbackY };
}
