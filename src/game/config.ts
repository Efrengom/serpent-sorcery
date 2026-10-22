/**
 * Central balance and tuning values for Serpent Sorcery.
 * Distances are in world units (the serpent moves 190 a second; a map is several thousand
 * across), times are in seconds, speeds in units per second.
 */

export const ARENA = {
  /** The old one-screen arena: the default play area for a serpent with no map (unit tests). */
  width: 1400,
  height: 800,
  /** Thickness of the wall band around every map; the playable area is inset by this much. */
  wall: 26,
  /** Damage from running into a wall or any other solid. */
  wallDamage: 8,
  /** Seconds steering input is ignored after bouncing off a wall or solid. */
  wallSteerLock: 0.2,
  /** Minimum outward component (0..1) of the heading after a bounce. */
  wallMinInward: 0.55,
};

/** The view follows the serpent around a map that is several screens across. */
export const CAMERA = {
  /** World units shown top to bottom (the old arena's height, so things look the same size). */
  viewHeight: 800,
  /** Wider windows see more to the sides, up to this; narrow ones at least `minViewWidth`. */
  maxViewWidth: 1600,
  minViewWidth: 1000,
  maxViewHeight: 1100,
  /**
   * Phones (a window under 560 CSS pixels wide, or 500 tall) zoom in a little: 600 units top to
   * bottom, at least 640 across, so the serpent stays big enough to see on a small screen.
   */
  compactViewHeight: 600,
  compactMinViewWidth: 640,
  /** How far ahead of the head the camera looks, and its catch-up time constant in seconds. */
  lookahead: 120,
  ease: 0.25,
  /** A jump bigger than this (a teleport) snaps the camera instead of easing. */
  snapDistance: 600,
};

/**
 * Breakable containers around a map: small ones (urns) shatter when the head touches them or a
 * spell hits them; large ones (reliquaries) are solid, harmless to bump, and take spells to break.
 */
export const BREAKABLES = {
  small: {
    radius: 14,
    /** XP in the crystals it always drops (inclusive range). */
    xp: [2, 3] as const,
    /** Chance of a small heal, doubled below `lowHealth`; chance of a buff. */
    heal: 0.12,
    buff: 0.03,
    /** Seconds before a broken slot can refill. */
    refill: 60,
  },
  large: {
    radius: 28,
    /** About three Arcane Bolts at depth 1, more each depth. */
    hp: 40,
    hpPerDepth: 0.35,
    xp: 8,
    /** Chance of a heal (a large one below `lowHealth`); it always drops one buff. */
    heal: 0.3,
    refill: 120,
  },
  /** Share of small slots filled at the start of a run (all large ones are). */
  startFill: 0.7,
  /** Health share below which heals are likelier (small) or bigger (large). */
  lowHealth: 0.35,
  /** Broken slots only refill this far (view diagonals) from the serpent. */
  refillViews: 1,
};

/** Health pickups. */
export const PICKUPS = {
  smallHeal: 20,
  /** A large heal restores this share of max health. */
  largeHeal: 0.35,
};

/** Buffs dropped by breakables: timed ones last this many seconds of game time. */
export const BUFFS = {
  quickening: { duration: 15, cooldownRate: 1.5, weight: 25 },
  empower: { duration: 15, damage: 1.4, weight: 25 },
  swiftscale: { duration: 12, speed: 1.2, weight: 15 },
  /** Blocks the next hit from a foe or a burst; lasts until used, at most this long. */
  stoneskin: { duration: 30, weight: 15 },
  lodestone: { weight: 10 },
  shardCache: { shards: 5, perDepth: 2, weight: 10 },
};

/** Solid lookup: cell size, and how far around a cell its solids are listed (the longest exact query). */
export const TERRAIN = {
  indexCell: 200,
  indexMargin: 160,
};

/** How foes find their way around solids, where they spawn, and the off-screen rules. */
export const NAV = {
  /** Flow-field cell size; cells this far from every solid are walkable. */
  cell: 40,
  minClearance: 20,
  /** Paths prefer open ground: cells closer than `hugClearance` to a solid cost extra. */
  hugClearance: 60,
  hugCost: 2,
  /** Lava and brambles cost this much more to cross, so foes go round when they can. */
  harmCost: 6,
  /** Seconds between flow-field refreshes, and between each foe's line-of-sight checks. */
  refresh: 0.25,
  sightInterval: 0.2,
  /** Spawns appear in a ring this far outside the view's edges. */
  ringInner: 80,
  ringOuter: 450,
  /** Attacks only start while the foe is in view (plus this margin), so every telegraph is seen. */
  attackMargin: 40,
  /** Foes this many view-diagonals away for `farTime` seconds, or stuck for `stuckTime`, are moved to the spawn ring. */
  farViews: 1.6,
  farTime: 6,
  stuckTime: 3,
  /** The boss clearing is marked this many seconds before the boss arrives. */
  clearingWarning: 30,
  /** The boss's portal opens at least this far from the serpent. */
  bossPortalDistance: 300,
};

/**
 * Touch screens: one thumb steers with a floating stick, the other draws. The steering thumb
 * owns this fraction of the screen's width on its side; anywhere else a touch draws a sigil.
 */
export const TOUCH = {
  zone: 0.42,
  /** CSS pixels the thumb must move before it steers, and how far the knob travels before the base follows. */
  deadzone: 10,
  radius: 56,
  /** Seconds of a run during which the two zones are labelled, on a touch screen. */
  hintTime: 8,
};

export const VIEW = {
  /** CSS pixels reserved at the top of the window for the HUD bar (slimmer on a short phone screen, two rows on a narrow one). */
  topInset: 78,
  topInsetShort: 56,
  topInsetNarrow: 102,
  /** Window sizes that count as a phone: narrower than this, or no taller than this. */
  narrowBelow: 560,
  shortAtMost: 500,
  sideInset: 14,
  bottomInset: 14,
  maxShake: 7,
};

export const PIXEL_ART = {
  /** World units per low-res pixel: an 800-unit-tall view is 320 art pixels. */
  worldPerPixel: 2.5,
  /** The floor is painted in square chunks of this many art pixels. */
  chunk: 256,
  /** Below this integer upscale factor the pixel view falls back to fractional scaling. */
  minIntegerScale: 2,
};

export const SIM = {
  step: 1 / 120,
  maxFrame: 0.1,
  maxSubSteps: 10,
  hudHz: 20,
  /** Time scale while the death animation plays. */
  dyingTimeScale: 0.35,
  dyingDuration: 1.4,
};

/** Brief freezes (seconds of real time) that make big hits land. */
export const HIT_STOP = {
  /** Taking damage. */
  hurt: 0.07,
  /** Killing a brute or rival snake. */
  heavyKill: 0.05,
  /** Lightning striking `bigChain` foes, or a Nova hitting `bigNova`. */
  bigSpell: 0.045,
  bigChain: 4,
  bigNova: 6,
  /** The boss dies: a longer freeze, then slow motion. */
  bossKill: 0.45,
  bossSlowMo: 1.1,
  slowMoScale: 0.3,
  /** Small freezes are at least this far apart so busy fights don't stutter. */
  minGap: 0.35,
};

export const SNAKE = {
  speed: 190,
  /** Radians per second. U-turn takes roughly PI / turnRate seconds. */
  turnRate: 4.4,
  headRadius: 15,
  /** Forgiving hit radius used for enemy attacks against the head. */
  hitRadius: 10,
  segmentSpacing: 12,
  startSegments: 8,
  /** Grows fast enough to Constrict (a full loop needs ~21 segments) from about level 6. */
  segmentsPerLevel: 3,
  maxSegments: 72,
  segmentGrowRate: 8,
  segmentRadiusMax: 13,
  segmentRadiusMin: 6,
  baseMaxHp: 100,
  invulnTime: 1.0,
  basePickupRadius: 110,
  /** Clicks closer than this to the head fall back to the current heading. */
  aimMinDistance: 48,
};

export type SpellId = 'bolt' | 'lightning' | 'nova' | 'ward' | 'frost';
export const SPELL_IDS: SpellId[] = ['bolt', 'lightning', 'nova', 'ward', 'frost'];

export const SPELLS = {
  bolt: {
    name: 'Arcane Bolt',
    cooldown: 0.55,
    minCooldown: 0.25,
    damage: 15,
    speed: 900,
    radius: 7,
    life: 1.0,
    /** Angle between extra projectiles (radians). */
    spread: 0.14,
  },
  lightning: {
    name: 'Forked Lightning',
    cooldown: 1.8,
    minCooldown: 0.8,
    damage: 22,
    range: 580,
    /** Primary cone half-angle; widened once if nothing is found. */
    cone: 0.55,
    wideCone: 1.0,
    /** Enemies this close to the recorded target are always eligible. */
    targetSnap: 70,
    chainRange: 240,
    chains: 2,
    falloff: 0.85,
  },
  nova: {
    name: 'Arcane Nova',
    cooldown: 4.5,
    minCooldown: 2.2,
    damage: 28,
    radius: 165,
    expandTime: 0.32,
    knockback: 280,
  },
  ward: {
    name: 'Arcane Ward',
    cooldown: 11,
    minCooldown: 6,
    /** Seconds the shield lasts, and how many hits it absorbs. Walls still sting. */
    duration: 8,
    charges: 1,
    /** Each absorbed hit (and the cast) pushes nearby foes away. */
    pulseRadius: 120,
    pulseKnockback: 330,
    pulseDamage: 10,
    /** Brief invulnerability after a hit is absorbed. */
    absorbInvuln: 0.5,
  },
  frost: {
    name: 'Frost Field',
    cooldown: 8,
    minCooldown: 4.5,
    radius: 130,
    duration: 5,
    /** Time scale for enemies inside (0.45 = they act at 45% speed), and for hostile shots. */
    slow: 0.45,
    shotSlow: 0.5,
    damagePerSecond: 8,
    tick: 0.5,
    /** Where the field lands when you press on the serpent instead of aiming. */
    placeAhead: 170,
  },
} as const;

/** The sigil for each spell, and a one-line summary for menus and level-up cards. */
export const SPELL_INFO: Record<SpellId, { shape: string; blurb: string }> = {
  bolt: { shape: 'Line', blurb: 'Fast bolt toward your target. Hits the first foe.' },
  lightning: { shape: 'V', blurb: 'Strikes a foe near your aim, then chains onward.' },
  nova: { shape: 'Circle', blurb: 'Shockwave around the snake. Dispels enemy shots.' },
  ward: { shape: 'Triangle', blurb: 'A shield that blocks the next hit and shoves foes back.' },
  frost: { shape: 'Zigzag', blurb: 'Freezing ground at your target slows foes and their shots.' },
};

/**
 * Spell evolutions: once a spell's own upgrade is maxed and its partner upgrade has a few
 * ranks, a golden level-up card transforms the spell.
 */
export const EVOLUTIONS = {
  bolt: {
    name: 'Arcane Lance',
    requires: ['pierce', 'potency'],
    description: 'Bolts become beams that pierce everything in a line for 1.8× damage.',
    beamLength: 780,
    beamWidth: 22,
    damageMult: 1.8,
  },
  lightning: {
    name: 'Tempest',
    requires: ['chains', 'haste'],
    description: 'Lightning chains to 3 more foes, then strikes a second time.',
    extraChains: 3,
    echoDelay: 0.3,
    echoDamage: 0.8,
  },
  nova: {
    name: 'Supernova',
    requires: ['novaRadius', 'vitality'],
    description: 'A second, wider ring follows each Nova, and every foe hit heals you 1.',
    echoDelay: 0.3,
    echoRadius: 1.5,
    echoDamage: 0.8,
    healPerHit: 1,
    maxHeal: 20,
  },
  ward: {
    name: 'Aegis',
    requires: ['wardRunes', 'regen'],
    description: 'The ward lasts 4s longer, and each blocked hit fires 8 bolts outward.',
    extraDuration: 4,
    bolts: 8,
  },
  frost: {
    name: 'Glacier',
    requires: ['deepFrost', 'magnet'],
    description: 'Foes caught in the field freeze solid for 1.2s and take 40% more damage.',
    freezeTime: 1.2,
    brittle: 1.4,
  },
} as const;

/** Ranks of the partner upgrade an evolution needs (the spell's own upgrade must be maxed). */
export const EVOLUTION_PARTNER_RANKS = 2;

/**
 * Aspects (L4): two ways for each spell to change how it behaves. A run takes at most one per
 * spell; taking one removes the other from the pool. Offered from ASPECT_FROM_LEVEL.
 */
export type AspectId =
  | 'ricochet'
  | 'seeker'
  | 'conductor'
  | 'overload'
  | 'implosion'
  | 'shockwave'
  | 'mirror'
  | 'sanctuary'
  | 'shatter'
  | 'permafrost';
export const ASPECT_IDS: AspectId[] = ['ricochet', 'seeker', 'conductor', 'overload', 'implosion', 'shockwave', 'mirror', 'sanctuary', 'shatter', 'permafrost'];
export const ASPECT_FROM_LEVEL = 5;

export const ASPECTS = {
  ricochet: {
    spell: 'bolt',
    name: 'Ricochet',
    description: 'After a hit, each bolt bounces once to the nearest other foe within 260, at 70% damage.',
    range: 260,
    damage: 0.7,
  },
  seeker: {
    spell: 'bolt',
    name: 'Seeker',
    description: 'Bolts curve toward the nearest foe ahead and fly 40% farther.',
    /** Radians a second a bolt turns, how far ahead it looks, and its range. */
    turn: 6,
    sight: 360,
    range: 1.4,
  },
  conductor: {
    spell: 'lightning',
    name: 'Conductor',
    description: 'Lightning loses no damage as it chains, and jumps 40% farther.',
    chainRange: 1.4,
  },
  overload: {
    spell: 'lightning',
    name: 'Overload',
    description: 'Struck foes are shocked for 3 s and take 20% more damage from everything.',
    time: 3,
    damage: 1.2,
  },
  implosion: {
    spell: 'nova',
    name: 'Implosion',
    description: 'Nova pulls foes in instead of pushing them away, and hits 25% harder.',
    pull: 0.8,
    damage: 1.25,
  },
  shockwave: {
    spell: 'nova',
    name: 'Shockwave',
    description: 'Nova knocks foes back twice as far and stuns them for 0.8 s.',
    knockback: 2,
    stun: 0.8,
  },
  mirror: {
    spell: 'ward',
    name: 'Mirror',
    description: 'While the Ward is up, enemy shots that reach you bounce back as bolts and use no charge.',
  },
  sanctuary: {
    spell: 'ward',
    name: 'Sanctuary',
    description: 'Casting the Ward heals 8% of max health, and you regenerate 2 health a second while it lasts.',
    heal: 0.08,
    regen: 2,
  },
  shatter: {
    spell: 'frost',
    name: 'Shatter',
    description: 'Foes that die in a Frost Field burst, dealing 40% of their max health to foes within 90.',
    share: 0.4,
    radius: 90,
  },
  permafrost: {
    spell: 'frost',
    name: 'Permafrost',
    description: 'Frost Fields last twice as long and are 25% wider.',
    duration: 2,
    radius: 1.25,
  },
} as const satisfies Record<AspectId, { spell: SpellId; name: string; description: string; [tuning: string]: unknown }>;

/** Duo evolutions (L5): once both spells of a pair have evolved, a duo card can appear. */
export type DuoId = 'stormlance' | 'rimeshot' | 'shatterstorm' | 'thunderclap' | 'bulwark' | 'blizzard';
export const DUO_IDS: DuoId[] = ['stormlance', 'rimeshot', 'shatterstorm', 'thunderclap', 'bulwark', 'blizzard'];

export const DUOS = {
  stormlance: {
    spells: ['bolt', 'lightning'],
    name: 'Stormlance',
    description: 'Each bolt or lance hit has a 25% chance to arc lightning to 2 nearby foes.',
    /** Known from the start; the others are unlocked in the Grimoire. */
    known: true,
    chance: 0.25,
    jumps: 2,
    damage: 0.6,
  },
  rimeshot: {
    spells: ['bolt', 'frost'],
    name: 'Rimeshot',
    description: 'Bolt and lance hits chill foes for 1.5 s, and chilled foes take 30% more bolt damage.',
    known: false,
    chill: 1.5,
    damage: 1.3,
  },
  shatterstorm: {
    spells: ['lightning', 'frost'],
    name: 'Shatterstorm',
    description: 'Lightning deals double damage to chilled or frozen foes.',
    known: false,
    damage: 2,
  },
  thunderclap: {
    spells: ['nova', 'lightning'],
    name: 'Thunderclap',
    description: 'Each Nova strikes up to 4 of the foes it hits with lightning.',
    known: true,
    strikes: 4,
  },
  bulwark: {
    spells: ['ward', 'nova'],
    name: 'Bulwark',
    description: 'Every hit the Ward blocks also releases a Nova.',
    known: false,
  },
  blizzard: {
    spells: ['nova', 'frost'],
    name: 'Blizzard',
    description: 'Each Nova leaves a Frost Field where it was cast.',
    known: true,
  },
} as const satisfies Record<DuoId, { spells: readonly [SpellId, SpellId]; name: string; description: string; known: boolean; [tuning: string]: unknown }>;

/** Overcharge (L6): endless small ranks that fill the level-up offer once the pool runs dry. */
export type OverchargeId = 'power' | 'vigor' | 'focus';
export const OVERCHARGE_IDS: OverchargeId[] = ['power', 'vigor', 'focus'];
export const OVERCHARGE = {
  power: { name: 'Overcharge: Power', glyph: '✦', damage: 0.06 },
  vigor: { name: 'Overcharge: Vigor', glyph: '♥', maxHp: 12, heal: 25 },
  focus: { name: 'Overcharge: Focus', glyph: '↻', cooldown: 0.97 },
} as const;
/** No mix of upgrades, overcharge and relics takes cooldowns below this share. */
export const COOLDOWN_FLOOR = 0.5;

/** Level-up tools (L1-L3): rerolls and banishes a run starts with (the Grimoire adds more), and what a skip heals. */
export const LEVEL_TOOLS = {
  rerolls: 2,
  banishes: 1,
  skipHeal: 0.1,
};

/**
 * Clean casts: the recognizer's confidence for a sigil, compared with per-sigil thresholds
 * (each sigil's scores spread differently), boosts the spell. Thresholds were set from
 * randomized hand-drawn strokes: Perfect is roughly the best third of careful strokes, Clean a
 * typical careful one.
 */
export const CLEAN_CAST = {
  perfect: { line: 0.975, vee: 0.915, circle: 0.9, triangle: 0.935, zigzag: 0.88 },
  clean: { line: 0.92, vee: 0.88, circle: 0.86, triangle: 0.9, zigzag: 0.83 },
  /** Spell power multiplier per tier. */
  power: { perfect: 1.35, clean: 1.15, rough: 1 },
  /** Seconds between live readings of the stroke being drawn. */
  liveInterval: 0.06,
};

/** Constrict: close a loop of your body around foes to crush them. */
export const CONSTRICT = {
  /** Only body points at least this far down the body can close a loop. */
  minSegments: 10,
  /** The head must come this close to the body to close the loop. */
  closeDistance: 30,
  /**
   * The closing gap is shown once the head is this close to a body point at least `hintFrom`
   * segments back, so it appears as the loop comes around rather than halfway through a turn.
   */
  hintDistance: 65,
  hintFrom: 14,
  damage: 45,
  /** Seconds crushed foes are held still (bosses shrug it off). */
  stun: 1.1,
  /** Inward pull on crushed foes, toward the middle of the loop. */
  pull: 240,
  cooldown: 1.2,
};

export const GESTURE = {
  /** Gestures whose bounding box is smaller than this (CSS px) are treated as clicks. */
  minSize: 26,
  minPathLength: 40,
  maxPoints: 1200,
  resampleCount: 64,
  /** Ignore raw points closer than this to the previous one (CSS px). */
  minPointSpacing: 1.5,
  /** Recognized/unclear trail fades out over this many seconds. */
  trailFade: 0.45,
};

/**
 * Every kind of foe. Each map fields four (a swarmer, a shooter, a heavy and a special) plus its
 * boss; the newer kinds are an older one's behaviour with one twist (see ARCHETYPE in enemies.ts).
 */
export type EnemyKind =
  | 'chaser'
  | 'caster'
  | 'brute'
  | 'rival'
  | 'boss'
  | 'sporeling'
  | 'puffcap'
  | 'thornback'
  | 'burrowViper'
  | 'rattler'
  | 'frostArcher'
  | 'golem'
  | 'wraith'
  | 'imp'
  | 'pyromancer'
  | 'magmaBrute'
  | 'salamander';

export const ENEMIES = {
  chaser: { radius: 13, hp: 12, speed: 72, contact: 10, xp: 2, score: 1 },
  caster: {
    radius: 14,
    hp: 22,
    speed: 62,
    contact: 8,
    xp: 3,
    score: 2,
    preferredRange: 300,
    fireInterval: 2.8,
    firstShotDelay: 1.6,
    telegraph: 0.75,
    shotSpeed: 205,
    shotRadius: 8,
    shotDamage: 8,
    lead: 0.3,
  },
  brute: {
    radius: 22,
    hp: 70,
    speed: 42,
    contact: 12,
    xp: 7,
    score: 4,
    chargeRange: 340,
    telegraph: 1.0,
    chargeSpeed: 520,
    chargeTime: 0.55,
    recover: 1.1,
    chargeDamage: 20,
    chargeCooldown: 3.5,
    /** Extra damage taken while stunned after a charge. */
    stunnedVulnerability: 1.25,
    /** A charge that ends in a wall or other solid staggers it this much longer. */
    bonkStagger: 1.5,
  },
  rival: {
    radius: 13,
    hp: 90,
    speed: 120,
    turnRate: 2.6,
    contact: 14,
    xp: 10,
    score: 6,
    segments: 8,
    segmentRadius: 10,
    segmentSpacing: 13,
    lungeRange: 380,
    telegraph: 0.9,
    lungeSpeed: 430,
    lungeTime: 0.6,
    lungeCooldown: 4.5,
  },
  boss: {
    name: 'Archmage Ouroboros',
    radius: 30,
    hp: 1900,
    speed: 115,
    turnRate: 2.0,
    contact: 25,
    xp: 140,
    score: 40,
    segments: 16,
    segmentRadius: 22,
    segmentSpacing: 24,
    volleyTelegraph: 1.0,
    volleyCount: 12,
    volleyCountEnraged: 16,
    volleySpeed: 190,
    volleyDamage: 14,
    chargeTelegraph: 1.2,
    chargeSpeed: 520,
    chargeTime: 0.9,
    chargeDamage: 30,
    summonTelegraph: 0.8,
    summonCount: 4,
    slitherTime: 3.6,
    enragedAt: 0.5,
    /** HP multiplier added per previous boss defeated/spawned. */
    hpPerIndex: 0.8,
  },
  // ---- The Mycelium Hollows
  /** Sporeling: tiny, comes in packs, and hops toward the serpent in short bursts. */
  sporeling: {
    radius: 9,
    hp: 7,
    speed: 78,
    contact: 7,
    xp: 1,
    score: 1,
    /** How many arrive together. */
    pack: [4, 6] as const,
    /** One hop every `hop` seconds: fast for `burst` of it, nearly still for the rest. */
    hop: 0.7,
    burst: 0.45,
    fast: 2.0,
    slow: 0.15,
  },
  /** Puffcap: roots itself, swells, then puffs a slow fan of long-lived spores. */
  puffcap: {
    radius: 15,
    hp: 26,
    speed: 34,
    contact: 8,
    xp: 3,
    score: 2,
    preferredRange: 360,
    fireInterval: 4.0,
    firstShotDelay: 2.0,
    telegraph: 0.9,
    shots: 3,
    /** Radians between the spores of a fan. */
    spread: 0.32,
    shotSpeed: 115,
    shotRadius: 10,
    shotDamage: 7,
    /** Spores drift on longer than other shots (6 s). */
    shotLife: 7,
  },
  /** Thornback: a brute whose charge leaves a trail of brambles. */
  thornback: {
    radius: 22,
    hp: 75,
    speed: 42,
    contact: 12,
    xp: 7,
    score: 4,
    chargeRange: 340,
    telegraph: 1.0,
    chargeSpeed: 480,
    chargeTime: 0.55,
    recover: 1.1,
    chargeDamage: 18,
    chargeCooldown: 3.8,
    trailLife: 3,
    trailRadius: 24,
    trailSpacing: 26,
  },
  /** Burrow Viper: dives, travels underground as a mound (it can't be hit), and erupts under where the serpent is heading. */
  burrowViper: {
    radius: 13,
    hp: 70,
    speed: 88,
    contact: 12,
    xp: 9,
    score: 6,
    diveRange: 440,
    /** The eruption's circle is marked this long before it comes up. */
    telegraph: 0.9,
    /** Aims where the head will be this many seconds on. */
    lead: 0.9,
    eruptRadius: 70,
    eruptDamage: 16,
    /** Seconds above ground (and open to hits) after erupting. */
    surfaced: 1.2,
    diveCooldown: 4.5,
  },
  // ---- The Rimefrost Catacombs
  /** Bone Rattler: struck down by a single bolt or arc, it collapses into a pile that rises again unless finished. */
  rattler: {
    radius: 12,
    hp: 14,
    speed: 66,
    contact: 9,
    xp: 2,
    score: 1,
    /** Seconds as a pile before it rises, and the share of its health it rises with. */
    riseTime: 3,
    riseHealth: 0.5,
  },
  /** Frost Archer: keeps well back, draws a line, then looses a fast icicle down it (stone stops it). */
  frostArcher: {
    radius: 13,
    hp: 22,
    speed: 56,
    contact: 8,
    xp: 3,
    score: 2,
    preferredRange: 420,
    fireInterval: 4.6,
    firstShotDelay: 1.8,
    telegraph: 0.9,
    shotSpeed: 420,
    shotRadius: 6,
    shotDamage: 11,
  },
  /** Crypt Golem: slow, never charges; slams the ground around it, leaving ice. */
  golem: {
    radius: 26,
    hp: 110,
    speed: 30,
    contact: 12,
    xp: 9,
    score: 4,
    slamRange: 150,
    telegraph: 1.1,
    slamRadius: 120,
    slamDamage: 18,
    iceLife: 4,
    recover: 1.0,
    slamCooldown: 3.5,
  },
  /** Wraith: drifts through stone (taking less harm while inside it) and lunges. */
  wraith: {
    radius: 14,
    hp: 60,
    speed: 70,
    contact: 12,
    xp: 8,
    score: 6,
    lungeRange: 280,
    telegraph: 0.8,
    lungeSpeed: 520,
    lungeTime: 0.4,
    recover: 0.7,
    lungeCooldown: 3.2,
    /** Damage taken while inside stone. */
    phaseArmor: 0.6,
  },
  // ---- The Ember Depths
  /** Cinder Imp: fast and fragile; crouches, then leaps the last stretch. */
  imp: {
    radius: 10,
    hp: 8,
    speed: 98,
    contact: 8,
    xp: 2,
    score: 1,
    leapRange: 170,
    telegraph: 0.6,
    leapSpeed: 430,
    leapTime: 0.35,
    recover: 0.5,
    leapCooldown: 2.4,
  },
  /** Pyromancer: keeps its distance and lobs fireballs onto a marked circle; they arc over stone. */
  pyromancer: {
    radius: 14,
    hp: 24,
    speed: 58,
    contact: 8,
    xp: 3,
    score: 2,
    preferredRange: 340,
    fireInterval: 3.8,
    firstShotDelay: 1.8,
    /** The fireball's circle is marked this long before it lands. */
    telegraph: 1.0,
    /** Aims where the head will be this many seconds on. */
    lead: 0.5,
    blastRadius: 62,
    blastDamage: 11,
    /** It leaves burning ground behind. */
    burnTime: 1.6,
    burnRadius: 46,
  },
  /** Magma Brute: a brute whose charge leaves a trail of lava. */
  magmaBrute: {
    radius: 23,
    hp: 80,
    speed: 40,
    contact: 12,
    xp: 8,
    score: 4,
    chargeRange: 340,
    telegraph: 1.0,
    chargeSpeed: 500,
    chargeTime: 0.55,
    recover: 1.1,
    chargeDamage: 20,
    chargeCooldown: 3.8,
    trailLife: 3,
    trailRadius: 26,
    trailSpacing: 26,
  },
  /** Salamander: a rival-style serpent at home in lava, which spits a short cone of flame. */
  salamander: {
    radius: 13,
    hp: 95,
    speed: 116,
    turnRate: 2.6,
    contact: 14,
    xp: 10,
    score: 6,
    segments: 8,
    segmentRadius: 10,
    segmentSpacing: 13,
    flameRange: 180,
    /** Half-angle of the cone, in radians. */
    flameAngle: 0.5,
    telegraph: 0.8,
    flameTime: 0.45,
    flameDamage: 14,
    flameCooldown: 4.2,
  },
};

/** The behaviour each kind is built on; the newer kinds add one twist to it. */
export const ARCHETYPE: Record<EnemyKind, 'chaser' | 'caster' | 'brute' | 'rival' | 'boss'> = {
  chaser: 'chaser',
  caster: 'caster',
  brute: 'brute',
  rival: 'rival',
  boss: 'boss',
  sporeling: 'chaser',
  puffcap: 'caster',
  thornback: 'brute',
  burrowViper: 'chaser',
  rattler: 'chaser',
  frostArcher: 'caster',
  golem: 'brute',
  wraith: 'chaser',
  imp: 'chaser',
  pyromancer: 'caster',
  magmaBrute: 'brute',
  salamander: 'rival',
};

/** Each map's boss: Ouroboros's body and AI, with its own name, look and two moves of its own. */
export type BossId = 'ouroboros' | 'sporemaw' | 'rimecoil' | 'pyrecoil' | 'ascendant';
export type BossMove = 'slither' | 'volley' | 'charge' | 'summon' | 'meteors' | 'spores' | 'burrow' | 'icicles' | 'iceRing';
export const BOSSES: Record<
  BossId,
  {
    name: string;
    /** Its name in short, and the line under "is enraged!" at half health. */
    short: string;
    enraged: string;
    /** The warning banner a few seconds before it arrives, and the line under its name when it does. */
    warning: [string, string];
    arrival: string;
    moves: BossMove[];
    /** What its summon brings, and what it adds once enraged. */
    summon: [EnemyKind, EnemyKind];
    /** Its charge leaves burning ground. */
    fireTrail: boolean;
    /**
     * A boss with phases (the Ascendant) changes its moves, summons and trail as its health falls
     * below each phase's `at` (a fraction of its full health), announcing each.
     */
    phases?: { at: number; moves: BossMove[]; summon: [EnemyKind, EnemyKind]; fireTrail: boolean; banner: [string, string] }[];
  }
> = {
  sporemaw: {
    name: 'Sporemaw, the Fungal Archmage',
    short: 'Sporemaw',
    enraged: 'Thicker spores, deeper burrows',
    warning: ['The ground trembles…', 'Sporemaw stirs beneath the hollows'],
    arrival: 'It burrows under where you are going — keep moving',
    moves: ['spores', 'burrow', 'summon', 'volley', 'burrow'],
    summon: ['sporeling', 'puffcap'],
    fireTrail: false,
  },
  rimecoil: {
    name: 'Rimecoil, the Frost Archmage',
    short: 'Rimecoil',
    enraged: 'More icicles, wider ice',
    warning: ['A bitter cold settles…', 'Rimecoil uncoils from the ice'],
    arrival: 'Its icicles fly down the lines it draws',
    moves: ['icicles', 'charge', 'summon', 'iceRing', 'charge'],
    summon: ['rattler', 'frostArcher'],
    fireTrail: false,
  },
  ouroboros: {
    name: 'Archmage Ouroboros',
    short: 'Ouroboros',
    enraged: 'Faster volleys, wider rings',
    warning: ['A rival Archmage approaches!', 'Ouroboros slithers out of the ruins'],
    arrival: 'Only its head can bite — strike anywhere',
    moves: ['volley', 'charge', 'summon', 'volley', 'charge'],
    summon: ['chaser', 'caster'],
    fireTrail: false,
  },
  ascendant: {
    name: 'Azhdaha, the Archmage Ascendant',
    short: 'Azhdaha',
    enraged: 'Faster, and fiercer with every spell',
    warning: ['The ground splits…', 'The four Archmages’ magic gathers into one'],
    arrival: 'It wields every Archmage’s magic — and learns more as it bleeds',
    moves: ['volley', 'spores', 'charge', 'summon', 'burrow'],
    summon: ['chaser', 'caster'],
    fireTrail: false,
    phases: [
      { at: 1, moves: ['volley', 'spores', 'charge', 'summon', 'burrow'], summon: ['chaser', 'puffcap'], fireTrail: false, banner: ['', ''] },
      {
        at: 2 / 3,
        moves: ['icicles', 'charge', 'iceRing', 'volley', 'summon', 'icicles'],
        summon: ['rattler', 'frostArcher'],
        fireTrail: false,
        banner: ['Azhdaha turns to frost', 'Icicles down its lines, and rings of ice'],
      },
      {
        at: 1 / 3,
        moves: ['meteors', 'charge', 'icicles', 'burrow', 'spores', 'meteors', 'volley'],
        summon: ['imp', 'pyromancer'],
        fireTrail: true,
        banner: ['Azhdaha burns', 'Meteors and fire — and everything it has learned'],
      },
    ],
  },
  pyrecoil: {
    name: 'Pyrecoil, the Ember Archmage',
    short: 'Pyrecoil',
    enraged: 'More meteors, a hotter trail',
    warning: ['The ground grows hot…', 'Pyrecoil rises from the magma'],
    arrival: 'Meteors fall where you are heading — keep moving',
    moves: ['meteors', 'charge', 'summon', 'volley', 'charge'],
    summon: ['imp', 'pyromancer'],
    fireTrail: true,
  },
};

/** Pyrecoil's meteor rain: circles marked around where the serpent is heading, landing one after another. */
export const METEORS = {
  count: 5,
  radius: 70,
  damage: 16,
  /** Each lands this long after it is marked, plus a stagger per meteor. */
  delay: 1.0,
  stagger: 0.15,
  /** Spread around the point the serpent will reach in `lead` seconds. */
  spread: 220,
  lead: 0.8,
  /** Each leaves a patch of burning ground. */
  burnRadius: 50,
  burnTime: 2,
};

/** Sporemaw's spore fan and burrowing charge, and Rimecoil's icicles and rings of ice. */
export const BOSS_MOVES = {
  spores: { count: 7, countEnraged: 10, arc: 1.4, speed: 125, damage: 11, radius: 11, life: 6 },
  /** It dives at the start of the charge and erupts at its end, where a circle is marked. */
  burrow: { radius: 110, damage: 22 },
  /** The fan's lines show through the wind-up; then an icicle flies down each. */
  icicles: { count: 5, countEnraged: 7, step: 0.2, speed: 520, damage: 12, radius: 7 },
  /** Patches of ice laid in rings round the serpent. */
  iceRing: { rings: [260, 430] as const, patch: 70, life: 7 },
};

/** Lava, brambles, ice, burning ground, vents and other hazards. */
export const HAZARDS = {
  /** Lava, brambles and burning ground hurt on touch, through the normal invulnerability. */
  lava: { damage: 6 },
  bramble: { damage: 5 },
  fire: { damage: 5 },
  /** Ice halves the head's turn rate, so turns are wider. */
  ice: { turn: 0.5 },
  /** Foes not at home in it burn this much per tick. */
  burn: { damage: 5, tick: 0.5 },
  /** Eruption vents go off every few seconds, only near the view (S5). */
  vent: { radius: 90, damage: 14, telegraph: 1.0, interval: [5, 8] as const, activeViews: 1 },
  spores: { radius: 100, damage: 10, telegraph: 1.0, interval: [4, 7] as const, activeViews: 1 },
  icicle: { radius: 60, damage: 15, telegraph: 1.0, interval: [3, 6] as const, activeViews: 1 },
  /** Burning ground left by a boss's charge. */
  fireTrail: { life: 2.5, radius: 34, spacing: 30 },
};

/** The way down after a boss falls. */
export const DESCENT = {
  /** Entering this close to the portal descends; after `pullAfter` seconds it pulls you in. */
  radius: 70,
  pullAfter: 15,
  /** Seconds of fade from black on the new map. */
  fade: 0.6,
};

export const DIRECTOR = {
  /** First enemies appear after this many seconds. */
  firstSpawn: 2.5,
  portalTime: 0.85,
  minSpawnDistance: 360,
  /** Enemies per second: base + linear*t + quad*t^2. */
  rateBase: 0.42,
  rateLinear: 0.009,
  rateQuad: 0.00001,
  /** Alive cap: min(capMax, capBase + capPerSec * t), and an early-game ramp. */
  capBase: 14,
  capPerSec: 0.18,
  capMax: 110,
  earlyCapBase: 3,
  earlyCapPerSec: 0.5,
  /**
   * A map's four foes (swarmer, shooter, heavy, special) unlock this many seconds after the
   * serpent arrives: slowly on the first map, faster on later ones (R4). Each then ramps up to
   * its weight over `slotRamp` seconds.
   */
  slotStart: { first: [0, 40, 100, 180], later: [0, 20, 45, 90] },
  slotRamp: [1, 80, 100, 120],
  slotWeight: [1, 0.35, 0.22, 0.12],
  /** Ramps start from at least this share of their weight. */
  slotFloor: [1, 0.25, 0.3, 0.4],
  /** The special (often a serpent) is capped: one, then one more every this many seconds. */
  specialCapInterval: 120,
  bossTime: 300,
  bossInterval: 300,
  bossWarning: 4,
  bossSpawnRateMult: 0.35,
  /** Scaling with the seconds since arriving on the current map (enemies.difficulty). */
  hpLinear: 1 / 120,
  hpQuadDivisor: 300,
  damagePerSec: 1 / 360,
  speedPerSec: 1 / 900,
  maxSpeedBonus: 0.35,
};

/** Each boss defeated opens the way to the next map, one depth deeper and harder (endless). */
export const DEPTH = {
  /** Foe health ×(1 + hpPerDepth·d + hpPerDepthSq·d²), d = depth − 1, on top of the map clock's own climb. */
  hpPerDepth: 0.75,
  hpPerDepthSq: 0.1,
  damagePerDepth: 0.25,
  /** Foes start each deeper map a little quicker (the clock's speed bonus still caps it). */
  speedPerDepth: 0.05,
  spawnPerDepth: 0.2,
  capPerDepth: 12,
  /** Each boss's health grows this share per depth, on top of hpPerIndex. */
  bossHpPerDepth: 0.3,
};

/** Ultimates (U2): seconds left on one when a run begins, and the floor its cooldown can be shortened to. */
export const ULTIMATE = {
  start: 30,
  minCooldown: 45,
};

/** Heat (M3): harder runs after the loop. Each level adds to foes and to the shards a run pays. */
export const HEAT = {
  max: 10,
  hp: 0.12,
  damage: 0.06,
  elite: 0.03,
  shards: 0.15,
  /** Reaching this depth at heat h unlocks h + 1. */
  clearDepth: 5,
};

/** Elite enemies (shielded, swift or splitting), from depth 2 onward. */
export const ELITE = {
  /** Chance a spawn is elite at depth 2, growing per further depth, capped. */
  baseChance: 0.1,
  chancePerDepth: 0.05,
  maxChance: 0.35,
  /** With the Champions' Hunt curse, elites appear from depth 1 and a little more often. */
  cursedChance: 0.08,
  cursedBonus: 0.05,
  hpMult: 1.6,
  xpMult: 2.5,
  sizeMult: 1.15,
  contactMult: 1.2,
  /** Shield strength as a share of the elite's health. */
  shieldFraction: 0.8,
  /** Splitting elites break into two fragments this big, with this share of base health. */
  fragmentScale: 0.75,
  fragmentHp: 0.35,
};

export const PROGRESSION = {
  /** XP to next level: base + linear*(L-1) + quad*(L-1)^2 */
  xpBase: 16,
  xpLinear: 7,
  xpQuad: 1.0,
  survivalXpBase: 0.3,
  survivalXpPerMinute: 0.05,
  maxCrystals: 300,
  crystalMagnetSpeed: 720,
  pickupRadiusOnHead: 24,
};

export const REWARDS = {
  perTenSeconds: 1,
  perKill: 0.5,
  perLevel: 3,
  perBoss: 50,
  /** Defeating the Archmage Ascendant (see FINALE in finale.ts). */
  victory: 300,
};

export const EFFECTS = {
  maxParticles: 700,
  maxFloaters: 40,
  maxDamageNumbers: 24,
  maxBolts: 80,
  maxEnemyShots: 180,
};
