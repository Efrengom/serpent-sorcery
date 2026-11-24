// Draws the shop's icons (its stat lines, the Grimoire's tools, each map's waystone and the relics
// the Grimoire sells) and writes them to src/ui/shopIcons.ts as rows of pixels.
//
// Each icon is a 16×16 mask of materials, built from simple shapes below. Every material is shaded
// as a rounded form lit from the top left, as the sprites are, from its highlight to its shadow;
// lowercase letters are detail pixels of one fixed colour; 'k' is ink, and ink outlines the whole.
//
//   node scripts/shop-icons.mjs                    rewrite src/ui/shopIcons.ts
//   node scripts/shop-icons.mjs --sheet out.png    and draw a contact sheet of them (1x to 6x)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'ui', 'shopIcons.ts');
const N = 16;
const INK = '#0d0718';
/** The light, from the top left and in front, as the sprites have it. */
const LIGHT = (() => {
  const v = [-0.62, -0.62, 0.48];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

// ---------------------------------------------------------------- shapes

const blank = () => Array.from({ length: N }, () => Array(N).fill('.'));
const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
const fromRows = (rows) => Array.from({ length: N }, (_, y) => [...(rows[y] ?? '').padEnd(N, '.')]);

/** Pixels whose centres fall in a disc. */
function disc(g, cx, cy, r, ch) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g[y][x] = ch;
}

/** Pixels within r of a line through the points. */
function line(g, pts, r, ch) {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
        if ((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= r * r) {
          g[y][x] = ch;
          break;
        }
      }
    }
}

/** Pixels whose centres fall in a polygon. */
function poly(g, pts, ch) {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let on = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) on = !on;
      }
      if (on) g[y][x] = ch;
    }
}

/** Rows of characters set down at (x, y); spaces leave what's there. */
function stamp(g, x, y, rows) {
  rows.forEach((r, j) => [...r].forEach((c, i) => c !== ' ' && inside(x + i, y + j) && (g[y + j][x + i] = c)));
}

/** Points along an arc round (cx, cy), from a0 to a1 degrees. */
function arc(cx, cy, r, a0, a1) {
  return Array.from({ length: 9 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / 8) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/** A diamond-shaped gem with an ink rim, over whatever is there. */
function gem(g, cx, cy, w, h, ch) {
  const d = (ww, hh, c) => poly(g, [[cx, cy - hh / 2], [cx + ww / 2, cy], [cx, cy + hh / 2], [cx - ww / 2, cy]], c);
  d(w + 2.4, h + 2.4, 'k');
  d(w, h, ch);
}

/** A star of `points` points round (cx, cy), alternating between the outer and inner radii. */
function star(g, points, outer, inner, ch, cx = 8, cy = 8) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = typeof outer === 'function' ? (i % 2 ? inner : outer(i / 2)) : i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  poly(g, pts, ch);
}

// ---------------------------------------------------------------- materials: highlight, base, shade, deep

const RED = ['#ffd0da', '#ff7a92', '#e63a5e', '#8a1f3c'];
const STEEL = ['#f0f6ff', '#b9c6dc', '#8592b0', '#4a5372'];
const TEAL = ['#a8ffe2', '#2fd3b5', '#16907d', '#0d5a52'];
const GREEN = ['#f2ffe2', '#8cff6a', '#4fd04a', '#1f6a2a'];
const GOLD = ['#fff6c8', '#ffd45e', '#f0a830', '#a8620e'];
const PURPLE = ['#e0ccff', '#b48cff', '#7d45dc', '#4d2496'];
const CYAN = ['#eaffff', '#5ff6ff', '#2ab8d0', '#0f5a6a'];
const PINK = ['#ffe0f8', '#ff8ad8', '#c03c9e', '#7a1a66'];
const GLASS = ['#ffffff', '#d8f0ff', '#9fc4e8', '#5a7aa8'];
const WOOD = ['#d8a070', '#a8703e', '#7a4a26', '#4a2a14'];
const PAPER = ['#fffaf0', '#eee4cc', '#c8b898', '#8a7a5c'];
const FLAME = ['#fff3c4', '#ffd45e', '#ff9a3c', '#d0441e'];
const STONE = ['#c8c0e0', '#8f86a8', '#5f5678', '#3e3654'];
const CRYSTAL = ['#f4eeff', '#c8b8ff', '#a08cf0', '#6a58b0'];

// ---------------------------------------------------------------- the icons

/** A standing stone on a map's ground, its rune glowing in the map's colour. */
function waystone(glow, core, ground) {
  const g = blank();
  poly(g, [[5, 1], [9.5, 0.8], [12, 4], [12.6, 13.5], [3.2, 13.5], [3.6, 4]], 'S');
  poly(g, [[0.5, 15.6], [2.5, 12.6], [13.5, 12.6], [15.5, 15.6]], 'D');
  stamp(g, 5, 4, [' gggg ', 'gg  gg', 'g cc g', 'g cc g', 'gg  gg', ' gggg ']);
  return { grid: g, mats: { S: STONE, D: ground }, fixed: { g: glow, c: core } };
}

const SHOP = {
  // Hardy Scales: a heart.
  health: () => ({
    grid: fromRows([
      '',
      '',
      '...RRR....RRR...',
      '..RRRRR..RRRRR..',
      '..RRRRRRRRRRRR..',
      '..RRRRRRRRRRRR..',
      '..RRRRRRRRRRRR..',
      '...RRRRRRRRRR...',
      '....RRRRRRRR....',
      '.....RRRRRR.....',
      '......RRRR......',
      '.......RR.......',
    ]),
    mats: { R: RED },
  }),
  // Ironscale Hide: a steel shield with a serpent's scale on it.
  hide: () => ({
    grid: fromRows([
      '',
      '..SSSSSSSSSSSS..',
      '..SSSSSkkSSSSS..',
      '..SSSSkTTkSSSS..',
      '..SSSkTTTTkSSS..',
      '..SSSkTTTTkSSS..',
      '..SSSkTTTTkSSS..',
      '...SSSkTTkSSS...',
      '...SSSSkkSSSS...',
      '....SSSSSSSS....',
      '.....SSSSSS.....',
      '......SSSS......',
      '.......SS.......',
    ]),
    mats: { S: STEEL, T: TEAL },
  }),
  // Mending Coils: a green cross, sparkling.
  mending: () => {
    const g = blank();
    poly(g, [[6, 3], [10, 3], [10, 6], [13, 6], [13, 10], [10, 10], [10, 13], [6, 13], [6, 10], [3, 10], [3, 6], [6, 6]], 'G');
    stamp(g, 12, 0, [' w ', 'www', ' w ']);
    stamp(g, 1, 12, [' g ', 'gwg', ' g ']);
    return { grid: g, mats: { G: GREEN }, fixed: { w: '#ffffff', g: '#8cff6a' } };
  },
  // Sharpened Focus: a fireball, white-hot at its head.
  damage: () => {
    const g = blank();
    poly(g, [[7.6, 2.6], [13.4, 8.4], [1.5, 14.5]], 'F');
    disc(g, 10.5, 5.5, 3.9, 'F');
    line(g, [[8.2, 9.4], [3.5, 13]], 0.45, '.');
    line(g, [[6, 6.6], [2.5, 9.5]], 1.0, 'F');
    line(g, [[9.6, 11.2], [6.5, 14.5]], 1.0, 'F');
    return { grid: g, mats: { F: { ramp: FLAME, core: [11, 4.8], radius: 8 } } };
  },
  // Rune Fluency: an hourglass, its sand running.
  fluency: () => ({
    grid: fromRows([
      '',
      '..WWWWWWWWWWWW..',
      '..WWWWWWWWWWWW..',
      '...GGGGGGGGGG...',
      '...GGGGGGGGGG...',
      '....GYYYYYYG....',
      '.....GYYYYG.....',
      '......GYYG......',
      '......GGYG......',
      '.....GGGYGG.....',
      '....GGGGYGGG....',
      '...GGGGYYYGGG...',
      '...GGYYYYYYYG...',
      '..WWWWWWWWWWWW..',
      '..WWWWWWWWWWWW..',
    ]),
    mats: { W: WOOD, G: GLASS, Y: GOLD },
  }),
  // Ancient Wisdom: an open book.
  wisdom: () => ({
    grid: fromRows([
      '',
      '',
      '',
      '.PPPPPP..PPPPPP.',
      '.PPPPPPkkPPPPPP.',
      '.PllllPkkPllllP.',
      '.PPPPPPkkPPPPPP.',
      '.PllllPkkPlllPP.',
      '.PPPPPPkkPPPPPP.',
      '.PlllPPkkPllllP.',
      '.PPPPPPkkPPPPPP.',
      '.PPPPPPkkPPPPPP.',
      '.CCCCCCkkCCCCCC.',
      '..CCCCCCCCCCCC..',
    ]),
    mats: { P: PAPER, C: PURPLE },
    fixed: { l: '#8a7a9c' },
  }),
  // Lodestone Fangs: a magnet drawing in a crystal.
  pickup: () => ({
    grid: fromRows([
      '',
      '.......XX.......',
      '......XXXX......',
      '.......XX.......',
      '..SSSS....SSSS..',
      '..SSSS....SSSS..',
      '..RRRR....RRRR..',
      '..RRRR....RRRR..',
      '..RRRR....RRRR..',
      '..RRRRR..RRRRR..',
      '..RRRRRRRRRRRR..',
      '...RRRRRRRRRR...',
      '....RRRRRRRR....',
    ]),
    mats: { R: RED, S: STEEL, X: CRYSTAL },
  }),
  // Long Coils: a serpent, curving.
  length: () => {
    const g = blank();
    line(g, [[11, 6], [9, 8], [6, 8.5], [4, 10], [4.5, 12], [7, 13], [10, 13], [12.5, 12]], 1.45, 'B');
    line(g, [[12.5, 12], [14, 10.5]], 0.9, 'B');
    disc(g, 11.6, 4.0, 2.7, 'B');
    stamp(g, 12, 3, ['ek']);
    stamp(g, 15, 4, ['r']);
    return { grid: g, mats: { B: TEAL }, fixed: { e: '#ffffff', r: '#ff5a7a' } };
  },
  // Lingering Elixirs: a potion, and a clock.
  lingering: () => {
    const g = blank();
    disc(g, 7, 9.5, 4.6, 'G');
    poly(g, [[5, 2], [9, 2], [9, 6], [5, 6]], 'G');
    poly(g, [[4.5, 0.5], [9.5, 0.5], [9.5, 2.5], [4.5, 2.5]], 'W');
    for (let y = 9; y < N; y++) for (let x = 0; x < N; x++) if (g[y][x] === 'G') g[y][x] = 'P';
    disc(g, 12.5, 12.5, 3.4, 'k');
    disc(g, 12.5, 12.5, 2.6, 'C');
    stamp(g, 12, 11, ['k', 'kk']);
    return { grid: g, mats: { G: GLASS, P: PINK, W: WOOD, C: PAPER } };
  },
  // Fortune's Eye: a golden eye, glinting.
  fortune: () => {
    const g = blank();
    poly(g, [[0.6, 8], [4, 4], [8, 3], [12, 4], [15.4, 8], [12, 12], [8, 13], [4, 12]], 'W');
    disc(g, 8, 8, 3.8, 'k');
    disc(g, 8, 8, 3.1, 'Y');
    disc(g, 8, 8, 1.4, 'p');
    stamp(g, 6, 6, ['w']);
    stamp(g, 13, 0, [' s ', 'sws', ' s ']);
    return { grid: g, mats: { W: PAPER, Y: GOLD }, fixed: { p: '#0d0718', w: '#ffffff', s: '#ffd45e' } };
  },
  // Serpent's Hoard: a heap of Arcane Shards.
  hoard: () => {
    const g = blank();
    gem(g, 8, 5.5, 6, 8, 'A');
    gem(g, 4.5, 10.5, 6, 8, 'B');
    gem(g, 11.5, 10.5, 6, 8, 'C');
    return { grid: g, mats: { A: GOLD, B: GOLD, C: GOLD } };
  },
  // Second and Third Thoughts: two arrows chasing round.
  reroll: () => {
    const g = blank();
    line(g, arc(8, 8, 5, 200, 330), 1.2, 'A');
    poly(g, [[9.5, 0.5], [14.5, 4], [9.5, 6.5]], 'A');
    line(g, arc(8, 8, 5, 20, 150), 1.2, 'B');
    poly(g, [[6.5, 15.5], [1.5, 12], [6.5, 9.5]], 'B');
    return { grid: g, mats: { A: GOLD, B: GOLD } };
  },
  // Rite of Exile and Greater Exile: a card struck out.
  banish: () => {
    const g = blank();
    poly(g, [[3.5, 1.5], [12.5, 1.5], [12.5, 14.5], [3.5, 14.5]], 'P');
    line(g, [[2.5, 2.5], [13.5, 13.5]], 2.0, 'k');
    line(g, [[13.5, 2.5], [2.5, 13.5]], 2.0, 'k');
    line(g, [[2.5, 2.5], [13.5, 13.5]], 1.1, 'R');
    line(g, [[13.5, 2.5], [2.5, 13.5]], 1.1, 'R');
    return { grid: g, mats: { P: PAPER, R: RED } };
  },
  // Fourth Rune: four cards fanned, white-edged, each a colour of its own.
  cards: () => {
    const g = blank();
    const card = (deg, ch) => {
      const a = (deg * Math.PI) / 180;
      const rot = ([x, y]) => [8 + (x - 8) * Math.cos(a) - (y - 19) * Math.sin(a), 19 + (x - 8) * Math.sin(a) + (y - 19) * Math.cos(a)];
      const box = (m) => [[4.6 + m, 2.6 + m], [11.4 - m, 2.6 + m], [11.4 - m, 13.6 - m], [4.6 + m, 13.6 - m]].map(rot);
      poly(g, box(0), 'k');
      poly(g, box(1), 'P');
      poly(g, box(2), ch);
    };
    card(-27, 'A');
    card(-9, 'B');
    card(9, 'C');
    card(27, 'D');
    return { grid: g, mats: { P: { ramp: PAPER, flat: 0.4 }, A: PURPLE, B: CYAN, C: RED, D: GOLD } };
  },
  // Seer's Eye: a crystal ball with an eye in it.
  seersEye: () => {
    const g = blank();
    disc(g, 8, 7, 5.6, 'C');
    poly(g, [[4, 12], [12, 12], [13.5, 15], [2.5, 15]], 'Y');
    stamp(g, 5, 6, [' vvvv ', 'vvpkpv', ' vvvv ']);
    return { grid: g, mats: { C: CYAN, Y: GOLD }, fixed: { v: '#ffffff', p: '#7d45dc' } };
  },
  // Heirloom: an amulet on its chain.
  heirloom: () => {
    const g = blank();
    line(g, [[2, 0.5], [6.5, 7]], 0.6, 'c');
    line(g, [[14, 0.5], [9.5, 7]], 0.6, 'c');
    disc(g, 8, 10, 4.6, 'k');
    disc(g, 8, 10, 3.8, 'Y');
    disc(g, 8, 10, 2.3, 'R');
    return { grid: g, mats: { Y: GOLD, R: RED }, fixed: { c: '#f0a830' } };
  },
  // Phoenix Scale: a firebird, wings raised.
  phoenix: () => {
    const g = blank();
    poly(g, [[8, 8], [1, 1.5], [3, 6], [1.5, 6.5], [5, 10]], 'F');
    poly(g, [[8, 8], [15, 1.5], [13, 6], [14.5, 6.5], [11, 10]], 'F');
    poly(g, [[6, 9], [10, 9], [11.5, 15], [9.5, 12.5], [8, 15.5], [6.5, 12.5], [4.5, 15]], 'F');
    disc(g, 8, 8.5, 2.6, 'F');
    disc(g, 8, 4.8, 1.8, 'F');
    return { grid: g, mats: { F: { ramp: FLAME, core: [8, 7.5], radius: 8 } } };
  },
  // Primed Ultimate: a burst of light.
  ultReady: () => {
    const g = blank();
    star(g, 8, (i) => (i % 2 ? 5.2 : 7.6), 2.6, 'S');
    return { grid: g, mats: { S: { ramp: FLAME, core: [8, 8], radius: 7 } } };
  },
  wayHollows: () => waystone('#8cff6a', '#f2ffe2', ['#4fd04a', '#2a5039', '#1c3328', '#0f1f18']),
  wayCatacombs: () => waystone('#7fb2ff', '#e2f0ff', ['#7fb2ff', '#3f6fc0', '#1d3a6e', '#101e3a']),
  wayEmber: () => waystone('#ff9a3c', '#fff3c4', ['#ff9a3c', '#b8361a', '#6e1a0e', '#3a0c06']),
};

const RELICS = {
  // A smooth blue stone with a rune, ringing out echoes.
  echoStone: () => {
    const g = blank();
    disc(g, 6.5, 8, 4.8, 'S');
    stamp(g, 5, 6, ['www', '  w', 'w w', 'ww ']);
    line(g, arc(6.5, 8, 7, -50, 50), 0.5, 'e');
    line(g, arc(6.5, 8, 9, -35, 35), 0.5, 'f');
    return { grid: g, mats: { S: ['#eaffff', '#8fd8ff', '#4a90c0', '#1d4a70'] }, fixed: { w: '#ffffff', e: '#8fd8ff', f: '#4a90c0' } };
  },
  // A golden feather, its nib inked.
  quill: () => {
    const g = blank();
    poly(g, [[2.8, 12.2], [4.6, 6.4], [9, 2.4], [14.4, 0.8], [13.4, 5], [10.2, 10], [5.8, 13.2]], 'F');
    line(g, [[3.4, 12.6], [13, 2]], 0.42, 'd');
    stamp(g, 6, 6, ['d']);
    stamp(g, 9, 9, ['d']);
    stamp(g, 0, 13, ['  k', ' kk', 'kk ']);
    return { grid: g, mats: { F: GOLD }, fixed: { d: '#a8620e' } };
  },
  // A drop of blood with a glyph in it.
  bloodglyph: () => {
    const g = blank();
    poly(g, [[8, 0.8], [12.2, 8.5], [3.8, 8.5]], 'R');
    disc(g, 8, 10.2, 4.7, 'R');
    stamp(g, 7, 8, [' w', 'www', ' w', 'w w']);
    return { grid: g, mats: { R: ['#ffd0dc', '#ff4f7b', '#c8204e', '#6a0a26'] }, fixed: { w: '#fff0f4' } };
  },
  // A bell, ringing.
  wardensBell: () => {
    const g = blank();
    disc(g, 8, 5, 3.2, 'B');
    poly(g, [[4.8, 5], [11.2, 5], [12, 10], [14, 12.6], [2, 12.6], [4, 10]], 'B');
    disc(g, 8, 14.3, 1.3, 'C');
    stamp(g, 0, 5, [' w', 'w ', 'w ', ' w']);
    stamp(g, 14, 5, ['w ', ' w', ' w', 'w ']);
    return { grid: g, mats: { B: ['#fffbe0', '#ffe08a', '#d8a838', '#8a5a10'], C: GOLD }, fixed: { w: '#fff3c4' } };
  },
  // A four-pointed star drawing crystals in.
  lodestar: () => {
    const g = blank();
    star(g, 4, 7.4, 2.6, 'S');
    for (const [x, y] of [[1, 1], [12, 1], [1, 12], [12, 12]]) stamp(g, x, y, [' x ', 'xwx', ' x ']);
    return { grid: g, mats: { S: ['#ffd8ff', '#e07ae8', '#c45ad8', '#6a1e7a'] }, fixed: { x: '#c8b8ff', w: '#ffffff' } };
  },
  // Hourglass of Ages: a gold-framed hourglass of violet sand.
  hourglass: () => ({
    grid: fromRows([
      '',
      '.YYYYYYYYYYYYYY.',
      '.YYYYYYYYYYYYYY.',
      '..Y.GGGGGGGG.Y..',
      '..Y.GPPPPPPG.Y..',
      '..Y..GPPPPG..Y..',
      '..Y...GPPG...Y..',
      '..Y...GGPG...Y..',
      '..Y..GGGPGG..Y..',
      '..Y.GGGGPGGG.Y..',
      '..Y.GGGPPPGG.Y..',
      '..Y.GPPPPPPG.Y..',
      '.YYYYYYYYYYYYYY.',
      '.YYYYYYYYYYYYYY.',
    ]),
    mats: { Y: GOLD, G: GLASS, P: PURPLE },
  }),
};

// ---------------------------------------------------------------- shading

/**
 * Turns an icon's mask into pixels. Uppercase letters are materials, each `[highlight, base,
 * shade, deep]` or `{ ramp, flat, core, radius }`: shaded as a dome over its own shape lit by
 * LIGHT (`flat` scales its slopes), or, with `core`, by distance from a hot point (for fire).
 * Lowercase letters are detail pixels in `fixed` colours; 'k' is ink. Ink rings the materials.
 */
function shade(spec) {
  const g = spec.grid;
  const out = g.map((r) => r.slice());
  const colors = { k: INK };
  const keys = {};
  const pool = [...'abcdefghijlmnopqrstuvwxyz0123456789'].filter((c) => !(c in (spec.fixed ?? {})));
  const keyFor = (color) => {
    if (!keys[color]) {
      keys[color] = pool.shift();
      colors[keys[color]] = color;
    }
    return keys[color];
  };
  for (const [m, given] of Object.entries(spec.mats)) {
    // A bare ramp, or its options (an array would answer .flat with its own method).
    const def = Array.isArray(given) ? { ramp: given } : given;
    const own = (x, y) => inside(x, y) && g[y][x] === m;
    const cells = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (own(x, y)) cells.push([x, y]);
    const edge = [];
    for (let y = -1; y <= N; y++) for (let x = -1; x <= N; x++) if (!own(x, y)) edge.push([x, y]);
    // A dome over the material: its height rises with the distance in from its edge.
    const dist = new Map();
    let R = 0;
    for (const [x, y] of cells) {
      const d = Math.min(...edge.map(([ex, ey]) => Math.hypot(x - ex, y - ey)));
      dist.set(`${x},${y}`, d);
      R = Math.max(R, d);
    }
    const height = (x, y) => {
      const d = dist.get(`${x},${y}`);
      if (d === undefined) return 0;
      const t = Math.min(1, d / Math.max(1.5, R));
      return Math.sqrt(Math.max(0, 1 - (1 - t) ** 2));
    };
    const flat = def.flat ?? 1.1;
    for (const [x, y] of cells) {
      let tone;
      if (def.core) {
        const d = Math.hypot(x + 0.5 - def.core[0], y + 0.5 - def.core[1]) / def.radius;
        tone = d < 0.3 ? 0 : d < 0.6 ? 1 : d < 0.95 ? 2 : 3;
      } else {
        const n = [-(height(x + 1, y) - height(x - 1, y)) * 0.5 * flat, -(height(x, y + 1) - height(x, y - 1)) * 0.5 * flat, 1];
        const lit = (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / Math.hypot(...n);
        tone = lit > 0.8 ? 0 : lit > 0.42 ? 1 : lit > 0.12 ? 2 : 3;
      }
      out[y][x] = keyFor(def.ramp[tone]);
    }
  }
  Object.assign(colors, spec.fixed ?? {});
  const material = (x, y) => inside(x, y) && /[A-Z]/.test(g[y][x]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (g[y][x] === '.' && (material(x - 1, y) || material(x + 1, y) || material(x, y - 1) || material(x, y + 1))) out[y][x] = 'k';
    }
  return { rows: out.map((r) => r.join('')), colors };
}

// ---------------------------------------------------------------- writing

const build = (set) => Object.entries(set).map(([name, make]) => [name, shade(make())]);
const shop = build(SHOP);
const relics = build(RELICS);

const block = (entries) =>
  entries
    .map(([name, b]) => {
      const colors = Object.entries(b.colors)
        .map(([k, v]) => `${k}: '${v}'`)
        .join(', ');
      return [`  ${name}: {`, '    rows: [', ...b.rows.map((r) => `      '${r}',`), '    ],', `    colors: { ${colors} },`, '  },'].join('\n');
    })
    .join('\n');

const ts = `// Generated by scripts/shop-icons.mjs from the shapes there: change those and run it again.

/** A pixel icon: rows of characters, each a key into its colours ('.' is clear). */
export interface Bitmap {
  rows: string[];
  colors: Record<string, string>;
}

/**
 * The shop's icons: its stat lines, the Grimoire's tools and each map's waystone. Each is 16×16,
 * its parts shaded as rounded forms lit from the top left like the sprites, and outlined in ink.
 */
export const SHOP_ICONS = {
${block(shop)}
} satisfies Record<string, Bitmap>;

export type ShopIconName = keyof typeof SHOP_ICONS;

/** The relics the Grimoire sells, drawn the same way (the others are drawn from their outlines). */
export const RELIC_ICONS = {
${block(relics)}
} satisfies Record<string, Bitmap>;
`;
fs.writeFileSync(OUT, ts.replace(/\n/g, '\r\n'));
console.log(`wrote ${shop.length} shop icons and ${relics.length} relics to ${path.relative(ROOT, OUT)}`);

// ---------------------------------------------------------------- the contact sheet

const sheetAt = process.argv.indexOf('--sheet');
if (sheetAt > 0) {
  const { default: puppeteer } = await import('puppeteer-core');
  const local = process.env.LOCALAPPDATA ?? '';
  const browserPath = [
    process.env.PLAYTEST_BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(local, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => p && fs.existsSync(p));
  if (!browserPath) throw new Error('No Chrome/Edge found. Set PLAYTEST_BROWSER to a Chromium-based browser executable.');
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage();
  const all = [...shop, ...relics].map(([name, b]) => ({ name, ...b }));
  const png = await page.evaluate((all) => {
    const cols = 6;
    const cellW = 16 * 12 + 60;
    const cellH = 16 * 6 + 40;
    const c = document.createElement('canvas');
    c.width = cols * cellW;
    c.height = Math.ceil(all.length / cols) * cellH;
    const g = c.getContext('2d');
    g.fillStyle = '#120a20';
    g.fillRect(0, 0, c.width, c.height);
    all.forEach((b, i) => {
      const ox = (i % cols) * cellW + 8;
      const oy = Math.floor(i / cols) * cellH + 8;
      let x = ox;
      for (const s of [6, 3, 2, 1]) {
        g.fillStyle = '#1d1233';
        g.fillRect(x - 4, oy - 4, 16 * s + 8, 16 * s + 8);
        b.rows.forEach((r, y) =>
          [...r].forEach((ch, xx) => {
            if (ch === '.') return;
            g.fillStyle = b.colors[ch];
            g.fillRect(x + xx * s, oy + y * s, s, s);
          }),
        );
        x += 16 * s + 14;
      }
      g.fillStyle = '#fff';
      g.font = '13px sans-serif';
      g.fillText(b.name, ox, oy + 16 * 6 + 22);
    });
    return c.toDataURL('image/png').split(',')[1];
  }, all);
  fs.writeFileSync(path.resolve(process.argv[sheetAt + 1]), Buffer.from(png, 'base64'));
  await browser.close();
}
