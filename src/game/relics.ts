import { SNAKE, SPELLS, type SpellId } from './config';
import { addShake, burst, floater } from './effects';
import { mapForIndex } from './maps';
import type { MapId } from './maps/types';
import { segmentsForLevel, type RunMods } from './progression';
import type { HurtSource } from './recap';
import type { World } from './world';

/**
 * Relics (R1-R4): one is chosen at each way down and kept for the run. Some change the numbers
 * (they become run modifiers), some act as things happen (a kill, a blow, a cast, each step), and
 * each map has one that blunts its own hazards. Ten are known from the start; the Grimoire
 * unlocks the rest.
 */

export type RelicId =
  | 'ouroboros'
  | 'tailSigil'
  | 'glassFang'
  | 'echoStone'
  | 'huntersMark'
  | 'quill'
  | 'sacrificialScales'
  | 'thickHide'
  | 'bloodglyph'
  | 'wardensBell'
  | 'lodestar'
  | 'hourglass'
  | 'gamblersDie'
  | 'frenziedHeart'
  | 'stoneshaper'
  | 'thornhide'
  | 'rimewalker'
  | 'emberwalk';

export interface RelicDef {
  name: string;
  description: string;
  /** Icon as SVG path data in a 24×24 box (filled even-odd), and its colour. */
  icon: string;
  color: string;
  /** Known from the start; otherwise unlocked in the Grimoire for \`cost\` shards. */
  known: boolean;
  cost: number;
  /** The map whose hazards it blunts: offered on the way down to that map. */
  map?: MapId;
}

export const RELICS: Record<RelicId, RelicDef> = {
  ouroboros: {
    name: 'Ouroboros Coil',
    description: '+1% spell damage for every 4 body segments.',
    icon: 'M12 2a10 10 0 1 0 10 10h-4a6 6 0 1 1-6-6zM16 1l6 2-2 6-3-3z',
    color: '#2fd3b5',
    known: true,
    cost: 0,
  },
  tailSigil: {
    name: 'Tail Sigil',
    description: 'The tip of your tail fires a bolt at the nearest foe every 1.5 s.',
    icon: 'M2 21c6 0 8-4 8-9s3-8 8-8V1l5 4.5-5 4.5V7c-3 0-5 2-5 5 0 6-4 11-11 11z',
    color: '#c9b8ff',
    known: true,
    cost: 0,
  },
  glassFang: {
    name: 'Glass Fang',
    description: '+40% spell damage, but 25% less max health.',
    icon: 'M4 2h16l-8 21zM9 5l3 9 3-9z',
    color: '#bfe6ff',
    known: true,
    cost: 0,
  },
  echoStone: {
    name: 'Echo Stone',
    description: 'Every 5th sigil you cast is cast twice.',
    icon: 'M12 2a10 10 0 1 1 0 20a10 10 0 1 1 0-20zm0 4a6 6 0 1 0 0 12a6 6 0 1 0 0-12zm0 3a3 3 0 1 1 0 6a3 3 0 1 1 0-6z',
    color: '#8fd8ff',
    known: false,
    cost: 250,
  },
  huntersMark: {
    name: "Hunter's Mark",
    description: 'Elites and bosses take 25% more damage.',
    icon: 'M11 1h2v6h-2zM11 17h2v6h-2zM1 11h6v2H1zM17 11h6v2h-6zM12 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10zm0 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
    color: '#ff7a8f',
    known: true,
    cost: 0,
  },
  quill: {
    name: 'Quill of Precision',
    description: 'A Perfect sigil refunds half its cooldown.',
    icon: 'M21 2C11 3 5 9 4 19l-2 2 1 1 2-2c10-1 16-7 17-17-3 2-6 3-9 3 3-1 6-3 8-4z',
    color: '#ffd45e',
    known: false,
    cost: 200,
  },
  sacrificialScales: {
    name: 'Sacrificial Scales',
    description: 'Once per map, a killing blow instead sheds a third of your body and leaves you at 30% health.',
    icon: 'M12 1l9 4v7c0 6-4 10-9 11-5-1-9-5-9-11V5zM13 5l-4 7h3l-2 7 6-9h-3l2-5z',
    color: '#ffb070',
    known: true,
    cost: 0,
  },
  thickHide: {
    name: 'Thick Hide',
    description: 'Foes deal 15% less damage to you.',
    icon: 'M12 1l9 4v7c0 6-4 10-9 11-5-1-9-5-9-11V5z',
    color: '#a6d65a',
    known: true,
    cost: 0,
  },
  bloodglyph: {
    name: 'Bloodglyph',
    description: 'Heal 1 health for every 8 foes slain.',
    icon: 'M12 1c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z',
    color: '#ff4f7b',
    known: false,
    cost: 150,
  },
  wardensBell: {
    name: "Warden's Bell",
    description: 'Falling below 30% health rings a free Nova and 2 s of safety (once every 30 s).',
    icon: 'M12 1a2 2 0 0 1 2 2v1c3 1 5 4 5 8v4l2 2v2H3v-2l2-2v-4c0-4 2-7 5-8V3a2 2 0 0 1 2-2zM9 21h6a3 3 0 0 1-6 0z',
    color: '#ffe08a',
    known: false,
    cost: 200,
  },
  lodestar: {
    name: 'Lodestar',
    description: 'Crystals fly in from twice as far, and you gain 15% more XP.',
    icon: 'M12 1l2.5 7.5L22 6l-4.5 6L22 18l-7.5-2.5L12 23l-2.5-7.5L2 18l4.5-6L2 6l7.5 2.5z',
    color: '#c45ad8',
    known: false,
    cost: 150,
  },
  hourglass: {
    name: 'Hourglass of Ages',
    description: 'Your ultimate recharges 30% faster.',
    icon: 'M5 2h14v3l-5 7 5 7v3H5v-3l5-7-5-7z',
    color: '#ffd45e',
    known: false,
    cost: 250,
  },
  gamblersDie: {
    name: "Gambler's Die",
    description: '2 more rerolls and 1 more banish, now.',
    icon: 'M4 4h16v16H4zM8 6.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zm8 8a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zm-4-4a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z',
    color: '#e8e0d0',
    known: false,
    cost: 150,
  },
  frenziedHeart: {
    name: 'Frenzied Heart',
    description: 'Cooldowns are 25% shorter, but foes move 15% faster.',
    icon: 'M12 22C5 16 1 12.5 1 8a5.5 5.5 0 0 1 11-1.5A5.5 5.5 0 0 1 23 8c0 4.5-4 8-11 14zM13 5l-4 7h3l-2 6 5-8h-3l2-5z',
    color: '#ff5a36',
    known: false,
    cost: 200,
  },
  stoneshaper: {
    name: "Stoneshaper's Charm",
    description: "Walls and pillars don't hurt you (you still bounce off). The Ruins' relic.",
    icon: 'M5 2h14v3h-2v14h2v3H5v-3h2V5H5z',
    color: '#c9b8ff',
    known: true,
    cost: 0,
    map: 'ruins',
  },
  thornhide: {
    name: 'Thornhide',
    description: "Brambles don't hurt you, and spore bursts deal half damage. The Hollows' relic.",
    icon: 'M12 1l2 6 6-2-3 6 6 3-6 2 2 7-5-4-2 6-2-6-5 4 2-7-6-2 6-3-3-6 6 2z',
    color: '#e86ad8',
    known: true,
    cost: 0,
    map: 'hollows',
  },
  rimewalker: {
    name: 'Rimewalker',
    description: "Ice doesn't widen your turns, and falling icicles deal half damage. The Catacombs' relic.",
    icon: 'M11 1h2v22h-2zM1 11h22v2H1zM4.2 2.8l17 17-1.4 1.4-17-17zM19.8 2.8l1.4 1.4-17 17-1.4-1.4z',
    color: '#9fd8ff',
    known: true,
    cost: 0,
    map: 'catacombs',
  },
  emberwalk: {
    name: 'Emberwalk',
    description: "Lava and burning ground don't hurt you, and eruptions deal half damage. The Ember Depths' relic.",
    icon: 'M12 1c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z',
    color: '#ff8a3c',
    known: true,
    cost: 0,
    map: 'ember',
  },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];
export const KNOWN_RELICS: RelicId[] = RELIC_IDS.filter((id) => RELICS[id].known);

/** Tuning for the relics that act as things happen. */
export const RELIC_TUNING = {
  segmentsPerPercent: 4,
  tailInterval: 1.5,
  tailRange: 520,
  glassDamage: 1.4,
  glassHealth: 0.75,
  echoEvery: 5,
  markDamage: 1.25,
  quillRefund: 0.5,
  sacrificeHealth: 0.3,
  sacrificeShed: 1 / 3,
  thickHide: 0.85,
  bloodKills: 8,
  bellBelow: 0.3,
  bellSafety: 2,
  bellCooldown: 30,
  lodestarPickup: 2,
  lodestarXp: 1.15,
  hourglass: 0.7,
  dieRerolls: 2,
  dieBanishes: 1,
  frenzyCooldown: 0.75,
  frenzyFoes: 1.15,
  hazardShare: 0.5,
  /** Leaving the relics where they lie heals this share of max health. */
  leaveHeal: 0.4,
};

export function hasRelic(world: World, id: RelicId): boolean {
  return world.relics.includes(id);
}

/** What the run's relics add to its modifiers (Ouroboros Coil grows with the body). */
export function relicMods(world: World): Partial<RunMods>[] {
  const t = RELIC_TUNING;
  const out: Partial<RunMods>[] = [];
  for (const id of world.relics) {
    if (id === 'ouroboros') out.push({ damageMult: 1 + 0.01 * Math.floor(segmentsForLevel(world.level) / t.segmentsPerPercent) });
    else if (id === 'glassFang') out.push({ damageMult: t.glassDamage, maxHpMult: t.glassHealth });
    else if (id === 'thickHide') out.push({ damageTakenMult: t.thickHide });
    else if (id === 'lodestar') out.push({ pickupMult: t.lodestarPickup, xpMult: t.lodestarXp });
    else if (id === 'hourglass') out.push({ ultimateCooldownMult: t.hourglass });
    else if (id === 'frenziedHeart') out.push({ cooldownMult: t.frenzyCooldown });
  }
  return out;
}

/**
 * The three relics offered on the way down: the next map's own relic (if the save knows it and
 * the run doesn't have it), then random others the save knows. Fewer when few are left. A
 * waystone start offers for the map it starts on (`mapIndex`).
 */
export function offerRelics(world: World, rng: () => number, mapIndex = world.mapIndex + 1): RelicId[] {
  const pool = world.relicPool.filter((id) => !world.relics.includes(id));
  const next = mapForIndex(mapIndex).id;
  const own = pool.find((id) => RELICS[id].map === next);
  const rest = pool.filter((id) => id !== own);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...(own ? [own] : []), ...rest].slice(0, 3);
}

/** Takes a relic for the rest of the run. Returns false if the run already has it. */
export function takeRelic(world: World, id: RelicId): boolean {
  if (world.relics.includes(id)) return false;
  world.relics.push(id);
  if (id === 'gamblersDie') {
    world.rerolls += RELIC_TUNING.dieRerolls;
    world.banishes += RELIC_TUNING.dieBanishes;
  } else if (id === 'frenziedHeart') world.effects.enemyTimeScale *= RELIC_TUNING.frenzyFoes;
  return true;
}

/**
 * How much of a blow the relics let through, from 0 (none: the blow doesn't land) to 1. The map
 * relics blunt their own map's ground and bursts; stone stings only without Stoneshaper's Charm.
 */
export function relicShare(world: World, source: HurtSource): number {
  if (world.relics.length === 0) return 1;
  const a = source.attack;
  if (source.kind === 'wall') {
    if (a === 'lava' || a === 'fire') return hasRelic(world, 'emberwalk') ? 0 : 1;
    if (a === 'bramble') return hasRelic(world, 'thornhide') ? 0 : 1;
    return hasRelic(world, 'stoneshaper') ? 0 : 1;
  }
  if (source.kind === 'hazard') {
    const half = RELIC_TUNING.hazardShare;
    if (a === 'spores' && hasRelic(world, 'thornhide')) return half;
    if (a === 'icicle' && hasRelic(world, 'rimewalker')) return half;
    if (a === 'vent' && hasRelic(world, 'emberwalk')) return half;
  }
  return 1;
}

/**
 * Sacrificial Scales: a blow that would kill sheds a third of the body instead, once per map.
 * Returns true if it saved the serpent (its health is then set).
 */
export function sacrifice(world: World): boolean {
  if (!hasRelic(world, 'sacrificialScales') || world.relicState.sacrificed) return false;
  const t = RELIC_TUNING;
  const s = world.snake;
  world.relicState.sacrificed = true;
  world.hp = Math.max(1, Math.round(world.stats.maxHp * t.sacrificeHealth));
  s.segmentCount = Math.max(SNAKE.startSegments, s.segmentCount * (1 - t.sacrificeShed));
  s.updateSegments();
  world.invuln = SNAKE.invulnTime * 1.5;
  burst(world, s.x, s.y, RELICS.sacrificialScales.color, 40, 320, { kind: 'shard', size: 4, life: 0.8 });
  floater(world, s.x, s.y - 34, 'Scales shed!', RELICS.sacrificialScales.color, { size: 20, life: 1.2 });
  addShake(world, 0.5);
  world.sfx('evolve');
  return true;
}

/** Warden's Bell: after a blow, low health rings a free Nova and a moment of safety. */
export function ringBell(world: World, nova: () => void): void {
  const t = RELIC_TUNING;
  if (!hasRelic(world, 'wardensBell') || world.hp <= 0 || world.hp >= world.stats.maxHp * t.bellBelow) return;
  if (world.time < world.relicState.bellReady) return;
  world.relicState.bellReady = world.time + t.bellCooldown;
  world.invuln = Math.max(world.invuln, t.bellSafety);
  nova();
  floater(world, world.snake.x, world.snake.y - 34, "Warden's Bell", RELICS.wardensBell.color, { size: 18, life: 1 });
}

/** Bloodglyph: every few kills heal a little. */
export function onRelicKill(world: World): void {
  if (!hasRelic(world, 'bloodglyph')) return;
  if (++world.relicState.kills % RELIC_TUNING.bloodKills === 0 && world.hp > 0) world.hp = Math.min(world.stats.maxHp, world.hp + 1);
}

/**
 * After a sigil is cast and its cooldown set: the Quill refunds half a Perfect cast's cooldown,
 * and the Echo Stone casts every fifth sigil again. \`again\` casts it.
 */
export function afterSigil(world: World, spell: SpellId, perfect: boolean, again: () => void): void {
  if (perfect && hasRelic(world, 'quill')) world.cooldowns[spell] *= 1 - RELIC_TUNING.quillRefund;
  if (hasRelic(world, 'echoStone') && ++world.relicState.casts % RELIC_TUNING.echoEvery === 0) {
    again();
    floater(world, world.snake.x, world.snake.y - 40, 'Echo!', RELICS.echoStone.color, { size: 16, life: 0.8 });
  }
}

/** Per step: the Tail Sigil fires from the tip of the tail. \`fire\` shoots a bolt from (x, y) at angle a. */
export function updateRelics(world: World, dt: number, fire: (x: number, y: number, a: number, damage: number) => void): void {
  if (!hasRelic(world, 'tailSigil')) return;
  const st = world.relicState;
  st.tail -= dt;
  if (st.tail > 0) return;
  const segs = world.snake.segments;
  const tip = segs.length > 0 ? segs[segs.length - 1] : world.snake;
  const t = RELIC_TUNING;
  let best: { x: number; y: number } | null = null;
  let bestD = t.tailRange * t.tailRange;
  for (const e of world.enemies) {
    if (e.dead || e.hidden || e.pile > 0) continue;
    const d = (e.x - tip.x) ** 2 + (e.y - tip.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) {
    st.tail = 0.25;
    return;
  }
  st.tail = t.tailInterval;
  fire(tip.x, tip.y, Math.atan2(best.y - tip.y, best.x - tip.x), SPELLS.bolt.damage * world.stats.damageMult);
}
