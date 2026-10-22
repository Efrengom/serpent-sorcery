import { DUO_IDS, DUOS, HEAT, type DuoId } from './config';
import { MAP_ORDER, MAPS } from './maps';
import type { MapId } from './maps/types';
import { KNOWN_DUOS } from './progression';
import { KNOWN_RELICS, RELIC_IDS, RELICS, type RelicId } from './relics';
import type { RunSetup } from './world';

/**
 * The Grimoire (M1): one-time unlocks bought with Arcane Shards, beside the four stat lines. They
 * add options to runs rather than raw power: relics and duos to find, more rerolls and banishes,
 * a fourth card, waystones to start deeper, and an ultimate that starts charged.
 */

export type UnlockId =
  | `relic:${RelicId}`
  | `duo:${DuoId}`
  | 'reroll1'
  | 'reroll2'
  | 'banish1'
  | 'banish2'
  | 'fourthCard'
  | `way:${MapId}`
  | 'ultReady';

export type UnlockKind = 'relic' | 'duo' | 'tool' | 'waystone' | 'ultimate';

export interface UnlockDef {
  id: UnlockId;
  kind: UnlockKind;
  name: string;
  description: string;
  cost: number;
  /** Another unlock that must come first. */
  after?: UnlockId;
  /** A waystone needs its map reached at least once. */
  map?: MapId;
}

const TOOLS: UnlockDef[] = [
  { id: 'reroll1', kind: 'tool', name: 'Second Thoughts', description: 'One more reroll every run.', cost: 120 },
  { id: 'reroll2', kind: 'tool', name: 'Third Thoughts', description: 'Another reroll every run.', cost: 300, after: 'reroll1' },
  { id: 'banish1', kind: 'tool', name: 'Rite of Exile', description: 'One more banish every run.', cost: 180 },
  { id: 'banish2', kind: 'tool', name: 'Greater Exile', description: 'Another banish every run.', cost: 400, after: 'banish1' },
  { id: 'fourthCard', kind: 'tool', name: 'Fourth Rune', description: 'Every level-up offers four cards instead of three.', cost: 900 },
];

const WAYSTONE_COST: Partial<Record<MapId, number>> = { hollows: 250, catacombs: 450, ember: 650 };

/** Every unlock, in the order the Grimoire shows them. */
export const UNLOCKS: UnlockDef[] = [
  ...RELIC_IDS.filter((id) => !RELICS[id].known).map(
    (id): UnlockDef => ({ id: `relic:${id}`, kind: 'relic', name: RELICS[id].name, description: RELICS[id].description, cost: RELICS[id].cost }),
  ),
  ...DUO_IDS.filter((id) => !DUOS[id].known).map(
    (id): UnlockDef => ({ id: `duo:${id}`, kind: 'duo', name: DUOS[id].name, description: DUOS[id].description, cost: 250 }),
  ),
  ...TOOLS,
  ...MAP_ORDER.filter((id) => WAYSTONE_COST[id]).map(
    (id): UnlockDef => ({
      id: `way:${id}`,
      kind: 'waystone',
      name: `Waystone: ${MAPS[id].name}`,
      description: `Start a run in the ${MAPS[id].name}, with a relic and twelve level-ups for each map skipped.`,
      cost: WAYSTONE_COST[id]!,
      map: id,
    }),
  ),
  { id: 'ultReady', kind: 'ultimate', name: 'Primed Ultimate', description: 'Your ultimate is ready the moment a run begins.', cost: 350 },
];

export const UNLOCK_IDS = UNLOCKS.map((u) => u.id);

export function unlockDef(id: UnlockId): UnlockDef {
  return UNLOCKS.find((u) => u.id === id)!;
}

/** Why an unlock can't be bought yet (null when it can, given the shards). */
export function unlockBlocker(id: UnlockId, owned: readonly string[], mapsReached: readonly MapId[]): string | null {
  const def = unlockDef(id);
  if (owned.includes(id)) return 'Learned';
  if (def.after && !owned.includes(def.after)) return `Learn ${unlockDef(def.after).name} first`;
  if (def.map && !mapsReached.includes(def.map)) return `Reach the ${MAPS[def.map].name} first`;
  return null;
}

/** What a save's unlocks add to a run. */
export function grimoireSetup(owned: readonly string[]): NonNullable<RunSetup['grimoire']> {
  const has = (id: UnlockId) => owned.includes(id);
  return {
    rerolls: (has('reroll1') ? 1 : 0) + (has('reroll2') ? 1 : 0),
    banishes: (has('banish1') ? 1 : 0) + (has('banish2') ? 1 : 0),
    fourthCard: has('fourthCard'),
    duos: [...KNOWN_DUOS, ...DUO_IDS.filter((id) => has(`duo:${id}`))],
    relics: [...KNOWN_RELICS, ...RELIC_IDS.filter((id) => has(`relic:${id}`))],
    ultReady: has('ultReady'),
  };
}

/** The maps a run may start on: the first, and any whose waystone is learned. */
export function startMaps(owned: readonly string[]): MapId[] {
  return MAP_ORDER.filter((id) => id === MAP_ORDER[0] || owned.includes(`way:${id}`));
}

/** The heat a run may be played at: what the save has unlocked, at most. */
export function playableHeat(chosen: number, unlocked: number): number {
  return Math.max(0, Math.min(chosen, unlocked, HEAT.max));
}
