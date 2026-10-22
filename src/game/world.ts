import { placeBreakables } from './breakables';
import { createCamera, clampCamera, type Camera } from './camera';
import type { CastTier } from './cast';
import type { BossId, BossMove, EnemyKind, SpellId } from './config';
import { DIRECTOR, SPELL_IDS } from './config';
import { curseEffects, type CurseEffects, type CurseId } from './curses';
import type { Pt, SigilKind } from './gesture';
import { buildLayout, mapArea, mapForIndex, mapSeed, type MapLayout } from './maps';
import { placeVents } from './hazards';
import type { BreakableLook, MapId } from './maps/types';
import { mulberry32, type Vec } from './math';
import { createFlowField, refreshFlowField, type FlowField } from './nav';
import {
  computeStats,
  emptyUpgradeLevels,
  NO_MODS,
  type MetaLevels,
  type PlayerStats,
  type RunMods,
  type UpgradeLevels,
} from './progression';
import { emptyRecap, type HurtSource, type RunRecap } from './recap';
import { PathTrail, Snake } from './snake';
import { WIZARDS, type WizardId } from './wizards';

export type SfxName =
  | 'bolt'
  | 'lightning'
  | 'nova'
  | 'hit'
  | 'kill'
  | 'pickup'
  | 'levelup'
  | 'hurt'
  | 'wall'
  | 'unclear'
  | 'cooldown'
  | 'enemyShot'
  | 'telegraph'
  | 'charge'
  | 'portal'
  | 'bossWarn'
  | 'bossDie'
  | 'death'
  | 'select'
  | 'ward'
  | 'wardHit'
  | 'frost'
  | 'lance'
  | 'evolve'
  | 'shieldHit'
  | 'split'
  | 'descend'
  | 'perfect'
  | 'constrict'
  | 'smash'
  | 'smashBig'
  | 'bump'
  | 'heal'
  | 'buff'
  | 'buffEnd'
  | 'erupt'
  | 'flame'
  | 'spores'
  | 'icicle'
  | 'burrow'
  | 'slam'
  | 'rattle';

/** Buffs from breakables. The first four are timed; Lodestone and Shard Cache act at once. */
export type BuffId = 'quickening' | 'empower' | 'swiftscale' | 'stoneskin' | 'lodestone' | 'shardCache';
export type TimedBuff = 'quickening' | 'empower' | 'swiftscale' | 'stoneskin';

/** A container standing in one of the map's breakable slots. */
export interface Breakable {
  id: number;
  slot: number;
  size: 'small' | 'large';
  look: BreakableLook;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  flash: number;
  /** The last Nova that hit it (each ring hits once). */
  lastNovaId: number;
  /** Seeded variety in how it's drawn. */
  variant: number;
}

export type PickupKind = 'heal' | 'bigHeal' | BuffId;

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  magnet: boolean;
}

export type EnemyState = 'move' | 'windup' | 'attack' | 'recover';
export type { BossMove } from './config';
/** Elite modifiers: a damage-soaking shield, faster everything, or splitting in two on death. */
export type EliteKind = 'shielded' | 'swift' | 'splitting';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** Knockback velocity, decays quickly. */
  kx: number;
  ky: number;
  heading: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  contact: number;
  damageMult: number;
  xp: number;
  state: EnemyState;
  stateTime: number;
  attackTimer: number;
  /** Locked attack direction during telegraphs. */
  aim: number;
  flash: number;
  wobble: number;
  dead: boolean;
  lastNovaId: number;
  // Snake-shaped enemies (rival + boss)
  trail: PathTrail | null;
  segments: Vec[];
  segRadius: number;
  segSpacing: number;
  bossMove: BossMove;
  /** Which boss this is (for the boss kind). */
  bossId: BossId;
  /** Seconds to the next burn tick while standing in lava or fire it isn't at home in. */
  burn: number;
  /** Distance travelled since it last dropped part of a trail (Magma Brute, Thornback, Pyrecoil). */
  trailAcc: number;
  /** Underground (a burrowing foe): it can't be hit and doesn't bite; only its mound shows. */
  hidden: boolean;
  /** Seconds before a collapsed Bone Rattler rises again (0 while it's up). */
  pile: number;
  /** Where a burrowing foe will come up. */
  goal: Vec | null;
  moveIndex: number;
  enraged: boolean;
  elite: EliteKind | null;
  /** Shielded elites: damage goes to the shield first. */
  shield: number;
  shieldMax: number;
  /** A fragment of a splitting elite (never splits again). */
  fragment: boolean;
  /** 1 while standing in a Frost Field (drives the frosty tint). */
  chill: number;
  /** Seconds left frozen solid (Glacier), and the field that froze it. */
  frozen: number;
  frozenBy: number;
  /** Seconds left held still after being constricted. */
  stunned: number;
  nav: EnemyNav;
}

/** How a foe finds its way to the serpent, refreshed a few times a second (see enemies.ts). */
export interface EnemyNav {
  /** World time of the next line-of-sight check. */
  next: number;
  /** Nothing solid between this foe's body and the head: it can go straight there. */
  direct: boolean;
  /** A thin shot from here would reach the head: shooters may fire. */
  sight: boolean;
  /** Which way to walk along the flow field when the way isn't direct. */
  angle: number;
  /** Seconds spent far from the serpent, and stuck in one place; where it was at the last check. */
  far: number;
  stuck: number;
  lastX: number;
  lastY: number;
}

export interface Portal {
  x: number;
  y: number;
  kind: EnemyKind;
  t: number;
  duration: number;
}

export interface Bolt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  pierce: number;
  life: number;
  hit: number[];
}

export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  life: number;
  spin: number;
  /** Who fired it, for the death recap. */
  source: HurtSource;
  /** How it's drawn: an orb of hostile magic, a drifting spore or an icicle. */
  look: 'orb' | 'spore' | 'icicle';
}

export interface Crystal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  magnet: boolean;
  t: number;
}

export interface Nova {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  damage: number;
  t: number;
  duration: number;
  /** Enemies this Nova has hit so far. */
  hits: number;
  /** Supernova: health restored per enemy hit, up to a cap per ring. */
  heal: number;
}

export interface FrostField {
  id: number;
  x: number;
  y: number;
  radius: number;
  t: number;
  duration: number;
  /** Seconds until the next damage tick. */
  tick: number;
  damage: number;
}

/** Arcane Lance beam, drawn briefly after it hits. */
export interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  life: number;
  maxLife: number;
}

export interface Ward {
  charges: number;
  t: number;
  duration: number;
  /** Absorbed hits waiting to release their pulse (handled on the next step). */
  pulses: number;
  /** 1 when a hit was just absorbed, fading to 0. */
  flash: number;
  /** Clean-cast power: scales the pulse damage. */
  power: number;
}

/** A delayed second strike from an evolved spell. */
export interface Echo {
  at: number;
  spell: 'lightning' | 'nova';
  aim: number;
  target: Vec | null;
  /** Clean-cast power carried over from the original cast. */
  power: number;
}

/** The loop the serpent's body is forming (or has just closed) for Constrict. */
export interface Coil {
  /** Index of the body segment the head meets (or is closest to). */
  index: number;
  closed: boolean;
  /** Foes inside the loop. */
  enclosed: number;
}

/** Brief flash of a loop that just crushed foes. */
export interface ConstrictFlash {
  points: Vec[];
  life: number;
  maxLife: number;
}

/** Choices made before a run. */
export interface RunSetup {
  wizard: WizardId;
  curses: CurseId[];
  /** Development only: start at this depth (and its map). */
  startDepth?: number;
}

/** Burning ground, or a trail of lava or brambles, or a patch of ice: a short-lived hazard circle. */
export interface GroundFx {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  kind: GroundKind;
}
export type GroundKind = 'fire' | 'lava' | 'bramble' | 'ice';

/** A telegraphed blast: a circle marked on the ground that goes off after `delay` seconds. */
export interface Blast {
  x: number;
  y: number;
  r: number;
  t: number;
  delay: number;
  damage: number;
  /** Terrain bursts (vents) hurt foes too; attacks only hurt the serpent. */
  hitsFoes: boolean;
  source: HurtSource;
  /** Ground left where it lands: burning ground unless it says otherwise. */
  after: { r: number; life: number; kind?: GroundKind } | null;
  look: BlastLook;
  /** Where a lobbed fireball was thrown from, for drawing its arc. */
  from: Vec | null;
}

/**
 * How a marked blast looks: a meteor or fireball falling into it, a vent's eruption, spores or
 * icicles from above, a Crypt Golem's slam (a ring round it), or something erupting from below.
 */
export type BlastLook = 'meteor' | 'fireball' | 'vent' | 'spores' | 'icicle' | 'slam' | 'burrow';

/** The way down, open where the boss fell. */
export interface Descent {
  x: number;
  y: number;
  t: number;
}

export interface Arc {
  points: Vec[];
  life: number;
  maxLife: number;
  seed: number;
  fizzle: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  kind: 'spark' | 'glow' | 'shard';
}

export interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  max: number;
  size: number;
  vy: number;
  /** Screen-space floaters (CSS px) are used for sigil feedback near the drawing. */
  screen: boolean;
}

export interface Banner {
  text: string;
  sub: string;
  t: number;
  max: number;
  color: string;
}

/** What the stroke being drawn currently reads as. */
export interface SigilReading {
  kind: SigilKind;
  spell: SpellId;
  known: boolean;
  tier: CastTier;
}

/** A gesture the player is currently drawing, plus the recorded aim target. */
export interface GestureView {
  active: boolean;
  points: Pt[];
  target: Vec | null;
  /** Live reading of the stroke so far, or null if it isn't a sigil (yet). */
  reading: SigilReading | null;
  /** Fading trail of the last finished gesture. */
  fade: { points: Pt[]; color: string; t: number } | null;
}

export interface World {
  time: number;
  rng: () => number;
  seed: number;
  /** Which map of the sequence the serpent is on (0 = the first; it keeps counting as maps repeat), and when it arrived. */
  mapIndex: number;
  /** Every map this run has been on, for the atlas. */
  visited: MapId[];
  mapStart: number;
  /** The way down once the boss has fallen, and the fade from black after descending. */
  descent: Descent | null;
  fade: number;
  groundFx: GroundFx[];
  blasts: Blast[];
  /** Eruption vents and the world time each next goes off. */
  vents: { x: number; y: number; next: number }[];
  /** The map this run is played on, the view following the serpent around it, and paths to the serpent for foes. */
  map: MapLayout;
  camera: Camera;
  flow: FlowField;
  /** The clearing the next boss will arrive in, marked shortly before it does (-1 when none is). */
  bossClearing: number;
  snake: Snake;
  meta: MetaLevels;
  wizard: WizardId;
  curses: CurseId[];
  effects: CurseEffects;
  mods: RunMods;
  /** Spells the serpent can cast this run, in HUD order. */
  known: SpellId[];
  evolved: Record<SpellId, boolean>;
  upgrades: UpgradeLevels;
  stats: PlayerStats;
  hp: number;
  invuln: number;
  hurtFlash: number;
  xp: number;
  level: number;
  kills: number;
  bossKills: number;
  enemies: Enemy[];
  portals: Portal[];
  bolts: Bolt[];
  shots: EnemyShot[];
  crystals: Crystal[];
  breakables: Breakable[];
  /** Broken slots and when each may refill (game time). */
  refills: { slot: number; at: number }[];
  pickups: Pickup[];
  /** Seconds left on each timed buff (0 = off). */
  buffs: Record<TimedBuff, number>;
  /** Arcane Shards from Shard Caches, banked with the run (before the curse multiplier). */
  bonusShards: number;
  novas: Nova[];
  arcs: Arc[];
  frostFields: FrostField[];
  beams: Beam[];
  echoes: Echo[];
  ward: Ward | null;
  coil: Coil | null;
  constricts: ConstrictFlash[];
  constrictCooldown: number;
  /** Set once the body is long enough to loop (announced once per run). */
  constrictReady: boolean;
  /** 1 + bosses defeated; each depth is harder and elites grow more common. */
  depth: number;
  /** The current map's look (see mapArea): 0 the ruins, 1 the Ember Depths. */
  area: number;
  particles: Particle[];
  floaters: Floater[];
  cooldowns: Record<SpellId, number>;
  cooldownTotals: Record<SpellId, number>;
  castFlash: Record<SpellId, number>;
  denyFlash: Record<SpellId, number>;
  shake: number;
  /** Real seconds left of a hit-stop freeze, the gap before the next small one, and slow motion. */
  hitStop: number;
  hitStopGap: number;
  slowMo: number;
  recap: RunRecap;
  spawnAcc: number;
  nextBossTime: number;
  bossIndex: number;
  bossWarned: boolean;
  boss: Enemy | null;
  banner: Banner | null;
  nextId: number;
  novaCounter: number;
  frostCounter: number;
  pickupPitch: number;
  pickupPitchTimer: number;
  regenAcc: number;
  sfx: (name: SfxName) => void;
}

export const DEFAULT_SETUP: RunSetup = { wizard: 'arcanist', curses: [] };

/** The wizard's perks combined with what the curses do to the player. */
export function runMods(setup: RunSetup): RunMods {
  const wiz = WIZARDS[setup.wizard].mods;
  const fx = curseEffects(setup.curses);
  return {
    ...NO_MODS,
    ...wiz,
    maxHpMult: (wiz.maxHpMult ?? 1) * fx.maxHpMult,
    cooldownMult: (wiz.cooldownMult ?? 1) * fx.cooldownMult,
  };
}

const perSpell = <T>(v: () => T) => Object.fromEntries(SPELL_IDS.map((id) => [id, v()])) as Record<SpellId, T>;

export function createWorld(
  meta: MetaLevels,
  sfx: (name: SfxName) => void,
  seed = Date.now(),
  setup: RunSetup = DEFAULT_SETUP,
): World {
  const upgrades = emptyUpgradeLevels();
  const mods = runMods(setup);
  const stats = computeStats(upgrades, meta, mods);
  const effects = curseEffects(setup.curses);
  const depth = Math.max(1, Math.floor(setup.startDepth ?? 1));
  const map = buildLayout(mapForIndex(depth - 1), mapSeed(seed, depth - 1));
  const snake = new Snake(map.start.x, map.start.y, map.startHeading);
  const camera = createCamera(snake.x, snake.y);
  clampCamera(camera, map.width, map.height);
  const flow = createFlowField(map);
  refreshFlowField(flow, snake.x, snake.y);
  const world: World = {
    time: 0,
    rng: mulberry32(seed),
    seed,
    mapIndex: depth - 1,
    visited: [map.def.id],
    mapStart: 0,
    descent: null,
    fade: 0,
    groundFx: [],
    blasts: [],
    vents: [],
    map,
    camera,
    flow,
    bossClearing: -1,
    snake,
    meta,
    wizard: setup.wizard,
    curses: [...setup.curses],
    effects,
    mods,
    known: [...WIZARDS[setup.wizard].spells],
    evolved: perSpell(() => false),
    upgrades,
    stats,
    hp: stats.maxHp,
    invuln: 1.5,
    hurtFlash: 0,
    xp: 0,
    level: 1,
    kills: 0,
    bossKills: 0,
    enemies: [],
    portals: [],
    bolts: [],
    shots: [],
    crystals: [],
    breakables: [],
    refills: [],
    pickups: [],
    buffs: { quickening: 0, empower: 0, swiftscale: 0, stoneskin: 0 },
    bonusShards: 0,
    novas: [],
    arcs: [],
    frostFields: [],
    beams: [],
    echoes: [],
    ward: null,
    coil: null,
    constricts: [],
    constrictCooldown: 0,
    constrictReady: false,
    depth,
    area: mapArea(map.def.id),
    particles: [],
    floaters: [],
    cooldowns: perSpell(() => 0),
    cooldownTotals: perSpell(() => 1),
    castFlash: perSpell(() => 0),
    denyFlash: perSpell(() => 0),
    shake: 0,
    hitStop: 0,
    hitStopGap: 0,
    slowMo: 0,
    recap: { ...emptyRecap(), depth, map: map.def.name },
    spawnAcc: 0,
    nextBossTime: effects.bossInterval ?? DIRECTOR.bossTime,
    bossIndex: 0,
    bossWarned: false,
    boss: null,
    banner: null,
    nextId: 1,
    novaCounter: 0,
    frostCounter: 0,
    pickupPitch: 0,
    pickupPitchTimer: 0,
    regenAcc: 0,
    sfx,
  };
  placeBreakables(world);
  placeVents(world);
  return world;
}
