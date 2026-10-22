import { ASPECTS, DUOS, LEVEL_TOOLS, OVERCHARGE, SPELL_IDS } from './config';
import {
  applyUpgrade,
  canBanish,
  RESTORE_HEAL,
  rollUpgradeChoices,
  spellCooldown,
  type ChoiceContext,
  type UpgradeChoice,
} from './progression';
import { refreshStats, type World } from './world';

/**
 * Level-ups in a run (L1-L6): rolling an offer from everything the run has taken, applying the
 * card picked, and the tools for an offer you don't like (reroll, banish, skip). The engine adds
 * the sound and sparkle; the balance bot uses these as they are.
 */

/** What the roll needs to know about this run. */
export function choiceContext(world: World, level: number): ChoiceContext {
  return {
    known: world.known,
    evolved: world.evolved,
    level,
    aspects: world.aspects,
    duos: world.duos,
    duoPool: world.duoPool,
    banished: world.banished,
    overcharge: world.overcharge,
  };
}

export function rollOffer(world: World, level: number, rng: () => number): UpgradeChoice[] {
  return rollUpgradeChoices(world.upgrades, world.meta, rng, world.cardCount, choiceContext(world, level), world.mods);
}

/** Spends a reroll on a fresh offer, or returns null when none are left. */
export function rerollOffer(world: World, level: number, rng: () => number): UpgradeChoice[] | null {
  if (world.rerolls <= 0) return null;
  world.rerolls--;
  return rollOffer(world, level, rng);
}

/**
 * Spends a banish: the card leaves the run's pool for good, and its place in the offer goes to a
 * card the offer doesn't already hold. Returns the new offer, or null if the card can't be banished.
 */
export function banishFromOffer(world: World, offer: UpgradeChoice[], choice: UpgradeChoice, level: number, rng: () => number): UpgradeChoice[] | null {
  if (world.banishes <= 0 || !canBanish(choice) || !offer.some((c) => c.id === choice.id)) return null;
  world.banishes--;
  world.banished.push(choice.id);
  const wider = rollUpgradeChoices(world.upgrades, world.meta, rng, offer.length + 6, choiceContext(world, level), world.mods);
  const fresh = wider.find((c) => !offer.some((o) => o.id === c.id));
  return offer.flatMap((c) => (c.id !== choice.id ? [c] : fresh ? [fresh] : []));
}

/** Skipping a level-up's cards heals a little instead. Returns the health restored. */
export function skipLevelUp(world: World): number {
  const before = world.hp;
  world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp * LEVEL_TOOLS.skipHeal);
  return world.hp - before;
}

/** Puts a level-up card into effect. */
export function applyChoice(world: World, choice: UpgradeChoice): void {
  const prevMax = world.stats.maxHp;
  if (choice.kind === 'restore') {
    world.hp = Math.min(world.stats.maxHp, world.hp + RESTORE_HEAL);
  } else if (choice.kind === 'learn' && choice.spell) {
    if (!world.known.includes(choice.spell)) world.known.push(choice.spell);
    world.cooldowns[choice.spell] = 0;
  } else if (choice.kind === 'evolve' && choice.spell) {
    world.evolved[choice.spell] = true;
    world.cooldowns[choice.spell] = 0;
  } else if (choice.kind === 'aspect' && choice.aspect) {
    world.aspects[ASPECTS[choice.aspect].spell] = choice.aspect;
  } else if (choice.kind === 'duo' && choice.duo) {
    if (!world.duos.includes(choice.duo)) world.duos.push(choice.duo);
    for (const s of DUOS[choice.duo].spells) world.cooldowns[s] = 0;
  } else if (choice.kind === 'overcharge' && choice.overcharge) {
    world.overcharge[choice.overcharge]++;
    refreshStats(world);
    if (choice.overcharge === 'vigor') world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp - prevMax + OVERCHARGE.vigor.heal);
  } else if (choice.upgrade) {
    world.upgrades = applyUpgrade(world.upgrades, choice.upgrade);
    refreshStats(world);
    if (choice.upgrade === 'vitality') world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp - prevMax + 30);
  }
  // Cooldowns already running never last longer than the spell's new cooldown.
  for (const id of SPELL_IDS) world.cooldowns[id] = Math.min(world.cooldowns[id], spellCooldown(id, world.stats));
}
