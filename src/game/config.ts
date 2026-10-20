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

export type SpellId = 'bolt' | 'lightning' | 'nova';

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
} as const;

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
