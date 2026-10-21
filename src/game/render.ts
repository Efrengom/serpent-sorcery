import type { Camera } from './camera';
import { AREA_STYLE, ClassicFloor } from './classicFloor';
import { CAMERA, ENEMIES, PIXEL_ART, SNAKE, VIEW } from './config';
import { shakeOffset } from './effects';
import type { Pt } from './gesture';
import type { MapLayout } from './maps/types';
import { clamp, dist, mulberry32, TAU, type Vec } from './math';
import { Minimap } from './minimap';
import { COLORS } from './palette';
import { DEFAULT_VIEW, type ViewOptions } from './options';
import { createCanvas } from './pixel/bake';
import {
  buildVignette,
  drawAim,
  drawArcs,
  drawBeams,
  drawBolts,
  drawClearingMark,
  drawCoilPixel,
  drawCrystals,
  drawEdgeArrow,
  drawEnemies,
  drawFrostFields,
  drawNovas,
  drawParticles,
  drawPortals,
  drawSerpent,
  drawShots,
  drawTelegraphs,
  drawTorches,
  drawTrail,
  drawTrailTip,
  drawWard,
  drawWarningMarks,
  setDrawBounds,
} from './pixel/draw';
import { PixelFloor } from './pixel/floor';
import { SPELL_COLORS, spellName } from './spells';
import { WIZARDS } from './wizards';
import type { Enemy, GestureView, World } from './world';

const TITLE_FONT = "'Cinzel', 'Palatino Linotype', Georgia, serif";
const UI_FONT = "'Nunito', 'Segoe UI', system-ui, sans-serif";
const PIXEL_FONT = "'Silkscreen', 'Courier New', monospace";
const P = PIXEL_ART.worldPerPixel;
const VIGNETTE_LEVELS = 6;
/** Highest resolution (device px per world unit) the classic floor is painted at. */
const FLOOR_RES_CAP = 1.75;
/** Edge arrows sit this far (CSS px) inside the view's edge. */
const ARROW_INSET = 34;

/** Something off-screen worth pointing at: the boss, or the clearing it's coming to. */
interface Pointer {
  x: number;
  y: number;
  label: string;
  color: string;
}

export class Renderer {
  /** The context the draw helpers target; swapped to the low-res canvas while drawing pixel art. */
  private ctx: CanvasRenderingContext2D;
  private readonly mainCtx: CanvasRenderingContext2D;
  private dpr = 1;
  cssW = 0;
  cssH = 0;
  /**
   * World -> CSS pixel transform: css = (world - camera corner) * scale + offset. The view shows
   * `viewW` × `viewH` world units, its top-left corner at (`camLeft`, `camTop`) as last drawn.
   */
  scale = 1;
  ox = 0;
  oy = 0;
  viewW: number = CAMERA.maxViewWidth;
  viewH: number = CAMERA.viewHeight;
  camLeft = 0;
  camTop = 0;
  /** The map and area (look) the floors were built for. */
  private map: MapLayout | null = null;
  private area = 0;
  private classicFloor: ClassicFloor | null = null;
  private vignette: HTMLCanvasElement | null = null;
  private minimap: Minimap | null = null;
  private glows = new Map<string, HTMLCanvasElement>();
  // Pixel-art style
  private pixel: boolean;
  /** Device pixels per low-res pixel (an integer whenever the window allows it). */
  private pixelFactor = 1;
  private devX = 0;
  private devY = 0;
  /** The low-res view canvas, in art pixels. */
  private lowW = 0;
  private lowH = 0;
  private low: HTMLCanvasElement | null = null;
  private lowCtx: CanvasRenderingContext2D | null = null;
  private pixelFloor: PixelFloor | null = null;
  /** Screen-sized overlay on the same pixel grid as the arena (sigil trail, hurt flash). */
  private ui: HTMLCanvasElement | null = null;
  private uiCtx: CanvasRenderingContext2D | null = null;
  private uiX = 0;
  private uiY = 0;
  private vignettes: (HTMLCanvasElement | undefined)[] = [];
  /** Shake, flashing and warning-style options. */
  view: ViewOptions = DEFAULT_VIEW;
  private hazard: CanvasPattern | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    pixelArt = false,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.mainCtx = ctx;
    this.pixel = pixelArt;
    this.resize();
  }

  get pixelArt(): boolean {
    return this.pixel;
  }

  setPixelArt(on: boolean): void {
    if (on === this.pixel) return;
    this.pixel = on;
    this.resize();
  }

  resize(): void {
    const cssW = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.minimap = null;
    if (this.pixel) {
      this.layoutPixel();
      return;
    }
    // The view is CAMERA.viewHeight tall (taller only in narrow windows) and as wide as the window allows.
    const availW = cssW - VIEW.sideInset * 2;
    const availH = cssH - VIEW.topInset - VIEW.bottomInset;
    this.scale = Math.max(0.2, Math.min(availH / CAMERA.viewHeight, availW / CAMERA.minViewWidth));
    this.viewW = Math.min(CAMERA.maxViewWidth, availW / this.scale);
    this.viewH = Math.min(CAMERA.maxViewHeight, availH / this.scale);
    this.ox = (cssW - this.viewW * this.scale) / 2;
    this.oy = VIEW.topInset + (availH - this.viewH * this.scale) / 2;
    if (this.classicFloor && Math.abs(this.classicFloor.k - this.floorRes) > 0.01) this.classicFloor = null;
    this.vignette = null;
  }

  /**
   * Fits the low-res view with a whole-number upscale so every art pixel is the same size. The
   * view is 320 art pixels tall (or a little more, filling the window) and as wide as the window
   * allows, within the camera's limits. Very small windows fall back to fractional scaling.
   */
  private layoutPixel(): void {
    void document.fonts?.load(`16px ${PIXEL_FONT}`).catch(() => undefined);
    const dpr = this.dpr;
    const availW = (this.cssW - VIEW.sideInset * 2) * dpr;
    const availH = (this.cssH - VIEW.topInset) * dpr;
    const fit = Math.min(availW / (CAMERA.minViewWidth / P), availH / (CAMERA.viewHeight / P));
    const whole = Math.floor(fit);
    const f = whole >= PIXEL_ART.minIntegerScale ? whole : Math.max(0.5, fit);
    this.pixelFactor = f;
    this.lowW = Math.min(Math.floor(availW / f), Math.round(CAMERA.maxViewWidth / P));
    this.lowH = Math.min(Math.floor(availH / f), Math.round(CAMERA.maxViewHeight / P));
    if (!this.low || this.low.width !== this.lowW || this.low.height !== this.lowH) {
      this.low = createCanvas(this.lowW, this.lowH);
      this.lowCtx = this.low.getContext('2d')!;
    }
    this.viewW = this.lowW * P;
    this.viewH = this.lowH * P;
    const devW = this.lowW * f;
    const devH = this.lowH * f;
    this.devX = Math.round((this.cssW * dpr - devW) / 2);
    this.devY = Math.round(VIEW.topInset * dpr + Math.max(0, (availH - VIEW.bottomInset * dpr - devH) / 2));
    this.scale = f / P / dpr;
    this.ox = this.devX / dpr;
    this.oy = this.devY / dpr;
    // Overlay grid starts at or before the screen origin and lines up with the arena's pixels.
    this.uiX = Math.round(this.devX - Math.ceil(this.devX / f) * f);
    this.uiY = Math.round(this.devY - Math.ceil(this.devY / f) * f);
    const uw = Math.ceil((this.canvas.width - this.uiX) / f);
    const uh = Math.ceil((this.canvas.height - this.uiY) / f);
    if (!this.ui || this.ui.width !== uw || this.ui.height !== uh) {
      this.ui = createCanvas(uw, uh);
      this.uiCtx = this.ui.getContext('2d')!;
      this.vignettes = [];
    }
  }

  /**
   * Device pixels per world unit for the classic floor's chunks: the screen's resolution, capped
   * so the cached chunks stay under about 64 MB even on a 4K screen.
   */
  private get floorRes(): number {
    return Math.min(FLOOR_RES_CAP, this.scale * this.dpr);
  }

  /** (Re)builds the floors when the run's map or its look (the area) changes. */
  private useMap(map: MapLayout, area: number): void {
    if (map === this.map && area === this.area) return;
    this.map = map;
    this.area = area;
    this.classicFloor = null;
    this.pixelFloor = null;
    this.minimap = null;
  }

  /**
   * Puts the view's top-left corner where the camera says. In the pixel style it snaps to whole
   * art pixels, so the floor scrolls without shimmering.
   */
  follow(cam: Camera): void {
    const left = cam.x - this.viewW / 2;
    const top = cam.y - this.viewH / 2;
    this.camLeft = this.pixel ? Math.round(left / P) * P : left;
    this.camTop = this.pixel ? Math.round(top / P) * P : top;
  }

  private font(size: number, weight: number, title = false): string {
    if (this.pixel) return `${weight >= 700 ? 700 : 400} ${Math.max(16, Math.round(size / 8) * 8)}px ${PIXEL_FONT}`;
    return `${weight} ${size}px ${title ? TITLE_FONT : UI_FONT}`;
  }

  screenToWorld(p: Pt): Vec {
    return { x: (p.x - this.ox) / this.scale + this.camLeft, y: (p.y - this.oy) / this.scale + this.camTop };
  }

  worldToScreen(p: Vec): Vec {
    return { x: (p.x - this.camLeft) * this.scale + this.ox, y: (p.y - this.camTop) * this.scale + this.oy };
  }

  // ------------------------------------------------------------ sprites

  private glow(color: string): HTMLCanvasElement {
    let c = this.glows.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, hexAlpha(color, 0.45));
    grad.addColorStop(1, hexAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glows.set(color, c);
    return c;
  }

  private drawGlow(color: string, x: number, y: number, radius: number, alpha = 1): void {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glow(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ frame

  render(world: World, gesture: GestureView, realTime: number, showSnake: boolean): void {
    this.useMap(world.map, world.area);
    this.follow(world.camera);
    if (this.pixel) {
      this.renderPixel(world, gesture, realTime, showSnake);
      return;
    }
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0a0614';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const shake = shakeOffset(world, realTime, this.view.shake);
    const x0 = this.camLeft;
    const y0 = this.camTop;
    ctx.save();
    // Nothing spills past the view into the letterbox.
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, this.viewW * this.scale, this.viewH * this.scale);
    ctx.clip();
    ctx.translate(this.ox + shake.x - x0 * this.scale, this.oy + shake.y - y0 * this.scale);
    ctx.scale(this.scale, this.scale);

    this.classicFloor ??= new ClassicFloor(world.map, world.area, this.floorRes);
    // A margin all round, so screen shake never uncovers unpainted floor.
    this.classicFloor.draw(ctx, x0 - 20, y0 - 20, x0 + this.viewW + 20, y0 + this.viewH + 20);
    this.drawViewShade();
    this.drawAmbient(world, realTime);
    this.drawClearing(world, realTime);
    this.drawPortals(world, realTime);
    this.drawFrostFields(world, realTime);
    this.drawCrystals(world);
    this.drawTelegraphs(world);
    this.drawConstricts(world);
    for (const e of world.enemies) {
      if (!this.near(e.x, e.y, e.segments.length > 0 ? 450 : 80)) continue;
      this.drawEnemy(e, world);
      this.drawEnemyStatus(e, world);
    }
    if (this.view.safeWarnings) this.drawWarningMarks(world);
    if (showSnake) {
      this.drawSnake(world, gesture);
      this.drawWard(world, realTime);
      this.drawCoilHint(world, realTime);
    }
    this.drawNovas(world);
    this.drawBolts(world);
    this.drawBeams(world);
    this.drawArcs(world, realTime);
    this.drawShots(world);
    this.drawParticles(world);
    this.drawWorldFloaters(world);
    if (gesture.active && gesture.target && showSnake) this.drawAim(world, gesture.target, realTime);
    const arrows = this.arrows(world);
    for (const a of arrows) this.drawArrow(a.x, a.y, a.a, a.p.color);
    ctx.restore();
    this.classicFloor.prefetch(x0, y0, x0 + this.viewW, y0 + this.viewH);

    this.drawVignettes(world, realTime);
    this.drawArrowLabels(arrows);
    this.drawMinimap(world);
    this.drawBanner(world);
    this.drawGesture(gesture);
    this.drawReading(gesture, world);
    this.drawScreenFloaters(world);
  }

  /** True when (x, y) is within `margin` world units of the view. */
  private near(x: number, y: number, margin: number): boolean {
    return x > this.camLeft - margin && x < this.camLeft + this.viewW + margin && y > this.camTop - margin && y < this.camTop + this.viewH + margin;
  }

  /**
   * Darkens the floor toward the view's edges, as the old arena's baked vignette did. Drawn in
   * screen space right after the floor, so foes and effects on top keep their full colour.
   */
  private drawViewShade(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = this.viewW * this.scale;
    const h = this.viewH * this.scale;
    if (!this.vignette) {
      const c = createCanvas(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
      const g = c.getContext('2d')!;
      const v = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.35, c.width / 2, c.height / 2, c.width * 0.62);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = v;
      g.fillRect(0, 0, c.width, c.height);
      this.vignette = c;
    }
    ctx.drawImage(this.vignette, this.ox, this.oy, w, h);
    ctx.restore();
  }

  // ------------------------------------------------------------ pointers, clearing, minimap

  /** What deserves an arrow when it's off-screen: the boss (or its portal), else the clearing it's coming to. */
  private pointers(world: World): Pointer[] {
    const boss = world.boss ?? world.portals.find((p) => p.kind === 'boss');
    if (boss) return [{ x: boss.x, y: boss.y, label: 'Boss', color: '#ff6a8a' }];
    if (world.bossClearing >= 0) {
      const c = world.map.clearings[world.bossClearing];
      return [{ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, label: 'Boss clearing', color: COLORS.nova }];
    }
    return [];
  }

  /**
   * Arrows for off-screen pointers: on the line from the view's middle toward each one, just
   * inside the view's edge, pointing at it (world units).
   */
  private arrows(world: World): { x: number; y: number; a: number; p: Pointer }[] {
    const out: { x: number; y: number; a: number; p: Pointer }[] = [];
    const inset = ARROW_INSET / this.scale;
    const cx = this.camLeft + this.viewW / 2;
    const cy = this.camTop + this.viewH / 2;
    for (const p of this.pointers(world)) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (Math.abs(dx) <= this.viewW / 2 && Math.abs(dy) <= this.viewH / 2) continue;
      const k = Math.min((this.viewW / 2 - inset) / Math.max(1e-6, Math.abs(dx)), (this.viewH / 2 - inset) / Math.max(1e-6, Math.abs(dy)));
      out.push({ x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx), p });
    }
    return out;
  }

  /** A pointing arrowhead with a dark outline, in world units. */
  private drawArrow(x: number, y: number, a: number, color: string): void {
    const ctx = this.ctx;
    const s = 15 / this.scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, -s * 0.75);
    ctx.lineTo(-s * 0.35, 0);
    ctx.lineTo(-s * 0.7, s * 0.75);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 / this.scale;
    ctx.strokeStyle = COLORS.outline;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Each arrow's label, on the side of it facing the middle of the view (screen space). */
  private drawArrowLabels(arrows: { x: number; y: number; a: number; p: Pointer }[]): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const a of arrows) {
      const s = this.worldToScreen(a);
      this.drawFloater(a.p.label, s.x - Math.cos(a.a) * 46, s.y - Math.sin(a.a) * 26, 13, a.p.color, 1);
    }
  }

  /** The clearing the boss is coming to: a dashed border on the ground. */
  private drawClearing(world: World, t: number): void {
    if (world.bossClearing < 0) return;
    const c = world.map.clearings[world.bossClearing];
    const ctx = this.ctx;
    const pulse = this.view.reduceFlashing ? 0.55 : 0.4 + 0.2 * Math.sin(t * 3);
    ctx.strokeStyle = hexAlpha(COLORS.nova, pulse);
    ctx.lineWidth = 5;
    ctx.setLineDash([28, 18]);
    ctx.lineDashOffset = this.view.reduceFlashing ? 0 : -t * 20;
    ctx.strokeRect(c.x0 + 20, c.y0 + 20, c.x1 - c.x0 - 40, c.y1 - c.y0 - 40);
    ctx.setLineDash([]);
  }

  private drawMinimap(world: World): void {
    if (!this.view.minimap) return;
    this.minimap ??= new Minimap(world.map, world.area, this.pixel, this.dpr);
    const m = this.minimap;
    const x = Math.round(this.ox + this.viewW * this.scale - m.w - 10);
    const y = Math.round(this.oy + this.viewH * this.scale - m.h - 10);
    this.mainCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    m.draw(this.mainCtx, world, x, y, { x0: this.camLeft, y0: this.camTop, x1: this.camLeft + this.viewW, y1: this.camTop + this.viewH });
  }

  /**
   * Pixel-art frame. The view is drawn on a small canvas (1 pixel = PIXEL_ART.worldPerPixel
   * units, offset by the camera in whole pixels) entirely from baked sprites and per-pixel
   * effects, then upscaled with nearest-neighbour sampling. A second screen-sized overlay on the
   * same pixel grid carries the sigil trail and hurt flash. Only text is drawn at full
   * resolution, in a pixel font.
   */
  private renderPixel(world: World, gesture: GestureView, realTime: number, showSnake: boolean): void {
    const low = this.lowCtx!;
    const main = this.mainCtx;
    this.pixelFloor ??= new PixelFloor(world.map, world.area);
    setDrawBounds(world.map.bounds, this.camLeft / P, this.camTop / P, this.lowW, this.lowH);
    const cx = Math.round(this.camLeft / P);
    const cy = Math.round(this.camTop / P);
    low.setTransform(1, 0, 0, 1, -cx, -cy);
    low.globalAlpha = 1;
    low.globalCompositeOperation = 'source-over';
    low.imageSmoothingEnabled = false;
    low.fillStyle = '#0a0614';
    low.fillRect(cx, cy, this.lowW, this.lowH);
    this.pixelFloor.draw(low, cx, cy, cx + this.lowW, cy + this.lowH);
    drawTorches(low, this.pixelFloor.torches, realTime);
    if (world.bossClearing >= 0) drawClearingMark(low, world.map.clearings[world.bossClearing], realTime, this.view.reduceFlashing);
    drawFrostFields(low, world, realTime);
    drawPortals(low, world, realTime);
    drawCrystals(low, world);
    const quiet = this.view.reduceFlashing;
    drawTelegraphs(low, world, this.view.safeWarnings);
    drawCoilPixel(low, world, realTime, false, quiet);
    drawEnemies(low, world, this.view);
    if (this.view.safeWarnings) drawWarningMarks(low, world);
    if (showSnake) {
      drawSerpent(low, world, gesture, realTime, quiet);
      drawWard(low, world, realTime, quiet);
      drawCoilPixel(low, world, realTime, true, quiet);
    }
    drawNovas(low, world);
    drawBolts(low, world);
    drawBeams(low, world);
    drawArcs(low, world, realTime, quiet);
    drawShots(low, world);
    drawParticles(low, world);
    if (gesture.active && gesture.target && showSnake) drawAim(low, world, gesture.target, realTime);
    const arrows = this.arrows(world);
    for (const a of arrows) drawEdgeArrow(low, a.x / P, a.y / P, a.a, a.p.color);

    // Upscale with crisp pixels; shake moves in whole art pixels.
    const f = this.pixelFactor;
    const shake = shakeOffset(world, realTime, this.view.shake);
    const sx = Math.round((shake.x * this.dpr) / f) * f;
    const sy = Math.round((shake.y * this.dpr) / f) * f;
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.fillStyle = '#0a0614';
    main.fillRect(0, 0, this.canvas.width, this.canvas.height);
    main.imageSmoothingEnabled = false;
    main.drawImage(this.low!, Math.round(this.devX + sx), Math.round(this.devY + sy), Math.round(this.lowW * f), Math.round(this.lowH * f));
    // Paint ahead into the chunks around the view with what's left of a small budget.
    this.pixelFloor.prefetch(cx, cy, cx + this.lowW, cy + this.lowH, 3);

    // Text in the pixel font, at full resolution.
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawWorldFloaters(world);
    this.drawArrowLabels(arrows);
    this.drawBanner(world);

    // Screen-space pixel overlay: hurt flash and the sigil trail, above every game effect.
    this.drawPixelOverlay(world, gesture, realTime);
    main.imageSmoothingEnabled = false;
    this.drawMinimap(world);
    main.imageSmoothingEnabled = true;
    main.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawReading(gesture, world);
    this.drawScreenFloaters(world);
  }

  private drawPixelOverlay(world: World, gesture: GestureView, t: number): void {
    const ui = this.uiCtx!;
    const main = this.mainCtx;
    const f = this.pixelFactor;
    ui.setTransform(1, 0, 0, 1, 0, 0);
    ui.clearRect(0, 0, this.ui!.width, this.ui!.height);
    // Hurt flash / low-health warning as a dithered red border.
    const a = this.dangerTint(world, t);
    if (a > 0.02) {
      const level = Math.min(VIGNETTE_LEVELS, Math.max(1, Math.round(a * 2 * VIGNETTE_LEVELS)));
      let v = this.vignettes[level];
      if (!v) {
        v = buildVignette(this.ui!.width, this.ui!.height, level / VIGNETTE_LEVELS);
        this.vignettes[level] = v;
      }
      ui.drawImage(v, 0, 0);
    }
    const toUi = (p: Pt) => ({ x: (p.x * this.dpr - this.uiX) / f, y: (p.y * this.dpr - this.uiY) / f });
    if (gesture.fade) {
      const k = 1 - gesture.fade.t;
      if (k > 0) drawTrail(ui, gesture.fade.points.map(toUi), gesture.fade.color, k);
    }
    if (gesture.active && gesture.points.length > 0) {
      const pts = gesture.points.map(toUi);
      drawTrail(ui, pts, readingColor(gesture), 1);
      drawTrailTip(ui, pts[pts.length - 1]);
    }
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.imageSmoothingEnabled = false;
    main.drawImage(this.ui!, this.uiX, this.uiY, Math.round(this.ui!.width * f), Math.round(this.ui!.height * f));
  }

  private drawAmbient(world: World, t: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    world.map.torches.forEach((torch, i) => {
      if (!this.near(torch.x, torch.y, 40)) return;
      const phase = i * 1.7;
      const f = 0.75 + Math.sin(t * 9 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.08;
      this.drawGlow('#ffb35c', torch.x, torch.y, 26 * f, 0.9);
      this.drawGlow('#fff0c0', torch.x, torch.y - 2, 8 * f, 0.9);
    });
    // The plaza's summoning circle pulses faintly, brighter when the boss is out.
    const pulse = 0.12 + Math.sin(t * 1.3) * 0.05 + (world.boss ? 0.15 : 0);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = world.boss ? '#ff6a8a' : (AREA_STYLE[this.area] ?? AREA_STYLE[0]).ambient;
    ctx.lineWidth = 3;
    for (const l of world.map.landmarks) {
      if (l.kind !== 'plaza' || !this.near(l.x, l.y, 220)) continue;
      ctx.beginPath();
      ctx.arc(l.x, l.y, 210, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawPortals(world: World, t: number): void {
    const ctx = this.ctx;
    for (const p of world.portals) {
      const k = clamp(p.t / p.duration, 0, 1);
      const big = p.kind === 'boss' ? 2.6 : p.kind === 'brute' ? 1.4 : 1;
      const r = (10 + 18 * k) * big;
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(COLORS.portal, p.x, p.y, r * 2.2, 0.5 + 0.4 * k);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(20,0,16,0.85)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ff5a9a';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.8, a, a + 1.2);
        ctx.stroke();
      }
    }
  }

  private drawCrystals(world: World): void {
    const ctx = this.ctx;
    for (const c of world.crystals) {
      if (!this.near(c.x, c.y, 30)) continue;
      const size = c.value >= 10 ? 9 : c.value >= 5 ? 7 : 5;
      const color = c.value >= 5 ? COLORS.xpBig : COLORS.xp;
      const bob = Math.sin(c.t * 4) * 1.5;
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(color, c.x, c.y + bob, size * 3, 0.55);
      ctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.rotate(Math.sin(c.t * 2) * 0.3);
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.3);
      ctx.lineTo(size, 0);
      ctx.lineTo(0, size * 1.3);
      ctx.lineTo(-size, 0);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#2a1650';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.1);
      ctx.lineTo(size * 0.35, -size * 0.1);
      ctx.lineTo(-size * 0.2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /** Hostile attack previews: always drawn under bodies so the enemy stays visible. */
  private drawTelegraphs(world: World): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    const b = world.map.bounds;
    ctx.rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.clip();
    this.drawTelegraphShapes(world);
    ctx.restore();
  }

  /** Yellow-and-black diagonal stripes for colorblind-safe charge lanes. */
  private hazardPattern(): CanvasPattern | string {
    if (!this.hazard) {
      const tile = createCanvas(24, 24);
      const g = tile.getContext('2d')!;
      g.fillStyle = COLORS.warnDark;
      g.fillRect(0, 0, 24, 24);
      g.fillStyle = COLORS.warn;
      for (let x = -24; x < 24; x += 12) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 6, 0);
        g.lineTo(x + 30, 24);
        g.lineTo(x + 24, 24);
        g.closePath();
        g.fill();
      }
      this.hazard = this.mainCtx.createPattern(tile, 'repeat');
    }
    return this.hazard ?? COLORS.warn;
  }

  /** A line drawn twice: a dark casing, then a bright core, so it reads on any floor. */
  private casedStroke(path: () => void, width: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.warnDark;
    ctx.lineWidth = width * 2;
    path();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    path();
    ctx.stroke();
  }

  /**
   * Colorblind-safe attack previews: hazard stripes, dark casings and a bright yellow, so they
   * stand apart from the floor and from friendly magic by brightness and pattern, not hue.
   */
  private drawSafeTelegraph(e: Enemy): void {
    const ctx = this.ctx;
    if (e.kind === 'caster') {
      const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
      const L = 260;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.aim);
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.55 + 0.45 * k;
      this.casedStroke(() => {
        ctx.beginPath();
        ctx.moveTo(e.r + 4, 0);
        ctx.lineTo(L - 14, 0);
        ctx.moveTo(L - 26, -11);
        ctx.lineTo(L - 10, 0);
        ctx.lineTo(L - 26, 11);
      }, 3.5, k > 0.6 ? COLORS.warnLight : COLORS.warn);
      ctx.restore();
    } else if (e.kind === 'brute' || e.kind === 'rival' || (e.kind === 'boss' && e.bossMove === 'charge')) {
      const L =
        (e.kind === 'brute'
          ? ENEMIES.brute.chargeSpeed * ENEMIES.brute.chargeTime
          : e.kind === 'rival'
            ? ENEMIES.rival.lungeSpeed * ENEMIES.rival.lungeTime
            : ENEMIES.boss.chargeSpeed * ENEMIES.boss.chargeTime) + e.r;
      const tele = e.kind === 'brute' ? ENEMIES.brute.telegraph : e.kind === 'rival' ? ENEMIES.rival.telegraph : ENEMIES.boss.chargeTelegraph;
      const k = clamp(e.stateTime / tele, 0, 1);
      const w = e.r * 2.2;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.aim);
      ctx.fillStyle = 'rgba(18,12,0,0.4)';
      ctx.fillRect(0, -w / 2, L, w);
      if (k > 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.hazardPattern();
        ctx.fillRect(0, -w / 2, L * k, w);
        ctx.globalAlpha = 1;
      }
      this.casedStroke(() => {
        ctx.beginPath();
        ctx.rect(0, -w / 2, L, w);
      }, 3, k > 0.5 ? COLORS.warnLight : COLORS.warn);
      ctx.lineJoin = 'round';
      for (let d = 40; d < L - 30; d += 60) {
        this.casedStroke(() => {
          ctx.beginPath();
          ctx.moveTo(d, -w * 0.25);
          ctx.lineTo(d + 14, 0);
          ctx.lineTo(d, w * 0.25);
        }, 3, d <= L * k ? COLORS.warnLight : COLORS.warn);
      }
      ctx.restore();
    } else if (e.kind === 'boss' && e.bossMove === 'volley') {
      const k = clamp(e.stateTime / ENEMIES.boss.volleyTelegraph, 0, 1);
      this.casedStroke(() => {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 20 + 40 * (1 - k), 0, TAU);
      }, 3.5, k > 0.5 ? COLORS.warnLight : COLORS.warn);
    }
  }

  /** Colorblind-safe warnings: a yellow "!" over every foe winding up an attack, drawn above bodies. */
  private drawWarningMarks(world: World): void {
    for (const e of world.enemies) {
      if (!e.dead && e.state === 'windup') this.drawExclaim(e.x, e.y - e.r - 18);
    }
  }

  private drawTelegraphShapes(world: World): void {
    const ctx = this.ctx;
    for (const e of world.enemies) {
      if (e.dead || e.state !== 'windup') continue;
      if (this.view.safeWarnings && !(e.kind === 'boss' && e.bossMove === 'summon')) {
        this.drawSafeTelegraph(e);
      } else if (e.kind === 'caster') {
        const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
        ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.25 + 0.45 * k})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aim) * 260, e.y + Math.sin(e.aim) * 260);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.kind === 'brute' || e.kind === 'rival' || (e.kind === 'boss' && e.bossMove === 'charge')) {
        const cfgLen =
          e.kind === 'brute'
            ? ENEMIES.brute.chargeSpeed * ENEMIES.brute.chargeTime
            : e.kind === 'rival'
              ? ENEMIES.rival.lungeSpeed * ENEMIES.rival.lungeTime
              : ENEMIES.boss.chargeSpeed * ENEMIES.boss.chargeTime;
        const tele =
          e.kind === 'brute' ? ENEMIES.brute.telegraph : e.kind === 'rival' ? ENEMIES.rival.telegraph : ENEMIES.boss.chargeTelegraph;
        const k = clamp(e.stateTime / tele, 0, 1);
        const width = e.r * 2.2;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.aim);
        ctx.fillStyle = `rgba(${COLORS.telegraph},0.12)`;
        ctx.fillRect(0, -width / 2, cfgLen + e.r, width);
        ctx.fillStyle = `rgba(${COLORS.telegraph},0.32)`;
        ctx.fillRect(0, -width / 2, (cfgLen + e.r) * k, width);
        ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.5 + 0.4 * k})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, -width / 2, cfgLen + e.r, width);
        // Chevrons pointing in the charge direction
        ctx.strokeStyle = `rgba(255,200,180,${0.35 + 0.5 * k})`;
        ctx.lineWidth = 3;
        for (let d = 40; d < cfgLen; d += 60) {
          ctx.beginPath();
          ctx.moveTo(d, -width * 0.25);
          ctx.lineTo(d + 14, 0);
          ctx.lineTo(d, width * 0.25);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.kind === 'boss' && e.bossMove === 'volley') {
        const k = clamp(e.stateTime / ENEMIES.boss.volleyTelegraph, 0, 1);
        ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.3 + 0.5 * k})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 20 + 40 * (1 - k), 0, TAU);
        ctx.stroke();
      } else if (e.kind === 'boss' && e.bossMove === 'summon') {
        const k = clamp(e.stateTime / ENEMIES.boss.summonTelegraph, 0, 1);
        ctx.strokeStyle = `rgba(255,90,154,${0.3 + 0.5 * k})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, 110, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawEnemy(e: Enemy, world: World): void {
    const ctx = this.ctx;
    const flash = e.flash > 0 && !this.view.reduceFlashing;
    switch (e.kind) {
      case 'chaser': {
        const spin = world.time * 3 + e.wobble;
        ctx.fillStyle = flash ? '#ffffff' : '#3a0f26';
        ctx.strokeStyle = flash ? '#ffffff' : '#ff4f7b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const a = spin + (i / 14) * TAU;
          const r = i % 2 === 0 ? e.r * 1.2 : e.r * 0.82;
          if (i === 0) ctx.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
          else ctx.lineTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        this.drawEyes(e.x, e.y, e.heading, e.r * 0.45, 2.6, '#ffb347');
        break;
      }
      case 'caster': {
        ctx.fillStyle = flash ? '#ffffff' : '#4d1240';
        ctx.strokeStyle = flash ? '#ffffff' : '#ff5fc0';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        // Hood point
        ctx.beginPath();
        const hx = e.x - Math.cos(e.heading) * e.r * 1.6;
        const hy = e.y - Math.sin(e.heading) * e.r * 1.6;
        ctx.moveTo(e.x + Math.cos(e.heading + 1.9) * e.r, e.y + Math.sin(e.heading + 1.9) * e.r);
        ctx.lineTo(hx, hy);
        ctx.lineTo(e.x + Math.cos(e.heading - 1.9) * e.r, e.y + Math.sin(e.heading - 1.9) * e.r);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#12030e';
        ctx.beginPath();
        ctx.arc(e.x + Math.cos(e.heading) * 3, e.y + Math.sin(e.heading) * 3, e.r * 0.6, 0, TAU);
        ctx.fill();
        this.drawEyes(e.x + Math.cos(e.heading) * 3, e.y + Math.sin(e.heading) * 3, e.heading, e.r * 0.3, 2, '#ff9a3c');
        const charge = e.state === 'windup' ? clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1) : 0;
        const ox = e.x + Math.cos(e.aim) * (e.r + 6);
        const oy = e.y + Math.sin(e.aim) * (e.r + 6);
        ctx.globalCompositeOperation = 'lighter';
        this.drawGlow(COLORS.hostile, ox, oy, 6 + charge * 18, 0.4 + charge * 0.6);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'brute': {
        const shakeX = e.state === 'windup' ? Math.sin(world.time * 60) * 1.5 : 0;
        ctx.save();
        ctx.translate(e.x + shakeX, e.y);
        ctx.rotate(e.heading);
        ctx.fillStyle = flash ? '#ffffff' : '#5a5170';
        ctx.strokeStyle = '#1a1226';
        ctx.lineWidth = 3;
        roundRect(ctx, -e.r, -e.r, e.r * 2, e.r * 2, 8);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = e.state === 'windup' || e.state === 'attack' ? '#ffcf6b' : '#ff8a3c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-e.r * 0.6, -e.r * 0.5);
        ctx.lineTo(-e.r * 0.1, -e.r * 0.1);
        ctx.lineTo(-e.r * 0.4, e.r * 0.5);
        ctx.moveTo(e.r * 0.1, e.r * 0.7);
        ctx.lineTo(e.r * 0.3, e.r * 0.2);
        ctx.stroke();
        ctx.restore();
        this.drawEyes(e.x + shakeX, e.y, e.heading, e.r * 0.5, 3.2, '#ffcf6b');
        if (e.state === 'windup' && !this.view.safeWarnings) this.drawExclaim(e.x, e.y - e.r - 18);
        if (e.state === 'recover') this.drawDizzy(e.x, e.y - e.r - 6, world.time);
        break;
      }
      case 'rival':
      case 'boss':
        this.drawEnemySnake(e, world);
        break;
    }
    if (e.kind !== 'chaser' && e.kind !== 'boss' && e.hp < e.maxHp) {
      const w = e.r * 2.2;
      const y = e.y - e.r - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(e.x - w / 2, y, w, 4);
      ctx.fillStyle = '#ff5a6e';
      ctx.fillRect(e.x - w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  private drawEnemySnake(e: Enemy, world: World): void {
    const ctx = this.ctx;
    const boss = e.kind === 'boss';
    const quiet = this.view.reduceFlashing;
    const flash = e.flash > 0 && !quiet;
    const segs = e.segments;
    if (boss && e.enraged) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow('#ff2a50', e.x, e.y, e.r * 3.2, quiet ? 0.35 : 0.35 + Math.sin(world.time * 8) * 0.12);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = COLORS.outline;
    for (let i = segs.length - 1; i >= 0; i--) {
      const r = e.segRadius * (1 - (i / segs.length) * 0.45) + 2.5;
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, TAU);
      ctx.fill();
    }
    for (let i = segs.length - 1; i >= 0; i--) {
      const r = e.segRadius * (1 - (i / segs.length) * 0.45);
      ctx.fillStyle = flash ? '#ffd6de' : boss ? (i % 3 === 0 ? '#5a1238' : '#2c0a26') : i % 3 === 0 ? '#9c1c3c' : '#6a1028';
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, TAU);
      ctx.fill();
      if (boss && i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,190,90,0.35)';
        ctx.beginPath();
        ctx.arc(segs[i].x, segs[i].y, r * 0.35, 0, TAU);
        ctx.fill();
      }
    }
    // Head
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.heading);
    ctx.fillStyle = COLORS.outline;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.2 + 2.5, e.r + 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : boss ? '#4a0f3a' : '#b3203f';
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.2, e.r, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    this.drawHat(e.x, e.y, e.heading, e.r, boss ? '#1a0716' : '#2a0a16', boss ? '#ffd45e' : '#ff4a5a', world.time, boss);
    this.drawEyes(e.x, e.y, e.heading, e.r * 0.55, boss ? 4.5 : 2.6, boss ? '#ffd45e' : '#ffb347');
    if (e.state === 'windup') {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(COLORS.hostile, e.x, e.y, e.r * 2.4, quiet ? 0.4 : 0.3 + 0.3 * Math.sin(world.time * 20));
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawEyes(x: number, y: number, heading: number, spread: number, size: number, color: string): void {
    const ctx = this.ctx;
    for (const side of [-1, 1]) {
      const a = heading + side * 0.6;
      const ex = x + Math.cos(a) * spread;
      const ey = y + Math.sin(a) * spread;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(ex, ey, size, 0, TAU);
      ctx.fill();
    }
  }

  private drawExclaim(x: number, y: number): void {
    const ctx = this.ctx;
    const safe = this.view.safeWarnings;
    ctx.font = `900 ${safe ? 24 : 20}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = safe ? 6 : 4;
    ctx.strokeStyle = safe ? COLORS.warnDark : '#2a0508';
    ctx.strokeText('!', x, y);
    ctx.fillStyle = safe ? COLORS.warn : '#ff6a4a';
    ctx.fillText('!', x, y);
  }

  private drawDizzy(x: number, y: number, t: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ffe28a';
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + (i / 3) * TAU;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 14, y + Math.sin(a) * 5, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  /** Floppy wizard hat seen from above: brim on the head, cone trailing behind. */
  private drawHat(
    x: number,
    y: number,
    heading: number,
    headR: number,
    color: string,
    band: string,
    t: number,
    big: boolean,
    glow = 0,
  ): void {
    const ctx = this.ctx;
    const back = heading + Math.PI;
    // Sits toward the back of the head so the face (eyes) stays visible in front of the brim.
    const bx = x + Math.cos(back) * headR * 0.5;
    const by = y + Math.sin(back) * headR * 0.5;
    const len = headR * (big ? 2.6 : 2.5);
    const sway = Math.sin(t * 3.2) * 0.25;
    const tipA = back + sway;
    const tx = bx + Math.cos(tipA) * len;
    const ty = by + Math.sin(tipA) * len;
    const perp = back + Math.PI / 2;
    const w = headR * 0.95;
    // Brim
    ctx.fillStyle = COLORS.outline;
    ctx.beginPath();
    ctx.ellipse(bx, by, headR * 0.8 + 2, headR * 0.95 + 2, heading, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(bx, by, headR * 0.8, headR * 0.95, heading, 0, TAU);
    ctx.fill();
    // Cone with a bent tip
    const mx = bx + Math.cos(back) * len * 0.55 + Math.cos(perp) * sway * 8;
    const my = by + Math.sin(back) * len * 0.55 + Math.sin(perp) * sway * 8;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(perp) * w, by + Math.sin(perp) * w);
    ctx.quadraticCurveTo(mx + Math.cos(perp) * w * 0.4, my + Math.sin(perp) * w * 0.4, tx, ty);
    ctx.quadraticCurveTo(mx - Math.cos(perp) * w * 0.4, my - Math.sin(perp) * w * 0.4, bx - Math.cos(perp) * w, by - Math.sin(perp) * w);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Highlight along one side of the cone so it reads as a 3D hat
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(perp) * w * 0.55, by + Math.sin(perp) * w * 0.55);
    ctx.quadraticCurveTo(mx + Math.cos(perp) * w * 0.25, my + Math.sin(perp) * w * 0.25, tx, ty);
    ctx.stroke();
    // Band
    ctx.strokeStyle = band;
    ctx.lineWidth = big ? 4 : 3;
    ctx.beginPath();
    const bandX = bx + Math.cos(back) * headR * 0.45;
    const bandY = by + Math.sin(back) * headR * 0.45;
    ctx.moveTo(bandX + Math.cos(perp) * w * 0.85, bandY + Math.sin(perp) * w * 0.85);
    ctx.lineTo(bandX - Math.cos(perp) * w * 0.85, bandY - Math.sin(perp) * w * 0.85);
    ctx.stroke();
    // Star at the tip
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(band, tx, ty, 8 + glow * 10, 0.6 + glow * 0.3);
    ctx.globalCompositeOperation = 'source-over';
    drawStar(ctx, tx, ty, big ? 6 : 4.5, band);
  }

  private drawSnake(world: World, gesture: GestureView): void {
    const ctx = this.ctx;
    const s = world.snake;
    const segs = s.segments;
    const look = WIZARDS[world.wizard].look;
    const quiet = this.view.reduceFlashing;
    // Invulnerable: blinks, or with reduced flashing stays see-through the whole time.
    const invulnerable = world.invuln > 0 && world.time > 1.6;
    ctx.globalAlpha = invulnerable && quiet ? 0.6 : invulnerable && Math.floor(world.invuln * 14) % 2 === 0 ? 0.4 : 1;
    const hurt = world.hurtFlash > 0.6 && !quiet;

    // Magical aura grows with power: more potency and level = brighter shimmer.
    const power = clamp((world.upgrades.potency + world.level * 0.3) / 8, 0, 1);
    if (power > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < segs.length; i += 3) {
        this.drawGlow(COLORS.bolt, segs[i].x, segs[i].y, 18 + power * 14, 0.08 + power * 0.18);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.fillStyle = COLORS.outline;
    for (let i = segs.length - 1; i >= 0; i--) {
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, s.segmentRadius(i) + 2.5, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, SNAKE.headRadius * 1.2 + 2.5, SNAKE.headRadius + 2.5, s.heading, 0, TAU);
    ctx.fill();
    for (let i = segs.length - 1; i >= 0; i--) {
      const r = s.segmentRadius(i);
      ctx.fillStyle = i % 4 === 1 ? look.bodyDark : look.body;
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(200,255,240,0.35)';
      ctx.beginPath();
      ctx.arc(segs[i].x - r * 0.25, segs[i].y - r * 0.3, r * 0.4, 0, TAU);
      ctx.fill();
    }
    if (hurt) {
      ctx.fillStyle = 'rgba(255,60,90,0.5)';
      for (const seg of segs) {
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, 10, 0, TAU);
        ctx.fill();
      }
    }

    // Head
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.heading);
    ctx.fillStyle = hurt ? '#ff9aa8' : look.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, SNAKE.headRadius * 1.2, SNAKE.headRadius, 0, 0, TAU);
    ctx.fill();
    // Tongue flick
    const flick = (s.anim % 2.4) < 0.25;
    if (flick) {
      ctx.strokeStyle = '#ff4f7b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(SNAKE.headRadius * 1.15, 0);
      ctx.lineTo(SNAKE.headRadius * 1.15 + 9, 0);
      ctx.lineTo(SNAKE.headRadius * 1.15 + 13, -3);
      ctx.moveTo(SNAKE.headRadius * 1.15 + 9, 0);
      ctx.lineTo(SNAKE.headRadius * 1.15 + 13, 3);
      ctx.stroke();
    }
    ctx.restore();

    this.drawHat(s.x, s.y, s.heading, SNAKE.headRadius, look.hat, look.band, s.anim, false, power);

    // Eyes look toward the recorded target while drawing.
    const gaze = gesture.active && gesture.target ? Math.atan2(gesture.target.y - s.y, gesture.target.x - s.x) : s.heading;
    for (const side of [-1, 1]) {
      const a = s.heading + side * 0.55;
      const ex = s.x + Math.cos(a) * SNAKE.headRadius * 0.62;
      const ey = s.y + Math.sin(a) * SNAKE.headRadius * 0.62;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, 4.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#140a24';
      ctx.beginPath();
      ctx.arc(ex + Math.cos(gaze) * 1.8, ey + Math.sin(gaze) * 1.8, 2.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawBolts(world: World): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of world.bolts) {
      ctx.strokeStyle = hexAlpha(COLORS.bolt, 0.55);
      ctx.lineWidth = b.r * 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.045, b.y - b.vy * 0.045);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      this.drawGlow(COLORS.bolt, b.x, b.y, b.r * 4, 0.9);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COLORS.boltCore;
    for (const b of world.bolts) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.65, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }

  private drawNovas(world: World): void {
    const ctx = this.ctx;
    for (const n of world.novas) {
      const expanding = n.t < n.duration;
      const fade = expanding ? 1 : clamp(1 - (n.t - n.duration) / 0.25, 0, 1);
      ctx.globalCompositeOperation = 'lighter';
      const grad = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, n.radius);
      grad.addColorStop(0, 'rgba(255,212,94,0)');
      grad.addColorStop(1, `rgba(255,212,94,${0.28 * fade})`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,232,150,${0.95 * fade})`;
      ctx.lineWidth = 6 * fade + 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,212,94,${0.45 * fade})`;
      ctx.lineWidth = 14 * fade;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(0, n.radius - 8), 0, TAU);
      ctx.stroke();
      // Rune ticks riding the ring
      ctx.strokeStyle = `rgba(255,250,220,${0.8 * fade})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + n.t * 3;
        ctx.beginPath();
        ctx.moveTo(n.x + Math.cos(a) * (n.radius - 10), n.y + Math.sin(a) * (n.radius - 10));
        ctx.lineTo(n.x + Math.cos(a) * (n.radius + 6), n.y + Math.sin(a) * (n.radius + 6));
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawArcs(world: World, t: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const arc of world.arcs) {
      const k = arc.life / arc.maxLife;
      // Lightning re-jitters 30 times a second; with reduced flashing it holds one shape, dimmer.
      const quiet = this.view.reduceFlashing;
      const rng = mulberry32(Math.floor(arc.seed + (quiet ? 0 : t * 30)));
      const path: Vec[] = [];
      for (let i = 0; i < arc.points.length - 1; i++) {
        const a = arc.points[i];
        const b = arc.points[i + 1];
        const len = dist(a.x, a.y, b.x, b.y);
        const steps = Math.max(3, Math.floor(len / 22));
        const nx = -(b.y - a.y) / (len || 1);
        const ny = (b.x - a.x) / (len || 1);
        for (let j = 0; j < steps; j++) {
          const u = j / steps;
          const jitter = j === 0 ? 0 : (rng() - 0.5) * 26;
          path.push({ x: a.x + (b.x - a.x) * u + nx * jitter, y: a.y + (b.y - a.y) * u + ny * jitter });
        }
      }
      path.push(arc.points[arc.points.length - 1]);
      for (const [width, color, alpha] of [
        [12, COLORS.lightning, 0.25],
        [5, COLORS.lightning, 0.7],
        [2, COLORS.lightningCore, 1],
      ] as const) {
        ctx.strokeStyle = hexAlpha(color, alpha * k * (quiet ? 0.6 : 1));
        ctx.lineWidth = width * (arc.fizzle ? 0.6 : 1);
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
      for (let i = 1; i < arc.points.length; i++) {
        this.drawGlow(COLORS.lightning, arc.points[i].x, arc.points[i].y, 26, quiet ? k * 0.4 : k);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
  }

  /** Frost Fields lie on the floor under everything else: icy pool, dashed frosted rim, snowflakes. */
  private drawFrostFields(world: World, t: number): void {
    const ctx = this.ctx;
    for (const f of world.frostFields) {
      const grow = clamp(f.t / 0.25, 0, 1);
      const k = grow * clamp((f.duration - f.t) / 0.5, 0, 1);
      const r = f.radius * (0.85 + 0.15 * grow);
      const g = ctx.createRadialGradient(f.x, f.y, r * 0.15, f.x, f.y, r);
      g.addColorStop(0, `rgba(127,178,255,${0.08 * k})`);
      g.addColorStop(0.75, `rgba(127,178,255,${0.2 * k})`);
      g.addColorStop(1, `rgba(210,232,255,${0.34 * k})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(226,240,255,${0.75 * k})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 9]);
      ctx.lineDashOffset = -t * 18;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      // Snowflakes resting around the field.
      ctx.strokeStyle = `rgba(240,248,255,${0.8 * k})`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU + t * 0.25 + f.id;
        const d = r * (i % 2 === 0 ? 0.72 : 0.42);
        const fx = f.x + Math.cos(a) * d;
        const fy = f.y + Math.sin(a) * d;
        for (let j = 0; j < 3; j++) {
          const b = (j / 3) * Math.PI + a;
          ctx.beginPath();
          ctx.moveTo(fx - Math.cos(b) * 5, fy - Math.sin(b) * 5);
          ctx.lineTo(fx + Math.cos(b) * 5, fy + Math.sin(b) * 5);
          ctx.stroke();
        }
      }
    }
  }

  /** Elite auras, the frosty tint of chilled foes and the ice block around frozen ones. */
  private drawEnemyStatus(e: Enemy, world: World): void {
    const ctx = this.ctx;
    const t = world.time;
    if (e.elite) {
      const color = e.elite === 'shielded' ? COLORS.eliteShield : e.elite === 'swift' ? COLORS.eliteSwift : COLORS.eliteSplit;
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(color, e.x, e.y, e.r * 2.6, 0.22 + 0.08 * Math.sin(t * 6 + e.wobble));
      ctx.globalCompositeOperation = 'source-over';
      if (e.elite === 'shielded' && e.shield > 0) {
        const k = e.shield / e.shieldMax;
        ctx.fillStyle = hexAlpha(COLORS.eliteShield, 0.1 + 0.12 * k);
        ctx.strokeStyle = hexAlpha(COLORS.eliteShield, 0.35 + 0.5 * k);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        // A hexagonal barrier.
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * TAU + t * 0.6;
          const x = e.x + Math.cos(a) * e.r * 1.55;
          const y = e.y + Math.sin(a) * e.r * 1.55;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.fill();
        ctx.stroke();
      } else if (e.elite === 'swift') {
        // Speed streaks trailing behind.
        ctx.strokeStyle = hexAlpha(COLORS.eliteSwift, 0.6);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        const back = e.heading + Math.PI;
        for (const side of [-1, 0, 1]) {
          const ox = Math.cos(back + Math.PI / 2) * side * e.r * 0.6;
          const oy = Math.sin(back + Math.PI / 2) * side * e.r * 0.6;
          const len = e.r * (1.2 + 0.4 * Math.sin(t * 20 + side));
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(back) * e.r * 1.1 + ox, e.y + Math.sin(back) * e.r * 1.1 + oy);
          ctx.lineTo(e.x + Math.cos(back) * (e.r * 1.1 + len) + ox, e.y + Math.sin(back) * (e.r * 1.1 + len) + oy);
          ctx.stroke();
        }
        ctx.lineCap = 'butt';
      } else if (e.elite === 'splitting') {
        ctx.strokeStyle = hexAlpha(COLORS.eliteSplit, 0.75);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -t * 30;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 1.45, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Crown marker so elites read at a glance.
      drawStar(ctx, e.x, e.y - e.r - 12, 5, color);
    }
    if (e.stunned > 0) {
      this.drawDizzy(e.x, e.y - e.r - 6, t);
      ctx.strokeStyle = hexAlpha(WIZARDS[world.wizard].look.body, 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1.1 + 0.1 * Math.sin(t * 18)), 0, TAU);
      ctx.stroke();
    }
    if (e.frozen > 0) {
      ctx.fillStyle = 'rgba(200,230,255,0.45)';
      ctx.strokeStyle = 'rgba(240,250,255,0.9)';
      ctx.lineWidth = 2;
      roundRect(ctx, e.x - e.r * 1.25, e.y - e.r * 1.25, e.r * 2.5, e.r * 2.5, 4);
      ctx.fill();
      ctx.stroke();
    } else if (e.chill > 0) {
      ctx.fillStyle = 'rgba(150,195,255,0.3)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 1.05, 0, TAU);
      ctx.fill();
    }
  }

  /** Arcane Ward: a glowing ring with a turning triangle; one bright pip per remaining charge. */
  private drawWard(world: World, t: number): void {
    const w = world.ward;
    if (!w) return;
    const ctx = this.ctx;
    const s = world.snake;
    const R = SNAKE.headRadius * 2.3;
    const left = w.duration - w.t;
    const quiet = this.view.reduceFlashing;
    // Ending: blinks, or with reduced flashing fades steadily instead.
    const vis = left >= 1.5 ? 1 : quiet ? 0.35 + 0.65 * (left / 1.5) : Math.floor(t * 10) % 2 === 0 ? 0.35 : 1;
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(COLORS.ward, s.x, s.y, R * 1.7, (0.2 + (quiet ? 0.15 : 0.45) * w.flash) * vis);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexAlpha(COLORS.ward, 0.55 * vis);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, R, 0, TAU);
    ctx.stroke();
    const rot = t * 1.6;
    ctx.strokeStyle = hexAlpha(COLORS.wardCore, 0.85 * vis);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = rot + (i / 3) * TAU;
      const x = s.x + Math.cos(a) * R * 1.12;
      const y = s.y + Math.sin(a) * R * 1.12;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < w.charges; i++) {
      const a = -rot * 0.7 + (i / Math.max(1, w.charges)) * TAU;
      drawStar(ctx, s.x + Math.cos(a) * R * 1.35, s.y + Math.sin(a) * R * 1.35, 4, COLORS.wardCore);
    }
  }

  /** Arcane Lance beams: a wide glow, a bright band and a white core that fade together. */
  private drawBeams(world: World): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of world.beams) {
      const k = b.life / b.maxLife;
      for (const [width, color, alpha] of [
        [b.width * 1.6, COLORS.bolt, 0.3],
        [b.width * 0.6, COLORS.bolt, 0.8],
        [3, COLORS.boltCore, 1],
      ] as const) {
        ctx.strokeStyle = hexAlpha(color, alpha * k);
        ctx.lineWidth = width * (0.6 + 0.4 * k);
        ctx.beginPath();
        ctx.moveTo(b.x0, b.y0);
        ctx.lineTo(b.x1, b.y1);
        ctx.stroke();
      }
      this.drawGlow(COLORS.bolt, b.x1, b.y1, 30, k);
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Hostile projectiles: dark outline + hot core so they read against every friendly effect. */
  private drawShots(world: World): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of world.shots) this.drawGlow(COLORS.hostile, p.x, p.y, p.r * 3, 0.6);
    ctx.globalCompositeOperation = 'source-over';
    for (const p of world.shots) {
      const pulse = 1 + Math.sin(p.spin * 2) * 0.1;
      ctx.fillStyle = COLORS.hostileDark;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse + 2.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = COLORS.hostile;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = COLORS.hostileCore;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.45, 0, TAU);
      ctx.fill();
    }
  }

  private drawParticles(world: World): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of world.particles) {
      if (!this.near(p.x, p.y, 40)) continue;
      const k = p.life / p.max;
      if (p.kind === 'glow') {
        this.drawGlow(p.color, p.x, p.y, p.size * (0.5 + k), k);
      } else {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = p.size * (0.4 + 0.6 * k);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawWorldFloaters(world: World): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of world.floaters) {
      if (f.screen) continue;
      if (this.pixel) {
        // Pixel mode draws world text in screen space so the pixel font stays on whole sizes.
        const p = this.worldToScreen(f);
        this.drawFloater(f.text, p.x, p.y, f.size, f.color, f.life / f.max);
      } else {
        this.drawFloater(f.text, f.x, f.y, f.size / Math.max(0.6, this.scale), f.color, f.life / f.max);
      }
    }
  }

  private drawFloater(text: string, x: number, y: number, size: number, color: string, k: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(k * 2, 0, 1);
    ctx.font = this.font(size, 800);
    ctx.lineWidth = Math.max(3, size / 4.5);
    ctx.strokeStyle = 'rgba(14,6,26,0.9)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
  }

  private drawAim(world: World, target: Vec, t: number): void {
    const ctx = this.ctx;
    const s = world.snake;
    const far = dist(s.x, s.y, target.x, target.y) >= SNAKE.aimMinDistance;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -t * 40;
    ctx.strokeStyle = 'rgba(200,240,255,0.32)';
    ctx.beginPath();
    if (far) {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(target.x, target.y);
    } else {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(s.heading) * 140, s.y + Math.sin(s.heading) * 140);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Target reticle
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.rotate(t * 1.5);
    ctx.strokeStyle = far ? 'rgba(160,250,255,0.9)' : 'rgba(160,250,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(17, 0);
      ctx.lineTo(23, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(220,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(target.x, target.y, 2.5, 0, TAU);
    ctx.fill();
  }

  /** Strength of the red edge: a flash when hurt and a pulse at low health, both steady with reduced flashing. */
  private dangerTint(world: World, t: number): number {
    const lowHp = world.hp / world.stats.maxHp < 0.3 && world.hp > 0;
    if (this.view.reduceFlashing) return Math.max(world.hurtFlash * 0.22, lowHp ? 0.22 : 0);
    return Math.max(world.hurtFlash * 0.5, lowHp ? 0.25 + Math.sin(t * 5) * 0.1 : 0);
  }

  private drawVignettes(world: World, t: number): void {
    const ctx = this.ctx;
    const a = this.dangerTint(world, t);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(
      this.cssW / 2,
      this.cssH / 2,
      Math.min(this.cssW, this.cssH) * 0.3,
      this.cssW / 2,
      this.cssH / 2,
      Math.max(this.cssW, this.cssH) * 0.7,
    );
    g.addColorStop(0, 'rgba(255,30,60,0)');
    g.addColorStop(1, `rgba(255,30,60,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  private drawBanner(world: World): void {
    const b = world.banner;
    if (!b) return;
    const ctx = this.ctx;
    const inT = clamp(b.t / 0.3, 0, 1);
    const outT = clamp((b.max - b.t) / 0.5, 0, 1);
    const a = Math.min(inT, outT);
    const cx = this.cssW / 2;
    const cy = this.oy + this.viewH * this.scale * 0.22;
    const size = clamp(this.scale * 44, 22, 52);
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = this.font(size, 700, true);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(14,6,26,0.9)';
    ctx.strokeText(b.text, cx, cy);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, cx, cy);
    ctx.font = this.font(size * 0.42, 600);
    ctx.lineWidth = 4;
    ctx.strokeText(b.sub, cx, cy + size * 0.85);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(b.sub, cx, cy + size * 0.85);
    ctx.globalAlpha = 1;
  }

  /**
   * The sigil trail is screen-space and drawn last, above every other effect. While drawing it
   * takes the colour of the spell the stroke currently reads as, glowing brighter when clean.
   */
  private drawGesture(g: GestureView): void {
    const ctx = this.ctx;
    if (g.fade) {
      const k = 1 - g.fade.t;
      if (k > 0) this.drawTrail(g.fade.points, g.fade.color, k);
    }
    if (g.active && g.points.length > 0) {
      const tier = g.reading?.tier;
      this.drawTrail(g.points, readingColor(g), tier === 'perfect' ? 1.35 : tier === 'clean' ? 1.15 : 1);
      const tip = g.points[g.points.length - 1];
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(tier === 'perfect' ? COLORS.nova : '#ffffff', tip.x, tip.y, tier === 'perfect' ? 20 : 14, 0.9);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** A small label by the pen tip naming the spell the stroke reads as, and how cleanly. */
  private drawReading(g: GestureView, world: World): void {
    const r = g.reading;
    if (!g.active || !r || g.points.length === 0) return;
    const tip = g.points[g.points.length - 1];
    const label = !r.known
      ? `${spellName(world, r.spell)} · not learned`
      : `${spellName(world, r.spell)}${r.tier === 'perfect' ? ' · Perfect' : r.tier === 'clean' ? ' · Clean' : ''}`;
    const ctx = this.ctx;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.drawFloater(label, tip.x + 18, tip.y - 18, 14, r.known ? (r.tier === 'perfect' ? COLORS.nova : readingColor(g)) : COLORS.unclear, 0.5);
  }

  /** The loop that just crushed foes: a flash of the body's colour filling it. */
  private drawConstricts(world: World): void {
    const ctx = this.ctx;
    const color = WIZARDS[world.wizard].look.body;
    for (const c of world.constricts) {
      const k = c.life / c.maxLife;
      ctx.beginPath();
      ctx.moveTo(c.points[0].x, c.points[0].y);
      for (const p of c.points) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      const quiet = this.view.reduceFlashing;
      ctx.fillStyle = hexAlpha(color, (quiet ? 0.16 : 0.32) * k);
      ctx.fill();
      ctx.strokeStyle = hexAlpha('#ffffff', (quiet ? 0.35 : 0.7) * k);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /** While the body nearly encloses foes: the gap still to close, and a faint fill of the loop. */
  private drawCoilHint(world: World, t: number): void {
    const coil = world.coil;
    if (!coil || coil.closed) return;
    const s = world.snake;
    const seg = s.segments[coil.index];
    if (!seg) return;
    const ctx = this.ctx;
    const color = WIZARDS[world.wizard].look.body;
    const pulse = this.view.reduceFlashing ? 0.8 : 0.55 + 0.35 * Math.sin(t * 10);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    for (let i = 0; i <= coil.index; i++) ctx.lineTo(s.segments[i].x, s.segments[i].y);
    ctx.closePath();
    ctx.fillStyle = hexAlpha(color, 0.08 + 0.06 * pulse);
    ctx.fill();
    ctx.strokeStyle = hexAlpha('#ffffff', pulse);
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(seg.x, seg.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawTrail(points: Pt[], color: string, alpha: number): void {
    if (points.length < 2) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [width, a, c] of [
      [18, 0.16, color],
      [9, 0.35, color],
      [3.5, 0.95, '#ffffff'],
    ] as const) {
      ctx.strokeStyle = hexAlpha(c, a * alpha);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
  }

  private drawScreenFloaters(world: World): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of world.floaters) {
      if (!f.screen) continue;
      this.drawFloater(f.text, f.x, f.y, f.size, f.color, f.life / f.max);
    }
  }
}

// ---------------------------------------------------------------- helpers

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/** The live trail colour: the spell the stroke reads as (greyed if not learned), or the plain trail. */
function readingColor(g: GestureView): string {
  const r = g.reading;
  if (!r) return COLORS.sigilTrail;
  return r.known ? SPELL_COLORS[r.spell] : '#9a90b8';
}

/** '#rrggbb' + alpha -> 'rgba(...)'. */
export function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}
