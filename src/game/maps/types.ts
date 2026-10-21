import type { Vec } from '../math';
import type { PlayArea } from '../snake';

/** What a solid is: it picks the solid's look and names it in the death recap ("a broken pillar"). */
export type SolidName = 'wall' | 'pillar' | 'column' | 'statue' | 'colossus';

/**
 * Something the serpent bounces off (and is hurt by). Three shapes cover pillars, walls and
 * toppled columns while keeping collision cheap: every one has an exact distance function.
 */
export type Solid =
  | { shape: 'circle'; name: SolidName; x: number; y: number; r: number }
  | { shape: 'rect'; name: SolidName; x0: number; y0: number; x1: number; y1: number }
  | { shape: 'capsule'; name: SolidName; ax: number; ay: number; bx: number; by: number; r: number };

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LandmarkKind = 'plaza' | 'colonnade' | 'hall' | 'colossus' | 'gate';

export interface Landmark {
  name: string;
  kind: LandmarkKind;
  x: number;
  y: number;
}

/** A solid placed freely on top of the grid. */
export interface Piece {
  solid: Solid;
  /** Pieces in an optional group are kept or left out together, per run. */
  group?: string;
}

export type MapId = 'ruins';

export interface MapDef {
  id: MapId;
  name: string;
  /** Size of one grid character, in world units. */
  cell: number;
  /**
   * The structure, one character per cell:
   * - `#` wall
   * - `.` floor
   * - `b` boss clearing floor (each connected patch becomes one clearing)
   * - `S` the start (the serpent starts at the middle of the S cells)
   * - `1`-`9` landmark anchors (a landmark sits at the middle of its cells)
   * S and digit cells inside a patch of `b` belong to that clearing.
   */
  grid: string[];
  landmarks: Record<string, { name: string; kind: LandmarkKind }>;
  pieces: Piece[];
  /** Chance that each optional group appears in a run. */
  optional: Record<string, number>;
  startHeading: number;
  /** Small random offset (world units) given to every circle piece per run. */
  jitter: number;
}

/** A map built for one run: the definition plus everything the game looks up at play time. */
export interface MapLayout {
  def: MapDef;
  width: number;
  height: number;
  /** Inner faces of the boundary wall: nothing in the map leaves this box. */
  bounds: PlayArea;
  solids: Solid[];
  index: SolidIndex;
  start: Vec;
  startHeading: number;
  clearings: Rect[];
  landmarks: Landmark[];
  /** Wall torches in world units (their flames are animated per frame). */
  torches: Vec[];
  /** Distance to the nearest solid, sampled at the middle of every navigation cell. */
  clearance: ClearanceGrid;
}

export interface SolidIndex {
  cell: number;
  cols: number;
  rows: number;
  /** Indices into `solids` of every solid within `margin` of each cell. */
  cells: number[][];
  margin: number;
  solids: Solid[];
}

export interface ClearanceGrid {
  cell: number;
  cols: number;
  rows: number;
  values: Float32Array;
}
