import { BEASTS } from './bestiary';
import { BUFF_INFO, damageBreakable } from './breakables';
import { damageEnemy, killEnemy, updateCrystals, updateShots } from './combat';
import { ARCHETYPE, BOSSES, BREAKABLES, DESCENT, ENEMIES, EVOLUTIONS, SNAKE, SPELL_INFO, SPELLS, type BossId, type EnemyKind, type SpellId } from './config';
import { updateEffects } from './effects';
import { bossHp, makeElite, spawnEnemy, updateEnemies, updatePortals } from './enemies';
import { FINALE, riseAscendant } from './finale';
import { addGroundFx, spawnBlast, updateHazards } from './hazards';
import { MAP_ORDER, MAPS } from './maps';
import type { BreakableLook, MapId } from './maps/types';
import { clamp, TAU, type Vec } from './math';
import { emptyMetaLevels } from './progression';
import { SITE_INFO, SITE_KINDS, SITES, type SiteKind } from './sites';
import { castSpell, tickCooldowns, updateBeams, updateBolts, updateEchoes, updateFrost, updateNovas, updateWard } from './spells';
import { castUltimate, ULTIMATES, updateUltimate, type UltimateId } from './ultimates';
import { clearanceAt } from './terrain';
import { WIZARD_IDS, WIZARDS, type WizardId } from './wizards';
import { createWorld, type BlastLook, type EliteKind, type Enemy, type EnemyShot, type GroundKind, type PickupKind, type World } from './world';

/**
 * The inspector (development only: open the game with ?inspector). Every sprite and effect in
 * the game on its own, drawn by the real renderer on a real world with nothing else in it. A
 * subject is put on a stage (a map's world, cleared, with the subject on open floor in the
 * middle) and stepped there: idle, where only its animation runs, or live, where its own logic
 * runs against a serpent that can't be hurt.
 */

export type SubjectGroup = 'Serpents' | 'Foes' | 'Archmages' | 'Spells' | 'Ultimates' | 'Objects' | 'Ground' | 'Sites' | 'Floors';
export const SUBJECT_GROUPS: SubjectGroup[] = ['Serpents', 'Foes', 'Archmages', 'Spells', 'Ultimates', 'Objects', 'Ground', 'Sites', 'Floors'];

/** Held while a foe idles; in a live run they come and go as they would in play. */
export type FoeStatus = 'frozen' | 'chilled' | 'stunned' | 'shocked' | 'burrowed' | 'collapsed';
export const STATUS_NAMES: Record<FoeStatus, string> = {
  frozen: 'Frozen',
  chilled: 'Chilled',
  stunned: 'Stunned',
  shocked: 'Shocked',
  burrowed: 'Burrowed',
  collapsed: 'Collapsed',
};

/** What the panel offers for a subject. */
export interface SubjectFeatures {
  /** It has logic of its own to run live (foes, the serpent, spells cast at moving foes). */
  live: boolean;
  /** It can be turned while idle. */
  heading: boolean;
  hit: boolean;
  kill: boolean;
  /** Elite modifiers it can have (serpent-shaped foes don't split). */
  elites: EliteKind[];
  statuses: FoeStatus[];
  /** A boss: enraged at half health. */
  enrage: boolean;
  /** The Ascendant's three phases. */
  phases: number;
  /** Drawn in this many seeded variants (breakables). */
  variants: number;
  /** A spell with an evolution, by name. */
  evolution: string | null;
  /** A site that can be spent. */
  spent: boolean;
  /** The serpent's length. */
  length: boolean;
}

export interface Subject {
  id: string;
  group: SubjectGroup;
  name: string;
  /** The map whose floor it is shown on, unless another is chosen. */
  map: MapId;
  /** Lines for the panel: what it is, and its numbers. */
  notes: [string, string][];
  features: SubjectFeatures;
  /** Shows the serpent: always, never, or only live (the target foes hunt). */
  serpent: 'always' | 'never' | 'live';
  /** Puts it on a cleared stage. */
  place(stage: Stage): void;
  /** Done again every `every` seconds: a spell recast, a shot fired, a blast marked. */
  every?: number;
  act?(stage: Stage): void;
  /** Per step, whatever its animation needs that no game update gives it (a portal opening, the finale gathering). */
  tick?(stage: Stage, dt: number): void;
  /** It has been killed, broken or used up, and a fresh one is due. */
  gone?(stage: Stage): boolean;
}

/** Choices that last across resets of the same subject. */
export interface StageOptions {
  live: boolean;
  /** Facing while idle, in radians, and turning on its own. */
  heading: number;
  spin: boolean;
  elite: EliteKind | null;
  statuses: FoeStatus[];
  enraged: boolean;
  phase: number;
  variant: number;
  evolved: boolean;
  spent: boolean;
  /** Body segments. */
  length: number;
}

export function defaultOptions(): StageOptions {
  return { live: false, heading: 0, spin: false, elite: null, statuses: [], enraged: false, phase: 0, variant: 0, evolved: false, spent: false, length: 24 };
}

export interface Stage {
  subject: Subject;
  options: StageOptions;
  world: World;
  /** Open, dry floor in the middle of the map: where the subject stands. */
  center: Vec;
  /** The foe or boss on show. */
  foe: Enemy | null;
  /** Training dummies for spells and ultimates. */
  dummies: Enemy[];
  /** Seconds until the next act, and until a gone subject is put back (-1 while it is here). */
  again: number;
  respawn: number;
}

const FEATURES: SubjectFeatures = {
  live: false,
  heading: false,
  hit: false,
  kill: false,
  elites: [],
  statuses: [],
  enrage: false,
  phases: 0,
  variants: 0,
  evolution: null,
  spent: false,
  length: false,
};

/** Radius of the serpent's laps round the middle while live. */
const LAP = 260;
/** Seconds a killed or broken subject stays gone before it is put back. */
const RESPAWN = 1.6;
/** A training dummy's health: enough to take any one blow, small enough that blows by share of health look as in play. */
const DUMMY_HP = 400;

// ---------------------------------------------------------------- stages

interface MapStage {
  world: World;
  center: Vec;
}

/** One world per map, built once: building a map takes a while, clearing one is instant. */
const built = new Map<MapId, MapStage>();

function mapStage(map: MapId): MapStage {
  let s = built.get(map);
  if (s) return s;
  const world = createWorld(emptyMetaLevels(), () => undefined, 7, { wizard: 'arcanist', curses: [], startDepth: MAP_ORDER.indexOf(map) + 1 });
  world.depth = 1;
  s = { world, center: openMiddle(world) };
  built.set(map, s);
  return s;
}

/** The roomiest dry floor near a boss clearing's middle (they are the maps' big open spaces), else where the serpent starts. */
function openMiddle(w: World): Vec {
  const m = w.map;
  const room = (x: number, y: number) => Math.min(clearanceAt(m.index, x, y), m.hazardIndex ? clearanceAt(m.hazardIndex, x, y) : Infinity);
  let best = { x: m.start.x, y: m.start.y, room: room(m.start.x, m.start.y) };
  for (const c of m.clearings) {
    const x = (c.x0 + c.x1) / 2;
    const y = (c.y0 + c.y1) / 2;
    const r = room(x, y);
    if (r > best.room) best = { x, y, room: r };
  }
  return { x: best.x, y: best.y };
}

/** Empties the world of everything a subject or run put in it, leaving the map. */
function clearWorld(w: World): void {
  for (const list of [w.enemies, w.portals, w.bolts, w.shots, w.crystals, w.breakables, w.refills, w.pickups, w.novas, w.arcs, w.frostFields, w.beams, w.echoes, w.shatters, w.constricts, w.particles, w.floaters, w.groundFx, w.blasts, w.vents, w.sites, w.stars, w.ultRings])
    list.length = 0;
  Object.assign(w, {
    ward: null,
    coil: null,
    rift: null,
    riftReward: false,
    descent: null,
    finale: null,
    won: false,
    boss: null,
    bossIndex: 0,
    bossClearing: -1,
    banner: null,
    relicOffer: null,
    fade: 0,
    shake: 0,
    hitStop: 0,
    slowMo: 0,
    hurtFlash: 0,
    zeroUntil: 0,
    chestCurse: 0,
    aspects: {},
    duos: [],
    mapStart: w.time,
  });
  for (const id of Object.keys(w.evolved) as SpellId[]) w.evolved[id] = false;
  for (const id of Object.keys(w.buffs) as (keyof World['buffs'])[]) w.buffs[id] = 0;
  Object.assign(w.ult, { cooldown: 0, ready: true, active: 0, t: 0, next: 0, left: 0, flash: 0 });
}

export function createStage(subject: Subject, options: StageOptions = defaultOptions(), map: MapId = subject.map): Stage {
  const { world, center } = mapStage(map);
  const stage: Stage = { subject, options, world, center, foe: null, dummies: [], again: 0, respawn: -1 };
  resetStage(stage);
  return stage;
}

/** Puts the subject back as new, with the stage's options. */
export function resetStage(stage: Stage): void {
  const w = stage.world;
  clearWorld(w);
  stage.foe = null;
  stage.dummies = [];
  stage.again = stage.subject.every ?? 0;
  stage.respawn = -1;
  w.wizard = 'arcanist';
  // Out of the way unless the subject shows it: far to the side, where nothing reaches it.
  w.snake.reset(stage.center.x + 4000, stage.center.y, Math.PI);
  stage.subject.place(stage);
  const e = stage.foe;
  if (e) {
    if (stage.options.elite && stage.subject.features.elites.includes(stage.options.elite)) makeElite(w, e, stage.options.elite);
    if (stage.options.live) applyLive(stage, e);
    else pose(stage, e);
  }
  if (stage.subject.serpent === 'live' && stage.options.live) w.snake.reset(stage.center.x + LAP, stage.center.y, Math.PI / 2);
  w.banner = null;
}

/** A live foe starts in the state its options ask for: statuses for their usual time, a boss enraged (or the Ascendant in a later phase) by its health. */
function applyLive(stage: Stage, e: Enemy): void {
  const o = stage.options;
  const w = stage.world;
  for (const s of o.statuses) {
    if (s === 'frozen') e.frozen = 3;
    if (s === 'stunned') e.stunned = 2;
    if (s === 'chilled') e.chillUntil = w.time + 4;
    if (s === 'shocked') e.shockUntil = w.time + 4;
  }
  if (e.kind !== 'boss') return;
  if (e.bossId === 'ascendant') e.hp = e.maxHp * [1, 0.6, 0.3][o.phase];
  else if (o.enraged) e.hp = e.maxHp * 0.45;
}

/** An idle foe holds its options every step: facing, statuses and phase. */
function pose(stage: Stage, e: Enemy): void {
  const o = stage.options;
  const w = stage.world;
  e.heading = e.aim = o.heading;
  e.kx = e.ky = 0;
  const has = (s: FoeStatus) => o.statuses.includes(s);
  e.frozen = has('frozen') ? 1 : 0;
  e.stunned = has('stunned') ? 1 : 0;
  e.chill = has('chilled') ? 1 : 0;
  e.chillUntil = has('chilled') ? w.time + 1 : 0;
  e.shockUntil = has('shocked') ? w.time + 1 : 0;
  e.hidden = has('burrowed');
  e.pile = has('collapsed') ? 1 : 0;
  if (e.kind === 'boss') {
    e.enraged = o.enraged;
    e.phase = e.bossId === 'ascendant' ? o.phase : 0;
  }
  // A serpent-shaped foe lies straight out behind its head.
  if (e.trail && e.segments.length > 0) {
    e.trail.reset(e.x, e.y, e.heading, (e.segments.length + 2) * e.segSpacing);
    e.trail.sample(e.x, e.y, e.segments.length, e.segSpacing, e.segments);
  }
}

/** Advances the stage by `dt` seconds of game time. */
export function stepStage(stage: Stage, dt: number): void {
  const w = stage.world;
  const sub = stage.subject;
  const o = stage.options;
  w.time += dt;
  // Nothing hurts the serpent while the stage steps (between steps it is drawn without the
  // flicker of being invulnerable), and the engine's freezes have no frame to freeze.
  w.invuln = 1e9;
  w.hp = w.stats.maxHp;
  w.hitStop = 0;
  w.slowMo = 0;
  w.refills.length = 0;
  if (o.spin && !o.live) o.heading = (o.heading + dt * 0.8) % TAU;

  const live = o.live && sub.features.live;
  if (sub.serpent !== 'never' && (sub.serpent === 'always' || live)) {
    if (live && sub.group !== 'Spells' && sub.group !== 'Ultimates') lap(stage, dt);
    else w.snake.anim += dt;
  }
  if (live) {
    updateEnemies(w, dt);
    updatePortals(w, dt);
  } else {
    // Idle: no foe thinks or moves; hits still flash and fade, and the dead are cleared away.
    for (let i = w.enemies.length - 1; i >= 0; i--) {
      const e = w.enemies[i];
      if (e.dead) w.enemies.splice(i, 1);
      else {
        e.flash = Math.max(0, e.flash - dt);
        if (e === stage.foe) pose(stage, e);
      }
    }
  }
  // Dummies are healed after every blow; one felled by a single huge one stands straight back up.
  stage.dummies = stage.dummies.map((d, i) => (d.dead ? spawnDummy(stage, i) : Object.assign(d, { hp: d.maxHp })));
  updateShots(w, dt);
  updateHazards(w, dt);
  updateBolts(w, dt);
  updateNovas(w, dt);
  updateFrost(w, dt);
  updateBeams(w, dt);
  updateWard(w, dt);
  updateEchoes(w);
  updateUltimate(w, dt);
  tickCooldowns(w, dt);
  if (sub.group === 'Foes' || sub.group === 'Archmages') updateCrystals(w, dt);
  for (const b of w.breakables) b.flash = Math.max(0, b.flash - dt);
  sub.tick?.(stage, dt);
  if (sub.every && sub.act) {
    stage.again -= dt;
    if (stage.again <= 0) {
      stage.again += sub.every;
      sub.act(stage);
    }
  }
  updateEffects(w, dt);
  w.banner = null;
  w.invuln = 0;

  const gone = sub.gone ? sub.gone(stage) : !!stage.foe && (stage.foe.dead || !w.enemies.includes(stage.foe));
  if (gone && stage.respawn < 0) stage.respawn = RESPAWN;
  if (stage.respawn >= 0) {
    stage.respawn -= dt;
    if (stage.respawn < 0) resetStage(stage);
  }
}

/** The serpent laps the middle of the stage, steering as a player would. */
function lap(stage: Stage, dt: number): void {
  const s = stage.world.snake;
  const c = stage.center;
  const a = Math.atan2(s.y - c.y, s.x - c.x) + 0.6;
  s.update(dt, c.x + Math.cos(a) * LAP - s.x, c.y + Math.sin(a) * LAP - s.y, stage.world.map);
}

/** Whether the renderer should draw the serpent now. */
export function showsSerpent(stage: Stage): boolean {
  const s = stage.subject.serpent;
  return s === 'always' || (s === 'live' && stage.options.live);
}

/** Where the view looks: the foe on show (the middle of its body, for a serpent-shaped one), else the middle of the stage. */
export function focusOf(stage: Stage): Vec {
  const e = stage.foe;
  if (!e || e.dead) return stage.center;
  const tail = e.segments[e.segments.length - 1];
  return tail ? { x: (e.x + tail.x) / 2, y: (e.y + tail.y) / 2 } : { x: e.x, y: e.y };
}

// ---------------------------------------------------------------- actions

/** A light hit: the subject flashes and is knocked back, and a foe keeps at least 1 health. Returns false if it can't be hit. */
export function hitSubject(stage: Stage): boolean {
  const w = stage.world;
  const e = stage.foe;
  if (e && !e.dead) {
    const amount = Math.max(0, Math.min(Math.ceil(e.maxHp * 0.08), e.hp - 1));
    damageEnemy(w, e, amount, 'bolt', '#8fe8ff', 160, 0, e.x - e.r, e.y);
    return true;
  }
  const b = w.breakables[0];
  if (b) {
    damageBreakable(w, b, b.size === 'small' ? 1 : Math.ceil(b.maxHp / 4));
    return true;
  }
  return false;
}

export function killSubject(stage: Stage): boolean {
  const w = stage.world;
  if (stage.foe && !stage.foe.dead) {
    killEnemy(w, stage.foe);
    return true;
  }
  const b = w.breakables[0];
  if (b) {
    damageBreakable(w, b, 1e9);
    return true;
  }
  return false;
}

/** Circles the panel can outline: what each thing collides with. */
export function hitCircles(stage: Stage): { x: number; y: number; r: number; color: string }[] {
  const w = stage.world;
  const out: { x: number; y: number; r: number; color: string }[] = [];
  const add = (x: number, y: number, r: number, color: string) => out.push({ x, y, r, color });
  for (const e of w.enemies) {
    if (e.dead) continue;
    add(e.x, e.y, e.r, '#ff5d7a');
    for (const s of e.segments) add(s.x, s.y, e.segRadius, '#ff9ab0');
  }
  if (showsSerpent(stage)) {
    const s = w.snake;
    add(s.x, s.y, SNAKE.headRadius, '#5fffd0');
    s.segments.forEach((p, i) => add(p.x, p.y, s.segmentRadius(i), '#9fffe4'));
  }
  for (const b of w.breakables) add(b.x, b.y, b.r, '#ffd45e');
  for (const s of w.sites) add(s.x, s.y, SITES.radius, SITE_INFO[s.kind].color);
  for (const p of w.shots) add(p.x, p.y, p.r, '#ff8a4d');
  for (const b of w.blasts) add(b.x, b.y, b.r, '#ffd400');
  for (const g of w.groundFx) add(g.x, g.y, g.r, '#ff7a2a');
  for (const f of w.frostFields) add(f.x, f.y, f.radius, '#bfe6ff');
  for (const n of w.novas) add(n.x, n.y, n.radius, '#ffd45e');
  for (const b of w.bolts) add(b.x, b.y, b.r, '#8fe8ff');
  if (w.descent) add(w.descent.x, w.descent.y, DESCENT.radius, '#ffd45e');
  return out;
}

// ---------------------------------------------------------------- the catalog

/** The map a foe or boss belongs to (the Ascendant rises on the last). */
function homeOf(kind: EnemyKind | BossId): MapId {
  if (kind === 'ascendant') return MAP_ORDER[MAP_ORDER.length - 1];
  return MAP_ORDER.find((id) => MAPS[id].boss === kind || (MAPS[id].roster as readonly string[]).includes(kind)) ?? MAP_ORDER[0];
}

const only = (f: Partial<SubjectFeatures>): SubjectFeatures => ({ ...FEATURES, ...f });

function foeSubject(kind: Exclude<EnemyKind, 'boss'>): Subject {
  const beast = BEASTS[kind];
  const c = ENEMIES[kind];
  const statuses: FoeStatus[] = ['frozen', 'chilled', 'stunned', 'shocked'];
  if (kind === 'burrowViper') statuses.push('burrowed');
  if (kind === 'rattler') statuses.push('collapsed');
  return {
    id: `foe:${kind}`,
    group: 'Foes',
    name: beast.name,
    map: homeOf(kind),
    notes: [
      ['', beast.lore],
      ['Map', MAPS[homeOf(kind)].name],
      ['Fights like', ARCHETYPE[kind]],
      ['Health', `${c.hp}`],
      ['Speed', `${c.speed}`],
      ['Radius', `${c.radius}`],
      ['Bite', `${c.contact}`],
      ['XP', `${c.xp}`],
    ],
    features: only({ live: true, heading: true, hit: true, kill: true, elites: kind === 'rival' || kind === 'salamander' ? ['shielded', 'swift'] : ['shielded', 'swift', 'splitting'], statuses }),
    serpent: 'live',
    place: (st) => {
      st.foe = spawnEnemy(st.world, kind, st.center.x, st.center.y);
    },
  };
}

function bossSubject(id: BossId): Subject {
  const beast = BEASTS[id];
  const b = BOSSES[id];
  const asc = id === 'ascendant';
  return {
    id: `boss:${id}`,
    group: 'Archmages',
    name: b.name,
    map: homeOf(id),
    notes: [
      ['', beast.lore],
      ['Map', MAPS[homeOf(id)].name],
      ['Health', `${Math.round(bossHp(0, 1) * (asc ? FINALE.hpMult : 1))} at depth 1`],
      ['Moves', b.moves.join(', ')],
      ['Summons', b.summon.map((k) => BEASTS[k as Exclude<EnemyKind, 'boss'>]?.name ?? k).join(', then ')],
    ],
    features: only({ live: true, heading: true, hit: true, kill: true, statuses: ['frozen', 'chilled', 'stunned', 'shocked'], enrage: !asc, phases: asc ? 3 : 0 }),
    serpent: 'live',
    place: (st) => {
      const w = st.world;
      const { x, y } = st.center;
      if (asc) {
        w.finale = { x, y, t: 0, stage: 'rising' };
        st.foe = riseAscendant(w, x, y);
        w.particles.length = 0;
        w.shake = 0;
      } else {
        st.foe = spawnEnemy(w, 'boss', x, y);
        st.foe.bossId = id;
      }
    },
  };
}

/**
 * Lays the serpent out in a gentle S: driven along `heading` from well behind, weaving, so the
 * whole body is down with its middle near `mid`.
 */
function layOut(w: World, mid: Vec, segments: number, heading: number): void {
  const s = w.snake;
  const step = 1 / 120;
  const len = segments * SNAKE.segmentSpacing;
  const drive = (len + 160) / SNAKE.speed;
  const run = SNAKE.speed * drive;
  s.reset(mid.x - Math.cos(heading) * (run - len / 2), mid.y - Math.sin(heading) * (run - len / 2), heading);
  s.segmentCount = s.segmentTarget = segments;
  for (let t = 0; t < drive; t += step) {
    const a = heading + Math.sin(t * 4.5) * 0.55;
    s.update(step, Math.cos(a), Math.sin(a), w.map);
  }
  s.anim = 0;
}

function serpentSubject(id: WizardId): Subject {
  const wiz = WIZARDS[id];
  return {
    id: `serpent:${id}`,
    group: 'Serpents',
    name: wiz.name,
    map: MAP_ORDER[0],
    notes: [
      ['', wiz.title],
      ['Sigils', wiz.spells.map((s) => SPELLS[s].name).join(', ')],
      ['Ultimate', ULTIMATES[wiz.ultimate].name],
      ['Perks', wiz.perks.join('; ')],
      ['Head radius', `${SNAKE.headRadius}`],
      ['Speed', `${SNAKE.speed}`],
    ],
    features: only({ live: true, length: true }),
    serpent: 'always',
    place: (st) => {
      st.world.wizard = id;
      if (st.options.live) {
        st.world.snake.reset(st.center.x + LAP, st.center.y, Math.PI / 2);
        st.world.snake.segmentCount = st.world.snake.segmentTarget = st.options.length;
      } else layOut(st.world, st.center, st.options.length, st.options.heading);
    },
  };
}

/** Where the training dummies stand, from the middle of the stage. */
const DUMMY_SPOTS: Vec[] = [
  { x: 100, y: -85 },
  { x: 175, y: 10 },
  { x: 95, y: 100 },
];

function spawnDummy(st: Stage, i: number): Enemy {
  const e = spawnEnemy(st.world, 'chaser', st.center.x + DUMMY_SPOTS[i].x, st.center.y + DUMMY_SPOTS[i].y);
  e.heading = e.aim = Math.PI;
  e.hp = e.maxHp = DUMMY_HP;
  return e;
}

/** The caster on the left, facing three chasers to the right that take every blow and stand. */
function castingStage(st: Stage, wizard: WizardId): void {
  const w = st.world;
  w.wizard = wizard;
  layOut(w, { x: st.center.x - 170, y: st.center.y }, 18, 0);
  st.dummies = DUMMY_SPOTS.map((_, i) => spawnDummy(st, i));
}

const SPELL_EVERY: Record<SpellId, number> = { bolt: 0.9, lightning: 1.8, nova: 2.4, ward: 4.5, frost: 4 };

function spellSubject(id: SpellId): Subject {
  const sp = SPELLS[id];
  const evo = EVOLUTIONS[id];
  return {
    id: `spell:${id}`,
    group: 'Spells',
    name: sp.name,
    map: MAP_ORDER[0],
    notes: [
      ['', SPELL_INFO[id].blurb],
      ['Sigil', SPELL_INFO[id].shape],
      ['Cooldown', `${sp.cooldown} s`],
      ['Evolves into', `${evo.name}: ${evo.description}`],
    ],
    features: only({ live: true, evolution: evo.name }),
    serpent: 'always',
    place: (st) => {
      castingStage(st, 'arcanist');
      st.world.evolved[id] = st.options.evolved;
      st.again = 0.3;
    },
    every: SPELL_EVERY[id],
    act: (st) => {
      const t = st.dummies[1] ?? null;
      castSpell(st.world, id, t ? { x: t.x, y: t.y } : { x: st.center.x + 150, y: st.center.y }, 1);
    },
  };
}

function ultimateSubject(id: UltimateId): Subject {
  const u = ULTIMATES[id];
  const wizard = WIZARD_IDS.find((w) => WIZARDS[w].ultimate === id) ?? 'arcanist';
  const duration = 'duration' in u ? u.duration : 3;
  return {
    id: `ult:${id}`,
    group: 'Ultimates',
    name: u.name,
    map: MAP_ORDER[0],
    notes: [
      ['', u.description],
      ['Wizard', WIZARDS[wizard].name],
      ['Cooldown', `${u.cooldown} s`],
    ],
    features: only({ live: true }),
    serpent: 'always',
    place: (st) => {
      castingStage(st, wizard);
      st.world.ult.id = id;
      st.again = 0.4;
    },
    every: duration + 2.5,
    act: (st) => {
      Object.assign(st.world.ult, { cooldown: 0, active: 0 });
      castUltimate(st.world);
    },
  };
}

const BREAKABLE_NAMES: Record<BreakableLook, string> = {
  urn: 'Urn',
  reliquary: 'Reliquary',
  geode: 'Geode',
  brazier: 'Brazier',
  glowcap: 'Glowcaps',
  seedpod: 'Seedpod',
  frostUrn: 'Frost urn',
  coffin: 'Coffin',
};

function breakableSubject(look: BreakableLook): Subject {
  const map = MAP_ORDER.find((id) => MAPS[id].breakables.small === look || MAPS[id].breakables.large === look) ?? MAP_ORDER[0];
  const large = MAPS[map].breakables.large === look;
  const cfg = large ? BREAKABLES.large : BREAKABLES.small;
  return {
    id: `breakable:${look}`,
    group: 'Objects',
    name: BREAKABLE_NAMES[look],
    map,
    notes: [
      ['', large ? 'Large: solid to bump into, broken by spells. Always drops a buff.' : 'Small: shatters at a touch of the head or any spell.'],
      ['Map', MAPS[map].name],
      ['Radius', `${cfg.radius}`],
      ['Health', large ? `${BREAKABLES.large.hp} at depth 1` : '1'],
    ],
    features: only({ hit: true, kill: true, variants: 4 }),
    serpent: 'never',
    place: (st) => {
      const w = st.world;
      w.breakables.push({
        id: w.nextId++,
        slot: -1,
        size: large ? 'large' : 'small',
        look,
        x: st.center.x,
        y: st.center.y,
        r: cfg.radius,
        hp: large ? BREAKABLES.large.hp : 1,
        maxHp: large ? BREAKABLES.large.hp : 1,
        flash: 0,
        lastNovaId: -1,
        variant: st.options.variant,
      });
    },
    gone: (st) => st.world.breakables.length === 0,
  };
}

const PICKUP_NAMES: Record<PickupKind, string> = {
  heal: 'Heart',
  bigHeal: 'Big heart',
  ...Object.fromEntries(Object.entries(BUFF_INFO).map(([id, b]) => [id, b.name])),
} as Record<PickupKind, string>;

function pickupSubject(kind: PickupKind): Subject {
  const buff = kind === 'heal' || kind === 'bigHeal' ? null : BUFF_INFO[kind];
  return {
    id: `pickup:${kind}`,
    group: 'Objects',
    name: PICKUP_NAMES[kind],
    map: MAP_ORDER[0],
    notes: [['', buff ? buff.blurb : kind === 'heal' ? 'Restores a little health.' : 'Restores a share of max health.']],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.world.pickups.push({ id: st.world.nextId++, kind, x: st.center.x, y: st.center.y, vx: 0, vy: 0, t: 0, magnet: false });
    },
    tick: (st, dt) => {
      for (const p of st.world.pickups) p.t = (p.t + dt) % 8;
    },
  };
}

function crystalSubject(value: number, name: string): Subject {
  return {
    id: `crystal:${value}`,
    group: 'Objects',
    name,
    map: MAP_ORDER[0],
    notes: [['', `An XP crystal worth ${value}. Bigger drops come as fewer, larger crystals.`]],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.world.crystals.push({ x: st.center.x, y: st.center.y, vx: 0, vy: 0, value, magnet: false, t: 0 });
    },
    tick: (st, dt) => {
      for (const c of st.world.crystals) c.t += dt;
    },
  };
}

function portalSubject(kind: EnemyKind, name: string): Subject {
  return {
    id: `portal:${kind}`,
    group: 'Objects',
    name,
    map: MAP_ORDER[0],
    notes: [['', kind === 'boss' ? 'Opens where an Archmage is about to arrive.' : 'Opens a moment before a foe steps out of it.']],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.world.portals.push({ x: st.center.x, y: st.center.y, kind, t: 0, duration: kind === 'boss' ? 3 : 1.2 });
    },
    tick: (st, dt) => {
      for (const p of st.world.portals) p.t = (p.t + dt) % (p.duration + 0.6);
    },
  };
}

const SHOT_NAMES: Record<EnemyShot['look'], string> = { orb: 'Arcane orb (shot)', spore: 'Spore (shot)', icicle: 'Icicle (shot)' };

function shotSubject(look: EnemyShot['look']): Subject {
  return {
    id: `shot:${look}`,
    group: 'Objects',
    name: SHOT_NAMES[look],
    map: look === 'spore' ? 'hollows' : look === 'icicle' ? 'catacombs' : MAP_ORDER[0],
    notes: [['', 'A foe’s shot, fired across the stage again and again.']],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.again = 0;
    },
    every: 1.4,
    act: (st) => {
      const { x, y } = st.center;
      const speed = look === 'spore' ? 90 : 220;
      st.world.shots.push({ x: x - 220, y, vx: speed, vy: 0, r: 8, damage: 0, life: 440 / speed, spin: 0, source: { kind: 'caster', attack: 'shot' }, look });
    },
  };
}

function descentSubject(): Subject {
  return {
    id: 'object:descent',
    group: 'Objects',
    name: 'Way down',
    map: MAP_ORDER[0],
    notes: [['', 'Opens where an Archmage falls. Steering into it goes down to the next map.']],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.world.descent = { x: st.center.x, y: st.center.y, t: 0 };
    },
    tick: (st, dt) => {
      if (st.world.descent) st.world.descent.t += dt;
    },
  };
}

function finaleSubject(): Subject {
  return {
    id: 'object:finale',
    group: 'Objects',
    name: 'The Ascendant rising',
    map: MAP_ORDER[MAP_ORDER.length - 1],
    notes: [['', `Where the last Archmage falls, the four Archmages’ magic gathers for ${FINALE.rise} s before the Ascendant rises.`]],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.world.finale = { x: st.center.x, y: st.center.y, t: 0, stage: 'rising' };
    },
    tick: (st, dt) => {
      const f = st.world.finale;
      if (f) f.t = (f.t + dt) % FINALE.rise;
    },
  };
}

const GROUND_NAMES: Record<GroundKind, [string, MapId, string]> = {
  fire: ['Burning ground', 'ember', 'Left by fireballs and burning charges.'],
  lava: ['Lava trail', 'ember', 'A Magma Brute’s charge leaves it behind.'],
  bramble: ['Bramble trail', 'hollows', 'A Thornback’s charge leaves it behind.'],
  ice: ['Ice patch', 'catacombs', 'Frost underfoot: turning is slower on it.'],
};

function groundSubject(kind: GroundKind): Subject {
  const [name, map, blurb] = GROUND_NAMES[kind];
  return {
    id: `ground:${kind}`,
    group: 'Ground',
    name,
    map,
    notes: [['', blurb]],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.again = 0;
    },
    every: 4,
    act: (st) => {
      addGroundFx(st.world, st.center.x, st.center.y, 70, 4, kind);
    },
  };
}

const BLAST_NAMES: Record<BlastLook, [string, MapId]> = {
  meteor: ['Meteor', 'ember'],
  fireball: ['Lobbed fireball', 'ember'],
  vent: ['Vent eruption', 'ember'],
  spores: ['Spore fall', 'hollows'],
  icicle: ['Falling icicles', 'catacombs'],
  slam: ['Golem slam', 'catacombs'],
  burrow: ['Burrowing strike', 'hollows'],
};

function blastSubject(look: BlastLook): Subject {
  const [name, map] = BLAST_NAMES[look];
  return {
    id: `blast:${look}`,
    group: 'Ground',
    name,
    map,
    notes: [['', 'A telegraphed blast: marked on the ground, then it goes off.']],
    features: FEATURES,
    serpent: 'never',
    place: (st) => {
      st.again = 0;
    },
    every: 1.8,
    act: (st) => {
      const { x, y } = st.center;
      spawnBlast(st.world, {
        x,
        y,
        r: look === 'slam' ? 110 : 70,
        delay: 1.2,
        damage: 0,
        hitsFoes: false,
        source: { kind: 'hazard', attack: 'erupt' },
        after: null,
        look,
        from: look === 'fireball' ? { x: x - 320, y: y - 60 } : null,
      });
    },
  };
}

function siteSubject(kind: SiteKind): Subject {
  const info = SITE_INFO[kind];
  return {
    id: `site:${kind}`,
    group: 'Sites',
    name: info.name,
    map: MAP_ORDER[0],
    notes: [
      ['', info.blurb],
      ['Radius', `${SITES.radius}`],
    ],
    features: only({ spent: kind !== 'merchant' }),
    serpent: 'never',
    place: (st) => {
      st.world.sites.push({ id: 1, kind, x: st.center.x, y: st.center.y, spent: st.options.spent && kind !== 'merchant', inside: false, offer: [], sold: [] });
    },
  };
}

function floorSubject(map: MapId): Subject {
  const def = MAPS[map];
  return {
    id: `floor:${map}`,
    group: 'Floors',
    name: def.name,
    map,
    notes: [
      ['Foes', def.roster.map((k) => BEASTS[k as Exclude<EnemyKind, 'boss'>].name).join(', ')],
      ['Archmage', BOSSES[def.boss].name],
    ],
    features: FEATURES,
    serpent: 'never',
    place: () => undefined,
  };
}

export const SUBJECTS: Subject[] = [
  ...WIZARD_IDS.map(serpentSubject),
  ...MAP_ORDER.flatMap((m) => MAPS[m].roster.map((k) => foeSubject(k as Exclude<EnemyKind, 'boss'>))),
  ...[...MAP_ORDER.map((m) => MAPS[m].boss), 'ascendant' as const].map(bossSubject),
  ...(Object.keys(SPELLS) as SpellId[]).map(spellSubject),
  ...(Object.keys(ULTIMATES) as UltimateId[]).map(ultimateSubject),
  ...(Object.keys(BREAKABLE_NAMES) as BreakableLook[]).map(breakableSubject),
  ...(Object.keys(PICKUP_NAMES) as PickupKind[]).map(pickupSubject),
  crystalSubject(1, 'Crystal, small'),
  crystalSubject(5, 'Crystal, medium'),
  crystalSubject(10, 'Crystal, large'),
  portalSubject('chaser', 'Foe portal'),
  portalSubject('boss', 'Archmage portal'),
  ...(Object.keys(SHOT_NAMES) as EnemyShot['look'][]).map(shotSubject),
  descentSubject(),
  finaleSubject(),
  ...(Object.keys(GROUND_NAMES) as GroundKind[]).map(groundSubject),
  ...(Object.keys(BLAST_NAMES) as BlastLook[]).map(blastSubject),
  ...SITE_KINDS.map(siteSubject),
  ...MAP_ORDER.map(floorSubject),
];

/** The landmarks of a stage's map, to jump the view to. */
export function landmarksOf(stage: Stage): { name: string; x: number; y: number }[] {
  return stage.world.map.landmarks.map((l) => ({ name: l.name, x: l.x, y: l.y }));
}

/** Keeps a point inside the stage's map. */
export function clampToMap(stage: Stage, p: Vec): Vec {
  const b = stage.world.map.bounds;
  return { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) };
}
