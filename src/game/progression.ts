/**
 * Run progression (XP, level-up upgrades, derived spell stats) and
 * meta progression (permanent upgrades bought with Arcane Shards).
 * Everything here is pure so it can be unit tested.
 */

import { PROGRESSION, REWARDS, SNAKE, SPELLS, type SpellId } from './config';

// ---------------------------------------------------------------- XP

export function xpToNext(level: number): number {
  const l = Math.max(0, level - 1);
  return Math.floor(PROGRESSION.xpBase + PROGRESSION.xpLinear * l + PROGRESSION.xpQuad * l * l);
}

/** Passive XP per second for simply surviving, growing slowly with time. */
export function survivalXpRate(seconds: number): number {
  return PROGRESSION.survivalXpBase + PROGRESSION.survivalXpPerMinute * (seconds / 60);
}

export function segmentsForLevel(level: number): number {
  return Math.min(SNAKE.maxSegments, SNAKE.startSegments + (level - 1) * SNAKE.segmentsPerLevel);
}

// ---------------------------------------------------------------- Run upgrades

export type UpgradeId =
  | 'potency'
  | 'multibolt'
  | 'pierce'
  | 'chains'
  | 'novaRadius'
  | 'haste'
  | 'vitality'
  | 'magnet'
  | 'regen';

export type UpgradeLevels = Record<UpgradeId, number>;

export interface MetaLevels {
  health: number;
  damage: number;
  pickup: number;
  wisdom: number;
}

export interface PlayerStats {
  damageMult: number;
  boltCount: number;
  boltPierce: number;
  chains: number;
  novaRadius: number;
  novaDamageMult: number;
  cooldownMult: number;
  maxHp: number;
  pickupRadius: number;
  regenPerSec: number;
  xpMult: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  glyph: string;
  maxLevel: number;
  /** Short description of what one more level does, with real numbers. */
  describe: (current: PlayerStats, next: PlayerStats) => string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const r1 = (v: number) => Math.round(v * 10) / 10;

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  potency: {
    id: 'potency',
    name: 'Arcane Potency',
    glyph: '✦',
    maxLevel: 6,
    describe: (c, n) =>
      `All spell damage ${pct(c.damageMult)} → ${pct(n.damageMult)}. Bolt hits for ${Math.round(SPELLS.bolt.damage * n.damageMult)}.`,
  },
  multibolt: {
    id: 'multibolt',
    name: 'Split Bolt',
    glyph: '⋔',
    maxLevel: 4,
    describe: (c, n) => `Arcane Bolt fires ${n.boltCount} projectiles in a fan (was ${c.boltCount}).`,
  },
  pierce: {
    id: 'pierce',
    name: 'Piercing Bolt',
    glyph: '➶',
    maxLevel: 4,
    describe: (c, n) =>
      `Bolts pass through ${n.boltPierce} ${n.boltPierce === 1 ? 'enemy' : 'enemies'} before breaking (was ${c.boltPierce}).`,
  },
  chains: {
    id: 'chains',
    name: 'Forked Chains',
    glyph: 'ϟ',
    maxLevel: 5,
    describe: (c, n) => `Forked Lightning jumps to ${n.chains} extra targets (was ${c.chains}).`,
  },
  novaRadius: {
    id: 'novaRadius',
    name: 'Nova Expanse',
    glyph: '◎',
    maxLevel: 5,
    describe: (c, n) =>
      `Nova radius ${Math.round(c.novaRadius)} → ${Math.round(n.novaRadius)} and +10% Nova damage.`,
  },
  haste: {
    id: 'haste',
    name: 'Quickened Runes',
    glyph: '↻',
    maxLevel: 5,
    describe: (c, n) => {
      const cd = (id: SpellId, s: PlayerStats) => r1(spellCooldown(id, s));
      return `Cooldowns −8%: Bolt ${cd('bolt', c)}→${cd('bolt', n)}s, Lightning ${cd('lightning', c)}→${cd('lightning', n)}s, Nova ${cd('nova', c)}→${cd('nova', n)}s.`;
    },
  },
  vitality: {
    id: 'vitality',
    name: 'Serpent Vitality',
    glyph: '♥',
    maxLevel: 5,
    describe: (c, n) => `Max health ${c.maxHp} → ${n.maxHp} and heal 30 now.`,
  },
  magnet: {
    id: 'magnet',
    name: 'Crystal Magnetism',
    glyph: '◇',
    maxLevel: 4,
    describe: (c, n) => `Crystal pickup radius ${Math.round(c.pickupRadius)} → ${Math.round(n.pickupRadius)}.`,
  },
  regen: {
    id: 'regen',
    name: 'Shed Skin',
    glyph: '❦',
    maxLevel: 3,
    describe: (c, n) => `Regenerate ${r1(n.regenPerSec)} health per second (was ${r1(c.regenPerSec)}).`,
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function emptyUpgradeLevels(): UpgradeLevels {
  return { potency: 0, multibolt: 0, pierce: 0, chains: 0, novaRadius: 0, haste: 0, vitality: 0, magnet: 0, regen: 0 };
}

export function emptyMetaLevels(): MetaLevels {
  return { health: 0, damage: 0, pickup: 0, wisdom: 0 };
}

export function computeStats(up: UpgradeLevels, meta: MetaLevels): PlayerStats {
  return {
    damageMult: (1 + 0.15 * up.potency) * (1 + 0.08 * meta.damage),
    boltCount: 1 + up.multibolt,
    boltPierce: up.pierce,
    chains: SPELLS.lightning.chains + up.chains,
    novaRadius: SPELLS.nova.radius * (1 + 0.2 * up.novaRadius),
    novaDamageMult: 1 + 0.1 * up.novaRadius,
    cooldownMult: Math.max(0.6, 1 - 0.08 * up.haste),
    maxHp: SNAKE.baseMaxHp + 10 * meta.health + 20 * up.vitality,
    pickupRadius: SNAKE.basePickupRadius * (1 + 0.15 * meta.pickup) * (1 + 0.35 * up.magnet),
    regenPerSec: 0.6 * up.regen,
    xpMult: 1 + 0.1 * meta.wisdom,
  };
}

export function spellCooldown(id: SpellId, stats: PlayerStats): number {
  const s = SPELLS[id];
  return Math.max(s.minCooldown, s.cooldown * stats.cooldownMult);
}

export interface UpgradeChoice {
  id: UpgradeId | 'restore';
  name: string;
  glyph: string;
  /** Level the upgrade will reach if chosen. */
  nextLevel: number;
  maxLevel: number;
  description: string;
}

export const RESTORE_HEAL = 40;

export function describeChoice(id: UpgradeId, up: UpgradeLevels, meta: MetaLevels): UpgradeChoice {
  const def = UPGRADES[id];
  const next = { ...up, [id]: up[id] + 1 };
  return {
    id,
    name: def.name,
    glyph: def.glyph,
    nextLevel: up[id] + 1,
    maxLevel: def.maxLevel,
    description: def.describe(computeStats(up, meta), computeStats(next, meta)),
  };
}

/** Picks `count` distinct upgrades that are not maxed; pads with a heal if the pool runs dry. */
export function rollUpgradeChoices(
  up: UpgradeLevels,
  meta: MetaLevels,
  rng: () => number,
  count = 3,
): UpgradeChoice[] {
  const pool = UPGRADE_IDS.filter((id) => up[id] < UPGRADES[id].maxLevel);
  // Fisher-Yates using the injected RNG for testability.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const choices = pool.slice(0, count).map((id) => describeChoice(id, up, meta));
  while (choices.length < count && !choices.some((c) => c.id === 'restore')) {
    choices.push({
      id: 'restore',
      name: 'Restorative Draught',
      glyph: '⚗︎',
      nextLevel: 1,
      maxLevel: 1,
      description: `Every rune is mastered. Heal ${RESTORE_HEAL} health.`,
    });
  }
  return choices;
}

export function applyUpgrade(up: UpgradeLevels, id: UpgradeId): UpgradeLevels {
  const def = UPGRADES[id];
  return { ...up, [id]: Math.min(def.maxLevel, up[id] + 1) };
}

// ---------------------------------------------------------------- Rewards

export interface RunSummary {
  time: number;
  kills: number;
  level: number;
  bossKills: number;
}

export function computeReward(run: RunSummary): number {
  const t = Math.max(0, run.time);
  return Math.max(
    0,
    Math.floor(
      Math.floor(t / 10) * REWARDS.perTenSeconds +
        Math.max(0, run.kills) * REWARDS.perKill +
        Math.max(0, run.level - 1) * REWARDS.perLevel +
        Math.max(0, run.bossKills) * REWARDS.perBoss,
    ),
  );
}

// ---------------------------------------------------------------- Meta upgrades

export type MetaId = keyof MetaLevels;

export interface MetaDef {
  id: MetaId;
  name: string;
  glyph: string;
  costs: number[];
  describe: (level: number) => string;
}

export const META_UPGRADES: Record<MetaId, MetaDef> = {
  health: {
    id: 'health',
    name: 'Hardy Scales',
    glyph: '♥',
    costs: [25, 50, 90, 140, 200],
    describe: (l) => `Start each run with +${10 * l} max health.`,
  },
  damage: {
    id: 'damage',
    name: 'Sharpened Focus',
    glyph: '✦',
    costs: [30, 60, 100, 150, 220],
    describe: (l) => `Start each run with +${8 * l}% spell damage.`,
  },
  pickup: {
    id: 'pickup',
    name: 'Lodestone Fangs',
    glyph: '◇',
    costs: [20, 45, 80],
    describe: (l) => `Start each run with +${15 * l}% crystal pickup radius.`,
  },
  wisdom: {
    id: 'wisdom',
    name: 'Ancient Wisdom',
    glyph: '❂',
    costs: [40, 90, 160],
    describe: (l) => `Gain +${10 * l}% experience from all sources.`,
  },
};

export const META_IDS = Object.keys(META_UPGRADES) as MetaId[];

export function metaMaxLevel(id: MetaId): number {
  return META_UPGRADES[id].costs.length;
}

/** Cost of the next level, or null if maxed. */
export function metaNextCost(id: MetaId, level: number): number | null {
  const costs = META_UPGRADES[id].costs;
  return level < costs.length ? costs[level] : null;
}
