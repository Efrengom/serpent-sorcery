import { COLORS } from './palette';
import type { MapLayout, Rect } from './maps/types';
import { createCanvas, hexRgb } from './pixel/bake';
import { clearanceAt } from './terrain';
import { WIZARDS } from './wizards';
import type { World } from './world';

/** Minimap colours per area: the ruins, then the Ember Depths. */
const STYLE = [
  { floor: '#1d1233', stone: '#4f3f78', edge: '#9a88cc', frame: '#0d0718', landmark: '#e4d8ff' },
  { floor: '#24100b', stone: '#6a3a26', edge: '#c87a4e', frame: '#120504', landmark: '#ffd8b0' },
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
    private readonly pixel: boolean,
    dpr: number,
  ) {
    this.w = WIDTH;
    this.h = Math.round((WIDTH * map.height) / map.width);
    this.style = STYLE[area] ?? STYLE[0];
    // The pixel style is chunky (one minimap pixel per 2 CSS px); classic matches the screen.
    const res = pixel ? 0.5 : dpr;
    const mw = Math.round(this.w * res);
    const mh = Math.round(this.h * res);
    const per = map.width / mw;
    const c = createCanvas(mw, mh);
    const g = c.getContext('2d')!;
    const img = g.createImageData(mw, mh);
    const [floor, stone, edge] = [this.style.floor, this.style.stone, this.style.edge].map(hexRgb);
    for (let v = 0; v < mh; v++) {
      for (let u = 0; u < mw; u++) {
        const d = clearanceAt(map.index, (u + 0.5) * per, (v + 0.5) * per);
        const [r, gg, b] = d >= 0 ? floor : d > -per ? edge : stone;
        const i = (v * mw + u) * 4;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // Landmarks: a small plus (pixel) or diamond (classic) each.
    g.fillStyle = this.style.landmark;
    for (const l of map.landmarks) {
      const x = l.x / per;
      const y = l.y / per;
      if (pixel) {
        g.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
        g.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
      } else {
        const s = 3.5 * res;
        g.beginPath();
        g.moveTo(x, y - s);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s, y);
        g.closePath();
        g.fill();
      }
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
    ctx.imageSmoothingEnabled = !this.pixel;
    ctx.drawImage(this.img, x, y, this.w, this.h);
    ctx.globalAlpha = 1;

    if (world.bossClearing >= 0) {
      const c = world.map.clearings[world.bossClearing];
      ctx.strokeStyle = COLORS.nova;
      ctx.lineWidth = 2;
      ctx.setLineDash(this.pixel ? [4, 2] : [3, 2]);
      ctx.strokeRect(px(c.x0), py(c.y0), (c.x1 - c.x0) * k, (c.y1 - c.y0) * k);
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(px(view.x0)) + 0.5, Math.round(py(view.y0)) + 0.5, Math.round((view.x1 - view.x0) * k), Math.round((view.y1 - view.y0) * k));

    for (const e of world.enemies) {
      if (e.dead || !e.elite) continue;
      this.dot(ctx, px(e.x), py(e.y), 1.5, e.elite === 'shielded' ? COLORS.eliteShield : e.elite === 'swift' ? COLORS.eliteSwift : COLORS.eliteSplit);
    }
    const boss = world.boss ?? world.portals.find((p) => p.kind === 'boss');
    if (boss) this.dot(ctx, px(boss.x), py(boss.y), 4, '#ff6a8a');
    const s = world.snake;
    this.dot(ctx, px(s.x), py(s.y), 3, WIZARDS[world.wizard].look.body);
    ctx.restore();
  }

  /** A marker with a dark outline: a square on the pixel grid, or a round dot. */
  private dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = COLORS.outline;
    if (this.pixel) {
      const s = Math.max(2, Math.round(r) * 2);
      const gx = Math.round(x / 2) * 2 - s / 2;
      const gy = Math.round(y / 2) * 2 - s / 2;
      ctx.fillRect(gx - 2, gy - 2, s + 4, s + 4);
      ctx.fillStyle = color;
      ctx.fillRect(gx, gy, s, s);
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
