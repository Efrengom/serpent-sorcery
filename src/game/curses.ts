import { MAX_SHARD_MULT } from './progression';

/** Optional handicaps chosen before a run, each raising the shards the run pays out. */
export type CurseId = 'frenzy' | 'glass' | 'swarm' | 'drain' | 'champions' | 'impatient';
export const CURSE_IDS: CurseId[] = ['frenzy', 'glass', 'swarm', 'drain', 'champions', 'impatient'];

export interface CurseDef {
  id: CurseId;
  name: string;
  description: string;
  /** Added to the shard multiplier. */
  bonus: number;
}

export const CURSES: Record<CurseId, CurseDef> = {
  frenzy: { id: 'frenzy', name: 'Frenzied Foes', description: 'Enemies move and attack 25% faster.', bonus: 0.25 },
  glass: { id: 'glass', name: 'Glass Scales', description: 'Your serpent has 40% less max health.', bonus: 0.3 },
  swarm: { id: 'swarm', name: 'Swarming Ruins', description: 'Enemies spawn 40% faster and more crowd in.', bonus: 0.3 },
  drain: { id: 'drain', name: 'Sluggish Sigils', description: 'Every spell cooldown is 30% longer.', bonus: 0.25 },
  champions: {
    id: 'champions',
    name: "Champions' Hunt",
    description: 'Elite enemies appear from the very start, and more often.',
    bonus: 0.2,
  },
  impatient: {
    id: 'impatient',
    name: 'Impatient Archmage',
    description: 'Ouroboros arrives at 3:30, and every 3:30 after.',
    bonus: 0.2,
  },
};

/** What the active curses change in a run. */
export interface CurseEffects {
  enemyTimeScale: number;
  maxHpMult: number;
  spawnRateMult: number;
  capMult: number;
  cooldownMult: number;
  elitesFromStart: boolean;
  bossInterval: number | null;
}

export function curseEffects(ids: readonly CurseId[]): CurseEffects {
  const on = (id: CurseId) => ids.includes(id);
  return {
    enemyTimeScale: on('frenzy') ? 1.25 : 1,
    maxHpMult: on('glass') ? 0.6 : 1,
    spawnRateMult: on('swarm') ? 1.4 : 1,
    capMult: on('swarm') ? 1.25 : 1,
    cooldownMult: on('drain') ? 1.3 : 1,
    elitesFromStart: on('champions'),
    bossInterval: on('impatient') ? 210 : null,
  };
}

export function shardMultiplier(ids: readonly CurseId[]): number {
  const sum = ids.reduce((s, id) => s + (CURSES[id]?.bonus ?? 0), 0);
  return Math.min(MAX_SHARD_MULT, Math.round((1 + sum) * 100) / 100);
}
