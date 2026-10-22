import { CATACOMBS } from './catacombs';
import { EMBER } from './ember';
import { HOLLOWS } from './hollows';
import { RUINS } from './ruins';
import type { MapDef, MapId } from './types';

export const MAPS: Record<MapId, MapDef> = { ruins: RUINS, hollows: HOLLOWS, catacombs: CATACOMBS, ember: EMBER };

/**
 * The maps a run goes through, one per boss, rising in what they ask of you: stone only, then
 * stinging brambles and spores, then sliding ice, then lava and lobbed fire. After the last it
 * starts again, deeper (R1, R2).
 */
export const MAP_ORDER: MapId[] = ['ruins', 'hollows', 'catacombs', 'ember'];

/** The map at position `index` of a run (0 = the first), wrapping round the order. */
export function mapForIndex(index: number): MapDef {
  return MAPS[MAP_ORDER[((index % MAP_ORDER.length) + MAP_ORDER.length) % MAP_ORDER.length]];
}

/** Each map of a run gets its own seed from the run's, so a repeat visit is laid out afresh. */
export function mapSeed(runSeed: number, index: number): number {
  return (runSeed + Math.imul(index, 7919)) >>> 0;
}

/** Which look (floor palette and stonework colours) a map uses, as an index into the art's tables. */
export const MAP_AREAS: Record<MapId, number> = { ruins: 0, ember: 1, hollows: 2, catacombs: 3 };
export function mapArea(id: MapId): number {
  return MAP_AREAS[id];
}

export { buildLayout } from './layout';
export { validateLayout } from './validate';
export type { Hazard, HazardKind, Landmark, MapDef, MapLayout, Rect, Solid, SolidName } from './types';
