import { ENEMIES, PIXEL_ART, SNAKE } from '../config';
import { hash2 } from '../hash';
import { TAU } from '../math';
import { bakeShape, bayer, domeLight, gridSprite, hexRgb, rampStep, type Edge, type Sprite } from './bake';
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

/** Where a point in a foe's own frame (u forward, v to its right) lands on screen. */
function toScreen(dir: number, u: number, v: number): { x: number; y: number } {
  const theta = (dir / DIRECTIONS) * TAU;
  return { x: u * Math.cos(theta) - v * Math.sin(theta), y: u * Math.sin(theta) + v * Math.cos(theta) };
}

/** Five steps from darkest to brightest, for shading a surface across with domeLight. */
type Ramp5 = readonly [string, string, string, string, string];
const CAP5 = [PX.cap0, PX.cap1, PX.cap2, PX.cap3, '#ffc4ec'] as const;

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
  /** A Salamander wears no hat: just a broad lizard head (see salamanderHead). */
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
  [-0.42, -0.3, 0.21],
  [0.16, -0.52, 0.15],
  [-0.28, 0.44, 0.16],
  [0.36, 0.22, 0.22],
  [0.02, -0.06, 0.12],
  [0.52, -0.2, 0.1],
];
/** Little toadstools sprouting from the sides of Sporemaw's head: (u, v) and radius, in head radii. */
const SPROUTS: [number, number, number][] = [
  [0.02, 0.88, 0.3],
  [0.18, -0.86, 0.22],
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
    // A broad toadstool cap over the back of the head, swaying a little: its rim scalloped, glowing
    // gills striped round under it, and round white spots standing up from it, each shadowed on
    // the side away from the light. Two little toadstools sprout from the sides of the head.
    const du = u + 0.8 * R;
    const dv = v - sway * 0.12 * R;
    const a = Math.atan2(dv, du);
    const dc = Math.hypot(du, dv * 1.05);
    const cr = 1.15 * R * (1 + 0.03 * Math.sin(a * 7));
    if (dc <= cr) {
      if (dc > cr - 0.9) return 'brim';
      if (dc > cr - 2.3) return Math.floor(((a + Math.PI) / TAU) * 36) % 3 === 0 ? 'brim' : 'band';
      for (const [su, sv, sr] of CAP_SPOTS) {
        const ds = Math.hypot(du - su * R, dv - sv * R);
        if (ds <= sr * R) return 'star';
        if (ds <= sr * R + 0.9 && du - su * R + (dv - sv * R) > 0) return 'spotShade';
      }
      return 'hat';
    }
    for (const [su, sv, sr] of SPROUTS) {
      const ds = Math.hypot(u - su * R, v - sv * R);
      if (ds <= sr * R) return ds <= sr * R * 0.35 ? 'sproutSpot' : 'sprout';
    }
    return null;
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

/** A Salamander's colours, darkest to brightest: scorched to molten, a pale glint at the top. */
const SALAMANDER5 = ['#6a1a0a', PX.hostile1, PX.hostile2, PX.hostile3, PX.flame2] as const;
const SCORCHED5 = ['#2a0a04', '#4a1206', '#8a2a10', '#c8501c', '#ff8a4a'] as const;

/**
 * A Salamander's head from above, in its own frame (u forward): broad and flat, rounded behind and
 * tapering to a blunt snout with two nostrils, a scorched ridge down the back of it, and two embers
 * glowing behind the eyes (which are drawn on top).
 */
function salamanderHead(u: number, v: number, R: number): string | null {
  const skull = ((u + 0.05 * R) / (0.9 * R)) ** 2 + (v / R) ** 2 <= 1;
  const snout = ((u - 0.65 * R) / (0.85 * R)) ** 2 + (v / (0.62 * R)) ** 2 <= 1;
  if (!skull && !snout) return null;
  for (const s of [-1, 1]) {
    if (Math.hypot(u - 1.22 * R, v - s * 0.26 * R) <= 0.55) return 'nostril';
    if (Math.hypot(u + 0.45 * R, v - s * 0.5 * R) <= 0.24 * R) return 'ember';
  }
  if (Math.abs(v) <= 0.16 * R && u < -0.15 * R && u > -0.9 * R) return 'crest';
  return 'head';
}

/** Foes' heads, shaded round, darkest to brightest. (The player's comes from its wizard's colours.) */
const HEAD5: Partial<Record<HeadKind, readonly string[]>> = {
  rival: ['#24060f', PX.rival0, PX.rival1, PX.rival2, PX.rival3],
  boss: [PX.boss0, PX.boss1, PX.boss2, PX.boss3, PX.bossHi],
  pyrecoil: ['#2a0a04', '#8a2a10', '#c8501c', '#ff7a3a', '#ffb070'],
  sporemaw: ['#0a2a26', '#155246', '#1e6a5c', '#38a890', '#6ad0b8'],
  rimecoil: [PX.hood1, PX.ice0, PX.ice1, PX.ice2, PX.ice3],
};
/** A rim-lit ramp ([base, lit, shade]) as three steps from dark to light. */
const steps3 = (r: Ramp) => [r[2], r[0], r[1]] as const;

/** A colour `t` of the way from `a` to `b`. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexRgb(a);
  const cb = hexRgb(b);
  return `#${ca.map((v, n) => Math.round(v + (cb[n] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** A rim-lit ramp spread to four steps from dark to light (a darker one added below), for shading round. */
const steps4 = (r: Ramp) => [mixHex(r[2], PX.ink, 0.4), r[2], r[0], r[1]] as const;
/** The same to five, a paler one added above, for a head. */
const steps5 = (r: Ramp) => [mixHex(r[2], PX.ink, 0.45), r[2], r[0], r[1], mixHex(r[1], PX.white, 0.45)] as const;

/**
 * A snake's head from above, in its own frame (u forward): one smooth egg, broad behind and
 * narrowing gently to a rounded snout, with nostrils near its tip on the big ones. Its eyes are
 * drawn on top.
 */
function snakeHead(u: number, v: number, R: number, nostrils: boolean): string | null {
  const along = (u - 0.1 * R) / (1.2 * R);
  if (Math.abs(along) > 1) return null;
  if (Math.abs(v) > R * (1 - 0.18 * along) * Math.sqrt(1 - along * along)) return null;
  if (nostrils) for (const s of [-1, 1]) if (Math.hypot(u - 1.1 * R, v - s * 0.22 * R) <= 0.07 * R + 0.4) return 'nostril';
  return 'head';
}

/**
 * A head wearing a floppy wizard hat, seen from above: the brim sits on the back of the head and
 * the cone trails behind, bending with `sway` (-1, 0, 1). A foe's is shaded round: its head from a
 * dark jaw to a bright crown, the cone across its curve (lit along one side whichever way it
 * turns), the brim as a disc, and the band and the star at the tip catching the light; Sporemaw's
 * toadstool cap is rounded too, its gills glowing at the rim, and Rimecoil's icicles bright-edged.
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
    // The player's head is shaded round in its wizard's colours (or red, hurt).
    const H = kind === 'player' ? steps5(variant === 'hurt' ? st.hurt : st.head) : HEAD5[kind];
    const theta = (dir / DIRECTIONS) * TAU;
    // The light on the cone where it lies `s` (-1 to 1) across its width, turned to the screen.
    const coneLight = (s: number) => {
      const nx = -s * Math.sin(theta);
      const ny = s * Math.cos(theta);
      const nz = Math.sqrt(Math.max(0, 1 - s * s));
      return Math.min(1, 0.12 + 0.88 * Math.max(0, nx * -0.62 + ny * -0.62 + nz * 0.48));
    };
    const headMid = toScreen(dir, 0.2 * R, 0);
    const brimMid = toScreen(dir, u0, 0);
    const capMid = toScreen(dir, -0.8 * R, sway * 0.12 * R);
    return bakeShape(
      st.size,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (kind === 'salamander') return salamanderHead(u, v, R);
        if (st.hatless) return ((u - 0.1 * R) / (1.35 * R)) ** 2 + (v / (1.05 * R)) ** 2 <= 1 ? 'head' : null;
        const head = () => (H ? snakeHead(u, v, R, big) : (u / (1.2 * R)) ** 2 + (v / R) ** 2 <= 1 ? 'head' : null);
        if (st.crown) return crownRegion(st.crown, u, v, R, sway) ?? head();
        if (Math.abs(u - tipU) + Math.abs(v - bend) <= starSize) return 'star';
        if (u <= u0 + 0.5 && u >= tipU) {
          const t = (u0 - u) / (u0 - tipU);
          const half = 0.72 * R * Math.pow(1 - t, 0.85) + 0.35;
          if (Math.abs(v - bend * t * t) <= half) return t > band[0] && t < band[1] ? 'band' : 'hat';
        }
        // A foe's brim is a little smaller, so more of its face shows in front of it.
        const [brimU, brimA, brimB] = H ? [u0 - 0.1 * R, 0.72 * R, 1.1 * R] : [u0, 0.85 * R, 1.2 * R];
        if (((u - brimU) / brimA) ** 2 + (v / brimB) ** 2 <= 1) return 'brim';
        return head();
      },
      (r, e, x, y, i, j) => {
        if (variant === 'flash') return r === 'nostril' ? PX.flash : shade(e, FLASH);
        if (kind === 'salamander') {
          if (r === 'nostril') return PX.ink;
          if (r === 'crest') return e === 'lit' ? SALAMANDER5[2] : SALAMANDER5[1];
          if (r === 'ember') return e === 'shade' ? PX.flame0 : PX.flame1;
          const c = toScreen(dir, 0.25 * R, 0);
          return SALAMANDER5[rampStep(domeLight(x, y, c.x, c.y, 1.15 * R), 4, i, j)];
        }
        if (!H) {
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
        }
        if (r === 'nostril') return PX.ink;
        if (r === 'head') return H[1 + rampStep(domeLight(x, y, headMid.x, headMid.y, 1.25 * R), 4, i, j)];
        if (st.crown === 'cap') {
          if (r === 'star' || r === 'sproutSpot') return '#fff4fb';
          if (r === 'spotShade') return PX.cap1;
          if (r === 'band') return e === 'shade' ? PX.teal1 : PX.teal2;
          if (r === 'brim') return PX.teal0;
          if (r === 'sprout') return e === 'lit' ? PX.cap3 : e === 'shade' ? PX.cap1 : PX.cap2;
          // The cap: deep magenta, rounded in smooth bands, one small highlight.
          const light = domeLight(x, y, capMid.x, capMid.y, 1.25 * R);
          if (light > 0.92) return '#ffc8ee';
          return [PX.cap1, PX.cap2, PX.cap3][rampStep(light, 3, i, j)];
        }
        if (st.crown === 'crest') {
          if (r === 'star') return e === 'shade' ? PX.ice3 : PX.white;
          return r === 'brim' ? shade(e, [PX.ice1, PX.ice2, PX.ice0]) : shade(e, [PX.ice2, PX.ice3, PX.ice1]);
        }
        if (r === 'star') return e === 'shade' ? st.star[0] : st.star[1];
        if (r === 'brim') return steps3(st.brim)[rampStep(domeLight(x, y, brimMid.x, brimMid.y, 1.3 * R), 3, i, j)];
        // The cone (and the band round it), shaded across its curve.
        const { u, v } = toLocal(x, y);
        const t = Math.max(0, Math.min(1, (u0 - u) / (u0 - tipU)));
        const half = 0.72 * R * Math.pow(1 - t, 0.85) + 0.35;
        const k = rampStep(coneLight(Math.max(-1, Math.min(1, (v - bend * t * t) / half))), 3, i, j);
        return steps3(r === 'band' ? st.band : st.hat)[k];
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
/** The jewel in the middle of a marked segment, dark to light, and how big it is (share of the radius). */
const SPOT: Partial<Record<SegmentStyle, [readonly [string, string, string], number]>> = {
  bossSpot: [[PX.gold0, PX.gold1, PX.gold2], 0.38],
  pyreSpot: [[PX.hostile1, PX.flame0, PX.flame1], 0.38],
  sporeSpot: [[PX.cap1, PX.cap2, PX.cap3], 0.46],
  rimeSpot: [[PX.ice2, PX.ice3, PX.white], 0.36],
  salamanderStripe: [[PX.hostile1, PX.flame0, PX.flame1], 0.34],
};
/** Foes' segments, shaded round like scales, darkest to brightest. (The player's come from its wizard's colours.) */
const ROUNDED: Partial<Record<SegmentStyle, readonly [string, string, string, string]>> = {
  salamander: [SALAMANDER5[0], SALAMANDER5[1], SALAMANDER5[2], SALAMANDER5[3]],
  salamanderStripe: [SCORCHED5[0], SCORCHED5[1], SCORCHED5[2], SCORCHED5[3]],
  rival: [PX.rival0, PX.rival1, PX.rival2, PX.rival3],
  rivalStripe: ['#24060f', PX.rival0, PX.rival1, PX.rival2],
  boss: [PX.boss1, PX.boss2, PX.boss3, PX.bossHi],
  bossSpot: [PX.boss0, PX.boss1, PX.boss2, PX.boss3],
  pyre: ['#1e0c08', '#3a1a14', '#5a2a1e', '#7a3a28'],
  pyreSpot: ['#140806', '#1e0c08', '#3a1a14', '#5a2a1e'],
  spore: ['#155246', '#1e6a5c', '#38a890', '#6ad0b8'],
  sporeSpot: ['#0a2a26', '#155246', '#1e6a5c', '#38a890'],
  rime: [PX.ice0, PX.ice1, PX.ice2, PX.ice3],
  rimeSpot: [PX.hood1, PX.ice0, PX.ice1, PX.ice2],
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
      (region, e, x, y, i, j) => {
        if (region === 'spot' && spot) return e === 'lit' ? spot[0][2] : spot[0][rampStep(domeLight(x, y, 0, 0, r * spot[1] + 0.5), 3, i, j)];
        const round = own || style === 'hurt' ? steps4(ramp) : ROUNDED[style];
        if (round) return round[rampStep(domeLight(x, y, 0, 0, r + 0.8), 4, i, j)];
        return shade(e, ramp);
      },
      null,
    ),
  );
}

// ---------------------------------------------------------------- burrowing (Burrow Viper, Sporemaw)

const DIRT5: Ramp5 = [PX.dirt0, PX.dirt1, PX.dirt2, PX.dirt3, '#b8905c'];

export const MOUND_FRAMES = 2;
/** Heaped earth over something tunnelling just below: a lumpy dome with clods, lit like everything else. */
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
      (region, _e, x, y, i, j) => {
        const k = rampStep(domeLight(x, y, 0, 0, r + 0.5), 4, i, j);
        return DIRT5[region === 'clod' ? Math.min(4, k + 1) : k];
      },
      PX.dirt0,
    ),
  );
}

// ---------------------------------------------------------------- the Hollows' foes

const PUFF5: Ramp5 = [PX.puff0, PX.puff1, PX.puff2, PX.puff3, '#fff6fc'];
const HIDE5: Ramp5 = ['#141a0c', '#232a18', '#3e4a2c', '#5e6e3e', '#80924e'];
const BARK5: Ramp5 = [PX.bark0, PX.bark1, PX.bark2, PX.bark3, '#a8806a'];
const SCALE5: Ramp5 = ['#2e2010', '#4e3820', '#7a5c34', '#a8844e', '#d4b072'];

const SPORELING_SPOTS: [number, number][] = [
  [-0.35, -0.38],
  [0.42, -0.1],
  [-0.08, 0.45],
];
/**
 * Sporeling: a tiny magenta toadstool seen from above, its cap rounded from a bright crown to a
 * deep rim, pale spots on it. `squash` 1 is the landing (wide and flat), -1 is mid-hop (a touch
 * narrow), 0 standing.
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
      (r, e, x, y, i, j) => {
        if (flash) return shade(e, FLASH);
        if (r === 'spot') return PX.spot;
        return CAP5[rampStep(domeLight(x, y, 0, 0, R * sx + 0.5, R * sy + 0.5), 4, i, j)];
      },
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
/**
 * Puffcap: a squat puffball, rounded and soft, studded with warts that each catch the light, and a
 * pore on top in a darker lip, swelling (0 to 3) as it gathers spores; the pore glows as it fills.
 */
export function puffcap(swell: number, flash: boolean): Sprite {
  return cached(`puffcap:${swell}:${flash}`, () => {
    const R = (ENEMIES.puffcap.radius / P) * (1 + swell * 0.1);
    const pore = 1.2 + swell * 0.25;
    return bakeShape(
      22,
      (x, y) => {
        if (Math.hypot(x, y * 1.08) > R) return null;
        const fromPore = Math.hypot(x + 0.4, y + 0.6);
        if (fromPore <= pore) return 'pore';
        if (fromPore <= pore + 0.8) return 'lip';
        for (const [wx, wy] of PUFF_WARTS) if (Math.hypot(x - wx * R, y - wy * R) <= 0.75) return 'wart';
        return 'body';
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'pore' ? PX.flash : shade(e, FLASH);
        if (r === 'pore') return swell >= 2 ? PX.spore2 : swell === 1 ? PX.spore1 : PX.puff0;
        const k = rampStep(domeLight(x, y, 0, 0, R + 0.5), 5, i, j);
        if (r === 'lip') return PUFF5[Math.max(0, k - 2)];
        if (r === 'wart') return PUFF5[Math.max(0, k - 1)];
        return PUFF5[Math.max(1, k)];
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

/**
 * Thornback: a hulking beast with clumps of moss over its back, a ridge of magenta thorns down its
 * spine and more along its flanks, each dark at its root and bright at its tip (white-hot while it
 * charges), and a broad head of bark in front.
 */
export function thornback(dir: number, hot: boolean, flash: boolean): Sprite {
  return cached(`thornback:${dir}:${hot}:${flash}`, () => {
    const R = ENEMIES.thornback.radius / P;
    const toLocal = local(dir);
    const flank: [number, number, number, number][] = [];
    for (const us of [0.3, -0.2, -0.7]) for (const s of [-1, 1]) flank.push([us * R, s * 0.72 * R, (us - 0.5) * R, s * 1.28 * R]);
    const thornTones = hot ? [PX.thorn2, PX.thorn3, PX.white] : [PX.thorn1, PX.thorn2, PX.thorn3];
    // The head's middle on screen, so it is lit as a rounded thing of its own.
    const theta = (dir / DIRECTIONS) * TAU;
    const headX = Math.cos(theta) * 0.95 * R;
    const headY = Math.sin(theta) * 0.95 * R;
    return bakeShape(
      32,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        // The ridge: thorns down the spine, each pointing back; `saw` runs from tip (0) to root (1).
        if (u > -1.2 * R && u < 0.45 * R) {
          const saw = ((((u + 1.2 * R) % 3.4) + 3.4) % 3.4) / 3.4;
          if (Math.abs(v) <= 0.36 * R * saw) return saw < 0.45 ? 'tip' : 'thorn';
        }
        for (const [ax, ay, bx, by] of flank) {
          const h = segmentHit(u, v, ax, ay, bx, by);
          if (h.d <= 1.1 * (1 - h.t) + 0.3) return h.t > 0.5 ? 'tip' : 'thorn';
        }
        if (((u - 0.95 * R) / (0.42 * R)) ** 2 + (v / (0.5 * R)) ** 2 <= 1) return 'head';
        if ((u / (1.1 * R)) ** 2 + (v / (0.85 * R)) ** 2 <= 1) {
          // Moss in clumps over the hide, fixed to the body so they turn with it.
          return hash2(Math.floor(u / 2.2 + 20), Math.floor(v / 2.2 + 20), 77) < 0.3 ? 'moss' : 'hide';
        }
        return null;
      },
      (r, e, x, y, i, j) => {
        if (flash) return shade(e, FLASH);
        if (r === 'tip') return thornTones[2];
        if (r === 'thorn') return e === 'lit' ? thornTones[1] : thornTones[0];
        if (r === 'head') return BARK5[1 + rampStep(domeLight(x, y, headX, headY, 0.6 * R), 4, i, j)];
        const k = rampStep(domeLight(x, y, 0, 0, 1.2 * R), 4, i, j);
        return HIDE5[r === 'moss' ? k + 1 : Math.max(1, k)];
      },
      PX.ink,
    );
  });
}

export const VIPER_FRAMES = 2;
/**
 * Burrow Viper: a sandy viper in an S-curve, rounded like a tube along its length, dark diamonds
 * down its back, and a broad wedge of a head with a blunt snout.
 */
export function viper(dir: number, frame: number, flash: boolean): Sprite {
  return cached(`viper:${dir}:${frame}:${flash}`, () => {
    const R = ENEMIES.burrowViper.radius / P;
    const toLocal = local(dir);
    const theta = (dir / DIRECTIONS) * TAU;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    // The spine, from the neck back to the tip of the tail, in the viper's frame and on screen.
    const spine: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      spine.push([0.45 * R - k * 2.0 * R, Math.sin(k * TAU * 0.85 + frame * Math.PI) * 0.45 * R * (0.35 + 0.65 * k)]);
    }
    const onScreen = spine.map(([u, v]) => [u * c - v * s, u * s + v * c] as const);
    const headWidth = (u: number) => {
      if (u < 0.3 * R || u > 1.35 * R) return -1;
      return u < 0.75 * R ? 0.22 * R + ((u - 0.3 * R) / (0.45 * R)) * 0.36 * R : 0.58 * R - ((u - 0.75 * R) / (0.6 * R)) * 0.33 * R;
    };
    return bakeShape(
      28,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        const hw = headWidth(u);
        if (hw > 0 && Math.abs(v) <= hw) return 'head';
        for (let i = 1; i < spine.length; i++) {
          const [ax, ay] = spine[i - 1];
          const [bx, by] = spine[i];
          const h = segmentHit(u, v, ax, ay, bx, by);
          const k = (i - 1 + h.t) / (spine.length - 1);
          const w = 0.34 * R * (1 - 0.65 * k) + 0.35;
          if (h.d > w) continue;
          const beat = (k * 7) % 1;
          return h.d < w * 0.6 && beat > 0.3 && beat < 0.75 ? 'mark' : 'body';
        }
        return null;
      },
      (r, e, x, y, i, j) => {
        if (flash) return shade(e, FLASH);
        if (r === 'head') return SCALE5[1 + rampStep(domeLight(x, y, c * 0.7 * R, s * 0.7 * R, 0.6 * R), 4, i, j)];
        // Shade across the body as across a tube: light from where the pixel lies off the spine.
        let best = Infinity;
        let nx = 0;
        let ny = 0;
        let w = 1;
        for (let n = 1; n < onScreen.length; n++) {
          const [ax, ay] = onScreen[n - 1];
          const [bx, by] = onScreen[n];
          const h = segmentHit(x, y, ax, ay, bx, by);
          if (h.d < best) {
            best = h.d;
            nx = ax + h.t * (bx - ax);
            ny = ay + h.t * (by - ay);
            w = 0.34 * R * (1 - 0.65 * ((n - 1 + h.t) / (onScreen.length - 1))) + 0.35;
          }
        }
        const k = rampStep(domeLight(x, y, nx, ny, w + 0.6), 5, i, j);
        return r === 'mark' ? SCALE5[1] : SCALE5[Math.max(2, k)];
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- the Catacombs' foes

const BONE4 = [PX.bone0, PX.bone1, PX.bone2, PX.bone3] as const;
const HOOD4 = [PX.hood0, PX.hood1, PX.hood2, PX.hood3] as const;
const ICE4 = [PX.ice1, PX.ice2, PX.ice3, PX.white] as const;
const CRYPT5: Ramp5 = [PX.crypt0, PX.crypt1, PX.crypt2, PX.crypt3, '#a8b4cc'];
const SPECTRE4 = [PX.spectre0, PX.spectre1, PX.spectre2, PX.spectre3] as const;

export const RATTLER_FRAMES = 2;
/**
 * Bone Rattler: a skeleton from above: a rounded skull, the brightest of it, with dark
 * sockets (its eyes are drawn in them), a spine, two pairs of ribs straight across it with the floor
 * showing between them, a pelvis,
 * and arms reaching and legs swinging with each step, knobbed at the ends.
 */
export function rattler(dir: number, frame: number, flash: boolean): Sprite {
  return cached(`rattler:${dir}:${frame}:${flash}`, () => {
    const R = ENEMIES.rattler.radius / P;
    const toLocal = local(dir);
    const swing = frame === 0 ? 0.2 * R : -0.2 * R;
    const limbs: [number, number, number, number][] = [
      [0.05 * R, -0.6 * R, 0.55 * R + swing, -1.05 * R],
      [0.05 * R, 0.6 * R, 0.55 * R - swing, 1.05 * R],
      [-1.55 * R, -0.3 * R, -2.1 * R - swing, -0.6 * R],
      [-1.55 * R, 0.3 * R, -2.1 * R + swing, 0.6 * R],
    ];
    const skull = toScreen(dir, 0.5 * R, 0);
    const sockets = [-1, 1].map((s) => [0.55 * R * Math.cos(0.45), s * 0.55 * R * Math.sin(0.45)]);
    return bakeShape(
      28,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if ((u - 0.5 * R) ** 2 + v * v <= (0.62 * R) ** 2) {
          for (const [su, sv] of sockets) if (Math.hypot(u - su, v - sv) <= 0.9) return 'socket';
          return 'skull';
        }
        // Bones a pixel and a half thick, with as much floor between them, so they stay whole and
        // apart when turned to a diagonal.
        if (Math.abs(v) <= 0.6 && u > -1.55 * R && u < 0.1 * R) return 'bone';
        for (const [i, ub] of [-0.38, -0.98].entries()) {
          if (Math.abs(u - ub * R) <= 0.75 && Math.abs(v) <= 0.68 * R * (1 - 0.15 * i)) return 'bone';
        }
        if (((u + 1.55 * R) / (0.24 * R)) ** 2 + (v / (0.45 * R)) ** 2 <= 1) return 'bone';
        for (const [ax, ay, bx, by] of limbs) {
          if (segmentHit(u, v, ax, ay, bx, by).d <= 0.7 || Math.hypot(u - bx, v - by) <= 1) return 'bone';
        }
        return null;
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'socket' ? PX.flash : shade(e, FLASH);
        if (r === 'socket') return PX.ink;
        // The skull, rounded by its own light, is the brightest of it whichever way it faces; the
        // other bones keep one even tone, lit along one edge and shaded along the other.
        if (r === 'skull') return BONE4[2 + rampStep(domeLight(x, y, skull.x, skull.y, 0.7 * R), 2, i, j)];
        return shade(e, [PX.bone2, PX.bone3, PX.bone1]);
      },
      PX.ink,
      3,
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
      (_, e, x, y, i, j) => (flash ? shade(e, FLASH) : BONE4[1 + rampStep(domeLight(x, y, 0, 0, 7), 3, i, j)]),
      PX.ink,
    );
  });
}

/** A Bone Rattler's skull, looking up from its pile. */
export function skull(flash: boolean): Sprite {
  return cached(`skull:${flash}`, () =>
    gridSprite(['.kkkk.', 'kLWWWk', 'kbWWbk', 'kWWWDk', '.kWDk.', '..kk..'], {
      k: PX.ink,
      L: flash ? PX.white : PX.bone3,
      W: flash ? PX.white : PX.bone2,
      D: flash ? PX.flash : PX.bone1,
      b: PX.ink,
    }),
  );
}

/**
 * Frost Archer: a skeleton in a frost-blue hood seen from above, the hood's crown lighter over its
 * shoulders and its cloak trailing behind, its pale skull of a face with dark sockets (its eyes are
 * drawn in them), and an ice bow held out in front, bright along its top. While it draws, the
 * string comes back with an icicle nocked.
 */
export function frostArcher(dir: number, drawn: boolean, flash: boolean): Sprite {
  return cached(`frostArcher:${dir}:${drawn}:${flash}`, () => {
    const R = ENEMIES.frostArcher.radius / P;
    const toLocal = local(dir);
    // The bow is held out in front, clear of the body: a shallow arc, its string straight between
    // its tips until it is drawn back to the face.
    const bowR = 1.9 * R;
    const bowU = -0.35 * R;
    const end = 0.55;
    const tipU = bowU + bowR * Math.cos(end);
    const tipV = bowR * Math.sin(end);
    const nock = drawn ? 0.35 * R : tipU;
    const face = toScreen(dir, 0.3 * R, 0);
    return bakeShape(
      28,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (drawn && u > nock && u < 1.9 * R && Math.abs(v) <= 0.5 * Math.min(1, (1.9 * R - u) / (0.4 * R))) return 'arrow';
        const a = Math.atan2(v, u - bowU);
        if (Math.abs(a) <= end && Math.abs(Math.hypot(u - bowU, v) - bowR) <= 0.6) return 'bow';
        for (const s of [-1, 1]) if (segmentHit(u, v, tipU, s * tipV, nock, 0).d <= 0.4) return 'string';
        if ((u - 0.3 * R) ** 2 + v * v <= (0.5 * R) ** 2) {
          for (const s of [-1, 1]) if (Math.hypot(u - 0.3 * R, v - s * 1.2) <= 0.8) return 'socket';
          return 'face';
        }
        const inRobe = x * x + y * y <= R * R || (u < 0 && u >= -1.6 * R && Math.abs(v) <= 0.8 * R * (1 + u / (1.6 * R)));
        if (!inRobe) return null;
        return (u - 0.05 * R) ** 2 + v * v <= (0.8 * R) ** 2 ? 'crown' : 'robe';
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'socket' ? PX.flash : shade(e, FLASH);
        switch (r) {
          case 'arrow':
            return shade(e, [PX.ice3, PX.white, PX.ice2]);
          case 'bow':
            return e === 'lit' ? ICE4[3] : e === 'shade' ? ICE4[0] : ICE4[2];
          case 'string':
            return PX.bone1;
          case 'socket':
            return PX.ink;
          case 'face':
            return BONE4[1 + rampStep(domeLight(x, y, face.x, face.y, 0.6 * R), 3, i, j)];
          case 'crown':
            return HOOD4[1 + rampStep(domeLight(x, y, 0, 0, 1.25 * R), 3, i, j)];
          default:
            return HOOD4[rampStep(domeLight(x, y, 0, 0, 1.25 * R), 3, i, j)];
        }
      },
      PX.ink,
    );
  });
}

/**
 * Crypt Golem: a block of frozen crypt stone seen from above, the light sloping gently across its
 * back, rime in clumps over it, a smaller block of a head at the front set off by a seam (its eyes
 * are drawn on top), faceted ice crystals on its shoulders, and cold cracks that blaze while it
 * winds up.
 */
export function golem(dir: number, hot: boolean, flash: boolean): Sprite {
  return cached(`golem:${dir}:${hot}:${flash}`, () => {
    const R = ENEMIES.golem.radius / P;
    const r = R * 0.92;
    const rc = 3;
    const toLocal = local(dir);
    const cracks: [number, number, number, number][] = [
      [-0.55 * r, -0.4 * r, -0.05 * r, -0.05 * r],
      [-0.05 * r, -0.05 * r, -0.35 * r, 0.55 * r],
      [-0.75 * r, 0.25 * r, -0.4 * r, 0.7 * r],
    ];
    const crystals: [number, number, number, number][] = [
      [-0.05 * R, -0.74 * R, 0.36 * R, 0.24 * R],
      [-0.05 * R, 0.74 * R, 0.36 * R, 0.24 * R],
      [-0.45 * R, -0.62 * R, 0.24 * R, 0.17 * R],
      [-0.45 * R, 0.62 * R, 0.24 * R, 0.17 * R],
    ];
    const centres = crystals.map(([cu, cv]) => toScreen(dir, cu, cv));
    return bakeShape(
      34,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        for (const [n, [cu, cv, au, av]] of crystals.entries()) if (Math.abs(u - cu) / au + Math.abs(v - cv) / av <= 1) return `ice${n}`;
        const dx = Math.max(Math.abs(u) - (r - rc), 0);
        const dy = Math.max(Math.abs(v) - (r - rc), 0);
        if (dx * dx + dy * dy > rc * rc) return null;
        if (u > 0.36 * r && Math.abs(v) <= 0.42 * r) return u < 0.36 * r + 0.7 || Math.abs(v) > 0.42 * r - 0.7 ? 'seam' : 'head';
        for (const [ax, ay, bx, by] of cracks) if (distToSegment(u, v, ax, ay, bx, by) <= 0.55) return 'crack';
        return hash2(Math.floor(u / 2.4 + 30), Math.floor(v / 2.4 + 30), 91) < 0.13 ? 'rime' : 'body';
      },
      (region, e, x, y, i, j) => {
        if (flash) return region === 'crack' ? PX.flash : shade(e, FLASH);
        if (region === 'crack') return hot ? PX.rimeGlow : PX.ice1;
        if (region.startsWith('ice')) {
          // Each crystal is faceted: the face toward the light bright, the other dim.
          const c = centres[Number(region.slice(3))];
          return e === 'lit' ? ICE4[3] : x - c.x + (y - c.y) < 0 ? ICE4[2] : ICE4[0];
        }
        if (region === 'rime') return e === 'shade' ? PX.crypt3 : '#b8c8e0';
        const k = rampStep(Math.max(0, Math.min(1, 0.38 - (x + y) / (4.2 * r))), 4, i, j);
        if (region === 'seam') return CRYPT5[Math.max(1, k)];
        return shade(e, [CRYPT5[1 + k], CRYPT5[Math.min(4, 2 + k)], CRYPT5[Math.max(1, k)]]);
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
      (r, e, x, y, i, j) => {
        if (flash) return shade(e, FLASH);
        if (r === 'knuckle') return e === 'lit' ? ICE4[3] : ICE4[1];
        return CRYPT5[1 + rampStep(domeLight(x, y, 0, 0, h + 1), 3, i, j)];
      },
      PX.ink,
    );
  });
}

export const WRAITH_FRAMES = 4;
/**
 * Wraith: a hooded spectre, its hood rounded and palest on top, trailing a tattered cloak that
 * dims from the hood back and fades out in a dither. `phased` (inside stone) leaves only every
 * other pixel and no outline, so it shows faintly through the rock.
 */
export function wraith(dir: number, frame: number, phased: boolean, flash: boolean): Sprite {
  return cached(`wraith:${dir}:${frame}:${phased}:${flash}`, () => {
    const R = ENEMIES.wraith.radius / P;
    const toLocal = local(dir);
    const size = 32;
    const hood = toScreen(dir, 0.35 * R, 0);
    return bakeShape(
      size,
      (x, y) => {
        const i = Math.round(x + size / 2 - 0.5);
        const j = Math.round(y + size / 2 - 0.5);
        if (phased && (i + j) % 2 === 1) return null;
        const { u, v } = toLocal(x, y);
        if ((u - 0.55 * R) ** 2 + v * v <= (0.32 * R) ** 2) return 'face';
        if ((u - 0.35 * R) ** 2 + v * v <= (0.62 * R) ** 2) return 'hood';
        for (const s of [-1, 1]) if (segmentHit(u, v, 0.1 * R, s * 0.55 * R, 0.8 * R, s * 1.05 * R).d <= 0.5) return 'sleeve';
        if (u > 0.4 * R || u < -2.2 * R) return null;
        const t = (0.4 * R - u) / (2.6 * R);
        const wave = Math.sin(t * 5 + frame * (Math.PI / 2)) * 0.35 * R * t;
        const tatter = t > 0.55 ? 0.75 + 0.25 * Math.sin(t * 22 + frame * 1.7 + v) : 1;
        if (Math.abs(v - wave) > 0.78 * R * Math.pow(1 - t, 0.8) * tatter) return null;
        // The cloak thins to nothing towards its tail.
        if (t > 0.5 && bayer(i, j) > (1 - t) * 2) return null;
        return t < 0.3 ? 'cloak' : 'tail';
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'face' ? PX.flash : shade(e, FLASH);
        if (r === 'face') return PX.spectre0;
        if (r === 'hood') return SPECTRE4[1 + rampStep(domeLight(x, y, hood.x, hood.y, 0.7 * R), 3, i, j)];
        if (r === 'tail') return e === 'lit' ? SPECTRE4[2] : SPECTRE4[1];
        return e === 'shade' ? SPECTRE4[1] : e === 'lit' ? SPECTRE4[3] : SPECTRE4[2];
      },
      phased ? null : PX.spectre0,
    );
  });
}

// ---------------------------------------------------------------- chaser ("Gloomling")

/** Two spikes' worth of turning, so a long spike comes round to where a long one was. */
export const CHASER_FRAMES = 8;

const GLOOM: Ramp5 = [PX.crim0, PX.crim1, PX.crim2, PX.crim3, '#ffc2d0'];
const CINDER: Ramp5 = ['#5a1406', PX.hostile1, PX.hostile2, PX.hostile3, PX.flame2];

/**
 * Spiky crimson blob, its spikes long and short by turns; frames turn them so it appears to churn
 * as it chases. Its dark face sits (fx, fy) pixels off centre, toward where it is heading, with
 * room for both eyes and a dark pixel either side, so neither eye ever lands on the bright body.
 */
export function chaser(frame: number, flash: boolean, imp = false, fx = 0, fy = 0): Sprite {
  return cached(`chaser:${frame}:${flash}:${imp}:${fx}:${fy}`, () => {
    // A Cinder Imp is smaller, with fewer flames for spikes, all long and brightening to their
    // tips, and a fuller body round the same face (so the face, shifted, still stops short of its rim).
    const R = (imp ? ENEMIES.imp.radius : ENEMIES.chaser.radius) / P;
    const spikes = imp ? 6 : 10;
    const step = TAU / spikes;
    const phase = (frame / CHASER_FRAMES) * 2 * step;
    const inner = (imp ? 0.95 : 0.85) * R;
    const outer = 1.35 * R;
    const face = 2.6;
    const ramp = imp ? CINDER : GLOOM;
    return bakeShape(
      20,
      (x, y) => {
        if (Math.hypot(x - fx, y - fy) <= face) return 'core';
        const d = Math.hypot(x, y);
        if (d <= inner) return 'body';
        const a = Math.atan2(y, x);
        const n = Math.round((a - phase) / step);
        const long = imp || ((n % 2) + 2) % 2 === 0 ? 1 : 0.6;
        const k = Math.pow((1 + Math.cos(spikes * (a - phase))) / 2, 3) * long;
        return d <= inner + (outer - inner) * k ? 'spike' : null;
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'core' ? PX.flash : shade(e, FLASH);
        if (r === 'core') return imp ? '#3a0e06' : PX.crim0;
        const light = domeLight(x, y, 0, 0, outer);
        if (r === 'spike' && imp) return ramp[Math.min(4, 2 + Math.floor(((Math.hypot(x, y) - inner) / (outer - inner)) * 3))];
        if (r === 'spike') return ramp[1 + rampStep(light, 3, i, j)];
        return ramp[rampStep(light, 5, i, j)];
      },
      PX.ink,
    );
  });
}

// ---------------------------------------------------------------- caster ("Hex Acolyte")

const HEX_ROBE: Ramp5 = [PX.robe0, PX.robe1, PX.robe2, PX.robe3, '#ffb4e6'];
const PYRE_ROBE: Ramp5 = ['#2a0a04', '#4a1206', '#8a2a10', '#c8501c', '#ff8a4a'];

/**
 * A hooded robe seen from above: the hood's crown, lighter, over darker shoulders, its point
 * trailing behind with a fold down it, and a dark face opening in front. A Pyromancer wears
 * scorched red.
 */
export function caster(dir: number, flash: boolean, pyro = false): Sprite {
  return cached(`caster:${dir}:${flash}:${pyro}`, () => {
    const R = ENEMIES.caster.radius / P;
    const toLocal = local(dir);
    const robe = pyro ? PYRE_ROBE : HEX_ROBE;
    return bakeShape(
      26,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (((u - 0.45 * R) / (0.45 * R)) ** 2 + (v / (0.52 * R)) ** 2 <= 1) return 'face';
        const inBody = x * x + y * y <= R * R;
        const inTail = u < 0 && u >= -1.75 * R && Math.abs(v) <= 0.8 * R * (1 + u / (1.75 * R));
        if (!inBody && !inTail) return null;
        if ((u - 0.05 * R) ** 2 + v * v <= (0.78 * R) ** 2) return 'crown';
        if (u < -0.75 * R && Math.abs(v) <= 0.5) return 'fold';
        return 'robe';
      },
      (r, e, x, y, i, j) => {
        if (flash) return r === 'face' ? PX.flash : shade(e, FLASH);
        if (r === 'face') return PX.ink;
        const light = domeLight(x, y, 0, 0, 1.25 * R);
        if (r === 'crown') return robe[2 + rampStep(light, 3, i, j)];
        if (r === 'fold') return robe[1];
        return robe[1 + rampStep(light, 3, i, j)];
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

const RUIN_STONE: Ramp5 = [PX.golem0, PX.golem1, PX.golem2, PX.golem3, '#b8b0cc'];
const CHAR_STONE: Ramp5 = ['#140806', '#2a120c', '#3a1a14', '#5a2a1e', '#7a3a28'];

/**
 * A golem of ruin stone seen from above: a rounded block of stone plates with a boulder for each
 * shoulder, a smaller block of a head at the front where its eyes sit (drawn on top), moss on its back, and
 * glowing cracks over its back and flanks that run hot while it winds up and charges. A Magma Brute
 * is cooled black rock, no moss, its cracks always aglow.
 */
export function brute(dir: number, hot: boolean, flash: boolean, magma = false): Sprite {
  return cached(`brute:${dir}:${hot}:${flash}:${magma}`, () => {
    const r = (magma ? ENEMIES.magmaBrute.radius : ENEMIES.brute.radius) / P;
    const rc = 2.5;
    const toLocal = local(dir);
    const cracks: [number, number, number, number][] = [
      [-0.7 * r, -0.4 * r, -0.2 * r, -0.05 * r],
      [-0.2 * r, -0.05 * r, -0.5 * r, 0.55 * r],
      [-0.05 * r, 0.8 * r, -0.3 * r, 0.45 * r],
      [0.05 * r, -0.8 * r, -0.25 * r, -0.55 * r],
    ];
    const seams: [number, number, number, number][] = [
      [-0.15 * r, -0.95 * r, -0.15 * r, 0.95 * r],
      [-0.95 * r, 0.1 * r, -0.15 * r, 0.1 * r],
    ];
    const moss: [number, number, number][] = [
      [-0.55 * r, -0.45 * r, 1.5],
      [-0.65 * r, 0.5 * r, 1.2],
      [-0.1 * r, 0.6 * r, 1],
    ];
    const shoulder = 0.36 * r;
    const stone = magma ? CHAR_STONE : RUIN_STONE;
    return bakeShape(
      30,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        const dx = Math.max(Math.abs(u) - (r - rc), 0);
        const dy = Math.max(Math.abs(v) - (r - rc), 0);
        const inBody = dx * dx + dy * dy <= rc * rc;
        if (!inBody) {
          for (const s of [-1, 1]) if ((u - 0.05 * r) ** 2 + (v - s * 0.88 * r) ** 2 <= shoulder * shoulder) return 'shoulder';
          return null;
        }
        // The head: a smaller block at the front, set off by a seam, where the eyes sit.
        if (u > 0.2 * r && Math.abs(v) <= 0.52 * r) return u < 0.2 * r + 0.7 || Math.abs(v) > 0.52 * r - 0.7 ? 'seam' : 'head';
        for (const [ax, ay, bx, by] of cracks) if (distToSegment(u, v, ax, ay, bx, by) <= 0.55) return 'crack';
        if (!magma) for (const [mu, mv, mr] of moss) if (Math.hypot(u - mu, v - mv) <= mr) return 'moss';
        for (const [ax, ay, bx, by] of seams) if (distToSegment(u, v, ax, ay, bx, by) <= 0.45) return 'seam';
        return 'body';
      },
      (region, e, x, y, i, j) => {
        if (flash) return region === 'crack' ? PX.flash : shade(e, FLASH);
        if (region === 'crack') return hot ? PX.crackHot : magma ? PX.flame0 : PX.crack;
        if (region === 'moss') return e === 'lit' ? PX.moss1 : PX.moss0;
        // Its back is nearly flat, so the light only slopes gently across it, lit edge to shaded.
        const k = rampStep(Math.max(0, Math.min(1, 0.3 - (x + y) / (3.6 * r))), 4, i, j);
        if (region === 'seam') return stone[Math.max(1, k)];
        if (region === 'head') return shade(e, [stone[1 + k], stone[Math.min(4, 2 + k)], stone[Math.max(1, k)]]);
        return shade(e, [stone[1 + k], stone[Math.min(4, 2 + k)], stone[Math.max(1, k)]]);
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

export const SHOT_FRAMES = 4;
/**
 * Hostile orb: a fireball rounded from a pale top-left to a deep bottom-right round a white-hot
 * core, a twinkle turning on it, and a dark rim so it reads against every friendly effect; it
 * swells and settles as it flies.
 */
export function shot(r: number, frame: number): Sprite {
  return cached(`shot:${r}:${frame}`, () => {
    const rr = r + (frame % 2) * 0.6;
    const cross = frame >= 2;
    return bakeShape(
      2 * r + 6,
      (x, y) => {
        const d2 = x * x + y * y;
        if (d2 <= (rr * 0.42) ** 2) return 'core';
        if (r >= 3 && d2 <= (rr + 0.25) ** 2) {
          // A twinkle: a short cross, upright or turned, through the core.
          const ax = cross ? Math.abs(x + y) / Math.SQRT2 : Math.abs(x);
          const ay = cross ? Math.abs(x - y) / Math.SQRT2 : Math.abs(y);
          if (Math.min(ax, ay) < 0.5 && Math.max(ax, ay) < rr * 0.85) return 'twinkle';
        }
        return d2 <= (rr + 0.25) ** 2 ? 'b' : null;
      },
      (region, _e, x, y, i, j) => {
        if (region === 'core') return PX.hostile4;
        if (region === 'twinkle') return PX.hostile3;
        return [PX.hostile1, PX.hostile2, PX.hostile3][rampStep(domeLight(x, y, 0, 0, rr + 0.5), 3, i, j)];
      },
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

/**
 * An icicle in flight along heading `dir`: a long thin shard with a dark rim, its two faces down
 * its length lit as faceted ice (the one turned to the light pale, the other a deeper blue) and its
 * point white.
 */
export function icicleShot(r: number, dir: number): Sprite {
  return cached(`icicle:${r}:${dir}`, () => {
    const toLocal = local(dir);
    const front = 1.9 * r;
    const back = 2.6 * r;
    const theta = (dir / DIRECTIONS) * TAU;
    return bakeShape(
      Math.ceil(2 * back) + 4,
      (x, y) => {
        const { u, v } = toLocal(x, y);
        if (u > front || u < -back) return null;
        const w = u >= 0 ? 0.55 * r * (1 - u / front) : 0.55 * r * (1 + u / back);
        if (Math.abs(v) > w + 0.35) return null;
        if (u > front * 0.55) return 'tip';
        return v < 0 ? 'left' : 'right';
      },
      (region, e) => {
        if (region === 'tip') return PX.white;
        // A face's outward side, (0, s) in the shard's frame, turned to the screen and met with the light.
        const s = region === 'left' ? -1 : 1;
        const pale = -s * Math.sin(theta) * -0.62 + s * Math.cos(theta) * -0.62 > 0;
        if (e === 'shade') return PX.ice1;
        return pale ? (e === 'lit' ? PX.white : PX.ice3) : PX.ice2;
      },
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
