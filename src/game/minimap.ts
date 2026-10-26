import { COLORS } from './palette';
import { SITE_INFO } from './sites';
import type { MapLayout, Rect } from './maps/types';
import { createCanvas, hexRgb } from './pixel/bake';
import { clearanceAt } from './terrain';
import { WIZARDS } from './wizards';
import type { World } from './world';

const HAZARD_RGB = { lava: '#d8461c', bramble: '#9a3aa8', ice: '#a8d8f0' } as const;

/** Minimap colours per area: the ruins, the Ember Depths, the Mycelium Hollows, the Rimefrost Catacombs. */
const STYLE = [
  { floor: '#1d1233', stone: '#4f3f78', edge: '#9a88cc', frame: '#0d0718', landmark: '#e4d8ff' },
  { floor: '#24100b', stone: '#6a3a26', edge: '#c87a4e', frame: '#120504', landmark: '#ffd8b0' },
  { floor: '#0c1c1e', stone: '#2e5a52', edge: '#5fd8c0', frame: '#061012', landmark: '#ffc8f0' },
  { floor: '#101a2c', stone: '#3e5878', edge: '#a8d0f0', frame: '#070c18', landmark: '#e8f4ff' },
];

/** Width in CSS pixels; the height follows the map's shape. */
const WIDTH = 220;

/**
 * The map overview in the corner: the layout and landmarks drawn once, then each frame the
 * visible area, the serpent, elites, the boss and the clearing it is coming to. Regular foes
 * aren't shown (too many to read).
 */
export class Minimap {
  readonly w: number;
  readonly h: number;
  private readonly img: HTMLCanvasElement;
  private readonly style: (typeof STYLE)[number];

  constructor(
    private readonly map: MapLayout,
    area: number,
    width = WIDTH,
  ) {
    this.w = width;
    this.h = Math.round((width * map.height) / map.width);
    this.style = STYLE[area] ?? STYLE[0];
    // Chunky: one minimap pixel per 2 CSS px.
    const res = 0.5;
    const mw = Math.round(this.w * res);
    const mh = Math.round(this.h * res);
    const per = map.width / mw;
    const c = createCanvas(mw, mh);
    const g = c.getContext('2d')!;
    const img = g.createImageData(mw, mh);
    const [floor, stone, edge] = [this.style.floor, this.style.stone, this.style.edge].map(hexRgb);
    // Hazard ground in its own colour: lava, brambles, ice.
    const zones = (['lava', 'bramble', 'ice'] as const).flatMap((k) => (map.zones[k] ? [{ index: map.zones[k]!, rgb: hexRgb(HAZARD_RGB[k]) }] : []));
    for (let v = 0; v < mh; v++) {
      for (let u = 0; u < mw; u++) {
        const d = clearanceAt(map.index, (u + 0.5) * per, (v + 0.5) * per);
        const wet = zones.find((z) => clearanceAt(z.index, (u + 0.5) * per, (v + 0.5) * per) < 0);
        const [r, gg, b] = wet ? wet.rgb : d >= 0 ? floor : d > -per ? edge : stone;
        const i = (v * mw + u) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Landmarks: a small plus each.
    g.fillStyle = this.style.landmark;
    for (const l of map.landmarks) {
      const x = Math.round(l.x / per);
      const y = Math.round(l.y / per);
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
    this.img = c;
  }

  /** Draws at CSS position (x, y); `view` is the visible area in world units. */
  draw(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, view: Rect): void {
    const k = this.w / this.map.width;
    const px = (wx: number) => x + wx * k;
    const py = (wy: number) => y + wy * k;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = this.style.frame;
    ctx.fillRect(x - 3, y - 3, this.w + 6, this.h + 6);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.img, x, y, this.w, this.h);
    ctx.globalAlpha = 1;

    if (world.bossClearing >= 0) {
      const c = world.map.clearings[world.bossClearing];
      ctx.strokeStyle = COLORS.nova;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(px(c.x0), py(c.y0), (c.x1 - c.x0) * k, (c.y1 - c.y0) * k);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(px(view.x0)) + 0.5, Math.round(py(view.y0)) + 0.5, Math.round((view.x1 - view.x0) * k), Math.round((view.y1 - view.y0) * k));

    // Reliquaries: small gold pips.
    ctx.fillStyle = '#e8c87a';
    for (const b of world.breakables) {
      if (b.size !== 'large') continue;
      ctx.fillRect(Math.round(px(b.x) / 2) * 2 - 1, Math.round(py(b.y) / 2) * 2 - 1, 2, 2);
    }
    for (const e of world.enemies) {
      if (e.dead || !e.elite) continue;
      this.dot(ctx, px(e.x), py(e.y), 1.5, e.elite === 'shielded' ? COLORS.eliteShield : e.elite === 'swift' ? COLORS.eliteSwift : COLORS.eliteSplit);
    }
    // Sites still to be used.
    for (const site of world.sites) if (!site.spent) this.dot(ctx, px(site.x), py(site.y), 2.5, SITE_INFO[site.kind].color);
    // The way down, once the boss has fallen.
    if (world.descent) this.dot(ctx, px(world.descent.x), py(world.descent.y), 4, COLORS.nova);
    const boss = world.boss ?? world.portals.find((p) => p.kind === 'boss');
    if (boss) this.dot(ctx, px(boss.x), py(boss.y), 4, '#ff6a8a');
    const s = world.snake;
    this.dot(ctx, px(s.x), py(s.y), 3, WIZARDS[world.wizard].look.body);
    ctx.restore();
  }

  /** A marker with a dark outline: a square on the pixel grid. */
  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    const s = Math.max(2, Math.round(r) * 2);
    const gx = Math.round(x / 2) * 2 - s / 2;
    const gy = Math.round(y / 2) * 2 - s / 2;
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(gx - 2, gy - 2, s + 4, s + 4);
    ctx.fillStyle = color;
    ctx.fillRect(gx, gy, s, s);
  }
}

/** The minimap's colours, shared with the atlas on the setup screen. */
export { STYLE as MINIMAP_STYLE, HAZARD_RGB as MINIMAP_HAZARDS };
