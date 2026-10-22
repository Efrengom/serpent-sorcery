import type { Camera } from './camera';
import { BUFF_INFO, HEAL_COLOR } from './breakables';
import { AREA_STYLE, ClassicFloor } from './classicFloor';
import { ARCHETYPE, CAMERA, ENEMIES, PIXEL_ART, SNAKE, VIEW, type BossId } from './config';
import { drawBlastMarks, drawBlastsInFlight, drawDescent, drawGroundFx, drawHazardShimmer } from './hazardDraw';
import { aimLines, attackLane, fadeLevel, flameCone, windup } from './telegraph';
import { castRay, clearanceAt } from './terrain';
import { shakeOffset } from './effects';
import type { Pt } from './gesture';
import type { MapLayout } from './maps/types';
import { clamp, dist, mulberry32, TAU, type Vec } from './math';
import { fillIcon, strokeIcon } from './icons';
import { Minimap } from './minimap';
import { COLORS } from './palette';
import { DEFAULT_VIEW, type ViewOptions } from './options';
import { createCanvas } from './pixel/bake';
import {
  buildVignette,
  drawAim,
  drawBreakables,
  drawPickups,
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
  drawBlastMarks as drawBlastMarksPixel,
  drawBlastsInFlight as drawBlastsInFlightPixel,
  drawDescent as drawDescentPixel,
  drawGroundFx as drawGroundFxPixel,
  drawHazards,
  setDrawBounds,
} from './pixel/draw';
import { PixelFloor } from './pixel/floor';
import { SPELL_COLORS, spellName } from './spells';
import { WIZARDS } from './wizards';
import type { Breakable, Enemy, EnemyShot, GestureView, World } from './world';

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

/**
 * Classic colours of the smaller foes: body, outline, eyes and an accent (a brute's glowing
 * cracks, a Thornback's thorns, a Burrow Viper's bands, a Crypt Golem's frost seams).
 */
const FOE_LOOK = {
  chaser: { fill: '#3a0f26', line: '#ff4f7b', eye: '#ffb347', crack: '' },
  imp: { fill: '#5a1606', line: '#ff8a3c', eye: '#ffe08a', crack: '' },
  caster: { fill: '#4d1240', line: '#ff5fc0', eye: '#ff9a3c', crack: '' },
  pyromancer: { fill: '#5a1a08', line: '#ff8a3c', eye: '#ffd36b', crack: '' },
  brute: { fill: '#5a5170', line: '#1a1226', eye: '#ffcf6b', crack: '#ff8a3c' },
  magmaBrute: { fill: '#2e1e1a', line: '#0e0604', eye: '#ffd36b', crack: '#ff7a2a' },
  sporeling: { fill: '#b8379a', line: '#2a0626', eye: '#7affd8', crack: '' },
  puffcap: { fill: '#c97ab6', line: '#3a0e34', eye: '#1a0418', crack: '' },
  thornback: { fill: '#34402a', line: '#0c1008', eye: '#ffd36b', crack: '#d856bc' },
  burrowViper: { fill: '#8a6638', line: '#1a0e06', eye: '#ffe066', crack: '#4a3018' },
  rattler: { fill: '#e6dcc4', line: '#2a2418', eye: '#7ad8ff', crack: '' },
  frostArcher: { fill: '#1c2c4c', line: '#8fd0ff', eye: '#9fe8ff', crack: '' },
  golem: { fill: '#7a8ca4', line: '#101826', eye: '#bff0ff', crack: '#9fd8ff' },
  wraith: { fill: '#c8e0ff', line: '#eef8ff', eye: '#7af0ff', crack: '' },
};

/**
 * Classic colours of the serpents: rival, Salamander and each boss. A Salamander wears no hat;
 * Sporemaw wears a mushroom cap instead (`hat` is the cap, `band` its glowing gills) and
 * Rimecoil a crest of icicles under its hat. Their bodies sprout small caps or ice shards.
 */
const SERPENT_LOOK: Record<
  'rival' | 'salamander' | BossId,
  { seg: [string, string]; head: string; hat: string | null; band: string; eye: string; spot: string | null; enrage: string; crown?: 'cap' | 'crest' }
> = {
  rival: { seg: ['#9c1c3c', '#6a1028'], head: '#b3203f', hat: '#2a0a16', band: '#ff4a5a', eye: '#ffb347', spot: null, enrage: '#ff2a50' },
  salamander: { seg: ['#e0602a', '#a8321e'], head: '#ff7a2a', hat: null, band: '', eye: '#ffe08a', spot: 'rgba(60,10,0,0.35)', enrage: '#ff6a2a' },
  ouroboros: { seg: ['#5a1238', '#2c0a26'], head: '#4a0f3a', hat: '#1a0716', band: '#ffd45e', eye: '#ffd45e', spot: 'rgba(255,190,90,0.35)', enrage: '#ff2a50' },
  sporemaw: { seg: ['#24645c', '#143a3a'], head: '#2a5a52', hat: '#9a2a86', band: '#5fffd0', eye: '#ff8ae8', spot: 'rgba(255,120,220,0.5)', enrage: '#ff5ad8', crown: 'cap' },
  rimecoil: { seg: ['#5a8cbc', '#2c4a72'], head: '#4a7aaa', hat: '#16284a', band: '#bfe6ff', eye: '#eaf8ff', spot: 'rgba(230,248,255,0.55)', enrage: '#7ad8ff', crown: 'crest' },
  pyrecoil: { seg: ['#5a1a0a', '#2e0e06'], head: '#4a1206', hat: '#1a0604', band: '#ff7a2a', eye: '#ffb35c', spot: 'rgba(255,140,60,0.6)', enrage: '#ff6a2a' },
};

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
    const near = (x: number, y: number, m: number) => this.near(x, y, m);
    const glow = (c: string, x: number, y: number, r: number, a?: number) => this.drawGlow(c, x, y, r, a);
    drawHazardShimmer(ctx, world, realTime, near, glow, this.view.reduceFlashing);
    this.drawAmbient(world, realTime);
    this.drawClearing(world, realTime);
    drawGroundFx(ctx, world, realTime, near, glow);
    drawDescent(ctx, world, realTime, glow, this.view.reduceFlashing);
    this.drawPortals(world, realTime);
    this.drawFrostFields(world, realTime);
    this.drawCrystals(world);
    this.drawBreakables(world);
    this.drawPickups(world, realTime);
    this.drawTelegraphs(world);
    drawBlastMarks(ctx, world, realTime, near, this.view.safeWarnings, () => this.hazardPattern(), this.view.reduceFlashing);
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
    drawBlastsInFlight(ctx, world, near, glow);
    this.drawParticles(world);
    this.drawWorldFloaters(world);
    if (gesture.active && gesture.target && showSnake) this.drawAim(world, gesture.target, realTime);
    const arrows = this.arrows(world);
    for (const a of arrows) this.drawArrow(a.x, a.y, a.a, a.p.color);
    ctx.restore();
    // Arriving on a new map: up from black.
    const fade = fadeLevel(world);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
    }
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

  /** What deserves an arrow when it's off-screen: the way down, the boss (or its portal), else the clearing it's coming to. */
  private pointers(world: World): Pointer[] {
    if (world.descent) return [{ x: world.descent.x, y: world.descent.y, label: 'Way down', color: COLORS.nova }];
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
    const quiet = this.view.reduceFlashing;
    drawHazards(low, world, realTime, quiet);
    drawTorches(low, this.pixelFloor.torches, realTime, world.area);
    if (world.bossClearing >= 0) drawClearingMark(low, world.map.clearings[world.bossClearing], realTime, this.view.reduceFlashing);
    drawGroundFxPixel(low, world, realTime);
    drawDescentPixel(low, world, realTime, quiet);
    drawFrostFields(low, world, realTime);
    drawPortals(low, world, realTime);
    drawCrystals(low, world);
    drawBreakables(low, world, quiet);
    drawPickups(low, world, realTime, quiet);
    drawTelegraphs(low, world, this.view.safeWarnings, quiet);
    drawBlastMarksPixel(low, world, realTime, this.view.safeWarnings, quiet);
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
    drawBlastsInFlightPixel(low, world);
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
    const fade = fadeLevel(world);
    if (fade > 0) {
      main.fillStyle = `rgba(0,0,0,${fade})`;
      main.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
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
    const st = AREA_STYLE[this.area] ?? AREA_STYLE[0];
    ctx.globalCompositeOperation = 'lighter';
    world.map.torches.forEach((torch, i) => {
      if (!this.near(torch.x, torch.y, 40)) return;
      const phase = i * 1.7;
      // Flames flicker (warm, or cold blue in the Catacombs); the Hollows' glowing caps only breathe.
      const f = st.walls === 'roots' ? 0.85 + Math.sin(t * 1.4 + phase) * 0.1 : 0.75 + Math.sin(t * 9 + phase) * 0.12 + Math.sin(t * 23 + phase * 2) * 0.08;
      this.drawGlow(st.flame[0], torch.x, torch.y, 26 * f, 0.9);
      this.drawGlow(st.flame[1], torch.x, torch.y - 2, 8 * f, 0.9);
    });
    // The Heartroot's heart pulses slowly (steady with reduced flashing).
    for (const l of world.map.landmarks) {
      if (l.kind !== 'heartroot' || !this.near(l.x, l.y, 120)) continue;
      this.drawGlow('#ff6ad8', l.x, l.y, 75, this.view.reduceFlashing ? 0.4 : 0.32 + 0.12 * Math.sin(t * 1.5));
    }
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
      const big = p.kind === 'boss' ? 2.6 : ARCHETYPE[p.kind] === 'brute' ? 1.4 : 1;
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

  /**
   * Each map's containers, standing on their shadows: urns and reliquaries, geodes and braziers,
   * glowcaps and seed pods, frosted urns and coffins. The large ones crack as they wear down.
   */
  private drawBreakables(world: World): void {
    const ctx = this.ctx;
    const quiet = this.view.reduceFlashing;
    for (const b of world.breakables) {
      if (!this.near(b.x, b.y, 40)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(b.x + 4, b.y + b.r * 0.75, b.r * 0.95, b.r * 0.38, 0, 0, TAU);
      ctx.fill();
      if (b.look === 'urn') this.drawUrn(b);
      else if (b.look === 'frostUrn') this.drawUrn(b, true);
      else if (b.look === 'geode') this.drawGeode(b);
      else if (b.look === 'brazier') this.drawBrazier(b, world.time);
      else if (b.look === 'glowcap') this.drawGlowcaps(b, world.time);
      else if (b.look === 'seedpod') this.drawSeedpod(b);
      else if (b.look === 'coffin') this.drawCoffin(b);
      else this.drawReliquary(b);
      if (b.flash > 0 && !quiet) {
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 1.6);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** A clay urn: round body, narrow neck, a painted band. A frost urn is blue-glazed and furred with rime. */
  private drawUrn(b: Breakable, frost = false): void {
    const ctx = this.ctx;
    const r = b.r;
    const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.2, 1, b.x, b.y, r * 1.1);
    g.addColorStop(0, frost ? '#c4d8ec' : '#d98a52');
    g.addColorStop(1, frost ? '#3a4c6e' : '#6e3220');
    ctx.fillStyle = g;
    ctx.strokeStyle = frost ? '#0c1424' : '#24100a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + r * 0.1, r * 0.82, r * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(b.x - r * 0.32, b.y - r * 0.95, r * 0.64, r * 0.4);
    ctx.strokeRect(b.x - r * 0.32, b.y - r * 0.95, r * 0.64, r * 0.4);
    ctx.fillStyle = frost ? '#182438' : '#3a180c';
    ctx.beginPath();
    ctx.ellipse(b.x, b.y - r * 0.95, r * 0.42, r * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = frost ? (b.variant % 2 === 0 ? '#9fd8ff' : '#e8c87a') : b.variant % 2 === 0 ? '#e8c87a' : '#7fd0c0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y + r * 0.05, r * 0.8, r * 0.22, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    if (frost) {
      // Rime on the shoulder and round the lip.
      ctx.strokeStyle = 'rgba(240,250,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y + r * 0.1, r * 0.7, r * 0.68, 0, Math.PI * 1.05, Math.PI * 1.7);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y - r * 0.95, r * 0.42, r * 0.16, 0, 0, TAU);
      ctx.stroke();
    }
  }

  /** A cluster of little glowing mushrooms, teal or magenta, breathing softly (steady with reduced flashing). */
  private drawGlowcaps(b: Breakable, t: number): void {
    const ctx = this.ctx;
    const r = b.r;
    const color = b.variant % 2 === 0 ? '#5fffd0' : '#ff6ad8';
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(color, b.x, b.y, r * 1.8, this.view.reduceFlashing ? 0.4 : 0.32 + 0.1 * Math.sin(t * 2 + b.id));
    ctx.globalCompositeOperation = 'source-over';
    for (const [dx, dy, s] of [
      [-0.45, 0.25, 0.48],
      [0.42, 0.3, 0.42],
      [0, -0.28, 0.62],
    ] as const) {
      const x = b.x + dx * r;
      const y = b.y + dy * r;
      const cr = s * r;
      const cap = ctx.createRadialGradient(x - cr * 0.35, y - cr * 0.35, 1, x, y, cr);
      cap.addColorStop(0, '#f2fffb');
      cap.addColorStop(0.5, color);
      cap.addColorStop(1, b.variant % 2 === 0 ? '#167a68' : '#7a1e66');
      ctx.fillStyle = cap;
      ctx.strokeStyle = '#06100e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, cr, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(x + cr * 0.3, y - cr * 0.1, cr * 0.16, 0, TAU);
      ctx.arc(x - cr * 0.15, y + cr * 0.35, cr * 0.12, 0, TAU);
      ctx.fill();
    }
  }

  /** A big woody seed pod lying on its side: a ridged husk split by a glowing seam, cracking as it wears. */
  private drawSeedpod(b: Breakable): void {
    const ctx = this.ctx;
    const r = b.r;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate((b.variant % 4) * 0.45 - 0.7);
    const husk = ctx.createRadialGradient(-r * 0.35, -r * 0.3, 2, 0, 0, r * 1.1);
    husk.addColorStop(0, '#b08654');
    husk.addColorStop(0.6, '#5e3c1e');
    husk.addColorStop(1, '#24140a');
    ctx.fillStyle = husk;
    ctx.strokeStyle = '#140a04';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.05, r * 0.78, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // The stalk end, and ridges running along the husk.
    ctx.fillStyle = '#3a2412';
    ctx.fillRect(-r * 1.22, -r * 0.12, r * 0.24, r * 0.24);
    ctx.strokeStyle = 'rgba(30,16,6,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const s of [-0.62, -0.32, 0.32, 0.62]) {
      ctx.moveTo(-r * 0.95, s * r * 0.4);
      ctx.quadraticCurveTo(0, s * r * 1.15, r * 0.95, s * r * 0.4);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#5fffd0', 0, 0, r * 0.9, 0.45);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#c8fff2';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.72, r * 0.07, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    this.drawWear(b, b.x - r, b.y - r * 0.75, r * 2, r * 1.5);
  }

  /** A frosted wooden coffin bound with iron, a pale sigil glowing on its lid; it cracks as it wears. */
  private drawCoffin(b: Breakable): void {
    const ctx = this.ctx;
    const r = b.r;
    const L = r * 1.15;
    const W = r * 0.62;
    const foot = r * 0.4;
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.variant % 2 === 1) ctx.rotate(Math.PI / 2);
    const wood = ctx.createLinearGradient(0, -W, 0, W);
    wood.addColorStop(0, '#8a5c3a');
    wood.addColorStop(1, '#3a2214');
    ctx.fillStyle = wood;
    ctx.strokeStyle = '#140a04';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-L, -W * 0.7);
    ctx.lineTo(-L * 0.5, -W);
    ctx.lineTo(L, -foot);
    ctx.lineTo(L, foot);
    ctx.lineTo(-L * 0.5, W);
    ctx.lineTo(-L, W * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Planks, then two iron straps across.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-L * 0.9, -W * 0.25);
    ctx.lineTo(L * 0.95, -foot * 0.3);
    ctx.moveTo(-L * 0.9, W * 0.25);
    ctx.lineTo(L * 0.95, foot * 0.3);
    ctx.stroke();
    for (const x of [-L * 0.3, L * 0.5]) {
      const half = x < 0 ? W * 0.95 : foot + (W - foot) * 0.3;
      for (const [color, width] of [
        ['#141a24', 5],
        ['#8a96a8', 2.5],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x, -half);
        ctx.lineTo(x, half);
        ctx.stroke();
      }
    }
    // Rime along the lid's upper edge.
    ctx.strokeStyle = 'rgba(235,248,255,0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-L + 2, -W * 0.7 + 2);
    ctx.lineTo(-L * 0.5, -W + 2);
    ctx.lineTo(L - 2, -foot + 2);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#7fd0ff', 0, 0, 12, 0.7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#d8f4ff';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 5);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    this.drawWear(b, b.x - r, b.y - r * 0.6, r * 2, r * 1.2);
  }

  /** Dark cracks across a large container, more of them the more it has worn. */
  private drawWear(b: Breakable, x: number, y: number, w: number, h: number): void {
    const wear = 1 - b.hp / b.maxHp;
    if (wear <= 0.05) return;
    const ctx = this.ctx;
    const rng = mulberry32(b.id);
    ctx.strokeStyle = 'rgba(10,4,2,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < Math.ceil(wear * 5); i++) {
      let cx = x + w * (0.2 + rng() * 0.6);
      let cy = y + h * (0.2 + rng() * 0.6);
      ctx.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) {
        cx += (rng() - 0.5) * 14;
        cy += (rng() - 0.5) * 10;
        ctx.lineTo(cx, cy);
      }
    }
    ctx.stroke();
  }

  /** A lump of dark rock split open on glowing crystal. */
  private drawGeode(b: Breakable): void {
    const ctx = this.ctx;
    const r = b.r;
    ctx.fillStyle = '#3a2a2a';
    ctx.strokeStyle = '#140808';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + b.id;
      const rr = r * (0.85 + 0.15 * Math.sin(i * 2.3 + b.id));
      ctx.lineTo(b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const hot = b.variant % 2 === 0 ? '#ff9a4a' : '#ff5a3a';
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(hot, b.x, b.y, r * 1.3, 0.45);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = hot;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + b.id * 0.7;
      const cx = b.x + Math.cos(a) * r * 0.3;
      const cy = b.y + Math.sin(a) * r * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35);
      ctx.lineTo(cx + Math.cos(a + 1.8) * r * 0.16, cy + Math.sin(a + 1.8) * r * 0.16);
      ctx.lineTo(cx + Math.cos(a - 1.8) * r * 0.16, cy + Math.sin(a - 1.8) * r * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffe0a0';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 0.16, 0, TAU);
    ctx.fill();
  }

  /** An iron brazier heaped with coals, flickering; it cracks like a reliquary as it wears. */
  private drawBrazier(b: Breakable, t: number): void {
    const ctx = this.ctx;
    const r = b.r;
    ctx.fillStyle = '#2e2a34';
    ctx.strokeStyle = '#0c0a10';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#6a6474';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 0.86, 0, TAU);
    ctx.stroke();
    const coals = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 0.8);
    coals.addColorStop(0, '#ffd36b');
    coals.addColorStop(0.5, '#ff7a2a');
    coals.addColorStop(1, '#7a1e0c');
    ctx.fillStyle = coals;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 0.78, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#ff8a3c', b.x, b.y, r * 1.8, this.view.reduceFlashing ? 0.4 : 0.35 + 0.1 * Math.sin(t * 7 + b.id));
    ctx.globalCompositeOperation = 'source-over';
    const wear = 1 - b.hp / b.maxHp;
    if (wear > 0.05) {
      const rng = mulberry32(b.id);
      ctx.strokeStyle = 'rgba(10,4,2,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < Math.ceil(wear * 5); i++) {
        const a = rng() * TAU;
        ctx.moveTo(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
        ctx.lineTo(b.x + Math.cos(a + (rng() - 0.5) * 0.4) * r * 0.55, b.y + Math.sin(a + (rng() - 0.5) * 0.4) * r * 0.55);
      }
      ctx.stroke();
    }
  }

  /** A gilded reliquary chest with a glowing gem, cracking as it takes damage. */
  private drawReliquary(b: Breakable): void {
    const ctx = this.ctx;
    const w = b.r * 1.9;
    const h = b.r * 1.3;
    const x = b.x - w / 2;
    const y = b.y - h / 2 - 2;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#7a4424');
    g.addColorStop(1, '#3a1a0c');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = '#1a0a04';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#e8c87a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    ctx.beginPath();
    ctx.moveTo(x + 3, y + h * 0.38);
    ctx.lineTo(x + w - 3, y + h * 0.38);
    ctx.moveTo(b.x, y + 3);
    ctx.lineTo(b.x, y + h - 3);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#7fe0ff', b.x, y + h * 0.38, 12, 0.7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#bff4ff';
    ctx.beginPath();
    ctx.moveTo(b.x, y + h * 0.38 - 5);
    ctx.lineTo(b.x + 4, y + h * 0.38);
    ctx.lineTo(b.x, y + h * 0.38 + 5);
    ctx.lineTo(b.x - 4, y + h * 0.38);
    ctx.closePath();
    ctx.fill();
    const wear = 1 - b.hp / b.maxHp;
    if (wear > 0.05) {
      const rng = mulberry32(b.id);
      ctx.strokeStyle = 'rgba(10,4,2,0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < Math.ceil(wear * 5); i++) {
        let cx = x + rng() * w;
        let cy = y + rng() * h;
        ctx.moveTo(cx, cy);
        for (let k = 0; k < 3; k++) {
          cx += (rng() - 0.5) * 14;
          cy += (rng() - 0.5) * 10;
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();
    }
  }

  /** Hearts and buff runes bobbing on the floor, each in its own colour. */
  private drawPickups(world: World, t: number): void {
    const ctx = this.ctx;
    const quiet = this.view.reduceFlashing;
    for (const p of world.pickups) {
      if (!this.near(p.x, p.y, 40)) continue;
      const heal = p.kind === 'heal' || p.kind === 'bigHeal';
      const color = heal ? HEAL_COLOR : BUFF_INFO[p.kind as keyof typeof BUFF_INFO].color;
      const size = p.kind === 'bigHeal' ? 26 : heal ? 18 : 22;
      const y = p.y + Math.sin(p.t * 4) * 2;
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(color, p.x, y, size * 1.3, quiet ? 0.45 : 0.4 + 0.15 * Math.sin(t * 5 + p.id));
      ctx.globalCompositeOperation = 'source-over';
      const icon = heal ? 'heal' : (p.kind as Exclude<typeof p.kind, 'heal' | 'bigHeal'>);
      ctx.strokeStyle = COLORS.outline;
      strokeIcon(ctx, icon, p.x, y, size, 4);
      ctx.fillStyle = color;
      fillIcon(ctx, icon, p.x, y, size);
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
  private drawSafeTelegraph(e: Enemy, world: World): void {
    const ctx = this.ctx;
    if (aimLines(e)) {
      this.drawAimLines(world, e, aimLines(e)!, true);
    } else if (e.kind === 'caster') {
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
    } else if (flameCone(e)) {
      const cone = flameCone(e)!;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(cone.angle);
      this.conePath(cone.reach, cone.half);
      ctx.fillStyle = 'rgba(18,12,0,0.4)';
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = this.hazardPattern();
      this.conePath(cone.reach * cone.k, cone.half);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.casedStroke(() => this.conePath(cone.reach, cone.half), 3, cone.k > 0.5 ? COLORS.warnLight : COLORS.warn);
      ctx.restore();
    } else if (attackLane(e)) {
      const lane = attackLane(e)!;
      const L = lane.length + e.r;
      const k = windup(e, lane.telegraph);
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

  /**
   * The lines a shooter will fire down (see aimLines). Icicles: thin, sharp lines that stop at
   * the first stone (a bar across where they stop, an arrowhead where they run on), brightening
   * from the shooter outward as the draw completes. Spores: a soft dotted fan, the dots swelling
   * as the puff builds. Safe warnings case every line or dot in dark under bright yellow; reduced
   * flashing drops the last-moment flicker.
   */
  private drawAimLines(world: World, e: Enemy, lines: NonNullable<ReturnType<typeof aimLines>>, safe: boolean): void {
    const ctx = this.ctx;
    const k = lines.k;
    const quiet = this.view.reduceFlashing;
    const start = e.r + 6;
    const flicker = !quiet && !safe && k > 0.75 ? 0.75 + 0.25 * Math.sin(world.time * 40) : 1;
    ctx.save();
    ctx.lineCap = 'round';
    for (const a of lines.angles) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x0 = e.x + c * start;
      const y0 = e.y + s * start;
      const full = Math.max(0, lines.length - start);
      const reach = castRay(world.map.index, x0, y0, x0 + c * full, y0 + s * full, 4);
      const lit = reach * k;
      const blocked = reach < full - 1;
      if (lines.spores) {
        for (let d = 8; d < reach; d += 22) {
          const on = d <= lit;
          const r = on ? 3.4 : 2.3;
          const x = x0 + c * d;
          const y = y0 + s * d;
          if (safe) {
            ctx.fillStyle = COLORS.warnDark;
            ctx.beginPath();
            ctx.arc(x, y, r + 2, 0, TAU);
            ctx.fill();
            ctx.fillStyle = on ? COLORS.warnLight : COLORS.warn;
          } else {
            ctx.fillStyle = on ? `rgba(255,200,180,${(0.5 + 0.4 * k) * flicker})` : `rgba(${COLORS.telegraph},${0.3 + 0.3 * k})`;
          }
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
        continue;
      }
      const ex = x0 + c * reach;
      const ey = y0 + s * reach;
      // Where it ends: a bar across the line at stone, else an arrowhead.
      const cap = () => {
        if (blocked) {
          ctx.moveTo(ex - s * 9, ey + c * 9);
          ctx.lineTo(ex + s * 9, ey - c * 9);
        } else {
          ctx.moveTo(ex - c * 14 - s * 7, ey - s * 14 + c * 7);
          ctx.lineTo(ex, ey);
          ctx.lineTo(ex - c * 14 + s * 7, ey - s * 14 - c * 7);
        }
      };
      if (safe) {
        this.casedStroke(() => {
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(ex, ey);
          cap();
        }, 2, k > 0.6 ? COLORS.warnLight : COLORS.warn);
        continue;
      }
      ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.3 + 0.4 * k})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(ex, ey);
      cap();
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,220,200,${(0.45 + 0.5 * k) * flicker})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + c * lit, y0 + s * lit);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A wedge from the origin along +x: the Salamander's flame. */
  private conePath(reach: number, half: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, Math.max(1, reach), -half, half);
    ctx.closePath();
  }

  /**
   * Colorblind-safe warnings: a yellow "!" over every foe winding up an attack, drawn above
   * bodies. A foe underground has only its striped circle (no "!" over the mound).
   */
  private drawWarningMarks(world: World): void {
    for (const e of world.enemies) {
      if (!e.dead && !e.hidden && e.state === 'windup') this.drawExclaim(e.x, e.y - e.r - 18);
    }
  }

  private drawTelegraphShapes(world: World): void {
    const ctx = this.ctx;
    for (const e of world.enemies) {
      if (e.dead || e.state !== 'windup') continue;
      if (this.view.safeWarnings && !(e.kind === 'boss' && e.bossMove === 'summon')) {
        this.drawSafeTelegraph(e, world);
      } else if (aimLines(e)) {
        this.drawAimLines(world, e, aimLines(e)!, false);
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
      } else if (flameCone(e)) {
        const cone = flameCone(e)!;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(cone.angle);
        this.conePath(cone.reach, cone.half);
        ctx.fillStyle = `rgba(${COLORS.telegraph},0.12)`;
        ctx.fill();
        this.conePath(cone.reach * cone.k, cone.half);
        ctx.fillStyle = `rgba(${COLORS.telegraph},0.3)`;
        ctx.fill();
        this.conePath(cone.reach, cone.half);
        ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.5 + 0.4 * cone.k})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (attackLane(e)) {
        const lane = attackLane(e)!;
        const cfgLen = lane.length;
        const k = windup(e, lane.telegraph);
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
        // Chevrons pointing in the charge direction; earthy, over a dotted furrow, for a burrowing charge.
        const burrow = e.kind === 'boss' && e.bossMove === 'burrow';
        if (burrow) {
          ctx.strokeStyle = `rgba(200,150,100,${0.3 + 0.4 * k})`;
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';
          ctx.setLineDash([2, 12]);
          ctx.beginPath();
          ctx.moveTo(e.r, 0);
          ctx.lineTo(cfgLen + e.r, 0);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineCap = 'butt';
        }
        ctx.strokeStyle = burrow ? `rgba(235,195,140,${0.35 + 0.5 * k})` : `rgba(255,200,180,${0.35 + 0.5 * k})`;
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
      case 'chaser':
      case 'imp': {
        const look = FOE_LOOK[e.kind];
        const imp = e.kind === 'imp';
        const spin = world.time * 3 + e.wobble;
        // An imp crouches before it leaps and stretches out mid-leap.
        const sx = imp && e.state === 'attack' ? 1.35 : imp && e.state === 'windup' ? 0.8 : 1;
        const sy = imp && e.state === 'attack' ? 0.75 : imp && e.state === 'windup' ? 1.15 : 1;
        if (imp && e.state === 'windup') {
          ctx.globalCompositeOperation = 'lighter';
          this.drawGlow('#ff7a2a', e.x, e.y, e.r * 2.6, 0.5);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.heading);
        ctx.scale(sx, sy);
        ctx.fillStyle = flash ? '#ffffff' : look.fill;
        ctx.strokeStyle = flash ? '#ffffff' : look.line;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const points = imp ? 10 : 14;
        for (let i = 0; i < points; i++) {
          const a = spin + (i / points) * TAU;
          const r = i % 2 === 0 ? e.r * (imp ? 1.35 : 1.2) : e.r * 0.82;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        this.drawEyes(e.x, e.y, e.heading, e.r * 0.45, 2.6, look.eye);
        break;
      }
      case 'caster':
      case 'pyromancer': {
        const look = FOE_LOOK[e.kind];
        ctx.fillStyle = flash ? '#ffffff' : look.fill;
        ctx.strokeStyle = flash ? '#ffffff' : look.line;
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
        this.drawEyes(e.x + Math.cos(e.heading) * 3, e.y + Math.sin(e.heading) * 3, e.heading, e.r * 0.3, 2, look.eye);
        ctx.globalCompositeOperation = 'lighter';
        if (e.kind === 'pyromancer') {
          // A fireball swelling over its raised hands while it casts.
          const k = e.state === 'windup' ? clamp(e.stateTime / 0.35, 0, 1) : 0;
          this.drawGlow('#ff7a2a', e.x, e.y - e.r - 4, 5 + k * 14, 0.35 + k * 0.6);
        } else {
          const charge = e.state === 'windup' ? clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1) : 0;
          this.drawGlow(COLORS.hostile, e.x + Math.cos(e.aim) * (e.r + 6), e.y + Math.sin(e.aim) * (e.r + 6), 6 + charge * 18, 0.4 + charge * 0.6);
        }
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'brute':
      case 'magmaBrute': {
        const look = FOE_LOOK[e.kind];
        const hot = e.state === 'windup' || e.state === 'attack';
        const shakeX = e.state === 'windup' ? Math.sin(world.time * 60) * 1.5 : 0;
        if (e.kind === 'magmaBrute') {
          ctx.globalCompositeOperation = 'lighter';
          this.drawGlow('#ff5a1a', e.x, e.y, e.r * (hot ? 2.4 : 1.8), hot ? 0.55 : 0.3);
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.save();
        ctx.translate(e.x + shakeX, e.y);
        ctx.rotate(e.heading);
        ctx.fillStyle = flash ? '#ffffff' : look.fill;
        ctx.strokeStyle = look.line;
        ctx.lineWidth = 3;
        roundRect(ctx, -e.r, -e.r, e.r * 2, e.r * 2, 8);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = hot ? '#ffcf6b' : look.crack;
        ctx.lineWidth = e.kind === 'magmaBrute' ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(-e.r * 0.6, -e.r * 0.5);
        ctx.lineTo(-e.r * 0.1, -e.r * 0.1);
        ctx.lineTo(-e.r * 0.4, e.r * 0.5);
        ctx.moveTo(e.r * 0.1, e.r * 0.7);
        ctx.lineTo(e.r * 0.3, e.r * 0.2);
        if (e.kind === 'magmaBrute') {
          ctx.moveTo(e.r * 0.45, -e.r * 0.65);
          ctx.lineTo(e.r * 0.2, -e.r * 0.3);
        }
        ctx.stroke();
        ctx.restore();
        this.drawEyes(e.x + shakeX, e.y, e.heading, e.r * 0.5, 3.2, look.eye);
        if (e.state === 'windup' && !this.view.safeWarnings) this.drawExclaim(e.x, e.y - e.r - 18);
        if (e.state === 'recover') this.drawDizzy(e.x, e.y - e.r - 6, world.time);
        break;
      }
      case 'rival':
      case 'salamander':
      case 'boss':
        this.drawEnemySnake(e, world);
        break;
      case 'sporeling':
        this.drawSporeling(e, world, flash);
        break;
      case 'puffcap':
        this.drawPuffcap(e, flash);
        break;
      case 'thornback':
        this.drawThornback(e, world, flash);
        break;
      case 'burrowViper':
        if (e.hidden) this.drawMound(e.x, e.y, e.r * 1.25, e.aim, world.time, true);
        else this.drawViper(e, world, flash);
        break;
      case 'rattler':
        if (e.pile > 0) this.drawBonePile(e, world);
        else this.drawRattler(e, world, flash);
        break;
      case 'frostArcher':
        this.drawFrostArcher(e, flash);
        break;
      case 'golem':
        this.drawGolem(e, world, flash);
        break;
      case 'wraith':
        this.drawWraith(e, world, flash);
        break;
    }
    // Health bars over the bigger foes (not swarmers, the boss, a mound or a heap of bones).
    const swarmer = e.kind === 'chaser' || e.kind === 'imp' || e.kind === 'sporeling' || e.kind === 'rattler';
    if (!swarmer && e.kind !== 'boss' && !e.hidden && e.hp < e.maxHp) {
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
    const look = SERPENT_LOOK[boss ? e.bossId : e.kind === 'salamander' ? 'salamander' : 'rival'];
    const quiet = this.view.reduceFlashing;
    const flash = e.flash > 0 && !quiet;
    const segs = e.segments;
    if (e.hidden) {
      // Burrowing: only the churned earth over its body and head shows.
      for (let i = segs.length - 1; i >= 0; i -= 2) {
        const r = e.segRadius * (1 - (i / segs.length) * 0.45);
        const ahead = i > 0 ? segs[i - 1] : e;
        this.drawMound(segs[i].x, segs[i].y, r * 0.95, Math.atan2(ahead.y - segs[i].y, ahead.x - segs[i].x), world.time, false);
      }
      this.drawMound(e.x, e.y, e.r * 1.3, e.heading, world.time, true);
      return;
    }
    if (boss && e.enraged) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(look.enrage, e.x, e.y, e.r * 3.2, quiet ? 0.35 : 0.35 + Math.sin(world.time * 8) * 0.12);
      ctx.globalCompositeOperation = 'source-over';
    }
    // A Salamander's breath: a roaring cone of flame while it attacks.
    const cone = flameCone(e);
    if (cone?.burning) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(cone.angle);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, e.r, 0, 0, cone.reach);
      g.addColorStop(0, 'rgba(255,240,180,0.85)');
      g.addColorStop(0.4, 'rgba(255,150,60,0.6)');
      g.addColorStop(1, 'rgba(255,70,30,0)');
      ctx.fillStyle = g;
      this.conePath(cone.reach, cone.half * (quiet ? 1 : 0.9 + 0.1 * Math.sin(world.time * 30)));
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
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
      ctx.fillStyle = flash ? '#ffd6de' : i % 3 === 0 ? look.seg[0] : look.seg[1];
      ctx.beginPath();
      ctx.arc(segs[i].x, segs[i].y, r, 0, TAU);
      ctx.fill();
      if (look.spot && i % 2 === 0) {
        ctx.fillStyle = look.spot;
        ctx.beginPath();
        ctx.arc(segs[i].x, segs[i].y, r * 0.35, 0, TAU);
        ctx.fill();
      }
      // Sporemaw sprouts small caps along its back; Rimecoil grows shards of ice.
      if (look.crown && i % 4 === 1 && !flash) {
        const next = segs[i - 1] ?? e;
        const a = Math.atan2(next.y - segs[i].y, next.x - segs[i].x);
        if (look.crown === 'cap') this.drawSprout(segs[i].x, segs[i].y, r * 0.42, look.hat!, look.band);
        else this.drawShard(segs[i].x, segs[i].y, r * 0.9, a + Math.PI, '#dff4ff');
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
    ctx.fillStyle = flash ? '#ffffff' : look.head;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.2, e.r, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (look.crown === 'crest') this.drawIceCrest(e.x, e.y, e.heading, e.r);
    if (look.crown === 'cap') this.drawMushroomCap(e.x, e.y, e.heading, e.r, look.hat!, look.band, world.time);
    else if (look.hat) this.drawHat(e.x, e.y, e.heading, e.r, look.hat, look.band, world.time, boss);
    this.drawEyes(e.x, e.y, e.heading, e.r * 0.55, boss ? 4.5 : 2.6, look.eye);
    if (e.state === 'windup') {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow(COLORS.hostile, e.x, e.y, e.r * 2.4, quiet ? 0.4 : 0.3 + 0.3 * Math.sin(world.time * 20));
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Sporemaw's crown: a broad spotted mushroom cap over the back of its head, its gills glowing round the rim. */
  private drawMushroomCap(x: number, y: number, heading: number, headR: number, color: string, gills: string, t: number): void {
    const ctx = this.ctx;
    const back = heading + Math.PI;
    // Toward the back of the head, like a hat's brim, so the face stays clear.
    const cx = x + Math.cos(back) * headR * 0.65;
    const cy = y + Math.sin(back) * headR * 0.65;
    const R = headR * 1.05;
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(gills, cx, cy, R * 1.7, this.view.reduceFlashing ? 0.4 : 0.32 + 0.1 * Math.sin(t * 2));
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COLORS.outline;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.92 + 2.5, R + 2.5, heading, 0, TAU);
    ctx.fill();
    ctx.fillStyle = gills;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.92, R, heading, 0, TAU);
    ctx.fill();
    const dome = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 2, cx, cy, R);
    dome.addColorStop(0, '#f2a8e0');
    dome.addColorStop(0.5, color);
    dome.addColorStop(1, '#2e0828');
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.8, R * 0.87, heading, 0, TAU);
    ctx.fill();
    // Pale spots that turn with the head.
    ctx.fillStyle = 'rgba(255,232,248,0.85)';
    for (const [d, a, s] of [
      [0.2, 0.4, 0.16],
      [0.5, 2.1, 0.12],
      [0.45, -1.6, 0.14],
      [0.6, 3.6, 0.1],
      [0.12, 4.6, 0.09],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + Math.cos(heading + a) * R * d, cy + Math.sin(heading + a) * R * d, R * s, 0, TAU);
      ctx.fill();
    }
  }

  /** Rimecoil's crest: a frill of icicle spikes fanning out from the sides and back of its head, round its hat. */
  private drawIceCrest(x: number, y: number, heading: number, headR: number): void {
    for (const i of [-4, -3, -2, 2, 3, 4]) {
      const a = heading + Math.PI + i * 0.38;
      this.drawShard(x + Math.cos(a) * headR * 0.5, y + Math.sin(a) * headR * 0.5, headR * (1.75 - 0.12 * Math.abs(i)), a, '#e8f8ff');
    }
  }

  /** An ice shard pointing along `a` from (x, y): pale and outlined, with a bright spine. */
  private drawShard(x: number, y: number, len: number, a: number, color: string): void {
    const ctx = this.ctx;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const w = len * 0.26;
    ctx.beginPath();
    ctx.moveTo(x - s * w, y + c * w);
    ctx.lineTo(x + c * len, y + s * len);
    ctx.lineTo(x + s * w, y - c * w);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,200,255,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + c * len * 0.85, y + s * len * 0.85);
    ctx.stroke();
  }

  /** A small mushroom sprouting from Sporemaw's body: a spotted cap with a glowing rim. */
  private drawSprout(x: number, y: number, r: number, color: string, glow: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.outline;
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,232,248,0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.25, r * 0.3, 0, TAU);
    ctx.fill();
  }

  /**
   * Something burrowing: a heap of churned earth with crumbs tumbling off its front and, for the
   * head, a furrow behind. Drawn instead of the body (and its status marks) while a foe is underground.
   */
  private drawMound(x: number, y: number, r: number, heading: number, t: number, furrow: boolean): void {
    const ctx = this.ctx;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    if (furrow) {
      ctx.strokeStyle = 'rgba(28,18,10,0.45)';
      ctx.lineWidth = r * 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - c * r * 2.6, y - s * r * 2.6);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + r * 0.35, r * 1.1, r * 0.65, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x, y, r * 1.1);
    g.addColorStop(0, '#a6865c');
    g.addColorStop(0.55, '#5e4328');
    g.addColorStop(1, '#2a1c10');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#140c06';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.05, r * 0.85, heading, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,12,4,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const a of [0.6, 2.4, 4.1]) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(heading + a) * r * 0.7, y + Math.sin(heading + a) * r * 0.7);
    }
    ctx.stroke();
    ctx.fillStyle = '#c0a078';
    for (let i = 0; i < 4; i++) {
      const ph = (t * 2.5 + i / 4 + Math.abs(x) * 0.001) % 1;
      const a = heading + (i - 1.5) * 0.55;
      const d = r * (0.9 + ph * 0.7);
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.12 + 1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** A Sporeling: a tiny magenta-capped mushroom that hops, lifting off its shadow and squashing as it lands. */
  private drawSporeling(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.sporeling;
    const cfg = ENEMIES.sporeling;
    const still = e.stunned > 0 || e.frozen > 0;
    const phase = ((((world.time + e.wobble) / cfg.hop) % 1) + 1) % 1;
    const air = still || phase >= cfg.burst ? 0 : Math.sin((phase / cfg.burst) * Math.PI);
    const land = !still && phase >= cfg.burst && phase < cfg.burst + 0.12 ? 1 - (phase - cfg.burst) / 0.12 : 0;
    const y = e.y - air * 7;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.r * 0.45, e.r * (1 - 0.25 * air), e.r * 0.45 * (1 - 0.25 * air), 0, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#5fffd0', e.x, y, e.r * 2.2, 0.35);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(e.x, y);
    ctx.scale(1 + 0.2 * land - 0.06 * air, 1 - 0.18 * land + 0.08 * air);
    ctx.fillStyle = flash ? '#ffffff' : look.fill;
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (!flash) {
      ctx.fillStyle = 'rgba(255,224,246,0.85)';
      for (let i = 0; i < 3; i++) {
        const a = e.wobble + i * 2.1;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * e.r * 0.45, Math.sin(a) * e.r * 0.45, e.r * 0.2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    this.drawEyes(e.x, y, e.heading, e.r * 0.6, 1.8, look.eye);
  }

  /** A Puffcap: a squat puffball that roots itself and swells as it winds up, its pores glowing, then puffs. */
  private drawPuffcap(e: Enemy, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.puffcap;
    const k = e.state === 'windup' ? windup(e, ENEMIES.puffcap.telegraph) : 0;
    const r = e.r * (1 + 0.35 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(e.x + 3, e.y + r * 0.5, r * 1.05, r * 0.42, 0, 0, TAU);
    ctx.fill();
    if (k > 0) {
      // Rooted: tendrils reaching into the floor.
      ctx.strokeStyle = 'rgba(70,30,60,0.85)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + e.wobble;
        const r0 = r * 0.9;
        const r1 = r * (0.9 + 0.5 * k);
        ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
        ctx.quadraticCurveTo(e.x + Math.cos(a + 0.25) * (r0 + r1) * 0.5, e.y + Math.sin(a + 0.25) * (r0 + r1) * 0.5, e.x + Math.cos(a + 0.1) * r1, e.y + Math.sin(a + 0.1) * r1);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#5fffd0', e.x, e.y, r * (1.5 + k), 0.15 + 0.4 * k);
    ctx.globalCompositeOperation = 'source-over';
    const body = ctx.createRadialGradient(e.x - r * 0.35, e.y - r * 0.35, 1, e.x, e.y, r);
    body.addColorStop(0, flash ? '#ffffff' : '#f6dcef');
    body.addColorStop(0.6, flash ? '#ffffff' : look.fill);
    body.addColorStop(1, flash ? '#ffffff' : '#7a3a70');
    ctx.fillStyle = body;
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Pores: dark specks that glow teal as it builds.
    ctx.fillStyle = k > 0 ? `rgba(120,255,220,${0.4 + 0.6 * k})` : 'rgba(60,16,54,0.55)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + e.wobble * 2;
      const d = r * (i % 2 === 0 ? 0.55 : 0.3);
      ctx.beginPath();
      ctx.arc(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, r * 0.09, 0, TAU);
      ctx.fill();
    }
    this.drawEyes(e.x, e.y, e.heading, r * 0.5, 2.2, look.eye);
    if (k > 0) {
      // The puff gathering at its mouth.
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow('#ff6ad8', e.x + Math.cos(e.aim) * r * 0.85, e.y + Math.sin(e.aim) * r * 0.85, 5 + 12 * k, 0.3 + 0.5 * k);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** A Thornback: a hulking beast with a ridge of thorns down its back that flush bright as it charges. */
  private drawThornback(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.thornback;
    const hot = e.state === 'windup' || e.state === 'attack';
    const shakeX = e.state === 'windup' ? Math.sin(world.time * 60) * 1.5 : 0;
    if (hot) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow('#ff5ad8', e.x, e.y, e.r * 2.2, 0.4);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.translate(e.x + shakeX, e.y);
    ctx.rotate(e.heading);
    ctx.fillStyle = flash ? '#ffffff' : look.fill;
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r * 1.1, e.r * 0.95, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (!flash) {
      // A mottled hide.
      ctx.fillStyle = 'rgba(10,16,6,0.35)';
      for (const [x, y, s] of [
        [-0.45, 0.4, 0.25],
        [0.2, -0.5, 0.2],
        [-0.1, 0.55, 0.16],
        [0.45, 0.35, 0.14],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x * e.r, y * e.r, s * e.r, 0, TAU);
        ctx.fill();
      }
    }
    // The ridge: thorns down the spine, sweeping back and out to alternate sides.
    ctx.fillStyle = hot ? '#ff9aec' : look.crack;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const x = e.r * (0.55 - i * 0.24);
      const side = i % 2 === 0 ? 1 : -1;
      const len = e.r * (i === 2 || i === 3 ? 0.68 : 0.55);
      ctx.beginPath();
      ctx.moveTo(x + 5, 0);
      ctx.lineTo(x - len * 0.75, side * len * 0.7);
      ctx.lineTo(x - 5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // Two horns at the brow.
    ctx.fillStyle = flash ? '#ffffff' : '#e8d8b8';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(e.r * 0.85, side * e.r * 0.3);
      ctx.lineTo(e.r * 1.35, side * e.r * 0.6);
      ctx.lineTo(e.r * 0.78, side * e.r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    this.drawEyes(e.x + shakeX + Math.cos(e.heading) * e.r * 0.3, e.y + Math.sin(e.heading) * e.r * 0.3, e.heading, e.r * 0.45, 3, look.eye);
    if (e.state === 'windup' && !this.view.safeWarnings) this.drawExclaim(e.x, e.y - e.r - 18);
    if (e.state === 'recover') this.drawDizzy(e.x, e.y - e.r - 6, world.time);
  }

  /** A Burrow Viper above ground: a banded body swaying behind a wedge-shaped head; a ring of earth where it just came up. */
  private drawViper(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.burrowViper;
    const c = Math.cos(e.heading);
    const s = Math.sin(e.heading);
    if (e.state === 'recover' && e.stateTime < 0.8) {
      const k = e.stateTime / 0.8;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#5e4328';
      ctx.lineWidth = 6;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1.6 + 0.8 * k), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // The body: a tapering tube swaying behind the head, tail first.
    const n = 7;
    const pts: { x: number; y: number; r: number }[] = [];
    for (let i = n; i >= 0; i--) {
      const d = i * e.r * 0.6;
      const sway = Math.sin(world.time * 7 + e.wobble - i * 0.9) * e.r * 0.5 * (i / n);
      pts.push({ x: e.x - c * d - s * sway, y: e.y - s * d + c * sway, r: e.r * (0.72 - 0.07 * i) });
    }
    ctx.lineCap = 'round';
    for (const [color, extra] of [
      [COLORS.outline, 5],
      [flash ? '#ffffff' : look.fill, 0],
    ] as const) {
      ctx.strokeStyle = color;
      for (let i = 1; i < pts.length; i++) {
        ctx.lineWidth = pts[i - 1].r + pts[i].r + extra;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    if (!flash) {
      // Dark diamonds down its back.
      ctx.fillStyle = look.crack;
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i];
        const q = pts[i + 1];
        const a = Math.atan2(q.y - p.y, q.x - p.x);
        const L = p.r * 0.75;
        const W = p.r * 0.5;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L);
        ctx.lineTo(p.x - Math.sin(a) * W, p.y + Math.cos(a) * W);
        ctx.lineTo(p.x - Math.cos(a) * L, p.y - Math.sin(a) * L);
        ctx.lineTo(p.x + Math.sin(a) * W, p.y - Math.cos(a) * W);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.heading);
    ctx.beginPath();
    ctx.moveTo(e.r * 1.2, 0);
    ctx.lineTo(e.r * 0.25, -e.r * 0.85);
    ctx.lineTo(-e.r * 0.65, -e.r * 0.6);
    ctx.lineTo(-e.r * 0.65, e.r * 0.6);
    ctx.lineTo(e.r * 0.25, e.r * 0.85);
    ctx.closePath();
    ctx.fillStyle = flash ? '#ffffff' : look.fill;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (!flash) {
      // A dark diamond on the crown.
      ctx.fillStyle = look.crack;
      ctx.beginPath();
      ctx.moveTo(e.r * 0.2, 0);
      ctx.lineTo(-e.r * 0.15, -e.r * 0.3);
      ctx.lineTo(-e.r * 0.5, 0);
      ctx.lineTo(-e.r * 0.15, e.r * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    this.drawEyes(e.x, e.y, e.heading, e.r * 0.6, 2.2, look.eye);
  }

  /** One bone: a dark-cased shaft with knobbed ends. */
  private drawBone(x: number, y: number, len: number, a: number, color: string, line: string): void {
    const ctx = this.ctx;
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const px = -Math.sin(a) * 2;
    const py = Math.cos(a) * 2;
    for (const [c, w, k] of [
      [line, 5, 3.4],
      [color, 2.8, 2.2],
    ] as const) {
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
      ctx.beginPath();
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) {
          const kx = x + dx * end + px * side;
          const ky = y + dy * end + py * side;
          ctx.moveTo(kx + k, ky);
          ctx.arc(kx, ky, k, 0, TAU);
        }
      }
      ctx.fill();
    }
  }

  /** A skull seen from above: the dome, a short muzzle toward `heading`, dark sockets with a cold glint. */
  private drawSkull(x: number, y: number, r: number, heading: number, bone: string, line: string, eye: string, glint: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.fillStyle = bone;
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    roundRect(ctx, r * 0.2, -r * 0.48, r * 0.85, r * 0.96, r * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r, r * 0.9, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0a0e18';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(r * 0.45, side * r * 0.38, r * 0.25, 0, TAU);
      ctx.fill();
    }
    if (glint > 0) {
      ctx.globalAlpha = glint;
      ctx.fillStyle = eye;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(r * 0.5, side * r * 0.38, r * 0.11 + 0.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** A collapsed Bone Rattler: a heap of bones under its skull, twitching harder as it gets ready to rise. */
  private drawBonePile(e: Enemy, world: World): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.rattler;
    const stir = clamp(1 - e.pile / 1.2, 0, 1);
    const rng = mulberry32(e.id * 977 + 13);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(e.x + 2, e.y + e.r * 0.3, e.r * 1.25, e.r * 0.7, 0, 0, TAU);
    ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = rng() * TAU;
      const d = rng() * e.r * 0.75;
      const b = rng() * TAU;
      const len = e.r * (0.8 + rng() * 0.6);
      const jx = stir * Math.sin(world.time * 31 + i * 1.7) * 1.8;
      const jb = stir * Math.sin(world.time * 23 + i) * 0.25;
      this.drawBone(e.x + Math.cos(a) * d + jx, e.y + Math.sin(a) * d, len, b + jb, look.fill, look.line);
    }
    ctx.lineCap = 'butt';
    // The skull on top, lifting a little and its eyes kindling as it stirs.
    const sx = e.x + Math.cos(e.heading) * e.r * 0.15 + stir * Math.sin(world.time * 27) * 1.2;
    const sy = e.y + Math.sin(e.heading) * e.r * 0.15 - stir * 3;
    this.drawSkull(sx, sy, e.r * 0.45, e.heading + 0.6, look.fill, look.line, look.eye, stir);
  }

  /** A Bone Rattler: a skull leading a rattling spine and ribs, bony arms reaching forward. */
  private drawRattler(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.rattler;
    const bone = flash ? '#ffffff' : look.fill;
    const still = e.stunned > 0 || e.frozen > 0;
    const t = world.time + e.wobble;
    const rattle = still ? 0 : Math.sin(t * 38) * 0.07;
    const r = e.r;
    const swing = still ? 0 : Math.sin(t * 6) * r * 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(e.x + 3, e.y + r * 0.5, r * 0.95, r * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.heading + rattle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const bones = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-r * 1.15, 0);
      for (const x of [-0.3, -0.55, -0.8]) {
        const w = r * (0.62 + x * 0.3);
        ctx.moveTo((x - 0.12) * r, -w);
        ctx.quadraticCurveTo((x + 0.16) * r, 0, (x - 0.12) * r, w);
      }
      for (const side of [-1, 1]) {
        ctx.moveTo(-r * 0.2, side * r * 0.6);
        ctx.lineTo(r * 0.2, side * r * 0.88);
        ctx.lineTo(r * 0.75 + side * swing, side * r * 0.62);
      }
    };
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 5;
    bones();
    ctx.stroke();
    ctx.strokeStyle = bone;
    ctx.lineWidth = 2.6;
    bones();
    ctx.stroke();
    ctx.fillStyle = bone;
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(-r * 1.15, 0, r * 0.22, r * 0.38, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();
    this.drawSkull(e.x + Math.cos(e.heading) * r * 0.25, e.y + Math.sin(e.heading) * r * 0.25, r * 0.5, e.heading + rattle, bone, look.line, look.eye, 1);
  }

  /** A Frost Archer: a hooded skeleton drawing a bow of ice, an icicle nocked and glowing as it aims. */
  private drawFrostArcher(e: Enemy, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.frostArcher;
    const k = e.state === 'windup' ? windup(e, ENEMIES.frostArcher.telegraph) : 0;
    const aim = e.state === 'windup' ? e.aim : e.heading;
    // Robe and hood, as a caster's, the hood rimed with frost.
    ctx.fillStyle = flash ? '#ffffff' : look.fill;
    ctx.strokeStyle = flash ? '#ffffff' : look.line;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(e.heading + 1.9) * e.r, e.y + Math.sin(e.heading + 1.9) * e.r);
    ctx.lineTo(e.x - Math.cos(e.heading) * e.r * 1.6, e.y - Math.sin(e.heading) * e.r * 1.6);
    ctx.lineTo(e.x + Math.cos(e.heading - 1.9) * e.r, e.y + Math.sin(e.heading - 1.9) * e.r);
    ctx.fill();
    ctx.stroke();
    // A skull in the hood's shadow.
    const fx = e.x + Math.cos(e.heading) * 3;
    const fy = e.y + Math.sin(e.heading) * 3;
    ctx.fillStyle = '#060a14';
    ctx.beginPath();
    ctx.arc(fx, fy, e.r * 0.62, 0, TAU);
    ctx.fill();
    this.drawSkull(fx, fy, e.r * 0.36, e.heading, flash ? '#ffffff' : '#d8e0ea', '#060a14', look.eye, 1);
    // The bow of ice across the aim, its string drawn back as it winds up, an icicle nocked.
    ctx.save();
    ctx.translate(e.x + Math.cos(aim) * (e.r + 3), e.y + Math.sin(aim) * (e.r + 3));
    ctx.rotate(aim);
    const R = e.r * 1.05;
    const span = 1.05;
    const tipX = -R * 0.45 + Math.cos(span) * R;
    const tipY = Math.sin(span) * R;
    for (const [color, width] of [
      ['#0a1a30', 5],
      ['#bfe6ff', 2.5],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(-R * 0.45, 0, R, -span, span);
      ctx.stroke();
    }
    const nock = tipX - k * e.r * 0.9;
    ctx.strokeStyle = 'rgba(230,245,255,0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tipX, -tipY);
    ctx.lineTo(nock, 0);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    if (k > 0) {
      ctx.globalCompositeOperation = 'lighter';
      this.drawGlow('#9fe8ff', nock + e.r * 1.4, 0, 6 + 10 * k, 0.3 + 0.6 * k);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#e8f8ff';
      ctx.strokeStyle = '#0a1a30';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nock + e.r * 1.5, 0);
      ctx.lineTo(nock + 3, -2.5);
      ctx.lineTo(nock, 0);
      ctx.lineTo(nock + 3, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A Crypt Golem: a hulk of frozen stone with rime on its shoulders; it raises its fists to slam. */
  private drawGolem(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.golem;
    const k = e.state === 'windup' ? windup(e, ENEMIES.golem.telegraph) : 0;
    const shakeX = k > 0.7 ? Math.sin(world.time * 60) * 1.2 : 0;
    const c = Math.cos(e.heading);
    const s = Math.sin(e.heading);
    const lift = k * 16;
    const fistR = e.r * 0.42 * (1 + 0.35 * k);
    const fists = [-1, 1].map((side) => ({ x: e.x + shakeX - s * side * e.r * 1.05 + c * e.r * 0.3, y: e.y + c * side * e.r * 1.05 + s * e.r * 0.3 }));
    // The fists' shadows stay on the ground while they rise.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (const f of fists) {
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 4, e.r * 0.42, e.r * 0.28, 0, 0, TAU);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(e.x + shakeX, e.y);
    ctx.rotate(e.heading);
    const body = ctx.createLinearGradient(-e.r, -e.r, e.r, e.r);
    body.addColorStop(0, flash ? '#ffffff' : '#c0d0e2');
    body.addColorStop(0.5, flash ? '#ffffff' : look.fill);
    body.addColorStop(1, flash ? '#ffffff' : '#2e3a50');
    ctx.fillStyle = body;
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const rr = e.r * (i % 2 === 0 ? 1.08 : 1);
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.92);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Frost-blue seams, brightening through the wind-up.
    ctx.strokeStyle = k > 0 ? '#e8f8ff' : look.crack;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.6, -e.r * 0.3);
    ctx.lineTo(-e.r * 0.15, 0);
    ctx.lineTo(-e.r * 0.5, e.r * 0.45);
    ctx.moveTo(e.r * 0.1, -e.r * 0.65);
    ctx.lineTo(e.r * 0.3, -e.r * 0.2);
    ctx.stroke();
    // A dark recess for the face, where its eyes burn.
    ctx.fillStyle = 'rgba(12,18,32,0.85)';
    ctx.beginPath();
    ctx.ellipse(e.r * 0.5, 0, e.r * 0.3, e.r * 0.52, 0, 0, TAU);
    ctx.fill();
    // Rime crystals on the shoulders.
    ctx.fillStyle = '#e8f8ff';
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-e.r * 0.1, side * e.r * 0.5);
      ctx.lineTo(-e.r * 0.3, side * e.r * 0.92);
      ctx.lineTo(-e.r * 0.48, side * e.r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // The fists: raised ones drawn larger and higher, nearer the eye.
    for (const f of fists) {
      const fy = f.y - lift;
      const g = ctx.createRadialGradient(f.x - fistR * 0.3, fy - fistR * 0.3, 1, f.x, fy, fistR);
      g.addColorStop(0, flash ? '#ffffff' : '#b4c4d8');
      g.addColorStop(1, flash ? '#ffffff' : '#3a4a62');
      ctx.fillStyle = g;
      ctx.strokeStyle = look.line;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(f.x, fy, fistR, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(16,24,38,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const d of [-0.4, 0, 0.4]) {
        const kx = f.x + c * fistR * 0.45 - s * d * fistR;
        const ky = fy + s * fistR * 0.45 + c * d * fistR;
        ctx.moveTo(kx - c * fistR * 0.25, ky - s * fistR * 0.25);
        ctx.lineTo(kx + c * fistR * 0.3, ky + s * fistR * 0.3);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(look.eye, e.x + shakeX + c * e.r * 0.45, e.y + s * e.r * 0.45, e.r * 0.9, 0.3 + 0.4 * k);
    ctx.globalCompositeOperation = 'source-over';
    this.drawEyes(e.x + shakeX, e.y, e.heading, e.r * 0.55, 3, look.eye);
    if (e.state === 'windup' && !this.view.safeWarnings) this.drawExclaim(e.x, e.y - e.r - 18 - lift);
  }

  /** A Wraith: a translucent hooded spectre trailing tatters. Inside stone it fades to a dashed ghost, so it still reads. */
  private drawWraith(e: Enemy, world: World, flash: boolean): void {
    const ctx = this.ctx;
    const look = FOE_LOOK.wraith;
    const inStone = clearanceAt(world.map.index, e.x, e.y) < 0;
    const alpha = inStone ? 0.35 : 0.78;
    const t = world.time + e.wobble;
    const k = e.state === 'windup' ? windup(e, ENEMIES.wraith.telegraph) : 0;
    const r = e.r;
    const len = r * (e.state === 'attack' ? 3.1 : 2.4 + 0.3 * k);
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow('#9fd8ff', e.x, e.y, r * 2.4, inStone ? 0.12 : 0.28);
    ctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.heading);
    // The robe: from the shoulders back to a ragged, rippling hem.
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.7);
    ctx.quadraticCurveTo(0, -r * 1.25, -len * 0.35, -r * 1.1);
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const v = -1 + (i / n) * 2;
      const deep = i % 2 === 0 ? 1 : 0.7;
      const ripple = Math.sin(t * 6 + i * 1.3) * r * 0.25;
      ctx.lineTo(-len * deep + ripple, v * r * (0.95 + 0.2 * deep));
    }
    ctx.lineTo(-len * 0.35, r * 1.1);
    ctx.quadraticCurveTo(0, r * 1.25, r * 0.5, r * 0.7);
    ctx.closePath();
    const robe = ctx.createLinearGradient(r, 0, -len, 0);
    robe.addColorStop(0, flash ? `rgba(255,255,255,${alpha})` : `rgba(190,215,250,${alpha})`);
    robe.addColorStop(1, `rgba(150,190,240,${alpha * 0.15})`);
    ctx.fillStyle = robe;
    ctx.fill();
    ctx.strokeStyle = `rgba(240,250,255,${inStone ? 0.75 : 0.5})`;
    ctx.lineWidth = 1.5;
    if (inStone) ctx.setLineDash([5, 4]);
    ctx.stroke();
    // The hood, peaked at the back, its opening a dark hollow at the front.
    ctx.fillStyle = flash ? `rgba(255,255,255,${alpha})` : `rgba(215,232,255,${Math.min(1, alpha + 0.1)})`;
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, 0);
    ctx.quadraticCurveTo(-r * 0.3, -r * 0.85, r * 0.45, -r * 0.62);
    ctx.quadraticCurveTo(r * 0.95, 0, r * 0.45, r * 0.62);
    ctx.quadraticCurveTo(-r * 0.3, r * 0.85, -r * 0.75, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(8,12,30,${inStone ? 0.5 : 0.85})`;
    ctx.beginPath();
    ctx.ellipse(r * 0.42, 0, r * 0.26, r * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    const ex = e.x + Math.cos(e.heading) * r * 0.1;
    const ey = e.y + Math.sin(e.heading) * r * 0.1;
    ctx.globalCompositeOperation = 'lighter';
    this.drawGlow(look.eye, ex + Math.cos(e.heading) * r * 0.3, ey + Math.sin(e.heading) * r * 0.3, r * (0.8 + 0.6 * k), 0.4 + 0.4 * k);
    ctx.globalCompositeOperation = 'source-over';
    this.drawEyes(ex, ey, e.heading, r * 0.42, 1.9, look.eye);
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
    // Underground, only the mound shows.
    if (e.hidden) return;
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

  /**
   * Hostile projectiles: a dark outline and a bright core so they read against every friendly
   * effect. Orbs of hostile magic; soft drifting spore puffs; thin icicles pointing where they fly.
   */
  private drawShots(world: World): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of world.shots) {
      if (!this.near(p.x, p.y, 40)) continue;
      if (p.look === 'spore') this.drawGlow('#ff6ad8', p.x, p.y, p.r * 2.6, 0.45);
      else if (p.look === 'icicle') this.drawGlow('#9fe8ff', p.x, p.y, p.r * 3, 0.45);
      else this.drawGlow(COLORS.hostile, p.x, p.y, p.r * 3, 0.6);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of world.shots) {
      if (!this.near(p.x, p.y, 40)) continue;
      if (p.look === 'spore') {
        this.drawSporeShot(p);
        continue;
      }
      if (p.look === 'icicle') {
        this.drawIcicleShot(p);
        continue;
      }
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

  /** A drifting spore puff: soft magenta lobes round a teal core, slowly turning and breathing. */
  private drawSporeShot(p: EnemyShot): void {
    const ctx = this.ctx;
    const r = p.r * (1 + Math.sin(p.spin * 1.3) * 0.08);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin * 0.4);
    for (const [color, grow] of [
      [COLORS.hostileDark, 2.5],
      ['#c84aa8', 0],
    ] as const) {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        const x = Math.cos(a) * r * 0.45;
        const y = Math.sin(a) * r * 0.45;
        ctx.moveTo(x + r * 0.6 + grow, y);
        ctx.arc(x, y, r * 0.6 + grow, 0, TAU);
      }
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,205,240,0.7)';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.55 - r * 0.12, Math.sin(a) * r * 0.55 - r * 0.12, r * 0.18, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#b8fff0';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** An icicle in flight: a thin pointed shard along its path, dark-edged, with a pale streak behind. */
  private drawIcicleShot(p: EnemyShot): void {
    const ctx = this.ctx;
    const L = p.r * 3.4;
    const W = p.r * 0.95;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    const streak = ctx.createLinearGradient(-L * 2.6, 0, -L * 0.5, 0);
    streak.addColorStop(0, 'rgba(200,235,255,0)');
    streak.addColorStop(1, 'rgba(200,235,255,0.55)');
    ctx.strokeStyle = streak;
    ctx.lineWidth = W;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-L * 2.6, 0);
    ctx.lineTo(-L * 0.5, 0);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(L, 0);
    ctx.lineTo(-L * 0.45, -W);
    ctx.lineTo(-L * 0.75, 0);
    ctx.lineTo(-L * 0.45, W);
    ctx.closePath();
    ctx.strokeStyle = COLORS.hostileDark;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#cfeeff';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-L * 0.4, -W * 0.15);
    ctx.lineTo(L * 0.8, 0);
    ctx.stroke();
    ctx.restore();
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
