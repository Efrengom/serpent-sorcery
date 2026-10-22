import { NAV } from './config';
import { MinHeap, NEIGHBOURS } from './heap';
import type { MapLayout } from './maps/types';
import { clearanceAt } from './terrain';

/**
 * A flow field toward the serpent's head: the path distance from every navigation cell, so a
 * foe anywhere on the map can step toward the neighbouring cell that is closest to its prey.
 * Paths keep a little away from solids, which are costlier to hug.
 */
export interface FlowField {
  cell: number;
  cols: number;
  rows: number;
  walkable: Uint8Array;
  /** Cost multiplier of stepping into each cell. */
  cost: Float32Array;
  /** Path distance (world units) from each cell to the head; Infinity where unreachable. */
  dist: Float64Array;
  /** Seconds until the next refresh. */
  timer: number;
  heap: MinHeap;
}

export function createFlowField(map: MapLayout): FlowField {
  const { cell, cols, rows, values } = map.clearance;
  const n = cols * rows;
  const walkable = new Uint8Array(n);
  const cost = new Float32Array(n);
  const harm = map.harmIndex;
  for (let i = 0; i < n; i++) {
    walkable[i] = values[i] >= NAV.minClearance ? 1 : 0;
    cost[i] = 1 + (values[i] < NAV.hugClearance ? NAV.hugCost : 0);
    if (harm && clearanceAt(harm, ((i % cols) + 0.5) * cell, (Math.floor(i / cols) + 0.5) * cell) < 10) cost[i] += NAV.harmCost;
  }
  return { cell, cols, rows, walkable, cost, dist: new Float64Array(n).fill(Infinity), timer: 0, heap: new MinHeap() };
}

function cellIndex(f: FlowField, x: number, y: number): number {
  const c = Math.max(0, Math.min(f.cols - 1, Math.floor(x / f.cell)));
  const r = Math.max(0, Math.min(f.rows - 1, Math.floor(y / f.cell)));
  return r * f.cols + c;
}

/** Recomputes path distances from (x, y) to every reachable cell (Dijkstra). */
export function refreshFlowField(f: FlowField, x: number, y: number): void {
  const { cols, rows, walkable, cost, dist, heap } = f;
  dist.fill(Infinity);
  heap.clear();
  // The head's own cell, or the walkable cells around it when it's squeezed against a solid.
  const home = cellIndex(f, x, y);
  const hc = home % cols;
  const hr = (home - hc) / cols;
  const reach = walkable[home] ? 0 : 2;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const c = hc + dc;
      const r = hr + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows || !walkable[r * cols + c]) continue;
      const d = Math.hypot(dc, dr) * f.cell;
      dist[r * cols + c] = d;
      heap.push(d, r * cols + c);
    }
  }
  while (heap.size) {
    const i = heap.pop();
    const d = heap.lastKey;
    if (d > dist[i]) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dc, dr, step] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!walkable[j]) continue;
      // No cutting corners between two blocked cells.
      if (dc !== 0 && dr !== 0 && (!walkable[r * cols + nc] || !walkable[nr * cols + c])) continue;
      const nd = d + step * f.cell * cost[j];
      if (nd < dist[j]) {
        dist[j] = nd;
        heap.push(nd, j);
      }
    }
  }
}

/** Path distance from (x, y) to the head, or Infinity if there's no way. */
export function flowDistance(f: FlowField, x: number, y: number): number {
  return f.dist[cellIndex(f, x, y)];
}

/**
 * The direction to walk from (x, y) to follow the shortest path to the head: toward the middle
 * of the neighbouring cell nearest to it. Null where no path is known.
 */
export function flowAngle(f: FlowField, x: number, y: number): number | null {
  const { cols, rows, dist, walkable } = f;
  const i = cellIndex(f, x, y);
  const c = i % cols;
  const r = (i - c) / cols;
  let best = -1;
  let bestD = dist[i];
  for (const [dc, dr] of NEIGHBOURS) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
    const j = nr * cols + nc;
    if (dc !== 0 && dr !== 0 && (!walkable[r * cols + nc] || !walkable[nr * cols + c])) continue;
    if (dist[j] < bestD) {
      bestD = dist[j];
      best = j;
    }
  }
  if (best < 0) return null;
  const bc = best % cols;
  const br = (best - bc) / cols;
  return Math.atan2((br + 0.5) * f.cell - y, (bc + 0.5) * f.cell - x);
}
