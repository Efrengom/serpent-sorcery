import { createCamera, clampCamera, type Camera } from './camera';
import type { CastTier } from './cast';
import type { EnemyKind, SpellId } from './config';
import { DIRECTOR, SPELL_IDS } from './config';
import { curseEffects, type CurseEffects, type CurseId } from './curses';
import type { Pt, SigilKind } from './gesture';
import { buildLayout, mapForDepth, type MapLayout } from './maps';
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
import { emptyRecap, type RunRecap } from './recap';
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
  | 'constrict';

export type EnemyState = 'move' | 'windup' | 'attack' | 'recover';
export type BossMove = 'slither' | 'volley' | 'charge' | 'summon';
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
  source: EnemyKind;
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
  /** 0 = the ruins, 1 = the Ember Depths (after the first boss falls). */
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
  const map = buildLayout(mapForDepth(1), seed);
  const snake = new Snake(map.start.x, map.start.y, map.startHeading);
  const camera = createCamera(snake.x, snake.y);
  clampCamera(camera, map.width, map.height);
  const flow = createFlowField(map);
  refreshFlowField(flow, snake.x, snake.y);
  return {
    time: 0,
    rng: mulberry32(seed),
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
    depth: 1,
    area: 0,
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
    recap: emptyRecap(),
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
}
