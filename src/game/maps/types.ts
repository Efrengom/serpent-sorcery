import type { BossId, EnemyKind } from '../config';
import type { Vec } from '../math';
import type { PlayArea } from '../snake';

/** What a solid is: it picks the solid's look and names it in the death recap ("a broken pillar"). */
export type SolidName =
  | 'wall'
  | 'pillar'
  | 'column'
  | 'statue'
  | 'colossus'
  | 'basalt'
  | 'spire'
  | 'ridge'
  | 'anvil'
  | 'stalk'
  | 'heartroot'
  | 'root'
  | 'cap'
  | 'icePillar'
  | 'sarcophagus';

/** What a map's walls are, for the death recap ("the catacomb walls"); they all look like the map's stonework. */
export type WallName = 'wall' | 'cliff' | 'roots' | 'crypt';

/** Ground you can pass through, at a cost: lava and brambles sting, ice widens your turns. */
export type HazardKind = 'lava' | 'bramble' | 'ice';

/** The burst each map's vents make: eruptions, spore puffs or falling icicles. */
export type VentLook = 'vent' | 'spores' | 'icicle';

/**
 * Something the serpent bounces off (and is hurt by). Three shapes cover pillars, walls and
 * toppled columns while keeping collision cheap: every one has an exact distance function.
 */
export type Shape<N extends string> =
  | { shape: 'circle'; name: N; x: number; y: number; r: number }
  | { shape: 'rect'; name: N; x0: number; y0: number; x1: number; y1: number }
  | { shape: 'capsule'; name: N; ax: number; ay: number; bx: number; by: number; r: number };
export type Solid = Shape<SolidName>;
/** A hazard zone on the floor, in the same three shapes. */
export type Hazard = Shape<HazardKind>;
export type AnyShape = Solid | Hazard;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LandmarkKind =
  | 'plaza'
  | 'colonnade'
  | 'hall'
  | 'colossus'
  | 'gate'
  | 'caldera'
  | 'falls'
  | 'forge'
  | 'spires'
  | 'glowring'
  | 'heartroot'
  | 'fallen'
  | 'thicket'
  | 'grotto'
  | 'bellcourt'
  | 'ossuary'
  | 'kings'
  | 'lake';

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

export type MapId = 'ruins' | 'hollows' | 'catacombs' | 'ember';

/** How a map's breakables look: the small ones, and the large ones. */
export type BreakableLook = 'urn' | 'reliquary' | 'geode' | 'brazier' | 'glowcap' | 'seedpod' | 'frostUrn' | 'coffin';

/** Where a breakable can stand. Which slots are filled varies per run. */
export interface BreakableSlot {
  x: number;
  y: number;
  size: 'small' | 'large';
}

export interface MapBreakables {
  small: BreakableLook;
  large: BreakableLook;
  /** Small slots are scattered on open floor by a fixed seed (the same every run), mostly along the stonework. */
  smallCount: number;
  smallSeed: number;
  /** Large slots are placed by hand: in side rooms, against walls and by landmarks. */
  largeSlots: [number, number][];
}

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
  breakables: MapBreakables;
  /** The swarmer, shooter, heavy and special this map sends, in that order, and its boss. */
  roster: [EnemyKind, EnemyKind, EnemyKind, EnemyKind];
  boss: BossId;
  /** A one-line tip for the banner on arrival. */
  tip: string;
  /** What its walls are called in the death recap. */
  wallName: WallName;
  /** Hazard zones placed on top of the grid's hazard cells ("~" lava, "%" brambles, "=" ice). */
  hazards: Hazard[];
  /** Vents, and the burst they make. */
  vents: [number, number][];
  vent: VentLook;
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
  /** Where breakables can stand. */
  slots: BreakableSlot[];
  /** Hazard zones (grid cells and placed ones) and their lookup, or null on a map without any. */
  hazards: Hazard[];
  hazardIndex: SolidIndex | null;
  /** The same, one lookup per kind (absent when the map has none), and just the ones that sting (lava and brambles). */
  zones: Partial<Record<HazardKind, SolidIndex>>;
  harmIndex: SolidIndex | null;
  vents: Vec[];
  /** Distance to the nearest solid, sampled at the middle of every navigation cell. */
  clearance: ClearanceGrid;
}

export interface SolidIndex {
  cell: number;
  cols: number;
  rows: number;
  /** Indices into `solids` of every shape within `margin` of each cell. */
  cells: number[][];
  margin: number;
  /** The shapes indexed: a map's solids, or its hazards. */
  solids: AnyShape[];
}

export interface ClearanceGrid {
  cell: number;
  cols: number;
  rows: number;
  values: Float32Array;
}
