import { ENEMIES, PIXEL_ART, SNAKE } from '../config';
import { clamp, mulberry32, TAU, type Vec } from '../math';
import { PLAY_AREA } from '../snake';
import type { Enemy, GestureView, World } from '../world';
import { bayer, blit, createCanvas } from './bake';
import type { PixelFloor } from './floor';
import { PX } from './palette';
import {
  boltHead,
  brute,
  caster,
  CHASER_FRAMES,
  chaser,
  crystal,
  directionIndex,
  exclaim,
  flame,
  FLAME_FRAMES,
  RETICLE_FRAMES,
  reticle,
  segmentFill,
  segmentOutline,
  SHOT_FRAMES,
  shot,
  wizardHead,
  type SegmentStyle,
} from './sprites';

// Everything here draws on a low-res canvas with an identity transform: 1 unit = 1 art pixel.
const P = PIXEL_ART.worldPerPixel;
const MIN_X = Math.ceil(PLAY_AREA.minX / P);
const MIN_Y = Math.ceil(PLAY_AREA.minY / P);
const MAX_X = Math.floor(PLAY_AREA.maxX / P);
const MAX_Y = Math.floor(PLAY_AREA.maxY / P);

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

function withArenaClip(ctx: CanvasRenderingContext2D, draw: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(MIN_X, MIN_Y, MAX_X - MIN_X + 1, MAX_Y - MIN_Y + 1);
  ctx.clip();
  draw();
  ctx.restore();
}

// ---------------------------------------------------------------- scenery

export function drawTorches(ctx: CanvasRenderingContext2D, floor: PixelFloor, t: number): void {
  floor.torches.forEach((torch, i) => {
    const frame = Math.floor(t * 9 + i * 1.7) % FLAME_FRAMES;
    blit(ctx, flame(frame), torch.x, torch.y);
  });
}

export function drawPortals(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  for (const p of world.portals) {
    const k = clamp(p.t / p.duration, 0, 1);
    const big = p.kind === 'boss' ? 2.6 : p.kind === 'brute' ? 1.4 : 1;
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

/** Oriented charge lane: solid border, dithered fill that grows with the telegraph, chevrons. */
function lane(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, L: number, hw: number, k: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const fillTo = L * k;
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
    ctx.fillStyle = ditherPattern(ctx, PX.teleDim, 0.13);
    ctx.fill();
    if (fillTo > 0) {
      quad(0, fillTo);
      ctx.fillStyle = ditherPattern(ctx, PX.teleDim, 0.5);
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
  pixels(ctx, border, k > 0.5 ? PX.tele : PX.teleDim);
  // Chevrons pointing along the charge.
  const lit: number[] = [];
  const dim: number[] = [];
  for (let u0 = 8; u0 < L - 4; u0 += 14) {
    const target = u0 <= fillTo ? lit : dim;
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
  pixels(ctx, dim, PX.teleDim);
  pixels(ctx, lit, PX.hostile3);
}

export function drawTelegraphs(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.enemies) {
    if (e.dead || e.state !== 'windup') continue;
    const x = e.x / P;
    const y = e.y / P;
    if (e.kind === 'caster') {
      const k = clamp(e.stateTime / ENEMIES.caster.telegraph, 0, 1);
      const L = 260 / P;
      const off = Math.floor(e.stateTime * 20);
      pixels(
        ctx,
        linePixels(x, y, x + Math.cos(e.aim) * L, y + Math.sin(e.aim) * L, (i, X, Y) => i > 4 && (i + off) % 6 < 3 && inArena(X, Y)),
        k > 0.7 ? PX.hostile3 : k > 0.35 ? PX.tele : PX.teleDim,
      );
    } else if (e.kind === 'brute' || e.kind === 'rival' || (e.kind === 'boss' && e.bossMove === 'charge')) {
      const len =
        e.kind === 'brute'
          ? ENEMIES.brute.chargeSpeed * ENEMIES.brute.chargeTime
          : e.kind === 'rival'
            ? ENEMIES.rival.lungeSpeed * ENEMIES.rival.lungeTime
            : ENEMIES.boss.chargeSpeed * ENEMIES.boss.chargeTime;
      const tele = e.kind === 'brute' ? ENEMIES.brute.telegraph : e.kind === 'rival' ? ENEMIES.rival.telegraph : ENEMIES.boss.chargeTelegraph;
      lane(ctx, x, y, e.aim, (len + e.r) / P, (e.r * 1.1) / P, clamp(e.stateTime / tele, 0, 1));
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

function drawChaser(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const frame = ((Math.floor(time * 8 + e.wobble * 3) % CHASER_FRAMES) + CHASER_FRAMES) % CHASER_FRAMES;
  const flash = e.flash > 0;
  const bx = Math.round(e.x / P);
  const by = Math.round(e.y / P);
  blit(ctx, chaser(frame, flash), bx, by);
  if (flash) return;
  // Glowing eyes shift a pixel toward where it is heading.
  const ox = Math.round(Math.cos(e.heading) * 1.4);
  const oy = Math.round(Math.sin(e.heading) * 1.4);
  for (const ex of [bx - 2 + ox, bx + 1 + ox]) {
    px(ctx, ex, by - 1 + oy, PX.amberHi);
    px(ctx, ex, by + oy, PX.amber);
  }
}

function drawCaster(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const R = e.r / P;
  const x = e.x / P;
  const y = e.y / P;
  const flash = e.flash > 0;
  blit(ctx, caster(directionIndex(e.heading), flash), x, y);
  if (!flash) eyesAt(ctx, x + Math.cos(e.heading) * R * 0.3, y + Math.sin(e.heading) * R * 0.3, e.heading, 1.4, Math.PI / 2, 1, PX.amber, PX.amber);
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

function drawBrute(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const R = e.r / P;
  const shakeX = e.state === 'windup' ? (Math.floor(time * 30) % 2 === 0 ? 1 : -1) : 0;
  const x = e.x / P + shakeX;
  const y = e.y / P;
  const flash = e.flash > 0;
  const hot = e.state === 'windup' || e.state === 'attack';
  blit(ctx, brute(directionIndex(e.heading), hot, flash), x, y);
  if (!flash) eyesAt(ctx, x, y, e.heading, R * 0.5, 0.6, 2, hot ? PX.crackHot : PX.amber, PX.amberHi);
  if (e.state === 'windup') blit(ctx, exclaim(), x, y - R - 8);
  if (e.state === 'recover') {
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i / 3) * TAU;
      px(ctx, x + Math.cos(a) * 6, y - R - 3 + Math.sin(a) * 2, PX.crackHot);
    }
  }
}

function drawEnemySnake(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const boss = e.kind === 'boss';
  const flash = e.flash > 0;
  const segs = e.segments;
  const n = segs.length;
  const radii = segs.map((_, i) => Math.max(2, Math.round((e.segRadius * (1 - (i / n) * 0.45)) / P)));
  const x = e.x / P;
  const y = e.y / P;
  const R = e.r / P;
  if (boss && e.enraged && !flash) {
    // Pulsing dithered aura.
    const pulse = 0.35 + 0.25 * Math.sin(time * 8);
    for (let ring = 0; ring < 3; ring++) {
      pixels(ctx, circlePixels(x, y, R * 1.9 + ring * 2, (X, Y) => bayer(X, Y) < pulse - ring * 0.1), PX.enrage);
    }
  }
  for (let i = n - 1; i >= 0; i--) blit(ctx, segmentOutline(radii[i]), segs[i].x / P, segs[i].y / P);
  for (let i = n - 1; i >= 0; i--) {
    const style: SegmentStyle = flash ? 'flash' : boss ? (i % 2 === 0 ? 'bossSpot' : 'boss') : i % 3 === 0 ? 'rivalStripe' : 'rival';
    blit(ctx, segmentFill(radii[i], style), segs[i].x / P, segs[i].y / P);
  }
  const sway = clamp(Math.round(Math.sin(time * 3.2 + e.wobble) * 1.3), -1, 1);
  if (e.state === 'windup' && Math.floor(time * 12) % 2 === 0) {
    pixels(ctx, circlePixels(x, y, R + 3, (X, Y) => bayer(X, Y) < 0.5), PX.hostile2);
  }
  blit(ctx, wizardHead(boss ? 'boss' : 'rival', directionIndex(e.heading), sway, flash ? 'flash' : 'normal'), x, y);
  if (!flash) {
    eyesAt(ctx, x, y, e.heading, R * 0.55, 0.6, boss ? 3 : 2, boss ? PX.gold1 : PX.amber, boss ? PX.gold3 : PX.amberHi);
  }
}

export function drawEnemies(ctx: CanvasRenderingContext2D, world: World): void {
  for (const e of world.enemies) {
    switch (e.kind) {
      case 'chaser':
        drawChaser(ctx, e, world.time);
        break;
      case 'caster':
        drawCaster(ctx, e);
        break;
      case 'brute':
        drawBrute(ctx, e, world.time);
        break;
      case 'rival':
      case 'boss':
        drawEnemySnake(ctx, e, world.time);
        break;
    }
    drawEnemyStatus(ctx, e, world.time);
    if (e.kind !== 'chaser' && e.kind !== 'boss' && e.hp < e.maxHp) hpBar(ctx, e, e.x / P, (e.y - e.r) / P - 6);
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
export function drawWard(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  const w = world.ward;
  if (!w) return;
  const s = world.snake;
  if (w.duration - w.t < 1.5 && Math.floor(t * 10) % 2 === 0) return;
  const x = s.x / P;
  const y = s.y / P;
  const R = (SNAKE.headRadius * 2.3) / P;
  pixels(ctx, circlePixels(x, y, R, (X, Y) => bayer(X, Y) < 0.55 + 0.45 * w.flash), PX.ward1);
  if (w.flash > 0.2) pixels(ctx, circlePixels(x, y, R + 2, (X, Y) => bayer(X, Y) < w.flash * 0.6), PX.ward2);
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

export function drawSerpent(ctx: CanvasRenderingContext2D, world: World, gesture: GestureView, t: number): void {
  const s = world.snake;
  // Classic pixel-game invulnerability: the sprite flickers instead of fading.
  if (world.invuln > 0 && world.time > 1.6 && Math.floor(world.invuln * 14) % 2 === 0) return;
  const hurt = world.hurtFlash > 0.6;
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

export function drawArcs(ctx: CanvasRenderingContext2D, world: World, t: number): void {
  for (const arc of world.arcs) {
    const k = arc.life / arc.maxLife;
    const rng = mulberry32(Math.floor(arc.seed + t * 30));
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
    if (k > 0.4 && !arc.fizzle) {
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

export function drawShots(ctx: CanvasRenderingContext2D, world: World): void {
  for (const p of world.shots) {
    const r = Math.max(2, Math.round(p.r / P));
    const frame = Math.floor(p.spin) % SHOT_FRAMES;
    blit(ctx, shot(r, frame), p.x / P, p.y / P);
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, world: World): void {
  for (const p of world.particles) {
    const k = p.life / p.max;
    const x = Math.round(p.x / P);
    const y = Math.round(p.y / P);
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
