import { ARCHETYPE, DESCENT, ENEMIES, PIXEL_ART, SNAKE, type BossId } from '../config';
import { hash2 } from '../hash';
import { aimLines, attackLane, blastInFlight, blastProgress, flameCone, windup } from '../telegraph';
import { castRay, clearanceAt, solidBounds } from '../terrain';
import type { BreakableLook, Hazard, Rect } from '../maps/types';
import { angleDiff, clamp, mulberry32, TAU, type Vec } from '../math';
import type { ViewOptions } from '../options';
import type { PlayArea } from '../snake';
import { stormAngle, ULTIMATES } from '../ultimates';
import { WIZARDS } from '../wizards';
import { FINALE } from '../finale';
import { SITE_INFO, SITES } from '../sites';
import type { Blast, BuffId, Enemy, GestureView, GroundFx, PickupKind, World } from '../world';
import { BUFF_INFO, HEAL_COLOR } from '../breakables';
import { fillIcon } from '../icons';
import { bayer, blit, createCanvas, gridSprite, type Sprite } from './bake';
import { PX } from './palette';
import {
  boltHead,
  bonePile,
  brute,
  caster,
  CHASER_FRAMES,
  chaser,
  crystal,
  directionIndex,
  exclaim,
  flame,
  FLAME_FRAMES,
  frostArcher,
  golem,
  golemFist,
  icicleShot,
  mound,
  MOUND_FRAMES,
  PUFF_SWELL,
  puffcap,
  RATTLER_FRAMES,
  rattler,
  RETICLE_FRAMES,
  reticle,
  segmentFill,
  segmentOutline,
  SHOT_FRAMES,
  shot,
  skull,
  SPORE_FRAMES,
  sporeShot,
  sporeling,
  thornback,
  VIPER_FRAMES,
  viper,
  WRAITH_FRAMES,
  wizardHead,
  wraith,
  type FlameTint,
  type HeadKind,
  type SegmentStyle,
} from './sprites';

// Everything here draws on a low-res canvas in map art pixels (1 unit = 1 art pixel); the renderer
// offsets the canvas by the camera in whole pixels.
const P = PIXEL_ART.worldPerPixel;
/** The map's play area in art pixels (effects are clipped to it), and the view, for skipping off-screen things. */
let MIN_X = 0;
let MIN_Y = 0;
let MAX_X = 0;
let MAX_Y = 0;
const VIEW_RECT = { x0: 0, y0: 0, x1: 0, y1: 0 };

/** Sets the play area (world units) and the visible area (art pixels) for this frame. */
export function setDrawBounds(bounds: PlayArea, viewX: number, viewY: number, viewW: number, viewH: number): void {
  MIN_X = Math.ceil(bounds.minX / P);
  MIN_Y = Math.ceil(bounds.minY / P);
  MAX_X = Math.floor(bounds.maxX / P);
  MAX_Y = Math.floor(bounds.maxY / P);
  VIEW_RECT.x0 = viewX;
  VIEW_RECT.y0 = viewY;
  VIEW_RECT.x1 = viewX + viewW;
  VIEW_RECT.y1 = viewY + viewH;
}

/** True when art pixel (x, y) is within `margin` pixels of the view. */
const visible = (x: number, y: number, margin: number) =>
  x > VIEW_RECT.x0 - margin && x < VIEW_RECT.x1 + margin && y > VIEW_RECT.y0 - margin && y < VIEW_RECT.y1 + margin;

function px(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Fills many pixels of one colour with a single fillStyle change. */
function pixels(ctx: CanvasRenderingContext2D, list: number[], color: string): void {
  if (list.length === 0) return;
  ctx.fillStyle = color;
  for (let i = 0; i < list.length; i += 2) ctx.fillRect(list[i], list[i + 1], 1, 1);
}

/** Cheap deterministic hash in [0, 1). */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Bresenham line; `keep(i)` can skip pixels (dashes, dithering). Returns visited pixels. */
function linePixels(x0: number, y0: number, x1: number, y1: number, keep?: (i: number, x: number, y: number) => boolean): number[] {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const out: number[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; ; i++) {
    if (!keep || keep(i, x0, y0)) out.push(x0, y0);
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
    if (i > 4000) break;
  }
  return out;
}

/** Midpoint circle outline; `keep` can filter by position (dashes, dithering). */
function circlePixels(cx: number, cy: number, r: number, keep?: (x: number, y: number) => boolean): number[] {
  cx = Math.round(cx);
  cy = Math.round(cy);
  r = Math.max(0, Math.round(r));
  const out: number[] = [];
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    const pts = [x, y, y, x, -y, x, -x, y, -x, -y, -y, -x, y, -x, x, -y];
    for (let i = 0; i < pts.length; i += 2) {
      const X = cx + pts[i];
      const Y = cy + pts[i + 1];
      if (!keep || keep(X, Y)) out.push(X, Y);
    }
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  return out;
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  cx = Math.round(cx);
  cy = Math.round(cy);
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy) + 0.25));
    ctx.fillRect(cx - half, cy + dy, 2 * half + 1, 1);
  }
}

const inArena = (x: number, y: number) => x >= MIN_X && x <= MAX_X && y >= MIN_Y && y <= MAX_Y;

/**
 * Ordered-dither fill as a repeating 4x4 pattern: large translucent areas (charge lanes, Nova
 * shimmer) cost one path fill instead of thousands of single-pixel rects. Patterns anchor to the
 * canvas origin, so the dither stays locked to the pixel grid.
 */
const patterns = new Map<string, CanvasPattern>();
function ditherPattern(ctx: CanvasRenderingContext2D, color: string, density: number): CanvasPattern {
  const key = `${color}:${density}`;
  let p = patterns.get(key);
  if (!p) {
    const tile = createCanvas(4, 4);
    const g = tile.getContext('2d')!;
    g.fillStyle = color;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayer(x, y) < density) g.fillRect(x, y, 1, 1);
    p = ctx.createPattern(tile, 'repeat')!;
    patterns.set(key, p);
  }
  return p;
}

/** Diagonal yellow-and-black hazard stripes for colorblind-safe charge lanes. */
function hazardStripes(ctx: CanvasRenderingContext2D): CanvasPattern {
  let p = patterns.get('hazard');
  if (!p) {
    const tile = createCanvas(8, 8);
    const g = tile.getContext('2d')!;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        g.fillStyle = (x + y) % 8 < 4 ? PX.warn2 : PX.warn0;
        g.fillRect(x, y, 1, 1);
      }
    }
    p = ctx.createPattern(tile, 'repeat')!;
    patterns.set('hazard', p);
  }
  return p;
}

function withArenaClip(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(MIN_X, MIN_Y, MAX_X - MIN_X + 1, MAX_Y - MIN_Y + 1);
  ctx.clip();
  draw();
  ctx.restore();
}

// ---------------------------------------------------------------- scenery

/** Each area's torch flame: fire in the Ruins and the Ember Depths, teal foxfire in the Hollows, cold blue in the Catacombs. */
const TORCH_TINT: FlameTint[] = ['fire', 'fire', 'foxfire', 'frost'];

export function drawTorches(ctx: CanvasRenderingContext2D, torches: readonly Vec[], t: number, area = 0): void {
  const tint = TORCH_TINT[area] ?? 'fire';
  torches.forEach((torch, i) => {
    if (!visible(torch.x, torch.y, 8)) return;
    const frame = Math.floor(t * 9 + i * 1.7) % FLAME_FRAMES;
    blit(ctx, flame(frame, tint), torch.x, torch.y);
  });
}

/** The clearing the boss is coming to: a dashed gold border on the ground, marching unless flashing is reduced. */
export function drawClearingMark(ctx: CanvasRenderingContext2D, c: Rect, t: number, quiet: boolean): void {
  const x0 = Math.round((c.x0 + 20) / P);
  const y0 = Math.round((c.y0 + 20) / P);
  const x1 = Math.round((c.x1 - 20) / P);
  const y1 = Math.round((c.y1 - 20) / P);
  const off = quiet ? 0 : Math.floor(t * 8);
  const keep = (i: number) => (i + off) % 18 < 11;
  const dash = [
    ...linePixels(x0, y0, x1, y0, keep),
    ...linePixels(x1, y0, x1, y1, keep),
    ...linePixels(x1, y1, x0, y1, keep),
    ...linePixels(x0, y1, x0, y0, keep),
  ];
  const thick: number[] = [];
  for (let i = 0; i < dash.length; i += 2) thick.push(dash[i] + 1, dash[i + 1] + 1);
  pixels(ctx, thick, PX.gold0);
  pixels(ctx, dash, quiet || Math.floor(t * 3) % 2 === 0 ? PX.gold1 : PX.gold2);
}

/**
 * An arrowhead at art pixel (x, y) pointing along `a`, filled with `color` inside an ink outline.
 * Rasterized per pixel, so it stays crisp at any angle.
 */
export function drawEdgeArrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  // In the arrow's own frame (u along it): tip at +6, wings back at -4 spanning ±4.5, notched at -2.
  const inside = (dx: number, dy: number) => {
    const u = dx * c + dy * s;
    const v = Math.abs(-dx * s + dy * c);
    return u <= 6 && u >= -4 && v <= ((6 - u) / 10) * 4.5 && !(u < -2 && v < ((-2 - u) / 2) * 4.5);
  };
  const fill: number[] = [];
  const ink: number[] = [];
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      if (inside(dx, dy)) fill.push(cx + dx, cy + dy);
      else if (inside(dx + 1, dy) || inside(dx - 1, dy) || inside(dx, dy + 1) || inside(dx, dy - 1)) ink.push(cx + dx, cy + dy);
    }
  }
  pixels(ctx, ink, PX.ink);
  pixels(ctx, fill, color);
}

export function drawPortals(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  for (const p of world.portals) {
    const k = clamp(p.t / p.duration, 0, 1);
    const big = p.kind === 'boss' ? 2.6 : ARCHETYPE[p.kind] === 'brute' ? 1.4 : 1;
    const r = Math.max(2, Math.round(((10 + 18 * k) * big) / P));
    const x = p.x / P;
    const y = p.y / P;
    disc(ctx, x, y, r, PX.portal0);
    pixels(ctx, circlePixels(x, y, r), PX.portal1);
    const spin = t * 5;
    pixels(
      ctx,
      circlePixels(x, y, Math.max(1, r - 1), (X, Y) => {
        const a = Math.atan2(Y - y, X - x) + spin;
        return Math.floor(((a % TAU) + TAU) / (TAU / 6)) % 2 === 0;
      }),
      PX.portal2,
    );
    const tick = Math.floor(t * 10);
    for (let i = 0; i < 3; i++) {
      const a = hash(i, tick) * TAU;
      const d = hash(i + 5, tick) * (r - 1);
      px(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, PX.portal2);
    }
  }
}

export function drawCrystals(ctx: CanvasRenderingContext2D, world: World): void {
  for (const c of world.crystals) {
    if (!visible(c.x / P, c.y / P, 8)) continue;
    const tier = c.value >= 10 ? 2 : c.value >= 5 ? 1 : 0;
    const bob = Math.round(Math.sin(c.t * 4));
    const x = c.x / P;
    const y = c.y / P + bob;
    blit(ctx, crystal(tier), x, y);
    // Occasional twinkle on the upper-left facet.
    if (Math.floor(c.t * 3 + c.x) % 5 === 0) px(ctx, x - 1, y - (2 + tier), PX.white);
  }
}

// ---------------------------------------------------------------- attack previews

/**
 * Oriented charge lane: solid border, dithered fill that grows with the telegraph, chevrons.
 * `earth` (a boss burrowing along it) fills it with churned-earth colours inside the same red border.
 */
function lane(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, L: number, hw: number, k: number, safe: boolean, earth = false): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const fillTo = L * k;
  const dim = earth ? PX.dirt2 : PX.teleDim;
  const at = (u: number, v: number) => [x + c * u - s * v, y + s * u + c * v] as const;
  const quad = (u0: number, u1: number) => {
    ctx.beginPath();
    ctx.moveTo(...at(u0, -hw));
    ctx.lineTo(...at(u1, -hw));
    ctx.lineTo(...at(u1, hw));
    ctx.lineTo(...at(u0, hw));
    ctx.closePath();
  };
  withArenaClip(ctx, () => {
    quad(fillTo, L);
    ctx.fillStyle = ditherPattern(ctx, safe ? PX.warn0 : dim, safe ? 0.38 : 0.13);
    ctx.fill();
    if (fillTo > 0) {
      quad(0, fillTo);
      ctx.fillStyle = safe ? hazardStripes(ctx) : ditherPattern(ctx, dim, 0.5);
      ctx.fill();
    }
  });
  // Crisp 1px border.
  const keep = (_: number, X: number, Y: number) => inArena(X, Y);
  const [ax, ay] = at(0, -hw);
  const [bx, by] = at(L, -hw);
  const [cx2, cy2] = at(L, hw);
  const [dx, dy] = at(0, hw);
  const border = [
    ...linePixels(ax, ay, bx, by, keep),
    ...linePixels(bx, by, cx2, cy2, keep),
    ...linePixels(cx2, cy2, dx, dy, keep),
    ...linePixels(dx, dy, ax, ay, keep),
  ];
  if (safe) {
    // A dark rim outside the yellow border keeps the lane readable on any floor.
    const corners = [at(-1, -hw - 1), at(L + 1, -hw - 1), at(L + 1, hw + 1), at(-1, hw + 1)];
    const rim: number[] = [];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i];
      const [x1, y1] = corners[(i + 1) % 4];
      rim.push(...linePixels(x0, y0, x1, y1, keep));
    }
    pixels(ctx, rim, PX.warn0);
  }
  pixels(ctx, border, safe ? (k > 0.5 ? PX.warn3 : PX.warn2) : k > 0.5 ? PX.tele : PX.teleDim);
  // Chevrons pointing along the charge.
  const lit: number[] = [];
  const dimMarks: number[] = [];
  for (let u0 = 8; u0 < L - 4; u0 += 14) {
    const target = u0 <= fillTo ? lit : dimMarks;
    const wing = Math.min(4, hw - 1.5);
    for (let t = 0; t <= wing; t++) {
      for (const side of [-1, 1]) {
        const u = u0 + (wing - t);
        const v = side * t;
        const X = Math.round(x + c * u - s * v);
        const Y = Math.round(y + s * u + c * v);
        if (inArena(X, Y)) target.push(X, Y);
      }
    }
  }
  pixels(ctx, dimMarks, safe ? PX.warn1 : dim);
  pixels(ctx, lit, safe ? PX.warn3 : earth ? PX.dirt3 : PX.hostile3);
}

type AimFan = NonNullable<ReturnType<typeof aimLines>>;

/**
 * The lines a foe is about to shoot down (see aimLines): thin, sharp lines for icicles and a soft
 * dotted fan for spores, each stopping where stone would stop the shot. With safe warnings they
 * are yellow inside a dark casing; reduced flashing holds them steady.
 */
function drawAimLines(ctx: CanvasRenderingContext2D, world: World, e: Enemy, fan: AimFan, safe: boolean, quiet: boolean): void {
  const x = e.x / P;
  const y = e.y / P;
  const start = (e.r + 4) / P;
  const inside = (_: number, X: number, Y: number) => inArena(X, Y);
  for (const a of fan.angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const L = castRay(world.map.index, e.x, e.y, e.x + c * fan.length, e.y + s * fan.length) / P;
    if (L <= start + 1) continue;
    const x0 = x + c * start;
    const y0 = y + s * start;
    const x1 = x + c * L;
    const y1 = y + s * L;
    if (safe) {
      const keep = (i: number, X: number, Y: number) => inArena(X, Y) && (!fan.spores || i % 4 < 2);
      for (const o of [-1, 1]) pixels(ctx, linePixels(x0 - s * o, y0 + c * o, x1 - s * o, y1 + c * o, keep), PX.warn0);
      pixels(ctx, linePixels(x0, y0, x1, y1, keep), fan.k > 0.6 ? PX.warn3 : PX.warn2);
      continue;
    }
    if (fan.spores) {
      // A soft dotted fan whose dots drift outward as the spores gather, ending in a little puff.
      const off = quiet ? 0 : Math.floor(e.stateTime * 12);
      const color = fan.k > 0.6 ? PX.spore2 : PX.spore1;
      pixels(ctx, linePixels(x0, y0, x1, y1, (i, X, Y) => (i - off + 4000) % 4 === 0 && inArena(X, Y)), color);
      pixels(ctx, circlePixels(x1, y1, 2, (X, Y) => bayer(X, Y) < 0.5 && inArena(X, Y)), color);
      continue;
    }
    // An icicle's line: dim along its length, lit out from the shooter as the wind-up fills, a tick where stone stops it.
    const all = linePixels(x0, y0, x1, y1, inside);
    const lit = Math.floor((all.length / 2) * fan.k) * 2;
    const hot = fan.k > 0.8 && (quiet || Math.floor(e.stateTime * 14) % 2 === 0);
    pixels(ctx, all.slice(lit), PX.teleDim);
    pixels(ctx, all.slice(0, lit), hot ? PX.hostile3 : PX.tele);
    if (L < fan.length / P - 1) pixels(ctx, linePixels(x1 - s * 2, y1 + c * 2, x1 + s * 2, y1 - c * 2, inside), PX.tele);
  }
}

/**
 * Attack previews. `safe` draws them as yellow-and-black hazard markings (colorblind-safe);
 * `quiet` (reduced flashing) holds the newer ones steady.
 */
export function drawTelegraphs(ctx: CanvasRenderingContext2D, world: World, safe = false, quiet = false): void {
  for (const e of world.enemies) {
    if (e.dead || e.state !== 'windup') continue;
    const x = e.x / P;
    const y = e.y / P;
    const fan = aimLines(e);
    if (fan) {
      drawAimLines(ctx, world, e, fan, safe, quiet);
      continue;
    }
    if (e.kind === 'caster' && safe) {
      // A solid aim line with a dark casing on both sides.
      const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
      const L = 260 / P;
      const c = Math.cos(e.aim);
      const s = Math.sin(e.aim);
      const keep = (i: number, X: number, Y: number) => i > 4 && inArena(X, Y);
      for (const o of [-1, 1]) pixels(ctx, linePixels(x - s * o, y + c * o, x + c * L - s * o, y + s * L + c * o, keep), PX.warn0);
      pixels(ctx, linePixels(x, y, x + c * L, y + s * L, keep), k > 0.6 ? PX.warn3 : PX.warn2);
    } else if (e.kind === 'caster') {
      const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
      const L = 260 / P;
      const off = Math.floor(e.stateTime * 20);
      pixels(
        ctx,
        linePixels(x, y, x + Math.cos(e.aim) * L, y + Math.sin(e.aim) * L, (i, X, Y) => i > 4 && (i + off) % 6 < 3 && inArena(X, Y)),
        k > 0.7 ? PX.hostile3 : k > 0.35 ? PX.tele : PX.teleDim,
      );
    } else if (flameCone(e)) {
      const cone = flameCone(e)!;
      const R = cone.reach / P;
      withArenaClip(ctx, () => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, Math.max(1, R * cone.k), cone.angle - cone.half, cone.angle + cone.half);
        ctx.closePath();
        ctx.fillStyle = safe ? hazardStripes(ctx) : ditherPattern(ctx, PX.tele, 0.5);
        ctx.fill();
      });
      const edge: number[] = [];
      for (const side of [-1, 1]) {
        const a = cone.angle + side * cone.half;
        edge.push(...linePixels(x, y, x + Math.cos(a) * R, y + Math.sin(a) * R, (i, X, Y) => i > 3 && inArena(X, Y)));
      }
      edge.push(...circlePixels(x, y, R, (X, Y) => Math.abs(angleDiff(Math.atan2(Y - y, X - x), cone.angle)) <= cone.half && inArena(X, Y)));
      pixels(ctx, edge, safe ? (cone.k > 0.5 ? PX.warn3 : PX.warn2) : cone.k > 0.6 ? PX.hostile3 : PX.tele);
    } else if (attackLane(e)) {
      const l = attackLane(e)!;
      lane(ctx, x, y, e.aim, (l.length + e.r) / P, (e.r * 1.1) / P, windup(e, l.telegraph), safe, e.kind === 'boss' && e.bossMove === 'burrow');
    } else if (e.kind === 'boss' && e.bossMove === 'iceRing') {
      // Rimecoil calling up rings of ice: a frosty dashed ring round it, turning unless flashing is reduced.
      const k = windup(e, ENEMIES.boss.summonTelegraph);
      const spin = quiet ? 0 : e.stateTime * 1.5;
      pixels(
        ctx,
        circlePixels(x, y, 110 / P, (X, Y) => Math.floor((Math.atan2(Y - y, X - x) + Math.PI + spin) / 0.2) % 2 === 0),
        safe ? (k > 0.5 ? PX.warn3 : PX.warn2) : k > 0.5 ? PX.ice3 : PX.ice1,
      );
    } else if (e.kind === 'boss' && e.bossMove === 'volley' && safe) {
      const k = clamp(e.stateTime / ENEMIES.boss.volleyTelegraph, 0, 1);
      const r = (e.r + 20 + 40 * (1 - k)) / P;
      pixels(ctx, [...circlePixels(x, y, r - 1), ...circlePixels(x, y, r + 1)], PX.warn0);
      pixels(ctx, circlePixels(x, y, r), k > 0.5 ? PX.warn3 : PX.warn2);
    } else if (e.kind === 'boss' && e.bossMove === 'volley') {
      const k = clamp(e.stateTime / ENEMIES.boss.volleyTelegraph, 0, 1);
      const r = (e.r + 20 + 40 * (1 - k)) / P;
      pixels(ctx, circlePixels(x, y, r), PX.tele);
      if (k > 0.5) pixels(ctx, circlePixels(x, y, r + 1, (X, Y) => bayer(X, Y) < 0.5), PX.hostile3);
    } else if (e.kind === 'boss' && e.bossMove === 'summon') {
      const k = clamp(e.stateTime / ENEMIES.boss.summonTelegraph, 0, 1);
      pixels(
        ctx,
        circlePixels(x, y, 110 / P, (X, Y) => Math.floor((Math.atan2(Y - y, X - x) + Math.PI) / 0.2) % 2 === 0),
        k > 0.5 ? PX.portal2 : PX.portal1,
      );
    }
  }
}

// ---------------------------------------------------------------- enemies

function hpBar(ctx: CanvasRenderingContext2D, e: Enemy, x: number, top: number): void {
  const w = Math.max(6, Math.round((e.r * 2.2) / P));
  const bx = Math.round(x - w / 2);
  const by = Math.round(top);
  px(ctx, bx - 1, by - 1, PX.ink, w + 2, 4);
  px(ctx, bx, by, PX.hpBack, w, 2);
  px(ctx, bx, by, PX.hpFill, Math.max(0, Math.round(w * clamp(e.hp / e.maxHp, 0, 1))), 2);
}

function eyesAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  dist: number,
  spread: number,
  size: number,
  color: string,
  hi: string,
): void {
  for (const side of [-1, 1]) {
    const a = heading + side * spread;
    const ex = Math.round(x + Math.cos(a) * dist - (size - 1) / 2);
    const ey = Math.round(y + Math.sin(a) * dist - (size - 1) / 2);
    px(ctx, ex, ey, color, size, size);
    px(ctx, ex, ey, hi);
  }
}

/** A rounded dark pit round each of a pair of 2×2 eyes placed as `eyesAt` places them. */
function eyeSockets(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, dist: number, spread: number): void {
  for (const side of [-1, 1]) {
    const a = heading + side * spread;
    const ex = Math.round(x + Math.cos(a) * dist - 0.5);
    const ey = Math.round(y + Math.sin(a) * dist - 0.5);
    px(ctx, ex - 1, ey, PX.ink, 4, 2);
    px(ctx, ex, ey - 1, PX.ink, 2, 4);
  }
}

/** `n` frames cycling `rate` times a second, offset per foe. */
function cycle(time: number, rate: number, e: Enemy, n: number): number {
  return ((Math.floor(time * rate + e.wobble * 3) % n) + n) % n;
}

/** A Sporeling hops: up in an arc over its shadow, squashing as it lands, a teal glow pooled under it. */
function drawSporeling(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const cfg = ENEMIES.sporeling;
  const phase = ((((time + e.wobble) / cfg.hop) % 1) + 1) % 1;
  const air = phase < cfg.burst ? phase / cfg.burst : -1;
  const lift = air >= 0 ? Math.round(Math.sin(air * Math.PI) * 3) : 0;
  const squash: -1 | 0 | 1 = air >= 0 ? (lift >= 2 ? -1 : 0) : phase < cfg.burst + 0.12 ? 1 : 0;
  const flash = e.flash > 0 && !quiet;
  const bx = Math.round(e.x / P);
  const by = Math.round(e.y / P);
  const R = e.r / P;
  pixels(ctx, circlePixels(bx, by + 1, R + 1, (X, Y) => bayer(X, Y) < 0.4), PX.teal1);
  if (lift > 0) {
    const shadow: number[] = [];
    for (let dx = -3; dx <= 3; dx++) if (bayer(bx + dx, by + 3) < 0.6) shadow.push(bx + dx, by + 3);
    pixels(ctx, shadow, PX.ink);
  }
  blit(ctx, sporeling(squash, flash), bx, by - lift);
  // Glowing eyes peeking out under the front of the cap.
  if (!flash) eyesAt(ctx, bx, by - lift, e.heading, R * 0.55, 0.55, 1, PX.teal3, PX.teal3);
}

/** A Burrow Viper above ground; for a moment after it erupts, a ring of thrown-up earth round it. */
function drawViper(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const x = e.x / P;
  const y = e.y / P;
  const R = e.r / P;
  const flash = e.flash > 0 && !quiet;
  if (e.state === 'recover' || e.state === 'attack') {
    const k = clamp(e.stateTime / ENEMIES.burrowViper.surfaced, 0, 1);
    pixels(ctx, circlePixels(x, y, R + 1, (X, Y) => bayer(X, Y) < 0.75 * (1 - k)), PX.dirt1);
    pixels(ctx, circlePixels(x, y, R + 2 + k * 2, (X, Y) => bayer(X, Y) < 0.5 * (1 - k)), PX.dirt2);
  }
  blit(ctx, viper(directionIndex(e.heading), cycle(time, 5, e, VIPER_FRAMES), flash), x, y);
  if (!flash) eyesAt(ctx, x, y, e.heading, R * 0.85, 0.35, 1, PX.amberHi, PX.amberHi);
}

/** A Bone Rattler walking, or (struck down) a heap of bones whose skull twitches harder as it nears rising. */
function drawRattler(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const x = e.x / P;
  const y = e.y / P;
  const R = e.r / P;
  const flash = e.flash > 0 && !quiet;
  if (e.pile > 0) {
    const rise = 1 - clamp(e.pile / ENEMIES.rattler.riseTime, 0, 1);
    const twitch = rise > 0.6 && Math.floor(time * (quiet ? 6 : 10 + rise * 20)) % 2 === 0 ? 1 : 0;
    blit(ctx, bonePile(flash), x + (rise > 0.8 ? twitch : 0), y);
    const sx = Math.round(x - 1 + twitch) - 3;
    const sy = Math.round(y - 2 - (rise > 0.85 ? 1 : 0)) - 3;
    blit(ctx, skull(flash), sx + 3, sy + 3);
    // Cold light kindles in its sockets before it gets up.
    if (rise > 0.6 && !flash) {
      px(ctx, sx + 1, sy + 2, PX.ice2);
      px(ctx, sx + 4, sy + 2, PX.ice2);
    }
    return;
  }
  blit(ctx, rattler(directionIndex(e.heading), cycle(time, 6, e, RATTLER_FRAMES), flash), x, y);
  if (!flash) eyesAt(ctx, x, y, e.heading, R * 0.55, 0.45, 1, PX.ice2, PX.ice2);
}

/** A Wraith: ghostly always, fainter still (every other pixel, no outline) while it drifts through stone; its eyes always show. */
function drawWraith(ctx: CanvasRenderingContext2D, e: Enemy, world: World, quiet: boolean): void {
  const R = e.r / P;
  const x = e.x / P;
  const y = e.y / P + Math.round(Math.sin(world.time * 2.4 + e.wobble));
  const flash = e.flash > 0 && !quiet;
  const phased = clearanceAt(world.map.index, e.x, e.y) < 0;
  // A cold shimmer gathers round it as it readies a lunge.
  if (e.state === 'windup' && (quiet || Math.floor(world.time * 12) % 2 === 0)) {
    pixels(ctx, circlePixels(x, y, R + 3, (X, Y) => bayer(X, Y) < (quiet ? 0.35 : 0.5)), PX.spectre1);
  }
  blit(ctx, wraith(directionIndex(e.heading), cycle(world.time, 6, e, WRAITH_FRAMES), phased, flash), x, y);
  if (!flash) {
    const eye = e.state === 'windup' ? PX.hostile3 : PX.spectre3;
    eyesAt(ctx, x + Math.cos(e.heading) * R * 0.55, y + Math.sin(e.heading) * R * 0.55, e.heading, 1.2, Math.PI / 2, 1, eye, eye);
  }
}

function drawChaser(ctx: CanvasRenderingContext2D, e: Enemy, world: World, quiet: boolean): void {
  const time = world.time;
  switch (e.kind) {
    case 'sporeling':
      return drawSporeling(ctx, e, time, quiet);
    case 'burrowViper':
      return drawViper(ctx, e, time, quiet);
    case 'rattler':
      return drawRattler(ctx, e, time, quiet);
    case 'wraith':
      return drawWraith(ctx, e, world, quiet);
  }
  const frame = ((Math.floor(time * 8 + e.wobble * 3) % CHASER_FRAMES) + CHASER_FRAMES) % CHASER_FRAMES;
  const flash = e.flash > 0 && !quiet;
  const imp = e.kind === 'imp';
  const bx = Math.round(e.x / P);
  const by = Math.round(e.y / P);
  // An imp gathering itself to leap smoulders.
  if (imp && e.state === 'windup') pixels(ctx, circlePixels(bx, by, e.r / P + 3, (X, Y) => bayer(X, Y) < 0.5), PX.hostile2);
  // The face, and the glowing eyes in it, shift a pixel toward where it is heading.
  const ox = Math.round(Math.cos(e.heading) * 1.4);
  const oy = Math.round(Math.sin(e.heading) * 1.4);
  blit(ctx, chaser(frame, flash, imp, ox, oy), bx, by);
  if (flash) return;
  for (const ex of [bx - 2 + ox, bx + 1 + ox]) {
    px(ctx, ex, by - 1 + oy, PX.amberHi);
    px(ctx, ex, by + oy, PX.amber);
  }
}

/** A Puffcap: it roots and swells through its wind-up, a haze of spores thickening round it; at rest, a spore drifts up now and then. */
function drawPuffcap(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const R = e.r / P;
  const x = e.x / P;
  const y = e.y / P;
  const flash = e.flash > 0 && !quiet;
  const k = e.state === 'windup' ? windup(e, ENEMIES.puffcap.telegraph) : 0;
  if (k > 0.25) pixels(ctx, circlePixels(x, y, R + 2 + k * 3, (X, Y) => bayer(X, Y) < 0.2 + 0.35 * k), PX.spore1);
  blit(ctx, puffcap(Math.min(PUFF_SWELL - 1, Math.floor(k * PUFF_SWELL)), flash), x, y);
  if (flash) return;
  eyesAt(ctx, x, y, e.heading, R * 0.5, 0.7, 1, PX.ink, PX.ink);
  if (k === 0) {
    for (let i = 0; i < 2; i++) {
      const p = (time * 0.6 + e.wobble + i * 0.5) % 1;
      px(ctx, x - 1 + Math.sin(p * 6 + i) * 2, y - 2 - p * 9, p < 0.7 ? PX.spore1 : PX.spore0);
    }
  }
}

/** A Frost Archer: it draws its bow through the wind-up, the nocked icicle glinting as the shot nears. */
function drawFrostArcher(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const R = e.r / P;
  const x = e.x / P;
  const y = e.y / P;
  const flash = e.flash > 0 && !quiet;
  const drawn = e.state === 'windup';
  const a = drawn ? e.aim : e.heading;
  blit(ctx, frostArcher(directionIndex(a), drawn, flash), x, y);
  if (flash) return;
  eyesAt(ctx, x + Math.cos(a) * R * 0.3, y + Math.sin(a) * R * 0.3, a, 1.2, Math.PI / 2, 1, PX.ice2, PX.ice2);
  if (drawn && windup(e, ENEMIES.frostArcher.telegraph) > 0.5 && (quiet || Math.floor(time * 10) % 2 === 0)) {
    const tx = x + Math.cos(a) * R * 1.55;
    const ty = y + Math.sin(a) * R * 1.55;
    px(ctx, tx - 1, ty, PX.white, 3, 1);
    px(ctx, tx, ty - 1, PX.white, 1, 3);
  }
}

function drawCaster(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  if (e.kind === 'puffcap') return drawPuffcap(ctx, e, time, quiet);
  if (e.kind === 'frostArcher') return drawFrostArcher(ctx, e, time, quiet);
  const R = e.r / P;
  const x = e.x / P;
  const y = e.y / P;
  const flash = e.flash > 0 && !quiet;
  const pyro = e.kind === 'pyromancer';
  blit(ctx, caster(directionIndex(e.heading), flash, pyro), x, y);
  if (!flash) eyesAt(ctx, x + Math.cos(e.heading) * R * 0.3, y + Math.sin(e.heading) * R * 0.3, e.heading, 1.4, Math.PI / 2, 1, PX.amber, PX.amber);
  if (pyro) {
    // A fireball swelling over its hands while it casts.
    const k = e.state === 'windup' ? clamp(e.stateTime / 0.35, 0, 1) : 0;
    const fy = y - R - 3;
    if (k > 0.3) pixels(ctx, circlePixels(x, fy, 2 + k * 3, (X, Y) => bayer(X, Y) < 0.5), PX.hostile2);
    disc(ctx, x, fy, Math.round(k * 2), PX.flame0);
    px(ctx, x, fy, PX.flame2);
    return;
  }
  // Staff orb in front: tiny ember normally, swelling with a halo while the shot charges.
  const ox = x + (Math.cos(e.aim) * (e.r + 6)) / P;
  const oy = y + (Math.sin(e.aim) * (e.r + 6)) / P;
  if (e.state === 'windup') {
    const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
    const r = 1 + Math.round(k * 2);
    if (k > 0.4) pixels(ctx, circlePixels(ox, oy, r + 2, (X, Y) => bayer(X, Y) < 0.6), PX.hostile1);
    disc(ctx, ox, oy, r, PX.hostile2);
    px(ctx, ox, oy, PX.hostile4);
  } else {
    px(ctx, ox, oy, PX.hostile1);
  }
}

/** A Crypt Golem's fists at its sides: through its wind-up they rise (bigger, over their shadows), then come down for the slam. */
function drawGolemFists(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number, flash: boolean): void {
  const R = e.r / P;
  const k = e.state === 'windup' ? windup(e, ENEMIES.golem.telegraph) : 0;
  const up = k > 0 && k < 0.88;
  const lift = up ? Math.round(Math.min(1, k / 0.35) * 5) : 0;
  const c = Math.cos(e.heading);
  const s = Math.sin(e.heading);
  for (const side of [-1, 1]) {
    const fx = x + c * R * 0.45 - s * side * R * 1.05;
    const fy = y + s * R * 0.45 + c * side * R * 1.05;
    if (lift > 0) pixels(ctx, circlePixels(fx, fy + 1, 2, (X, Y) => bayer(X, Y) < 0.5), PX.ink);
    blit(ctx, golemFist(up, flash), fx, fy - lift);
  }
}

function drawBrute(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean, safe: boolean): void {
  const R = e.r / P;
  const golemKind = e.kind === 'golem';
  // A golem stands rooted while its fists go up; the others shake as they gather for a charge.
  const shakeX = e.state === 'windup' && !golemKind ? (Math.floor(time * 30) % 2 === 0 ? 1 : -1) : 0;
  const x = e.x / P + shakeX;
  const y = e.y / P;
  const flash = e.flash > 0 && !quiet;
  const hot = e.state === 'windup' || e.state === 'attack';
  const magma = e.kind === 'magmaBrute';
  const dir = directionIndex(e.heading);
  if (magma && !flash) pixels(ctx, circlePixels(x, y, R + 3, (X, Y) => bayer(X, Y) < (hot ? 0.55 : 0.25)), PX.hostile1);
  if (golemKind && hot && !flash) pixels(ctx, circlePixels(x, y, R + 2, (X, Y) => bayer(X, Y) < 0.4), PX.ice1);
  blit(ctx, e.kind === 'thornback' ? thornback(dir, hot, flash) : golemKind ? golem(dir, hot, flash) : brute(dir, hot, flash, magma), x, y);
  if (golemKind) drawGolemFists(ctx, e, x, y, flash);
  if (!flash) {
    if (e.kind === 'thornback') eyesAt(ctx, x, y, e.heading, R, 0.22, 1, hot ? PX.thorn3 : PX.amberHi, hot ? PX.white : PX.amberHi);
    else if (golemKind) eyesAt(ctx, x, y, e.heading, R * 0.55, 0.45, 2, hot ? PX.rimeGlow : PX.ice2, PX.white);
    else {
      // Set in dark sockets and brighter than any crack, so they read as eyes, not more cracks.
      eyeSockets(ctx, x, y, e.heading, R * 0.5, 0.6);
      eyesAt(ctx, x, y, e.heading, R * 0.5, 0.6, 2, hot ? PX.white : PX.amberHi, PX.white);
    }
  }
  // With safe warnings every attacker gets its "!" from drawWarningMarks instead.
  if (e.state === 'windup' && !safe) blit(ctx, exclaim(), x, y - R - 8);
  // Dazed after a charge (a golem's slam doesn't daze it).
  if (e.state === 'recover' && !golemKind) {
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i / 3) * TAU;
      px(ctx, x + Math.cos(a) * 6, y - R - 3 + Math.sin(a) * 2, PX.crackHot);
    }
  }
}

/** Each serpent foe's look: its plain and marked segments, its head, and its eyes. */
const SNAKE_LOOK: Record<'rival' | 'salamander' | BossId, { plain: SegmentStyle; marked: SegmentStyle; head: HeadKind; eye: string; eyeHi: string }> = {
  rival: { plain: 'rival', marked: 'rivalStripe', head: 'rival', eye: PX.amber, eyeHi: PX.amberHi },
  salamander: { plain: 'salamander', marked: 'salamanderStripe', head: 'salamander', eye: PX.amber, eyeHi: PX.amberHi },
  ouroboros: { plain: 'boss', marked: 'bossSpot', head: 'boss', eye: PX.gold1, eyeHi: PX.gold3 },
  pyrecoil: { plain: 'pyre', marked: 'pyreSpot', head: 'pyrecoil', eye: PX.flame1, eyeHi: PX.flame2 },
  sporemaw: { plain: 'spore', marked: 'sporeSpot', head: 'sporemaw', eye: PX.cap3, eyeHi: PX.spot },
  rimecoil: { plain: 'rime', marked: 'rimeSpot', head: 'rimecoil', eye: PX.ice3, eyeHi: PX.white },
  // The Ascendant's body is banded with the four Archmages' spotted segments (see drawEnemySnake).
  ascendant: { plain: 'boss', marked: 'bossSpot', head: 'boss', eye: PX.gold3, eyeHi: PX.white },
};

/** The Ascendant's bands: Ouroboros, Sporemaw, Rimecoil and Pyrecoil, round and round. */
const ASCENDANT_BANDS: SegmentStyle[] = ['bossSpot', 'sporeSpot', 'rimeSpot', 'pyreSpot'];

/**
 * Something tunnelling under the floor: a mound of earth at its head (and, for a boss, humps along
 * its body), crumbs flung up behind. Nothing else shows: no body, no status marks.
 */
function drawBurrowed(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const frame = cycle(time, 8, e, MOUND_FRAMES);
  const segs = e.segments;
  for (let i = segs.length - 1; i >= 0; i -= 2) {
    const r = Math.max(2, Math.round(((e.segRadius * (1 - (i / segs.length) * 0.45)) / P) * 0.7));
    blit(ctx, mound(r, (frame + i) % MOUND_FRAMES), segs[i].x / P, segs[i].y / P);
  }
  const R = Math.max(3, Math.round((e.r / P) * (segs.length > 0 ? 0.9 : 1.1)));
  const x = e.x / P;
  const y = e.y / P;
  blit(ctx, mound(R, frame), x, y);
  const back = e.aim + Math.PI;
  const tick = Math.floor(time * 10);
  for (let i = 0; i < 4; i++) {
    const a = back + (hash(i, tick + e.id) - 0.5) * 1.6;
    const d = R + 1 + hash(i + 3, tick + e.id) * 4;
    px(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, i % 2 === 0 ? PX.dirt2 : PX.dirt3);
  }
}

function drawEnemySnake(ctx: CanvasRenderingContext2D, e: Enemy, time: number, quiet: boolean): void {
  const boss = e.kind === 'boss';
  const look = SNAKE_LOOK[boss ? e.bossId : e.kind === 'salamander' ? 'salamander' : 'rival'];
  const { plain, marked } = look;
  const flash = e.flash > 0 && !quiet;
  const segs = e.segments;
  const n = segs.length;
  const radii = segs.map((_, i) => Math.max(2, Math.round((e.segRadius * (1 - (i / n) * 0.45)) / P)));
  const x = e.x / P;
  const y = e.y / P;
  const R = e.r / P;
  const ascendant = boss && e.bossId === 'ascendant';
  if (boss && (e.enraged || ascendant) && !flash) {
    // Pulsing dithered aura: red when enraged, gold for the Ascendant.
    const pulse = quiet ? 0.45 : 0.35 + 0.25 * Math.sin(time * 8);
    for (let ring = 0; ring < 3; ring++) {
      pixels(ctx, circlePixels(x, y, R * 1.9 + ring * 2, (X, Y) => bayer(X, Y) < pulse - ring * 0.1), e.enraged ? PX.enrage : PX.gold1);
    }
  }
  for (let i = n - 1; i >= 0; i--) blit(ctx, segmentOutline(radii[i]), segs[i].x / P, segs[i].y / P);
  for (let i = n - 1; i >= 0; i--) {
    const style: SegmentStyle = flash ? 'flash' : ascendant ? (i % 2 === 0 ? ASCENDANT_BANDS[(i / 2) % 4] : plain) : (boss ? i % 2 === 0 : i % 3 === 0) ? marked : plain;
    blit(ctx, segmentFill(radii[i], style), segs[i].x / P, segs[i].y / P);
  }
  const sway = clamp(Math.round(Math.sin(time * 3.2 + e.wobble) * 1.3), -1, 1);
  if (e.state === 'windup' && (quiet || Math.floor(time * 12) % 2 === 0)) {
    pixels(ctx, circlePixels(x, y, R + 3, (X, Y) => bayer(X, Y) < (quiet ? 0.35 : 0.5)), PX.hostile2);
  }
  // A Salamander's breath: a flickering cone of fire while it attacks.
  const cone = flameCone(e);
  if (cone?.burning) {
    const Rf = cone.reach / P;
    withArenaClip(ctx, () => {
      for (const [reach, color] of [
        [Rf, PX.hostile2],
        [Rf * 0.55, PX.flame1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, reach, cone.angle - cone.half, cone.angle + cone.half);
        ctx.closePath();
        ctx.fillStyle = ditherPattern(ctx, color, quiet ? 0.5 : Math.floor(time * 20) % 2 === 0 ? 0.5 : 0.6);
        ctx.fill();
      }
    });
  }
  blit(ctx, wizardHead(look.head, directionIndex(e.heading), sway, flash ? 'flash' : 'normal'), x, y);
  if (!flash) eyesAt(ctx, x, y, e.heading, R * 0.55, 0.6, boss ? 3 : 2, look.eye, look.eyeHi);
}

export function drawEnemies(ctx: CanvasRenderingContext2D, world: World, view: ViewOptions): void {
  const quiet = view.reduceFlashing;
  for (const e of world.enemies) {
    if (!visible(e.x / P, e.y / P, e.segments.length > 0 ? 180 : 32)) continue;
    if (e.hidden) {
      drawBurrowed(ctx, e, world.time);
      continue;
    }
    switch (ARCHETYPE[e.kind]) {
      case 'chaser':
        drawChaser(ctx, e, world, quiet);
        break;
      case 'caster':
        drawCaster(ctx, e, world.time, quiet);
        break;
      case 'brute':
        drawBrute(ctx, e, world.time, quiet, view.safeWarnings);
        break;
      case 'rival':
      case 'boss':
        drawEnemySnake(ctx, e, world.time, quiet);
        break;
    }
    drawEnemyStatus(ctx, e, world.time);
    if (ARCHETYPE[e.kind] !== 'chaser' && e.kind !== 'boss' && e.hp < e.maxHp) hpBar(ctx, e, e.x / P, (e.y - e.r) / P - 6);
  }
}

/** Colorblind-safe warnings: a yellow "!" over every foe winding up an attack (a burrower's warning is its marked circle). */
export function drawWarningMarks(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.enemies) {
    if (e.dead || e.hidden || e.state !== 'windup') continue;
    blit(ctx, exclaim(true), e.x / P, (e.y - e.r) / P - 8);
  }
}

/** Elite auras, the frosty dither on chilled foes and the ice block around frozen ones. */
function drawEnemyStatus(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const x = e.x / P;
  const y = e.y / P;
  const R = e.r / P;
  if (e.elite) {
    const color = e.elite === 'shielded' ? PX.eliteShield : e.elite === 'swift' ? PX.eliteSwift : PX.eliteSplit;
    if (e.elite === 'shielded' && e.shield > 0) {
      const k = e.shield / e.shieldMax;
      const hex: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU + time * 0.6;
        const a1 = ((i + 1) / 6) * TAU + time * 0.6;
        hex.push(
          ...linePixels(x + Math.cos(a0) * R * 1.55, y + Math.sin(a0) * R * 1.55, x + Math.cos(a1) * R * 1.55, y + Math.sin(a1) * R * 1.55, (_, X, Y) => bayer(X, Y) < 0.35 + 0.65 * k),
        );
      }
      pixels(ctx, hex, color);
    } else if (e.elite === 'swift') {
      const back = e.heading + Math.PI;
      const c = Math.cos(back);
      const sn = Math.sin(back);
      const streak: number[] = [];
      for (const side of [-1, 1]) {
        const ox = -sn * side * R * 0.6;
        const oy = c * side * R * 0.6;
        const len = R * (1.2 + 0.4 * Math.sin(time * 20 + side));
        streak.push(...linePixels(x + c * R * 1.2 + ox, y + sn * R * 1.2 + oy, x + c * (R * 1.2 + len) + ox, y + sn * (R * 1.2 + len) + oy));
      }
      pixels(ctx, streak, color);
    } else if (e.elite === 'splitting') {
      const spin = time * 3;
      pixels(
        ctx,
        circlePixels(x, y, R * 1.45, (X, Y) => Math.floor((((Math.atan2(Y - y, X - x) + spin) % TAU) + TAU) / 0.45) % 2 === 0),
        color,
      );
    }
    // Crown marker so elites read at a glance.
    const cx = Math.round(x);
    const cy = Math.round(y - R - 6);
    px(ctx, cx - 1, cy, color, 3, 1);
    px(ctx, cx, cy - 1, color, 1, 3);
    px(ctx, cx, cy, PX.white);
  }
  if (e.stunned > 0) {
    // Held by Constrict: little stars circling overhead.
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i / 3) * TAU;
      px(ctx, x + Math.cos(a) * (R + 2), y - R - 3 + Math.sin(a) * 2, PX.crackHot);
    }
  }
  if (e.frozen > 0) {
    const r = Math.round(R) + 2;
    const box = [
      ...linePixels(x - r, y - r, x + r, y - r),
      ...linePixels(x + r, y - r, x + r, y + r),
      ...linePixels(x + r, y + r, x - r, y + r),
      ...linePixels(x - r, y + r, x - r, y - r),
    ];
    const fill: number[] = [];
    for (let yy = Math.round(y - r + 1); yy < y + r; yy++) for (let xx = Math.round(x - r + 1); xx < x + r; xx++) if (bayer(xx, yy) < 0.35) fill.push(xx, yy);
    pixels(ctx, fill, PX.ice2);
    pixels(ctx, box, PX.ice3);
  } else if (e.chill > 0) {
    const r = Math.round(R);
    const frost: number[] = [];
    for (let yy = -r; yy <= r; yy++) {
      for (let xx = -r; xx <= r; xx++) {
        const X = Math.round(x) + xx;
        const Y = Math.round(y) + yy;
        if (xx * xx + yy * yy <= r * r && bayer(X, Y) < 0.22) frost.push(X, Y);
      }
    }
    pixels(ctx, frost, PX.ice3);
  }
}

// ---------------------------------------------------------------- new spells

/** Frost Fields: a dithered icy pool with a turning dashed rim and snowflake glints. */
export function drawFrostFields(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  for (const f of world.frostFields) {
    const grow = clamp(f.t / 0.25, 0, 1);
    const k = grow * clamp((f.duration - f.t) / 0.5, 0, 1);
    const x = Math.round(f.x / P);
    const y = Math.round(f.y / P);
    const R = Math.max(3, Math.round((f.radius * (0.85 + 0.15 * grow)) / P));
    withArenaClip(ctx, () => {
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fillStyle = ditherPattern(ctx, PX.ice0, k > 0.5 ? 0.38 : 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, R - 2, 0, TAU);
      ctx.arc(x, y, R * 0.7, 0, TAU, true);
      ctx.fillStyle = ditherPattern(ctx, PX.ice1, 0.13);
      ctx.fill();
    });
    const spin = t * 0.6 + f.id;
    pixels(
      ctx,
      circlePixels(x, y, R, (X, Y) => inArena(X, Y) && Math.floor((((Math.atan2(Y - y, X - x) + spin) % TAU) + TAU) / 0.22) % 2 === 0 && bayer(X, Y) < k + 0.25),
      PX.ice3,
    );
    pixels(ctx, circlePixels(x, y, R - 1, (X, Y) => inArena(X, Y) && bayer(X, Y) < 0.5 * k), PX.ice2);
    if (k > 0.3) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + t * 0.25 + f.id;
        const d = R * (i % 2 === 0 ? 0.72 : 0.42);
        const fx = x + Math.cos(a) * d;
        const fy = y + Math.sin(a) * d;
        px(ctx, fx - 1, fy, PX.ice3, 3, 1);
        px(ctx, fx, fy - 1, PX.ice3, 1, 3);
      }
    }
  }
}

/** Arcane Ward: a dithered ring, a turning triangle, and one glint per remaining charge. */
export function drawWard(ctx: CanvasRenderingContext2D, world: World, t: number, quiet = false): void {
  const w = world.ward;
  if (!w) return;
  const s = world.snake;
  // Ending: blinks, or with reduced flashing thins out steadily instead.
  const left = w.duration - w.t;
  if (!quiet && left < 1.5 && Math.floor(t * 10) % 2 === 0) return;
  const thin = quiet && left < 1.5 ? 0.3 + 0.7 * (left / 1.5) : 1;
  const flash = quiet ? w.flash * 0.3 : w.flash;
  const x = s.x / P;
  const y = s.y / P;
  const R = (SNAKE.headRadius * 2.3) / P;
  pixels(ctx, circlePixels(x, y, R, (X, Y) => bayer(X, Y) < (0.55 + 0.45 * flash) * thin), PX.ward1);
  if (flash > 0.2) pixels(ctx, circlePixels(x, y, R + 2, (X, Y) => bayer(X, Y) < flash * 0.6), PX.ward2);
  const rot = t * 1.6;
  const tri: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a0 = rot + (i / 3) * TAU;
    const a1 = rot + ((i + 1) / 3) * TAU;
    tri.push(...linePixels(x + Math.cos(a0) * R * 1.12, y + Math.sin(a0) * R * 1.12, x + Math.cos(a1) * R * 1.12, y + Math.sin(a1) * R * 1.12));
  }
  pixels(ctx, tri, PX.ward2);
  for (let i = 0; i < w.charges; i++) {
    const a = -rot * 0.7 + (i / Math.max(1, w.charges)) * TAU;
    const cx = x + Math.cos(a) * R * 1.4;
    const cy = y + Math.sin(a) * R * 1.4;
    px(ctx, cx - 1, cy, PX.white, 3, 1);
    px(ctx, cx, cy - 1, PX.white, 1, 3);
  }
}

/** Arcane Lance beams: a white core inside cyan bands that dither away as the beam fades. */
export function drawBeams(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.beams) {
    const k = b.life / b.maxLife;
    const x0 = b.x0 / P;
    const y0 = b.y0 / P;
    const x1 = b.x1 / P;
    const y1 = b.y1 / P;
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const half = Math.max(1, Math.round((b.width / P) * 0.5 * (0.6 + 0.4 * k)));
    for (let o = half; o >= 1; o--) {
      const color = o === half ? PX.cyan1 : PX.cyan2;
      const keep = (_: number, X: number, Y: number) => inArena(X, Y) && bayer(X, Y) < k + 0.15;
      pixels(ctx, linePixels(x0 + nx * o, y0 + ny * o, x1 + nx * o, y1 + ny * o, keep), color);
      pixels(ctx, linePixels(x0 - nx * o, y0 - ny * o, x1 - nx * o, y1 - ny * o, keep), color);
    }
    pixels(ctx, linePixels(x0, y0, x1, y1, (_, X, Y) => inArena(X, Y)), k > 0.4 ? PX.white : PX.cyan3);
  }
}

// ---------------------------------------------------------------- the player's serpent

export function drawSerpent(ctx: CanvasRenderingContext2D, world: World, gesture: GestureView, t: number, quiet = false): void {
  const invulnerable = world.invuln > 0 && world.time > 1.6;
  if (quiet && invulnerable) {
    // Reduced flashing: see-through for the whole invulnerability window instead of flickering.
    ctx.globalAlpha = 0.55;
    drawSerpentBody(ctx, world, gesture, t, false);
    ctx.globalAlpha = 1;
    return;
  }
  // Classic pixel-game invulnerability: the sprite flickers instead of fading.
  if (invulnerable && Math.floor(world.invuln * 14) % 2 === 0) return;
  drawSerpentBody(ctx, world, gesture, t, !quiet && world.hurtFlash > 0.6);
}

function drawSerpentBody(ctx: CanvasRenderingContext2D, world: World, gesture: GestureView, t: number, hurt: boolean): void {
  const s = world.snake;
  const segs = s.segments;
  const radii = segs.map((_, i) => Math.max(2, Math.round(s.segmentRadius(i) / P)));

  for (let i = segs.length - 1; i >= 0; i--) blit(ctx, segmentOutline(radii[i]), segs[i].x / P, segs[i].y / P);
  for (let i = segs.length - 1; i >= 0; i--) {
    const style: SegmentStyle = hurt ? 'hurt' : i % 4 === 1 ? 'stripe' : 'body';
    blit(ctx, segmentFill(radii[i], style, world.wizard), segs[i].x / P, segs[i].y / P);
  }

  // Magic sparkles along the body grow with spell power.
  const power = clamp((world.upgrades.potency + world.level * 0.3) / 8, 0, 1);
  if (power > 0.05) {
    const tick = Math.floor(t * 8);
    for (let i = 0; i < segs.length; i += 2) {
      if (hash(i, tick) < power * 0.35) {
        const r = radii[i] + 1;
        px(ctx, segs[i].x / P + (hash(i + 7, tick) - 0.5) * 2 * r, segs[i].y / P + (hash(i + 13, tick) - 0.5) * 2 * r, PX.sparkle);
      }
    }
  }

  const sway = clamp(Math.round(Math.sin(s.anim * 3.2) * 1.3), -1, 1);
  const hx = s.x / P;
  const hy = s.y / P;
  blit(ctx, wizardHead('player', directionIndex(s.heading), sway, hurt ? 'hurt' : 'normal', world.wizard), hx, hy);

  // Eyes: 2x2 whites with a pupil pixel that looks toward the recorded aim target.
  const R = SNAKE.headRadius / P;
  const look = gesture.active && gesture.target ? Math.atan2(gesture.target.y - s.y, gesture.target.x - s.x) : s.heading;
  for (const side of [-1, 1]) {
    const a = s.heading + side * 0.62;
    const ex = Math.round(hx + Math.cos(a) * R * 0.62) - 1;
    const ey = Math.round(hy + Math.sin(a) * R * 0.62) - 1;
    px(ctx, ex, ey, PX.eye, 2, 2);
    px(ctx, ex + (Math.cos(look) > 0.2 ? 1 : Math.cos(look) < -0.2 ? 0 : side > 0 ? 1 : 0), ey + (Math.sin(look) > 0 ? 1 : 0), PX.ink);
  }

  if (s.anim % 2.4 < 0.25) {
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    for (let k = 0; k < 3; k++) px(ctx, hx + c * (R * 1.2 + 1 + k), hy + sn * (R * 1.2 + 1 + k), PX.tongue);
    const fx = hx + c * (R * 1.2 + 4);
    const fy = hy + sn * (R * 1.2 + 4);
    px(ctx, fx - sn, fy + c, PX.tongue);
    px(ctx, fx + sn, fy - c, PX.tongue);
  }
}

// ---------------------------------------------------------------- spells and projectiles

export function drawBolts(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.bolts) {
    const r = clamp(Math.round(b.r / P), 2, 5);
    const x = b.x / P;
    const y = b.y / P;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const L = (sp * 0.045) / P;
    const tx = x - (b.vx / sp) * L;
    const ty = y - (b.vy / sp) * L;
    const trail = linePixels(tx, ty, x, y);
    const n = trail.length / 2;
    const far: number[] = [];
    const mid: number[] = [];
    const near: number[] = [];
    for (let i = 0; i < n; i++) {
      const bucket = i < n / 3 ? far : i < (2 * n) / 3 ? mid : near;
      bucket.push(trail[2 * i], trail[2 * i + 1]);
      if (r >= 4 && i >= n / 3) bucket.push(trail[2 * i] + (Math.abs(b.vy) > Math.abs(b.vx) ? 1 : 0), trail[2 * i + 1] + (Math.abs(b.vy) > Math.abs(b.vx) ? 0 : 1));
    }
    pixels(ctx, far, PX.cyan0);
    pixels(ctx, mid, PX.cyan1);
    pixels(ctx, near, PX.cyan2);
    blit(ctx, boltHead(r), x, y);
  }
}

export function drawArcs(ctx: CanvasRenderingContext2D, world: World, t: number, quiet = false): void {
  for (const arc of world.arcs) {
    const k = arc.life / arc.maxLife;
    // Lightning re-jitters 30 times a second; with reduced flashing it holds one shape.
    const rng = mulberry32(Math.floor(arc.seed + (quiet ? 0 : t * 30)));
    const pts: Vec[] = [];
    for (let i = 0; i < arc.points.length - 1; i++) {
      const a = { x: arc.points[i].x / P, y: arc.points[i].y / P };
      const b = { x: arc.points[i + 1].x / P, y: arc.points[i + 1].y / P };
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(2, Math.floor(len / 8));
      const nx = -(b.y - a.y) / (len || 1);
      const ny = (b.x - a.x) / (len || 1);
      for (let j = 0; j < steps; j++) {
        const u = j / steps;
        const jitter = j === 0 ? 0 : (rng() - 0.5) * 9;
        pts.push({ x: a.x + (b.x - a.x) * u + nx * jitter, y: a.y + (b.y - a.y) * u + ny * jitter });
      }
    }
    const end = arc.points[arc.points.length - 1];
    pts.push({ x: end.x / P, y: end.y / P });
    const core: number[] = [];
    for (let i = 1; i < pts.length; i++) core.push(...linePixels(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
    if (k > 0.4 && !arc.fizzle && !quiet) {
      const halo: number[] = [];
      for (let i = 0; i < core.length; i += 2) halo.push(core[i] + 1, core[i + 1], core[i] - 1, core[i + 1], core[i], core[i + 1] + 1, core[i], core[i + 1] - 1);
      pixels(ctx, halo, PX.green1);
    }
    pixels(ctx, core, k > 0.5 ? PX.green3 : PX.green2);
    for (let i = 1; i < arc.points.length; i++) {
      const hx = arc.points[i].x / P;
      const hy = arc.points[i].y / P;
      px(ctx, hx - 1, hy, PX.green3, 3, 1);
      px(ctx, hx, hy - 1, PX.green3, 1, 3);
    }
  }
}

export function drawNovas(ctx: CanvasRenderingContext2D, world: World): void {
  for (const n of world.novas) {
    const expanding = n.t < n.duration;
    const fade = expanding ? 1 : clamp(1 - (n.t - n.duration) / 0.25, 0, 1);
    const x = n.x / P;
    const y = n.y / P;
    const R = Math.round(n.radius / P);
    if (R < 2) continue;
    const keep = (X: number, Y: number) => bayer(X, Y) < fade;
    // Sparse dithered shimmer filling the band just inside the ring.
    withArenaClip(ctx, () => {
      ctx.beginPath();
      ctx.arc(Math.round(x), Math.round(y), R - 2, 0, TAU);
      ctx.arc(Math.round(x), Math.round(y), R * 0.72, 0, TAU, true);
      ctx.fillStyle = ditherPattern(ctx, PX.gold0, fade > 0.5 ? 0.13 : 0.07);
      ctx.fill();
    });
    pixels(ctx, circlePixels(x, y, R + 1, (X, Y) => bayer(X, Y) < 0.5 * fade), PX.gold0);
    pixels(ctx, circlePixels(x, y, R, keep), PX.gold1);
    pixels(ctx, circlePixels(x, y, R - 1, keep), fade > 0.5 ? PX.gold3 : PX.gold1);
    pixels(ctx, circlePixels(x, y, R - 2, keep), PX.gold1);
    // Rune ticks riding the ring.
    const ticks: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + n.t * 3;
      for (let d = R - 5; d <= R - 3; d++) ticks.push(Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d));
    }
    if (fade > 0.4) pixels(ctx, ticks, PX.gold3);
  }
}

/** The ultimates in pixels: cast waves, Bastion's gilded body, Maelstrom's storm ring, Starfall's stars and their marks. */
export function drawUltimatePixel(ctx: CanvasRenderingContext2D, world: World, t: number, quiet = false): void {
  for (const r of world.ultRings) {
    const k = r.t / r.life;
    const R = (r.r * (1 - (1 - k) * (1 - k))) / P;
    const keep = (X: number, Y: number) => bayer(X, Y) < (1 - k) * (quiet ? 0.5 : 0.9);
    pixels(ctx, circlePixels(r.x / P, r.y / P, R, keep), r.color);
    pixels(ctx, circlePixels(r.x / P, r.y / P, R - 1, keep), PX.white);
  }
  const u = world.ult;
  const s = world.snake;
  if (u.active > 0 && u.id === 'bastion') {
    const fade = Math.min(1, u.active / 0.8);
    const on = quiet ? 0.5 : 0.45 + 0.25 * Math.sin(t * 9);
    const keep = (X: number, Y: number) => bayer(X, Y) < on * fade;
    const gold = ULTIMATES.bastion.color;
    pixels(ctx, circlePixels(s.x / P, s.y / P, (SNAKE.headRadius * 1.9) / P, keep), gold);
    for (let i = 0; i < s.segments.length; i += 2) pixels(ctx, circlePixels(s.segments[i].x / P, s.segments[i].y / P, 7, keep), gold);
  }
  if (u.active > 0 && u.id === 'maelstrom') {
    const R = ULTIMATES.maelstrom.radius / P;
    const fade = Math.min(1, u.active / 0.8, u.t / 0.3);
    const spin = stormAngle(t);
    const out: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a0 = spin + (i / 7) * TAU;
      for (let j = 0; j < 14; j++) {
        const a = a0 + (j / 14) * 0.55;
        const X = Math.round(s.x / P + Math.cos(a) * R);
        const Y = Math.round(s.y / P + Math.sin(a) * R);
        if (bayer(X, Y) < 0.8 * fade) out.push(X, Y);
      }
    }
    pixels(ctx, out, ULTIMATES.maelstrom.color);
  }
  const gold = ULTIMATES.starfall.color;
  for (const st of world.stars) {
    const k = Math.min(1, st.t / st.fall);
    pixels(ctx, circlePixels(st.x / P, st.y / P, (st.r * (1.3 - 0.3 * k)) / P, (X, Y) => (X + Y) % 4 < 2 && bayer(X, Y) < 0.4 + 0.5 * k), gold);
    const x = Math.round((st.x + 160 * (1 - k)) / P);
    const y = Math.round((st.y - 520 * (1 - k)) / P);
    pixels(ctx, linePixels(x + 19, y - 62, x, y, (i) => i % 2 === 0), '#fff3c4');
    px(ctx, x - 2, y, gold, 5, 1);
    px(ctx, x, y - 2, gold, 1, 5);
    px(ctx, x - 1, y - 1, PX.white, 3, 3);
  }
}

/** Hostile shots: magic orbs, drifting spores, and icicles pointing the way they fly over a frosty streak. */
export function drawShots(ctx: CanvasRenderingContext2D, world: World): void {
  for (const p of world.shots) {
    const x = p.x / P;
    const y = p.y / P;
    if (!visible(x, y, 16)) continue;
    if (p.look === 'spore') {
      blit(ctx, sporeShot(Math.max(3, Math.round(p.r / P)), Math.floor(p.spin * 0.5) % SPORE_FRAMES), x, y);
    } else if (p.look === 'icicle') {
      const r = Math.max(2, Math.round(p.r / P));
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / sp;
      const uy = p.vy / sp;
      const tail = r * 2.6;
      pixels(ctx, linePixels(x - ux * (tail + 9), y - uy * (tail + 9), x - ux * tail, y - uy * tail, (i, X, Y) => bayer(X, Y) < 0.2 + i * 0.08), PX.ice1);
      blit(ctx, icicleShot(r, directionIndex(Math.atan2(p.vy, p.vx))), x, y);
    } else {
      blit(ctx, shot(Math.max(2, Math.round(p.r / P)), Math.floor(p.spin) % SHOT_FRAMES), x, y);
    }
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, world: World): void {
  for (const p of world.particles) {
    const k = p.life / p.max;
    const x = Math.round(p.x / P);
    const y = Math.round(p.y / P);
    if (!visible(x, y, 4)) continue;
    if (bayer(x, y) > k + 0.2) continue; // dithered fade-out
    const size = (p.size * (0.5 + k)) / P;
    if (p.kind === 'glow') {
      if (size >= 2.2) {
        px(ctx, x - 1, y, p.color, 3, 1);
        px(ctx, x, y - 1, p.color, 1, 3);
      } else px(ctx, x, y, p.color);
    } else {
      const s = size >= 1.6 ? 2 : 1;
      px(ctx, x, y, p.color, s, s);
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 120 && p.kind === 'spark') px(ctx, x - (p.vx / sp) * 1.5, y - (p.vy / sp) * 1.5, p.color);
    }
  }
}

export function drawAim(ctx: CanvasRenderingContext2D, world: World, target: Vec, t: number): void {
  const s = world.snake;
  const far = Math.hypot(target.x - s.x, target.y - s.y) >= SNAKE.aimMinDistance;
  const hx = s.x / P;
  const hy = s.y / P;
  const ex = far ? target.x / P : hx + (Math.cos(s.heading) * 140) / P;
  const ey = far ? target.y / P : hy + (Math.sin(s.heading) * 140) / P;
  const off = Math.floor(t * 14);
  pixels(ctx, linePixels(hx, hy, ex, ey, (i) => i > 8 && (i + off) % 8 < 3), far ? PX.cyan1 : PX.cyan0);
  blit(ctx, reticle(Math.floor(t * 6) % RETICLE_FRAMES, far), target.x / P, target.y / P);
}

// ---------------------------------------------------------------- screen-space overlay (sigil trail, hurt flash)

/** Draws a stroke on the screen-space pixel overlay: a bright core with a coloured halo. */
export function drawTrail(ctx: CanvasRenderingContext2D, pts: Vec[], color: string, k: number): void {
  if (pts.length < 2) return;
  const core: number[] = [];
  const seen = new Set<number>();
  for (let i = 1; i < pts.length; i++) {
    const seg = linePixels(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    for (let j = 0; j < seg.length; j += 2) {
      const key = seg[j] * 8192 + seg[j + 1];
      if (!seen.has(key)) {
        seen.add(key);
        core.push(seg[j], seg[j + 1]);
      }
    }
  }
  const halo: number[] = [];
  for (let i = 0; i < core.length; i += 2) {
    const x = core[i];
    const y = core[i + 1];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = (x + dx) * 8192 + (y + dy);
      if (!seen.has(key) && bayer(x + dx, y + dy) < k) halo.push(x + dx, y + dy);
    }
  }
  pixels(ctx, halo, color);
  // While a finished stroke fades out, its core dithers away too.
  const kept: number[] = [];
  for (let i = 0; i < core.length; i += 2) if (k >= 0.95 || bayer(core[i], core[i + 1]) < k + 0.25) kept.push(core[i], core[i + 1]);
  pixels(ctx, kept, k > 0.6 ? PX.white : color);
}

export function drawTrailTip(ctx: CanvasRenderingContext2D, p: Vec): void {
  px(ctx, p.x - 1, p.y, PX.white, 3, 1);
  px(ctx, p.x, p.y - 1, PX.white, 1, 3);
}

/** Pre-dithered red border used for the hurt flash and low-health warning (one canvas per level). */
export function buildVignette(w: number, h: number, level: number): HTMLCanvasElement {
  const c = createCanvas(w, h);
  const g = c.getContext('2d')!;
  const list: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2);
      const ny = (y - h / 2) / (h / 2);
      // Only the outer edge of the screen, and never more than about half the pixels.
      const e = clamp((Math.hypot(nx * 0.9, ny) - 0.85) / 0.45, 0, 1);
      if (bayer(x, y) < e * level * 0.55) list.push(x, y);
    }
  }
  pixels(g, list, PX.hurt1);
  return c;
}

// ---------------------------------------------------------------- Constrict

function loopPath(ctx: CanvasRenderingContext2D, pts: readonly Vec[]): void {
  ctx.beginPath();
  ctx.moveTo(Math.round(pts[0].x / P), Math.round(pts[0].y / P));
  for (const p of pts) ctx.lineTo(Math.round(p.x / P), Math.round(p.y / P));
  ctx.closePath();
}

/**
 * Constrict visuals. Under the bodies (`hint` false): the dithered flash of a loop that just
 * crushed foes. Over the serpent (`hint` true): the gap still to close around enclosed foes.
 */
export function drawCoilPixel(ctx: CanvasRenderingContext2D, world: World, t: number, hint: boolean, quiet = false): void {
  const ramp = WIZARDS[world.wizard].look.px.body;
  if (!hint) {
    for (const c of world.constricts) {
      const k = c.life / c.maxLife;
      withArenaClip(ctx, () => {
        loopPath(ctx, c.points);
        ctx.fillStyle = ditherPattern(ctx, ramp[0], quiet ? 0.25 : k > 0.5 ? 0.5 : 0.25);
        ctx.fill();
      });
      const edge: number[] = [];
      for (let i = 0; i < c.points.length; i++) {
        const a = c.points[i];
        const b = c.points[(i + 1) % c.points.length];
        edge.push(...linePixels(a.x / P, a.y / P, b.x / P, b.y / P, (_, X, Y) => inArena(X, Y) && bayer(X, Y) < k + 0.2));
      }
      pixels(ctx, edge, quiet ? ramp[1] : PX.white);
    }
    return;
  }
  const coil = world.coil;
  if (!coil || coil.closed) return;
  const s = world.snake;
  const seg = s.segments[coil.index];
  if (!seg) return;
  const loop = [{ x: s.x, y: s.y }, ...s.segments.slice(0, coil.index + 1)];
  withArenaClip(ctx, () => {
    loopPath(ctx, loop);
    ctx.fillStyle = ditherPattern(ctx, ramp[0], 0.13);
    ctx.fill();
  });
  const off = Math.floor(t * 20);
  pixels(ctx, linePixels(s.x / P, s.y / P, seg.x / P, seg.y / P, (i) => (i + off) % 4 < 2), quiet || Math.floor(t * 10) % 2 === 0 ? PX.white : ramp[1]);
}

// ---------------------------------------------------------------- breakables and pickups

const URN_ROWS = [
  '..kkkk..',
  '.kRRRRk.',
  '..kMMk..',
  '.kLLLMk.',
  'kLLMMMDk',
  'kLMMMMDk',
  'kBBBBBBk',
  'kMMMMMDk',
  '.kMMDDk.',
  '..kkkk..',
];
const RELIQUARY_ROWS = [
  '.kkkkkkkkkkkkkkkkkkkk.',
  'kGGGGGGGGGGGGGGGGGGGGk',
  'kGWWWWWWWWGGWWWWWWWWGk',
  'kGWwwwwwwwGGwwwwwwwwGk',
  'kGGGGGGGGGCCGGGGGGGGGk',
  'kGWWWWWWWGCCGWWWWWWWGk',
  'kGWwwwwwwwGGwwwwwwwwGk',
  'kGWwwwwwwwGGwwwwwwwwGk',
  'kGWwwwwwwwGGwwwwwwwwGk',
  'kGGGGGGGGGGGGGGGGGGGGk',
  '.kkkkkkkkkkkkkkkkkkkk.',
];
/** The Ember Depths' containers: a geode of glowing crystal, and an iron brazier full of coals. */
const GEODE_ROWS = [
  '..kkkk..',
  '.kSSSSk.',
  'kSCcCSSk',
  'kSccCcSk',
  'kSCcccSk',
  'kSScCcSk',
  'kSSSccSk',
  '.kSSSSDk',
  '.kDDDDk.',
  '..kkkk..',
];
const BRAZIER_ROWS = [
  '.kkkkkkkkkkkkkkkkkkkk.',
  'kIIIIIIIIIIIIIIIIIIIIk',
  'kIffFFffFFffFFffFFffIk',
  'kIfFFyyFFffFFyyFFffFIk',
  'kIFFyyyyFFFFyyyyFFFFIk',
  'kIfFFyyFFffFFyyFFffFIk',
  'kIffFFffFFffFFffFFffIk',
  'kIIIIIIIIIIIIIIIIIIIIk',
  'kiiiiiiiiiiiiiiiiiiiik',
  '.kiik............kiik.',
  '..kk..............kk..',
];
const BREAKABLE_COLORS = {
  k: PX.ink,
  R: '#3a180c',
  L: '#d98a52',
  M: '#a85a32',
  D: '#6e3220',
  B: PX.gold1,
  G: '#e8c87a',
  W: '#7a4424',
  w: '#4a2412',
  C: PX.cyan2,
  S: '#4a3a3a',
  c: '#ffd36b',
  I: '#5a5260',
  i: '#2e2a34',
  f: '#a8321e',
  F: '#ff7a2a',
  y: '#ffd36b',
};
/** The Hollows' containers: a little cluster of glowcaps, and a big woody seed pod split along a seam of glowing seeds. */
const GLOWCAP_ROWS = [
  '..kkkk....',
  '.kCcCCk...',
  'kCcCCCCk..',
  'kCCCCCCkk.',
  '.kkSSkkCCk',
  '..kSSkkCCk',
  '..kSSkkSk.',
  '.kMSSMMSMk',
  'kMMMMMMMMk',
  '.kkkkkkkk.',
];
const SEEDPOD_ROWS = [
  '......kkkkkkkkkk......',
  '...kkkWLLWWLLWWWkkk...',
  '..kWWLLWWWWWWWWWLLWk..',
  '.kWLLWWWWWWWWWWWWWWWk.',
  'kWLWWkkkkkkkkkkkkWWWDk',
  'kWWWkBcBBcBBcBBcBkWWDk',
  'kWWWWkkkkkkkkkkkkWWDDk',
  '.kWWWWWWWWWWWWWWWWDDk.',
  '..kDWWWWWWWWWWWWDDDk..',
  '...kkkDDDDDDDDDDkkk...',
  '......kkkkkkkkkk......',
];
/** The Catacombs' containers: a frost-rimed urn, and a lidded coffin bound with iron and marked with a cross. */
const FROST_URN_ROWS = [
  '..kkkk..',
  '.kRRRRk.',
  '..kMMk..',
  '.kFFFFk.',
  'kLFLMFDk',
  'kLMMMMDk',
  'kBBBBBBk',
  'kMMMMMDk',
  '.kMMDDk.',
  '..kkkk..',
];
const COFFIN_ROWS = (() => {
  // Broad at the shoulders (the head end, west), tapering to the feet.
  const top = [3, 2, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3];
  const rows: string[] = [];
  for (let y = 0; y < 11; y++) {
    let row = '';
    for (let x = 0; x < top.length; x++) {
      const t = top[x];
      const b = 10 - t;
      if (y < t || y > b) row += '.';
      else if (y === t || y === b || x === 0 || x === top.length - 1) row += 'k';
      else if ((x === 9 && y >= 3 && y <= 7) || (y === 4 && x >= 8 && x <= 10)) row += 'B';
      else if (x === 5 || x === 16) row += 'I';
      else if (y === t + 1) row += 'L';
      else if (y === b - 1) row += 'D';
      else row += 'M';
    }
    rows.push(row);
  }
  return rows;
})();
const BREAKABLE_ROWS: Record<BreakableLook, string[]> = {
  urn: URN_ROWS,
  reliquary: RELIQUARY_ROWS,
  geode: GEODE_ROWS,
  brazier: BRAZIER_ROWS,
  glowcap: GLOWCAP_ROWS,
  seedpod: SEEDPOD_ROWS,
  frostUrn: FROST_URN_ROWS,
  coffin: COFFIN_ROWS,
};
/** Colours of the newer looks over the shared ones; B and C (and c) also vary with each container's seeded band. */
const LOOK_COLORS: Partial<Record<BreakableLook, Record<string, string>>> = {
  glowcap: { S: '#d8f0e8', M: '#1c5a3e' },
  seedpod: { W: '#6a4a30', L: '#9a7448', D: '#3a2414' },
  frostUrn: { R: '#141c34', L: '#8a9ac0', M: '#5a6a94', D: '#34405e', F: PX.ice3 },
  // Warm pale limestone, so a coffin never reads as the crypt's blue stonework.
  coffin: { L: '#d8cfbc', M: '#9a8f7c', D: '#5a5244', I: '#26222a' },
};
function bandColors(look: BreakableLook, band: number): Record<string, string> {
  const even = band % 2 === 0;
  switch (look) {
    // Geodes come in amber and in red.
    case 'geode':
      return { B: even ? PX.gold1 : PX.teal2, C: even ? '#ff9a4a' : '#ff5a3a' };
    // Glowcaps and seed pods glow teal or magenta.
    case 'glowcap':
    case 'seedpod':
      return { B: even ? PX.teal2 : PX.cap2, C: even ? PX.teal2 : PX.cap2, c: even ? PX.teal3 : PX.cap3 };
    case 'frostUrn':
      return { B: even ? PX.ice2 : PX.gold1 };
    case 'coffin':
      return { B: even ? PX.gold1 : PX.ice2 };
    default:
      return { B: even ? PX.gold1 : PX.teal2, C: PX.cyan2 };
  }
}
const breakableSprites = new Map<string, Sprite>();
function breakableSprite(look: BreakableLook, flash: boolean, band: number): Sprite {
  const key = `${look}:${flash}:${band}`;
  let s = breakableSprites.get(key);
  if (!s) {
    const colors: Record<string, string> = { ...BREAKABLE_COLORS, ...LOOK_COLORS[look], ...bandColors(look, band) };
    if (flash) for (const k of Object.keys(colors)) if (k !== 'k') colors[k] = PX.white;
    s = gridSprite(BREAKABLE_ROWS[look], colors);
    breakableSprites.set(key, s);
  }
  return s;
}

/** Containers, each on a dithered shadow (glowcaps and seed pods in a faint glow of their own); a worn large one shows cracks. */
export function drawBreakables(ctx: CanvasRenderingContext2D, world: World, quiet: boolean): void {
  for (const b of world.breakables) {
    const x = b.x / P;
    const y = b.y / P;
    if (!visible(x, y, 16)) continue;
    const R = Math.round(b.r / P);
    const shadow: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const X = Math.round(x) + dx + 1;
        const Y = Math.round(y + R * 0.7) + dy;
        if ((dx * dx) / (R * R) + dy * dy <= 1 && bayer(X, Y) < 0.5) shadow.push(X, Y);
      }
    }
    pixels(ctx, shadow, PX.ink);
    if (b.look === 'glowcap' || b.look === 'seedpod') {
      pixels(ctx, circlePixels(x, y, R + 2, (X, Y) => bayer(X, Y) < 0.3), b.variant % 2 === 0 ? PX.teal1 : PX.cap1);
    }
    blit(ctx, breakableSprite(b.look, b.flash > 0 && !quiet, b.variant), x, y);
    const wear = 1 - b.hp / b.maxHp;
    if (b.size === 'large' && wear > 0.05) {
      const rng = mulberry32(b.id);
      const crack: number[] = [];
      for (let i = 0; i < Math.ceil(wear * 4); i++) {
        let cx = Math.round(x - 8 + rng() * 16);
        let cy = Math.round(y - 3 + rng() * 6);
        for (let k = 0; k < 4; k++) {
          crack.push(cx, cy);
          cx += rng() < 0.5 ? 1 : -1;
          cy += rng() < 0.6 ? 1 : 0;
        }
      }
      pixels(ctx, crack, PX.ink);
    }
  }
}

const iconSprites = new Map<string, Sprite>();
/** A pickup icon rasterized from its path: solid colour inside a one-pixel ink outline. */
function iconSprite(id: BuffId | 'heal', size: number, color: string): Sprite {
  const key = `${id}:${size}:${color}`;
  let s = iconSprites.get(key);
  if (!s) {
    const mask = createCanvas(size, size);
    const m = mask.getContext('2d')!;
    m.fillStyle = '#fff';
    fillIcon(m, id, size / 2, size / 2, size);
    const alpha = m.getImageData(0, 0, size, size).data;
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && alpha[(y * size + x) * 4 + 3] > 110;
    const out = createCanvas(size + 2, size + 2);
    const g = out.getContext('2d')!;
    for (let y = -1; y <= size; y++) {
      for (let x = -1; x <= size; x++) {
        if (on(x, y)) g.fillStyle = color;
        else if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) g.fillStyle = PX.ink;
        else continue;
        g.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    s = { canvas: out, ox: Math.floor((size + 2) / 2), oy: Math.floor((size + 2) / 2) };
    iconSprites.set(key, s);
  }
  return s;
}

/**
 * Pickups too fine to come out of their path at this size, drawn by hand: two hearts (the HUD's
 * heart, and a bigger one) and the Lodestone's horseshoe magnet with silver poles.
 */
const PICKUP_ROWS: Partial<Record<PickupKind, string[]>> = {
  heal: ['.kk...kk.', 'kwrk.krrk', 'kwrrkrrdk', 'krrrrrrdk', '.krrrrdk.', '..krrdk..', '...kdk...', '....k....'],
  bigHeal: [
    '.kkk...kkk.',
    'kWwrk.krrrk',
    'kwrrrkrrrdk',
    'krrrrrrrrdk',
    'krrrrrrrrdk',
    '.krrrrrrdk.',
    '..krrrrdk..',
    '...krrdk...',
    '....kdk....',
    '.....k.....',
  ],
  lodestone: [
    'kkkk...kkkk',
    'kWWk...kWWk',
    'kssk...kssk',
    'kkkk...kkkk',
    'kLpk...kLdk',
    'kLpk...kLdk',
    'kLpk...kLdk',
    'kLppk.kppdk',
    '.kLpppppdk.',
    '..kkdddkk..',
    '....kkk....',
  ],
};
const PICKUP_COLORS: Record<string, string> = {
  k: PX.ink,
  W: PX.white,
  w: PX.hurt2,
  r: PX.hurt1,
  d: PX.hurt0,
};
const MAGNET_COLORS: Record<string, string> = { k: PX.ink, W: PX.eye, s: PX.golem3, L: PX.xp2, p: PX.xp1, d: PX.xp0 };

function pickupSprite(kind: PickupKind, rows: string[]): Sprite {
  const key = `drawn:${kind}`;
  let s = iconSprites.get(key);
  if (!s) {
    s = gridSprite(rows, kind === 'lodestone' ? MAGNET_COLORS : PICKUP_COLORS);
    iconSprites.set(key, s);
  }
  return s;
}

/** Hearts and buff runes bobbing on the floor, each with a dithered halo. */
export function drawPickups(ctx: CanvasRenderingContext2D, world: World, t: number, quiet: boolean): void {
  for (const p of world.pickups) {
    const x = p.x / P;
    const y = p.y / P + Math.round(Math.sin(p.t * 4));
    if (!visible(x, y, 10)) continue;
    const heal = p.kind === 'heal' || p.kind === 'bigHeal';
    const color = heal ? HEAL_COLOR : BUFF_INFO[p.kind as BuffId].color;
    const size = p.kind === 'bigHeal' ? 11 : heal ? 8 : 9;
    const halo = quiet ? 0.3 : 0.25 + 0.15 * Math.sin(t * 5 + p.id);
    pixels(ctx, circlePixels(x, y, size * 0.75 + 1, (X, Y) => bayer(X, Y) < halo), color);
    const rows = PICKUP_ROWS[p.kind];
    blit(ctx, rows ? pickupSprite(p.kind, rows) : iconSprite(heal ? 'heal' : (p.kind as BuffId), size, color), x, y);
  }
}

// ---------------------------------------------------------------- hazards and the way down

/** A path round one of the map's hazard shapes, in art pixels. */
function hazardPath(ctx: CanvasRenderingContext2D, h: Hazard): void {
  ctx.beginPath();
  if (h.shape === 'circle') ctx.arc(h.x / P, h.y / P, h.r / P, 0, TAU);
  else if (h.shape === 'rect') ctx.rect(h.x0 / P, h.y0 / P, (h.x1 - h.x0) / P, (h.y1 - h.y0) / P);
  else {
    const a = Math.atan2(h.by - h.ay, h.bx - h.ax);
    ctx.arc(h.ax / P, h.ay / P, h.r / P, a + Math.PI / 2, a + Math.PI * 1.5);
    ctx.arc(h.bx / P, h.by / P, h.r / P, a - Math.PI / 2, a + Math.PI / 2);
    ctx.closePath();
  }
}

/**
 * Hazard ground's live touches over the baked floor: lava's breathing heat and popping bubbles,
 * pollen drifting off brambles, and a sheen sweeping over ice with the odd glint. Reduced flashing
 * stills the heat, the twinkle, the sweep and the glints.
 */
export function drawHazards(ctx: CanvasRenderingContext2D, world: World, t: number, quiet: boolean): void {
  if (!world.map.hazardIndex) return;
  world.map.hazards.forEach((h, i) => {
    const b = solidBounds(h);
    const x0 = b.x0 / P;
    const y0 = b.y0 / P;
    const x1 = b.x1 / P;
    const y1 = b.y1 / P;
    if (!visible((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) / 2 + 8)) return;
    const zone = world.map.zones[h.name];
    if (!zone) return;
    if (h.name === 'lava') drawLava(ctx, h, i, zone, x0, y0, x1, y1, t, quiet);
    else if (h.name === 'bramble') drawBrambleLife(ctx, zone, x0, y0, x1, y1, t, quiet);
    else drawIceLife(ctx, h, i, zone, x0, y0, x1, y1, t, quiet);
  });
}

type Zone = NonNullable<World['map']['hazardIndex']>;

/** Lava's live shimmer: a dithered heat that breathes, and bubbles that swell and pop. */
function drawLava(ctx: CanvasRenderingContext2D, h: Hazard, i: number, zone: Zone, x0: number, y0: number, x1: number, y1: number, t: number, quiet: boolean): void {
  if (!quiet) {
    const level = Math.round((0.5 + 0.5 * Math.sin(t * 1.8 + i)) * 2) / 8;
    if (level > 0) {
      hazardPath(ctx, h);
      ctx.fillStyle = ditherPattern(ctx, PX.flame0, level);
      ctx.fill();
    }
  }
  const bubbles: number[] = [];
  const pops: number[] = [];
  for (let gy = Math.floor(y0 / 28); gy <= y1 / 28; gy++) {
    for (let gx = Math.floor(x0 / 28); gx <= x1 / 28; gx++) {
      if (hash2(gx, gy, 960) > 0.35) continue;
      const bx = Math.round((gx + hash2(gx, gy, 961)) * 28);
      const by = Math.round((gy + hash2(gx, gy, 962)) * 28);
      if (!visible(bx, by, 6) || clearanceAt(zone, bx * P, by * P) > -8) continue;
      const phase = (t * 0.6 + hash2(gx, gy, 963)) % 1;
      (phase < 0.75 ? bubbles : pops).push(...circlePixels(bx, by, 1 + phase * 3, phase < 0.75 ? undefined : (X, Y) => bayer(X, Y) < 0.5));
    }
  }
  pixels(ctx, bubbles, PX.flame1);
  pixels(ctx, pops, PX.flame2);
}

/** Pollen drifting up off a bramble patch, the motes twinkling pink (steady with reduced flashing). */
function drawBrambleLife(ctx: CanvasRenderingContext2D, zone: Zone, x0: number, y0: number, x1: number, y1: number, t: number, quiet: boolean): void {
  const dim: number[] = [];
  const bright: number[] = [];
  for (let gy = Math.floor(y0 / 14); gy <= y1 / 14; gy++) {
    for (let gx = Math.floor(x0 / 14); gx <= x1 / 14; gx++) {
      if (hash2(gx, gy, 965) > 0.3) continue;
      const phase = (t * 0.25 + hash2(gx, gy, 966)) % 1;
      const mx = Math.round((gx + hash2(gx, gy, 967)) * 14 + Math.sin(t * 1.3 + gx) * 1.5);
      const my = Math.round((gy + hash2(gx, gy, 968)) * 14 - phase * 10);
      if (!visible(mx, my, 2) || clearanceAt(zone, mx * P, my * P) > -4) continue;
      (!quiet && Math.floor(t * 4 + gx * 3 + gy) % 3 === 0 ? bright : dim).push(mx, my);
    }
  }
  pixels(ctx, dim, PX.thorn2);
  pixels(ctx, bright, PX.spore2);
}

/** Ice's sheen: a bright band sweeping across the sheet now and then, and glints that wink on and off. Both rest with reduced flashing. */
function drawIceLife(ctx: CanvasRenderingContext2D, h: Hazard, i: number, zone: Zone, x0: number, y0: number, x1: number, y1: number, t: number, quiet: boolean): void {
  if (quiet) return;
  const span = x1 - x0 + (y1 - y0);
  const s0 = x0 + y0 - 20 + ((t * 50 + i * 137) % (span + 140));
  if (s0 < x1 + y1) {
    ctx.save();
    hazardPath(ctx, h);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(s0 - y0, y0);
    ctx.lineTo(s0 + 5 - y0, y0);
    ctx.lineTo(s0 + 5 - y1, y1);
    ctx.lineTo(s0 - y1, y1);
    ctx.closePath();
    ctx.fillStyle = ditherPattern(ctx, PX.ice3, 0.5);
    ctx.fill();
    ctx.restore();
  }
  const glints: number[] = [];
  for (let gy = Math.floor(y0 / 24); gy <= y1 / 24; gy++) {
    for (let gx = Math.floor(x0 / 24); gx <= x1 / 24; gx++) {
      if (hash2(gx, gy, 980) > 0.3 || (t * 0.7 + hash2(gx, gy, 981)) % 1 > 0.08) continue;
      const cx = Math.round((gx + hash2(gx, gy, 982)) * 24);
      const cy = Math.round((gy + hash2(gx, gy, 983)) * 24);
      if (!visible(cx, cy, 2) || clearanceAt(zone, cx * P, cy * P) > -6) continue;
      glints.push(cx, cy, cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1);
    }
  }
  pixels(ctx, glints, PX.white);
}

/** A Thornback's trail: thorny stems sprouting where it charged, inside a ragged outline, withering as they go. */
function drawBramblePatch(ctx: CanvasRenderingContext2D, g: GroundFx, x: number, y: number, R: number, fade: number): void {
  const grow = clamp(g.t / 0.2, 0, 1);
  const r = R * (0.5 + 0.5 * grow);
  const k = fade * grow;
  ctx.beginPath();
  ctx.arc(Math.round(x), Math.round(y), r, 0, TAU);
  ctx.fillStyle = ditherPattern(ctx, PX.thorn0, k > 0.5 ? 0.5 : 0.25);
  ctx.fill();
  const rng = mulberry32(Math.floor(g.x * 3 + g.y * 7));
  const stems: number[] = [];
  const tips: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU;
    const b = rng() * TAU;
    const d = rng() * r * 0.6;
    const sx = x + Math.cos(a) * d;
    const sy = y + Math.sin(a) * d;
    const len = r * (0.5 + rng() * 0.5);
    const ex = sx + Math.cos(b) * len;
    const ey = sy + Math.sin(b) * len;
    stems.push(...linePixels(sx, sy, ex, ey, (_, X, Y) => bayer(X, Y) < k + 0.2));
    for (let j = 1; j <= 2; j++) {
      const side = j === 1 ? 1 : -1;
      tips.push(Math.round(sx + ((ex - sx) * j) / 3 - Math.sin(b) * 1.4 * side), Math.round(sy + ((ey - sy) * j) / 3 + Math.cos(b) * 1.4 * side));
    }
  }
  pixels(ctx, circlePixels(x, y, r, (X, Y) => bayer(X, Y) < k * 0.6), PX.thorn1);
  pixels(ctx, stems, PX.thorn2);
  if (k > 0.3) pixels(ctx, tips, PX.thorn3);
}

/** Ice left on the floor (a golem's slam, Rimecoil's rings): a pale sheet with a clear, bright edge and a sheen, melting away. */
function drawIcePatch(ctx: CanvasRenderingContext2D, g: GroundFx, x: number, y: number, R: number, fade: number): void {
  const grow = clamp(g.t / 0.2, 0, 1);
  const r = Math.max(2, Math.round(R * (0.7 + 0.3 * grow)));
  const k = fade * grow;
  withArenaClip(ctx, () => {
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), r, 0, TAU);
    ctx.fillStyle = ditherPattern(ctx, PX.ice1, k > 0.5 ? 0.5 : 0.25);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), r * 0.7, 0, TAU);
    ctx.fillStyle = ditherPattern(ctx, PX.ice2, k > 0.5 ? 0.25 : 0.07);
    ctx.fill();
  });
  pixels(ctx, circlePixels(x, y, r + 1, (X, Y) => inArena(X, Y) && bayer(X, Y) < k), PX.ice0);
  pixels(ctx, circlePixels(x, y, r, (X, Y) => inArena(X, Y) && bayer(X, Y) < k + 0.3), PX.ice3);
  if (k > 0.3) {
    pixels(ctx, linePixels(x - r * 0.5, y - r * 0.1, x - r * 0.1, y - r * 0.5, (_, X, Y) => inArena(X, Y)), PX.ice3);
    const rng = mulberry32(Math.floor(g.x * 5 + g.y * 11));
    const cracks: number[] = [];
    for (let i = 0; i < 2; i++) {
      const a = rng() * TAU;
      cracks.push(...linePixels(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15, x + Math.cos(a + 0.3) * r * 0.75, y + Math.sin(a + 0.3) * r * 0.75, (_, X, Y) => inArena(X, Y)));
    }
    pixels(ctx, cracks, PX.ice0);
  }
}

/** Ground left behind: burning ground flickers, lava trails glow and crust over, brambles wither and ice melts, each fading in and out. */
export function drawGroundFx(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  for (const g of world.groundFx) {
    const x = g.x / P;
    const y = g.y / P;
    const R = g.r / P;
    if (!visible(x, y, R + 4)) continue;
    const fade = clamp((g.life - g.t) / (g.life * 0.35), 0, 1);
    if (g.kind === 'bramble') {
      drawBramblePatch(ctx, g, x, y, R, fade);
      continue;
    }
    if (g.kind === 'ice') {
      drawIcePatch(ctx, g, x, y, R, fade);
      continue;
    }
    if (g.kind === 'lava') {
      disc(ctx, x, y, Math.round(R + 1), '#2a0a04');
      disc(ctx, x, y, Math.round(R), fade > 0.5 ? '#d8461c' : '#7a1e0c');
      if (fade > 0.3) disc(ctx, x, y, Math.round(R * 0.5), PX.flame0);
      continue;
    }
    ctx.beginPath();
    ctx.arc(Math.round(x), Math.round(y), R, 0, TAU);
    ctx.fillStyle = ditherPattern(ctx, PX.hostile2, fade > 0.6 ? 0.5 : fade > 0.25 ? 0.25 : 0.125);
    ctx.fill();
    if (fade > 0.25) {
      const frame = Math.floor(t * 10 + g.x) % FLAME_FRAMES;
      blit(ctx, flame(frame), x - R * 0.3, y - 2);
      if (R > 8) blit(ctx, flame((frame + 2) % FLAME_FRAMES), x + R * 0.35, y + 1);
    }
  }
}

/**
 * Each blast's own small mark inside its circle, so the kinds tell apart: a meteor's crosshair,
 * a spore puff's dotted ring, an icicle's frost star, a slam's ring of teeth, a burrower's cracks.
 */
function blastMark(ctx: CanvasRenderingContext2D, b: Blast, x: number, y: number, R: number, k: number, hot: boolean, t: number, quiet: boolean): void {
  const color = hot ? PX.hostile3 : PX.tele;
  switch (b.look) {
    case 'meteor': {
      const c = Math.round(R * 0.4);
      pixels(ctx, [...linePixels(x - c, y, x + c, y), ...linePixels(x, y - c, x, y + c)], color);
      break;
    }
    case 'spores': {
      pixels(ctx, circlePixels(x, y, R * 0.55, (X, Y) => (X + Y) % 3 === 0 && inArena(X, Y)), PX.spore1);
      const spin = quiet ? 0 : t * 0.8;
      for (let i = 0; i < 5; i++) {
        const a = spin + (i / 5) * TAU;
        px(ctx, x + Math.cos(a) * R * 0.3 - 0.5, y + Math.sin(a) * R * 0.3 - 0.5, PX.spore2, 2, 2);
      }
      break;
    }
    case 'icicle': {
      const c = Math.max(2, Math.round(R * 0.35));
      const star: number[] = [];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI + Math.PI / 6;
        star.push(...linePixels(x - Math.cos(a) * c, y - Math.sin(a) * c, x + Math.cos(a) * c, y + Math.sin(a) * c));
      }
      pixels(ctx, star, hot ? PX.white : PX.ice2);
      break;
    }
    case 'slam': {
      const teeth: number[] = [];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        teeth.push(...linePixels(x + Math.cos(a) * (R - 1), y + Math.sin(a) * (R - 1), x + Math.cos(a) * (R - 4), y + Math.sin(a) * (R - 4), (_, X, Y) => inArena(X, Y)));
      }
      pixels(ctx, circlePixels(x, y, R - 2, (X, Y) => inArena(X, Y) && bayer(X, Y) < 0.5), PX.ice2);
      pixels(ctx, teeth, color);
      break;
    }
    case 'burrow': {
      // The ground splitting as something comes up: cracks reaching out as the circle fills.
      const rng = mulberry32(Math.floor(b.x * 5 + b.y * 3));
      const dark: number[] = [];
      const lit: number[] = [];
      for (let i = 0; i < 5; i++) {
        let a = rng() * TAU;
        let cx = x;
        let cy = y;
        const step = (R * (0.3 + 0.5 * k)) / 3;
        for (let s = 0; s < 3; s++) {
          a += (rng() - 0.5) * 0.9;
          const nx = cx + Math.cos(a) * step;
          const ny = cy + Math.sin(a) * step;
          dark.push(...linePixels(cx, cy, nx, ny, (_, X, Y) => inArena(X, Y)));
          lit.push(...linePixels(cx - 1, cy - 1, nx - 1, ny - 1, (_, X, Y) => inArena(X, Y)));
          cx = nx;
          cy = ny;
        }
      }
      pixels(ctx, lit, PX.dirt3);
      pixels(ctx, dark, PX.dirt0);
      break;
    }
  }
}

/**
 * The circles marked where blasts will land, filling as they near (a golem's slam closes in from
 * its rim, as a ring); with safe warnings, hazard stripes inside a yellow, dark-cased ring. The
 * ring blinks near the end unless flashing is reduced, when it simply turns bright.
 */
export function drawBlastMarks(ctx: CanvasRenderingContext2D, world: World, t: number, safe: boolean, quiet = false): void {
  for (const b of world.blasts) {
    const x = b.x / P;
    const y = b.y / P;
    const R = b.r / P;
    if (!visible(x, y, R + 4)) continue;
    const k = blastProgress(b);
    withArenaClip(ctx, () => {
      ctx.beginPath();
      ctx.arc(Math.round(x), Math.round(y), R, 0, TAU);
      ctx.fillStyle = ditherPattern(ctx, safe ? PX.warn0 : PX.teleDim, 0.25);
      ctx.fill();
      ctx.beginPath();
      if (b.look === 'slam') {
        ctx.arc(Math.round(x), Math.round(y), R, 0, TAU);
        ctx.arc(Math.round(x), Math.round(y), Math.max(0, R * (1 - k)), 0, TAU, true);
      } else {
        ctx.arc(Math.round(x), Math.round(y), Math.max(1, R * k), 0, TAU);
      }
      ctx.fillStyle = safe ? hazardStripes(ctx) : ditherPattern(ctx, PX.tele, 0.5);
      ctx.fill();
    });
    if (safe) {
      pixels(ctx, [...circlePixels(x, y, R - 1), ...circlePixels(x, y, R + 1)], PX.warn0);
      pixels(ctx, circlePixels(x, y, R), k > 0.6 ? PX.warn3 : PX.warn2);
      continue;
    }
    const hot = k > 0.7 && (quiet || Math.floor(t * 16) % 2 === 0);
    pixels(ctx, circlePixels(x, y, R), hot ? PX.hostile3 : PX.tele);
    blastMark(ctx, b, x, y, R, k, hot, t, quiet);
  }
}

/** Where a blast's falling thing is: a lobbed fireball or a meteor (as both styles have them), or an icicle dropping from the ceiling over the last 40% of its wait. */
function inFlight(b: Blast): { x: number; y: number; height: number } | null {
  const f = blastInFlight(b);
  if (f || b.look !== 'icicle') return f;
  const k = blastProgress(b);
  return k > 0.6 ? { x: b.x, y: b.y, height: (1 - (k - 0.6) / 0.4) * 320 } : null;
}

/** Just before a spore vent or a burrower goes off: spores lifting out of the ground, or clods of earth jumping. */
function drawBlastStir(ctx: CanvasRenderingContext2D, b: Blast, t: number): void {
  const k = blastProgress(b);
  if (k < 0.55) return;
  const x = b.x / P;
  const y = b.y / P;
  const R = b.r / P;
  if (!visible(x, y, R + 4)) return;
  const s = (k - 0.55) / 0.45;
  const spores = b.look === 'spores';
  const rng = mulberry32(Math.floor(b.x * 13 + b.y * 7));
  const dim: number[] = [];
  const bright: number[] = [];
  for (let i = 0; i < (spores ? 10 : 8); i++) {
    const a = rng() * TAU;
    const d = Math.sqrt(rng()) * R * 0.8;
    const ph = rng();
    const bx = Math.round(x + Math.cos(a) * d);
    const by = Math.round(y + Math.sin(a) * d - (spores ? ((s * 2 + ph) % 1) * 8 * s : Math.abs(Math.sin(t * 9 + ph * 6)) * 3 * s));
    if (inArena(bx, by)) (i % 2 === 0 ? dim : bright).push(bx, by);
  }
  pixels(ctx, dim, spores ? PX.spore1 : PX.dirt2);
  pixels(ctx, bright, spores ? PX.spore2 : PX.dirt3);
}

/** Fireballs arcing to their circles, meteors and icicles falling into theirs (each over its shadow), and the stir before a spore puff or an eruption. */
export function drawBlastsInFlight(ctx: CanvasRenderingContext2D, world: World): void {
  for (const b of world.blasts) {
    if (b.look === 'spores' || b.look === 'burrow') {
      drawBlastStir(ctx, b, world.time);
      continue;
    }
    const f = inFlight(b);
    if (!f) continue;
    const x = f.x / P;
    const gy = f.y / P;
    const y = (f.y - f.height) / P;
    if (!visible(x, y, 12)) continue;
    if (b.look === 'icicle') {
      // Point down, with streaks above it, over a shadow that sharpens as it nears.
      pixels(ctx, circlePixels(x, gy, Math.max(1, 4 - f.height / 100), (X, Y) => bayer(X, Y) < 0.5), PX.ink);
      pixels(ctx, [...linePixels(x - 3, y - 26, x - 3, y - 14, (i) => i % 3 === 0), ...linePixels(x + 3, y - 22, x + 3, y - 12, (i) => i % 3 === 0)], PX.ice2);
      blit(ctx, icicleShot(4, directionIndex(Math.PI / 2)), x, y);
      continue;
    }
    const meteor = b.look === 'meteor';
    const r = meteor ? 5 : 3;
    pixels(ctx, circlePixels(x, gy, Math.max(1, r - f.height / 200), (X, Y) => bayer(X, Y) < 0.5), PX.ink);
    if (meteor) pixels(ctx, linePixels(x, y, x + 10, y - 40, (i) => i % 2 === 0), PX.hostile2);
    pixels(ctx, circlePixels(x, y, r + 2, (X, Y) => bayer(X, Y) < 0.5), PX.hostile2);
    disc(ctx, x, y, r, meteor ? '#3a1a12' : PX.flame0);
    disc(ctx, x - 1, y - 1, Math.max(1, r - 3), meteor ? PX.flame0 : PX.flame2);
  }
}

/** The way down: a dark vortex with turning rings; a ring round it counts down to its pull. */
/** The map's sites in pixels: a shrine, a rift, a cursed chest and a merchant's stall. */
export function drawSites(ctx: CanvasRenderingContext2D, world: World, t: number, quiet: boolean): void {
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const box = (x: number, y: number, w: number, h: number, color: string) => {
    rect(x - 1, y - 1, w + 2, h + 2, PX.ink);
    rect(x, y, w, h, color);
  };
  for (const s of world.sites) {
    const x = Math.round(s.x / P);
    const y = Math.round(s.y / P);
    if (!visible(x, y, 30)) continue;
    const color = SITE_INFO[s.kind].color;
    const live = !s.spent;
    if (live) {
      const R = SITES.radius / P;
      const spin = quiet ? 0 : t * 0.9;
      pixels(ctx, circlePixels(x, y, R, (X, Y) => Math.floor((((Math.atan2(Y - y, X - x) + spin) % TAU) + TAU) / (TAU / 16)) % 2 === 0), color);
      pixels(ctx, circlePixels(x, y, R * 1.6, (X, Y) => bayer(X, Y) < (quiet ? 0.12 : 0.1 + 0.05 * Math.sin(t * 3 + s.id))), color);
    }
    if (s.kind === 'shrine') {
      box(x - 10, y - 3, 20, 10, '#4a4458');
      box(x - 7, y - 9, 14, 6, '#5c566c');
      rect(x - 2, y - 1, 4, 3, live ? color : '#3a3046');
      if (live) rect(x - 1, y - 13 - (quiet ? 0 : Math.round(Math.sin(t * 9))), 2, 3, PX.flame1);
    } else if (s.kind === 'rift') {
      if (live || world.rift?.siteId === s.id) {
        pixels(ctx, circlePixels(x, y, 9, (X, Y) => ((X - x) / 8) ** 2 + ((Y - y) / 15) ** 2 <= 1), '#0a0414');
        const k = quiet ? 0 : Math.floor(t * 8);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + k * 0.4;
          px(ctx, x + Math.cos(a) * 9, y + Math.sin(a) * 16, i % 3 === 0 ? PX.white : color);
        }
      } else {
        for (let i = -12; i <= 12; i++) px(ctx, x + Math.round(Math.sin(i * 0.5) * 2), y + i, '#2a1a40');
      }
    } else if (s.kind === 'chest') {
      box(x - 9, y - 2, 18, 10, '#2a1a2e');
      if (live) {
        box(x - 9, y - 8, 18, 6, '#3a2440');
        rect(x - 9, y - 6, 18, 1, color);
        rect(x - 1, y - 4, 3, 4, PX.gold1);
      } else box(x - 9, y - 12, 18, 4, '#1a0e1e');
    } else {
      rect(x - 12, y - 12, 2, 18, '#2a1a10');
      rect(x + 10, y - 12, 2, 18, '#2a1a10');
      for (let i = 0; i < 4; i++) rect(x - 13 + i * 6, y - 15, 6, 4, i % 2 === 0 ? '#7a3aa8' : PX.gold1);
      pixels(ctx, circlePixels(x, y, 6, (X, Y) => Y >= y - 6 + Math.abs(X - x) * 2 - 6 && Y <= y + 6), '#3a1a5a');
      rect(x - 2, y - 3, 1, 1, PX.gold3);
      rect(x + 1, y - 3, 1, 1, PX.gold3);
      disc(ctx, x + 9, y - 7, quiet ? 2 : 2 + Math.round(Math.sin(t * 5) * 0.5), PX.gold1);
    }
  }
}

/** The Ascendant rising: the four Archmages' colours circling in on a widening crack. */
export function drawFinale(ctx: CanvasRenderingContext2D, world: World, t: number, quiet: boolean): void {
  const f = world.finale;
  if (!f || f.stage !== 'rising') return;
  const x = f.x / P;
  const y = f.y / P;
  const k = clamp(f.t / FINALE.rise, 0, 1);
  if (!visible(x, y, 110)) return;
  const colors = [PX.gold1, PX.cap3, PX.ice3, PX.flame1];
  colors.forEach((color, i) => {
    const a = (quiet ? t * 0.6 : t * 2.2) + (i / 4) * TAU;
    const d = (30 + (1 - k) * 230) / P;
    const cx = x + Math.cos(a) * d;
    const cy = y + Math.sin(a) * d;
    pixels(ctx, circlePixels(cx, cy, 5 + 4 * k, (X, Y) => bayer(X, Y) < 0.6), color);
    disc(ctx, cx, cy, 2 + Math.round(2 * k), color);
  });
  pixels(ctx, circlePixels(x, y, (40 + 60 * k) / P, (X, Y) => bayer(X, Y) < 0.15 + 0.35 * k), PX.white);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.4;
    const len = ((40 + 70 * hash2(i, 9)) * (0.3 + k)) / P;
    for (let s = 0; s <= len; s++) px(ctx, x + Math.cos(a) * s, y + Math.sin(a) * s, '#05010a');
  }
  disc(ctx, x, y, Math.round((14 + 26 * k) / P), '#05010a');
}

export function drawDescent(ctx: CanvasRenderingContext2D, world: World, t: number, quiet: boolean): void {
  const d = world.descent;
  if (!d) return;
  const x = d.x / P;
  const y = d.y / P;
  const R = (DESCENT.radius * (0.4 + 0.8 * clamp(d.t / 0.6, 0, 1))) / P;
  if (!visible(x, y, R + 6)) return;
  pixels(ctx, circlePixels(x, y, R + 4, (X, Y) => bayer(X, Y) < 0.5), PX.purple2);
  disc(ctx, x, y, Math.round(R), '#05010a');
  pixels(ctx, circlePixels(x, y, R), PX.purple3);
  const spin = quiet ? t * 0.8 : t * 2.4;
  for (const [rr, color] of [
    [R * 0.7, PX.gold1],
    [R * 0.45, PX.cyan2],
  ] as const) {
    pixels(
      ctx,
      circlePixels(x, y, rr, (X, Y) => Math.floor((((Math.atan2(Y - y, X - x) + spin) % TAU) + TAU) / (TAU / 6)) % 2 === 0),
      color,
    );
  }
  const k = clamp(d.t / DESCENT.pullAfter, 0, 1);
  pixels(
    ctx,
    circlePixels(x, y, R + 7, (X, Y) => (((Math.atan2(Y - y, X - x) + Math.PI / 2) % TAU) + TAU) % TAU <= k * TAU),
    PX.white,
  );
}
