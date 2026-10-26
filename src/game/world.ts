import { placeBreakables } from './breakables';
import { createCamera, clampCamera, type Camera } from './camera';
import type { CastTier } from './cast';
import type { AspectId, BossId, BossMove, DuoId, EnemyKind, SpellId } from './config';
import { DIRECTOR, LEVEL_TOOLS, SPELL_IDS, ULTIMATE } from './config';
import { curseEffects, type CurseEffects, type CurseId } from './curses';
import type { Pt, SigilKind } from './gesture';
import { buildLayout, mapArea, mapForIndex, mapSeed, type MapLayout } from './maps';
import { placeVents } from './hazards';
import type { BreakableLook, MapId } from './maps/types';
import { mulberry32, type Vec } from './math';
import { createFlowField, refreshFlowField, type FlowField } from './nav';
import {
  combineMods,
  computeStats,
  emptyOvercharge,
  emptyUpgradeLevels,
  KNOWN_DUOS,
  NO_MODS,
  overchargeMods,
  type MetaLevels,
  type OverchargeLevels,
  type PlayerStats,
  type RunMods,
  type UpgradeLevels,
} from './progression';
import { emptyRecap, type HurtSource, type RunRecap } from './recap';
import { KNOWN_RELICS, relicMods, type RelicId } from './relics';
import { placeSites, siteMods, type PactId, type RiftState, type Site } from './sites';
import type { UltimateId } from './ultimates';
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
  | 'rattle'
  | 'ultimate'
  | 'ultReady'
  | 'starfall';

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
  /** Which of a phased boss's phases it has reached (the Ascendant has three). */
  phase: number;
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
  /** Shocked by Overload, or chilled by Rimeshot, until this game time. */
  shockUntil: number;
  chillUntil: number;
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
  /** Seeker bolts steer toward foes ahead; Ricochet bolts bounce this many more times. */
  seek: boolean;
  bounces: number;
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
  /** Knockback scale (negative pulls in, for Implosion), stun on hit (Shockwave), and lightning strikes left (Thunderclap). */
  knock: number;
  stun: number;
  strikes: number;
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
  /** What the save's Grimoire adds: extra rerolls and banishes, a fourth card, the duos and relics unlocked, a primed ultimate. */
  grimoire?: { rerolls: number; banishes: number; fourthCard: boolean; duos: DuoId[]; relics: RelicId[]; ultReady: boolean };
  /** Heat (M3), and whether `startDepth` comes from a waystone (M2: the run catches up with a draft). */
  heat?: number;
  waystone?: boolean;
  /** Development only: start at this depth (and its map). */
  startDepth?: number;
  /** A fixed seed for the maps, foes and offers, and the date when it is that day's daily run (D1). */
  seed?: number;
  daily?: string;
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

/** The wizard's ultimate (U1-U2): its cooldown, and the effect running now. */
export interface UltimateState {
  id: UltimateId;
  /** Seconds left to recharge, out of `total`; `ready` once announced. */
  cooldown: number;
  total: number;
  ready: boolean;
  /** Seconds left of the effect running now (Starfall, Bastion, Maelstrom), and the time since it began. */
  active: number;
  t: number;
  /** Clock to the next star, burn or strike, and Starfall's stars still to fall. */
  next: number;
  left: number;
  /** The cast's flash, fading. */
  flash: number;
}

/** A Starfall star on its way down to (x, y). */
export interface Star {
  x: number;
  y: number;
  t: number;
  fall: number;
  r: number;
}

/** A wave of colour rolling out from where an ultimate was cast. */
export interface UltRing {
  x: number;
  y: number;
  t: number;
  life: number;
  r: number;
  color: string;
}

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

/** The run's ending (V1): the Ascendant rising where the last Archmage fell, the fight, then the win. */
export interface Finale {
  x: number;
  y: number;
  /** Seconds in this stage. */
  t: number;
  stage: 'rising' | 'fight' | 'won';
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
  /** The foe auto-aim has locked onto (where it is, and how big), shown with brackets round it. */
  lock: { x: number; y: number; r: number } | null;
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
  /** This map's shrines, rifts, chests and merchants (E1); a rift being fought, and a won rift's relic still to offer. */
  sites: Site[];
  rift: RiftState | null;
  riftReward: boolean;
  /** Shrine pacts taken, seconds left of a cursed chest's curse, and shards spent at merchants. */
  pacts: PactId[];
  chestCurse: number;
  spentShards: number;
  /** The Ascendant's rising and fight at the end of the first pass, and whether (and when) the run was won. */
  finale: Finale | null;
  won: boolean;
  wonAt: number;
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
  /** Aspects (one per spell at most), duo evolutions and overcharge ranks taken this run. */
  aspects: Partial<Record<SpellId, AspectId>>;
  duos: DuoId[];
  overcharge: OverchargeLevels;
  /** Duos the save has unlocked, cards per level-up offer, rerolls and banishes left, and cards banished. */
  duoPool: DuoId[];
  cardCount: number;
  rerolls: number;
  banishes: number;
  banished: string[];
  /** The wizard's and curses' modifiers; overcharge and relics stack on these into `mods`. */
  baseMods: RunMods;
  /** Heat this run is played at (M3). */
  heat: number;
  /** The ultimate, Starfall's stars in flight, cast waves, and when Absolute Zero ends. */
  ult: UltimateState;
  stars: Star[];
  ultRings: UltRing[];
  zeroUntil: number;
  /** A waystone start's catch-up still to come: relic choices, then level-ups (M2). */
  draft: { relics: number; levels: number } | null;
  /** Relics carried (R4), the ones the save knows, and the three on offer at the way down until one is chosen. */
  relics: RelicId[];
  relicPool: RelicId[];
  relicOffer: RelicId[] | null;
  /** Relic clocks and counters: the Tail Sigil's next shot, when the Bell can ring again, Scales shed on this map, kills and casts. */
  relicState: { tail: number; bellReady: number; sacrificed: boolean; kills: number; casts: number };
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
  /** Foes that died in a Frost Field with Shatter, bursting next step. */
  shatters: { x: number; y: number; damage: number }[];
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

/** Level-ups a waystone start drafts for each map it skips. */
export const WAYSTONE_LEVELS = 12;

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

/**
 * Recomputes the run's modifiers and stats after anything that changes them: an upgrade,
 * overcharge or a relic. Health never rises here (callers heal on purpose), only drops to a lower max.
 */
export function refreshStats(world: World): void {
  world.mods = combineMods(world.baseMods, overchargeMods(world.overcharge), ...relicMods(world), ...siteMods(world));
  world.stats = computeStats(world.upgrades, world.meta, world.mods);
  world.hp = Math.min(world.stats.maxHp, world.hp);
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
  const grimoire = setup.grimoire;
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
    finale: null,
    won: false,
    wonAt: 0,
    sites: [],
    rift: null,
    riftReward: false,
    pacts: [],
    chestCurse: 0,
    spentShards: 0,
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
    aspects: {},
    duos: [],
    overcharge: emptyOvercharge(),
    duoPool: grimoire ? [...grimoire.duos] : [...KNOWN_DUOS],
    cardCount: grimoire?.fourthCard ? 4 : 3,
    rerolls: LEVEL_TOOLS.rerolls + (grimoire?.rerolls ?? 0),
    banishes: LEVEL_TOOLS.banishes + (grimoire?.banishes ?? 0),
    banished: [],
    baseMods: mods,
    heat: Math.max(0, Math.floor(setup.heat ?? 0)),
    ult: {
      id: WIZARDS[setup.wizard].ultimate,
      cooldown: grimoire?.ultReady ? 0 : ULTIMATE.start,
      total: grimoire?.ultReady ? 1 : ULTIMATE.start,
      ready: !!grimoire?.ultReady,
      active: 0,
      t: 0,
      next: 0,
      left: 0,
      flash: 0,
    },
    stars: [],
    ultRings: [],
    zeroUntil: 0,
    draft: setup.waystone && depth > 1 ? { relics: depth - 1, levels: WAYSTONE_LEVELS * (depth - 1) } : null,
    relics: [],
    relicPool: grimoire ? [...grimoire.relics] : [...KNOWN_RELICS],
    relicOffer: null,
    relicState: { tail: 0, bellReady: 0, sacrificed: false, kills: 0, casts: 0 },
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
    shatters: [],
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
  placeSites(world);
  return world;
}
