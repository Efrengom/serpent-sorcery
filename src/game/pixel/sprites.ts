import { ENEMIES, PIXEL_ART, SNAKE } from '../config';
import { TAU } from '../math';
import { bakeShape, gridSprite, type Edge, type Sprite } from './bake';
import { PX } from './palette';
import { WIZARDS, type WizardId } from '../wizards';

const P = PIXEL_ART.worldPerPixel;
/** Headings are quantized to 16 directions, the usual compromise for rotating pixel sprites. */
export const DIRECTIONS = 16;

const cache = new Map<string, Sprite>();
function cached(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) {
    s = make();
    cache.set(key, s);
  }
  return s;
}

/** [base, lit, shade] */
type Ramp = readonly [string, string, string];
const shade = (edge: Edge, r: Ramp) => (edge === 'lit' ? r[1] : edge === 'shade' ? r[2] : r[0]);
const FLASH: Ramp = [PX.white, PX.white, PX.flash];

export function directionIndex(heading: number): number {
  return ((Math.round((heading / TAU) * DIRECTIONS) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

const local = (dir: number) => {
  const theta = (dir / DIRECTIONS) * TAU;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return (x: number, y: number) => ({ u: x * c + y * s, v: -x * s + y * c });
};

// ---------------------------------------------------------------- wizard-hatted heads

export type HeadKind = 'player' | 'rival' | 'boss';
export type Variant = 'normal' | 'hurt' | 'flash';

const HEAD_STYLE: Record<HeadKind, { radius: number; size: number; head: Ramp; hurt: Ramp; hat: Ramp; brim: Ramp; band: Ramp; star: Ramp }> = {
  player: {
    radius: SNAKE.headRadius,
    size: 44,
    head: [PX.teal2, PX.teal3, PX.teal1],
    hurt: [PX.hurt1, PX.hurt2, PX.hurt0],
    hat: [PX.purple2, PX.purple3, PX.purple1],
    brim: [PX.purple1, PX.purple2, PX.purple0],
    band: [PX.gold1, PX.gold2, PX.gold0],
    star: [PX.gold1, PX.gold2, PX.gold1],
  },
  rival: {
    radius: ENEMIES.rival.radius,
    size: 40,
    head: [PX.rival2, PX.rival3, PX.rival1],
    hurt: [PX.rival2, PX.rival3, PX.rival1],
    hat: [PX.rivalHat1, PX.rivalHat2, PX.rivalHat0],
    brim: [PX.rivalHat0, PX.rivalHat1, PX.rivalHat0],
    band: [PX.rivalBand, PX.hostile3, PX.rival2],
    star: [PX.rivalBand, PX.hostile3, PX.rivalBand],
  },
  boss: {
    radius: ENEMIES.boss.radius,
    size: 84,
    head: [PX.boss3, PX.bossHi, PX.boss2],
    hurt: [PX.boss3, PX.bossHi, PX.boss2],
    hat: [PX.boss1, PX.boss2, PX.boss0],
    brim: [PX.boss0, PX.boss1, PX.boss0],
    band: [PX.gold1, PX.gold2, PX.gold0],
    star: [PX.gold1, PX.gold3, PX.gold1],
  },
};

/**
 * A head wearing a floppy wizard hat, seen from above: the brim sits on the back of the head and
 * the cone trails behind, bending with `sway` (-1, 0, 1).
 */
export function wizardHead(kind: HeadKind, dir: number, sway: number, variant: Variant = 'normal', wizard: WizardId = 'arcanist'): Sprite {
  return cached(`head:${kind}:${dir}:${sway}:${variant}:${kind === 'player' ? wizard : ''}`, () => {
    const base = HEAD_STYLE[kind];
    const px = WIZARDS[wizard].look.px;
    // The player's head wears the chosen wizard's colours.
    const st = kind === 'player' ? { ...base, head: px.body, hat: px.hat, brim: px.brim, band: px.band, star: px.band } : base;
    const toLocal = local(dir);
    const R = st.radius / P;
    const u0 = -0.5 * R;
    const tipU = u0 - 2.6 * R;
    const bend = sway * 0.45 * R;
    const starSize = kind === 'boss' ? 2.6 : 1.6;
    // Thinner band on the big boss hat so it doesn't read as a mouth.
    const band = kind === 'boss' ? [0.17, 0.23] : [0.14, 0.28];
    return bakeShape(
      st.size,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (Math.abs(u - tipU) + Math.abs(v - bend) <= starSize) return 'star';
        if (u <= u0 + 0.5 && u >= tipU) {
          const t = (u0 - u) / (u0 - tipU);
          const half = 0.72 * R * Math.pow(1 - t, 0.85) + 0.35;
          if (Math.abs(v - bend * t * t) <= half) return t > band[0] && t < band[1] ? 'band' : 'hat';
        }
        if (((u - u0) / (0.85 * R)) ** 2 + (v / (1.2 * R)) ** 2 <= 1) return 'brim';
        if ((u / (1.2 * R)) ** 2 + (v / R) ** 2 <= 1) return 'head';
        return null;
      },
      (r, e) => {
        if (variant === 'flash') return shade(e, FLASH);
        switch (r) {
          case 'head':
            return shade(e, variant === 'hurt' ? st.hurt : st.head);
          case 'hat':
            return shade(e, st.hat);
          case 'brim':
            return shade(e, st.brim);
          case 'band':
            return shade(e, st.band);
          default:
            return shade(e, st.star);
        }
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- snake bodies

export type SegmentStyle = 'body' | 'stripe' | 'hurt' | 'rival' | 'rivalStripe' | 'boss' | 'bossSpot' | 'flash';
const SEGMENT: Record<SegmentStyle, Ramp> = {
  body: [PX.teal2, PX.teal3, PX.teal1],
  stripe: [PX.teal1, PX.teal2, PX.teal0],
  hurt: [PX.hurt1, PX.hurt2, PX.hurt0],
  rival: [PX.rival2, PX.rival3, PX.rival1],
  rivalStripe: [PX.rival1, PX.rival2, PX.rival0],
  boss: [PX.boss2, PX.boss3, PX.boss1],
  bossSpot: [PX.boss1, PX.boss2, PX.boss0],
  flash: FLASH,
};

/** Body segments are drawn in two passes (all outlines, then all fills) so the body reads as one tube. */
export function segmentOutline(r: number): Sprite {
  return cached(`segO:${r}`, () => bakeShape(2 * (r + 2), (x, y) => (x * x + y * y <= (r + 1.25) ** 2 ? 'o' : null), () => PX.ink, null));
}

export function segmentFill(r: number, style: SegmentStyle, wizard: WizardId = 'arcanist'): Sprite {
  const own = style === 'body' || style === 'stripe';
  const ramp: Ramp = own ? WIZARDS[wizard].look.px[style] : SEGMENT[style];
  return cached(`segF:${r}:${style}:${own ? wizard : ''}`, () =>
    bakeShape(
      2 * (r + 2),
      (x, y) => {
        const d2 = x * x + y * y;
        if (style === 'bossSpot' && d2 <= (r * 0.38) ** 2) return 'spot';
        return d2 <= (r + 0.25) ** 2 ? 'b' : null;
      },
      (region, e) => (region === 'spot' ? shade(e, [PX.gold0, PX.gold1, PX.gold0]) : shade(e, ramp)),
      null,
    ),
  );
}

// ---------------------------------------------------------------- chaser ("Gloomling")

export const CHASER_FRAMES = 4;

/** Spiky crimson blob; frames rotate the spikes so it appears to churn as it chases. */
export function chaser(frame: number, flash: boolean): Sprite {
  return cached(`chaser:${frame}:${flash}`, () => {
    const R = ENEMIES.chaser.radius / P;
    const spikes = 10;
    const phase = (frame / CHASER_FRAMES) * (TAU / spikes);
    const inner = 0.85 * R;
    const outer = 1.35 * R;
    return bakeShape(
      20,
      (x, y) => {
        const d = Math.hypot(x, y);
        if (d <= 2.2) return 'core';
        const a = Math.atan2(y, x);
        const k = Math.pow((1 + Math.cos(spikes * (a - phase))) / 2, 3);
        return d <= inner + (outer - inner) * k ? 'body' : null;
      },
      (r, e) => {
        if (flash) return r === 'core' ? PX.flash : shade(e, FLASH);
        return r === 'core' ? PX.crim0 : shade(e, [PX.crim2, PX.crim3, PX.crim1]);
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- caster ("Hex Acolyte")

/** Hooded robe seen from above, hood point trailing behind and a dark face opening in front. */
export function caster(dir: number, flash: boolean): Sprite {
  return cached(`caster:${dir}:${flash}`, () => {
    const R = ENEMIES.caster.radius / P;
    const toLocal = local(dir);
    return bakeShape(
      26,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if ((u - 0.3 * R) ** 2 + v * v <= (0.55 * R) ** 2) return 'face';
        if (x * x + y * y <= R * R) return 'robe';
        if (u < 0 && u >= -1.75 * R && Math.abs(v) <= 0.8 * R * (1 + u / (1.75 * R))) return 'robe';
        return null;
      },
      (r, e) => {
        if (flash) return r === 'face' ? PX.flash : shade(e, FLASH);
        return r === 'face' ? PX.ink : shade(e, [PX.robe2, PX.robe3, PX.robe1]);
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- brute ("Ruin Golem")

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Rounded stone block with glowing cracks that run hot while it winds up and charges. */
export function brute(dir: number, hot: boolean, flash: boolean): Sprite {
  return cached(`brute:${dir}:${hot}:${flash}`, () => {
    const r = ENEMIES.brute.radius / P;
    const rc = 2.5;
    const toLocal = local(dir);
    const cracks: [number, number, number, number][] = [
      [-0.6 * r, -0.5 * r, -0.1 * r, -0.1 * r],
      [-0.1 * r, -0.1 * r, -0.4 * r, 0.5 * r],
      [0.1 * r, 0.7 * r, 0.3 * r, 0.2 * r],
      [0.45 * r, -0.65 * r, 0.2 * r, -0.3 * r],
    ];
    return bakeShape(
      30,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        const dx = Math.max(Math.abs(u) - (r - rc), 0);
        const dy = Math.max(Math.abs(v) - (r - rc), 0);
        if (dx * dx + dy * dy > rc * rc) return null;
        for (const [ax, ay, bx, by] of cracks) if (distToSegment(u, v, ax, ay, bx, by) <= 0.55) return 'crack';
        return 'body';
      },
      (region, e) => {
        if (flash) return region === 'crack' ? PX.flash : shade(e, FLASH);
        if (region === 'crack') return hot ? PX.crackHot : PX.crack;
        return shade(e, [PX.golem2, PX.golem3, PX.golem1]);
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- projectiles and pickups

export function boltHead(r: number): Sprite {
  return cached(`bolt:${r}`, () =>
    bakeShape(
      2 * r + 4,
      (x, y) => {
        const d2 = x * x + y * y;
        if (d2 <= (r * 0.5) ** 2) return 'core';
        return d2 <= (r + 0.25) ** 2 ? 'b' : null;
      },
      (region, e) => (region === 'core' ? PX.white : shade(e, [PX.cyan2, PX.cyan3, PX.cyan1])),
      PX.cyan0,
    ),
  );
}

export const SHOT_FRAMES = 2;
/** Hostile orb: dark rim so it reads against every friendly effect, hot core, gentle pulse. */
export function shot(r: number, frame: number): Sprite {
  return cached(`shot:${r}:${frame}`, () => {
    const rr = r + frame * 0.6;
    return bakeShape(
      2 * r + 6,
      (x, y) => {
        const d2 = x * x + y * y;
        if (d2 <= (rr * 0.45) ** 2) return 'core';
        return d2 <= (rr + 0.25) ** 2 ? 'b' : null;
      },
      (region, e) => (region === 'core' ? PX.hostile4 : shade(e, [PX.hostile2, PX.hostile3, PX.hostile1])),
      PX.hostile0,
    );
  });
}

/** Experience crystal; tier 0 small lavender, 1 medium pink, 2 large pink with a bright heart. */
export function crystal(tier: 0 | 1 | 2): Sprite {
  return cached(`crystal:${tier}`, () => {
    const a = [2.2, 3.2, 4.2][tier];
    const b = [3.4, 4.6, 5.8][tier];
    const ramp: Ramp = tier === 0 ? [PX.xp1, PX.xp2, PX.xp0] : [PX.pink1, PX.pink2, PX.pink0];
    return bakeShape(
      16,
      (x, y) => {
        const k = Math.abs(x) / a + Math.abs(y) / b;
        if (tier === 2 && k <= 0.35) return 'heart';
        return k <= 1 ? 'c' : null;
      },
      (region, e) => (region === 'heart' ? PX.white : shade(e, ramp)),
      PX.xpOut,
    );
  });
}

export const RETICLE_FRAMES = 4;
/** Target marker shown where the sigil was started; ticks rotate through four frames. */
export function reticle(frame: number, bright: boolean): Sprite {
  return cached(`reticle:${frame}:${bright}`, () => {
    const rot = (frame / RETICLE_FRAMES) * (Math.PI / 2);
    return bakeShape(
      20,
      (x, y) => {
        const d = Math.hypot(x, y);
        if (d < 0.9) return 'dot';
        if (Math.abs(d - 4.6) < 0.62) return 'ring';
        if (d > 6 && d < 8.6) {
          for (let k = 0; k < 4; k++) {
            const a = rot + (k * Math.PI) / 2;
            if (Math.abs(-x * Math.sin(a) + y * Math.cos(a)) < 0.62 && x * Math.cos(a) + y * Math.sin(a) > 0) return 'tick';
          }
        }
        return null;
      },
      (region) => (region === 'dot' ? PX.white : bright ? PX.cyan3 : PX.cyan1),
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- hand-authored bits

const FLAME_COLORS = { w: PX.flame2, y: PX.flame1, o: PX.flame0, k: PX.ink };
const FLAME_ROWS = [
  ['..w..', '.wyw.', '.yyy.', 'oyyyo', '.ooo.', '..k..'],
  ['.w...', '.ww..', '.yyw.', 'oyyyo', '.ooo.', '..k..'],
  ['...w.', '..ww.', '.wyy.', 'oyyyo', '.ooo.', '..k..'],
];
export const FLAME_FRAMES = FLAME_ROWS.length;
export function flame(frame: number): Sprite {
  return cached(`flame:${frame}`, () => gridSprite(FLAME_ROWS[frame], FLAME_COLORS, 2, 5));
}

/** The "!" over a foe about to attack; `safe` is the colorblind-safe yellow version. */
export function exclaim(safe = false): Sprite {
  return cached(safe ? 'exclaim-safe' : 'exclaim', () =>
    gridSprite(['.kk.', 'kwrk', 'krrk', 'krrk', '.kk.', '....', '.kk.', 'krrk', '.kk.'], {
      k: safe ? PX.warn0 : PX.ink,
      r: safe ? PX.warn2 : PX.tele,
      w: safe ? PX.warn3 : PX.hostile4,
    }),
  );
}
