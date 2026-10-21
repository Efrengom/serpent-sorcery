import { PIXEL_ART } from '../config';
import { hash2 } from '../hash';
import type { MapLayout, Solid } from '../maps/types';
import { mulberry32 } from '../math';
import { nearestSolid, type Contact } from '../terrain';
import { bayer, createCanvas, hexRgb } from './bake';
import { PX } from './palette';

/** The themed colours of one area's floor and stonework. */
interface FloorPalette {
  grout: string;
  void: string;
  stone0: string;
  stone1: string;
  stone2: string;
  stone3: string;
  stoneHi: string;
  wall0: string;
  wall1: string;
  wall2: string;
  wallHi: string;
  /** Carved stone: statues and the colossus. */
  carve0: string;
  carve1: string;
  carve2: string;
  carveHi: string;
  moss0: string;
  moss1: string;
  rune: string;
  runeHi: string;
  mush: string;
  mushDim: string;
  torchGlow: string;
  torchGlow2: string;
  /** Glowing lava in the cracks (the Ember Depths), or null for plain grout. */
  lava: string | null;
  lavaHot: string | null;
}

const RUINS: FloorPalette = {
  grout: PX.grout,
  void: PX.void,
  stone0: PX.stone0,
  stone1: PX.stone1,
  stone2: PX.stone2,
  stone3: PX.stone3,
  stoneHi: PX.stoneHi,
  wall0: PX.wall0,
  wall1: PX.wall1,
  wall2: PX.wall2,
  wallHi: PX.wallHi,
  carve0: '#2f2550',
  carve1: '#4a3d75',
  carve2: '#62538e',
  carveHi: '#8f7fc2',
  moss0: PX.moss0,
  moss1: PX.moss1,
  rune: PX.rune,
  runeHi: PX.runeHi,
  mush: PX.mush,
  mushDim: PX.mushDim,
  torchGlow: PX.torchGlow,
  torchGlow2: PX.torchGlow2,
  lava: null,
  lavaHot: null,
};

/** The Ember Depths: scorched red-brown stone, ash instead of moss, embers and lava cracks. */
const EMBER: FloorPalette = {
  grout: '#1a0806',
  void: '#120504',
  stone0: '#2a0f0a',
  stone1: '#3a1610',
  stone2: '#471c14',
  stone3: '#55241a',
  stoneHi: '#6e3524',
  wall0: '#1f0906',
  wall1: '#3a150e',
  wall2: '#552417',
  wallHi: '#8a4228',
  carve0: '#4a1e12',
  carve1: '#6a301e',
  carve2: '#86432a',
  carveHi: '#b8683e',
  moss0: '#2e1410',
  moss1: '#45201a',
  rune: '#6a2a16',
  runeHi: '#c0522a',
  mush: '#ffb35c',
  mushDim: '#a8441a',
  torchGlow: '#4a1c12',
  torchGlow2: '#622616',
  lava: '#d8461c',
  lavaHot: '#ffb35c',
};

const PALETTES = [RUINS, EMBER];

const GLYPHS = [
  ['111', '010', '010', '010', '111'],
  ['101', '101', '111', '001', '001'],
  ['110', '101', '110', '101', '110'],
  ['010', '111', '010', '010', '010'],
  ['101', '010', '101', '010', '101'],
  ['111', '100', '110', '100', '111'],
  ['011', '100', '010', '001', '110'],
  ['100', '110', '101', '110', '100'],
];

const P = PIXEL_ART.worldPerPixel;
const CHUNK = PIXEL_ART.chunk;
/** Flagstone size in art pixels. */
const T = 16;
/** Rows painted per step of an unfinished chunk, so painting can be spread over frames. */
const BAND = 32;

/** A chunk being painted: its pixels, and the details placed ahead of the per-pixel pass. */
interface Job {
  key: number;
  X0: number;
  Y0: number;
  img: ImageData;
  /** Pixel colours placed by details (runes, cracks, pebbles, moss), by local index. */
  marks: Map<number, string>;
  /** Grout-like pixels (cracks) that moss grows in. */
  groutMarks: Set<number>;
  torches: { x: number; y: number }[];
  row: number;
}

/**
 * The pixel floor of a map, painted chunk by chunk (256×256 art pixels) and cached. Chunks
 * entering the view are painted at once; the ring just outside is painted a band at a time
 * within a small per-frame budget, ahead of need.
 */
export class PixelFloor {
  private chunks = new Map<number, HTMLCanvasElement>();
  private job: Job | null = null;
  private readonly C: FloorPalette;
  private readonly LIGHTER: Record<string, string>;
  private readonly cols: number;
  private readonly rows: number;
  private readonly hit: Contact = { d: 0, nx: 0, ny: -1, solid: null };
  /** Torch positions in art pixels (their flames are animated by the renderer). */
  readonly torches: { x: number; y: number }[];

  constructor(
    private readonly map: MapLayout,
    private readonly area: number,
  ) {
    this.C = PALETTES[area] ?? RUINS;
    const C = this.C;
    this.LIGHTER = { [C.stone0]: C.stone1, [C.stone1]: C.stone2, [C.stone2]: C.stone3, [C.stone3]: C.stoneHi };
    this.cols = Math.ceil(map.width / P / CHUNK);
    this.rows = Math.ceil(map.height / P / CHUNK);
    this.torches = map.torches.map((t) => ({ x: Math.round(t.x / P), y: Math.round(t.y / P) }));
  }

  /** Draws the chunks covering art-pixel rect [x0, x1) × [y0, y1), painting any that are missing. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const c0 = Math.max(0, Math.floor(x0 / CHUNK));
    const r0 = Math.max(0, Math.floor(y0 / CHUNK));
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - 1) / CHUNK));
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - 1) / CHUNK));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ctx.drawImage(this.chunk(c, r), c * CHUNK, r * CHUNK);
    const keep = 2 * (c1 - c0 + 3) * (r1 - r0 + 3);
    while (this.chunks.size > keep) this.chunks.delete(this.chunks.keys().next().value!);
  }

  /** Paints ahead into the ring of chunks around the view, for up to `budgetMs`. */
  prefetch(x0: number, y0: number, x1: number, y1: number, budgetMs: number): void {
    const end = performance.now() + budgetMs;
    while (performance.now() < end) {
      if (!this.job) {
        const next = this.missingAround(x0, y0, x1, y1);
        if (next === null) return;
        this.job = this.start(next % this.cols, Math.floor(next / this.cols));
      }
      this.paintBand(this.job);
      if (this.job.row >= CHUNK) this.finish(this.job);
    }
  }

  private missingAround(x0: number, y0: number, x1: number, y1: number): number | null {
    const c0 = Math.max(0, Math.floor(x0 / CHUNK) - 1);
    const r0 = Math.max(0, Math.floor(y0 / CHUNK) - 1);
    const c1 = Math.min(this.cols - 1, Math.floor((x1 - 1) / CHUNK) + 1);
    const r1 = Math.min(this.rows - 1, Math.floor((y1 - 1) / CHUNK) + 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (!this.chunks.has(r * this.cols + c)) return r * this.cols + c;
    return null;
  }

  private chunk(c: number, r: number): HTMLCanvasElement {
    const key = r * this.cols + c;
    let canvas = this.chunks.get(key);
    if (canvas) {
      this.chunks.delete(key);
      this.chunks.set(key, canvas);
      return canvas;
    }
    // Needed now: finish it in one go (picking up the background job if it's this chunk).
    const job = this.job?.key === key ? this.job : this.start(c, r);
    while (job.row < CHUNK) this.paintBand(job);
    canvas = this.finish(job);
    return canvas;
  }

  private finish(job: Job): HTMLCanvasElement {
    const canvas = createCanvas(CHUNK, CHUNK);
    canvas.getContext('2d')!.putImageData(job.img, 0, 0);
    this.chunks.set(job.key, canvas);
    if (this.job === job) this.job = null;
    return canvas;
  }

  /** Places the details that span several pixels, ahead of the per-pixel pass. */
  private start(c: number, r: number): Job {
    const C = this.C;
    const X0 = c * CHUNK;
    const Y0 = r * CHUNK;
    const marks = new Map<number, string>();
    const groutMarks = new Set<number>();
    const set = (x: number, y: number, hex: string, grout = false) => {
      x = Math.round(x) - X0;
      y = Math.round(y) - Y0;
      if (x < 0 || y < 0 || x >= CHUNK || y >= CHUNK) return;
      marks.set(y * CHUNK + x, hex);
      if (grout) groutMarks.add(y * CHUNK + x);
    };
    const salt = this.area * 101;

    // Cracks and chipped corners, per flagstone (tiles just outside the chunk can reach in).
    for (let row = Math.floor(Y0 / T) - 1; row <= Math.floor((Y0 + CHUNK) / T); row++) {
      const off = (row & 1) * (T / 2);
      for (let col = Math.floor((X0 - off) / T) - 1; col <= Math.floor((X0 + CHUNK - off) / T); col++) {
        const x0 = col * T + off;
        const y0 = row * T;
        if (hash2(col, row, salt + 1) < (C.lava ? 0.3 : 0.15)) {
          const rng = mulberry32(Math.floor(hash2(col, row, salt + 2) * 1e9));
          let cx = x0 + 4 + Math.floor(rng() * 8);
          let cy = y0 + 4 + Math.floor(rng() * 8);
          const steps = 4 + Math.floor(rng() * 5);
          const bias = rng() < 0.5 ? 1 : -1;
          for (let s = 0; s < steps; s++) {
            set(cx, cy, C.lava && s % 3 === 1 ? (C.lavaHot ?? C.lava) : (C.lava ?? C.grout), true);
            cx += rng() < 0.6 ? bias : 0;
            cy += rng() < 0.6 ? 1 : 0;
          }
        }
        if (hash2(col, row, salt + 3) < 0.12) {
          set(x0 + 1, y0 + 1, C.grout, true);
          set(x0 + 2, y0 + 1, C.grout, true);
          set(x0 + 1, y0 + 2, C.grout, true);
        }
      }
    }

    // Landmarks: the plaza's summoning circle and runes.
    for (const l of this.map.landmarks) {
      if (l.kind !== 'plaza') continue;
      const cx = l.x / P;
      const cy = l.y / P;
      if (cx < X0 - 100 || cx > X0 + CHUNK + 100 || cy < Y0 - 100 || cy > Y0 + CHUNK + 100) continue;
      for (const rr of [210, 190, 120]) circle(cx, cy, Math.round(rr / P), (x, y) => set(x, y, C.rune));
      const hr = 190 / P;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const b = ((i + 2) / 6) * Math.PI * 2 - Math.PI / 2;
        line(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr, cx + Math.cos(b) * hr, cy + Math.sin(b) * hr, (x, y) => set(x, y, C.rune));
      }
      const glyphR = 200 / P;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const gx = Math.round(cx + Math.cos(a) * glyphR) - 1;
        const gy = Math.round(cy + Math.sin(a) * glyphR) - 2;
        const glyph = GLYPHS[i % GLYPHS.length];
        for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y][x] === '1') set(gx + x, gy + y, C.runeHi);
      }
    }

    // Pebbles and glowing mushrooms where floor meets stone; moss blobs, thickest against it.
    const index = this.map.index;
    for (let j = Math.floor(Y0 / 6) - 1; j <= Math.ceil((Y0 + CHUNK) / 6); j++) {
      for (let i = Math.floor(X0 / 6) - 1; i <= Math.ceil((X0 + CHUNK) / 6); i++) {
        const h = hash2(i, j, salt + 4);
        if (h > 0.2) continue;
        const x = i * 6 + Math.floor(hash2(i, j, salt + 5) * 6);
        const y = j * 6 + Math.floor(hash2(i, j, salt + 6) * 6);
        const d = nearestSolid(index, x * P, y * P, this.hit).d;
        if (d < 4 || d > 45) continue;
        if (h < 0.03) {
          set(x, y, C.mush);
          set(x, y + 1, C.mushDim);
          if (h < 0.018) {
            set(x + 2, y + 1, C.mushDim);
            set(x + 2, y + 2, C.moss1);
          }
        } else {
          set(x, y, C.stone0);
          set(x + 1, y, C.stone0);
          set(x, y - 1, C.stoneHi);
          if (h < 0.1) set(x + 1, y - 1, C.stone3);
        }
      }
    }
    for (let j = Math.floor(Y0 / 64) - 1; j <= Math.floor((Y0 + CHUNK) / 64) + 1; j++) {
      for (let i = Math.floor(X0 / 64) - 1; i <= Math.floor((X0 + CHUNK) / 64) + 1; i++) {
        const mx = (i + hash2(i, j, salt + 7)) * 64;
        const my = (j + hash2(i, j, salt + 8)) * 64;
        const near = nearestSolid(index, mx * P, my * P, this.hit).d < 150;
        if (hash2(i, j, salt + 9) > (near ? 0.6 : 0.06)) continue;
        const r = 7 + hash2(i, j, salt + 10) * 11;
        for (let y = Math.floor(my - r); y <= my + r; y++) {
          for (let x = Math.floor(mx - r); x <= mx + r; x++) {
            const dd = Math.hypot(x - mx, y - my);
            if (dd > r) continue;
            const k = 1 - dd / r;
            const lx = x - X0;
            const ly = y - Y0;
            if (lx < 0 || ly < 0 || lx >= CHUNK || ly >= CHUNK) continue;
            const li = ly * CHUNK + lx;
            const t = tileAt(x, y);
            const grout = t.dx === 0 || t.dy === 0 || groutMarks.has(li);
            if (grout) {
              if (hash2(x, y, salt + 11) < k * 1.3) marks.set(li, C.moss1);
            } else if ((t.dx === 1 || t.dy === 1 || t.dx === T - 1 || t.dy === T - 1) && hash2(x, y, salt + 12) < k * 0.55 && !marks.has(li)) {
              marks.set(li, C.moss0);
            }
          }
        }
      }
    }

    const torches = this.torches.filter((t) => t.x > X0 - 40 && t.x < X0 + CHUNK + 40 && t.y > Y0 - 40 && t.y < Y0 + CHUNK + 40);
    return { key: r * this.cols + c, X0, Y0, img: new ImageData(CHUNK, CHUNK), marks, groutMarks, torches, row: 0 };
  }

  /** Paints the next band of rows of a chunk: stonework, then floor with its details and shadows. */
  private paintBand(job: Job): void {
    const C = this.C;
    const data = job.img.data;
    const index = this.map.index;
    const hit = this.hit;
    const salt = this.area * 101;
    const end = Math.min(CHUNK, job.row + BAND);
    for (let ly = job.row; ly < end; ly++) {
      const Y = job.Y0 + ly;
      for (let lx = 0; lx < CHUNK; lx++) {
        const X = job.X0 + lx;
        const li = ly * CHUNK + lx;
        const c = nearestSolid(index, (X + 0.5) * P, (Y + 0.5) * P, hit);
        const d = c.d / P;
        let hex: string;
        if (c.solid && d < 0) hex = this.stone(c.solid, X, Y, d, c.nx, c.ny);
        else if (c.solid && d < 1) hex = PX.ink;
        else {
          hex = job.marks.get(li) ?? this.flagstone(X, Y, salt);
          const grout = hex === C.grout || job.groutMarks.has(li);
          // Torch light pools on bare stone.
          for (const t of job.torches) {
            const td = Math.hypot(X - t.x, (Y - t.y) * 1.4);
            if (td > 26 || grout) continue;
            const k = 1 - td / 26;
            const th = bayer(X, Y);
            if (k > 0.62) hex = k > 0.8 ? C.torchGlow2 : th < (k - 0.62) * 5 ? C.torchGlow2 : C.torchGlow;
            else if (k > 0.35) hex = C.torchGlow;
            else if (th < (k / 0.35) * 0.5) hex = C.torchGlow;
          }
          // Shadows cast down and to the right, and darkness pooled against the stone.
          const shadowed = nearestSolid(index, (X + 0.5 - 2) * P, (Y + 0.5 - 3) * P, hit).d < 0;
          if ((shadowed && bayer(X, Y) < 0.6) || d < 1.6) hex = grout ? C.void : C.stone0;
        }
        const [r, g, b] = hexRgb(hex);
        const k = li * 4;
        data[k] = r;
        data[k + 1] = g;
        data[k + 2] = b;
        data[k + 3] = 255;
      }
    }
    job.row = end;
  }

  /** The floor's flagstones: bevelled slabs in a running bond with speckle. */
  private flagstone(X: number, Y: number, salt: number): string {
    const C = this.C;
    const t = tileAt(X, Y);
    if (t.dx === 0 || t.dy === 0) return C.grout;
    const shades = [C.stone1, C.stone2, C.stone2, C.stone3];
    const base = hash2(t.col, t.row, salt + 13) < 0.08 ? C.stone0 : shades[Math.floor(hash2(t.col, t.row, salt + 14) * 4)];
    const light = this.LIGHTER[base] ?? base;
    if (t.dx === 1 || t.dy === 1) return light;
    if (t.dx === T - 1 || t.dy === T - 1) return C.stone0;
    const n = hash2(X, Y, salt + 15);
    return n < 0.04 ? light : n < 0.08 ? C.stone0 : base;
  }

  /**
   * A pixel of stonework, `d` art pixels inside its surface (negative) with outward normal
   * (nx, ny). Every piece is rim-lit from the top-left like the sprites.
   */
  private stone(s: Solid, X: number, Y: number, d: number, nx: number, ny: number): string {
    const C = this.C;
    const edge = d > -1.2;
    const facing = nx + ny;
    if (s.name === 'wall') {
      if (edge && facing < -0.3) return C.wallHi;
      if (edge && facing > 0.3) return C.wall0;
      // Brick courses across the wall tops.
      const course = Math.floor(Y / 5);
      const local = ((Y % 5) + 5) % 5;
      const pos = (((X + (course % 2 === 0 ? 0 : 6)) % 12) + 12) % 12;
      if (local === 0 || pos === 0) return C.wall0;
      if (local === 1) return C.wall2;
      if (pos === 11 || local === 4) return C.wall0;
      return C.wall1;
    }
    const carved = s.name === 'statue' || s.name === 'colossus';
    const [c0, c1, c2, hi] = carved ? [C.carve0, C.carve1, C.carve2, C.carveHi] : [C.wall0, C.wall1, C.wall2, C.wallHi];
    if (edge && facing < -0.3) return hi;
    if (edge && facing > 0.3) return c0;
    if (s.name === 'colossus') {
      // Weathered: scattered pits and the odd crack.
      return hash2(X, Y, 77) < 0.05 ? c0 : hash2(X >> 2, Y >> 2, 78) < 0.08 ? c1 : c2;
    }
    if (s.shape === 'circle') {
      // A pillar top: a carved ring and a worn centre.
      if (Math.abs(d + 4) < 0.6 || -d > s.r / P - 2.5) return c1;
      return c2;
    }
    if (s.shape === 'capsule') {
      // A toppled column: drum joints across it.
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const len = Math.hypot(ex, ey) || 1;
      const along = (((X + 0.5) * P - s.ax) * ex + ((Y + 0.5) * P - s.ay) * ey) / len;
      if (Math.abs(((along / P) % 14) - 7) < 0.6) return c1;
      return c2;
    }
    // A statue's plinth or a free-standing block: an inset border.
    return Math.abs(d + 3) < 0.6 ? c1 : c2;
  }
}

/** A finished `w`×`h` art-pixel picture of the floor centred on world point (x, y): the menus' backdrop. */
export function pixelFloorPicture(map: MapLayout, area: number, x: number, y: number, w: number, h: number): HTMLCanvasElement {
  const floor = new PixelFloor(map, area);
  const canvas = createCanvas(w, h);
  const g = canvas.getContext('2d')!;
  const x0 = Math.round(x / P - w / 2);
  const y0 = Math.round(y / P - h / 2);
  g.translate(-x0, -y0);
  floor.draw(g, x0, y0, x0 + w, y0 + h);
  return canvas;
}

function tileAt(X: number, Y: number): { col: number; row: number; dx: number; dy: number } {
  const row = Math.floor(Y / T);
  const off = (row & 1) * (T / 2);
  const col = Math.floor((X - off) / T);
  return { col, row, dx: X - off - col * T, dy: Y - row * T };
}

function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function circle(cx: number, cy: number, r: number, plot: (x: number, y: number) => void): void {
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [px, py] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ]) {
      plot(cx + px, cy + py);
    }
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}
