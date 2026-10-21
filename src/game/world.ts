import type { EnemyKind, SpellId } from './config';
import { ARENA, DIRECTOR } from './config';
import type { Pt } from './gesture';
import { mulberry32, type Vec } from './math';
import {
  computeStats,
  emptyUpgradeLevels,
  type MetaLevels,
  type PlayerStats,
  type UpgradeLevels,
} from './progression';
import { emptyRecap, type RunRecap } from './recap';
import { PathTrail, Snake } from './snake';

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
  | 'select';

export type EnemyState = 'move' | 'windup' | 'attack' | 'recover';
export type BossMove = 'slither' | 'volley' | 'charge' | 'summon';

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

/** A gesture the player is currently drawing, plus the recorded aim target. */
export interface GestureView {
  active: boolean;
  points: Pt[];
  target: Vec | null;
  /** Fading trail of the last finished gesture. */
  fade: { points: Pt[]; color: string; t: number } | null;
}

export interface World {
  time: number;
  rng: () => number;
  snake: Snake;
  meta: MetaLevels;
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
  pickupPitch: number;
  pickupPitchTimer: number;
  regenAcc: number;
  sfx: (name: SfxName) => void;
}

export function createWorld(meta: MetaLevels, sfx: (name: SfxName) => void, seed = Date.now()): World {
  const upgrades = emptyUpgradeLevels();
  const stats = computeStats(upgrades, meta);
  return {
    time: 0,
    rng: mulberry32(seed),
    snake: new Snake(),
    meta,
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
    particles: [],
    floaters: [],
    cooldowns: { bolt: 0, lightning: 0, nova: 0 },
    cooldownTotals: { bolt: 1, lightning: 1, nova: 1 },
    castFlash: { bolt: 0, lightning: 0, nova: 0 },
    denyFlash: { bolt: 0, lightning: 0, nova: 0 },
    shake: 0,
    hitStop: 0,
    hitStopGap: 0,
    slowMo: 0,
    recap: emptyRecap(),
    spawnAcc: 0,
    nextBossTime: DIRECTOR.bossTime,
    bossIndex: 0,
    bossWarned: false,
    boss: null,
    banner: null,
    nextId: 1,
    novaCounter: 0,
    pickupPitch: 0,
    pickupPitchTimer: 0,
    regenAcc: 0,
    sfx,
  };
}

export const ARENA_CENTER = { x: ARENA.width / 2, y: ARENA.height / 2 };
