import { BREAKABLES, SNAKE } from '../config';
import { MinHeap, NEIGHBOURS } from '../heap';
import { clearanceAt, solidDistance } from '../terrain';
import type { MapLayout } from './types';

/**
 * The layout rules every map must meet (see docs/maps-requirements.md, L3). Checked on a fine
 * grid of clearance samples; returns one message per broken rule, empty when the map is fine.
 */
export const LAYOUT_RULES = {
  /** Sample spacing for the checks. */
  cell: 25,
  /** Open ground with at least this clearance is a "turning" space: corridors 220 wide. */
  turning: 110,
  /**
   * Every spot the head fits must be this close (by path) to turning space: no long slits or
   * pockets. The inside of a right-angled corner measures about 160.
   */
  reach: 170,
  startClearance: 300,
  clearingMin: { w: 1000, h: 700 },
  clearingCount: { min: 3, max: 5 },
  /** Path distance from any turning space to the nearest clearing's middle. */
  clearingReach: 1900,
  openShare: 0.55,
  /** Breakable slots per map (B3). */
  smallSlots: { min: 120, max: 160 },
  largeSlots: { min: 20, max: 28 },
};

export interface LayoutReport {
  issues: string[];
  openShare: number;
  /** Longest path from turning space to a clearing. */
  farthestFromClearing: number;
}

export function validateLayout(map: MapLayout): LayoutReport {
  const R = LAYOUT_RULES;
  const issues: string[] = [];
  const { index, bounds, def } = map;

  if (def.grid.some((row) => row.length !== def.grid[0].length)) issues.push('grid rows have different lengths');
  for (const ch of Object.keys(def.landmarks)) {
    if (!map.landmarks.some((l) => l.name === def.landmarks[ch].name)) issues.push(`landmark ${ch} has no anchor in the grid`);
  }
  for (const p of def.pieces) {
    const s = p.solid;
    // Wall pieces may thicken a grid wall (gate towers); anything else in a wall cell is a typo.
    if (s.name === 'wall') continue;
    const [x, y] = s.shape === 'circle' ? [s.x, s.y] : s.shape === 'capsule' ? [(s.ax + s.bx) / 2, (s.ay + s.by) / 2] : [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2];
    const row = def.grid[Math.floor(y / def.cell)];
    if (row?.[Math.floor(x / def.cell)] === '#') issues.push(`a ${s.name} at (${x | 0}, ${y | 0}) sits in a wall cell`);
  }

  // Exact (uncapped) clearance: the index only measures up to its margin.
  let start = Infinity;
  for (const s of map.solids) start = Math.min(start, solidDistance(s, map.start.x, map.start.y));
  if (start < R.startClearance) issues.push(`the start has only ${start | 0} units of clearance`);

  const { min, max } = R.clearingCount;
  if (map.clearings.length < min || map.clearings.length > max) issues.push(`${map.clearings.length} boss clearings (want ${min}–${max})`);
  for (const c of map.clearings) {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (Math.max(w, h) < R.clearingMin.w || Math.min(w, h) < R.clearingMin.h) issues.push(`a clearing at (${c.x0}, ${c.y0}) is only ${w}×${h}`);
    let blocked = false;
    for (let y = c.y0; y <= c.y1 && !blocked; y += 20) {
      for (let x = c.x0; x <= c.x1 && !blocked; x += 20) if (clearanceAt(index, x, y) < 0) blocked = true;
    }
    if (blocked) issues.push(`a solid stands in the clearing at (${c.x0}, ${c.y0})`);
  }

  // Hazards (any kind): none at the start, in a clearing or on a vent; vents stand clear of stone and hazards.
  const hz = map.hazardIndex;
  /** Only stinging ground (lava, brambles) has to leave dry paths round it; ice is fine to cross. */
  const harm = map.harmIndex;
  const wet = (x: number, y: number, pad = 0) => !!hz && clearanceAt(hz, x, y) < pad;
  // (Exact: the index only measures up to its margin.)
  if (map.hazards.some((h) => solidDistance(h, map.start.x, map.start.y) < R.startClearance)) issues.push('a hazard is too close to the start');
  for (const c of map.clearings) {
    let lava = false;
    for (let y = c.y0; y <= c.y1 && !lava; y += 20) for (let x = c.x0; x <= c.x1 && !lava; x += 20) lava = wet(x, y);
    if (lava) issues.push(`a hazard runs into the clearing at (${c.x0}, ${c.y0})`);
  }
  for (const v of map.vents) {
    if (clearanceAt(index, v.x, v.y) < 120 || wet(v.x, v.y, 120)) issues.push(`the vent at (${v.x}, ${v.y}) is too close to stone or a hazard`);
    if (map.clearings.some((c) => v.x > c.x0 && v.x < c.x1 && v.y > c.y0 && v.y < c.y1)) issues.push(`the vent at (${v.x}, ${v.y}) is in a boss clearing`);
  }

  // Breakable slots: enough of each, none in stone, no reliquary in a boss clearing.
  const small = map.slots.filter((s) => s.size === 'small');
  const large = map.slots.filter((s) => s.size === 'large');
  if (small.length < R.smallSlots.min || small.length > R.smallSlots.max) issues.push(`${small.length} small breakable slots (want ${R.smallSlots.min}–${R.smallSlots.max})`);
  if (large.length < R.largeSlots.min || large.length > R.largeSlots.max) issues.push(`${large.length} large breakable slots (want ${R.largeSlots.min}–${R.largeSlots.max})`);
  for (const s of map.slots) {
    const r = s.size === 'large' ? BREAKABLES.large.radius : BREAKABLES.small.radius;
    if (clearanceAt(index, s.x, s.y) < r - 0.5) issues.push(`a ${s.size} breakable at (${s.x | 0}, ${s.y | 0}) overlaps stone`);
    if (s.size === 'large' && map.clearings.some((c) => s.x > c.x0 && s.x < c.x1 && s.y > c.y0 && s.y < c.y1)) issues.push(`a reliquary at (${s.x}, ${s.y}) stands in a boss clearing`);
  }

  // Fine grid of clearance samples across the play area.
  const cell = R.cell;
  const cols = Math.floor((bounds.maxX - bounds.minX) / cell);
  const rows = Math.floor((bounds.maxY - bounds.minY) / cell);
  const n = cols * rows;
  const clear = new Float32Array(n);
  let floor = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = clearanceAt(index, bounds.minX + (c + 0.5) * cell, bounds.minY + (r + 0.5) * cell);
      clear[r * cols + c] = v;
      if (v >= 0) floor++;
    }
  }
  const openShare = floor / n;
  if (openShare < R.openShare) issues.push(`only ${Math.round(openShare * 100)}% of the map is open floor`);
  const fits = (i: number) => clear[i] >= SNAKE.headRadius + 1;
  const turning = (i: number) => clear[i] >= R.turning;
  const cellOf = (x: number, y: number) =>
    Math.max(0, Math.min(rows - 1, Math.floor((y - bounds.minY) / cell))) * cols + Math.max(0, Math.min(cols - 1, Math.floor((x - bounds.minX) / cell)));

  // Path distances (world units) through cells the head fits in, from a set of sources.
  const heap = new MinHeap();
  const paths = (sources: number[], through: (i: number) => boolean): Float64Array => {
    // Float64: rounding to float32 on store would make equal paths look shorter and re-queue forever.
    const dist = new Float64Array(n).fill(Infinity);
    heap.clear();
    for (const s of sources) {
      dist[s] = 0;
      heap.push(0, s);
    }
    while (heap.size) {
      const i = heap.pop();
      const d = heap.lastKey;
      if (d > dist[i]) continue;
      const x = i % cols;
      const y = (i - x) / cols;
      for (const [dx, dy, step] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (!through(j)) continue;
        // No squeezing diagonally between two blocked cells.
        if (dx !== 0 && dy !== 0 && (!through(y * cols + nx) || !through(ny * cols + x))) continue;
        const nd = d + step * cell;
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
    return dist;
  };

  // Everything the head fits in is reachable from the start...
  const fromStart = paths([cellOf(map.start.x, map.start.y)], fits);
  let pockets = 0;
  let turningCut = 0;
  for (let i = 0; i < n; i++) {
    if (fits(i) && fromStart[i] === Infinity) pockets++;
  }
  if (pockets > 0) issues.push(`${pockets} cells of floor can't be reached from the start`);
  // ...and clear paths go round every stinging hazard: all dry floor is reachable without crossing it.
  if (harm) {
    const dry = (i: number) => fits(i) && clearanceAt(harm, bounds.minX + ((i % cols) + 0.5) * cell, bounds.minY + (Math.floor(i / cols) + 0.5) * cell) >= SNAKE.headRadius;
    const overDry = paths([cellOf(map.start.x, map.start.y)], dry);
    let cut = 0;
    for (let i = 0; i < n; i++) if (dry(i) && overDry[i] === Infinity) cut++;
    if (cut > 0) issues.push(`${cut} cells of dry floor can only be reached by crossing lava or brambles`);
  }
  if (hz) {
    let overlap = 0;
    for (let i = 0; i < n; i++) {
      const x = bounds.minX + ((i % cols) + 0.5) * cell;
      const y = bounds.minY + (Math.floor(i / cols) + 0.5) * cell;
      if (clear[i] < 0 && clearanceAt(hz, x, y) < 0) overlap++;
    }
    if (overlap > 0) issues.push(`a hazard overlaps stone in ${overlap} cells`);
  }
  // ...turning space is one connected region...
  const turningSources: number[] = [];
  for (let i = 0; i < n; i++) if (turning(i)) turningSources.push(i);
  const throughTurning = paths([cellOf(map.start.x, map.start.y)], turning);
  let cutAt = { x: 0, y: 0 };
  for (const i of turningSources) {
    if (throughTurning[i] !== Infinity) continue;
    turningCut++;
    cutAt = { x: bounds.minX + ((i % cols) + 0.5) * cell, y: bounds.minY + (Math.floor(i / cols) + 0.5) * cell };
  }
  if (turningCut > 0) issues.push(`${turningCut} cells of turning space are cut off from the rest by narrow gaps (one at ${cutAt.x | 0}, ${cutAt.y | 0})`);
  // ...and no spot is far from turning space (no long narrow corridors or pockets).
  const toTurning = paths(turningSources, fits);
  let slits = 0;
  let worst = { d: 0, x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    if (!fits(i) || toTurning[i] <= R.reach) continue;
    slits++;
    if (toTurning[i] > worst.d) worst = { d: toTurning[i], x: bounds.minX + ((i % cols) + 0.5) * cell, y: bounds.minY + (Math.floor(i / cols) + 0.5) * cell };
  }
  if (slits > 0) issues.push(`${slits} cells are more than ${R.reach} from turning space (worst ${worst.d | 0} at ${worst.x | 0}, ${worst.y | 0}): a corridor or pocket is too narrow`);

  // Boss clearings are never far away (measured to the nearest edge of one, from dry ground: nobody waits for a boss in lava).
  const clearingCells: number[] = [];
  for (const c of map.clearings) {
    for (let y = c.y0 + cell / 2; y < c.y1; y += cell) for (let x = c.x0 + cell / 2; x < c.x1; x += cell) clearingCells.push(cellOf(x, y));
  }
  const toClearing = paths(clearingCells, (i) => clear[i] >= 20);
  let farthest = 0;
  let far = { x: 0, y: 0 };
  for (const i of turningSources) {
    if (harm && clearanceAt(harm, bounds.minX + ((i % cols) + 0.5) * cell, bounds.minY + (Math.floor(i / cols) + 0.5) * cell) < 0) continue;
    if (toClearing[i] > farthest) {
      farthest = toClearing[i];
      far = { x: bounds.minX + ((i % cols) + 0.5) * cell, y: bounds.minY + (Math.floor(i / cols) + 0.5) * cell };
    }
  }
  if (farthest > R.clearingReach) issues.push(`(${far.x | 0}, ${far.y | 0}) is ${farthest | 0} from the nearest boss clearing`);

  return { issues, openShare, farthestFromClearing: farthest };
}
