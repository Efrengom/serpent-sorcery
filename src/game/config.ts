/**
 * Central balance and tuning values for Serpent Sorcery.
 * Distances are in arena units (the arena is ARENA.width x ARENA.height),
 * times are in seconds, speeds in units per second.
 */

export const ARENA = {
  width: 1400,
  height: 800,
  /** Thickness of the decorative wall band; the playable area is inset by this much. */
  wall: 26,
  wallDamage: 8,
  /** Seconds steering input is ignored after bouncing off a wall. */
  wallSteerLock: 0.2,
  /** Minimum inward component (0..1) of the heading after a wall bounce. */
  wallMinInward: 0.55,
};

export const VIEW = {
  /** CSS pixels reserved at the top of the window for the HUD bar. */
  topInset: 78,
  sideInset: 14,
  bottomInset: 14,
  maxShake: 7,
};

export const PIXEL_ART = {
  /** Arena units per low-res pixel: the 1400x800 arena becomes a 560x320 pixel canvas. */
  worldPerPixel: 2.5,
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
  startSegments: 6,
  segmentsPerLevel: 2,
  maxSegments: 64,
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

export type EnemyKind = 'chaser' | 'caster' | 'brute' | 'rival' | 'boss';

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
  /** Unlock times and weights for each enemy type. */
  casterStart: 40,
  casterRamp: 80,
  casterWeight: 0.35,
  bruteStart: 100,
  bruteRamp: 100,
  bruteWeight: 0.22,
  rivalStart: 180,
  rivalRamp: 120,
  rivalWeight: 0.12,
  /** Seconds between rival snake allowance increases. */
  rivalCapInterval: 120,
  bossTime: 300,
  bossInterval: 300,
  bossWarning: 4,
  bossSpawnRateMult: 0.35,
  /** Scaling with elapsed seconds t. */
  hpLinear: 1 / 120,
  hpQuadDivisor: 300,
  damagePerSec: 1 / 360,
  speedPerSec: 1 / 900,
  maxSpeedBonus: 0.35,
};

/** Each boss defeated opens a deeper, harder depth (endless). */
export const DEPTH = {
  /** Distinct arena looks: the ruins, then the Ember Depths for every depth after. */
  areas: 2,
  hpPerDepth: 0.35,
  damagePerDepth: 0.2,
  spawnPerDepth: 0.15,
  capPerDepth: 12,
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
};

export const EFFECTS = {
  maxParticles: 700,
  maxFloaters: 40,
  maxDamageNumbers: 24,
  maxBolts: 80,
  maxEnemyShots: 180,
};
