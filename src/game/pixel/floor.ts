import { ARENA, PIXEL_ART } from '../config';
import { mulberry32 } from '../math';
import { bayer, createCanvas, hexRgb } from './bake';
import { PX } from './palette';

export interface PixelFloor {
  canvas: HTMLCanvasElement;
  /** Torch positions in low-res pixels (flames are animated by the renderer). */
  torches: { x: number; y: number }[];
}

const enum Kind {
  Stone,
  Grout,
  Wall,
}

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

const LIGHTER: Record<string, string> = {
  [PX.stone0]: PX.stone1,
  [PX.stone1]: PX.stone2,
  [PX.stone2]: PX.stone3,
  [PX.stone3]: PX.stoneHi,
};

/** Builds the whole arena floor + walls as one low-res image, pixel by pixel. */
export function buildPixelFloor(): PixelFloor {
  const P = PIXEL_ART.worldPerPixel;
  const LW = Math.round(ARENA.width / P);
  const LH = Math.round(ARENA.height / P);
  const WB = Math.round(ARENA.wall / P);
  const rng = mulberry32(4242);
  const canvas = createCanvas(LW, LH);
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(LW, LH);
  const kind = new Uint8Array(LW * LH);

  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < LW && y < LH;
  const set = (x: number, y: number, hex: string, k?: Kind) => {
    x = Math.round(x);
    y = Math.round(y);
    if (!inside(x, y)) return;
    const [r, gg, b] = hexRgb(hex);
    const i = (y * LW + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = gg;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
    if (k !== undefined) kind[y * LW + x] = k;
  };
  const kindAt = (x: number, y: number) => (inside(x, y) ? kind[y * LW + x] : Kind.Wall);
  const line = (x0: number, y0: number, x1: number, y1: number, hex: string) => {
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
      set(x0, y0, hex);
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
  };
  const circle = (cx: number, cy: number, r: number, hex: string) => {
    let x = r;
    let y = 0;
    let err = 1 - r;
    while (x >= y) {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) set(cx + px, cy + py, hex);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  };

  // --- Flagstones: bevelled slabs in a running bond, with cracks, chips and speckle.
  const T = 16;
  const shades = [PX.stone1, PX.stone2, PX.stone2, PX.stone3];
  for (let row = 0; row * T < LH; row++) {
    const off = (row % 2) * (T / 2);
    for (let col = -1; col * T - off < LW; col++) {
      const x0 = col * T + off;
      const y0 = row * T;
      const base = rng() < 0.08 ? PX.stone0 : shades[Math.floor(rng() * shades.length)];
      const light = LIGHTER[base] ?? base;
      for (let dy = 0; dy < T; dy++) {
        for (let dx = 0; dx < T; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          if (dx === 0 || dy === 0) set(x, y, PX.grout, Kind.Grout);
          else if (dx === 1 || dy === 1) set(x, y, light, Kind.Stone);
          else if (dx === T - 1 || dy === T - 1) set(x, y, PX.stone0, Kind.Stone);
          else {
            const n = rng();
            set(x, y, n < 0.04 ? light : n < 0.08 ? PX.stone0 : base, Kind.Stone);
          }
        }
      }
      if (rng() < 0.15) {
        let cx = x0 + 4 + Math.floor(rng() * 8);
        let cy = y0 + 4 + Math.floor(rng() * 8);
        const steps = 4 + Math.floor(rng() * 5);
        const bias = rng() < 0.5 ? 1 : -1;
        for (let s = 0; s < steps; s++) {
          set(cx, cy, PX.grout, Kind.Grout);
          cx += rng() < 0.6 ? bias : 0;
          cy += rng() < 0.6 ? 1 : 0;
        }
      }
      if (rng() < 0.12) {
        // chipped corner
        set(x0 + 1, y0 + 1, PX.grout, Kind.Grout);
        set(x0 + 2, y0 + 1, PX.grout, Kind.Grout);
        set(x0 + 1, y0 + 2, PX.grout, Kind.Grout);
      }
    }
  }

  // --- Moss creeping out of the grout lines and cracks, densest near the walls.
  for (let i = 0; i < 26; i++) {
    const nearWall = rng() < 0.65;
    let mx = rng() * LW;
    let my = rng() * LH;
    if (nearWall) {
      if (rng() < 0.5) mx = rng() < 0.5 ? WB + rng() * 30 : LW - WB - rng() * 30;
      else my = rng() < 0.5 ? WB + rng() * 24 : LH - WB - rng() * 24;
    }
    const r = 7 + rng() * 11;
    for (let y = Math.floor(my - r); y <= my + r; y++) {
      for (let x = Math.floor(mx - r); x <= mx + r; x++) {
        const d = Math.hypot(x - mx, y - my);
        if (d > r) continue;
        const intensity = 1 - d / r;
        const k = kindAt(x, y);
        if (k === Kind.Grout) {
          if (rng() < intensity * 1.3) set(x, y, PX.moss1);
        } else if (k === Kind.Stone) {
          // Only stone right next to a grout line gets moss, so it hugs the cracks.
          const touchesGrout =
            kindAt(x - 1, y) === Kind.Grout || kindAt(x + 1, y) === Kind.Grout || kindAt(x, y - 1) === Kind.Grout || kindAt(x, y + 1) === Kind.Grout;
          if (touchesGrout && rng() < intensity * 0.55) set(x, y, PX.moss0);
        }
      }
    }
  }

  // --- Ancient summoning circle with runes.
  const cx = LW / 2;
  const cy = LH / 2;
  circle(cx, cy, Math.round(210 / P), PX.rune);
  circle(cx, cy, Math.round(190 / P), PX.rune);
  circle(cx, cy, Math.round(120 / P), PX.rune);
  const hr = 190 / P;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const b = ((i + 2) / 6) * Math.PI * 2 - Math.PI / 2;
    line(cx + Math.cos(a) * hr, cy + Math.sin(a) * hr, cx + Math.cos(b) * hr, cy + Math.sin(b) * hr, PX.rune);
  }
  const glyphR = 200 / P;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const gx = Math.round(cx + Math.cos(a) * glyphR) - 1;
    const gy = Math.round(cy + Math.sin(a) * glyphR) - 2;
    const glyph = GLYPHS[i % GLYPHS.length];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y][x] === '1') set(gx + x, gy + y, PX.runeHi);
  }

  // --- Rubble pebbles and glowing mushrooms near the walls.
  const nearEdge = () => {
    if (rng() < 0.5) return { x: rng() < 0.5 ? WB + 2 + rng() * 22 : LW - WB - 3 - rng() * 22, y: WB + 2 + rng() * (LH - 2 * WB - 4) };
    return { x: WB + 2 + rng() * (LW - 2 * WB - 4), y: rng() < 0.5 ? WB + 2 + rng() * 16 : LH - WB - 3 - rng() * 16 };
  };
  for (let i = 0; i < 70; i++) {
    const p = nearEdge();
    set(p.x, p.y, PX.stone0);
    set(p.x + 1, p.y, PX.stone0);
    set(p.x, p.y - 1, PX.stoneHi);
    if (rng() < 0.4) set(p.x + 1, p.y - 1, PX.stone3);
  }
  for (let i = 0; i < 30; i++) {
    const p = nearEdge();
    set(p.x, p.y, PX.mush);
    set(p.x, p.y + 1, PX.mushDim);
    if (rng() < 0.6) {
      set(p.x + 2, p.y + 1, PX.mushDim);
      set(p.x + 2, p.y + 2, PX.moss1);
    }
  }

  // --- Dithered vignette darkens the far corners.
  for (let y = WB; y < LH - WB; y++) {
    for (let x = WB; x < LW - WB; x++) {
      const nx = (x - cx) / cx;
      const ny = (y - cy) / cy;
      const v = Math.max(0, Math.hypot(nx * 0.9, ny) - 0.82) / 0.5;
      if (v > 0 && bayer(x, y) < v * 0.45) set(x, y, kindAt(x, y) === Kind.Grout ? PX.void : PX.stone0);
    }
  }

  // --- Torches on the top and bottom walls cast warm dithered light pools.
  const torches: { x: number; y: number }[] = [];
  for (const i of [1, 2, 4, 5]) {
    torches.push({ x: Math.round((LW / 6) * i), y: WB - 3 });
    torches.push({ x: Math.round((LW / 6) * i), y: LH - WB + 2 });
  }
  for (const t of torches) {
    // Solid warm core with a short dithered falloff, rather than a wide dither field.
    const R = 26;
    for (let y = t.y - R; y <= t.y + R; y++) {
      for (let x = t.x - R; x <= t.x + R; x++) {
        if (x < WB || x >= LW - WB || y < WB || y >= LH - WB) continue;
        if (kindAt(x, y) !== Kind.Stone) continue;
        const d = Math.hypot(x - t.x, (y - t.y) * 1.4);
        if (d > R) continue;
        const k = 1 - d / R;
        const th = bayer(x, y);
        if (k > 0.62) set(x, y, k > 0.8 ? PX.torchGlow2 : th < (k - 0.62) * 5 ? PX.torchGlow2 : PX.torchGlow);
        else if (k > 0.35) set(x, y, PX.torchGlow);
        else if (th < (k / 0.35) * 0.5) set(x, y, PX.torchGlow);
      }
    }
  }

  // --- Walls: brick courses, a lit inner rim and a shadow line on the floor.
  const brick = (x: number, y: number, horizontal: boolean) => {
    const along = horizontal ? x : y;
    const across = horizontal ? y : x;
    const course = Math.floor(across / 5);
    const local = across % 5;
    const shift = course % 2 === 0 ? 0 : 6;
    const pos = (along + shift) % 12;
    if (local === 0 || pos === 0) return PX.wall0;
    if (local === 1) return PX.wall2;
    if (pos === 11 || local === 4) return PX.wall0;
    return PX.wall1;
  };
  for (let y = 0; y < LH; y++) {
    for (let x = 0; x < LW; x++) {
      const top = y < WB;
      const bottom = y >= LH - WB;
      const left = x < WB;
      const right = x >= LW - WB;
      if (!(top || bottom || left || right)) continue;
      const horizontal = top || bottom;
      const yy = bottom ? y - (LH - WB) : y;
      const xx = right ? x - (LW - WB) : x;
      set(x, y, brick(horizontal ? x : xx, horizontal ? yy : y, horizontal), Kind.Wall);
    }
  }
  for (let x = WB - 1; x <= LW - WB; x++) {
    set(x, WB - 1, PX.wallHi, Kind.Wall);
    set(x, WB, PX.ink);
    if (bayer(x, WB + 1) < 0.5) set(x, WB + 1, PX.ink);
    set(x, LH - WB, PX.wallHi, Kind.Wall);
    set(x, LH - WB - 1, PX.ink);
  }
  for (let y = WB - 1; y <= LH - WB; y++) {
    set(WB - 1, y, PX.wallHi, Kind.Wall);
    set(WB, y, PX.ink);
    if (bayer(WB + 1, y) < 0.5) set(WB + 1, y, PX.ink);
    set(LW - WB, y, PX.wallHi, Kind.Wall);
    set(LW - WB - 1, y, PX.ink);
  }

  // --- Broken pillars embedded in the walls.
  const pillars = [
    [WB, WB],
    [LW - WB, WB],
    [WB, LH - WB],
    [LW - WB, LH - WB],
    [LW / 2, WB - 2],
    [LW / 2, LH - WB + 2],
    [WB - 2, LH / 2],
    [LW - WB + 2, LH / 2],
  ];
  const PR = 11;
  for (const [px, py] of pillars) {
    const inDisc = (x: number, y: number) => Math.hypot(x - px, y - py) <= PR + 0.3;
    for (let y = Math.floor(py - PR - 1); y <= py + PR + 1; y++) {
      for (let x = Math.floor(px - PR - 1); x <= px + PR + 1; x++) {
        if (inDisc(x, y)) {
          const d = Math.hypot(x - px, y - py);
          let col: string = PX.wall2;
          if (!inDisc(x - 1, y - 1)) col = PX.wallHi;
          else if (!inDisc(x + 1, y + 1)) col = PX.wall0;
          else if (Math.abs(d - 7) < 0.6) col = PX.wall1;
          else if (d < 3) col = PX.wall1;
          set(x, y, col, Kind.Wall);
        } else if (inDisc(x - 1, y) || inDisc(x + 1, y) || inDisc(x, y - 1) || inDisc(x, y + 1)) {
          set(x, y, PX.ink, Kind.Wall);
        }
      }
    }
  }

  // --- Torch brackets (flames are drawn per frame).
  for (const t of torches) {
    set(t.x - 1, t.y + 1, PX.ink);
    set(t.x, t.y + 1, PX.wall0);
    set(t.x + 1, t.y + 1, PX.ink);
    set(t.x, t.y + 2, PX.ink);
  }

  g.putImageData(img, 0, 0);
  return { canvas, torches };
}
