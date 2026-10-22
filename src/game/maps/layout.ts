import { ARENA, BREAKABLES, NAV } from '../config';
import { mulberry32, type Vec } from '../math';
import { buildSolidIndex, clearanceAt } from '../terrain';
import type { BreakableSlot, ClearanceGrid, Hazard, Landmark, MapDef, MapLayout, Rect, Solid, SolidIndex } from './types';

/** The grid characters that mark hazard cells. */
const HAZARD_CELLS = { '~': 'lava', '%': 'bramble', '=': 'ice' } as const;

/** Builds a map for one run: grid walls, the boundary, the seeded pieces and every lookup table. */
export function buildLayout(def: MapDef, seed: number): MapLayout {
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const width = cols * def.cell;
  const height = rows * def.cell;
  const wall = ARENA.wall;

  // The boundary: four thick slabs whose inner faces are the wall band's edge.
  const far = 400;
  const solids: Solid[] = [
    rectSolid(-far, -far, width + far, wall),
    rectSolid(-far, height - wall, width + far, height + far),
    rectSolid(-far, -far, wall, height + far),
    rectSolid(width - wall, -far, width + far, height + far),
  ];
  for (const r of wallRects(def)) solids.push(rectSolid(r.x0, r.y0, r.x1, r.y1));

  // Seeded variation: which optional groups appear, and a little jitter on round pieces.
  const rng = mulberry32((seed ^ hashString(def.id)) >>> 0);
  const keep = new Map<string, boolean>();
  for (const group of Object.keys(def.optional).sort()) keep.set(group, rng() < def.optional[group]);
  for (const piece of def.pieces) {
    if (piece.group && keep.get(piece.group) === false) continue;
    const s = { ...piece.solid };
    if (s.shape === 'circle' && def.jitter > 0) {
      s.x += (rng() - 0.5) * 2 * def.jitter;
      s.y += (rng() - 0.5) * 2 * def.jitter;
    }
    solids.push(s);
  }

  const index = buildSolidIndex(solids, width, height);
  // Hazards: the grid's cells of each kind, plus pools, thickets and sheets placed on top.
  const hazards: Hazard[] = [
    ...(Object.keys(HAZARD_CELLS) as (keyof typeof HAZARD_CELLS)[]).flatMap((ch) => wallRects(def, ch).map((r): Hazard => ({ shape: 'rect', name: HAZARD_CELLS[ch], ...r }))),
    ...def.hazards.map((h) => ({ ...h })),
  ];
  const lookup = (list: Hazard[]) => (list.length > 0 ? buildSolidIndex(list, width, height) : null);
  const hazardIndex = lookup(hazards);
  const zones: MapLayout['zones'] = {};
  for (const kind of ['lava', 'bramble', 'ice'] as const) {
    const index = lookup(hazards.filter((h) => h.name === kind));
    if (index) zones[kind] = index;
  }
  const harmIndex = lookup(hazards.filter((h) => h.name !== 'ice'));
  const marks = cellMarks(def);
  const bounds = { minX: wall, minY: wall, maxX: width - wall, maxY: height - wall };
  return {
    def,
    width,
    height,
    bounds,
    solids,
    index,
    start: marks.start,
    startHeading: def.startHeading,
    clearings: marks.clearings,
    landmarks: marks.landmarks,
    torches: wallTorches(index, width, height),
    slots: breakableSlots(def, index, hazardIndex, bounds, marks.start),
    hazards,
    hazardIndex,
    zones,
    harmIndex,
    vents: def.vents.map(([x, y]) => ({ x, y })),
    clearance: clearanceGrid(index, width, height),
  };
}

/**
 * Breakable slots: the map's hand-placed large ones (minus any an optional piece covers this
 * run), then small ones scattered by the map's own seed, mostly along the stonework, never
 * crowding each other or the start.
 */
function breakableSlots(def: MapDef, index: SolidIndex, hazards: SolidIndex | null, bounds: MapLayout['bounds'], start: Vec): BreakableSlot[] {
  const cfg = def.breakables;
  const slots: BreakableSlot[] = [];
  // Nothing stands in lava.
  const dry = (x: number, y: number, r: number) => !hazards || clearanceAt(hazards, x, y) >= r;
  for (const [x, y] of cfg.largeSlots) {
    if (clearanceAt(index, x, y) >= BREAKABLES.large.radius && dry(x, y, BREAKABLES.large.radius + 20)) slots.push({ x, y, size: 'large' });
  }
  const rng = mulberry32(cfg.smallSeed);
  const r = BREAKABLES.small.radius;
  let small = 0;
  for (let tries = 0; tries < 30000 && small < cfg.smallCount; tries++) {
    const x = bounds.minX + 40 + rng() * (bounds.maxX - bounds.minX - 80);
    const y = bounds.minY + 40 + rng() * (bounds.maxY - bounds.minY - 80);
    const keep = rng();
    const d = clearanceAt(index, x, y);
    if (d < r + 10 || !dry(x, y, r + 30)) continue;
    // Urns gather against walls and pillars; a few stand in the open.
    if (keep > (d < 90 ? 0.9 : 0.12)) continue;
    if (Math.hypot(x - start.x, y - start.y) < 360) continue;
    if (slots.some((s) => Math.hypot(s.x - x, s.y - y) < (s.size === 'large' ? 80 : 140))) continue;
    slots.push({ x, y, size: 'small' });
    small++;
  }
  return slots;
}

function rectSolid(x0: number, y0: number, x1: number, y1: number): Solid {
  return { shape: 'rect', name: 'wall', x0, y0, x1, y1 };
}

/** FNV-1a, so each map mixes its own variation out of the run seed. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Merges the grid's wall cells (or another character's) into as few rectangles as possible: row runs, stacked when identical. */
export function wallRects(def: MapDef, cellChar = '#'): Rect[] {
  const c = def.cell;
  const out: Rect[] = [];
  let open = new Map<string, Rect>();
  def.grid.forEach((row, y) => {
    const next = new Map<string, Rect>();
    let x = 0;
    while (x < row.length) {
      if (row[x] !== cellChar) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < row.length && row[x] === cellChar) x++;
      const key = `${x0}:${x}`;
      const above = open.get(key);
      if (above) {
        above.y1 = (y + 1) * c;
        next.set(key, above);
      } else {
        const r = { x0: x0 * c, y0: y * c, x1: x * c, y1: (y + 1) * c };
        out.push(r);
        next.set(key, r);
      }
    }
    open = next;
  });
  return out;
}

/** Reads the start, boss clearings and landmark anchors off the grid. */
function cellMarks(def: MapDef): { start: Vec; clearings: Rect[]; landmarks: Landmark[] } {
  const c = def.cell;
  const rows = def.grid.length;
  const cols = def.grid[0].length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? '#' : def.grid[y][x]);
  const centre = (cells: [number, number][]): Vec => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of cells) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { x: ((x0 + x1) / 2) * c, y: ((y0 + y1) / 2) * c };
  };
  const byChar = new Map<string, [number, number][]>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = at(x, y);
      if (ch === 'S' || /[1-9]/.test(ch)) byChar.set(ch, [...(byChar.get(ch) ?? []), [x, y]]);
    }
  }
  const startCells = byChar.get('S');
  if (!startCells) throw new Error(`map ${def.id} has no start (S) cell`);
  const landmarks: Landmark[] = [];
  for (const [ch, info] of Object.entries(def.landmarks)) {
    const cells = byChar.get(ch);
    if (cells) landmarks.push({ ...info, ...centre(cells) });
  }

  // Each connected patch of clearing cells (S and digits count when they sit inside one).
  const inPatch = (ch: string) => ch === 'b' || ch === 'S' || /[1-9]/.test(ch);
  const seen = new Uint8Array(cols * rows);
  const clearings: Rect[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (seen[y * cols + x] || at(x, y) !== 'b') continue;
      const cells: [number, number][] = [];
      const queue: [number, number][] = [[x, y]];
      seen[y * cols + x] = 1;
      while (queue.length) {
        const [qx, qy] = queue.pop()!;
        cells.push([qx, qy]);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny * cols + nx] || !inPatch(at(nx, ny))) continue;
          seen[ny * cols + nx] = 1;
          queue.push([nx, ny]);
        }
      }
      const x0 = Math.min(...cells.map((p) => p[0]));
      const y0 = Math.min(...cells.map((p) => p[1]));
      const x1 = Math.max(...cells.map((p) => p[0])) + 1;
      const y1 = Math.max(...cells.map((p) => p[1])) + 1;
      clearings.push({ x0: x0 * c, y0: y0 * c, x1: x1 * c, y1: y1 * c });
    }
  }
  return { start: centre(startCells), clearings, landmarks };
}

/** Torches on the boundary wall every so often, skipped where a wall block meets the boundary. */
function wallTorches(index: SolidIndex, width: number, height: number): Vec[] {
  const w = ARENA.wall;
  const step = 480;
  const out: Vec[] = [];
  const free = (x: number, y: number) => clearanceAt(index, x, y) > 40;
  for (let x = step / 2; x < width; x += step) {
    if (free(x, w + 60)) out.push({ x, y: w - 6 });
    if (free(x, height - w - 60)) out.push({ x, y: height - w + 6 });
  }
  for (let y = step / 2 + step / 4; y < height - step / 4; y += step) {
    if (free(w + 60, y)) out.push({ x: w - 6, y });
    if (free(width - w - 60, y)) out.push({ x: width - w + 6, y });
  }
  return out;
}

/** Distance to the nearest solid at the middle of every navigation cell. */
function clearanceGrid(index: SolidIndex, width: number, height: number): ClearanceGrid {
  const cell = NAV.cell;
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) values[r * cols + c] = clearanceAt(index, (c + 0.5) * cell, (r + 0.5) * cell);
  }
  return { cell, cols, rows, values };
}
