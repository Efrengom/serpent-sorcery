import type { Camera } from './camera';
import { CAMERA, PIXEL_ART, TOUCH, VIEW } from './config';
import { SITE_INFO } from './sites';
import { fadeLevel } from './telegraph';
import { shakeOffset } from './effects';
import type { Pt } from './gesture';
import type { TouchView } from './input';
import type { MapLayout } from './maps/types';
import { clamp, type Vec } from './math';
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
  drawUltimatePixel,
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
  drawBlastMarks,
  drawBlastsInFlight,
  drawDescent,
  drawFinale,
  drawSites,
  drawGroundFx,
  drawHazards,
  setDrawBounds,
} from './pixel/draw';
import { PixelFloor } from './pixel/floor';
import { SPELL_COLORS, spellName } from './spells';
import type { GestureView, World } from './world';

const PIXEL_FONT = "'Silkscreen', 'Courier New', monospace";
const P = PIXEL_ART.worldPerPixel;
const VIGNETTE_LEVELS = 6;

/** Something off-screen worth pointing at: the boss, or the clearing it's coming to. */
interface Pointer {
  x: number;
  y: number;
  label: string;
  color: string;
}

/**
 * Draws the game in pixel art. The view is drawn on a small canvas (1 pixel =
 * PIXEL_ART.worldPerPixel units, offset by the camera in whole pixels) entirely from baked
 * sprites and per-pixel effects, then upscaled with nearest-neighbour sampling. A second
 * screen-sized overlay on the same pixel grid carries the sigil trail and hurt flash. Only text
 * is drawn at full resolution, in a pixel font.
 */
export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
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
  /** The map and area (look) the floor was built for. */
  private map: MapLayout | null = null;
  private area = 0;
  private minimap: Minimap | null = null;
  /** Touch input to show: the steering stick, and the zones' labels early in a run. */
  touch: TouchView | null = null;
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
  /**
   * For the inspector: CSS pixels per art pixel, fixed (its zoom), with the whole canvas used
   * and no room kept for the HUD. Null (every run) fits the view to the window.
   */
  pixelScale: number | null = null;
  /** For the inspector: a plain colour in place of the map's floor. */
  backdrop: string | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.resize();
  }

  /**
   * Fits the low-res view with a whole-number upscale so every art pixel is the same size. The
   * view is 320 art pixels tall (or a little more, filling the window) and as wide as the window
   * allows, within the camera's limits. Very small windows fall back to fractional scaling.
   */
  resize(): void {
    // Both weights, and the bold W that is a face of its own (see styles.css), ready for the canvas.
    for (const font of [`16px ${PIXEL_FONT}`, `700 16px ${PIXEL_FONT}`]) void document.fonts?.load(font, 'AW').catch(() => undefined);
    this.cssW = Math.max(320, this.canvas.clientWidth || window.innerWidth);
    this.cssH = Math.max(240, this.canvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.minimap = null;
    const dpr = this.dpr;
    const fixed = this.pixelScale !== null;
    const side = fixed ? 0 : VIEW.sideInset;
    const bottom = fixed ? 0 : VIEW.bottomInset;
    const top = fixed ? 0 : this.topInset;
    const size = this.fitSize();
    const availW = (this.cssW - side * 2) * dpr;
    const availH = (this.cssH - top) * dpr;
    const fit = Math.min(availW / (size.w / P), availH / (size.h / P));
    const whole = Math.floor(fit);
    const f = fixed ? Math.max(1, Math.round(this.pixelScale! * dpr)) : whole >= PIXEL_ART.minIntegerScale ? whole : Math.max(0.5, fit);
    this.pixelFactor = f;
    this.lowW = fixed ? Math.ceil(availW / f) : Math.min(Math.floor(availW / f), Math.round(CAMERA.maxViewWidth / P));
    this.lowH = fixed ? Math.ceil(availH / f) : Math.min(Math.floor(availH / f), Math.round(CAMERA.maxViewHeight / P));
    if (!this.low || this.low.width !== this.lowW || this.low.height !== this.lowH) {
      this.low = createCanvas(this.lowW, this.lowH);
      this.lowCtx = this.low.getContext('2d')!;
    }
    this.viewW = this.lowW * P;
    this.viewH = this.lowH * P;
    const devW = this.lowW * f;
    const devH = this.lowH * f;
    this.devX = Math.round((this.cssW * dpr - devW) / 2);
    this.devY = Math.round(top * dpr + Math.max(0, (availH - bottom * dpr - devH) / 2));
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

  /** A phone-sized window: narrower than VIEW.narrowBelow or no taller than VIEW.shortAtMost (the HUD's CSS uses the same sizes). */
  get compact(): boolean {
    return this.cssW < VIEW.narrowBelow || this.cssH <= VIEW.shortAtMost;
  }

  /** CSS pixels the HUD bar takes at the top of the window. */
  private get topInset(): number {
    return this.cssW < VIEW.narrowBelow ? VIEW.topInsetNarrow : this.cssH <= VIEW.shortAtMost ? VIEW.topInsetShort : VIEW.topInset;
  }

  /** The world size the view is fitted to: the usual height and least width, or a closer one on a phone. */
  private fitSize(): { w: number; h: number } {
    return this.compact ? { w: CAMERA.compactMinViewWidth, h: CAMERA.compactViewHeight } : { w: CAMERA.minViewWidth, h: CAMERA.viewHeight };
  }

  /** (Re)builds the floor when the run's map or its look (the area) changes. */
  private useMap(map: MapLayout, area: number): void {
    if (map === this.map && area === this.area) return;
    this.map = map;
    this.area = area;
    this.pixelFloor = null;
    this.minimap = null;
  }

  /** Puts the view's top-left corner where the camera says, snapped to whole art pixels so the floor scrolls without shimmering. */
  follow(cam: Camera): void {
    this.camLeft = Math.round((cam.x - this.viewW / 2) / P) * P;
    this.camTop = Math.round((cam.y - this.viewH / 2) / P) * P;
  }

  private font(size: number, weight: number): string {
    return `${weight >= 700 ? 700 : 400} ${Math.max(16, Math.round(size / 8) * 8)}px ${PIXEL_FONT}`;
  }

  screenToWorld(p: Pt): Vec {
    return { x: (p.x - this.ox) / this.scale + this.camLeft, y: (p.y - this.oy) / this.scale + this.camTop };
  }

  worldToScreen(p: Vec): Vec {
    return { x: (p.x - this.camLeft) * this.scale + this.ox, y: (p.y - this.camTop) * this.scale + this.oy };
  }

  // ------------------------------------------------------------ frame

  render(world: World, gesture: GestureView, realTime: number, showSnake: boolean): void {
    this.useMap(world.map, world.area);
    this.follow(world.camera);
    const low = this.lowCtx!;
    const main = this.ctx;
    this.pixelFloor ??= new PixelFloor(world.map, world.area);
    setDrawBounds(world.map.bounds, this.camLeft / P, this.camTop / P, this.lowW, this.lowH);
    const cx = Math.round(this.camLeft / P);
    const cy = Math.round(this.camTop / P);
    low.setTransform(1, 0, 0, 1, -cx, -cy);
    low.globalAlpha = 1;
    low.globalCompositeOperation = 'source-over';
    low.imageSmoothingEnabled = false;
    low.fillStyle = this.backdrop ?? '#0a0614';
    low.fillRect(cx, cy, this.lowW, this.lowH);
    if (!this.backdrop) this.pixelFloor.draw(low, cx, cy, cx + this.lowW, cy + this.lowH);
    const quiet = this.view.reduceFlashing;
    drawHazards(low, world, realTime, quiet);
    if (!this.backdrop) drawTorches(low, this.pixelFloor.torches, realTime, world.area);
    if (world.bossClearing >= 0) drawClearingMark(low, world.map.clearings[world.bossClearing], realTime, this.view.reduceFlashing);
    drawGroundFx(low, world, realTime);
    drawDescent(low, world, realTime, quiet);
    drawFinale(low, world, realTime, quiet);
    drawSites(low, world, realTime, quiet);
    drawFrostFields(low, world, realTime);
    drawPortals(low, world, realTime);
    drawCrystals(low, world);
    drawBreakables(low, world, quiet);
    drawPickups(low, world, realTime, quiet);
    drawTelegraphs(low, world, this.view.safeWarnings, quiet);
    drawBlastMarks(low, world, realTime, this.view.safeWarnings, quiet);
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
    drawUltimatePixel(low, world, realTime, quiet);
    drawShots(low, world);
    drawBlastsInFlight(low, world);
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
    if (!this.backdrop) this.pixelFloor.prefetch(cx, cy, cx + this.lowW, cy + this.lowH, 3);

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
    this.drawTouch(world);
  }

  /** True when (x, y) is within `margin` world units of the view. */
  private near(x: number, y: number, margin: number): boolean {
    return x > this.camLeft - margin && x < this.camLeft + this.viewW + margin && y > this.camTop - margin && y < this.camTop + this.viewH + margin;
  }

  // ------------------------------------------------------------ pointers, minimap

  /** What deserves an arrow when it's off-screen: the way down, the boss (or its portal), else the clearing it's coming to. */
  private pointers(world: World): Pointer[] {
    if (world.descent) return [{ x: world.descent.x, y: world.descent.y, label: 'Way down', color: COLORS.nova }];
    if (world.finale?.stage === 'rising') return [{ x: world.finale.x, y: world.finale.y, label: 'Rising', color: '#ffd45e' }];
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
    const inset = 34 / this.scale;
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

  private drawMinimap(world: World): void {
    if (!this.view.minimap) return;
    this.minimap ??= new Minimap(world.map, world.area, this.compact ? 120 : undefined);
    const m = this.minimap;
    const x = Math.round(this.ox + this.viewW * this.scale - m.w - 10);
    const y = Math.round(this.oy + this.viewH * this.scale - m.h - 10);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    m.draw(this.ctx, world, x, y, { x0: this.camLeft, y0: this.camTop, x1: this.camLeft + this.viewW, y1: this.camTop + this.viewH });
  }

  // ------------------------------------------------------------ screen overlays

  /**
   * The steering stick under the thumb (a square where it landed, a knob where it is), and early
   * in a run on a touch screen, a label on each side saying which thumb does what.
   */
  private drawTouch(world: World): void {
    const t = this.touch;
    if (!t?.seen) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (world.time < TOUCH.hintTime) {
      const a = Math.min(1, (TOUCH.hintTime - world.time) / 2) * 0.55;
      const steerX = t.side === 'left' ? this.cssW * TOUCH.zone * 0.5 : this.cssW * (1 - TOUCH.zone * 0.5);
      const drawX = t.side === 'left' ? this.cssW * (0.5 + TOUCH.zone / 2) : this.cssW * (0.5 - TOUCH.zone / 2);
      const y = this.cssH - 96;
      ctx.globalAlpha = a;
      ctx.font = this.font(17, 800);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f4ecff';
      ctx.strokeStyle = 'rgba(10,6,20,0.8)';
      ctx.lineWidth = 4;
      for (const [x, text] of [
        [steerX, 'Hold here to steer'],
        [drawX, 'Draw sigils here'],
      ] as const) {
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
      ctx.globalAlpha = 1;
    }
    const s = t.stick;
    if (s) {
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const d = Math.hypot(dx, dy);
      const k = d > TOUCH.radius ? TOUCH.radius / d : 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(244,236,255,0.45)';
      ctx.fillStyle = 'rgba(20,12,40,0.25)';
      ctx.beginPath();
      ctx.rect(s.ox - TOUCH.radius, s.oy - TOUCH.radius, TOUCH.radius * 2, TOUCH.radius * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = d >= TOUCH.deadzone ? 'rgba(255,212,94,0.75)' : 'rgba(244,236,255,0.55)';
      ctx.beginPath();
      ctx.rect(s.ox + dx * k - 18, s.oy + dy * k - 18, 36, 36);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPixelOverlay(world: World, gesture: GestureView, t: number): void {
    const ui = this.uiCtx!;
    const main = this.ctx;
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

  /** World text (sites' names, damage numbers) drawn in screen space so the pixel font stays on whole sizes. */
  private drawWorldFloaters(world: World): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Each site's name under it while it can still be used (once it is well inside the view).
    for (const s of world.sites) {
      if (s.spent || !this.near(s.x, s.y, -80)) continue;
      const p = this.worldToScreen({ x: s.x, y: s.y + 66 });
      this.drawFloater(SITE_INFO[s.kind].name, p.x, p.y, 14, SITE_INFO[s.kind].color, 0.45);
    }
    for (const f of world.floaters) {
      if (f.screen) continue;
      const p = this.worldToScreen(f);
      this.drawFloater(f.text, p.x, p.y, f.size, f.color, f.life / f.max);
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

  /** Strength of the red edge: a flash when hurt and a pulse at low health, both steady with reduced flashing. */
  private dangerTint(world: World, t: number): number {
    const lowHp = world.hp / world.stats.maxHp < 0.3 && world.hp > 0;
    if (this.view.reduceFlashing) return Math.max(world.hurtFlash * 0.22, lowHp ? 0.22 : 0);
    return Math.max(world.hurtFlash * 0.5, lowHp ? 0.25 + Math.sin(t * 5) * 0.1 : 0);
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
    ctx.font = this.font(size, 700);
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

/** The live trail colour: the spell the stroke reads as (greyed if not learned), or the plain trail. */
function readingColor(g: GestureView): string {
  const r = g.reading;
  if (!r) return COLORS.sigilTrail;
  return r.known ? SPELL_COLORS[r.spell] : '#9a90b8';
}
