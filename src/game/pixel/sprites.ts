import { ENEMIES, PIXEL_ART, SNAKE } from '../config';
import { hash2 } from '../hash';
import { TAU } from '../math';
import { bakeShape, bayer, gridSprite, type Edge, type Sprite } from './bake';
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

export type HeadKind = 'player' | 'rival' | 'boss' | 'salamander' | 'pyrecoil' | 'sporemaw' | 'rimecoil';
export type Variant = 'normal' | 'hurt' | 'flash';

/** The Ember Depths' colours: molten orange, scorched red, cooled black. */
const EMBER = {
  melt: [PX.hostile2, PX.hostile3, PX.hostile1] as Ramp,
  scorch: ['#8a2a10', '#c8501c', '#4a1206'] as Ramp,
  char: ['#3a1a14', '#5a2a1e', '#1e0c08'] as Ramp,
  glow: [PX.flame0, PX.flame1, PX.hostile1] as Ramp,
};

/** The Mycelium Hollows' colours: magenta caps, teal glow and flesh, puffballs, bark, thorns and dug earth. */
const FUNGUS = {
  cap: [PX.cap2, PX.cap3, PX.cap1] as Ramp,
  capDeep: [PX.cap1, PX.cap2, PX.cap0] as Ramp,
  glow: [PX.teal2, PX.teal3, PX.teal1] as Ramp,
  flesh: ['#1e6a5c', '#38a890', '#0e3a34'] as Ramp,
  fleshDeep: ['#155246', '#1e6a5c', '#0a2a26'] as Ramp,
  puff: [PX.puff2, PX.puff3, PX.puff1] as Ramp,
  wart: [PX.puff1, PX.puff2, PX.puff0] as Ramp,
  hide: ['#3e4a2c', '#5e6e3e', '#232a18'] as Ramp,
  bark: [PX.bark2, PX.bark3, PX.bark1] as Ramp,
  thorn: [PX.thorn2, PX.thorn3, PX.thorn1] as Ramp,
  dirt: [PX.dirt2, PX.dirt3, PX.dirt1] as Ramp,
  clod: [PX.dirt1, PX.dirt2, PX.dirt0] as Ramp,
  scale: ['#7a5c34', '#a8844e', '#4e3820'] as Ramp,
};

/** The Rimefrost Catacombs' colours: bone, ice, crypt stone, frost-blue hoods and spectres. */
const RIME = {
  bone: [PX.bone2, PX.bone3, PX.bone1] as Ramp,
  ice: [PX.ice2, PX.ice3, PX.ice1] as Ramp,
  deep: [PX.ice1, PX.ice2, PX.ice0] as Ramp,
  stone: [PX.crypt2, PX.crypt3, PX.crypt1] as Ramp,
  stoneDeep: [PX.crypt1, PX.crypt2, PX.crypt0] as Ramp,
  hood: [PX.hood2, PX.hood3, PX.hood1] as Ramp,
  spectre: [PX.spectre2, PX.spectre3, PX.spectre1] as Ramp,
};

const HEAD_STYLE: Record<
  HeadKind,
  {
    radius: number;
    size: number;
    head: Ramp;
    hurt: Ramp;
    hat: Ramp;
    brim: Ramp;
    band: Ramp;
    star: Ramp;
    hatless?: boolean;
    /** Instead of a hat: a toadstool cap (Sporemaw) or a crest of icicles (Rimecoil). */
    crown?: 'cap' | 'crest';
  }
> = {
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
  /** A Salamander wears no hat: just a broad lizard head. */
  salamander: {
    radius: ENEMIES.salamander.radius,
    size: 40,
    head: EMBER.melt,
    hurt: EMBER.melt,
    hat: EMBER.scorch,
    brim: EMBER.scorch,
    band: EMBER.glow,
    star: EMBER.glow,
    hatless: true,
  },
  pyrecoil: {
    radius: ENEMIES.boss.radius,
    size: 84,
    head: EMBER.scorch,
    hurt: EMBER.scorch,
    hat: EMBER.char,
    brim: [EMBER.char[2], EMBER.char[0], EMBER.char[2]],
    band: EMBER.glow,
    star: [PX.flame1, PX.flame2, PX.flame0],
  },
  /** Sporemaw: teal fungal flesh under a spotted magenta toadstool cap, its gills glowing round the rim. */
  sporemaw: {
    radius: ENEMIES.boss.radius,
    size: 84,
    head: FUNGUS.flesh,
    hurt: FUNGUS.flesh,
    hat: FUNGUS.cap,
    brim: FUNGUS.capDeep,
    band: FUNGUS.glow,
    star: [PX.spot, PX.white, PX.cap3],
    crown: 'cap',
  },
  /** Rimecoil: frost-blue, crowned with a crest of icicles. */
  rimecoil: {
    radius: ENEMIES.boss.radius,
    size: 84,
    head: RIME.deep,
    hurt: RIME.deep,
    hat: RIME.ice,
    brim: [PX.ice1, PX.ice2, PX.ice0],
    band: RIME.ice,
    star: [PX.white, PX.white, PX.ice3],
    crown: 'crest',
  },
};

/** Spots on Sporemaw's cap: (u, v) from the cap's middle and radius, in head radii. */
const CAP_SPOTS: [number, number, number][] = [
  [-0.45, -0.42, 0.22],
  [0.2, -0.6, 0.16],
  [-0.62, 0.32, 0.18],
  [0.12, 0.42, 0.24],
  [0.55, 0.02, 0.13],
  [-0.12, -0.04, 0.12],
];
/** Rimecoil's icicles: angle off straight back, and length in head radii. */
const CREST: [number, number][] = [
  [0, 2.5],
  [0.42, 2.0],
  [-0.42, 2.0],
  [0.85, 1.4],
  [-0.85, 1.4],
];

/** Sporemaw's cap and Rimecoil's crest, in the head's frame (u forward), or null where neither lies. */
function crownRegion(crown: 'cap' | 'crest', u: number, v: number, R: number, sway: number): string | null {
  if (crown === 'cap') {
    // A broad toadstool cap over the back of the head, swaying a little: spots, a dark rim, glowing gills at the very edge.
    const du = u + 0.8 * R;
    const dv = v - sway * 0.12 * R;
    const dc = Math.hypot(du, dv * 1.05);
    const cr = 1.15 * R;
    if (dc > cr) return null;
    if (dc > cr - 1) return 'band';
    for (const [su, sv, sr] of CAP_SPOTS) if (Math.hypot(du - su * R, dv - sv * R) <= sr * R) return 'star';
    return dc > cr - 2.4 ? 'brim' : 'hat';
  }
  // Icicles fanning back from the crown of the head, bright at their tips, darker where they root.
  const u0 = -0.3 * R;
  for (const [off, len] of CREST) {
    const a = Math.PI + off + sway * 0.08;
    const along = (u - u0) * Math.cos(a) + v * Math.sin(a);
    const across = -(u - u0) * Math.sin(a) + v * Math.cos(a);
    const L = len * R;
    if (along < 0 || along > L || Math.abs(across) > 0.3 * R * (1 - along / L) + 0.3) continue;
    return along > L * 0.78 ? 'star' : along < L * 0.3 ? 'brim' : 'hat';
  }
  return null;
}

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
    const big = st.size > 60;
    const starSize = big ? 2.6 : 1.6;
    // Thinner band on the big boss hat so it doesn't read as a mouth.
    const band = big ? [0.17, 0.23] : [0.14, 0.28];
    return bakeShape(
      st.size,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (st.hatless) return ((u - 0.1 * R) / (1.35 * R)) ** 2 + (v / (1.05 * R)) ** 2 <= 1 ? 'head' : null;
        if (st.crown) return crownRegion(st.crown, u, v, R, sway) ?? ((u / (1.2 * R)) ** 2 + (v / R) ** 2 <= 1 ? 'head' : null);
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

export type SegmentStyle =
  | 'body'
  | 'stripe'
  | 'hurt'
  | 'rival'
  | 'rivalStripe'
  | 'boss'
  | 'bossSpot'
  | 'salamander'
  | 'salamanderStripe'
  | 'pyre'
  | 'pyreSpot'
  | 'spore'
  | 'sporeSpot'
  | 'rime'
  | 'rimeSpot'
  | 'flash';
const SEGMENT: Record<SegmentStyle, Ramp> = {
  body: [PX.teal2, PX.teal3, PX.teal1],
  stripe: [PX.teal1, PX.teal2, PX.teal0],
  hurt: [PX.hurt1, PX.hurt2, PX.hurt0],
  rival: [PX.rival2, PX.rival3, PX.rival1],
  rivalStripe: [PX.rival1, PX.rival2, PX.rival0],
  boss: [PX.boss2, PX.boss3, PX.boss1],
  bossSpot: [PX.boss1, PX.boss2, PX.boss0],
  salamander: EMBER.melt,
  salamanderStripe: EMBER.scorch,
  pyre: EMBER.char,
  pyreSpot: EMBER.scorch,
  spore: FUNGUS.flesh,
  sporeSpot: FUNGUS.fleshDeep,
  rime: [PX.ice1, PX.ice2, PX.ice0],
  rimeSpot: [PX.ice0, PX.ice1, PX.hood1],
  flash: FLASH,
};
/** The spot in the middle of a boss's marked segments, and how big it is (share of the radius). */
const SPOT: Partial<Record<SegmentStyle, [Ramp, number]>> = {
  bossSpot: [[PX.gold0, PX.gold1, PX.gold0], 0.38],
  pyreSpot: [EMBER.glow, 0.38],
  sporeSpot: [FUNGUS.cap, 0.46],
  rimeSpot: [[PX.ice3, PX.white, PX.ice2], 0.36],
};

/** Body segments are drawn in two passes (all outlines, then all fills) so the body reads as one tube. */
export function segmentOutline(r: number): Sprite {
  return cached(`segO:${r}`, () => bakeShape(2 * (r + 2), (x, y) => (x * x + y * y <= (r + 1.25) ** 2 ? 'o' : null), () => PX.ink, null));
}

export function segmentFill(r: number, style: SegmentStyle, wizard: WizardId = 'arcanist'): Sprite {
  const own = style === 'body' || style === 'stripe';
  const ramp: Ramp = own ? WIZARDS[wizard].look.px[style] : SEGMENT[style];
  const spot = SPOT[style];
  return cached(`segF:${r}:${style}:${own ? wizard : ''}`, () =>
    bakeShape(
      2 * (r + 2),
      (x, y) => {
        const d2 = x * x + y * y;
        if (spot && d2 <= (r * spot[1]) ** 2) return 'spot';
        return d2 <= (r + 0.25) ** 2 ? 'b' : null;
      },
      (region, e) => (region === 'spot' && spot ? shade(e, spot[0]) : shade(e, ramp)),
      null,
    ),
  );
}

// ---------------------------------------------------------------- burrowing (Burrow Viper, Sporemaw)

export const MOUND_FRAMES = 2;
/** Heaped earth over something tunnelling just below: a lumpy dome with clods, rim-lit like everything else. */
export function mound(r: number, frame: number): Sprite {
  return cached(`mound:${r}:${frame}`, () =>
    bakeShape(
      2 * r + 6,
      (x, y) => {
        const lump = 1 + 0.13 * Math.sin(Math.atan2(y, x) * 5 + frame * 1.9);
        const d = Math.hypot(x, y * 1.15) / lump;
        if (d > r) return null;
        return d < r * 0.85 && hash2(Math.floor(x + 40), Math.floor(y + 40), 31 + frame) < 0.14 ? 'clod' : 'dirt';
      },
      (region, e) => shade(e, region === 'clod' ? FUNGUS.clod : FUNGUS.dirt),
      PX.dirt0,
    ),
  );
}

// ---------------------------------------------------------------- the Hollows' foes

const SPORELING_SPOTS: [number, number][] = [
  [-0.35, -0.38],
  [0.42, -0.1],
  [-0.08, 0.45],
];
/**
 * Sporeling: a tiny magenta toadstool seen from above. `squash` 1 is the landing (wide and flat),
 * -1 is mid-hop (a touch narrow), 0 standing.
 */
export function sporeling(squash: -1 | 0 | 1, flash: boolean): Sprite {
  return cached(`sporeling:${squash}:${flash}`, () => {
    const R = (ENEMIES.sporeling.radius / P) * 1.15;
    const sx = squash === 1 ? 1.22 : squash === -1 ? 0.88 : 1;
    const sy = squash === 1 ? 0.8 : squash === -1 ? 1.08 : 1;
    return bakeShape(
      16,
      (x, y) => {
        const ex = x / (R * sx);
        const ey = y / (R * sy);
        if (ex * ex + ey * ey > 1) return null;
        for (const [px, py] of SPORELING_SPOTS) if ((ex - px) ** 2 + (ey - py) ** 2 <= 0.07) return 'spot';
        return 'cap';
      },
      (r, e) => (flash ? shade(e, FLASH) : r === 'spot' ? PX.spot : shade(e, FUNGUS.cap)),
      PX.ink,
    );
  });
}

export const PUFF_SWELL = 4;
const PUFF_WARTS: [number, number][] = [
  [0.55, -0.28],
  [-0.5, 0.3],
  [0.15, 0.62],
  [-0.22, -0.6],
  [0.62, 0.35],
  [-0.66, -0.18],
  [0.3, 0.05],
];
/** Puffcap: a squat puffball with warts and a pore on top, swelling (0 to 3) as it gathers spores; the pore glows as it fills. */
export function puffcap(swell: number, flash: boolean): Sprite {
  return cached(`puffcap:${swell}:${flash}`, () => {
    const R = (ENEMIES.puffcap.radius / P) * (1 + swell * 0.1);
    return bakeShape(
      22,
      (x, y) => {
        if (Math.hypot(x, y * 1.08) > R) return null;
        if (Math.hypot(x + 0.4, y + 0.6) <= 1.2 + swell * 0.25) return 'pore';
        for (const [wx, wy] of PUFF_WARTS) if (Math.hypot(x - wx * R, y - wy * R) <= 0.75) return 'wart';
        return 'body';
      },
      (r, e) => {
        if (flash) return r === 'pore' ? PX.flash : shade(e, FLASH);
        if (r === 'pore') return swell >= 2 ? PX.spore2 : swell === 1 ? PX.spore1 : PX.puff0;
        return shade(e, r === 'wart' ? FUNGUS.wart : FUNGUS.puff);
      },
      PX.ink,
    );
  });
}

/** Distance from (px, py) to segment a-b, and how far along it (0 to 1) the nearest point is. */
function segmentHit(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/** Thornback: a hulking mossy beast, a ridge of magenta thorns down its spine and more along its flanks; they flare while it charges. */
export function thornback(dir: number, hot: boolean, flash: boolean): Sprite {
  return cached(`thornback:${dir}:${hot}:${flash}`, () => {
    const R = ENEMIES.thornback.radius / P;
    const toLocal = local(dir);
    const flank: [number, number, number, number][] = [];
    for (const us of [0.3, -0.2, -0.7]) for (const s of [-1, 1]) flank.push([us * R, s * 0.72 * R, (us - 0.5) * R, s * 1.28 * R]);
    return bakeShape(
      32,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        // The ridge: thorns down the spine, each pointing back.
        if (u > -1.2 * R && u < 0.45 * R) {
          const saw = ((((u + 1.2 * R) % 3.4) + 3.4) % 3.4) / 3.4;
          if (Math.abs(v) <= 0.36 * R * saw) return 'thorn';
        }
        for (const [ax, ay, bx, by] of flank) {
          const h = segmentHit(u, v, ax, ay, bx, by);
          if (h.d <= 1.1 * (1 - h.t) + 0.3) return 'thorn';
        }
        if (((u - 0.95 * R) / (0.42 * R)) ** 2 + (v / (0.5 * R)) ** 2 <= 1) return 'head';
        if ((u / (1.1 * R)) ** 2 + (v / (0.85 * R)) ** 2 <= 1) return 'body';
        return null;
      },
      (r, e) => {
        if (flash) return shade(e, FLASH);
        if (r === 'thorn') return shade(e, hot ? [PX.thorn3, PX.white, PX.thorn2] : FUNGUS.thorn);
        return shade(e, r === 'head' ? FUNGUS.bark : FUNGUS.hide);
      },
      PX.ink,
    );
  });
}

export const VIPER_FRAMES = 2;
/** Burrow Viper: a sandy viper in an S-curve with dark diamonds down its back and a broad wedge of a head. */
export function viper(dir: number, frame: number, flash: boolean): Sprite {
  return cached(`viper:${dir}:${frame}:${flash}`, () => {
    const R = ENEMIES.burrowViper.radius / P;
    const toLocal = local(dir);
    const spine: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const s = i / 12;
      spine.push([0.55 * R - s * 2.1 * R, Math.sin(s * TAU * 0.85 + frame * Math.PI) * 0.45 * R * (0.35 + 0.65 * s)]);
    }
    return bakeShape(
      26,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (((u - 0.8 * R) / (0.52 * R)) ** 2 + (v / (0.44 * R)) ** 2 <= 1) return 'head';
        for (let i = 1; i < spine.length; i++) {
          const [ax, ay] = spine[i - 1];
          const [bx, by] = spine[i];
          const h = segmentHit(u, v, ax, ay, bx, by);
          const s = (i - 1 + h.t) / (spine.length - 1);
          const w = 0.4 * R * (1 - 0.6 * s) + 0.35;
          if (h.d > w) continue;
          return h.d < w * 0.55 && ((s * 7) % 1) > 0.35 && ((s * 7) % 1) < 0.75 ? 'mark' : 'body';
        }
        return null;
      },
      (r, e) => (flash ? shade(e, FLASH) : shade(e, r === 'mark' ? FUNGUS.clod : FUNGUS.scale)),
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- the Catacombs' foes

export const RATTLER_FRAMES = 2;
/** Bone Rattler: a skeleton from above (skull, spine, ribs, pelvis), arms reaching and legs swinging with each step. */
export function rattler(dir: number, frame: number, flash: boolean): Sprite {
  return cached(`rattler:${dir}:${frame}:${flash}`, () => {
    const R = ENEMIES.rattler.radius / P;
    const toLocal = local(dir);
    const swing = frame === 0 ? 0.2 * R : -0.2 * R;
    const limbs: [number, number, number, number][] = [
      [0.05 * R, -0.6 * R, 0.65 * R + swing, -0.88 * R],
      [0.05 * R, 0.6 * R, 0.65 * R - swing, 0.88 * R],
      [-1.0 * R, -0.3 * R, -1.6 * R - swing, -0.5 * R],
      [-1.0 * R, 0.3 * R, -1.6 * R + swing, 0.5 * R],
    ];
    return bakeShape(
      24,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if ((u - 0.5 * R) ** 2 + v * v <= (0.52 * R) ** 2) return 'skull';
        if (Math.abs(v) <= 0.5 && u > -1.0 * R && u < 0.1 * R) return 'bone';
        for (const [i, ub] of [-0.15, -0.4, -0.65].entries()) {
          if (Math.abs(u - ub * R + 0.25 * Math.abs(v)) <= 0.5 && Math.abs(v) <= 0.62 * R * (1 - 0.15 * i)) return 'bone';
        }
        if (((u + 1.0 * R) / (0.25 * R)) ** 2 + (v / (0.45 * R)) ** 2 <= 1) return 'bone';
        for (const [ax, ay, bx, by] of limbs) if (segmentHit(u, v, ax, ay, bx, by).d <= 0.55) return 'bone';
        return null;
      },
      (_, e) => shade(e, flash ? FLASH : RIME.bone),
      PX.ink,
    );
  });
}

/** A collapsed Bone Rattler: a heap of crossed bones (its skull is drawn on top, separately, so it can twitch). */
export function bonePile(flash: boolean): Sprite {
  return cached(`bonePile:${flash}`, () => {
    const bones: [number, number, number, number][] = [
      [-5, -1, 3, 2],
      [-3, 3, 4, -2],
      [-1, -3, 5, 1],
      [-5, 2, -1, -3],
      [1, 3, 5, 4],
    ];
    return bakeShape(
      18,
      (x, y) => {
        for (const [ax, ay, bx, by] of bones) {
          const h = segmentHit(x, y, ax, ay, bx, by);
          if (h.d <= 0.6 || Math.hypot(x - ax, y - ay) <= 1.1 || Math.hypot(x - bx, y - by) <= 1.1) return 'bone';
        }
        return null;
      },
      (_, e) => shade(e, flash ? FLASH : RIME.bone),
      PX.ink,
    );
  });
}

/** A Bone Rattler's skull, looking up from its pile. */
export function skull(flash: boolean): Sprite {
  return cached(`skull:${flash}`, () =>
    gridSprite(['.kkkk.', 'kLWWWk', 'kbWWbk', 'kWWWDk', '.kWWk.', '..kk..'], {
      k: PX.ink,
      L: flash ? PX.white : PX.bone3,
      W: flash ? PX.white : PX.bone2,
      D: flash ? PX.flash : PX.bone1,
      b: PX.ink,
    }),
  );
}

/**
 * Frost Archer: a skeleton in a frost-blue hood, an ice bow held out in front. While it draws, the
 * string comes back with an icicle nocked.
 */
export function frostArcher(dir: number, drawn: boolean, flash: boolean): Sprite {
  return cached(`frostArcher:${dir}:${drawn}:${flash}`, () => {
    const R = ENEMIES.frostArcher.radius / P;
    const toLocal = local(dir);
    const bowR = 1.25 * R;
    const bowU = 0.05 * R;
    const end = 1.0;
    const tipU = bowU + bowR * Math.cos(end);
    const tipV = bowR * Math.sin(end);
    const nock = drawn ? -0.35 * R : tipU;
    return bakeShape(
      28,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (drawn && u > nock && u < 1.55 * R && Math.abs(v) <= 0.5 * Math.min(1, (1.55 * R - u) / (0.4 * R))) return 'arrow';
        const a = Math.atan2(v, u - bowU);
        if (Math.abs(a) <= end && Math.abs(Math.hypot(u - bowU, v) - bowR) <= 0.6) return 'bow';
        for (const s of [-1, 1]) if (segmentHit(u, v, tipU, s * tipV, nock, 0).d <= 0.4) return 'string';
        if ((u - 0.3 * R) ** 2 + v * v <= (0.5 * R) ** 2) return 'face';
        if (x * x + y * y <= R * R) return 'robe';
        if (u < 0 && u >= -1.6 * R && Math.abs(v) <= 0.8 * R * (1 + u / (1.6 * R))) return 'robe';
        return null;
      },
      (r, e) => {
        if (flash) return shade(e, FLASH);
        switch (r) {
          case 'arrow':
            return shade(e, [PX.ice3, PX.white, PX.ice2]);
          case 'bow':
            return shade(e, RIME.ice);
          case 'string':
            return PX.bone1;
          case 'face':
            return shade(e, RIME.bone);
          default:
            return shade(e, RIME.hood);
        }
      },
      PX.ink,
    );
  });
}

/** Crypt Golem: a block of frozen crypt stone with ice crystals on its shoulders and cold cracks that blaze while it winds up. */
export function golem(dir: number, hot: boolean, flash: boolean): Sprite {
  return cached(`golem:${dir}:${hot}:${flash}`, () => {
    const R = ENEMIES.golem.radius / P;
    const r = R * 0.92;
    const rc = 3;
    const toLocal = local(dir);
    const cracks: [number, number, number, number][] = [
      [-0.55 * r, -0.4 * r, -0.05 * r, -0.05 * r],
      [-0.05 * r, -0.05 * r, -0.35 * r, 0.55 * r],
      [0.2 * r, 0.6 * r, 0.05 * r, 0.15 * r],
    ];
    const crystals: [number, number, number, number][] = [
      [-0.05 * R, -0.74 * R, 0.36 * R, 0.24 * R],
      [-0.05 * R, 0.74 * R, 0.36 * R, 0.24 * R],
      [-0.45 * R, -0.62 * R, 0.24 * R, 0.17 * R],
      [-0.45 * R, 0.62 * R, 0.24 * R, 0.17 * R],
    ];
    return bakeShape(
      34,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        for (const [cu, cv, au, av] of crystals) if (Math.abs(u - cu) / au + Math.abs(v - cv) / av <= 1) return 'ice';
        const dx = Math.max(Math.abs(u) - (r - rc), 0);
        const dy = Math.max(Math.abs(v) - (r - rc), 0);
        if (dx * dx + dy * dy > rc * rc) return null;
        if ((u - 0.5 * R) ** 2 + v * v <= (0.3 * R) ** 2) return 'head';
        for (const [ax, ay, bx, by] of cracks) if (distToSegment(u, v, ax, ay, bx, by) <= 0.55) return 'crack';
        return 'body';
      },
      (region, e) => {
        if (flash) return region === 'crack' ? PX.flash : shade(e, FLASH);
        if (region === 'crack') return hot ? PX.rimeGlow : PX.ice1;
        if (region === 'ice') return shade(e, RIME.ice);
        return shade(e, region === 'head' ? RIME.stoneDeep : RIME.stone);
      },
      PX.ink,
    );
  });
}

/** One of a Crypt Golem's fists: a stone block with icy knuckles, bigger when raised (nearer the eye). */
export function golemFist(raised: boolean, flash: boolean): Sprite {
  return cached(`golemFist:${raised}:${flash}`, () => {
    const h = raised ? 3.6 : 2.7;
    return bakeShape(
      12,
      (x, y) => {
        const dx = Math.max(Math.abs(x) - (h - 1.2), 0);
        const dy = Math.max(Math.abs(y) - (h - 1.2), 0);
        if (dx * dx + dy * dy > 1.44) return null;
        return y < -h + 1.6 ? 'knuckle' : 'fist';
      },
      (r, e) => (flash ? shade(e, FLASH) : shade(e, r === 'knuckle' ? RIME.ice : RIME.stone)),
      PX.ink,
    );
  });
}

export const WRAITH_FRAMES = 4;
/**
 * Wraith: a hooded spectre trailing a tattered cloak that fades out in a dither. `phased` (inside
 * stone) leaves only every other pixel and no outline, so it shows faintly through the rock.
 */
export function wraith(dir: number, frame: number, phased: boolean, flash: boolean): Sprite {
  return cached(`wraith:${dir}:${frame}:${phased}:${flash}`, () => {
    const R = ENEMIES.wraith.radius / P;
    const toLocal = local(dir);
    const size = 32;
    return bakeShape(
      size,
      (x, y) => {
        const i = Math.round(x + size / 2 - 0.5);
        const j = Math.round(y + size / 2 - 0.5);
        if (phased && (i + j) % 2 === 1) return null;
        const { u, v } = toLocal(x, y);
        if ((u - 0.55 * R) ** 2 + v * v <= (0.32 * R) ** 2) return 'face';
        if ((u - 0.35 * R) ** 2 + v * v <= (0.62 * R) ** 2) return 'hood';
        for (const s of [-1, 1]) if (segmentHit(u, v, 0.1 * R, s * 0.55 * R, 0.8 * R, s * 1.05 * R).d <= 0.5) return 'cloak';
        if (u > 0.4 * R || u < -2.2 * R) return null;
        const t = (0.4 * R - u) / (2.6 * R);
        const wave = Math.sin(t * 5 + frame * (Math.PI / 2)) * 0.35 * R * t;
        const tatter = t > 0.55 ? 0.75 + 0.25 * Math.sin(t * 22 + frame * 1.7 + v) : 1;
        if (Math.abs(v - wave) > 0.78 * R * Math.pow(1 - t, 0.8) * tatter) return null;
        // The cloak thins to nothing towards its tail.
        if (t > 0.5 && bayer(i, j) > (1 - t) * 2) return null;
        return 'cloak';
      },
      (r, e) => {
        if (flash) return r === 'face' ? PX.flash : shade(e, FLASH);
        if (r === 'face') return PX.spectre0;
        return shade(e, RIME.spectre);
      },
      phased ? null : PX.spectre0,
    );
  });
}

// ---------------------------------------------------------------- chaser ("Gloomling")

export const CHASER_FRAMES = 4;

/** Spiky crimson blob; frames rotate the spikes so it appears to churn as it chases. */
export function chaser(frame: number, flash: boolean, imp = false): Sprite {
  return cached(`chaser:${frame}:${flash}:${imp}`, () => {
    // A Cinder Imp is smaller, with fewer, sharper flames for spikes.
    const R = (imp ? ENEMIES.imp.radius : ENEMIES.chaser.radius) / P;
    const spikes = imp ? 6 : 10;
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
        if (imp) return r === 'core' ? '#3a0e06' : shade(e, EMBER.melt);
        return r === 'core' ? PX.crim0 : shade(e, [PX.crim2, PX.crim3, PX.crim1]);
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- caster ("Hex Acolyte")

/** Hooded robe seen from above, hood point trailing behind and a dark face opening in front. */
export function caster(dir: number, flash: boolean, pyro = false): Sprite {
  return cached(`caster:${dir}:${flash}:${pyro}`, () => {
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
        return r === 'face' ? PX.ink : shade(e, pyro ? EMBER.scorch : [PX.robe2, PX.robe3, PX.robe1]);
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
export function brute(dir: number, hot: boolean, flash: boolean, magma = false): Sprite {
  return cached(`brute:${dir}:${hot}:${flash}:${magma}`, () => {
    // A Magma Brute: cooled black rock whose cracks always glow.
    const r = (magma ? ENEMIES.magmaBrute.radius : ENEMIES.brute.radius) / P;
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
        if (region === 'crack') return hot ? PX.crackHot : magma ? PX.flame0 : PX.crack;
        return shade(e, magma ? EMBER.char : [PX.golem2, PX.golem3, PX.golem1]);
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

export const SPORE_FRAMES = 3;
/** A drifting spore: a soft magenta puff of four lobes round a teal heart, its rim thinning to a dither. */
export function sporeShot(r: number, frame: number): Sprite {
  return cached(`spore:${r}:${frame}`, () => {
    const size = 2 * r + 6;
    const spin = (frame / SPORE_FRAMES) * (TAU / 4);
    return bakeShape(
      size,
      (x, y) => {
        const i = Math.round(x + size / 2 - 0.5);
        const j = Math.round(y + size / 2 - 0.5);
        const d = Math.hypot(x, y);
        if (d <= r * 0.38) return 'core';
        let lobe = d <= r * 0.75;
        for (let k = 0; k < 4 && !lobe; k++) {
          const a = spin + (k / 4) * TAU;
          lobe = Math.hypot(x - Math.cos(a) * r * 0.5, y - Math.sin(a) * r * 0.5) <= r * 0.55;
        }
        if (!lobe) return null;
        return d > r * 0.85 && bayer(i, j) > 0.6 ? null : 'puff';
      },
      (region, e) => (region === 'core' ? (e === 'lit' ? PX.teal3 : PX.teal2) : shade(e, [PX.spore1, PX.spore2, PX.cap1])),
      PX.spore0,
    );
  });
}

/** An icicle in flight along heading `dir`: a long thin shard, sharp at the front, with a bright core and a dark rim. */
export function icicleShot(r: number, dir: number): Sprite {
  return cached(`icicle:${r}:${dir}`, () => {
    const toLocal = local(dir);
    const front = 1.9 * r;
    const back = 2.6 * r;
    return bakeShape(
      Math.ceil(2 * back) + 4,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (u > front || u < -back) return null;
        const w = u >= 0 ? 0.55 * r * (1 - u / front) : 0.55 * r * (1 + u / back);
        if (Math.abs(v) > w + 0.35) return null;
        return Math.abs(v) < 0.5 && u > -back * 0.6 && u < front * 0.6 ? 'core' : 'shard';
      },
      (region, e) => (region === 'core' ? PX.white : shade(e, RIME.ice)),
      PX.hood0,
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

/** Torch flames: fire, the Hollows' teal foxfire, and the Catacombs' cold blue flame. */
export type FlameTint = 'fire' | 'foxfire' | 'frost';
const FLAME_COLORS: Record<FlameTint, Record<string, string>> = {
  fire: { w: PX.flame2, y: PX.flame1, o: PX.flame0, k: PX.ink },
  foxfire: { w: '#e8fff6', y: PX.teal2, o: PX.teal1, k: PX.ink },
  frost: { w: PX.ice3, y: PX.ice2, o: PX.ice1, k: PX.ink },
};
const FLAME_ROWS = [
  ['..w..', '.wyw.', '.yyy.', 'oyyyo', '.ooo.', '..k..'],
  ['.w...', '.ww..', '.yyw.', 'oyyyo', '.ooo.', '..k..'],
  ['...w.', '..ww.', '.wyy.', 'oyyyo', '.ooo.', '..k..'],
];
export const FLAME_FRAMES = FLAME_ROWS.length;
export function flame(frame: number, tint: FlameTint = 'fire'): Sprite {
  return cached(`flame:${frame}:${tint}`, () => gridSprite(FLAME_ROWS[frame], FLAME_COLORS[tint], 2, 5));
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
