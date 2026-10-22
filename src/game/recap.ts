import type { BossId, EnemyKind, SpellId } from './config';
import type { HazardKind, SolidName, VentLook, WallName } from './maps/types';

/**
 * What hurt the player: a foe's attack (a boss other than Ouroboros is named by its id), terrain
 * you touched (kind 'wall', named by the solid or hazard), or a burst like a vent (kind 'hazard').
 */
export interface HurtSource {
  kind: EnemyKind | BossId | 'wall' | 'hazard';
  attack:
    | 'bite'
    | 'charge'
    | 'lunge'
    | 'shot'
    | 'volley'
    | 'leap'
    | 'fireball'
    | 'flame'
    | 'meteor'
    | 'spore'
    | 'erupt'
    | 'icicle'
    | 'slam'
    | 'fire'
    | VentLook
    | SolidName
    | WallName
    | HazardKind;
}

export interface SpellRecap {
  casts: number;
  /** Damage actually dealt (overkill on the final hit isn't counted). */
  damage: number;
  kills: number;
}

/** Everything that can damage a foe: the five spells, and Constrict. */
export type DamageSource = SpellId | 'constrict' | 'hazard';

/** Per-run statistics shown on the game-over screen. */
export interface RunRecap {
  /** Per spell, plus Constrict (whose "casts" are loops that caught foes). */
  spells: Record<DamageSource, SpellRecap>;
  /** How cleanly the run's sigils were drawn. */
  casts: { perfect: number; clean: number; rough: number };
  /** Damage taken, keyed by hurtKey(). */
  taken: Record<string, number>;
  /** The hurtKey() of the blow that ended the run, or null if it was ended from the menu. */
  killedBy: string | null;
  /** Hits the Arcane Ward absorbed. */
  blocked: number;
  elitesSlain: number;
  /** Deepest depth reached (1 before the first boss falls), and the map it was on. */
  depth: number;
  map: string;
  /** Urns and reliquaries smashed, health restored from pickups, and buffs collected. */
  breakables: number;
  healed: number;
  buffs: number;
  /** XP in the crystals breakables dropped (to keep them a side source, B5). */
  breakableXp: number;
}

export function emptyRecap(): RunRecap {
  const spell = (): SpellRecap => ({ casts: 0, damage: 0, kills: 0 });
  return {
    spells: { bolt: spell(), lightning: spell(), nova: spell(), ward: spell(), frost: spell(), constrict: spell(), hazard: spell() },
    casts: { perfect: 0, clean: 0, rough: 0 },
    taken: {},
    killedBy: null,
    blocked: 0,
    elitesSlain: 0,
    depth: 1,
    map: 'Sunken Ruins',
    breakables: 0,
    healed: 0,
    buffs: 0,
    breakableXp: 0,
  };
}

export function hurtKey(src: HurtSource): string {
  return `${src.kind}:${src.attack}`;
}

const HURT_NAMES: Record<string, string> = {
  'chaser:bite': "a Chaser's bite",
  'caster:bite': "a Caster's touch",
  'caster:shot': "a Caster's bolt",
  'brute:bite': "a Brute's fist",
  'brute:charge': "a Brute's charge",
  'rival:bite': "a rival serpent's bite",
  'rival:lunge': "a rival serpent's lunge",
  'boss:bite': "Ouroboros's fangs",
  'boss:charge': "Ouroboros's charge",
  'boss:volley': "Ouroboros's volley",
  'wall:wall': 'the ruin walls',
  'wall:pillar': 'a broken pillar',
  'wall:column': 'a toppled column',
  'wall:statue': 'a fallen statue',
  'wall:colossus': 'the Fallen Colossus',
  'wall:cliff': 'the basalt cliffs',
  'wall:roots': 'the root walls',
  'wall:crypt': 'the catacomb walls',
  'wall:stalk': 'a mushroom stalk',
  'wall:heartroot': 'the Heartroot',
  'wall:root': 'a gnarled root',
  'wall:cap': "the Fallen Giant's cap",
  'wall:icePillar': 'a pillar of ice',
  'wall:sarcophagus': 'a sarcophagus',
  'wall:bramble': 'brambles',
  'hazard:spores': 'a spore vent',
  'hazard:icicle': 'falling icicles',
  'sporeling:bite': "a Sporeling's nip",
  'puffcap:bite': "a Puffcap's touch",
  'puffcap:spore': "a Puffcap's spores",
  'thornback:bite': "a Thornback's horns",
  'thornback:charge': "a Thornback's charge",
  'burrowViper:bite': "a Burrow Viper's fangs",
  'burrowViper:erupt': 'a Burrow Viper bursting from below',
  'rattler:bite': "a Bone Rattler's claws",
  'frostArcher:bite': "a Frost Archer's blade",
  'frostArcher:icicle': "a Frost Archer's icicle",
  'golem:bite': "a Crypt Golem's fist",
  'golem:slam': "a Crypt Golem's slam",
  'wraith:bite': "a Wraith's touch",
  'wraith:lunge': "a Wraith's lunge",
  'sporemaw:bite': "Sporemaw's jaws",
  'sporemaw:volley': "Sporemaw's volley",
  'sporemaw:spore': "Sporemaw's spores",
  'sporemaw:erupt': 'Sporemaw bursting from below',
  'rimecoil:bite': "Rimecoil's fangs",
  'rimecoil:charge': "Rimecoil's charge",
  'rimecoil:volley': "Rimecoil's volley",
  'rimecoil:icicle': "Rimecoil's icicles",
  'wall:basalt': 'a basalt column',
  'wall:spire': 'an obsidian spire',
  'wall:ridge': 'a ridge of cooled lava',
  'wall:anvil': "the Forge's anvil",
  'wall:lava': 'lava',
  'wall:fire': 'burning ground',
  'hazard:vent': 'an eruption vent',
  'imp:bite': "a Cinder Imp's claws",
  'imp:leap': "a Cinder Imp's leap",
  'pyromancer:bite': "a Pyromancer's touch",
  'pyromancer:fireball': "a Pyromancer's fireball",
  'magmaBrute:bite': "a Magma Brute's fist",
  'magmaBrute:charge': "a Magma Brute's charge",
  'salamander:bite': "a Salamander's bite",
  'salamander:flame': "a Salamander's flame",
  'pyrecoil:bite': "Pyrecoil's fangs",
  'pyrecoil:charge': "Pyrecoil's charge",
  'pyrecoil:volley': "Pyrecoil's volley",
  'pyrecoil:meteor': "Pyrecoil's meteors",
};

export function describeHurt(key: string): string {
  return HURT_NAMES[key] ?? key;
}

/** The source that dealt the most damage over the run. */
export function worstHurt(recap: RunRecap): { key: string; amount: number } | null {
  let best: { key: string; amount: number } | null = null;
  for (const [key, amount] of Object.entries(recap.taken)) if (!best || amount > best.amount) best = { key, amount };
  return best;
}
