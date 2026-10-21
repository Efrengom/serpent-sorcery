import { hash2 } from './hash';
import type { Landmark, MapLayout, Solid } from './maps/types';
import { mulberry32, TAU, type Vec } from './math';
import { createCanvas } from './pixel/bake';
import { clearanceAt, solidBounds } from './terrain';

/** Colours of the classic floor and its stonework per area: the violet ruins, then the Ember Depths. */
export const AREA_STYLE = [
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
    ambient: '#a58cff',
    cracks: null as string | null,
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
    ambient: '#ff8a4a',
    cracks: '255,110,40',
  },
];

export type AreaStyle = (typeof AREA_STYLE)[number];

/** World units per floor chunk. */
const CHUNK = 256;
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
      for (let c = c0; c <= c1; c++) ctx.drawImage(this.chunk(c, r), c * CHUNK, r * CHUNK, CHUNK, CHUNK);
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
    const size = Math.max(1, Math.ceil(CHUNK * this.k));
    const canvas = createCanvas(size, size);
    const g = canvas.getContext('2d')!;
    const X0 = c * CHUNK;
    const Y0 = r * CHUNK;
    g.setTransform(size / CHUNK, 0, 0, size / CHUNK, -X0 * (size / CHUNK), -Y0 * (size / CHUNK));
    const st = AREA_STYLE[this.area] ?? AREA_STYLE[0];
    const box = { x0: X0, y0: Y0, x1: X0 + CHUNK, y1: Y0 + CHUNK };
    paintFloor(g, this.map, st, this.area, box);
    paintStone(g, this.map, st, box);
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

  // Worn flagstones in a running bond, with the odd crack.
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

  // Moss, thickest against the stonework.
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

  for (const l of map.landmarks) if (Math.abs(l.x - (box.x0 + box.x1) / 2) < 1600 && Math.abs(l.y - (box.y0 + box.y1) / 2) < 900) paintLandmark(g, l, st);

  // Rubble and glowing mushrooms where the floor meets stone.
  eachCell(box, 44, 10, (i, j) => {
    const x = (i + hash2(i, j, salt + 16)) * 44;
    const y = (j + hash2(i, j, salt + 17)) * 44;
    const d = clearanceAt(map.index, x, y);
    if (d < 4 || d > 70) return;
    const h = hash2(i, j, salt + 18);
    if (h < 0.08 && d < 60) {
      const r = 2 + hash2(i, j, salt + 19) * 2.5;
      const m = g.createRadialGradient(x, y, 0, x, y, r * 4);
      m.addColorStop(0, `rgba(${st.glow},0.5)`);
      m.addColorStop(1, `rgba(${st.glow},0)`);
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

  // Warm pools of torch light along the walls.
  for (const t of map.torches) {
    if (t.x < box.x0 - 130 || t.x > box.x1 + 130 || t.y < box.y0 - 130 || t.y > box.y1 + 130) continue;
    const tg = g.createRadialGradient(t.x, t.y, 0, t.x, t.y, 120);
    tg.addColorStop(0, `rgba(${st.torch},0.22)`);
    tg.addColorStop(1, `rgba(${st.torch},0)`);
    g.fillStyle = tg;
    g.fillRect(t.x - 120, t.y - 120, 240, 240);
  }
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
  } else if (l.kind === 'hall') {
    // The hall's old floor: darker, with a faded mosaic ring.
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(l.x - 500, l.y - 500, 1000, 1000);
    g.strokeStyle = `rgba(${st.circle},0.1)`;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(l.x, l.y, 150, 0, TAU);
    g.stroke();
  }
}

function solidPath(g: CanvasRenderingContext2D, s: Solid, dx = 0, dy = 0, grow = 0): void {
  g.beginPath();
  if (s.shape === 'circle') g.arc(s.x + dx, s.y + dy, s.r + grow, 0, TAU);
  else if (s.shape === 'rect') g.rect(s.x0 + dx - grow, s.y0 + dy - grow, s.x1 - s.x0 + grow * 2, s.y1 - s.y0 + grow * 2);
  else {
    const a = Math.atan2(s.by - s.ay, s.bx - s.ax);
    g.arc(s.ax + dx, s.ay + dy, s.r + grow, a + Math.PI / 2, a - Math.PI / 2);
    g.arc(s.bx + dx, s.by + dy, s.r + grow, a - Math.PI / 2, a + Math.PI / 2);
    g.closePath();
  }
}

/** Walls, pillars, toppled columns and statues, with soft shadows cast down and to the right. */
function paintStone(g: CanvasRenderingContext2D, map: MapLayout, st: AreaStyle, box: Box): void {
  const near = map.solids.filter((s) => {
    const b = solidBounds(s);
    return b.x1 > box.x0 - 40 && b.x0 < box.x1 + 20 && b.y1 > box.y0 - 40 && b.y0 < box.y1 + 20;
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

  // Walls: dark tops with brick courses, rims only on faces that meet open floor.
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
    g.restore();
    g.strokeStyle = `rgba(${st.rim},0.45)`;
    g.lineWidth = 2.5;
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
    g.stroke();
    g.lineCap = 'butt';
  }

  for (const s of near) {
    if (s.name === 'wall' && s.shape === 'rect') continue;
    if (s.name === 'colossus') continue;
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

  // The Fallen Colossus: all its pieces outlined first, then filled, so they read as one figure.
  const colossus = map.solids.filter((s) => s.name === 'colossus');
  if (near.some((s) => s.name === 'colossus')) paintColossus(g, colossus, st);
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
