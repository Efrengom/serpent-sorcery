import { addShape, solidPath } from './classicFloor';
import { DESCENT } from './config';
import { hash2 } from './hash';
import type { Hazard } from './maps/types';
import { clearanceAt, solidBounds } from './terrain';
import { clamp, mulberry32, TAU } from './math';
import { COLORS } from './palette';
import { blastInFlight, blastProgress } from './telegraph';
import type { Blast, GroundFx, World } from './world';

/**
 * The classic look of hazards: the live touches on lava, ice and brambles, burning ground and
 * the trails and patches foes leave, the circles blasts will land in, fireballs, meteors and
 * icicles in flight, and the way down after a boss.
 */

type Near = (x: number, y: number, margin: number) => boolean;
type Glow = (color: string, x: number, y: number, radius: number, alpha?: number) => void;
type Bounds = { x0: number; y0: number; x1: number; y1: number };

/**
 * Live touches on the hazard ground baked into the floor: a slow pulse of heat over lava with
 * bubbles that swell and pop, a sheen sweeping across ice with the odd glint, and thorn tips
 * glinting in the brambles. Reduced flashing holds the sheen still and the glints steady.
 */
export function drawHazardShimmer(ctx: CanvasRenderingContext2D, world: World, t: number, near: Near, glow: Glow, quiet: boolean): void {
  const hazards = world.map.hazards;
  if (hazards.length === 0) return;
  // The zones in view, by kind; touching and overlapping zones are treated as one sheet.
  const groups: Record<Hazard['name'], Hazard[]> = { lava: [], bramble: [], ice: [] };
  hazards.forEach((h, i) => {
    const b = solidBounds(h);
    if (!near((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2 + 40)) return;
    groups[h.name].push(h);
    if (h.name === 'lava') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,140,60,${0.07 + (quiet ? 0 : 0.05 * Math.sin(t * 1.8 + i))})`;
      solidPath(ctx, h);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  });
  if (groups.lava.length) drawLavaBubbles(ctx, world, groups.lava, t, near);
  if (groups.ice.length) drawIceSheen(ctx, world, groups.ice, t, near, quiet);
  if (groups.bramble.length) drawBrambleGlints(ctx, world, groups.bramble, t, near, glow, quiet);
}

/** The bounds round a set of shapes. */
function boundsOf(list: Hazard[]): Bounds {
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const h of list) {
    const b = solidBounds(h);
    out.x0 = Math.min(out.x0, b.x0);
    out.y0 = Math.min(out.y0, b.y0);
    out.x1 = Math.max(out.x1, b.x1);
    out.y1 = Math.max(out.y1, b.y1);
  }
  return out;
}

/** Sites on a world lattice well inside one kind of hazard ground near the view (each once), with a phase (0..1) each. */
function eachSite(world: World, list: Hazard[], cell: number, salt: number, density: number, near: Near, fn: (x: number, y: number, phase: number) => void): void {
  const zone = world.map.zones[list[0].name];
  if (!zone) return;
  const seen = new Set<number>();
  for (const h of list) {
    const b = solidBounds(h);
    for (let y = Math.floor(b.y0 / cell); y <= b.y1 / cell; y++) {
      for (let x = Math.floor(b.x0 / cell); x <= b.x1 / cell; x++) {
        if (hash2(x, y, salt) > density || seen.has(x * 65536 + y)) continue;
        seen.add(x * 65536 + y);
        const sx = (x + hash2(x, y, salt + 1)) * cell;
        const sy = (y + hash2(x, y, salt + 2)) * cell;
        if (!near(sx, sy, 20) || clearanceAt(zone, sx, sy) > -8) continue;
        fn(sx, sy, hash2(x, y, salt + 3));
      }
    }
  }
}

/** Bubbles that swell and pop across the lava. */
function drawLavaBubbles(ctx: CanvasRenderingContext2D, world: World, list: Hazard[], t: number, near: Near): void {
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 2;
  eachSite(world, list, 70, 960, 0.35, near, (bx, by, ph) => {
    const phase = (t * 0.6 + ph) % 1;
    ctx.strokeStyle = `rgba(255,214,140,${0.55 * (1 - phase)})`;
    ctx.beginPath();
    ctx.arc(bx, by, 3 + phase * 9, 0, TAU);
    ctx.stroke();
  });
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Bands of light sweeping slowly across the ice, in world space so they run on unbroken over
 * neighbouring sheets (held still and dimmer with reduced flashing), and glints that come and go.
 */
function drawIceSheen(ctx: CanvasRenderingContext2D, world: World, list: Hazard[], t: number, near: Near, quiet: boolean): void {
  const b = boundsOf(list);
  ctx.save();
  ctx.beginPath();
  for (const h of list) addShape(ctx, h);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  // Bands lie along lines x + y = c, one every `period`, drifting down and to the right.
  const u = Math.SQRT1_2;
  const period = 900;
  const off = quiet ? 300 : (t * 90) % period;
  const lo = b.x0 + b.y0 - 240;
  const hi = b.x1 + b.y1 + 240;
  for (let c = Math.floor((lo - off) / period) * period + off; c <= hi; c += period) {
    if (c < lo) continue;
    const m = c / 2;
    const band = ctx.createLinearGradient(m - 80 * u, m - 80 * u, m + 80 * u, m + 80 * u);
    band.addColorStop(0, 'rgba(200,235,255,0)');
    band.addColorStop(0.5, `rgba(200,235,255,${quiet ? 0.12 : 0.2})`);
    band.addColorStop(1, 'rgba(200,235,255,0)');
    ctx.fillStyle = band;
    ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  }
  ctx.restore();
  if (quiet) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.5;
  eachSite(world, list, 90, 965, 0.4, near, (x, y, ph) => {
    const k = Math.pow(Math.max(0, Math.sin(t * 1.7 + ph * TAU)), 6);
    if (k < 0.05) return;
    const r = 2 + 5 * k;
    ctx.globalAlpha = k;
    ctx.beginPath();
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Thorn tips glinting magenta in the brambles: slowly breathing, or steady with reduced flashing. */
function drawBrambleGlints(ctx: CanvasRenderingContext2D, world: World, list: Hazard[], t: number, near: Near, glow: Glow, quiet: boolean): void {
  ctx.globalCompositeOperation = 'lighter';
  eachSite(world, list, 46, 968, 0.5, near, (x, y, ph) => {
    const a = quiet ? 0.3 : 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.6 + ph * TAU));
    glow('#ff6ad8', x, y, 9, a);
  });
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Burning ground flickers; lava trails glow and crust over as they cool; bramble trails and ice
 * patches lie on the floor like the map's own brambles and ice. All fade in and out.
 */
export function drawGroundFx(ctx: CanvasRenderingContext2D, world: World, t: number, near: Near, glow: Glow): void {
  for (const g of world.groundFx) {
    if (!near(g.x, g.y, g.r + 20)) continue;
    const left = g.life - g.t;
    const a = clamp(left / (g.life * 0.35), 0, 1) * clamp(g.t / 0.15, 0, 1);
    if (g.kind === 'lava') {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#2a0a04';
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r + 3, 0, TAU);
      ctx.fill();
      const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r);
      grad.addColorStop(0, '#ffb35c');
      grad.addColorStop(0.6, '#d8461c');
      grad.addColorStop(1, '#7a1e0c');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (g.kind === 'bramble') {
      drawBramblePatch(ctx, g, a);
    } else if (g.kind === 'ice') {
      drawIcePatch(ctx, g, a);
    } else {
      ctx.globalCompositeOperation = 'lighter';
      glow('#ff7a2a', g.x, g.y, g.r * 1.5, 0.55 * a);
      ctx.globalCompositeOperation = 'source-over';
      // Three tongues of flame licking upward.
      for (let i = 0; i < 3; i++) {
        const ph = (t * 2.2 + i / 3 + g.x * 0.013) % 1;
        const fx = g.x + Math.sin(i * 2.1 + g.y) * g.r * 0.5;
        const fy = g.y + g.r * 0.3 - ph * g.r * 0.9;
        ctx.globalAlpha = a * (1 - ph);
        ctx.fillStyle = i === 1 ? '#ffd36b' : '#ff8a3c';
        ctx.beginPath();
        ctx.ellipse(fx, fy, g.r * 0.22 * (1 - ph * 0.5), g.r * 0.38 * (1 - ph * 0.5), 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** A clump of thorny canes torn up by a Thornback: a dark tangle inside a bright magenta ring. */
function drawBramblePatch(ctx: CanvasRenderingContext2D, g: GroundFx, a: number): void {
  ctx.globalAlpha = a;
  for (const [color, grow] of [
    ['#0a0308', 4],
    ['#c04aa8', 1.5],
    ['#240a22', -1.5],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(g.x, g.y, Math.max(1, g.r + grow), 0, TAU);
    ctx.fill();
  }
  const seed = hash2(Math.round(g.x), Math.round(g.y), 977) * TAU;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const ang = seed + (k / 3) * Math.PI;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const L = g.r * 0.85;
    const bend = g.r * 0.25 * (k % 2 === 0 ? 1 : -1);
    ctx.strokeStyle = '#6e2a66';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(g.x - ux * L, g.y - uy * L);
    ctx.quadraticCurveTo(g.x - uy * bend, g.y + ux * bend, g.x + ux * L, g.y + uy * L);
    ctx.stroke();
    ctx.fillStyle = '#f08ae0';
    ctx.beginPath();
    for (const s of [-0.5, 0, 0.5]) {
      const side = s === 0 ? 1 : -1;
      const mx = g.x + ux * L * s - uy * bend * 0.5 * (1 - Math.abs(s));
      const my = g.y + uy * L * s + ux * bend * 0.5 * (1 - Math.abs(s));
      ctx.moveTo(mx - ux * 2.5, my - uy * 2.5);
      ctx.lineTo(mx + ux * 2.5, my + uy * 2.5);
      ctx.lineTo(mx - uy * 6 * side, my + ux * 6 * side);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

/** Ice from a Crypt Golem's slam or Rimecoil's rings: a pale disc with a dark edge, a bright rim, frost streaks and cracks. */
function drawIcePatch(ctx: CanvasRenderingContext2D, g: GroundFx, a: number): void {
  ctx.globalAlpha = a;
  for (const [color, grow] of [
    ['rgba(12,22,38,0.85)', 5],
    ['#f0faff', 2],
    ['#9ccbea', 0],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r + grow, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(235,248,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(g.x - g.r * 0.3, g.y - g.r * 0.35, g.r * 0.45, g.r * 0.22, -0.6, 0, TAU);
  ctx.fill();
  const rng = mulberry32(Math.round(g.x * 7 + g.y));
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const x = g.x + (rng() - 0.5) * g.r;
    const y = g.y + (rng() - 0.5) * g.r;
    const len = g.r * (0.12 + rng() * 0.12);
    ctx.moveTo(x - len, y + len * 0.6);
    ctx.lineTo(x + len, y - len * 0.6);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(20,50,90,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const cx = g.x + (rng() - 0.5) * g.r * 0.4;
  const cy = g.y + (rng() - 0.5) * g.r * 0.4;
  for (let k = 0; k < 4; k++) {
    let ang = rng() * TAU;
    let x = cx;
    let y = cy;
    ctx.moveTo(x, y);
    for (let n = 0; n < 3; n++) {
      ang += (rng() - 0.5) * 0.8;
      x += Math.cos(ang) * g.r * 0.25;
      y += Math.sin(ang) * g.r * 0.25;
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * The circles marked where a blast will land: an outline, filling from the middle as it nears,
 * with a small mark of its own for each kind (a meteor's crosshair, a cluster of spores, a frost
 * star, a slam's closing ring, an eruption's cracks). With safe warnings they all wear hazard
 * stripes and a yellow, dark-cased ring instead. Reduced flashing stops the outline's last-moment pulse.
 */
export function drawBlastMarks(
  ctx: CanvasRenderingContext2D,
  world: World,
  t: number,
  near: Near,
  safe: boolean,
  stripes: () => CanvasPattern | string,
  quiet = false,
): void {
  for (const b of world.blasts) {
    if (!near(b.x, b.y, b.r + 10)) continue;
    const k = blastProgress(b);
    if (safe) {
      ctx.fillStyle = 'rgba(18,12,0,0.35)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = stripes();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * k, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      for (const [w, c] of [
        [6, COLORS.warnDark],
        [3, k > 0.6 ? COLORS.warnLight : COLORS.warn],
      ] as const) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.stroke();
      }
      continue;
    }
    const pulse = quiet ? k : 0.5 + 0.5 * Math.sin(t * 16);
    if (b.look === 'burrow' && b.from) drawTunnel(ctx, b);
    ctx.fillStyle = `rgba(${COLORS.telegraph},${0.1 + 0.08 * k})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(${COLORS.telegraph},0.3)`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * k, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(${COLORS.telegraph},${0.55 + 0.35 * (k > 0.7 ? pulse : k)})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.stroke();
    drawBlastSign(ctx, b, k);
  }
}

/** The small mark that tells each kind of blast apart, in the outline's colour. */
function drawBlastSign(ctx: CanvasRenderingContext2D, b: Blast, k: number): void {
  ctx.lineWidth = 2;
  if (b.look === 'meteor') {
    // A crosshair, so meteors read apart from vents and fireballs.
    ctx.beginPath();
    ctx.moveTo(b.x - b.r * 0.4, b.y);
    ctx.lineTo(b.x + b.r * 0.4, b.y);
    ctx.moveTo(b.x, b.y - b.r * 0.4);
    ctx.lineTo(b.x, b.y + b.r * 0.4);
    ctx.stroke();
  } else if (b.look === 'spores') {
    // A cluster of spore puffs swelling in the middle as the vent builds.
    const s = b.r * (0.07 + 0.05 * k);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      const x = b.x + Math.cos(a) * b.r * 0.24;
      const y = b.y + Math.sin(a) * b.r * 0.24;
      ctx.moveTo(x + s, y);
      ctx.arc(x, y, s, 0, TAU);
    }
    ctx.moveTo(b.x + s * 1.3, b.y);
    ctx.arc(b.x, b.y, s * 1.3, 0, TAU);
    ctx.stroke();
  } else if (b.look === 'icicle') {
    // A six-pointed frost star with barbed arms.
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(b.x + c * b.r * 0.1, b.y + s * b.r * 0.1);
      ctx.lineTo(b.x + c * b.r * 0.45, b.y + s * b.r * 0.45);
      const mx = b.x + c * b.r * 0.3;
      const my = b.y + s * b.r * 0.3;
      ctx.moveTo(mx + Math.cos(a + 0.8) * b.r * 0.1, my + Math.sin(a + 0.8) * b.r * 0.1);
      ctx.lineTo(mx, my);
      ctx.lineTo(mx + Math.cos(a - 0.8) * b.r * 0.1, my + Math.sin(a - 0.8) * b.r * 0.1);
    }
    ctx.stroke();
  } else if (b.look === 'slam') {
    // A ring closing in on the rim as the fists come down, and cracks running out from it.
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (1 + 0.35 * (1 - k)), 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.15;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(b.x + c * b.r * 0.72, b.y + s * b.r * 0.72);
      ctx.lineTo(b.x + Math.cos(a + 0.06) * b.r * 0.84, b.y + Math.sin(a + 0.06) * b.r * 0.84);
      ctx.lineTo(b.x + c * b.r * 0.96, b.y + s * b.r * 0.96);
    }
    ctx.stroke();
  } else if (b.look === 'burrow') {
    // The ground splitting from the middle as something comes up.
    const reach = b.r * (0.25 + 0.45 * k);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + b.x * 0.01;
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + Math.cos(a + 0.25) * reach * 0.5, b.y + Math.sin(a + 0.25) * reach * 0.5);
      ctx.lineTo(b.x + Math.cos(a) * reach, b.y + Math.sin(a) * reach);
    }
    ctx.stroke();
  }
}

/** A burrow's way underground: a faint dotted line from where it dived to the circle it will come up in. */
function drawTunnel(ctx: CanvasRenderingContext2D, b: Blast): void {
  const f = b.from!;
  const d = Math.hypot(b.x - f.x, b.y - f.y);
  if (d <= b.r) return;
  const ex = b.x - ((b.x - f.x) / d) * b.r;
  const ey = b.y - ((b.y - f.y) / d) * b.r;
  ctx.strokeStyle = 'rgba(200,150,100,0.35)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.setLineDash([2, 12]);
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'butt';
}

/** An icicle drops from the ceiling over the last stretch of its wait, landing as the circle fills. */
function icicleFall(b: Blast): { x: number; y: number; height: number } | null {
  const k = blastProgress(b);
  if (b.look !== 'icicle' || k <= 0.6) return null;
  return { x: b.x, y: b.y, height: (1 - (k - 0.6) / 0.4) * 360 };
}

/** Fireballs arcing toward their circles, meteors and icicles falling into theirs, with shadows below. */
export function drawBlastsInFlight(ctx: CanvasRenderingContext2D, world: World, near: Near, glow: Glow): void {
  for (const b of world.blasts) {
    if (b.look === 'icicle') {
      const f = icicleFall(b);
      if (f && near(f.x, f.y - f.height, 60)) drawFallingIcicle(ctx, f, glow);
      continue;
    }
    const f = blastInFlight(b);
    if (!f || !near(f.x, f.y - f.height, 60)) continue;
    const meteor = b.look === 'meteor';
    const size = meteor ? 16 : 9;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, size * (1 - f.height / 600), size * 0.45 * (1 - f.height / 600), 0, 0, TAU);
    ctx.fill();
    const y = f.y - f.height;
    if (meteor) {
      // A fiery tail streaming up behind the falling rock.
      const tail = ctx.createLinearGradient(f.x, y, f.x + 30, y - 120);
      tail.addColorStop(0, 'rgba(255,170,80,0.8)');
      tail.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.strokeStyle = tail;
      ctx.lineWidth = size * 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(f.x, y);
      ctx.lineTo(f.x + 30, y - 120);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalCompositeOperation = 'lighter';
    glow('#ff7a2a', f.x, y, size * 3, 0.8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = meteor ? '#3a1a12' : '#ff8a3c';
    ctx.beginPath();
    ctx.arc(f.x, y, size, 0, TAU);
    ctx.fill();
    ctx.fillStyle = meteor ? '#ff7a2a' : '#fff0c0';
    ctx.beginPath();
    ctx.arc(f.x - size * 0.25, y - size * 0.25, size * 0.45, 0, TAU);
    ctx.fill();
  }
}

/** A falling icicle, point down, with speed streaks above it and its shadow sharpening below. */
function drawFallingIcicle(ctx: CanvasRenderingContext2D, f: { x: number; y: number; height: number }, glow: Glow): void {
  const near = 1 - f.height / 360;
  ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.2 * near})`;
  ctx.beginPath();
  ctx.ellipse(f.x, f.y, 6 + 6 * near, 3 + 2.5 * near, 0, 0, TAU);
  ctx.fill();
  const tip = f.y - f.height;
  const top = tip - 40;
  ctx.strokeStyle = 'rgba(220,240,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const dx of [-4, 4]) {
    ctx.moveTo(f.x + dx, top - 8);
    ctx.lineTo(f.x + dx, top - 40);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  glow('#bfe6ff', f.x, tip - 16, 22, 0.5);
  ctx.globalCompositeOperation = 'source-over';
  const body = ctx.createLinearGradient(f.x - 7, 0, f.x + 7, 0);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(1, '#8ac4ec');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#1e3a60';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(f.x - 7, top + 3);
  ctx.lineTo(f.x - 3, top);
  ctx.lineTo(f.x + 2, top + 2);
  ctx.lineTo(f.x + 7, top);
  ctx.lineTo(f.x, tip);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(f.x - 3, top + 5);
  ctx.lineTo(f.x - 0.5, tip - 6);
  ctx.stroke();
}

/** The way down: a dark vortex ringed with light; a ring round it counts down to its pull. */
export function drawDescent(ctx: CanvasRenderingContext2D, world: World, t: number, glow: Glow, quiet: boolean): void {
  const d = world.descent;
  if (!d) return;
  const open = clamp(d.t / 0.6, 0, 1);
  const R = DESCENT.radius * (0.4 + 0.8 * open);
  ctx.globalCompositeOperation = 'lighter';
  glow(COLORS.nova, d.x, d.y, R * 2.4, quiet ? 0.5 : 0.5 + 0.2 * Math.sin(t * 4));
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, R);
  g.addColorStop(0, '#000000');
  g.addColorStop(0.7, '#14062a');
  g.addColorStop(1, '#3a1a6a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.x, d.y, R, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (quiet ? t * 0.8 : t * 2.4) + (i / 4) * TAU;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,224,150,0.85)' : 'rgba(150,230,255,0.85)';
    ctx.beginPath();
    ctx.arc(d.x, d.y, R * (0.55 + 0.1 * i), a, a + 1.6);
    ctx.stroke();
  }
  // How long until it pulls the serpent in.
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(d.x, d.y, R + 10, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(d.t / DESCENT.pullAfter, 0, 1));
  ctx.stroke();
}
