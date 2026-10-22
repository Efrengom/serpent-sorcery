/**
 * Run progression (XP, level-up upgrades, derived spell stats) and
 * meta progression (permanent upgrades bought with Arcane Shards).
 * Everything here is pure so it can be unit tested.
 */

import {
  ASPECT_FROM_LEVEL,
  ASPECT_IDS,
  ASPECTS,
  COOLDOWN_FLOOR,
  DUO_IDS,
  DUOS,
  EVOLUTION_PARTNER_RANKS,
  EVOLUTIONS,
  HEAT,
  OVERCHARGE,
  OVERCHARGE_IDS,
  PROGRESSION,
  REWARDS,
  SNAKE,
  SPELL_IDS,
  SPELL_INFO,
  SPELLS,
  type AspectId,
  type DuoId,
  type OverchargeId,
  type SpellId,
} from './config';

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
  | 'regen'
  | 'wardRunes'
  | 'deepFrost';

export type UpgradeLevels = Record<UpgradeId, number>;

/** Run-wide modifiers from the chosen wizard, curses, relics and overcharge. */
export interface RunMods {
  maxHp: number;
  maxHpMult: number;
  damageMult: number;
  cooldownMult: number;
  wardCharges: number;
  frostRadiusMult: number;
  chains: number;
  /** Crystal pickup reach and XP gained. */
  pickupMult: number;
  xpMult: number;
  /** Damage taken from foes. */
  damageTakenMult: number;
  /** The ultimate's cooldown. */
  ultimateCooldownMult: number;
}

export const NO_MODS: RunMods = {
  maxHp: 0,
  maxHpMult: 1,
  damageMult: 1,
  cooldownMult: 1,
  wardCharges: 0,
  frostRadiusMult: 1,
  chains: 0,
  pickupMult: 1,
  xpMult: 1,
  damageTakenMult: 1,
  ultimateCooldownMult: 1,
};

const ADDED_MODS = ['maxHp', 'wardCharges', 'chains'] as const;

/** Stacks run modifiers: health, ward charges and chains add up; every multiplier multiplies. */
export function combineMods(base: RunMods, ...more: Partial<RunMods>[]): RunMods {
  const out = { ...base };
  for (const m of more) {
    for (const [key, v] of Object.entries(m) as [keyof RunMods, number][]) {
      if (v === undefined) continue;
      if ((ADDED_MODS as readonly string[]).includes(key)) out[key] += v;
      else out[key] *= v;
    }
  }
  return out;
}

/** Overcharge ranks taken this run. */
export type OverchargeLevels = Record<OverchargeId, number>;

export function emptyOvercharge(): OverchargeLevels {
  return { power: 0, vigor: 0, focus: 0 };
}

/** What overcharge ranks add to a run's modifiers. */
export function overchargeMods(o: OverchargeLevels): Partial<RunMods> {
  return {
    damageMult: 1 + OVERCHARGE.power.damage * o.power,
    maxHp: OVERCHARGE.vigor.maxHp * o.vigor,
    cooldownMult: OVERCHARGE.focus.cooldown ** o.focus,
  };
}

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
  wardCharges: number;
  wardDuration: number;
  frostRadius: number;
  /** Time scale for enemies inside a Frost Field (lower = slower). */
  frostSlow: number;
  frostDamageMult: number;
  /** Share of a foe's blow that lands, and of the ultimate's cooldown. */
  damageTaken: number;
  ultimateCooldownMult: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  glyph: string;
  maxLevel: number;
  /** Only offered once this spell is known. */
  spell?: SpellId;
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
    spell: 'bolt',
    describe: (c, n) => `Arcane Bolt fires ${n.boltCount} projectiles in a fan (was ${c.boltCount}).`,
  },
  pierce: {
    id: 'pierce',
    name: 'Piercing Bolt',
    glyph: '➶',
    maxLevel: 4,
    spell: 'bolt',
    describe: (c, n) =>
      `Bolts pass through ${n.boltPierce} ${n.boltPierce === 1 ? 'enemy' : 'enemies'} before breaking (was ${c.boltPierce}).`,
  },
  chains: {
    id: 'chains',
    name: 'Forked Chains',
    glyph: 'ϟ',
    maxLevel: 5,
    spell: 'lightning',
    describe: (c, n) => `Forked Lightning jumps to ${n.chains} extra targets (was ${c.chains}).`,
  },
  novaRadius: {
    id: 'novaRadius',
    name: 'Nova Expanse',
    glyph: '◎',
    maxLevel: 5,
    spell: 'nova',
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
      return `All cooldowns −8%: Bolt ${cd('bolt', c)}→${cd('bolt', n)}s, Nova ${cd('nova', c)}→${cd('nova', n)}s.`;
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
  wardRunes: {
    id: 'wardRunes',
    name: 'Warding Runes',
    glyph: '△',
    maxLevel: 2,
    spell: 'ward',
    describe: (c, n) => `Arcane Ward blocks ${n.wardCharges} hits (was ${c.wardCharges}) and lasts ${r1(n.wardDuration)}s.`,
  },
  deepFrost: {
    id: 'deepFrost',
    name: 'Deep Frost',
    glyph: '❄',
    maxLevel: 3,
    spell: 'frost',
    describe: (c, n) =>
      `Frost Field radius ${Math.round(c.frostRadius)} → ${Math.round(n.frostRadius)}, foes inside move at ${pct(n.frostSlow)} speed and take +25% frost damage.`,
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export function emptyUpgradeLevels(): UpgradeLevels {
  return {
    potency: 0,
    multibolt: 0,
    pierce: 0,
    chains: 0,
    novaRadius: 0,
    haste: 0,
    vitality: 0,
    magnet: 0,
    regen: 0,
    wardRunes: 0,
    deepFrost: 0,
  };
}

export function emptyMetaLevels(): MetaLevels {
  return { health: 0, damage: 0, pickup: 0, wisdom: 0 };
}

export function computeStats(up: UpgradeLevels, meta: MetaLevels, mods: RunMods = NO_MODS): PlayerStats {
  return {
    damageMult: (1 + 0.15 * up.potency) * (1 + 0.08 * meta.damage) * mods.damageMult,
    boltCount: 1 + up.multibolt,
    boltPierce: up.pierce,
    chains: SPELLS.lightning.chains + up.chains + mods.chains,
    novaRadius: SPELLS.nova.radius * (1 + 0.2 * up.novaRadius),
    novaDamageMult: 1 + 0.1 * up.novaRadius,
    cooldownMult: Math.max(COOLDOWN_FLOOR, Math.max(0.6, 1 - 0.08 * up.haste) * mods.cooldownMult),
    maxHp: Math.max(10, Math.round((SNAKE.baseMaxHp + 10 * meta.health + 20 * up.vitality + mods.maxHp) * mods.maxHpMult)),
    pickupRadius: SNAKE.basePickupRadius * (1 + 0.15 * meta.pickup) * (1 + 0.35 * up.magnet) * mods.pickupMult,
    regenPerSec: 0.6 * up.regen,
    xpMult: (1 + 0.1 * meta.wisdom) * mods.xpMult,
    wardCharges: SPELLS.ward.charges + up.wardRunes + mods.wardCharges,
    wardDuration: SPELLS.ward.duration + 1.5 * up.wardRunes,
    frostRadius: SPELLS.frost.radius * (1 + 0.18 * up.deepFrost) * mods.frostRadiusMult,
    frostSlow: Math.max(0.2, SPELLS.frost.slow - 0.07 * up.deepFrost),
    frostDamageMult: 1 + 0.25 * up.deepFrost,
    damageTaken: mods.damageTakenMult,
    ultimateCooldownMult: mods.ultimateCooldownMult,
  };
}

export function spellCooldown(id: SpellId, stats: PlayerStats): number {
  const s = SPELLS[id];
  return Math.max(s.minCooldown, s.cooldown * stats.cooldownMult);
}

export type ChoiceKind = 'upgrade' | 'learn' | 'evolve' | 'aspect' | 'duo' | 'overcharge' | 'restore';

export interface UpgradeChoice {
  /** The UpgradeId, `learn-<spell>`, `evolve-<spell>`, `aspect-<id>`, `duo-<id>`, `over-<id>` or 'restore'. */
  id: string;
  kind: ChoiceKind;
  upgrade?: UpgradeId;
  spell?: SpellId;
  aspect?: AspectId;
  duo?: DuoId;
  /** A duo's two spells, for its card. */
  pair?: readonly [SpellId, SpellId];
  overcharge?: OverchargeId;
  name: string;
  glyph: string;
  /** Level the upgrade will reach if chosen. */
  nextLevel: number;
  maxLevel: number;
  description: string;
}

/** What the level-up roll needs to know about the run beyond upgrade levels. */
export interface ChoiceContext {
  known: readonly SpellId[];
  evolved: Partial<Record<SpellId, boolean>>;
  /** The level just reached. */
  level: number;
  /** Aspects taken this run (one per spell at most). */
  aspects?: Partial<Record<SpellId, AspectId>>;
  /** Duos taken this run, and those the save has unlocked (the known ones when omitted). */
  duos?: readonly DuoId[];
  duoPool?: readonly DuoId[];
  /** Card ids banished this run: never offered again. */
  banished?: readonly string[];
  /** Overcharge ranks taken so far, for the cards' numbers. */
  overcharge?: Partial<Record<OverchargeId, number>>;
}

/** Cards that can't be banished: there's always more of them. */
export function canBanish(choice: UpgradeChoice): boolean {
  return choice.kind !== 'overcharge' && choice.kind !== 'restore';
}

/** The duos a save starts with, before any are unlocked in the Grimoire. */
export const KNOWN_DUOS: DuoId[] = DUO_IDS.filter((id) => DUOS[id].known);

export const DEFAULT_CONTEXT: ChoiceContext = { known: ['bolt', 'lightning', 'nova'], evolved: {}, level: 1 };

export const RESTORE_HEAL = 40;
/** New sigils start appearing at this level; every third level guarantees one while any are unknown. */
export const LEARN_FROM_LEVEL = 3;
const LEARN_CHANCE = 0.35;

export function describeChoice(id: UpgradeId, up: UpgradeLevels, meta: MetaLevels, mods: RunMods = NO_MODS): UpgradeChoice {
  const def = UPGRADES[id];
  const next = { ...up, [id]: up[id] + 1 };
  return {
    id,
    kind: 'upgrade',
    upgrade: id,
    name: def.name,
    glyph: def.glyph,
    nextLevel: up[id] + 1,
    maxLevel: def.maxLevel,
    description: def.describe(computeStats(up, meta, mods), computeStats(next, meta, mods)),
  };
}

export function learnChoice(spell: SpellId): UpgradeChoice {
  return {
    id: `learn-${spell}`,
    kind: 'learn',
    spell,
    name: SPELLS[spell].name,
    glyph: '✧',
    nextLevel: 1,
    maxLevel: 1,
    description: `New sigil: draw a ${SPELL_INFO[spell].shape.toLowerCase()}. ${SPELL_INFO[spell].blurb}`,
  };
}

export function evolveChoice(spell: SpellId): UpgradeChoice {
  const evo = EVOLUTIONS[spell];
  return {
    id: `evolve-${spell}`,
    kind: 'evolve',
    spell,
    name: evo.name,
    glyph: '✹',
    nextLevel: 1,
    maxLevel: 1,
    description: `${SPELLS[spell].name} evolves. ${evo.description}`,
  };
}

/** The other aspect of the same spell. */
export function aspectSibling(id: AspectId): AspectId {
  return ASPECT_IDS.find((a) => a !== id && ASPECTS[a].spell === ASPECTS[id].spell)!;
}

export function aspectChoice(id: AspectId): UpgradeChoice {
  const a = ASPECTS[id];
  return {
    id: `aspect-${id}`,
    kind: 'aspect',
    aspect: id,
    spell: a.spell,
    name: a.name,
    glyph: '◈',
    nextLevel: 1,
    maxLevel: 1,
    description: `${a.description} Rules out ${ASPECTS[aspectSibling(id)].name}.`,
  };
}

export function duoChoice(id: DuoId): UpgradeChoice {
  const d = DUOS[id];
  return {
    id: `duo-${id}`,
    kind: 'duo',
    duo: id,
    spell: d.spells[0],
    pair: d.spells,
    name: d.name,
    glyph: '✸',
    nextLevel: 1,
    maxLevel: 1,
    description: `Duo of ${SPELLS[d.spells[0]].name} and ${SPELLS[d.spells[1]].name}. ${d.description}`,
  };
}

export function overchargeChoice(id: OverchargeId, rank: number): UpgradeChoice {
  const o = OVERCHARGE[id];
  const text: Record<OverchargeId, string> = {
    power: `All spell damage +${Math.round(OVERCHARGE.power.damage * 100)}%.`,
    vigor: `Max health +${OVERCHARGE.vigor.maxHp}, and heal ${OVERCHARGE.vigor.heal} now.`,
    focus: `All cooldowns −${Math.round((1 - OVERCHARGE.focus.cooldown) * 100)}%, down to half.`,
  };
  return {
    id: `over-${id}`,
    kind: 'overcharge',
    overcharge: id,
    name: o.name,
    glyph: o.glyph,
    nextLevel: rank + 1,
    maxLevel: Infinity,
    description: `${text[id]} Endless: every rune you know is mastered.`,
  };
}

/** True when both spells of a duo have evolved, the save knows the duo and the run hasn't taken it. */
export function duoReady(id: DuoId, ctx: ChoiceContext): boolean {
  const [a, b] = DUOS[id].spells;
  return (ctx.duoPool ?? KNOWN_DUOS).includes(id) && !(ctx.duos ?? []).includes(id) && !!ctx.evolved[a] && !!ctx.evolved[b];
}

/** True when a known, unevolved spell has its own upgrade maxed and enough partner ranks. */
export function evolutionReady(spell: SpellId, up: UpgradeLevels, ctx: ChoiceContext): boolean {
  const [own, partner] = EVOLUTIONS[spell].requires as readonly [UpgradeId, UpgradeId];
  return (
    ctx.known.includes(spell) &&
    !ctx.evolved[spell] &&
    up[own] >= UPGRADES[own].maxLevel &&
    up[partner] >= EVOLUTION_PARTNER_RANKS
  );
}

function shuffle<T>(list: T[], rng: () => number): T[] {
  // Fisher-Yates using the injected RNG for testability.
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Builds a level-up offer: a ready evolution and a ready duo always get a slot, a new sigil
 * sometimes does (always on every third level from LEARN_FROM_LEVEL), and distinct non-maxed
 * upgrades and untaken aspects for known spells fill the rest. Banished cards never come back.
 * Once the pool runs dry, endless overcharge fills the offer.
 */
export function rollUpgradeChoices(
  up: UpgradeLevels,
  meta: MetaLevels,
  rng: () => number,
  count = 3,
  ctx: ChoiceContext = DEFAULT_CONTEXT,
  mods: RunMods = NO_MODS,
): UpgradeChoice[] {
  const choices: UpgradeChoice[] = [];
  const banned = new Set(ctx.banished ?? []);
  const pick = <T>(list: T[]) => list[Math.floor(rng() * list.length) % list.length];
  const ready = SPELL_IDS.filter((s) => evolutionReady(s, up, ctx) && !banned.has(`evolve-${s}`));
  if (ready.length > 0) choices.push(evolveChoice(pick(ready)));
  const duos = DUO_IDS.filter((d) => duoReady(d, ctx) && !banned.has(`duo-${d}`));
  if (duos.length > 0 && choices.length < count) choices.push(duoChoice(pick(duos)));
  const unknown = SPELL_IDS.filter((s) => !ctx.known.includes(s) && !banned.has(`learn-${s}`));
  if (
    unknown.length > 0 &&
    choices.length < count &&
    ctx.level >= LEARN_FROM_LEVEL &&
    ((ctx.level - LEARN_FROM_LEVEL) % 3 === 0 || rng() < LEARN_CHANCE)
  ) {
    choices.push(learnChoice(pick(unknown)));
  }
  const upgrades = UPGRADE_IDS.filter((id) => {
    const def = UPGRADES[id];
    return up[id] < def.maxLevel && (!def.spell || ctx.known.includes(def.spell)) && !banned.has(id);
  });
  const aspects =
    ctx.level >= ASPECT_FROM_LEVEL
      ? ASPECT_IDS.filter((a) => {
          const spell = ASPECTS[a].spell;
          return ctx.known.includes(spell) && !ctx.aspects?.[spell] && !banned.has(`aspect-${a}`);
        })
      : [];
  const pool = shuffle<UpgradeId | AspectId>([...upgrades, ...aspects], rng);
  for (const id of pool) {
    if (choices.length >= count) break;
    choices.push(id in UPGRADES ? describeChoice(id as UpgradeId, up, meta, mods) : aspectChoice(id as AspectId));
  }
  for (const id of shuffle([...OVERCHARGE_IDS], rng)) {
    if (choices.length >= count) break;
    choices.push(overchargeChoice(id, ctx.overcharge?.[id] ?? 0));
  }
  while (choices.length < count && !choices.some((c) => c.id === 'restore')) {
    choices.push({
      id: 'restore',
      kind: 'restore',
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
  /** Bonus from curses chosen before the run (1 = none). */
  shardMult?: number;
  /** Shards picked up from Shard Caches during the run (multiplied by curses too). */
  bonusShards?: number;
  /** Heat the run was played at: each level pays more, on top of the curses' cap. */
  heat?: number;
}

/** The most curses can multiply a run's shards by. */
export const MAX_SHARD_MULT = 3;

export function computeReward(run: RunSummary): number {
  const t = Math.max(0, run.time);
  const heat = Number.isFinite(run.heat) ? Math.max(0, Math.min(HEAT.max, run.heat!)) : 0;
  const mult = Math.max(1, Math.min(MAX_SHARD_MULT, Number.isFinite(run.shardMult) ? run.shardMult! : 1)) * (1 + HEAT.shards * heat);
  return Math.max(
    0,
    Math.floor(
      (Math.floor(t / 10) * REWARDS.perTenSeconds +
        Math.max(0, run.kills) * REWARDS.perKill +
        Math.max(0, run.level - 1) * REWARDS.perLevel +
        Math.max(0, run.bossKills) * REWARDS.perBoss +
        Math.max(0, Number.isFinite(run.bonusShards) ? run.bonusShards! : 0)) *
        mult,
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
