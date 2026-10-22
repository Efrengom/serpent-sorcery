import { PIXEL_ART } from '../config';
import { hash2 } from '../hash';
import type { Hazard, HazardKind, Landmark, MapLayout, Solid, SolidName } from '../maps/types';
import { mulberry32, TAU } from '../math';
import { clearanceAt, nearestSolid, solidBounds, type Contact } from '../terrain';
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
  /** What the floor is: flagstones, or bare earth (the Hollows). */
  ground: 'flag' | 'soil';
  /** How the grid's walls are built: brick courses, tangled roots or crypt masonry. */
  walls: 'brick' | 'roots' | 'crypt';
  /** Rime frosting the flagstones (the Catacombs), or null. */
  frost: string | null;
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
  ground: 'flag',
  walls: 'brick',
  frost: null,
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
  ground: 'flag',
  walls: 'brick',
  frost: null,
};

/**
 * The Mycelium Hollows: teal-black earth (no flagstones) laced with glowing threads and moss,
 * walls of tangled roots, magenta glowcaps where floor meets root.
 */
const HOLLOWS: FloorPalette = {
  grout: '#06100f',
  void: '#040a0a',
  stone0: '#0a1716',
  stone1: '#0e1f1d',
  stone2: '#122724',
  stone3: '#17302c',
  stoneHi: '#22433b',
  wall0: '#120a0c',
  wall1: '#2c1c1c',
  wall2: '#432c28',
  wallHi: '#6e4c40',
  carve0: '#1a2a26',
  carve1: '#2a4038',
  carve2: '#3a564c',
  carveHi: '#5a8070',
  moss0: '#123a2c',
  moss1: '#1c5a3e',
  rune: '#1d5e54',
  runeHi: '#5ff0cc',
  mush: '#ff8ad8',
  mushDim: '#8a2a74',
  torchGlow: '#123a36',
  torchGlow2: '#1a524a',
  lava: null,
  lavaHot: null,
  ground: 'soil',
  walls: 'roots',
  frost: null,
};

/** The Rimefrost Catacombs: navy flagstones under drifts of rime, crypt masonry, cold blue light. */
const CATACOMBS: FloorPalette = {
  grout: '#080d1a',
  void: '#060a14',
  stone0: '#121a2c',
  stone1: '#19233a',
  stone2: '#1f2b46',
  stone3: '#263452',
  stoneHi: '#33466a',
  wall0: '#0a0f1e',
  wall1: '#1f2840',
  wall2: '#2e3a58',
  wallHi: '#7a96c4',
  carve0: '#26304a',
  carve1: '#3a4664',
  carve2: '#525f82',
  carveHi: '#94a8cc',
  moss0: '#2a3c5e',
  moss1: '#3e5682',
  rune: '#2c4472',
  runeHi: '#7fb2ff',
  mush: '#cfeeff',
  mushDim: '#4a78b0',
  torchGlow: '#1c2a4c',
  torchGlow2: '#25386a',
  lava: null,
  lavaHot: null,
  ground: 'flag',
  walls: 'crypt',
  frost: '#3c5078',
};

/** Indexed by the map's area (see MAP_AREAS): Ruins, Ember Depths, Hollows, Catacombs. */
const PALETTES = [RUINS, EMBER, HOLLOWS, CATACOMBS];

/** Stone (or wood, fungus and ice) with a look of its own (dark, mid, light, rim-lit), whatever the area. */
const STONE_LOOKS: Partial<Record<SolidName, [string, string, string, string]>> = {
  basalt: ['#1e1414', '#3a2a28', '#5a4440', '#8a6a60'],
  spire: ['#08040a', '#160e1c', '#2a1e36', '#9a88c0'],
  ridge: ['#180a08', '#2e1610', '#4a2a22', '#7a4a3a'],
  anvil: ['#25222c', '#3a3640', '#55505e', '#8a8494'],
  // The Hollows: glowcap tops, bark, and the Fallen Giant's cap.
  stalk: ['#0a2224', '#163e3c', '#215c56', '#7ef0d6'],
  heartroot: ['#140a0c', '#2e1c1c', '#4a2e28', '#86604a'],
  root: ['#140a0c', '#2e1c1c', '#4a2e28', '#7a5644'],
  cap: ['#2a0828', '#5a1450', '#86286f', '#ff8ad8'],
  // The Catacombs: ice and crypt stone.
  icePillar: ['#16305a', '#3a70b8', '#7fb2ff', '#eaf8ff'],
  sarcophagus: ['#1a2032', '#323c56', '#4e5a78', '#9fb4d8'],
};
/** The Fallen Giant's stalk, lying on the floor: pale and fibrous. */
const FALLEN_STALK: [string, string, string, string] = ['#3a3630', '#6e685a', '#9a9480', '#d8d2b8'];
/** Glowing bits of the Hollows' solids: a glowcap's lip and spots, the Heartroot's heart and veins. */
const GLOW = { lip: '#5ff0cc', spot: '#c8fff0', capLip: '#ff8ad8', capSpot: '#ffe2f6', capSpotShade: '#d8a8cc', core: '#ffd0f0', heart: '#ff70c8', vein: '#c03c9e' };

/** Molten rock, its crust, and the dark shore round it. */
const LAVA = { shore0: '#120402', shore1: '#3a0e06', rim: '#ffb35c', plate: '#7a1e0c', melt: '#d8461c', hot: '#ff7a2a', white: '#ffd36b' };
/** Brambles: a bright rim inside a dark outline, light vines and thorn tips over near-black, so they read in greyscale. */
const BRAMBLE = { edge: '#0e040e', rim: '#c03c9e', base: '#1a0818', vine0: '#4a1442', vine1: '#7a2468', thorn: '#ff8ad8', stray: '#5a1a50' };
/** Ice: a dark edge and a white rim, a pale sheet with sheen and cracks, darker where it's deep. */
const ICE = { edge: '#0a1430', frost: '#3a4f78', rim: '#eaf8ff', lip: '#a8d0ff', sheet0: '#5a88c4', sheet1: '#6e9ad2', deep: '#3e68aa', shine: '#d8eeff', crack: '#2e5494' };
/** Bones strewn on the Ossuary floor. */
const BONE = { dark: '#2a2620', lo: '#6e6656', mid: '#a89c84', hi: '#ddd4c0' };

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

/** A little crown, inlaid at either end of the Crypt of Kings. */
const CROWN = ['10101', '11111', '11111'];

/** How far (art pixels) each landmark's floor art reaches from its centre. */
const LANDMARK_REACH: Partial<Record<Landmark['kind'], number>> = {
  plaza: 100,
  caldera: 100,
  glowring: 110,
  heartroot: 130,
  fallen: 120,
  thicket: 120,
  grotto: 240,
  bellcourt: 110,
  ossuary: 420,
  kings: 330,
  lake: 120,
};

const P = PIXEL_ART.worldPerPixel;
const CHUNK = PIXEL_ART.chunk;
/** Flagstone size in art pixels. */
const T = 16;
/** Rows painted per step of an unfinished chunk, so painting can be spread over frames. */
const BAND = 32;

type Plot = (x: number, y: number, hex: string, grout?: boolean) => void;

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
  /** Details on ice (the Frozen Lake's cracks), by local index. */
  iceMarks: Map<number, string>;
  torches: { x: number; y: number }[];
  /** Whether any hazard ground reaches into this chunk. */
  hazards: boolean;
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
  private readonly hazHit: Contact = { d: 0, nx: 0, ny: -1, solid: null };
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
    const iceMarks = new Map<number, string>();
    const set: Plot = (x, y, hex, grout = false) => {
      x = Math.round(x) - X0;
      y = Math.round(y) - Y0;
      if (x < 0 || y < 0 || x >= CHUNK || y >= CHUNK) return;
      marks.set(y * CHUNK + x, hex);
      if (grout) groutMarks.add(y * CHUNK + x);
    };
    const setIce: Plot = (x, y, hex) => {
      x = Math.round(x) - X0;
      y = Math.round(y) - Y0;
      if (x >= 0 && y >= 0 && x < CHUNK && y < CHUNK) iceMarks.set(y * CHUNK + x, hex);
    };
    const salt = this.area * 101;

    if (C.ground === 'flag') {
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
    } else {
      // Mycelium: pale threads wandering over the earth, branching now and then, with a glowing knot at some ends.
      for (let j = Math.floor(Y0 / 24) - 1; j <= Math.floor((Y0 + CHUNK) / 24) + 1; j++) {
        for (let i = Math.floor(X0 / 24) - 1; i <= Math.floor((X0 + CHUNK) / 24) + 1; i++) {
          if (hash2(i, j, salt + 1) > 0.45) continue;
          const rng = mulberry32(Math.floor(hash2(i, j, salt + 2) * 1e9));
          let x = i * 24 + rng() * 24;
          let y = j * 24 + rng() * 24;
          let a = rng() * TAU;
          const steps = 10 + Math.floor(rng() * 16);
          for (let s = 0; s < steps; s++) {
            set(x, y, s === steps - 1 && rng() < 0.4 ? C.runeHi : C.rune);
            a += (rng() - 0.5) * 0.9;
            x += Math.cos(a);
            y += Math.sin(a);
            if (rng() < 0.08) {
              const b = a + (rng() < 0.5 ? 1 : -1) * 0.9;
              for (let k = 1; k <= 3; k++) set(x + Math.cos(b) * k, y + Math.sin(b) * k, C.rune);
            }
          }
        }
      }
    }

    // Vents: an eruption's blackened crater, a spore vent's glowing pit, or the frost-marked spot icicles fall on.
    const vent = this.map.def.vent;
    for (const v of this.map.vents) {
      const vx = Math.round(v.x / P);
      const vy = Math.round(v.y / P);
      if (vx < X0 - 20 || vx > X0 + CHUNK + 20 || vy < Y0 - 20 || vy > Y0 + CHUNK + 20) continue;
      for (let y = -13; y <= 13; y++) {
        for (let x = -13; x <= 13; x++) {
          const r = Math.hypot(x, y * 1.1);
          if (r > 13) continue;
          const X = vx + x;
          const Y = vy + y;
          if (vent === 'vent') {
            set(X, Y, r < 3.5 ? LAVA.rim : r < 6.5 ? LAVA.melt : r < 11.5 ? (bayer(X, Y) < 0.2 ? C.stone0 : '#2a120c') : y < 0 ? C.stoneHi : C.stone0, true);
          } else if (vent === 'spores') {
            const hex = sporeVentPixel(C, X, Y, x, y, r);
            if (hex) set(X, Y, hex);
          } else {
            const hex = icicleVentPixel(C, X, Y, x, y, r);
            if (hex) set(X, Y, hex, hex === C.grout);
          }
        }
      }
    }

    // Landmarks: their own floor art (the plaza's summoning circle, the Caldera's ring, the Glowcap Ring, the Bell Court's bell...).
    for (const l of this.map.landmarks) {
      const reach = LANDMARK_REACH[l.kind];
      if (!reach) continue;
      const cx = Math.round(l.x / P);
      const cy = Math.round(l.y / P);
      if (cx < X0 - reach || cx > X0 + CHUNK + reach || cy < Y0 - reach || cy > Y0 + CHUNK + reach) continue;
      this.landmark(l, cx, cy, set, setIce);
    }

    // Pebbles and glowing mushrooms (ice crystals in the Catacombs) where floor meets stone; moss blobs, thickest against it.
    const index = this.map.index;
    const soil = C.ground === 'soil';
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
        if (hash2(i, j, salt + 9) > (near ? 0.6 : soil ? 0.2 : 0.06)) continue;
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
            if (soil) {
              // Moss carpets bare earth in soft patches, brightest at their hearts.
              if (!marks.has(li) && hash2(x, y, salt + 11) < k * 0.85) marks.set(li, k > 0.5 && hash2(x, y, salt + 12) < 0.55 ? C.moss1 : C.moss0);
              continue;
            }
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
    const hazards = this.map.hazards.some((h) => {
      const b = solidBounds(h);
      return b.x1 / P > X0 - 4 && b.x0 / P < X0 + CHUNK + 4 && b.y1 / P > Y0 - 4 && b.y0 / P < Y0 + CHUNK + 4;
    });
    return { key: r * this.cols + c, X0, Y0, img: new ImageData(CHUNK, CHUNK), marks, groutMarks, iceMarks, torches, hazards, row: 0 };
  }

  /** One landmark's floor art, centred on art pixel (cx, cy). */
  private landmark(l: Landmark, cx: number, cy: number, set: Plot, setIce: Plot): void {
    const C = this.C;
    const rng = mulberry32(Math.floor(l.x * 7 + l.y * 13));
    switch (l.kind) {
      case 'plaza':
      case 'caldera': {
        // The plaza's summoning circle and runes, and the Caldera's ring.
        const caldera = l.kind === 'caldera';
        for (const rr of caldera ? [240, 220] : [210, 190, 120]) circle(cx, cy, Math.round(rr / P), (x, y) => set(x, y, C.rune));
        const hr = 190 / P;
        for (let i = 0; i < (caldera ? 0 : 6); i++) {
          const a = (i / 6) * TAU - Math.PI / 2;
          const b = ((i + 2) / 6) * TAU - Math.PI / 2;
          line(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr, cx + Math.cos(b) * hr, cy + Math.sin(b) * hr, (x, y) => set(x, y, C.rune));
        }
        glyphRing(cx, cy, (caldera ? 230 : 200) / P, set, C.runeHi);
        break;
      }
      case 'glowring': {
        // A fairy ring: glowing caps round the edge, mycelium rings inside and threads spiralling in to the middle.
        const R = Math.round(230 / P);
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * TAU + (rng() - 0.5) * 0.06;
          const d = R + (rng() - 0.5) * 3;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d;
          const cap = i % 3 === 0 ? C.mush : C.runeHi;
          set(x, y, cap);
          set(x + 1, y, cap);
          set(x, y + 1, C.mushDim);
        }
        for (const rr of [200, 150]) circle(cx, cy, Math.round(rr / P), (x, y) => (x + y) % 3 !== 0 && set(x, y, C.rune));
        for (let arm = 0; arm < 8; arm++) {
          const a0 = (arm / 8) * TAU;
          let px = cx + Math.cos(a0) * 12;
          let py = cy + Math.sin(a0) * 12;
          for (let s = 1; s <= 60; s++) {
            const t = s / 60;
            const x = cx + Math.cos(a0 + t * 1.7) * (12 + t * 46);
            const y = cy + Math.sin(a0 + t * 1.7) * (12 + t * 46);
            line(px, py, x, y, (lx, ly) => set(lx, ly, C.rune));
            px = x;
            py = y;
          }
          set(px, py, C.runeHi);
          set(px + 1, py, C.runeHi);
        }
        break;
      }
      case 'heartroot': {
        // Glowing veins running out across the floor between the great roots.
        for (let v = 0; v < 10; v++) {
          const a0 = (v / 10) * TAU + Math.PI / 10 + (rng() - 0.5) * 0.3;
          vein(cx + Math.cos(a0) * 42, cy + Math.sin(a0) * 42, a0, 40 + rng() * 60, rng, set, C.mushDim, C.mush);
        }
        break;
      }
      case 'fallen': {
        // Spore dust shed round the toppled cap, and little mushrooms sprouting from it.
        for (let y = -112; y <= 112; y++) {
          for (let x = -112; x <= 112; x++) {
            const d = Math.hypot(x, y);
            if (d < 60 || d > 112) continue;
            const X = Math.round(cx + x);
            const Y = Math.round(cy + y);
            if (hash2(X, Y, 701) < 0.07 * (1 - (d - 60) / 52)) set(X, Y, hash2(X, Y, 702) < 0.3 ? C.mush : C.mushDim);
          }
        }
        for (let i = 0; i < 16; i++) {
          const a = rng() * TAU;
          const d = 74 + rng() * 34;
          sprout(cx + Math.cos(a) * d, cy + Math.sin(a) * d, set, i % 2 === 0 ? C.mush : C.runeHi, C.moss1);
        }
        break;
      }
      case 'thicket': {
        // Trampled dark earth, tufts of thorny scrub and dead twigs strewn about.
        for (let y = -110; y <= 110; y++) {
          for (let x = -110; x <= 110; x++) {
            const d = Math.hypot(x, y);
            if (d < 110 && bayer(cx + x, cy + y) < (1 - d / 110) * 0.4) set(cx + x, cy + y, C.stone0);
          }
        }
        for (let i = 0; i < 26; i++) {
          const a = rng() * TAU;
          const d = Math.sqrt(rng()) * 105;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d;
          const spokes = 3 + Math.floor(rng() * 3);
          const turn = rng() * TAU;
          for (let k = 0; k < spokes; k++) {
            const b = turn + (k / spokes) * TAU + (rng() - 0.5) * 0.5;
            const len = 3 + rng() * 3;
            line(x, y, x + Math.cos(b) * len, y + Math.sin(b) * len, (lx, ly) => set(lx, ly, BRAMBLE.vine1));
            set(x + Math.cos(b) * (len + 1), y + Math.sin(b) * (len + 1), BRAMBLE.thorn);
          }
          set(x, y, BRAMBLE.edge);
        }
        for (let i = 0; i < 44; i++) {
          const a = rng() * TAU;
          const d = Math.sqrt(rng()) * 110;
          const x = cx + Math.cos(a) * d;
          const y = cy + Math.sin(a) * d;
          const b = rng() * TAU;
          const len = 3 + rng() * 5;
          line(x, y, x + Math.cos(b) * len, y + Math.sin(b) * len, (lx, ly) => set(lx, ly, BRAMBLE.stray));
          if (rng() < 0.6) set(x + Math.cos(b) * len * 0.5 - Math.sin(b) * 1.4, y + Math.sin(b) * len * 0.5 + Math.cos(b) * 1.4, BRAMBLE.vine1);
        }
        break;
      }
      case 'grotto': {
        // A carpet of spore dust and glowing moss across the Grotto's floor.
        for (let y = -90; y <= 90; y++) {
          for (let x = -230; x <= 230; x++) {
            const e = (x / 230) ** 2 + (y / 90) ** 2;
            if (e > 1) continue;
            const X = Math.round(cx + x);
            const Y = Math.round(cy + y + 10);
            const h = hash2(X, Y, 711);
            if (h < 0.05 * (1 - e)) set(X, Y, h < 0.012 ? C.mush : C.mushDim);
            else if (h > 0.985 - 0.04 * (1 - e)) set(X, Y, C.moss1);
          }
        }
        for (let i = 0; i < 10; i++) sprout(cx + (rng() - 0.5) * 400, cy + 10 + (rng() - 0.5) * 140, set, C.mush, C.moss1);
        break;
      }
      case 'bellcourt': {
        // A great bell inlaid in the floor, cracked through, inside a ring of runes.
        for (const rr of [240, 222]) circle(cx, cy, Math.round(rr / P), (x, y) => set(x, y, C.rune));
        glyphRing(cx, cy, 231 / P, set, C.runeHi);
        bellInlay(cx, cy, set, C);
        break;
      }
      case 'ossuary': {
        // Bones strewn over the hall's floor, with the odd skull.
        for (let i = 0; i < 70; i++) {
          const x = cx + (rng() - 0.5) * 780;
          const y = cy + 20 + (rng() - 0.5) * 230;
          if (rng() < 0.16) skull(x, y, set);
          else bone(x, y, rng() * TAU, 3 + rng() * 3, set);
        }
        break;
      }
      case 'kings': {
        // A royal border inlaid round the row of sarcophagi, a crown at each end and a dithered runner.
        const hw = 300;
        const hh = 34;
        for (const [o, hex] of [
          [0, C.rune],
          [3, C.runeHi],
        ] as const) {
          const keep = (x: number, y: number) => o === 0 || (x + y) % 2 === 0;
          line(cx - hw + o, cy - hh + o, cx + hw - o, cy - hh + o, (x, y) => keep(x, y) && set(x, y, hex));
          line(cx - hw + o, cy + hh - o, cx + hw - o, cy + hh - o, (x, y) => keep(x, y) && set(x, y, hex));
          line(cx - hw + o, cy - hh + o, cx - hw + o, cy + hh - o, (x, y) => keep(x, y) && set(x, y, hex));
          line(cx + hw - o, cy - hh + o, cx + hw - o, cy + hh - o, (x, y) => keep(x, y) && set(x, y, hex));
        }
        for (let y = -hh + 6; y <= hh - 6; y++) {
          for (let x = -hw + 6; x <= hw - 6; x++) if (bayer(x, y) < 0.13) set(cx + x, cy + y, C.rune);
        }
        for (const side of [-1, 1]) {
          const gx = Math.round(cx + side * (hw + 9)) - 2;
          const gy = Math.round(cy) - 1;
          for (let y = 0; y < CROWN.length; y++) for (let x = 0; x < 5; x++) if (CROWN[y][x] === '1') set(gx + x, gy + y, C.runeHi);
        }
        break;
      }
      case 'lake': {
        // The Frozen Lake: its landmark cell is open floor, so frost it over as a snowy islet...
        for (let y = -44; y <= 44; y++) {
          for (let x = -44; x <= 44; x++) {
            const X = cx + x;
            const Y = cy + y;
            const k = 1 - Math.max(Math.abs(x), Math.abs(y)) / 44;
            if (bayer(X, Y) < 0.25 + k * 0.6) set(X, Y, hash2(X, Y, 721) < 0.05 ? ICE.shine : bayer(X, Y) < 0.2 + k * 0.3 ? C.moss1 : (C.frost ?? ICE.frost));
          }
        }
        // ...then long cracks running out across the ice, and bubbles trapped in it.
        for (let i = 0; i < 8; i++) {
          let x = cx + (rng() - 0.5) * 20;
          let y = cy + (rng() - 0.5) * 20;
          let a = (i / 8) * TAU + rng() * 0.5;
          const len = 30 + rng() * 70;
          for (let s = 0; s < len; s++) {
            setIce(x, y, ICE.crack);
            if (s % 9 === 4) setIce(x - Math.sin(a), y + Math.cos(a), ICE.shine);
            a += (rng() - 0.5) * 0.5;
            x += Math.cos(a);
            y += Math.sin(a);
          }
        }
        for (let i = 0; i < 18; i++) {
          const a = rng() * TAU;
          const d = 10 + rng() * 90;
          circle(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1 + Math.floor(rng() * 2), (x, y) => setIce(x, y, ICE.shine));
        }
        break;
      }
    }
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
        const hz = job.hazards ? nearestSolid(this.map.hazardIndex!, (X + 0.5) * P, (Y + 0.5) * P, this.hazHit) : null;
        const ld = hz ? hz.d / P : Infinity;
        const kind: HazardKind = (hz?.solid as Hazard | null)?.name ?? 'lava';
        let hex: string;
        if (c.solid && d < 0) hex = this.stone(c.solid as Solid, X, Y, d, c.nx, c.ny);
        else if (c.solid && d < 1) hex = PX.ink;
        else if (ld < 0) hex = (kind === 'ice' ? job.iceMarks.get(li) : undefined) ?? hazardPixel(kind, X, Y, ld > -2.4 ? this.hazardDepth(X, Y, ld) : ld);
        else {
          const shore = ld < 3 ? shorePixel(kind, X, Y, ld) : null;
          if (shore) hex = shore;
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
            // Shadows cast down and to the right, and darkness pooled against the stone. The shadow's
            // sample point is 3.6 pixels away, so only pixels that close to stone can be in shadow.
            const shadowed = d < 3.7 && nearestSolid(index, (X + 0.5 - 2) * P, (Y + 0.5 - 3) * P, hit).d < 0;
            if ((shadowed && bayer(X, Y) < 0.6) || d < 1.6) hex = grout ? C.void : C.stone0;
          }
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

  /**
   * How deep inside hazard ground a pixel near some zone's edge really is. Grid cells of lava, ice
   * or brambles are merged into rectangles that abut, and a pixel beside a seam is near its own
   * rectangle's edge but deep in the hazard; probing its neighbours tells a true shore (rim, then
   * lip) from a seam.
   */
  private hazardDepth(X: number, Y: number, d: number): number {
    const hz = this.map.hazardIndex!;
    const out = (dx: number, dy: number) => clearanceAt(hz, (X + 0.5 + dx) * P, (Y + 0.5 + dy) * P) >= 0;
    if (out(1, 0) || out(-1, 0) || out(0, 1) || out(0, -1)) return Math.max(d, -1);
    if (out(2, 0) || out(-2, 0) || out(0, 2) || out(0, -2)) return Math.min(Math.max(d, -2.2), -1.3);
    return -2.5;
  }

  /** The floor: bevelled flagstones in a running bond with speckle (frosted in the Catacombs), or bare earth. */
  private flagstone(X: number, Y: number, salt: number): string {
    const C = this.C;
    if (C.ground === 'soil') return this.soil(X, Y, salt);
    const t = tileAt(X, Y);
    const frost = C.frost ? valueNoise(X, Y, 22, salt + 16) : 0;
    if (t.dx === 0 || t.dy === 0) return frost > 0.7 ? C.moss0 : C.grout;
    const shades = [C.stone1, C.stone2, C.stone2, C.stone3];
    const base = hash2(t.col, t.row, salt + 13) < 0.08 ? C.stone0 : shades[Math.floor(hash2(t.col, t.row, salt + 14) * 4)];
    const light = this.LIGHTER[base] ?? base;
    const lit = t.dx === 1 || t.dy === 1;
    let hex: string;
    if (lit) hex = light;
    else if (t.dx === T - 1 || t.dy === T - 1) hex = C.stone0;
    else {
      const n = hash2(X, Y, salt + 15);
      hex = n < 0.04 ? light : n < 0.08 ? C.stone0 : base;
    }
    // Rime: frost lying in drifts across the stones, catching on their lit edges.
    if (C.frost && frost > 0.56 && bayer(X, Y) < (frost - 0.56) * 3.2) hex = lit ? C.moss1 : C.frost;
    return hex;
  }

  /** Bare earth (the Hollows): soft drifts of three tones, broken up with grit. */
  private soil(X: number, Y: number, salt: number): string {
    const C = this.C;
    const g = hash2(X, Y, salt + 15);
    if (g < 0.025) return C.stoneHi;
    if (g < 0.06) return C.stone0;
    const n = valueNoise(X, Y, 14, salt + 13) * 0.7 + valueNoise(X, Y, 5, salt + 14) * 0.3 + (bayer(X, Y) - 0.5) * 0.12;
    return n < 0.4 ? C.stone1 : n < 0.6 ? C.stone2 : C.stone3;
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
      if (C.walls === 'roots') return this.roots(X, Y);
      if (C.walls === 'crypt') return this.crypt(X, Y);
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
    const fallen = s.name === 'stalk' && s.shape === 'capsule';
    const [c0, c1, c2, hi] = fallen ? FALLEN_STALK : (STONE_LOOKS[s.name] ?? (carved ? [C.carve0, C.carve1, C.carve2, C.carveHi] : [C.wall0, C.wall1, C.wall2, C.wallHi]));
    if (edge && facing < -0.3) return hi;
    if (edge && facing > 0.3) return c0;
    if (s.name === 'spire') {
      // Obsidian glass: thin bright streaks near the edge, darker towards the middle.
      if (-d < 4 && (((X - Y) % 6) + 6) % 6 === 0) return hi;
      return -d > 5 ? c1 : c2;
    }
    if (s.name === 'ridge') return hash2(X >> 1, Y >> 1, 79) < 0.06 ? LAVA.melt : hash2(X, Y, 80) < 0.1 ? c1 : c2;
    if (s.name === 'basalt') {
      // A hexagonal column top: a facet ring round a flat cap.
      return Math.abs(d + 3.5) < 0.6 ? c1 : -d > 6 ? c1 : c2;
    }
    if (s.name === 'colossus') {
      // Weathered: scattered pits and the odd crack.
      return hash2(X, Y, 77) < 0.05 ? c0 : hash2(X >> 2, Y >> 2, 78) < 0.08 ? c1 : c2;
    }
    if (s.shape === 'circle') {
      const cx = s.x / P;
      const cy = s.y / P;
      const R = s.r / P;
      const dx = X + 0.5 - cx;
      const dy = Y + 0.5 - cy;
      if (s.name === 'stalk') {
        // A glowcap from above: a glowing lip, pale spots, the dome lit towards the top-left.
        if (-d < 2.4) return bayer(X, Y) < 0.5 ? GLOW.lip : c1;
        const sx = X & 3;
        const sy = Y & 3;
        if (-d > 3 && ((sx === 2 && sy > 0) || (sy === 2 && sx > 0)) && hash2(X >> 2, Y >> 2, 81) < 0.16) return GLOW.spot;
        return dome(dx / R, dy / R, X, Y) > 0.4 ? c2 : c1;
      }
      if (s.name === 'cap') {
        // The Fallen Giant's cap: a glowing lip, gills showing round its rim, big pale spots on the dome.
        if (-d < 2.4) return bayer(X, Y) < 0.5 ? GLOW.capLip : c1;
        if (-d < 7) return Math.floor((Math.atan2(dy, dx) / TAU) * 120 + 120) % 2 === 0 ? c0 : c1;
        const gx = Math.floor(X / 12);
        const gy = Math.floor(Y / 12);
        const sx = gx * 12 + 3 + hash2(gx, gy, 90) * 6;
        const sy = gy * 12 + 3 + hash2(gx, gy, 91) * 6;
        const sr = 1.6 + hash2(gx, gy, 92) * 2;
        const sd = Math.hypot(X + 0.5 - sx, Y + 0.5 - sy);
        if (sd < sr && -d > 9 && hash2(gx, gy, 93) < 0.6) return sd > sr - 1 && X + Y > sx + sy ? GLOW.capSpotShade : GLOW.capSpot;
        const light = dome(dx / R, dy / R, X, Y);
        return light > 0.62 ? hi : light > 0.3 ? c2 : c1;
      }
      if (s.name === 'heartroot') {
        // The great trunk from above: bark furrows spiralling in to a glowing heart.
        const r = Math.hypot(dx, dy);
        if (r < 4) return bayer(X, Y) < 0.6 ? GLOW.core : GLOW.heart;
        if (r < 8) return bayer(X, Y) < (8 - r) / 4 ? GLOW.heart : c0;
        const f = ((((Math.atan2(dy, dx) / TAU) * 14 + r * 0.06) % 1) + 1) % 1;
        if (f < 0.16) return r < R * 0.6 && hash2(X >> 1, Y >> 1, 87) < 0.35 ? GLOW.vein : c0;
        if (f < 0.3) return c1;
        return hash2(X, Y, 88) < 0.06 ? c1 : c2;
      }
      if (s.name === 'icePillar') {
        // A column of ice from above: a glint across it, a facet ring and a deep blue core.
        if (Math.abs(dx + dy + R * 0.35) < 0.8 && Math.abs(dx - dy) < R * 0.9) return hi;
        if (Math.abs(d + 3.5) < 0.6) return c1;
        return -d > R * 0.62 ? c1 : c2;
      }
      // A pillar top: a carved ring and a worn centre.
      if (Math.abs(d + 4) < 0.6 || -d > R - 2.5) return c1;
      return c2;
    }
    if (s.shape === 'capsule') {
      const ex = s.bx - s.ax;
      const ey = s.by - s.ay;
      const len = Math.hypot(ex, ey) || 1;
      const along = (((X + 0.5) * P - s.ax) * ex + ((Y + 0.5) * P - s.ay) * ey) / len / P;
      const across = (-((X + 0.5) * P - s.ax) * ey + ((Y + 0.5) * P - s.ay) * ex) / len / P;
      if (s.name === 'root') {
        // Gnarled bark: furrows twisting along the root, a round knot here and there.
        const kx = (X >> 3) * 8 + 4;
        const ky = (Y >> 3) * 8 + 4;
        if (hash2(X >> 3, Y >> 3, 89) < 0.12) {
          const kd = Math.hypot(X + 0.5 - kx, Y + 0.5 - ky);
          if (kd < 1.3) return c0;
          if (kd < 2.4) return X + Y < kx + ky ? hi : c1;
        }
        const f = (((across + Math.sin(along * 0.25) * 1.2) % 3.5) + 3.5) % 3.5;
        return f < 0.9 ? c0 : f < 1.6 ? c1 : c2;
      }
      if (fallen) {
        // A toppled stalk: fibres running its length, the ring where its skirt was, its far side in shadow.
        const t = along / (len / P);
        if (t > 0.74 && t < 0.79) return -d > 3 ? c1 : c0;
        const away = Math.sign(ex - ey) || 1;
        if ((across * away) / (s.r / P) > 0.45 && bayer(X, Y) < 0.5) return c1;
        return ((across % 2.5) + 2.5) % 2.5 < 0.6 ? c1 : hash2(X, Y, 95) < 0.05 ? hi : c2;
      }
      // A toppled column: drum joints across it.
      if (Math.abs((along % 14) - 7) < 0.6) return c1;
      return c2;
    }
    if (s.name === 'sarcophagus') {
      // A lid with a carved effigy (a head, then a body broad at the shoulders and narrowing to
      // the feet, hands folded on the chest), rime along its top edge.
      if (Math.abs(d + 3) < 0.6) return c1;
      const w = (s.x1 - s.x0) / P;
      const h = (s.y1 - s.y0) / P;
      const horiz = w >= h;
      const u = horiz ? X + 0.5 - (s.x0 + s.x1) / 2 / P : Y + 0.5 - (s.y0 + s.y1) / 2 / P;
      const v = horiz ? Y + 0.5 - (s.y0 + s.y1) / 2 / P : X + 0.5 - (s.x0 + s.x1) / 2 / P;
      const L = Math.max(w, h) / 2;
      const uS = -L * 0.48;
      const uF = L * 0.72;
      const half = 6 - 2.5 * Math.min(1, Math.max(0, (u - uS) / (uF - uS)));
      const head = Math.hypot(u - (uS - 4.2), v) - 3.4;
      const body = Math.max(Math.abs(v) - half, uS - u, u - uF);
      const e = Math.min(head, body);
      if (Math.abs(e) < 0.6) return c0;
      if (e < 0) {
        if (Math.abs(u - (uS + 7)) + Math.abs(v) < 2.2) return c1;
        return e > -1.6 && u + v < 0 ? hi : c2;
      }
      if (Y + 0.5 - s.y0 / P < 3.5 && hash2(X, Y, 93) < 0.45) return hi;
      return hash2(X, Y, 94) < 0.05 ? c1 : c2;
    }
    // A statue's plinth or a free-standing block: an inset border.
    return Math.abs(d + 3) < 0.6 ? c1 : c2;
  }

  /** Root walls (the Hollows): thick strands woven two ways, furrowed, with the odd glowing fungus. */
  private roots(X: number, Y: number): string {
    const C = this.C;
    if (hash2(X, Y, 86) < 0.003) return C.runeHi;
    // Which way the top strands run swaps from patch to patch, so they look woven.
    const across = hash2(X >> 4, Y >> 4, 85) < 0.5;
    const w = across ? 7 : 6;
    const a = across ? X * 0.55 + Y * 0.35 + Math.sin(Y * 0.21 + X * 0.05) * 2.5 : X * 0.3 - Y * 0.6 + Math.sin(X * 0.17) * 2.5;
    const f = ((a % w) + w) % w;
    if (f < 0.9) return C.wall0;
    if (f < 1.9) return C.wall2;
    if (f > w - 1.1) return C.wall0;
    return hash2(X, Y, 96) < 0.08 ? C.wall0 : C.wall1;
  }

  /** Crypt masonry (the Catacombs): big dressed blocks in a running bond, rime along their tops. */
  private crypt(X: number, Y: number): string {
    const C = this.C;
    const course = Math.floor(Y / 7);
    const local = ((Y % 7) + 7) % 7;
    const pos = (((X + (course % 2 === 0 ? 0 : 7)) % 14) + 14) % 14;
    if (local === 0 || pos === 0) return C.wall0;
    if (local === 1) return bayer(X, Y) < 0.55 ? C.wallHi : C.wall2;
    if (pos === 13 || local === 6) return C.wall0;
    if (local === 2 && hash2(X, course, 97) < 0.3) return C.wall2;
    return hash2(X, Y, 98) < 0.05 ? C.wall0 : C.wall1;
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

/** A pixel of hazard ground `d` art pixels inside its edge. */
function hazardPixel(kind: HazardKind, X: number, Y: number, d: number): string {
  return kind === 'bramble' ? bramblePixel(X, Y, d) : kind === 'ice' ? icePixel(X, Y, d) : lavaPixel(X, Y, d);
}

/** Just outside hazard ground: lava's dark shore, a bramble's outline and stray thorns, ice's edge and frost; null for plain floor. */
function shorePixel(kind: HazardKind, X: number, Y: number, d: number): string | null {
  if (kind === 'lava') return d < 1.2 || bayer(X, Y) < 0.5 ? LAVA.shore0 : LAVA.shore1;
  if (kind === 'bramble') return d < 1.2 ? BRAMBLE.edge : hash2(X, Y, 972) < 0.14 ? BRAMBLE.stray : null;
  return d < 1.2 ? ICE.edge : bayer(X, Y) < 0.3 ? ICE.frost : null;
}

/** A pixel of molten lava `d` art pixels inside its shore: cooling plates over bright melt. */
function lavaPixel(X: number, Y: number, d: number): string {
  if (d > -1.2) return LAVA.rim;
  const n = hash2(X >> 2, Y >> 2, 950);
  const th = bayer(X, Y);
  if (n < 0.22) return th < 0.8 ? LAVA.plate : LAVA.melt;
  if (n < 0.7) return LAVA.melt;
  if (n < 0.92) return th < 0.6 ? LAVA.hot : LAVA.melt;
  return th < 0.5 ? LAVA.white : LAVA.hot;
}

/** A pixel of brambles: a bright rim, then two families of wavy vines crossing over the dark, thorns sprouting off them. */
function bramblePixel(X: number, Y: number, d: number): string {
  if (d > -1.2) return BRAMBLE.rim;
  // Slow noise bends the vines and swells or thins them, so the tangle doesn't repeat.
  const a = Math.abs(Math.sin(X * 0.42 + Math.sin(Y * 0.23) * 1.8 + valueNoise(X, Y, 12, 973) * 4));
  const b = Math.abs(Math.sin(Y * 0.38 - X * 0.12 + Math.sin(X * 0.19) * 1.6 + valueNoise(X, Y, 15, 974) * 4));
  const w = 0.14 + 0.14 * valueNoise(X, Y, 9, 979);
  const h = hash2(X, Y, 970);
  if (a < w || b < w) {
    if (h < 0.1) return BRAMBLE.thorn;
    return a < w && b < w ? BRAMBLE.vine1 : bayer(X, Y) < 0.6 ? BRAMBLE.vine1 : BRAMBLE.vine0;
  }
  // Thorns: single bright pixels just off a vine.
  if ((a < w * 2 || b < w * 2) && h < 0.1) return BRAMBLE.thorn;
  return h > 0.93 ? BRAMBLE.vine0 : BRAMBLE.base;
}

/** A pixel of an ice sheet: a white rim, broken sheen streaks and cracks over pale ice, with darker patches where it's deep. */
function icePixel(X: number, Y: number, d: number): string {
  if (d > -1.2) return ICE.rim;
  if (d > -2.4) return ICE.lip;
  const diag = X + Y;
  const band = Math.floor(diag / 29);
  const o = diag - band * 29;
  if ((o === 0 || (o === 3 && bayer(X, Y) < 0.5)) && hash2(band, (X - Y) >> 4, 977) < 0.35) return ICE.shine;
  const crackA = Math.abs((((X * 0.8 - Y * 0.6 + Math.sin(Y * 0.07) * 6) % 47) + 47) % 47 - 23.5) > 23;
  const crackB = Math.abs((((X * 0.35 + Y * 0.94 + Math.sin(X * 0.05) * 7) % 61) + 61) % 61 - 30.5) > 30;
  if ((crackA || crackB) && hash2(X >> 3, Y >> 3, 975) < 0.55) return ICE.crack;
  const n = valueNoise(X, Y, 18, 978) + (bayer(X, Y) - 0.5) * 0.2;
  return n > 0.7 && bayer(X, Y) < 0.5 + (n - 0.7) * 3 ? ICE.deep : n > 0.45 ? ICE.sheet1 : ICE.sheet0;
}

/** A spore vent (local x, y, radius r from its middle): a dark pit glowing magenta, spore dust, a ring of tiny glowcaps. */
function sporeVentPixel(C: FloorPalette, X: number, Y: number, x: number, y: number, r: number): string | null {
  if (r < 2.5) return '#05020a';
  if (r < 4.5) return bayer(X, Y) < 0.6 ? PX.spore1 : PX.cap1;
  if (r < 9) return bayer(X, Y) < 0.1 + 0.35 * (1 - (r - 4.5) / 4.5) ? PX.spore0 : null;
  if (r > 10.5 && r < 13) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const d = Math.hypot(x - Math.cos(a) * 11.6, y * 1.1 - Math.sin(a) * 11.6);
      if (d < 0.9) return i % 2 === 0 ? C.runeHi : C.mush;
      if (d < 1.6 && y > Math.sin(a) * 11.6 / 1.1) return C.mushDim;
    }
  }
  return null;
}

/** Where icicles fall (local x, y, radius r): a frost ring marked on the stone, shattered ice and cracks inside. */
function icicleVentPixel(C: FloorPalette, X: number, Y: number, x: number, y: number, r: number): string | null {
  if (r > 10.5 && r < 12.2) return bayer(X, Y) < 0.6 ? ICE.lip : (C.frost ?? ICE.frost);
  if (r < 1.5) return C.grout;
  if (r < 8) {
    const a = Math.atan2(y, x);
    for (let k = 0; k < 5; k++) {
      let da = Math.abs(a - ((k / 5) * TAU + 0.3));
      da = Math.min(da, TAU - da);
      if (da * r < 0.55) return C.grout;
    }
    const h = hash2(X, Y, 990);
    if (h < 0.12) return ICE.shine;
    if (h < 0.22) return ICE.sheet0;
  }
  return null;
}

/** 0..1 lighting across a dome (dx, dy from its middle in radii): brightest a little up-left of the crown, dithered. */
function dome(dx: number, dy: number, X: number, Y: number): number {
  return 0.55 - 0.32 * (dx + dy) - 0.35 * (dx * dx + dy * dy) + (bayer(X, Y) - 0.5) * 0.18;
}

/** Smooth value noise in [0, 1) on a `cell`-pixel lattice. */
function valueNoise(X: number, Y: number, cell: number, salt: number): number {
  const gx = X / cell;
  const gy = Y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Sixteen rune glyphs round a circle of radius `r`. */
function glyphRing(cx: number, cy: number, r: number, set: Plot, hex: string): void {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const gx = Math.round(cx + Math.cos(a) * r) - 1;
    const gy = Math.round(cy + Math.sin(a) * r) - 2;
    const glyph = GLYPHS[i % GLYPHS.length];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y][x] === '1') set(gx + x, gy + y, hex);
  }
}

/** A glowing vein wandering out from (x, y) along `a`, forking once or twice, brightening at its knots. */
function vein(x: number, y: number, a: number, len: number, rng: () => number, set: Plot, dim: string, bright: string): void {
  for (let s = 0; s < len; s++) {
    set(x, y, s % 11 === 5 ? bright : dim);
    a += (rng() - 0.5) * 0.4;
    x += Math.cos(a);
    y += Math.sin(a);
    if (s > 10 && rng() < 0.03) vein(x, y, a + (rng() < 0.5 ? 0.7 : -0.7), (len - s) * 0.5, rng, set, dim, bright);
  }
  set(x, y, bright);
  set(x + 1, y, bright);
}

/** A tiny mushroom: a two-pixel cap over a stem. */
function sprout(x: number, y: number, set: Plot, cap: string, stem: string): void {
  set(x, y, cap);
  set(x + 1, y, cap);
  set(x, y + 1, stem);
}

/** A bone on the floor: a shaft with knobbed ends. */
function bone(x: number, y: number, a: number, len: number, set: Plot): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x1 = x + c * len;
  const y1 = y + s * len;
  line(x + 1, y + 1, x1 + 1, y1 + 1, (lx, ly) => set(lx, ly, BONE.dark));
  line(x, y, x1, y1, (lx, ly) => set(lx, ly, BONE.mid));
  for (const [ex, ey] of [
    [x, y],
    [x1, y1],
  ]) {
    set(ex - s, ey + c, BONE.hi);
    set(ex + s, ey - c, BONE.lo);
  }
}

/** A skull on the floor, seen from above: a dome with two dark sockets. */
function skull(x: number, y: number, set: Plot): void {
  const rows = ['.hh.', 'hmmh', 'dmmd', '.ml.'];
  const col: Record<string, string> = { h: BONE.hi, m: BONE.mid, l: BONE.lo, d: BONE.dark };
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < 4; i++) if (col[rows[j][i]]) set(x + i, y + j, col[rows[j][i]]);
  set(x + 1, y + 4, BONE.dark);
  set(x + 2, y + 4, BONE.dark);
}

/** The Bell Court's inlay: a great bell outlined in the floor, a faint fill, its clapper, and a crack through it. */
function bellInlay(cx: number, cy: number, set: Plot, C: FloorPalette): void {
  const half = (y: number) => (y < -24 ? Math.sqrt(Math.max(0, 100 - (y + 24) ** 2)) : y < 24 ? 10 + 14 * ((y + 24) / 48) ** 2 : 30);
  const inside = (x: number, y: number) => y >= -34 && y <= 30 && Math.abs(x) <= half(y);
  for (let y = -38; y <= 32; y++) {
    for (let x = -32; x <= 32; x++) {
      if (!inside(x, y)) continue;
      const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (rim) set(cx + x, cy + y, C.runeHi);
      else if (bayer(x, y) < 0.2) set(cx + x, cy + y, C.rune);
      else if (Math.abs(y - 18) < 0.5 || Math.abs(y - 21) < 0.5) set(cx + x, cy + y, C.rune);
    }
  }
  // The crown loop on top, and the clapper.
  circle(Math.round(cx), Math.round(cy - 38), 3, (x, y) => set(x, y, C.runeHi));
  circle(Math.round(cx), Math.round(cy + 26), 3, (x, y) => set(x, y, C.runeHi));
  // The crack, from the shoulder down through the lip, with a dark shadow beside it.
  const crack = [
    [-5, -30],
    [-2, -20],
    [-6, -12],
    [1, -2],
    [-2, 6],
    [5, 14],
    [3, 22],
    [9, 31],
  ];
  for (let i = 1; i < crack.length; i++) {
    const [ax, ay] = crack[i - 1];
    const [bx, by] = crack[i];
    line(cx + ax + 1, cy + ay, cx + bx + 1, cy + by, (x, y) => set(x, y, C.void, true));
    line(cx + ax, cy + ay, cx + bx, cy + by, (x, y) => set(x, y, C.grout, true));
  }
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
