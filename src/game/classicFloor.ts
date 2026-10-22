import { hash2 } from './hash';
import type { AnyShape, Hazard, Landmark, MapLayout, Solid } from './maps/types';
import { mulberry32, TAU, type Vec } from './math';
import { createCanvas } from './pixel/bake';
import { clearanceAt, solidBounds } from './terrain';

/** How one area's classic floor, stonework and lights are drawn. Colours are 'r,g,b' unless they start with '#'. */
export interface AreaStyle {
  floor: [string, string, string];
  tileLight: string;
  moss: string;
  glow: string;
  glowCore: string;
  circle: string;
  runes: string;
  rubble: [number, number, number];
  wall: string;
  brick: string;
  rim: string;
  pillar: [string, string];
  carve: [string, string];
  torch: string;
  /** The live wall lights: their wide glow and bright heart. */
  flame: [string, string];
  ambient: string;
  /** Glowing lava cracks (the Ember Depths). */
  cracks: string | null;
  /** Bare earth instead of flagstones (the Hollows), threaded with pale mycelium. */
  soil: boolean;
  threads: string | null;
  /** Frost on the flagstones and stonework (the Catacombs). */
  rime: string | null;
  /** The walls: coursed brick, a tangle of roots, or dressed crypt masonry. */
  walls: 'brick' | 'roots' | 'crypt';
}

/**
 * Colours of the classic floor and its stonework per area (see mapArea): the violet ruins, the
 * Ember Depths, the Mycelium Hollows and the Rimefrost Catacombs.
 */
export const AREA_STYLE: AreaStyle[] = [
  {
    floor: ['#33204f', '#24153d', '#170d2a'],
    tileLight: '190,160,255',
    moss: '60,140,90',
    glow: '120,255,230',
    glowCore: '200,255,245',
    circle: '160,130,255',
    runes: '180,150,255',
    rubble: [90, 70, 120],
    wall: '#120a22',
    brick: '120,95,170',
    rim: '200,170,255',
    pillar: ['#5d4b80', '#231638'],
    carve: ['#7a6aa6', '#3a2c5c'],
    torch: '255,190,110',
    flame: ['#ffb35c', '#fff0c0'],
    ambient: '#a58cff',
    cracks: null,
    soil: false,
    threads: null,
    rime: null,
    walls: 'brick',
  },
  {
    floor: ['#40211a', '#2b130e', '#170806'],
    tileLight: '255,170,120',
    moss: '120,50,20',
    glow: '255,150,60',
    glowCore: '255,232,170',
    circle: '255,130,80',
    runes: '255,170,110',
    rubble: [120, 70, 55],
    wall: '#1c0a06',
    brick: '170,90,60',
    rim: '255,170,120',
    pillar: ['#7a4630', '#2c120a'],
    carve: ['#9a5a3e', '#4a1e12'],
    torch: '255,150,70',
    flame: ['#ffb35c', '#fff0c0'],
    ambient: '#ff8a4a',
    cracks: '255,110,40',
    soil: false,
    threads: null,
    rime: null,
    walls: 'brick',
  },
  {
    // The Mycelium Hollows: teal-black earth, glowing teal and magenta, walls of roots.
    floor: ['#17393a', '#0e2526', '#061416'],
    tileLight: '120,255,220',
    moss: '60,190,140',
    glow: '90,255,215',
    glowCore: '225,255,245',
    circle: '255,110,220',
    runes: '120,255,220',
    rubble: [45, 72, 64],
    wall: '#06100f',
    brick: '96,74,56',
    rim: '110,255,210',
    pillar: ['#5a4636', '#1c140e'],
    carve: ['#5a6a5e', '#1e2a26'],
    torch: '90,255,210',
    flame: ['#5fffd0', '#e0fff6'],
    ambient: '#5fffd0',
    cracks: null,
    soil: true,
    threads: '170,255,235',
    rime: null,
    walls: 'roots',
  },
  {
    // The Rimefrost Catacombs: frosted flagstones in ice blue and navy, crypt masonry, cold light.
    floor: ['#2e3e58', '#1c2840', '#0d1526'],
    tileLight: '200,230,255',
    moss: '200,230,255',
    glow: '150,210,255',
    glowCore: '235,248,255',
    circle: '170,215,255',
    runes: '190,225,255',
    rubble: [90, 110, 140],
    wall: '#0a1120',
    brick: '150,175,215',
    rim: '215,240,255',
    pillar: ['#cfe8ff', '#4a6e98'],
    carve: ['#8a9ab4', '#343f58'],
    torch: '120,180,255',
    flame: ['#7ab8ff', '#eaf6ff'],
    ambient: '#9fd0ff',
    cracks: null,
    soil: false,
    threads: null,
    rime: '225,242,255',
    walls: 'crypt',
  },
];

/** World units per floor chunk. */
const CHUNK = 256;
/**
 * Each chunk is painted this far (world units) past its edges and drawn overlapping its
 * neighbours, so the soft edges of scaled chunk images never show as seams (they did on bright
 * ground such as ice).
 */
const BLEED = 3;
const TITLE_FONT = "'Cinzel', 'Palatino Linotype', Georgia, serif";

/**
 * The classic floor of a map, painted in square chunks the first time they come near the view
 * and cached (oldest dropped first). Everything that never moves is in the chunks: flagstones,
 * moss, runes, torch light, and the walls, pillars and statues with their shadows.
 */
export class ClassicFloor {
  private chunks = new Map<number, HTMLCanvasElement>();

  /** `k` is device pixels per world unit. */
  constructor(
    private readonly map: MapLayout,
    private readonly area: number,
    readonly k: number,
  ) {}

  /** Draws every chunk the rect touches (painting missing ones now), in world coordinates. */
  draw(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const c0 = Math.max(0, Math.floor(x0 / CHUNK));
    const r0 = Math.max(0, Math.floor(y0 / CHUNK));
    const c1 = Math.min(Math.ceil(this.map.width / CHUNK) - 1, Math.floor(x1 / CHUNK));
    const r1 = Math.min(Math.ceil(this.map.height / CHUNK) - 1, Math.floor(y1 / CHUNK));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) ctx.drawImage(this.chunk(c, r), c * CHUNK - BLEED, r * CHUNK - BLEED, CHUNK + BLEED * 2, CHUNK + BLEED * 2);
    }
    // Keep the view and the ring of chunks painted ahead around it.
    const keep = (c1 - c0 + 3) * (r1 - r0 + 3);
    while (this.chunks.size > keep) this.chunks.delete(this.chunks.keys().next().value!);
  }

  /** Paints at most one chunk from the ring just outside the rect, ahead of need. */
  prefetch(x0: number, y0: number, x1: number, y1: number): void {
    const cols = Math.ceil(this.map.width / CHUNK);
    const rows = Math.ceil(this.map.height / CHUNK);
    const c0 = Math.max(0, Math.floor(x0 / CHUNK) - 1);
    const r0 = Math.max(0, Math.floor(y0 / CHUNK) - 1);
    const c1 = Math.min(cols - 1, Math.floor(x1 / CHUNK) + 1);
    const r1 = Math.min(rows - 1, Math.floor(y1 / CHUNK) + 1);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!this.chunks.has(r * cols + c)) {
          this.chunk(c, r);
          return;
        }
      }
    }
  }

  private chunk(c: number, r: number): HTMLCanvasElement {
    const key = r * Math.ceil(this.map.width / CHUNK) + c;
    let canvas = this.chunks.get(key);
    if (canvas) {
      // Most recently used goes to the back of the eviction queue.
      this.chunks.delete(key);
    } else {
      canvas = this.paint(c, r);
    }
    this.chunks.set(key, canvas);
    return canvas;
  }

  private paint(c: number, r: number): HTMLCanvasElement {
    const span = CHUNK + BLEED * 2;
    const size = Math.max(1, Math.ceil(span * this.k));
    const canvas = createCanvas(size, size);
    const g = canvas.getContext('2d')!;
    const X0 = c * CHUNK - BLEED;
    const Y0 = r * CHUNK - BLEED;
    g.setTransform(size / span, 0, 0, size / span, -X0 * (size / span), -Y0 * (size / span));
    const st = AREA_STYLE[this.area] ?? AREA_STYLE[0];
    const box = { x0: X0, y0: Y0, x1: X0 + span, y1: Y0 + span };
    paintFloor(g, this.map, st, this.area, box);
    paintHazards(g, this.map, box);
    paintVents(g, this.map, st, box);
    paintStone(g, this.map, st, box);
    paintSconces(g, this.map, st, box);
    return canvas;
  }
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Calls `fn` for every lattice cell of size `cell` whose point could reach into the box. */
function eachCell(box: Box, cell: number, reach: number, fn: (i: number, j: number) => void): void {
  for (let j = Math.floor((box.y0 - reach) / cell); j <= Math.floor((box.y1 + reach) / cell); j++) {
    for (let i = Math.floor((box.x0 - reach) / cell); i <= Math.floor((box.x1 + reach) / cell); i++) fn(i, j);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function paintFloor(g: CanvasRenderingContext2D, map: MapLayout, st: AreaStyle, area: number, box: Box): void {
  const salt = area * 101;
  g.fillStyle = st.floor[1];
  g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);

  // Broad pools of light and shade so a big floor isn't flat.
  eachCell(box, 520, 560, (i, j) => {
    const x = (i + hash2(i, j, salt + 1)) * 520;
    const y = (j + hash2(i, j, salt + 2)) * 520;
    const r = 260 + hash2(i, j, salt + 3) * 300;
    const light = hash2(i, j, salt + 4) < 0.45;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, light ? hexA(st.floor[0], 0.55) : hexA(st.floor[2], 0.6));
    grad.addColorStop(1, light ? hexA(st.floor[0], 0) : hexA(st.floor[2], 0));
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  });

  if (st.soil) paintSoil(g, st, salt, box);
  else paintFlagstones(g, st, salt, box);

  // Moss (frost in the Catacombs), thickest against the stonework.
  eachCell(box, 180, 80, (i, j) => {
    const x = (i + hash2(i, j, salt + 10)) * 180;
    const y = (j + hash2(i, j, salt + 11)) * 180;
    const near = clearanceAt(map.index, x, y) < 120;
    if (hash2(i, j, salt + 12) > (near ? 0.7 : 0.25)) return;
    const r = 20 + hash2(i, j, salt + 13) * 55;
    const m = g.createRadialGradient(x, y, 0, x, y, r);
    m.addColorStop(0, `rgba(${st.moss},0.16)`);
    m.addColorStop(1, `rgba(${st.moss},0)`);
    g.fillStyle = m;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  });

  if (st.rime) paintFrost(g, st.rime, salt, box);
  if (st.threads) paintThreads(g, st, salt, box);

  // Glowing lava cracks in the Ember Depths.
  if (st.cracks) {
    eachCell(box, 240, 160, (i, j) => {
      if (hash2(i, j, salt + 14) > 0.3) return;
      const rng = mulberry32(Math.floor(hash2(i, j, salt + 15) * 1e9));
      let x = (i + rng()) * 240;
      let y = (j + rng()) * 240;
      const pts: Vec[] = [{ x, y }];
      let a = rng() * TAU;
      const steps = 5 + Math.floor(rng() * 5);
      for (let k = 0; k < steps; k++) {
        a += (rng() - 0.5) * 1.4;
        x += Math.cos(a) * (14 + rng() * 22);
        y += Math.sin(a) * (14 + rng() * 22);
        pts.push({ x, y });
      }
      for (const [width, alpha] of [
        [9, 0.12],
        [4, 0.35],
        [1.6, 0.9],
      ] as const) {
        g.strokeStyle = width < 2 ? 'rgba(255,220,150,0.9)' : `rgba(${st.cracks},${alpha})`;
        g.lineWidth = width;
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) g.lineTo(p.x, p.y);
        g.stroke();
      }
    });
  }

  for (const l of map.landmarks) if (Math.abs(l.x - (box.x0 + box.x1) / 2) < 1700 && Math.abs(l.y - (box.y0 + box.y1) / 2) < 1000) paintLandmark(g, l, st);

  // Rubble and glowing mushrooms (in the Hollows, some magenta) where the floor meets stone.
  eachCell(box, 44, 10, (i, j) => {
    const x = (i + hash2(i, j, salt + 16)) * 44;
    const y = (j + hash2(i, j, salt + 17)) * 44;
    const d = clearanceAt(map.index, x, y);
    if (d < 4 || d > 70) return;
    const h = hash2(i, j, salt + 18);
    if (h < 0.08 && d < 60) {
      const r = 2 + hash2(i, j, salt + 19) * 2.5;
      const glow = st.soil && h < 0.03 ? st.circle : st.glow;
      const m = g.createRadialGradient(x, y, 0, x, y, r * 4);
      m.addColorStop(0, `rgba(${glow},0.5)`);
      m.addColorStop(1, `rgba(${glow},0)`);
      g.fillStyle = m;
      g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      g.fillStyle = `rgba(${st.glowCore},0.8)`;
      g.beginPath();
      g.arc(x, y, r * 0.6, 0, TAU);
      g.fill();
    } else if (h < 0.55 && d < 40) {
      const r = 2 + hash2(i, j, salt + 20) * 6;
      const [rr, gg, bb] = st.rubble;
      g.fillStyle = `rgba(${rr + hash2(i, j, salt + 21) * 40},${gg + hash2(i, j, salt + 22) * 30},${bb + hash2(i, j, salt + 23) * 40},0.55)`;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.6 + h * 0.6), h * 9, 0, TAU);
      g.fill();
    }
  });

  // Pools of torch light along the walls: warm, fungal teal or cold blue.
  for (const t of map.torches) {
    if (t.x < box.x0 - 130 || t.x > box.x1 + 130 || t.y < box.y0 - 130 || t.y > box.y1 + 130) continue;
    const tg = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, 120);
    tg.addColorStop(0, `rgba(${st.torch},0.22)`);
    tg.addColorStop(1, `rgba(${st.torch},0)`);
    g.fillStyle = tg;
    g.fillRect(t.x - 120, t.y - 120, 240, 240);
  }
}

/** Worn flagstones in a running bond, with the odd crack; frosted along their edges in the Catacombs. */
function paintFlagstones(g: CanvasRenderingContext2D, st: AreaStyle, salt: number, box: Box): void {
  const tile = 76;
  for (let row = Math.floor((box.y0 - tile) / tile); row * tile < box.y1 + tile; row++) {
    const off = (row & 1) * (tile / 2);
    for (let col = Math.floor((box.x0 - off - tile) / tile); col * tile + off < box.x1 + tile; col++) {
      const tx = col * tile + off + (hash2(col, row, salt + 5) - 0.5) * 6;
      const ty = row * tile + (hash2(col, row, salt + 6) - 0.5) * 6;
      const shade = hash2(col, row, salt + 7);
      g.fillStyle = shade > 0.5 ? `rgba(${st.tileLight},${0.02 + shade * 0.035})` : `rgba(0,0,0,${0.05 + shade * 0.1})`;
      roundRect(g, tx + 3, ty + 3, tile - 6, tile - 6, 6);
      g.fill();
      g.strokeStyle = 'rgba(8,3,18,0.45)';
      g.lineWidth = 2;
      g.stroke();
      if (st.rime) {
        // Hoarfrost caught along the stone's upper and left edges.
        g.strokeStyle = `rgba(${st.rime},${0.05 + shade * 0.08})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(tx + 7, ty + tile - 10);
        g.lineTo(tx + 7, ty + 7);
        g.lineTo(tx + tile - 10, ty + 7);
        g.stroke();
      }
      if (hash2(col, row, salt + 8) < 0.18) {
        const rng = mulberry32(Math.floor(hash2(col, row, salt + 9) * 1e9));
        g.strokeStyle = 'rgba(6,2,14,0.55)';
        g.lineWidth = 1.2;
        g.beginPath();
        let cx = tx + rng() * tile;
        let cy = ty + rng() * tile;
        g.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) {
          cx += (rng() - 0.5) * 30;
          cy += (rng() - 0.5) * 30;
          g.lineTo(cx, cy);
        }
        g.stroke();
      }
    }
  }
}

/** Bare earth: clods of darker and lighter soil and scattered pebbles, no flagstones. */
function paintSoil(g: CanvasRenderingContext2D, st: AreaStyle, salt: number, box: Box): void {
  eachCell(box, 48, 32, (i, j) => {
    const h = hash2(i, j, salt + 30);
    if (h > 0.6) return;
    const x = (i + hash2(i, j, salt + 31)) * 48;
    const y = (j + hash2(i, j, salt + 32)) * 48;
    const r = 8 + hash2(i, j, salt + 33) * 22;
    g.fillStyle = h < 0.35 ? `rgba(0,0,0,${0.05 + h * 0.2})` : `rgba(${st.tileLight},${0.012 + (h - 0.35) * 0.08})`;
    g.beginPath();
    g.ellipse(x, y, r, r * (0.45 + hash2(i, j, salt + 34) * 0.4), h * 20, 0, TAU);
    g.fill();
  });
  const [rr, gg, bb] = st.rubble;
  eachCell(box, 26, 6, (i, j) => {
    const h = hash2(i, j, salt + 35);
    if (h > 0.14) return;
    const x = (i + hash2(i, j, salt + 36)) * 26;
    const y = (j + hash2(i, j, salt + 37)) * 26;
    const r = 1.5 + hash2(i, j, salt + 38) * 2.5;
    g.fillStyle = `rgba(${rr + 30},${gg + 30},${bb + 30},0.45)`;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.7, h * 40, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(x + 1, y + r * 0.6, r, r * 0.35, 0, 0, TAU);
    g.fill();
  });
}

/** Hoarfrost: pale blooms across the flagstones and a few glinting crystals. */
function paintFrost(g: CanvasRenderingContext2D, rime: string, salt: number, box: Box): void {
  eachCell(box, 150, 100, (i, j) => {
    if (hash2(i, j, salt + 50) > 0.45) return;
    const x = (i + hash2(i, j, salt + 51)) * 150;
    const y = (j + hash2(i, j, salt + 52)) * 150;
    const r = 30 + hash2(i, j, salt + 53) * 60;
    const f = g.createRadialGradient(x, y, 0, x, y, r);
    f.addColorStop(0, `rgba(${rime},0.1)`);
    f.addColorStop(1, `rgba(${rime},0)`);
    g.fillStyle = f;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  });
  g.strokeStyle = `rgba(${rime},0.35)`;
  g.lineWidth = 1;
  g.beginPath();
  eachCell(box, 40, 6, (i, j) => {
    if (hash2(i, j, salt + 54) > 0.07) return;
    const x = (i + hash2(i, j, salt + 55)) * 40;
    const y = (j + hash2(i, j, salt + 56)) * 40;
    const s = 2 + hash2(i, j, salt + 57) * 2.5;
    g.moveTo(x - s, y);
    g.lineTo(x + s, y);
    g.moveTo(x, y - s);
    g.lineTo(x, y + s);
  });
  g.stroke();
}

/** Pale threads of mycelium wandering out from knots in the earth, beaded with glowing tips. */
function paintThreads(g: CanvasRenderingContext2D, st: AreaStyle, salt: number, box: Box): void {
  const threads = st.threads!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  eachCell(box, 200, 200, (i, j) => {
    if (hash2(i, j, salt + 40) > 0.55) return;
    const rng = mulberry32(Math.floor(hash2(i, j, salt + 41) * 1e9));
    const x0 = (i + rng()) * 200;
    const y0 = (j + rng()) * 200;
    const knot = g.createRadialGradient(x0, y0, 0, x0, y0, 22);
    knot.addColorStop(0, `rgba(${st.glow},0.12)`);
    knot.addColorStop(1, `rgba(${st.glow},0)`);
    g.fillStyle = knot;
    g.fillRect(x0 - 22, y0 - 22, 44, 44);
    const n = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < n; b++) {
      let a = rng() * TAU;
      let x = x0;
      let y = y0;
      g.strokeStyle = `rgba(${threads},${0.07 + rng() * 0.08})`;
      g.lineWidth = 1 + rng();
      g.beginPath();
      g.moveTo(x, y);
      const steps = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < steps; k++) {
        a += (rng() - 0.5) * 0.9;
        x += Math.cos(a) * (12 + rng() * 14);
        y += Math.sin(a) * (12 + rng() * 14);
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = `rgba(${st.glowCore},0.4)`;
      g.beginPath();
      g.arc(x, y, 1.6, 0, TAU);
      g.fill();
    }
  });
  g.lineCap = 'butt';
}

/** A small bone lying on the floor: a shaft with knobbed ends. */
function paintBone(g: CanvasRenderingContext2D, x: number, y: number, len: number, a: number, alpha: number): void {
  const dx = (Math.cos(a) * len) / 2;
  const dy = (Math.sin(a) * len) / 2;
  const px = -Math.sin(a) * 1.8;
  const py = Math.cos(a) * 1.8;
  g.strokeStyle = `rgba(226,220,200,${alpha})`;
  g.fillStyle = `rgba(226,220,200,${alpha})`;
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(x - dx, y - dy);
  g.lineTo(x + dx, y + dy);
  g.stroke();
  g.beginPath();
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) {
      const kx = x + dx * e + px * s;
      const ky = y + dy * e + py * s;
      g.moveTo(kx + 2.2, ky);
      g.arc(kx, ky, 2.2, 0, TAU);
    }
  }
  g.fill();
}

/** A skull on the floor, seen from above: the dome, two dark sockets and the jaw. */
function paintSkull(g: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, alpha: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = `rgba(226,220,200,${alpha})`;
  g.beginPath();
  g.ellipse(0, 0, r, r * 0.85, 0, 0, TAU);
  g.fill();
  g.fillRect(r * 0.55, -r * 0.45, r * 0.55, r * 0.9);
  g.fillStyle = `rgba(10,14,24,${alpha})`;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(r * 0.35, s * r * 0.35, r * 0.24, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Floor decoration for each landmark: the plaza's summoning circle, the colonnade's paving. */
function paintLandmark(g: CanvasRenderingContext2D, l: Landmark, st: AreaStyle): void {
  if (l.kind === 'plaza') {
    g.save();
    g.translate(l.x, l.y);
    g.strokeStyle = `rgba(${st.circle},0.16)`;
    g.lineWidth = 3;
    for (const r of [210, 190, 120]) {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const b = ((i + 2) / 6) * TAU - Math.PI / 2;
      g.moveTo(Math.cos(a) * 190, Math.sin(a) * 190);
      g.lineTo(Math.cos(b) * 190, Math.sin(b) * 190);
    }
    g.stroke();
    g.fillStyle = `rgba(${st.runes},0.2)`;
    g.font = `20px ${TITLE_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 24; i++) {
      g.save();
      g.rotate((i / 24) * TAU);
      g.fillText(runes[i % runes.length], 0, -200);
      g.restore();
    }
    g.restore();
  } else if (l.kind === 'colonnade') {
    // A paved processional way down the middle of the avenue.
    g.fillStyle = `rgba(${st.tileLight},0.035)`;
    g.fillRect(l.x - 1500, l.y - 110, 3000, 220);
    g.strokeStyle = `rgba(${st.circle},0.12)`;
    g.lineWidth = 3;
    g.strokeRect(l.x - 1500, l.y - 110, 3000, 220);
  } else if (l.kind === 'caldera') {
    // A scorched ring of fire-runes round the arrival.
    g.save();
    g.translate(l.x, l.y);
    const sc = g.createRadialGradient(0, 0, 60, 0, 0, 420);
    sc.addColorStop(0, 'rgba(0,0,0,0.25)');
    sc.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sc;
    g.fillRect(-420, -420, 840, 840);
    g.strokeStyle = `rgba(${st.circle},0.18)`;
    g.lineWidth = 3;
    for (const r of [240, 220]) {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    g.fillStyle = `rgba(${st.runes},0.22)`;
    g.font = `20px ${TITLE_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ';
    for (let i = 0; i < 16; i++) {
      g.save();
      g.rotate((i / 16) * TAU);
      g.fillText(runes[i], 0, -230);
      g.restore();
    }
    g.restore();
  } else if (l.kind === 'forge') {
    // Iron floor plates inside the Forge's walls.
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(l.x - 500, l.y - 500, 1000, 1000);
    g.strokeStyle = 'rgba(150,120,110,0.12)';
    g.lineWidth = 2;
    for (let i = -500; i <= 500; i += 125) {
      g.beginPath();
      g.moveTo(l.x + i, l.y - 500);
      g.lineTo(l.x + i, l.y + 500);
      g.moveTo(l.x - 500, l.y + i);
      g.lineTo(l.x + 500, l.y + i);
      g.stroke();
    }
  } else if (l.kind === 'hall') {
    // The hall's old floor: darker, with a faded mosaic ring.
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(l.x - 500, l.y - 500, 1000, 1000);
    g.strokeStyle = `rgba(${st.circle},0.1)`;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(l.x, l.y, 150, 0, TAU);
    g.stroke();
  } else if (l.kind === 'glowring') {
    // A fairy ring of tiny glowing mushrooms round the arrival, and a band of mycelium joining the eight stalks.
    g.save();
    g.translate(l.x, l.y);
    g.strokeStyle = `rgba(${st.threads ?? st.glow},0.06)`;
    g.lineWidth = 28;
    g.beginPath();
    g.arc(0, 0, 760, 0, TAU);
    g.stroke();
    g.strokeStyle = `rgba(${st.circle},0.13)`;
    g.lineWidth = 3;
    for (const r of [252, 226]) {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    const rng = mulberry32(4242);
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU + (rng() - 0.5) * 0.08;
      const r = 239 + (rng() - 0.5) * 16;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const s = 3 + rng() * 3;
      const color = i % 3 === 0 ? st.circle : st.glow;
      const glow = g.createRadialGradient(x, y, 0, x, y, s * 4);
      glow.addColorStop(0, `rgba(${color},0.35)`);
      glow.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = glow;
      g.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
      g.fillStyle = `rgba(${st.glowCore},0.75)`;
      g.beginPath();
      g.arc(x, y, s * 0.6, 0, TAU);
      g.fill();
    }
    g.restore();
  } else if (l.kind === 'heartroot') {
    // Darker earth round the great trunk, veined with roots that glow faintly teal and magenta.
    g.save();
    g.translate(l.x, l.y);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, 600);
    sh.addColorStop(0, 'rgba(0,0,0,0.28)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(-600, -600, 1200, 1200);
    const glow = g.createRadialGradient(0, 0, 100, 0, 0, 420);
    glow.addColorStop(0, `rgba(${st.circle},0.1)`);
    glow.addColorStop(1, `rgba(${st.circle},0)`);
    g.fillStyle = glow;
    g.fillRect(-420, -420, 840, 840);
    const rng = mulberry32(5150);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < 16; i++) {
      let a = (i / 16) * TAU + rng() * 0.3;
      let x = Math.cos(a) * 115;
      let y = Math.sin(a) * 115;
      g.strokeStyle = `rgba(${i % 2 === 0 ? st.circle : st.glow},0.12)`;
      g.lineWidth = 2 + rng() * 2;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        a += (rng() - 0.5) * 0.6;
        x += Math.cos(a) * (30 + rng() * 20);
        y += Math.sin(a) * (30 + rng() * 20);
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
    g.restore();
  } else if (l.kind === 'fallen') {
    // Where the giant fell: a scuffed hollow, and spores spilled from its gills.
    g.save();
    g.translate(l.x, l.y);
    const sh = g.createRadialGradient(0, 0, 60, 0, 0, 440);
    sh.addColorStop(0, 'rgba(0,0,0,0.24)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sh;
    g.fillRect(-440, -440, 880, 880);
    const rng = mulberry32(2121);
    for (let i = 0; i < 80; i++) {
      const a = rng() * TAU;
      const d = 170 + Math.pow(rng(), 0.7) * 330;
      g.fillStyle = `rgba(${i % 4 === 0 ? st.glow : st.circle},${0.18 + rng() * 0.3})`;
      g.beginPath();
      g.arc(Math.cos(a) * d, Math.sin(a) * d, 1.5 + rng() * 2, 0, TAU);
      g.fill();
    }
    g.restore();
  } else if (l.kind === 'thicket') {
    // Trampled dark earth strewn with broken thorny canes.
    g.save();
    g.translate(l.x, l.y);
    const sh = g.createRadialGradient(0, 0, 0, 0, 0, 540);
    sh.addColorStop(0, 'rgba(20,0,16,0.26)');
    sh.addColorStop(1, 'rgba(20,0,16,0)');
    g.fillStyle = sh;
    g.fillRect(-540, -540, 1080, 1080);
    const rng = mulberry32(7070);
    g.lineCap = 'round';
    for (let i = 0; i < 30; i++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng()) * 480;
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      const b = rng() * TAU;
      const len = 20 + rng() * 22;
      const ux = Math.cos(b);
      const uy = Math.sin(b);
      g.strokeStyle = 'rgba(70,24,60,0.6)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x - ux * len * 0.5, y - uy * len * 0.5);
      g.lineTo(x + ux * len * 0.5, y + uy * len * 0.5);
      g.stroke();
      g.strokeStyle = 'rgba(220,110,200,0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (const t of [-0.3, 0, 0.3]) {
        const s = t === 0 ? -1 : 1;
        const cx = x + ux * len * t;
        const cy = y + uy * len * t;
        g.moveTo(cx, cy);
        g.lineTo(cx - uy * 5 * s + ux * 3, cy + ux * 5 * s + uy * 3);
      }
      g.stroke();
    }
    g.lineCap = 'butt';
    g.restore();
  } else if (l.kind === 'grotto') {
    // A spore-thick haze inside the root walls, the floor dusted with spores.
    g.save();
    g.translate(l.x, l.y);
    g.scale(1, 0.5);
    const haze = g.createRadialGradient(0, 0, 0, 0, 0, 600);
    haze.addColorStop(0, `rgba(${st.circle},0.12)`);
    haze.addColorStop(0.6, `rgba(${st.glow},0.05)`);
    haze.addColorStop(1, `rgba(${st.glow},0)`);
    g.fillStyle = haze;
    g.fillRect(-600, -600, 1200, 1200);
    g.restore();
    const rng = mulberry32(5555);
    for (let i = 0; i < 110; i++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng());
      g.fillStyle = `rgba(${i % 3 === 0 ? st.glow : st.circle},${0.18 + rng() * 0.28})`;
      g.beginPath();
      g.arc(l.x + Math.cos(a) * d * 560, l.y + Math.sin(a) * d * 260, 1 + rng() * 1.8, 0, TAU);
      g.fill();
    }
  } else if (l.kind === 'bellcourt') {
    // A great bell set in the floor, seen from above: lip, sound-bow and crown, split by a crack.
    g.save();
    g.translate(l.x, l.y);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.arc(0, 0, 232, 0, TAU);
    g.fill();
    g.strokeStyle = `rgba(${st.circle},0.22)`;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(0, 0, 222, 0, TAU);
    g.stroke();
    g.strokeStyle = `rgba(${st.circle},0.15)`;
    g.lineWidth = 3;
    for (const r of [196, 150]) {
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    g.strokeStyle = `rgba(${st.circle},0.2)`;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(0, 0, 70, 0, TAU);
    g.stroke();
    g.fillStyle = `rgba(${st.circle},0.12)`;
    g.beginPath();
    g.arc(0, 0, 26, 0, TAU);
    g.fill();
    // The crack, dark with a frosted edge.
    const crack: [number, number][] = [
      [-40, -236],
      [-22, -170],
      [-48, -110],
      [-12, -40],
      [-30, 30],
      [14, 90],
      [-4, 150],
      [30, 212],
    ];
    for (const [w, c, o] of [
      [3.5, 'rgba(4,8,18,0.6)', 0],
      [1.2, `rgba(${st.rime ?? st.circle},0.3)`, 1.5],
    ] as const) {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      crack.forEach(([x, y], i) => (i === 0 ? g.moveTo(x + o, y) : g.lineTo(x + o, y)));
      g.stroke();
    }
    g.fillStyle = `rgba(${st.runes},0.2)`;
    g.font = `20px ${TITLE_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗ';
    for (let i = 0; i < 20; i++) {
      g.save();
      g.rotate((i / 20) * TAU);
      g.fillText(runes[i], 0, -262);
      g.restore();
    }
    g.restore();
  } else if (l.kind === 'ossuary') {
    // The Ossuary's floor: darker, strewn with old bones and skulls.
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(l.x - 1000, l.y - 300, 2000, 600);
    const rng = mulberry32(9191);
    for (let i = 0; i < 80; i++) {
      // Most lie toward the walls.
      const u = rng() < 0.5 ? (rng() < 0.5 ? -1 : 1) * (0.7 + rng() * 0.3) : rng() * 2 - 1;
      const x = l.x + u * 960;
      const y = l.y + (rng() - 0.5) * 560;
      const a = rng() * TAU;
      const alpha = 0.3 + rng() * 0.25;
      if (rng() < 0.15) paintSkull(g, x, y, 6 + rng() * 2, a, alpha);
      else paintBone(g, x, y, 10 + rng() * 12, a, alpha);
    }
  } else if (l.kind === 'kings') {
    // A processional way down the Crypt of Kings under the row of sarcophagi, a crown at each end.
    g.fillStyle = 'rgba(6,12,28,0.35)';
    g.fillRect(l.x - 900, l.y - 130, 1800, 260);
    g.strokeStyle = `rgba(${st.circle},0.18)`;
    g.lineWidth = 3;
    g.strokeRect(l.x - 900, l.y - 130, 1800, 260);
    g.strokeStyle = `rgba(${st.circle},0.1)`;
    g.lineWidth = 1.5;
    g.strokeRect(l.x - 886, l.y - 116, 1772, 232);
    g.strokeStyle = `rgba(${st.runes},0.25)`;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    for (const cx of [l.x - 830, l.x + 830]) {
      g.beginPath();
      g.moveTo(cx - 22, l.y + 14);
      g.lineTo(cx - 22, l.y - 14);
      g.lineTo(cx - 11, l.y);
      g.lineTo(cx, l.y - 18);
      g.lineTo(cx + 11, l.y);
      g.lineTo(cx + 22, l.y - 14);
      g.lineTo(cx + 22, l.y + 14);
      g.closePath();
      g.stroke();
    }
  } else if (l.kind === 'lake') {
    // Snow drifted along the Frozen Lake's shore.
    const rime = st.rime ?? st.circle;
    const snow = g.createRadialGradient(l.x, l.y, 200, l.x, l.y, 760);
    snow.addColorStop(0, `rgba(${rime},0.14)`);
    snow.addColorStop(1, `rgba(${rime},0)`);
    g.fillStyle = snow;
    g.fillRect(l.x - 760, l.y - 760, 1520, 1520);
    const rng = mulberry32(3131);
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU;
      const d = 300 + rng() * 420;
      const r = 30 + rng() * 50;
      const alpha = 0.08 + rng() * 0.08;
      g.save();
      g.translate(l.x + Math.cos(a) * d, l.y + Math.sin(a) * d);
      g.rotate(a + Math.PI / 2);
      g.scale(1, 0.45);
      const drift = g.createRadialGradient(0, 0, 0, 0, 0, r);
      drift.addColorStop(0, `rgba(${rime},${alpha})`);
      drift.addColorStop(1, `rgba(${rime},0)`);
      g.fillStyle = drift;
      g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
  }
}

export function solidPath(g: CanvasRenderingContext2D, s: AnyShape, dx = 0, dy = 0, grow = 0): void {
  g.beginPath();
  addShape(g, s, dx, dy, grow);
}

/** Adds a shape's outline (grown by `grow`) to the current path, so several can be filled or clipped as one. */
export function addShape(g: CanvasRenderingContext2D, s: AnyShape, dx = 0, dy = 0, grow = 0): void {
  if (s.shape === 'circle') {
    g.moveTo(s.x + dx + s.r + grow, s.y + dy);
    g.arc(s.x + dx, s.y + dy, s.r + grow, 0, TAU);
  } else if (s.shape === 'rect') g.rect(s.x0 + dx - grow, s.y0 + dy - grow, s.x1 - s.x0 + grow * 2, s.y1 - s.y0 + grow * 2);
  else {
    const a = Math.atan2(s.by - s.ay, s.bx - s.ax);
    const r = s.r + grow;
    g.moveTo(s.ax + dx + Math.cos(a + Math.PI / 2) * r, s.ay + dy + Math.sin(a + Math.PI / 2) * r);
    g.arc(s.ax + dx, s.ay + dy, r, a + Math.PI / 2, a - Math.PI / 2);
    g.arc(s.bx + dx, s.by + dy, r, a - Math.PI / 2, a + Math.PI / 2);
    g.closePath();
  }
}

/**
 * Adds a shape's outline grown by `grow` plus a ragged, outward-only wobble of up to `ragged`
 * (keyed to world position, so neighbouring chunks agree), with rounded corners on rects.
 */
function addRaggedShape(g: CanvasRenderingContext2D, s: AnyShape, grow: number, ragged: number): void {
  if (s.shape === 'capsule') {
    addShape(g, s, 0, 0, grow + ragged / 2);
    return;
  }
  const step = 12;
  const bump = (x: number, y: number) => grow + ragged * hash2(Math.round(x / step), Math.round(y / step), 991);
  const pts: Vec[] = [];
  if (s.shape === 'circle') {
    const n = Math.max(12, Math.ceil((TAU * s.r) / step));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const d = s.r + bump(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r);
      pts.push({ x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d });
    }
  } else {
    const edges = [
      { ax: s.x0, ay: s.y0, bx: s.x1, by: s.y0, a: -Math.PI / 2 },
      { ax: s.x1, ay: s.y0, bx: s.x1, by: s.y1, a: 0 },
      { ax: s.x1, ay: s.y1, bx: s.x0, by: s.y1, a: Math.PI / 2 },
      { ax: s.x0, ay: s.y1, bx: s.x0, by: s.y0, a: Math.PI },
    ];
    for (const e of edges) {
      const n = Math.max(1, Math.round(Math.hypot(e.bx - e.ax, e.by - e.ay) / step));
      for (let i = 1; i < n; i++) {
        const px = e.ax + ((e.bx - e.ax) * i) / n;
        const py = e.ay + ((e.by - e.ay) * i) / n;
        const d = bump(px, py);
        pts.push({ x: px + Math.cos(e.a) * d, y: py + Math.sin(e.a) * d });
      }
      // Round the corner at the edge's end.
      const d = bump(e.bx, e.by);
      for (const t of [0, 0.5, 1]) {
        const a = e.a + (t * Math.PI) / 2;
        pts.push({ x: e.bx + Math.cos(a) * d, y: e.by + Math.sin(a) * d });
      }
    }
  }
  g.moveTo(pts[0].x, pts[0].y);
  for (const p of pts) g.lineTo(p.x, p.y);
  g.closePath();
}

/**
 * Fills a set of shapes in layers, outermost first: each layer's colour and how far it grows
 * past the shapes; `ragged` gives the edges an outward wobble (brambles).
 */
function fillLayers(g: CanvasRenderingContext2D, list: AnyShape[], layers: [string, number][], ragged = 0): void {
  for (const [color, grow] of layers) {
    g.fillStyle = color;
    g.beginPath();
    for (const s of list) {
      if (ragged > 0) addRaggedShape(g, s, grow, ragged);
      else addShape(g, s, 0, 0, grow);
    }
    g.fill();
  }
}

/** Clips to the union of the shapes (call inside save/restore). */
function clipShapes(g: CanvasRenderingContext2D, list: AnyShape[], ragged = 0): void {
  g.beginPath();
  for (const s of list) {
    if (ragged > 0) addRaggedShape(g, s, 0, ragged);
    else addShape(g, s);
  }
  g.clip();
}

/** The map's hazard ground near the box, by kind: lava, ice sheets and brambles. */
function paintHazards(g: CanvasRenderingContext2D, map: MapLayout, box: Box): void {
  const near = map.hazards.filter((s) => {
    const b = solidBounds(s);
    return b.x1 > box.x0 - 30 && b.x0 < box.x1 + 30 && b.y1 > box.y0 - 30 && b.y0 < box.y1 + 30;
  });
  if (near.length === 0) return;
  const lava = near.filter((h) => h.name === 'lava');
  const ice = near.filter((h) => h.name === 'ice');
  const bramble = near.filter((h) => h.name === 'bramble');
  if (lava.length) paintLava(g, lava, box);
  if (ice.length) paintIce(g, ice, box);
  if (bramble.length) paintBrambles(g, bramble, map, box);
}

/** Lava: a dark crust at the shore, molten rock with cooling plates. Its shimmer is drawn live. */
function paintLava(g: CanvasRenderingContext2D, near: Hazard[], box: Box): void {
  fillLayers(g, near, [
    ['#1a0604', 9],
    ['#5a1608', 4],
    ['#c8381a', 0],
  ]);
  g.save();
  clipShapes(g, near);
  // Hot seams and dark plates of cooling crust.
  eachCell(box, 60, 40, (i, j) => {
    const x = (i + hash2(i, j, 901)) * 60;
    const y = (j + hash2(i, j, 902)) * 60;
    const h = hash2(i, j, 903);
    if (h < 0.45) {
      const r = 10 + hash2(i, j, 904) * 22;
      g.fillStyle = 'rgba(70,16,6,0.55)';
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, h * 9, 0, TAU);
      g.fill();
    } else if (h < 0.75) {
      const r = 14 + hash2(i, j, 905) * 26;
      const hot = g.createRadialGradient(x, y, 0, x, y, r);
      hot.addColorStop(0, 'rgba(255,200,110,0.65)');
      hot.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = hot;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  g.restore();
}

/**
 * Ice sheets: a dark edge and a bright rim all round so the sheet is seen coming, a pale sheet
 * crazed with cracks and streaked with frost (a pattern that reads in greyscale). Its moving
 * sheen is drawn live.
 */
function paintIce(g: CanvasRenderingContext2D, near: Hazard[], box: Box): void {
  fillLayers(g, near, [
    ['#0c1626', 8],
    ['#f0faff', 4],
    ['#9ccbea', 0],
  ]);
  g.save();
  clipShapes(g, near);
  // Broad light and shade under the surface.
  eachCell(box, 160, 120, (i, j) => {
    const x = (i + hash2(i, j, 931)) * 160;
    const y = (j + hash2(i, j, 932)) * 160;
    const r = 50 + hash2(i, j, 933) * 70;
    const light = hash2(i, j, 934) < 0.5;
    const s = g.createRadialGradient(x, y, 0, x, y, r);
    s.addColorStop(0, light ? 'rgba(225,245,255,0.35)' : 'rgba(70,120,170,0.25)');
    s.addColorStop(1, light ? 'rgba(225,245,255,0)' : 'rgba(70,120,170,0)');
    g.fillStyle = s;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  });
  // Frost streaks, all at one slant like wind-scoured ice.
  g.strokeStyle = 'rgba(255,255,255,0.4)';
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  eachCell(box, 64, 30, (i, j) => {
    if (hash2(i, j, 935) > 0.45) return;
    const x = (i + hash2(i, j, 936)) * 64;
    const y = (j + hash2(i, j, 937)) * 64;
    const len = 8 + hash2(i, j, 938) * 14;
    g.moveTo(x - len, y + len * 0.6);
    g.lineTo(x + len, y - len * 0.6);
  });
  g.stroke();
  g.lineCap = 'butt';
  // Cracks: dark hairlines with a bright lip.
  eachCell(box, 96, 110, (i, j) => {
    if (hash2(i, j, 939) > 0.5) return;
    const rng = mulberry32(Math.floor(hash2(i, j, 940) * 1e9));
    let x = (i + rng()) * 96;
    let y = (j + rng()) * 96;
    const pts: Vec[] = [{ x, y }];
    let a = rng() * TAU;
    for (let k = 0; k < 4; k++) {
      a += (rng() - 0.5) * 1.6;
      x += Math.cos(a) * (10 + rng() * 16);
      y += Math.sin(a) * (10 + rng() * 16);
      pts.push({ x, y });
    }
    for (const [color, width, o] of [
      ['rgba(20,50,90,0.5)', 1.6, 0],
      ['rgba(255,255,255,0.45)', 1, 1.2],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      pts.forEach((p, n) => (n === 0 ? g.moveTo(p.x + o, p.y + o) : g.lineTo(p.x + o, p.y + o)));
      g.stroke();
    }
  });
  g.restore();
}

/**
 * Brambles: a tangle of thorny purple canes over dark ground, ringed by a bright magenta edge
 * with thorns poking out of it, so the patch reads by outline and pattern, not just colour.
 */
function paintBrambles(g: CanvasRenderingContext2D, near: Hazard[], map: MapLayout, box: Box): void {
  const ragged = 8;
  fillLayers(
    g,
    near,
    [
      ['#0a0308', 9],
      ['#c04aa8', 5],
      ['#240a22', 0],
    ],
    ragged,
  );
  g.save();
  clipShapes(g, near, ragged);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  eachCell(box, 34, 100, (i, j) => {
    const rng = mulberry32(Math.floor(hash2(i, j, 951) * 1e9));
    let x = (i + rng()) * 34;
    let y = (j + rng()) * 34;
    let a = rng() * TAU;
    const pts: Vec[] = [{ x, y }];
    for (let k = 0; k < 4; k++) {
      a += (rng() - 0.5) * 1.2;
      x += Math.cos(a) * (12 + rng() * 10);
      y += Math.sin(a) * (12 + rng() * 10);
      pts.push({ x, y });
    }
    for (const [color, width] of [
      ['#0c030b', 5],
      ['#6e2a66', 2.6],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      pts.forEach((p, n) => (n === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke();
    }
    // Pale thorns along the cane, alternating sides.
    g.fillStyle = '#f08ae0';
    g.beginPath();
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1];
      const q = pts[k];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const ux = (q.x - p.x) / len;
      const uy = (q.y - p.y) / len;
      const s = k % 2 === 0 ? 1 : -1;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      g.moveTo(mx - ux * 2.5, my - uy * 2.5);
      g.lineTo(mx + ux * 2.5, my + uy * 2.5);
      g.lineTo(mx - uy * 6 * s + ux * 2, my + ux * 6 * s + uy * 2);
      g.closePath();
    }
    g.fill();
  });
  g.lineCap = 'butt';
  g.restore();
  // Thorns poking out of the edge, wherever it faces open ground.
  const zone = map.zones.bramble;
  g.fillStyle = '#c04aa8';
  g.strokeStyle = '#0a0308';
  g.lineWidth = 1.5;
  g.beginPath();
  const thorn = (x: number, y: number, nx: number, ny: number) => {
    if (x < box.x0 - 30 || x > box.x1 + 30 || y < box.y0 - 30 || y > box.y1 + 30) return;
    if (zone && clearanceAt(zone, x + nx * 12, y + ny * 12) <= 0) return;
    const reach = 8 + 6 * hash2(Math.round(x), Math.round(y), 992);
    const bx = x + nx * reach;
    const by = y + ny * reach;
    g.moveTo(bx - ny * 5, by + nx * 5);
    g.lineTo(x + nx * (reach + 12) - ny * 2, y + ny * (reach + 12) + nx * 2);
    g.lineTo(bx + ny * 5, by - nx * 5);
    g.closePath();
  };
  for (const s of near) {
    if (s.shape === 'circle') {
      const n = Math.ceil((TAU * s.r) / 26);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + s.x * 0.01;
        thorn(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r, Math.cos(a), Math.sin(a));
      }
    } else if (s.shape === 'rect') {
      for (let x = s.x0 + 13; x < s.x1; x += 26) {
        thorn(x, s.y0, 0, -1);
        thorn(x, s.y1, 0, 1);
      }
      for (let y = s.y0 + 13; y < s.y1; y += 26) {
        thorn(s.x0, y, -1, 0);
        thorn(s.x1, y, 1, 0);
      }
    }
  }
  g.fill();
  g.stroke();
}

/** Each map's vents: blackened craters with a glowing throat, fungal pores, or where icicles keep falling. */
function paintVents(g: CanvasRenderingContext2D, map: MapLayout, st: AreaStyle, box: Box): void {
  const look = map.def.vent;
  for (const v of map.vents) {
    if (v.x < box.x0 - 80 || v.x > box.x1 + 80 || v.y < box.y0 - 80 || v.y > box.y1 + 80) continue;
    if (look === 'spores') {
      paintSporeVent(g, v, st);
      continue;
    }
    if (look === 'icicle') {
      paintIcicleScar(g, v, st);
      continue;
    }
    const sc = g.createRadialGradient(v.x, v.y, 10, v.x, v.y, 70);
    sc.addColorStop(0, 'rgba(0,0,0,0.5)');
    sc.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sc;
    g.fillRect(v.x - 70, v.y - 70, 140, 140);
    g.fillStyle = '#3a1a12';
    g.beginPath();
    g.arc(v.x, v.y, 30, 0, TAU);
    g.fill();
    g.strokeStyle = '#6e3524';
    g.lineWidth = 3;
    g.stroke();
    const throat = g.createRadialGradient(v.x, v.y, 0, v.x, v.y, 18);
    throat.addColorStop(0, '#ffb35c');
    throat.addColorStop(0.6, '#d8461c');
    throat.addColorStop(1, '#1a0604');
    g.fillStyle = throat;
    g.beginPath();
    g.arc(v.x, v.y, 18, 0, TAU);
    g.fill();
  }
}

/** A spore vent: a ring of puffballs round a dark pore that glows teal deep down. */
function paintSporeVent(g: CanvasRenderingContext2D, v: Vec, st: AreaStyle): void {
  const sc = g.createRadialGradient(v.x, v.y, 10, v.x, v.y, 72);
  sc.addColorStop(0, 'rgba(0,0,0,0.5)');
  sc.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sc;
  g.fillRect(v.x - 72, v.y - 72, 144, 144);
  g.strokeStyle = `rgba(${st.threads ?? st.glow},0.22)`;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(v.x, v.y, 42, 0, TAU);
  g.stroke();
  const rng = mulberry32(Math.round(v.x * 3 + v.y));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rng() * 0.4;
    const d = 30 + rng() * 6;
    const r = 6 + rng() * 4;
    const x = v.x + Math.cos(a) * d;
    const y = v.y + Math.sin(a) * d;
    const puff = g.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
    puff.addColorStop(0, '#f2cce8');
    puff.addColorStop(1, '#8a3a80');
    g.fillStyle = puff;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    g.strokeStyle = '#1a0818';
    g.lineWidth = 1.5;
    g.stroke();
  }
  const throat = g.createRadialGradient(v.x, v.y, 0, v.x, v.y, 20);
  throat.addColorStop(0, '#c8fff2');
  throat.addColorStop(0.5, '#2fa890');
  throat.addColorStop(1, '#04100e');
  g.fillStyle = throat;
  g.beginPath();
  g.arc(v.x, v.y, 20, 0, TAU);
  g.fill();
}

/** Under a cluster of ceiling icicles: a frosted patch, a star of cracks and shards from old falls. */
function paintIcicleScar(g: CanvasRenderingContext2D, v: Vec, st: AreaStyle): void {
  const rime = st.rime ?? st.circle;
  const fr = g.createRadialGradient(v.x, v.y, 0, v.x, v.y, 70);
  fr.addColorStop(0, `rgba(${rime},0.24)`);
  fr.addColorStop(1, `rgba(${rime},0)`);
  g.fillStyle = fr;
  g.fillRect(v.x - 70, v.y - 70, 140, 140);
  const rng = mulberry32(Math.round(v.x * 3 + v.y));
  const cracks: Vec[][] = [];
  for (let i = 0; i < 7; i++) {
    let a = (i / 7) * TAU + rng() * 0.5;
    let x = v.x;
    let y = v.y;
    const pts: Vec[] = [{ x, y }];
    const steps = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < steps; k++) {
      a += (rng() - 0.5) * 0.7;
      x += Math.cos(a) * (12 + rng() * 10);
      y += Math.sin(a) * (12 + rng() * 10);
      pts.push({ x, y });
    }
    cracks.push(pts);
  }
  for (const [color, width, o] of [
    ['rgba(6,12,28,0.6)', 2, 0],
    [`rgba(${rime},0.5)`, 1, 1.2],
  ] as const) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    for (const pts of cracks) pts.forEach((p, n) => (n === 0 ? g.moveTo(p.x + o, p.y + o) : g.lineTo(p.x + o, p.y + o)));
    g.stroke();
  }
  // Shards lying about.
  g.fillStyle = '#d8f0ff';
  g.strokeStyle = '#2a4060';
  g.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const a = rng() * TAU;
    const d = 18 + rng() * 36;
    const x = v.x + Math.cos(a) * d;
    const y = v.y + Math.sin(a) * d;
    const b = rng() * TAU;
    const len = 5 + rng() * 6;
    g.beginPath();
    g.moveTo(x + Math.cos(b) * len, y + Math.sin(b) * len);
    g.lineTo(x - Math.sin(b) * 2, y + Math.cos(b) * 2);
    g.lineTo(x - Math.cos(b) * len * 0.6, y - Math.sin(b) * len * 0.6);
    g.lineTo(x + Math.sin(b) * 2, y - Math.cos(b) * 2);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.fillStyle = '#16243a';
  g.beginPath();
  g.arc(v.x, v.y, 7, 0, TAU);
  g.fill();
}

/** Walls, pillars, toppled columns and statues, with soft shadows cast down and to the right. */
function paintStone(g: CanvasRenderingContext2D, map: MapLayout, st: AreaStyle, box: Box): void {
  const near = map.solids.filter((s) => {
    const b = solidBounds(s);
    // Wide enough for the glow some of them cast round themselves.
    return b.x1 > box.x0 - 90 && b.x0 < box.x1 + 90 && b.y1 > box.y0 - 90 && b.y0 < box.y1 + 90;
  });
  if (near.length === 0) return;
  for (const [dx, dy, a] of [
    [8, 11, 0.22],
    [4, 6, 0.25],
  ] as const) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    for (const s of near) {
      solidPath(g, s, dx, dy);
      g.fill();
    }
  }

  // Walls: dark tops in the area's masonry (brick, roots or crypt stone), rims only on faces that meet open floor.
  const walls = near.filter((s) => s.name === 'wall' && s.shape === 'rect') as Extract<Solid, { shape: 'rect' }>[];
  for (const w of walls) {
    g.fillStyle = st.wall;
    g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
  }
  if (walls.length) {
    g.save();
    g.beginPath();
    for (const w of walls) g.rect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
    g.clip();
    if (st.walls === 'roots') paintRootWall(g, st, box);
    else if (st.walls === 'crypt') paintCryptWall(g, st, box);
    else {
      g.strokeStyle = `rgba(${st.brick},0.3)`;
      g.lineWidth = 1.5;
      const course = 19;
      for (let y = Math.floor(box.y0 / course) * course; y < box.y1; y += course) {
        g.beginPath();
        g.moveTo(box.x0, y);
        g.lineTo(box.x1, y);
        const shift = (Math.round(y / course) & 1) * 19;
        for (let x = Math.floor(box.x0 / 38) * 38 + shift; x < box.x1; x += 38) {
          g.moveTo(x, y);
          g.lineTo(x, y + course);
        }
        g.stroke();
      }
    }
    g.restore();
    g.lineCap = 'round';
    g.beginPath();
    for (const w of walls) {
      const edges: [number, number, number, number, number, number][] = [
        [w.x0, w.y0, w.x1, w.y0, 0, -3],
        [w.x0, w.y1, w.x1, w.y1, 0, 3],
        [w.x0, w.y0, w.x0, w.y1, -3, 0],
        [w.x1, w.y0, w.x1, w.y1, 3, 0],
      ];
      for (const [ax, ay, bx, by, ox, oy] of edges) {
        const len = Math.hypot(bx - ax, by - ay);
        // Only the parts of the face inside this chunk (plus a little), checked in short steps.
        const steps = Math.ceil(len / 16);
        for (let i = 0; i < steps; i++) {
          const x0 = ax + ((bx - ax) * i) / steps;
          const y0 = ay + ((by - ay) * i) / steps;
          const x1 = ax + ((bx - ax) * (i + 1)) / steps;
          const y1 = ay + ((by - ay) * (i + 1)) / steps;
          if (Math.max(x0, x1) < box.x0 - 20 || Math.min(x0, x1) > box.x1 + 20 || Math.max(y0, y1) < box.y0 - 20 || Math.min(y0, y1) > box.y1 + 20) continue;
          if (clearanceAt(map.index, (x0 + x1) / 2 + ox, (y0 + y1) / 2 + oy) <= 0) continue;
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
        }
      }
    }
    // A soft second line under the rim: moss glowing along the roots, or hoarfrost on the crypt's ledges.
    if (st.walls === 'roots') {
      g.strokeStyle = `rgba(${st.glow},0.1)`;
      g.lineWidth = 9;
      g.stroke();
      g.strokeStyle = `rgba(${st.rim},0.32)`;
      g.lineWidth = 2.5;
    } else if (st.walls === 'crypt') {
      g.strokeStyle = `rgba(${st.rime ?? st.rim},0.16)`;
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = `rgba(${st.rim},0.6)`;
      g.lineWidth = 2.5;
    } else {
      g.strokeStyle = `rgba(${st.rim},0.45)`;
      g.lineWidth = 2.5;
    }
    g.stroke();
    g.lineCap = 'butt';
  }

  for (const s of near) {
    if (s.name === 'wall' && s.shape === 'rect') continue;
    if (s.name === 'colossus' || s.name === 'heartroot') continue;
    if (paintEmberStone(g, s, st)) continue;
    if (paintHollowsStone(g, s, st, map)) continue;
    if (paintCryptStone(g, s, st)) continue;
    if (s.shape === 'circle') {
      const pg = g.createRadialGradient(s.x - s.r * 0.3, s.y - s.r * 0.3, 2, s.x, s.y, s.r * 1.07);
      pg.addColorStop(0, s.name === 'statue' ? st.carve[0] : st.pillar[0]);
      pg.addColorStop(1, s.name === 'statue' ? st.carve[1] : st.pillar[1]);
      g.fillStyle = pg;
      solidPath(g, s);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = `rgba(${st.rim},0.25)`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(s.x, s.y, s.r * 0.64, 0, TAU);
      g.stroke();
    } else if (s.shape === 'capsule') {
      // A toppled column: lit along one side, with drum joints and fluting.
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      const ux = (s.bx - s.ax) / len;
      const uy = (s.by - s.ay) / len;
      const mx = (s.ax + s.bx) / 2;
      const my = (s.ay + s.by) / 2;
      const grad = g.createLinearGradient(mx + uy * s.r, my - ux * s.r, mx - uy * s.r, my + ux * s.r);
      grad.addColorStop(0, st.pillar[0]);
      grad.addColorStop(1, st.pillar[1]);
      g.fillStyle = grad;
      solidPath(g, s);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 2;
      g.beginPath();
      for (let t = 36; t < len - 10; t += 36) {
        g.moveTo(s.ax + ux * t + uy * s.r * 0.9, s.ay + uy * t - ux * s.r * 0.9);
        g.lineTo(s.ax + ux * t - uy * s.r * 0.9, s.ay + uy * t + ux * s.r * 0.9);
      }
      g.stroke();
      g.strokeStyle = `rgba(${st.rim},0.16)`;
      g.lineWidth = 1.5;
      g.beginPath();
      for (const side of [-0.4, 0.4]) {
        g.moveTo(s.ax + uy * s.r * side, s.ay - ux * s.r * side);
        g.lineTo(s.bx + uy * s.r * side, s.by - ux * s.r * side);
      }
      g.stroke();
    } else {
      // A statue on its plinth, or a wall-coloured block set apart from the grid walls.
      const stone = s.name === 'statue' ? st.carve : st.pillar;
      const grad = g.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
      grad.addColorStop(0, stone[0]);
      grad.addColorStop(1, stone[1]);
      g.fillStyle = grad;
      g.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      g.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
      g.strokeStyle = `rgba(${st.rim},0.22)`;
      g.lineWidth = 1.5;
      g.strokeRect(s.x0 + 9, s.y0 + 9, s.x1 - s.x0 - 18, s.y1 - s.y0 - 18);
      if (s.name === 'statue') {
        g.beginPath();
        g.arc((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.min(s.x1 - s.x0, s.y1 - s.y0) * 0.22, 0, TAU);
        g.stroke();
      }
    }
  }

  // The Heartroot's trunk last, over the bases of its own roots.
  for (const s of near) if (s.name === 'heartroot' && s.shape === 'circle') paintHeartroot(g, s, st);

  // The Fallen Colossus: all its pieces outlined first, then filled, so they read as one figure.
  const colossus = map.solids.filter((s) => s.name === 'colossus');
  if (near.some((s) => s.name === 'colossus')) paintColossus(g, colossus, st);
}

/** The Ember Depths' own stone: hexagonal basalt, glassy obsidian spires, lava ridges and the Forge's anvil. */
function paintEmberStone(g: CanvasRenderingContext2D, s: Solid, st: AreaStyle): boolean {
  if (s.name === 'basalt' && s.shape === 'circle') {
    const hex = (r: number) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        g.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
      }
      g.closePath();
    };
    const grad = g.createLinearGradient(s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r);
    grad.addColorStop(0, '#5a4440');
    grad.addColorStop(1, '#1e1414');
    g.fillStyle = grad;
    hex(s.r * 1.08);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = `rgba(${st.rim},0.25)`;
    g.lineWidth = 1.5;
    hex(s.r * 0.6);
    g.stroke();
    return true;
  }
  if (s.name === 'spire' && s.shape === 'circle') {
    // Obsidian: near-black glass, a sharp highlight and a faint violet sheen.
    const grad = g.createRadialGradient(s.x - s.r * 0.4, s.y - s.r * 0.4, 1, s.x, s.y, s.r * 1.1);
    grad.addColorStop(0, '#4a3a5a');
    grad.addColorStop(0.5, '#160e1c');
    grad.addColorStop(1, '#08040a');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + s.x * 0.01;
      const r = s.r * (i % 2 === 0 ? 1.1 : 0.85);
      g.lineTo(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(220,200,255,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x - s.r * 0.5, s.y - s.r * 0.1);
    g.lineTo(s.x - s.r * 0.1, s.y - s.r * 0.55);
    g.stroke();
    return true;
  }
  if (s.name === 'ridge' && s.shape === 'capsule') {
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const ux = (s.bx - s.ax) / len;
    const uy = (s.by - s.ay) / len;
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    const grad = g.createLinearGradient(mx + uy * s.r, my - ux * s.r, mx - uy * s.r, my + ux * s.r);
    grad.addColorStop(0, '#4a2a22');
    grad.addColorStop(1, '#180a08');
    g.fillStyle = grad;
    solidPath(g, s);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 3;
    g.stroke();
    // A seam of still-glowing lava along its spine.
    g.strokeStyle = 'rgba(255,120,50,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    const rng = mulberry32(Math.round(s.ax * 7 + s.ay));
    g.moveTo(s.ax, s.ay);
    for (let t = 30; t < len; t += 30) g.lineTo(s.ax + ux * t + uy * (rng() - 0.5) * s.r * 0.6, s.ay + uy * t - ux * (rng() - 0.5) * s.r * 0.6);
    g.lineTo(s.bx, s.by);
    g.stroke();
    return true;
  }
  if (s.name === 'anvil' && s.shape === 'rect') {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    const grad = g.createLinearGradient(s.x0, s.y0, s.x0, s.y1);
    grad.addColorStop(0, '#6a6474');
    grad.addColorStop(1, '#25222c');
    g.fillStyle = grad;
    g.beginPath();
    // The horn to the left, the heel square to the right.
    g.moveTo(s.x0 - 18, s.y0 + h * 0.3);
    g.lineTo(s.x0 + w * 0.2, s.y0);
    g.lineTo(s.x1, s.y0);
    g.lineTo(s.x1, s.y1);
    g.lineTo(s.x0 + w * 0.2, s.y1);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(255,180,120,0.35)';
    g.lineWidth = 1.5;
    g.strokeRect(s.x0 + w * 0.3, s.y0 + 8, w * 0.6, h - 16);
    return true;
  }
  return false;
}

/** The Hollows' walls: a tangle of gnarled roots, each dark-cased with a lit top, and a few glowing caps among them. */
function paintRootWall(g: CanvasRenderingContext2D, st: AreaStyle, box: Box): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  eachCell(box, 46, 145, (i, j) => {
    const rng = mulberry32(Math.floor(hash2(i, j, 971) * 1e9));
    let x = (i + rng()) * 46;
    let y = (j + rng()) * 46;
    let a = rng() * TAU;
    const w = 6 + rng() * 8;
    const pts: Vec[] = [{ x, y }];
    const steps = 3 + Math.floor(rng() * 3);
    for (let k = 0; k < steps; k++) {
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a) * (16 + rng() * 10);
      y += Math.sin(a) * (16 + rng() * 10);
      pts.push({ x, y });
    }
    const shade = 0.4 + rng() * 0.35;
    for (const [color, width, o] of [
      ['rgba(2,6,5,0.9)', w + 4, 0],
      [`rgba(${st.brick},${shade})`, w, 0],
      ['rgba(255,235,200,0.12)', w * 0.3, -w * 0.2],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      pts.forEach((p, n) => (n === 0 ? g.moveTo(p.x + o, p.y + o) : g.lineTo(p.x + o, p.y + o)));
      g.stroke();
    }
  });
  g.lineCap = 'butt';
  eachCell(box, 70, 10, (i, j) => {
    if (hash2(i, j, 972) > 0.1) return;
    const x = (i + hash2(i, j, 973)) * 70;
    const y = (j + hash2(i, j, 974)) * 70;
    const color = hash2(i, j, 975) < 0.3 ? st.circle : st.glow;
    const m = g.createRadialGradient(x, y, 0, x, y, 12);
    m.addColorStop(0, `rgba(${color},0.45)`);
    m.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = m;
    g.fillRect(x - 12, y - 12, 24, 24);
    g.fillStyle = `rgba(${st.glowCore},0.8)`;
    g.beginPath();
    g.arc(x, y, 2, 0, TAU);
    g.fill();
  });
}

/** The Catacombs' walls: dressed blocks in courses, each a slightly different shade, rime on every ledge. */
function paintCryptWall(g: CanvasRenderingContext2D, st: AreaStyle, box: Box): void {
  const course = 32;
  const block = 64;
  const rime = st.rime ?? st.rim;
  for (let row = Math.floor(box.y0 / course); row * course < box.y1; row++) {
    const y = row * course;
    const shift = (row & 1) * (block / 2);
    for (let col = Math.floor((box.x0 - shift) / block); col * block + shift < box.x1; col++) {
      const x = col * block + shift;
      const h = hash2(col, row, 981);
      g.fillStyle = h > 0.5 ? `rgba(${st.brick},${0.04 + (h - 0.5) * 0.14})` : `rgba(0,0,0,${0.08 + h * 0.2})`;
      g.fillRect(x + 1.5, y + 1.5, block - 3, course - 3);
      // Rime settled along the top of the block.
      g.fillStyle = `rgba(${rime},${0.08 + hash2(col, row, 982) * 0.12})`;
      g.fillRect(x + 2, y + 2, block - 4, 3);
    }
  }
  g.strokeStyle = 'rgba(2,4,10,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  for (let row = Math.floor(box.y0 / course); row * course < box.y1; row++) {
    const y = row * course;
    g.moveTo(box.x0, y);
    g.lineTo(box.x1, y);
    const shift = (row & 1) * (block / 2);
    for (let x = Math.floor((box.x0 - shift) / block) * block + shift; x < box.x1; x += block) {
      g.moveTo(x, y);
      g.lineTo(x, y + course);
    }
  }
  g.stroke();
}

/** The Hollows' growth: glowing mushroom caps, the Fallen Giant's trunk and cap, and gnarled roots. */
function paintHollowsStone(g: CanvasRenderingContext2D, s: Solid, st: AreaStyle, map: MapLayout): boolean {
  if (s.name === 'stalk' && s.shape === 'circle') {
    // A giant mushroom seen from above: a domed teal cap, glowing spots and a pale gill fringe.
    const R = s.r * 1.1;
    const halo = g.createRadialGradient(s.x, s.y, R * 0.8, s.x, s.y, R * 1.9);
    halo.addColorStop(0, `rgba(${st.glow},0.2)`);
    halo.addColorStop(1, `rgba(${st.glow},0)`);
    g.fillStyle = halo;
    g.fillRect(s.x - R * 1.9, s.y - R * 1.9, R * 3.8, R * 3.8);
    const cap = g.createRadialGradient(s.x - R * 0.35, s.y - R * 0.35, 2, s.x, s.y, R);
    cap.addColorStop(0, '#8af5dc');
    cap.addColorStop(0.55, '#1f7d74');
    cap.addColorStop(1, '#0a2e33');
    g.fillStyle = cap;
    g.beginPath();
    g.arc(s.x, s.y, R, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = `rgba(${st.glowCore},0.35)`;
    g.lineWidth = 2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.arc(s.x, s.y, R * 0.86, 0, TAU);
    g.stroke();
    g.setLineDash([]);
    const rng = mulberry32(Math.round(s.x * 7 + s.y));
    g.fillStyle = 'rgba(225,255,245,0.85)';
    for (let i = 0; i < 5; i++) {
      const a = rng() * TAU;
      const d = R * (0.15 + rng() * 0.5);
      g.beginPath();
      g.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, R * (0.07 + rng() * 0.08), 0, TAU);
      g.fill();
    }
    return true;
  }
  if (s.name === 'stalk' && s.shape === 'capsule') {
    // The Fallen Giant's trunk: a pale fibrous stalk, lit along one side, with old ring scars.
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const ux = (s.bx - s.ax) / len;
    const uy = (s.by - s.ay) / len;
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    const grad = g.createLinearGradient(mx + uy * s.r, my - ux * s.r, mx - uy * s.r, my + ux * s.r);
    grad.addColorStop(0, '#efe4d0');
    grad.addColorStop(1, '#7a6a58');
    g.fillStyle = grad;
    solidPath(g, s);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(90,70,50,0.3)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const side of [-0.75, -0.45, -0.15, 0.2, 0.5, 0.8]) {
      g.moveTo(s.ax + uy * s.r * side, s.ay - ux * s.r * side);
      for (let t = 40; t <= len; t += 40) {
        const wob = Math.sin(t * 0.05 + side * 7) * 3;
        g.lineTo(s.ax + ux * t + uy * (s.r * side + wob), s.ay + uy * t - ux * (s.r * side + wob));
      }
    }
    g.stroke();
    g.strokeStyle = 'rgba(60,40,30,0.3)';
    g.lineWidth = 3;
    g.beginPath();
    for (let t = 90; t < len - 30; t += 110) {
      g.moveTo(s.ax + ux * t + uy * s.r * 0.95, s.ay + uy * t - ux * s.r * 0.95);
      g.quadraticCurveTo(s.ax + ux * (t + 10), s.ay + uy * (t + 10), s.ax + ux * t - uy * s.r * 0.95, s.ay + uy * t + ux * s.r * 0.95);
    }
    g.stroke();
    return true;
  }
  if (s.name === 'cap' && s.shape === 'circle') {
    paintFallenCap(g, s, st, map);
    return true;
  }
  if (s.name === 'root' && s.shape === 'capsule') {
    // A gnarled root: dark bark lit along one side, twisting grain, knots and a few glowing caps.
    const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
    const ux = (s.bx - s.ax) / len;
    const uy = (s.by - s.ay) / len;
    const mx = (s.ax + s.bx) / 2;
    const my = (s.ay + s.by) / 2;
    const grad = g.createLinearGradient(mx + uy * s.r, my - ux * s.r, mx - uy * s.r, my + ux * s.r);
    grad.addColorStop(0, '#6a5240');
    grad.addColorStop(1, '#1c130c');
    g.fillStyle = grad;
    solidPath(g, s);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(10,6,2,0.45)';
    g.lineWidth = 2;
    g.beginPath();
    for (const ph of [0, Math.PI]) {
      for (let t = 0; t <= len; t += 12) {
        const side = Math.sin(t * 0.035 + ph) * 0.6;
        const x = s.ax + ux * t + uy * s.r * side;
        const y = s.ay + uy * t - ux * s.r * side;
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.stroke();
    const rng = mulberry32(Math.round(s.ax * 7 + s.ay));
    for (let t = 60 + rng() * 40; t < len - 20; t += 90 + rng() * 60) {
      const side = (rng() - 0.5) * 0.8;
      const x = s.ax + ux * t + uy * s.r * side;
      const y = s.ay + uy * t - ux * s.r * side;
      g.fillStyle = 'rgba(20,12,6,0.6)';
      g.beginPath();
      g.ellipse(x, y, s.r * 0.32, s.r * 0.2, Math.atan2(uy, ux), 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(255,230,190,0.15)';
      g.lineWidth = 1.5;
      g.stroke();
      if (rng() < 0.6) {
        const color = rng() < 0.35 ? st.circle : st.glow;
        const cx = x + uy * s.r * 0.5;
        const cy = y - ux * s.r * 0.5;
        const m = g.createRadialGradient(cx, cy, 0, cx, cy, 10);
        m.addColorStop(0, `rgba(${color},0.5)`);
        m.addColorStop(1, `rgba(${color},0)`);
        g.fillStyle = m;
        g.fillRect(cx - 10, cy - 10, 20, 20);
        g.fillStyle = `rgba(${st.glowCore},0.85)`;
        g.beginPath();
        g.arc(cx, cy, 2.2, 0, TAU);
        g.fill();
      }
    }
    return true;
  }
  return false;
}

/** The Fallen Giant's cap, lying tipped toward its trunk: a spotted magenta dome, its gills showing where the stalk joins. */
function paintFallenCap(g: CanvasRenderingContext2D, s: Extract<Solid, { shape: 'circle' }>, st: AreaStyle, map: MapLayout): void {
  // The trunk's end that meets this cap.
  let jx = s.x - s.r * 0.8;
  let jy = s.y;
  let jr = s.r * 0.3;
  let best = Infinity;
  for (const o of map.solids) {
    if (o.name !== 'stalk' || o.shape !== 'capsule') continue;
    for (const [x, y] of [
      [o.ax, o.ay],
      [o.bx, o.by],
    ]) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d < best && d < s.r + 80) {
        best = d;
        jx = x;
        jy = y;
        jr = o.r;
      }
    }
  }
  const a = Math.atan2(jy - s.y, jx - s.x);
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  const dome = g.createRadialGradient(s.x - fx * s.r * 0.35, s.y - fy * s.r * 0.35, 4, s.x, s.y, s.r);
  dome.addColorStop(0, '#e488cc');
  dome.addColorStop(0.6, '#86307a');
  dome.addColorStop(1, '#3a0e34');
  g.fillStyle = dome;
  g.beginPath();
  g.arc(s.x, s.y, s.r, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 3.5;
  g.stroke();
  g.save();
  g.beginPath();
  g.arc(s.x, s.y, s.r - 2, 0, TAU);
  g.clip();
  // The gills: a pale underside showing on the trunk's side, fanning from where the stalk joins.
  const gx = s.x + fx * s.r * 0.55;
  const gy = s.y + fy * s.r * 0.55;
  g.fillStyle = '#e8d2bc';
  g.beginPath();
  g.ellipse(gx, gy, s.r * 0.5, s.r * 0.92, a, 0, TAU);
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(110,60,70,0.45)';
  g.lineWidth = 1.5;
  g.beginPath();
  for (let i = -12; i <= 12; i++) {
    const b = a + Math.PI + (i / 12) * 1.35;
    g.moveTo(jx, jy);
    g.lineTo(jx + Math.cos(b) * s.r * 1.3, jy + Math.sin(b) * s.r * 1.3);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(40,10,36,0.5)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.ellipse(gx, gy, s.r * 0.5, s.r * 0.92, a, 0, TAU);
  g.stroke();
  // The stalk's torn end against the gills.
  g.fillStyle = '#d8cab4';
  g.beginPath();
  g.arc(jx, jy, jr, 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 2;
  g.stroke();
  g.restore();
  // Pale spots on the dome, and a glowing rim.
  const rng = mulberry32(Math.round(s.x * 7 + s.y));
  g.fillStyle = 'rgba(255,226,246,0.75)';
  for (let i = 0; i < 9; i++) {
    const b = a + Math.PI + (rng() - 0.5) * 2.6;
    const d = s.r * (0.15 + rng() * 0.65);
    const x = s.x + Math.cos(b) * d;
    const y = s.y + Math.sin(b) * d;
    if (Math.hypot(x - gx, y - gy) < s.r * 0.55) continue;
    g.beginPath();
    g.arc(x, y, s.r * (0.05 + rng() * 0.07), 0, TAU);
    g.fill();
  }
  g.strokeStyle = `rgba(${st.circle},0.35)`;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(s.x, s.y, s.r * 0.9, a + 2.1, a + 4.2);
  g.stroke();
}

/** The Heartroot's great trunk rising out of view: gnarled bark round a split that glows at its heart. */
function paintHeartroot(g: CanvasRenderingContext2D, s: Extract<Solid, { shape: 'circle' }>, st: AreaStyle): void {
  const rng = mulberry32(Math.round(s.x * 7 + s.y));
  const n = 18;
  const rim: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = s.r * (1.02 + (rng() - 0.3) * 0.12);
    rim.push({ x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r });
  }
  const bark = g.createRadialGradient(s.x - s.r * 0.3, s.y - s.r * 0.3, 6, s.x, s.y, s.r * 1.1);
  bark.addColorStop(0, '#6a5442');
  bark.addColorStop(0.6, '#2e2218');
  bark.addColorStop(1, '#110b07');
  g.fillStyle = bark;
  g.beginPath();
  rim.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.lineWidth = 4;
  g.stroke();
  // Bark ridges twisting in toward the middle.
  g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + rng() * 0.2;
    const r0 = s.r * 0.95;
    const r1 = s.r * 0.42;
    for (const [color, width, o] of [
      ['rgba(0,0,0,0.4)', 3, 0],
      ['rgba(255,220,180,0.1)', 1.5, -1.5],
    ] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(s.x + Math.cos(a) * r0 + o, s.y + Math.sin(a) * r0 + o);
      g.quadraticCurveTo(
        s.x + Math.cos(a + 0.35) * s.r * 0.7 + o,
        s.y + Math.sin(a + 0.35) * s.r * 0.7 + o,
        s.x + Math.cos(a + 0.6) * r1 + o,
        s.y + Math.sin(a + 0.6) * r1 + o,
      );
      g.stroke();
    }
  }
  g.lineCap = 'butt';
  // The heart: a magenta glow through a split in the bark, with teal veins running out of it.
  const heart = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 0.55);
  heart.addColorStop(0, `rgba(${st.circle},0.6)`);
  heart.addColorStop(1, `rgba(${st.circle},0)`);
  g.fillStyle = heart;
  g.fillRect(s.x - s.r * 0.55, s.y - s.r * 0.55, s.r * 1.1, s.r * 1.1);
  g.strokeStyle = `rgba(${st.glow},0.4)`;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    g.moveTo(s.x + Math.cos(a) * s.r * 0.18, s.y + Math.sin(a) * s.r * 0.18);
    g.lineTo(s.x + Math.cos(a + 0.25) * s.r * 0.5, s.y + Math.sin(a + 0.25) * s.r * 0.5);
    g.lineTo(s.x + Math.cos(a + 0.1) * s.r * 0.78, s.y + Math.sin(a + 0.1) * s.r * 0.78);
  }
  g.stroke();
  g.fillStyle = '#ff9aec';
  g.beginPath();
  g.ellipse(s.x, s.y, s.r * 0.11, s.r * 0.26, 0.5, 0, TAU);
  g.fill();
  g.fillStyle = '#fff0fb';
  g.beginPath();
  g.ellipse(s.x, s.y, s.r * 0.04, s.r * 0.15, 0.5, 0, TAU);
  g.fill();
}

/** The Catacombs' stone: eight-sided pillars of ice, and the kings' sarcophagi with their effigies. */
function paintCryptStone(g: CanvasRenderingContext2D, s: Solid, st: AreaStyle): boolean {
  if (s.name === 'icePillar' && s.shape === 'circle') {
    const rime = st.rime ?? st.rim;
    const halo = g.createRadialGradient(s.x, s.y, s.r, s.x, s.y, s.r * 1.9);
    halo.addColorStop(0, `rgba(${rime},0.18)`);
    halo.addColorStop(1, `rgba(${rime},0)`);
    g.fillStyle = halo;
    g.fillRect(s.x - s.r * 1.9, s.y - s.r * 1.9, s.r * 3.8, s.r * 3.8);
    const R = s.r * 1.08;
    const rot = s.x * 0.01;
    const corner = (i: number, r: number): Vec => ({ x: s.x + Math.cos((i / 8) * TAU + rot) * r, y: s.y + Math.sin((i / 8) * TAU + rot) * r });
    const grad = g.createLinearGradient(s.x - R, s.y - R, s.x + R, s.y + R);
    grad.addColorStop(0, '#eef8ff');
    grad.addColorStop(0.45, '#8ab8e0');
    grad.addColorStop(1, '#1e3a60');
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < 8; i++) g.lineTo(corner(i, R).x, corner(i, R).y);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(6,12,28,0.75)';
    g.lineWidth = 3;
    g.stroke();
    // Facets meeting at a top lit from the upper left.
    const tx = s.x - s.r * 0.15;
    const ty = s.y - s.r * 0.15;
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      g.moveTo(tx, ty);
      g.lineTo(corner(i, R).x, corner(i, R).y);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.3)';
    g.beginPath();
    for (let i = 0; i < 8; i++) g.lineTo(tx + Math.cos((i / 8) * TAU + rot) * R * 0.38, ty + Math.sin((i / 8) * TAU + rot) * R * 0.38);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x - R * 0.62, s.y - R * 0.05);
    g.lineTo(s.x - R * 0.2, s.y - R * 0.6);
    g.stroke();
    return true;
  }
  if (s.name === 'sarcophagus' && s.shape === 'rect') {
    const w = s.x1 - s.x0;
    const h = s.y1 - s.y0;
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    const grad = g.createLinearGradient(s.x0, s.y0, s.x1, s.y1);
    grad.addColorStop(0, st.carve[0]);
    grad.addColorStop(1, st.carve[1]);
    g.fillStyle = grad;
    g.fillRect(s.x0, s.y0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = 3;
    g.strokeRect(s.x0, s.y0, w, h);
    g.strokeStyle = `rgba(${st.rim},0.25)`;
    g.lineWidth = 1.5;
    g.strokeRect(s.x0 + 7, s.y0 + 7, w - 14, h - 14);
    // The effigy on the lid, lying along its length: head and crown, folded hands on a sword.
    g.save();
    g.translate((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
    if (h > w) g.rotate(Math.PI / 2);
    const L = long / 2 - 14;
    const S = short / 2 - 12;
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-L + 26, -S * 0.8);
    g.lineTo(L, -S * 0.45);
    g.lineTo(L, S * 0.45);
    g.lineTo(-L + 26, S * 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(-L + 12, 0, S * 0.55, 0, TAU);
    g.fill();
    g.stroke();
    g.strokeStyle = `rgba(${st.runes},0.45)`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-L, -S * 0.4);
    g.lineTo(-L - 4, -S * 0.15);
    g.lineTo(-L, 0);
    g.lineTo(-L - 4, S * 0.15);
    g.lineTo(-L, S * 0.4);
    g.moveTo(-L + 30, 0);
    g.lineTo(L - 4, 0);
    g.moveTo(-L + 40, -S * 0.35);
    g.lineTo(-L + 40, S * 0.35);
    g.stroke();
    g.restore();
    // Rime along the lid's upper edge.
    g.strokeStyle = `rgba(${st.rime ?? st.rim},0.5)`;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s.x0 + 3, s.y0 + 3);
    g.lineTo(s.x1 - 3, s.y0 + 3);
    g.stroke();
    return true;
  }
  return false;
}

/** What holds each wall light: a cluster of glowing caps in the Hollows' roots, an iron cresset in the Catacombs. */
function paintSconces(g: CanvasRenderingContext2D, map: MapLayout, st: AreaStyle, box: Box): void {
  if (st.walls === 'brick') return;
  for (const t of map.torches) {
    if (t.x < box.x0 - 40 || t.x > box.x1 + 40 || t.y < box.y0 - 40 || t.y > box.y1 + 40) continue;
    if (st.walls === 'roots') {
      for (const [dx, dy, r] of [
        [-9, 3, 6],
        [0, -4, 8],
        [9, 2, 5],
      ] as const) {
        const x = t.x + dx;
        const y = t.y + dy;
        const cap = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
        cap.addColorStop(0, `rgb(${st.glowCore})`);
        cap.addColorStop(1, `rgb(${st.glow})`);
        g.fillStyle = cap;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(2,10,8,0.85)';
        g.lineWidth = 1.5;
        g.stroke();
      }
    } else {
      g.fillStyle = '#1a2230';
      g.strokeStyle = '#6a7a90';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(t.x, t.y, 10, 0, TAU);
      g.fill();
      g.stroke();
      g.fillStyle = `rgba(${st.torch},0.7)`;
      g.beginPath();
      g.arc(t.x, t.y, 5, 0, TAU);
      g.fill();
    }
  }
}

function paintColossus(g: CanvasRenderingContext2D, parts: Solid[], st: AreaStyle): void {
  g.fillStyle = 'rgba(0,0,0,0.65)';
  for (const s of parts) {
    solidPath(g, s, 0, 0, 3);
    g.fill();
  }
  for (const s of parts) {
    const b = solidBounds(s);
    const grad = g.createLinearGradient(b.x0, b.y0, b.x1, b.y1);
    grad.addColorStop(0, st.carve[0]);
    grad.addColorStop(1, st.carve[1]);
    g.fillStyle = grad;
    solidPath(g, s);
    g.fill();
  }
  // Weathering: cracks across the stone.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (const [i, s] of parts.entries()) {
    const b = solidBounds(s);
    const rng = mulberry32(1000 + i);
    g.beginPath();
    for (let k = 0; k < 3; k++) {
      let x = b.x0 + (b.x1 - b.x0) * (0.25 + rng() * 0.5);
      let y = b.y0 + (b.y1 - b.y0) * (0.25 + rng() * 0.5);
      g.moveTo(x, y);
      for (let n = 0; n < 3; n++) {
        x += (rng() - 0.5) * 50;
        y += (rng() - 0.5) * 50;
        g.lineTo(x, y);
      }
    }
    g.stroke();
  }
  // The face on the head: brow, empty eyes and a mouth, looking along the body.
  const head = parts.find((s) => s.shape === 'circle');
  const body = parts.find((s) => s.shape === 'capsule');
  if (head && head.shape === 'circle' && body && body.shape === 'capsule') {
    const a = Math.atan2(head.y - (body.ay + body.by) / 2, head.x - (body.ax + body.bx) / 2);
    const fx = Math.cos(a);
    const fy = Math.sin(a);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.ellipse(head.x + fx * head.r * 0.15 - fy * side * head.r * 0.35, head.y + fy * head.r * 0.15 + fx * side * head.r * 0.35, head.r * 0.16, head.r * 0.1, a, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(head.x + fx * head.r * 0.55 - fy * head.r * 0.25, head.y + fy * head.r * 0.55 + fx * head.r * 0.25);
    g.lineTo(head.x + fx * head.r * 0.55 + fy * head.r * 0.25, head.y + fy * head.r * 0.55 - fx * head.r * 0.25);
    g.stroke();
    g.strokeStyle = `rgba(${st.rim},0.25)`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(head.x, head.y, head.r * 0.85, a + 2.2, a + 4.1);
    g.stroke();
  }
}

/** '#rrggbb' + alpha -> 'rgba(...)'. */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
