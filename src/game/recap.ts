import type { EnemyKind, SpellId } from './config';

/** What hurt the player: an enemy's attack, or the arena wall. */
export interface HurtSource {
  kind: EnemyKind | 'wall';
  attack: 'bite' | 'charge' | 'lunge' | 'shot' | 'volley' | 'wall';
}

export interface SpellRecap {
  casts: number;
  /** Damage actually dealt (overkill on the final hit isn't counted). */
  damage: number;
  kills: number;
}

/** Per-run statistics shown on the game-over screen. */
export interface RunRecap {
  spells: Record<SpellId, SpellRecap>;
  /** Damage taken, keyed by hurtKey(). */
  taken: Record<string, number>;
  /** The hurtKey() of the blow that ended the run, or null if it was ended from the menu. */
  killedBy: string | null;
}

export function emptyRecap(): RunRecap {
  const spell = (): SpellRecap => ({ casts: 0, damage: 0, kills: 0 });
  return { spells: { bolt: spell(), lightning: spell(), nova: spell() }, taken: {}, killedBy: null };
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
