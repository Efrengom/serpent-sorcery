import { RUINS } from './ruins';
import type { MapDef, MapId } from './types';

export const MAPS: Record<MapId, MapDef> = { ruins: RUINS };

/** The map each depth uses. Phase 1 has one layout; deeper depths reuse it with the Ember look. */
export function mapForDepth(_depth: number): MapDef {
  return RUINS;
}

export { buildLayout } from './layout';
export { validateLayout } from './validate';
export type { Landmark, MapDef, MapLayout, Rect, Solid, SolidName } from './types';
