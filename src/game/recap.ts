import type { EnemyKind, SpellId } from './config';
import type { SolidName } from './maps/types';

/** What hurt the player: an enemy's attack, or running into a solid (kind 'wall', named by the solid). */
export interface HurtSource {
  kind: EnemyKind | 'wall';
  attack: 'bite' | 'charge' | 'lunge' | 'shot' | 'volley' | SolidName;
}

export interface SpellRecap {
  casts: number;
  /** Damage actually dealt (overkill on the final hit isn't counted). */
  damage: number;
  kills: number;
}

/** Everything that can damage a foe: the five spells, and Constrict. */
export type DamageSource = SpellId | 'constrict';

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
  /** Deepest depth reached (1 before the first boss falls). */
  depth: number;
}

export function emptyRecap(): RunRecap {
  const spell = (): SpellRecap => ({ casts: 0, damage: 0, kills: 0 });
  return {
    spells: { bolt: spell(), lightning: spell(), nova: spell(), ward: spell(), frost: spell(), constrict: spell() },
    casts: { perfect: 0, clean: 0, rough: 0 },
    taken: {},
    killedBy: null,
    blocked: 0,
    elitesSlain: 0,
    depth: 1,
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
