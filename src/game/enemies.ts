import { pushOutOfBreakables } from './breakables';
import { inView, viewRect } from './camera';
import { ARCHETYPE, BOSS_MOVES, BOSSES, DEPTH, DIRECTOR, EFFECTS, ELITE, ENEMIES, HAZARDS, HEAT, METEORS, NAV, SNAKE, type EnemyKind } from './config';
import { hurtPlayer, sourceKind } from './combat';
import { addGroundFx, burnFoe, spawnBlast } from './hazards';
import type { HurtSource } from './recap';
import { burst } from './effects';
import { angleDiff, clamp, dist, TAU, type Vec } from './math';
import { flowAngle, flowDistance, refreshFlowField } from './nav';
import { COLORS } from './palette';
import { PathTrail, steerOnMap } from './snake';
import { enemyTimeScale } from './spells';
import { bounceOffSolids, clearanceAt, clearPath, pushOut } from './terrain';
import type { EliteKind, Enemy, EnemyShot, GroundKind, World } from './world';

// ---------------------------------------------------------------- Scaling

/** Seconds since the serpent arrived on the map it's on: foes scale with this, not the run's length (C1). */
export function mapClock(world: World): number {
  return world.time - world.mapStart;
}

/** How much a depth multiplies foe health: the step between maps grows a little each time. */
export function depthHp(depth: number): number {
  const d = depth - 1;
  return 1 + DEPTH.hpPerDepth * d + DEPTH.hpPerDepthSq * d * d;
}

/** How much tougher foes are `m` seconds after arriving on a map, at a depth and heat. */
export function difficulty(m: number, depth = 1, heat = 0) {
  const d = depth - 1;
  return {
    hp: (1 + m * DIRECTOR.hpLinear + (m / DIRECTOR.hpQuadDivisor) ** 2) * depthHp(depth) * (1 + HEAT.hp * heat),
    damage: (1 + m * DIRECTOR.damagePerSec) * (1 + DEPTH.damagePerDepth * d) * (1 + HEAT.damage * heat),
    speed: 1 + Math.min(DIRECTOR.maxSpeedBonus, m * DIRECTOR.speedPerSec + DEPTH.speedPerDepth * d),
  };
}

export function spawnRate(m: number, depth = 1): number {
  return (DIRECTOR.rateBase + DIRECTOR.rateLinear * m + DIRECTOR.rateQuad * m * m) * (1 + DEPTH.spawnPerDepth * (depth - 1));
}

/** Foes alive at once. Only the first map eases in with a few; later ones open at the full cap. */
export function aliveCap(m: number, depth = 1): number {
  const extra = DEPTH.capPerDepth * (depth - 1);
  return Math.floor(
    Math.min(
      DIRECTOR.capMax + extra,
      DIRECTOR.capBase + DIRECTOR.capPerSec * m + extra,
      depth <= 1 ? DIRECTOR.earlyCapBase + DIRECTOR.earlyCapPerSec * m : Infinity,
    ),
  );
}

/** A boss's health: more for each one before it, more each depth, and more with heat. */
export function bossHp(bossIndex: number, depth: number, heat = 0): number {
  const b = ENEMIES.boss;
  return b.hp * (1 + b.hpPerIndex * Math.max(0, bossIndex - 1)) * (1 + DEPTH.bossHpPerDepth * (depth - 1)) * (1 + HEAT.hp * heat);
}

/** Chance that a new spawn is elite: none in depth 1 unless cursed, then rising each depth; heat adds more. */
export function eliteChance(depth: number, cursed: boolean, heat = 0): number {
  const base = depth >= 2 ? ELITE.baseChance + ELITE.chancePerDepth * (depth - 2) : cursed ? ELITE.cursedChance : 0;
  return Math.min(ELITE.maxChance + HEAT.elite * heat, base + (cursed && depth >= 2 ? ELITE.cursedBonus : 0) + HEAT.elite * heat);
}

const ELITE_KINDS: EliteKind[] = ['shielded', 'swift', 'splitting'];

/** Makes a fresh enemy elite: tougher, bigger, worth more, with one modifier. */
function makeElite(world: World, e: Enemy): void {
  // Snakes can't split cleanly; everything else can roll any modifier.
  const kinds = SERPENT[e.kind] ? ELITE_KINDS.filter((k) => k !== 'splitting') : ELITE_KINDS;
  e.elite = kinds[Math.floor(world.rng() * kinds.length) % kinds.length];
  e.hp *= ELITE.hpMult;
  e.maxHp = e.hp;
  e.xp = Math.round(e.xp * ELITE.xpMult);
  e.r *= ELITE.sizeMult;
  e.contact *= ELITE.contactMult;
  if (e.elite === 'shielded') e.shield = e.shieldMax = e.maxHp * ELITE.shieldFraction;
}

function ramp(t: number, start: number, len: number): number {
  return clamp((t - start) / len, 0, 1);
}

/**
 * Spawn weights for a map's four foes, `t` seconds after arriving. The first map unlocks them
 * slowly; later ones faster (R4).
 */
export function kindWeights(t: number, roster: readonly EnemyKind[], first = true): [EnemyKind, number][] {
  const starts = first ? DIRECTOR.slotStart.first : DIRECTOR.slotStart.later;
  return roster.map((kind, i): [EnemyKind, number] => [
    kind,
    t >= starts[i] ? DIRECTOR.slotWeight[i] * Math.max(DIRECTOR.slotFloor[i], ramp(t, starts[i], DIRECTOR.slotRamp[i])) : 0,
  ]);
}

/** Seconds before a fresh foe's first attack, where it isn't its archetype's usual. */
const FIRST_ATTACK: Partial<Record<EnemyKind, number>> = {
  caster: ENEMIES.caster.firstShotDelay,
  puffcap: ENEMIES.puffcap.firstShotDelay,
  frostArcher: ENEMIES.frostArcher.firstShotDelay,
  pyromancer: ENEMIES.pyromancer.firstShotDelay,
  burrowViper: 2.0,
  wraith: 1.5,
  imp: 1,
};

/** Serpent-shaped kinds have a body of segments following the head. */
const SERPENT: Partial<Record<EnemyKind, { segments: number; segmentRadius: number; segmentSpacing: number }>> = {
  rival: ENEMIES.rival,
  salamander: ENEMIES.salamander,
  boss: ENEMIES.boss,
};

// ---------------------------------------------------------------- Spawning

export function spawnEnemy(world: World, kind: EnemyKind, x: number, y: number, canBeElite = false): Enemy {
  const diff = difficulty(mapClock(world), world.depth, world.heat);
  const base = ENEMIES[kind];
  const s = world.snake;
  const heading = Math.atan2(s.y - y, s.x - x);
  let hp = base.hp * diff.hp;
  if (kind === 'boss') hp = bossHp(world.bossIndex, world.depth, world.heat);
  const arch = ARCHETYPE[kind];
  const e: Enemy = {
    id: world.nextId++,
    kind,
    x,
    y,
    kx: 0,
    ky: 0,
    heading,
    r: base.radius,
    hp,
    maxHp: hp,
    speed: base.speed * diff.speed,
    contact: base.contact * diff.damage,
    damageMult: diff.damage,
    xp: base.xp,
    state: 'move',
    stateTime: 0,
    attackTimer: FIRST_ATTACK[kind] ?? (arch === 'brute' ? 1.5 : arch === 'rival' ? 2.0 : 0),
    aim: heading,
    flash: 0,
    wobble: world.rng() * TAU,
    dead: false,
    lastNovaId: -1,
    trail: null,
    segments: [],
    segRadius: 0,
    segSpacing: 0,
    bossMove: 'slither',
    moveIndex: 0,
    enraged: false,
    elite: null,
    shield: 0,
    shieldMax: 0,
    fragment: false,
    chill: 0,
    frozen: 0,
    frozenBy: -1,
    stunned: 0,
    shockUntil: 0,
    chillUntil: 0,
    nav: { next: 0, direct: true, sight: true, angle: heading, far: 0, stuck: 0, lastX: x, lastY: y },
    bossId: world.map.def.boss,
    burn: 0,
    trailAcc: 0,
    hidden: false,
    pile: 0,
    goal: null,
  };
  if (canBeElite && kind !== 'boss' && world.rng() < eliteChance(world.depth, world.effects.elitesFromStart, world.heat)) makeElite(world, e);
  const cfg = SERPENT[kind];
  if (cfg) {
    e.trail = new PathTrail(3);
    e.trail.reset(x, y, heading, (cfg.segments + 2) * cfg.segmentSpacing);
    e.segRadius = cfg.segmentRadius;
    e.segSpacing = cfg.segmentSpacing;
    e.trail.sample(x, y, cfg.segments, cfg.segmentSpacing, e.segments);
  }
  if (kind === 'boss') {
    e.attackTimer = ENEMIES.boss.slitherTime;
    world.boss = e;
  }
  world.enemies.push(e);
  return e;
}

function openPortal(world: World, kind: EnemyKind, x: number, y: number, duration = DIRECTOR.portalTime): void {
  world.portals.push({ x, y, kind, t: 0, duration });
}

/**
 * A spawn point in the ring just outside the view: on open floor, reachable along the flow
 * field and not too close to the serpent. The first tries also avoid the serpent's path, so
 * foes don't appear straight ahead. Null if nothing suitable turns up this time.
 */
export function ringPoint(world: World, clearance = 40): Vec | null {
  const s = world.snake;
  const b = world.map.bounds;
  const inner = viewRect(world.camera, NAV.ringInner);
  const outer = viewRect(world.camera, NAV.ringOuter);
  const x0 = Math.max(b.minX + clearance, outer.x0);
  const x1 = Math.min(b.maxX - clearance, outer.x1);
  const y0 = Math.max(b.minY + clearance, outer.y0);
  const y1 = Math.min(b.maxY - clearance, outer.y1);
  const ahead = { x: s.x + Math.cos(s.heading) * 500, y: s.y + Math.sin(s.heading) * 500 };
  for (let i = 0; i < 30; i++) {
    const x = x0 + world.rng() * (x1 - x0);
    const y = y0 + world.rng() * (y1 - y0);
    if (x > inner.x0 && x < inner.x1 && y > inner.y0 && y < inner.y1) continue;
    if (dist(x, y, s.x, s.y) < DIRECTOR.minSpawnDistance) continue;
    if (i < 15 && dist(x, y, ahead.x, ahead.y) < 350) continue;
    if (clearanceAt(world.map.index, x, y) < clearance || flowDistance(world.flow, x, y) === Infinity) continue;
    if (world.map.harmIndex && clearanceAt(world.map.harmIndex, x, y) < clearance) continue;
    return { x, y };
  }
  return null;
}

/** The clearing nearest the serpent by path, where the next boss will arrive. */
function nearestClearing(world: World): number {
  let best = 0;
  let bestD = Infinity;
  world.map.clearings.forEach((c, i) => {
    const x = (c.x0 + c.x1) / 2;
    const y = (c.y0 + c.y1) / 2;
    const path = flowDistance(world.flow, x, y);
    const d = path === Infinity ? dist(x, y, world.snake.x, world.snake.y) * 3 : path;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Where in its clearing the boss's portal opens: open ground as far from the serpent as the clearing allows. */
function bossPortalPoint(world: World, index: number): Vec {
  const c = world.map.clearings[index];
  const cx = (c.x0 + c.x1) / 2;
  const cy = (c.y0 + c.y1) / 2;
  const rx = (c.x1 - c.x0) / 2 - 150;
  const ry = (c.y1 - c.y0) / 2 - 150;
  const s = world.snake;
  let best = { x: cx, y: cy };
  let bestD = dist(cx, cy, s.x, s.y);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const d = dist(x, y, s.x, s.y);
    if (d > bestD && clearanceAt(world.map.index, x, y) >= 60) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/** Spots around (x, y) at `radius` with room to stand, for summoned foes. */
function openSpotsAround(world: World, x: number, y: number, radius: number, count: number): Vec[] {
  const out: Vec[] = [];
  const b = world.map.bounds;
  const off = world.rng() * TAU;
  for (let i = 0; i < count * 2 && out.length < count; i++) {
    const a = off + (i / count) * TAU;
    const px = clamp(x + Math.cos(a) * radius, b.minX + 40, b.maxX - 40);
    const py = clamp(y + Math.sin(a) * radius, b.minY + 40, b.maxY - 40);
    if (clearanceAt(world.map.index, px, py) >= 30) out.push({ x: px, y: py });
  }
  return out;
}

/** Picks the next foe from this map's roster, by the time since arriving; the special is capped. */
function chooseKind(world: World): EnemyKind {
  const t = world.time - world.mapStart;
  const roster = world.map.def.roster;
  const first = world.mapIndex === 0;
  const weights = kindWeights(t, roster, first);
  const special = roster[3];
  const start = (first ? DIRECTOR.slotStart.first : DIRECTOR.slotStart.later)[3];
  const specials = world.enemies.filter((e) => e.kind === special && !e.dead).length + world.portals.filter((p) => p.kind === special).length;
  const cap = t >= start ? 1 + Math.floor((t - start) / DIRECTOR.specialCapInterval) : 0;
  let total = 0;
  for (const [k, w] of weights) if (k !== special || specials < cap) total += w;
  let roll = world.rng() * total;
  for (const [k, w] of weights) {
    if (k === special && specials >= cap) continue;
    roll -= w;
    if (roll <= 0) return k;
  }
  return roster[0];
}

export function updateDirector(world: World, dt: number): void {
  const t = world.time;
  // Nothing new arrives while the way down is open.
  if (t < DIRECTOR.firstSpawn || world.descent) return;
  const boss = BOSSES[world.map.def.boss];

  // Boss schedule: the clearing it will arrive in is marked, then a warning banner, then a large portal.
  if (!world.boss && world.bossClearing < 0 && world.map.clearings.length > 0 && t >= world.nextBossTime - NAV.clearingWarning) {
    world.bossClearing = nearestClearing(world);
  }
  if (!world.bossWarned && t >= world.nextBossTime - DIRECTOR.bossWarning) {
    world.bossWarned = true;
    world.banner = {
      text: boss.warning[0],
      sub: boss.warning[1],
      t: 0,
      max: DIRECTOR.bossWarning + 0.5,
      color: '#ff7a8f',
    };
    world.sfx('bossWarn');
  }
  if (t >= world.nextBossTime) {
    world.nextBossTime += world.effects.bossInterval ?? DIRECTOR.bossInterval;
    world.bossWarned = false;
    if (!world.boss) {
      world.bossIndex++;
      const p = bossPortalPoint(world, world.bossClearing >= 0 ? world.bossClearing : nearestClearing(world));
      openPortal(world, 'boss', p.x, p.y, 2.0);
    }
    world.bossClearing = -1;
  }

  const bossAlive = world.boss !== null || world.portals.some((p) => p.kind === 'boss');
  const m = mapClock(world);
  const rate = spawnRate(m, world.depth) * world.effects.spawnRateMult * (bossAlive ? DIRECTOR.bossSpawnRateMult : 1);
  world.spawnAcc += rate * dt;
  const alive = world.enemies.length + world.portals.length;
  const cap = Math.floor(aliveCap(m, world.depth) * world.effects.capMult);
  while (world.spawnAcc >= 1) {
    world.spawnAcc -= 1;
    if (alive >= cap) {
      world.spawnAcc = Math.min(world.spawnAcc, 1);
      break;
    }
    const p = ringPoint(world);
    if (!p) continue;
    const kind = chooseKind(world);
    openPortal(world, kind, p.x, p.y);
    if (kind === 'sporeling') {
      // Sporelings arrive in a pack.
      const [lo, hi] = ENEMIES.sporeling.pack;
      const more = lo - 1 + Math.floor(world.rng() * (hi - lo + 1));
      for (const q of openSpotsAround(world, p.x, p.y, 46, more)) openPortal(world, kind, q.x, q.y);
    }
  }
}

export function updatePortals(world: World, dt: number): void {
  for (let i = world.portals.length - 1; i >= 0; i--) {
    const p = world.portals[i];
    p.t += dt;
    if (p.t >= p.duration) {
      world.portals.splice(i, 1);
      spawnEnemy(world, p.kind, p.x, p.y, true);
      burst(world, p.x, p.y, COLORS.portal, p.kind === 'boss' ? 40 : 8, p.kind === 'boss' ? 300 : 140, {
        size: 3,
        life: 0.4,
      });
      if (p.kind === 'boss') {
        const boss = BOSSES[world.map.def.boss];
        world.banner = { text: boss.name, sub: boss.arrival, t: 0, max: 2.6, color: '#ff7a8f' };
      }
    }
  }
}

// ---------------------------------------------------------------- AI

function fireShot(
  world: World,
  source: HurtSource,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  r: number,
  look: EnemyShot['look'] = 'orb',
  life = 6,
): void {
  if (world.shots.length >= EFFECTS.maxEnemyShots) return;
  world.shots.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, damage, life, spin: 0, source, look });
}

/** Where the player's head will be after `lead` seconds if it keeps going straight. */
function predictHead(world: World, lead: number) {
  const s = world.snake;
  return { x: s.x + Math.cos(s.heading) * 190 * lead, y: s.y + Math.sin(s.heading) * 190 * lead };
}

function setState(e: Enemy, state: Enemy['state']): void {
  e.state = state;
  e.stateTime = 0;
}

function moveToward(e: Enemy, angle: number, speed: number, dt: number): void {
  e.heading = angle;
  e.x += Math.cos(angle) * speed * dt;
  e.y += Math.sin(angle) * speed * dt;
}

/** Drops a patch of lava, brambles, burning ground or ice every `spacing` units a foe travels. */
function leaveTrail(world: World, e: Enemy, moved: number, kind: GroundKind, spacing: number, r: number, life: number): void {
  e.trailAcc += moved;
  if (e.trailAcc < spacing) return;
  e.trailAcc = 0;
  addGroundFx(world, e.x, e.y, r, life, kind);
}

// ---------------------------------------------------------------- Navigation

/**
 * Refreshes a foe's view of the way to the serpent a few times a second: whether it can go
 * straight there, whether a shot would get through, and otherwise which way the flow field
 * points. Also notices a foe that has stopped making progress.
 */
function updateNav(world: World, e: Enemy): void {
  const nav = e.nav;
  if (world.time < nav.next) return;
  const interval = NAV.sightInterval * (0.8 + (e.id % 5) * 0.1);
  nav.next = world.time + interval;
  const s = world.snake;
  const index = world.map.index;
  nav.direct = clearPath(index, e.x, e.y, s.x, s.y, e.r * 0.9);
  nav.sight = nav.direct || clearPath(index, e.x, e.y, s.x, s.y, 6);
  if (!nav.direct) nav.angle = flowAngle(world.flow, e.x, e.y) ?? Math.atan2(s.y - e.y, s.x - e.x);
  const moved = dist(e.x, e.y, nav.lastX, nav.lastY);
  const trying = e.state === 'move' && !nav.direct && e.stunned <= 0 && e.frozen <= 0;
  nav.stuck = trying && moved < 4 ? nav.stuck + interval : 0;
  nav.lastX = e.x;
  nav.lastY = e.y;
}

/** Which way a foe heads to reach the serpent: straight at it when nothing is in the way, else along the flow field. */
function chaseAngle(world: World, e: Enemy): number {
  return e.nav.direct ? Math.atan2(world.snake.y - e.y, world.snake.x - e.x) : e.nav.angle;
}

/** Attacks only start on screen, so the player always sees the telegraph. */
function canAttack(world: World, e: Enemy): boolean {
  return inView(world.camera, e.x, e.y, NAV.attackMargin);
}

/**
 * Brings back foes that fell far behind or got stuck out of sight: they reappear in the spawn
 * ring, so the fight stays around the serpent. The boss is never moved.
 */
function relocateStragglers(world: World, e: Enemy): void {
  if (e.kind === 'boss' || e.state === 'windup' || e.state === 'attack' || e.pile > 0) return;
  const nav = e.nav;
  const stuck = nav.stuck >= NAV.stuckTime && !inView(world.camera, e.x, e.y, 60);
  if (nav.far < NAV.farTime && !stuck) return;
  const p = ringPoint(world, e.r + 20);
  if (!p) return;
  e.x = p.x;
  e.y = p.y;
  e.kx = e.ky = 0;
  e.heading = Math.atan2(world.snake.y - p.y, world.snake.x - p.x);
  nav.far = nav.stuck = 0;
  nav.next = 0;
  nav.lastX = p.x;
  nav.lastY = p.y;
  if (e.trail) {
    e.trail.reset(p.x, p.y, e.heading, (e.segments.length + 2) * e.segSpacing);
    e.trail.sample(p.x, p.y, e.segments.length, e.segSpacing, e.segments);
  }
}

// ---------------------------------------------------------------- AI

function updateChaser(world: World, e: Enemy, dt: number): void {
  if (e.kind === 'rattler' && e.pile > 0) {
    // A pile of bones: it rises again, weaker, unless something finishes it first.
    e.pile -= dt;
    if (e.pile <= 0) {
      e.pile = 0;
      e.hp = e.maxHp * ENEMIES.rattler.riseHealth;
      burst(world, e.x, e.y, '#e8e0d0', 8, 160, { kind: 'shard', size: 2.5, life: 0.4 });
      world.sfx('rattle');
    }
    return;
  }
  // Weaving looks alive in the open; around obstacles it would just bump into them.
  const wob = Math.sin(world.time * 2.2 + e.wobble) * (e.nav.direct ? 0.45 : 0.15);
  let speed = e.speed;
  if (e.kind === 'sporeling') {
    // Short hops: a quick burst, then a pause.
    const cfg = ENEMIES.sporeling;
    const phase = ((world.time + e.wobble) / cfg.hop) % 1;
    speed *= phase < cfg.burst ? cfg.fast : cfg.slow;
  }
  moveToward(e, chaseAngle(world, e) + wob, speed, dt);
}

/**
 * Burrow Viper: chases above ground; within reach it dives, travels unseen as a mound and erupts
 * under where the serpent is heading, after a circle marks the spot.
 */
function updateViper(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.burrowViper;
  const s = world.snake;
  switch (e.state) {
    case 'move': {
      moveToward(e, chaseAngle(world, e), e.speed, dt);
      e.heading = chaseAngle(world, e);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && dist(e.x, e.y, s.x, s.y) < cfg.diveRange && canAttack(world, e)) {
        const goal = surfaceSpot(world, predictHead(world, cfg.lead), e.r + 10);
        e.goal = goal;
        e.aim = Math.atan2(goal.y - e.y, goal.x - e.x);
        e.hidden = true;
        spawnBlast(world, {
          x: goal.x,
          y: goal.y,
          r: cfg.eruptRadius,
          delay: cfg.telegraph,
          damage: cfg.eruptDamage * e.damageMult,
          hitsFoes: false,
          source: { kind: 'burrowViper', attack: 'erupt' },
          after: null,
          look: 'burrow',
          from: { x: e.x, y: e.y },
        });
        setState(e, 'windup');
        world.sfx('burrow');
      }
      break;
    }
    case 'windup': {
      // Underground: straight to the marked spot, arriving as the circle fills.
      const goal = e.goal ?? { x: e.x, y: e.y };
      const left = Math.max(dt, cfg.telegraph - (e.stateTime - dt));
      const d = dist(e.x, e.y, goal.x, goal.y);
      const step = Math.min(d, (d / left) * dt);
      if (d > 0) {
        e.x += ((goal.x - e.x) / d) * step;
        e.y += ((goal.y - e.y) / d) * step;
      }
      if (e.stateTime >= cfg.telegraph) {
        e.x = goal.x;
        e.y = goal.y;
        e.hidden = false;
        e.goal = null;
        setState(e, 'recover');
      }
      break;
    }
    case 'attack':
    case 'recover':
      // Surfaced, and open to hits for a moment.
      if (e.stateTime >= cfg.surfaced) {
        setState(e, 'move');
        e.attackTimer = cfg.diveCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
}

/** Crypt Golem: lumbers after the serpent and, close enough, slams the ground around itself, leaving ice. */
function updateGolem(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.golem;
  const s = world.snake;
  switch (e.state) {
    case 'move':
      moveToward(e, chaseAngle(world, e), e.speed, dt);
      e.heading = chaseAngle(world, e);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && dist(e.x, e.y, s.x, s.y) < cfg.slamRange + SNAKE.hitRadius && canAttack(world, e)) {
        spawnBlast(world, {
          x: e.x,
          y: e.y,
          r: cfg.slamRadius,
          delay: cfg.telegraph,
          damage: cfg.slamDamage * e.damageMult,
          hitsFoes: false,
          source: { kind: 'golem', attack: 'slam' },
          after: { r: cfg.slamRadius, life: cfg.iceLife, kind: 'ice' },
          look: 'slam',
          from: null,
        });
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    case 'windup':
      // Rooted while its fists come down.
      if (e.stateTime >= cfg.telegraph) setState(e, 'recover');
      break;
    case 'attack':
    case 'recover':
      if (e.stateTime >= cfg.recover) {
        setState(e, 'move');
        e.attackTimer = cfg.slamCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
}

/** Wraith: drifts straight at the serpent, through stone, and lunges. */
function updateWraith(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.wraith;
  const s = world.snake;
  const toward = Math.atan2(s.y - e.y, s.x - e.x);
  switch (e.state) {
    case 'move': {
      const wob = Math.sin(world.time * 1.6 + e.wobble) * 0.35;
      moveToward(e, toward + wob, e.speed, dt);
      e.heading = toward;
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && dist(e.x, e.y, s.x, s.y) < cfg.lungeRange && canAttack(world, e)) {
        e.aim = toward;
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup':
      // Tracks for the first half of the wind-up, then the lane is set.
      if (e.stateTime < cfg.telegraph * 0.5) e.aim = toward;
      e.heading = e.aim;
      if (e.stateTime >= cfg.telegraph) {
        setState(e, 'attack');
        world.sfx('charge');
      }
      break;
    case 'attack':
      moveToward(e, e.aim, cfg.lungeSpeed, dt);
      if (e.stateTime >= cfg.lungeTime) setState(e, 'recover');
      break;
    case 'recover':
      if (e.stateTime >= cfg.recover) {
        setState(e, 'move');
        e.attackTimer = cfg.lungeCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
}

/** Where something coming up from below surfaces near `p`: inside the map, out of stone. */
function surfaceSpot(world: World, p: Vec, r: number): Vec {
  const b = world.map.bounds;
  const at = { x: clamp(p.x, b.minX + r, b.maxX - r), y: clamp(p.y, b.minY + r, b.maxY - r) };
  pushOut(world.map.index, at, r);
  return at;
}

/** Cinder Imp: a chaser that crouches, then leaps the last stretch at where the head is going. */
function updateImp(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.imp;
  const s = world.snake;
  switch (e.state) {
    case 'move':
      updateChaser(world, e, dt);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && dist(e.x, e.y, s.x, s.y) < cfg.leapRange && e.nav.direct && canAttack(world, e)) {
        const p = predictHead(world, 0.2);
        e.aim = Math.atan2(p.y - e.y, p.x - e.x);
        setState(e, 'windup');
      }
      break;
    case 'windup':
      e.heading = e.aim;
      if (e.stateTime >= cfg.telegraph) setState(e, 'attack');
      break;
    case 'attack':
      moveToward(e, e.aim, cfg.leapSpeed, dt);
      if (pushOut(world.map.index, e, e.r) || e.stateTime >= cfg.leapTime) setState(e, 'recover');
      break;
    case 'recover':
      if (e.stateTime >= cfg.recover) {
        setState(e, 'move');
        e.attackTimer = cfg.leapCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
}

/**
 * Casters keep their distance and shoot. A Pyromancer instead lobs a fireball onto a circle
 * marked where the head is going: it arcs over stone, so it needs no clear line.
 */
function updateCaster(world: World, e: Enemy, dt: number): void {
  const pyro = e.kind === 'pyromancer';
  const cfg = e.kind === 'puffcap' ? ENEMIES.puffcap : e.kind === 'frostArcher' ? ENEMIES.frostArcher : ENEMIES.caster;
  const range = pyro ? ENEMIES.pyromancer.preferredRange : cfg.preferredRange;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  const toward = Math.atan2(s.y - e.y, s.x - e.x);
  // A Puffcap roots itself to swell; the others edge about as they aim.
  const slow = e.state === 'windup' ? (e.kind === 'puffcap' ? 0 : 0.3) : 1;
  if (!e.nav.sight && (!pyro || d > range + 150)) {
    // No clear shot (or, lobbing, too far): walk the path toward the serpent.
    const a = chaseAngle(world, e);
    e.x += Math.cos(a) * e.speed * slow * dt;
    e.y += Math.sin(a) * e.speed * slow * dt;
  } else {
    let radial = 0;
    if (d > range + 50) radial = 1;
    else if (d < range - 60) radial = -1;
    const side = e.id % 2 === 0 ? 1 : -1;
    const mx = Math.cos(toward) * radial + Math.cos(toward + (side * Math.PI) / 2) * 0.55;
    const my = Math.sin(toward) * radial + Math.sin(toward + (side * Math.PI) / 2) * 0.55;
    const ml = Math.hypot(mx, my) || 1;
    e.x += (mx / ml) * e.speed * slow * dt;
    e.y += (my / ml) * e.speed * slow * dt;
  }
  e.heading = toward;
  if (pyro) {
    lobFireball(world, e, dt, d);
    return;
  }

  if (e.state === 'move') {
    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && d < 680 && e.nav.sight && canAttack(world, e)) {
      e.aim = toward;
      setState(e, 'windup');
      world.sfx('telegraph');
    }
  } else if (e.state === 'windup') {
    if (e.kind === 'caster') {
      const p = predictHead(world, (d / cfg.shotSpeed) * ENEMIES.caster.lead);
      e.aim = Math.atan2(p.y - e.y, p.x - e.x);
    } else if (e.kind === 'frostArcher' && e.stateTime < cfg.telegraph * 0.5) {
      // The archer's line follows the serpent for half the draw, then holds still.
      e.aim = toward;
    }
    if (e.stateTime >= cfg.telegraph) {
      const ox = e.x + Math.cos(e.aim) * (e.r + 6);
      const oy = e.y + Math.sin(e.aim) * (e.r + 6);
      if (e.kind === 'puffcap') {
        const c = ENEMIES.puffcap;
        for (let i = 0; i < c.shots; i++) {
          const a = e.aim + (i - (c.shots - 1) / 2) * c.spread;
          fireShot(world, { kind: 'puffcap', attack: 'spore' }, ox, oy, a, c.shotSpeed, c.shotDamage * e.damageMult, c.shotRadius, 'spore', c.shotLife);
        }
        world.sfx('spores');
      } else if (e.kind === 'frostArcher') {
        const c = ENEMIES.frostArcher;
        fireShot(world, { kind: 'frostArcher', attack: 'icicle' }, ox, oy, e.aim, c.shotSpeed, c.shotDamage * e.damageMult, c.shotRadius, 'icicle');
        world.sfx('icicle');
      } else {
        fireShot(world, { kind: 'caster', attack: 'shot' }, ox, oy, e.aim, cfg.shotSpeed, cfg.shotDamage * e.damageMult, cfg.shotRadius);
        world.sfx('enemyShot');
      }
      setState(e, 'move');
      e.attackTimer = Math.max(1.4, (cfg.fireInterval * (0.85 + world.rng() * 0.3)) / (1 + world.time / 600));
    }
  }
}

/** The Pyromancer raises its hands for a moment, then marks the circle its fireball will land in. */
function lobFireball(world: World, e: Enemy, dt: number, d: number): void {
  const cfg = ENEMIES.pyromancer;
  if (e.state === 'move') {
    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && d < 700 && canAttack(world, e)) {
      setState(e, 'windup');
      world.sfx('telegraph');
    }
  } else if (e.state === 'windup' && e.stateTime >= 0.35) {
    const p = predictHead(world, cfg.lead);
    const b = world.map.bounds;
    spawnBlast(world, {
      x: clamp(p.x, b.minX + 20, b.maxX - 20),
      y: clamp(p.y, b.minY + 20, b.maxY - 20),
      r: cfg.blastRadius,
      delay: cfg.telegraph,
      damage: cfg.blastDamage * e.damageMult,
      hitsFoes: false,
      source: { kind: 'pyromancer', attack: 'fireball' },
      after: { r: cfg.burnRadius, life: cfg.burnTime },
      look: 'fireball',
      from: { x: e.x, y: e.y },
    });
    world.sfx('enemyShot');
    setState(e, 'move');
    e.attackTimer = Math.max(1.8, (cfg.fireInterval * (0.85 + world.rng() * 0.3)) / (1 + world.time / 600));
  }
}

/** Brutes charge in a straight line; a Magma Brute's charge leaves a trail of lava, a Thornback's one of brambles. */
function updateBrute(world: World, e: Enemy, dt: number): void {
  const magma = e.kind === 'magmaBrute';
  const thorny = e.kind === 'thornback';
  const cfg = magma ? ENEMIES.magmaBrute : thorny ? ENEMIES.thornback : ENEMIES.brute;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  switch (e.state) {
    case 'move': {
      moveToward(e, chaseAngle(world, e), e.speed, dt);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && d < cfg.chargeRange && e.nav.direct && canAttack(world, e)) {
        const p = predictHead(world, 0.25);
        e.aim = Math.atan2(p.y - e.y, p.x - e.x);
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup':
      if (e.stateTime >= cfg.telegraph) {
        setState(e, 'attack');
        world.sfx('charge');
      }
      break;
    case 'attack': {
      moveToward(e, e.aim, cfg.chargeSpeed, dt);
      if (magma || thorny) {
        const m = magma ? ENEMIES.magmaBrute : ENEMIES.thornback;
        leaveTrail(world, e, cfg.chargeSpeed * dt, magma ? 'lava' : 'bramble', m.trailSpacing, m.trailRadius, m.trailLife);
      }
      if (pushOut(world.map.index, e, e.r)) {
        // Charged into a wall or pillar: it staggers for longer, a chance to punish it.
        burst(world, e.x, e.y, '#c9b8a6', 10, 200, { size: 3, life: 0.4 });
        setState(e, 'recover');
        e.stateTime = -cfg.recover * (ENEMIES.brute.bonkStagger - 1);
      } else if (e.stateTime >= cfg.chargeTime) {
        setState(e, 'recover');
      }
      break;
    }
    case 'recover':
      if (e.stateTime >= cfg.recover) {
        setState(e, 'move');
        e.attackTimer = cfg.chargeCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
}

function slither(world: World, e: Enemy, dt: number, speed: number, turnRate: number): void {
  const weave = Math.sin(world.time * 1.7 + e.wobble) * (e.nav.direct ? 0.55 : 0.2);
  e.heading = steerOnMap(world.map, e.heading, chaseAngle(world, e) + weave, turnRate * dt, e.x, e.y);
  e.x += Math.cos(e.heading) * speed * dt;
  e.y += Math.sin(e.heading) * speed * dt;
}

function updateSnakeBody(e: Enemy, count: number): void {
  if (!e.trail) return;
  e.trail.record(e.x, e.y);
  e.trail.sample(e.x, e.y, count, e.segSpacing, e.segments);
  e.trail.trim((count + 4) * e.segSpacing);
}

/** Whether a Salamander's cone of flame reaches the serpent's head (stone blocks it). */
export function flameReaches(world: World, e: Enemy): boolean {
  const cfg = ENEMIES.salamander;
  const s = world.snake;
  if (dist(e.x, e.y, s.x, s.y) > cfg.flameRange + SNAKE.hitRadius) return false;
  if (Math.abs(angleDiff(e.heading, Math.atan2(s.y - e.y, s.x - e.x))) > cfg.flameAngle) return false;
  return clearPath(world.map.index, e.x, e.y, s.x, s.y, 4);
}

/** Rival serpents coil, then lunge; a Salamander instead breathes a short cone of flame. */
function updateRival(world: World, e: Enemy, dt: number): void {
  const flame = e.kind === 'salamander';
  const cfg = flame ? ENEMIES.salamander : ENEMIES.rival;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  switch (e.state) {
    case 'move': {
      slither(world, e, dt, e.speed, cfg.turnRate);
      e.attackTimer -= dt;
      const facing = Math.abs(angleDiff(e.heading, Math.atan2(s.y - e.y, s.x - e.x)));
      const range = flame ? ENEMIES.salamander.flameRange + 40 : ENEMIES.rival.lungeRange;
      if (e.attackTimer <= 0 && d < range && facing < 0.9 && e.nav.direct && canAttack(world, e)) {
        e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup': {
      // Coils up, slowly turning to face the locked direction. The salamander keeps tracking a little longer.
      if (flame && e.stateTime < cfg.telegraph * 0.5) e.aim = Math.atan2(s.y - e.y, s.x - e.x);
      e.heading = steerOnMap(world.map, e.heading, e.aim, 5 * dt, e.x, e.y);
      e.x += Math.cos(e.heading) * e.speed * 0.25 * dt;
      e.y += Math.sin(e.heading) * e.speed * 0.25 * dt;
      if (e.stateTime >= cfg.telegraph) {
        e.heading = e.aim;
        setState(e, 'attack');
        world.sfx(flame ? 'flame' : 'charge');
      }
      break;
    }
    case 'attack':
      if (flame) {
        const f = ENEMIES.salamander;
        e.x += Math.cos(e.heading) * e.speed * 0.15 * dt;
        e.y += Math.sin(e.heading) * e.speed * 0.15 * dt;
        if (flameReaches(world, e)) hurtPlayer(world, f.flameDamage * e.damageMult, { kind: 'salamander', attack: 'flame' });
        const a = e.heading + (world.rng() - 0.5) * 2 * f.flameAngle;
        const r = e.r + world.rng() * f.flameRange;
        burst(world, e.x + Math.cos(a) * r, e.y + Math.sin(a) * r, world.rng() < 0.5 ? '#ff8a3c' : '#ffd36b', 1, 50, { size: 3.5, life: 0.3 });
        if (e.stateTime >= f.flameTime) setState(e, 'recover');
      } else {
        e.x += Math.cos(e.heading) * ENEMIES.rival.lungeSpeed * dt;
        e.y += Math.sin(e.heading) * ENEMIES.rival.lungeSpeed * dt;
        if (e.stateTime >= ENEMIES.rival.lungeTime) setState(e, 'recover');
      }
      break;
    case 'recover':
      slither(world, e, dt, e.speed * 0.5, cfg.turnRate);
      if (e.stateTime >= 0.6) {
        setState(e, 'move');
        e.attackTimer = (flame ? ENEMIES.salamander.flameCooldown : ENEMIES.rival.lungeCooldown) * (0.8 + world.rng() * 0.4);
      }
      break;
  }
  if (bounceOffSolids(world.map.index, e, e.r, 0.4) && e.state === 'attack') setState(e, 'recover');
  updateSnakeBody(e, cfg.segments);
}

/** Pyrecoil's meteor rain: circles marked around where the serpent is heading, landing one after another. */
function rainMeteors(world: World, e: Enemy): void {
  const n = METEORS.count + (e.enraged ? 2 : 0);
  const aim = predictHead(world, METEORS.lead);
  const b = world.map.bounds;
  for (let i = 0; i < n; i++) {
    const a = world.rng() * TAU;
    const r = i === 0 ? 0 : METEORS.spread * Math.sqrt(world.rng());
    spawnBlast(world, {
      x: clamp(aim.x + Math.cos(a) * r, b.minX + 20, b.maxX - 20),
      y: clamp(aim.y + Math.sin(a) * r, b.minY + 20, b.maxY - 20),
      r: METEORS.radius,
      delay: METEORS.delay + i * METEORS.stagger,
      damage: METEORS.damage * e.damageMult,
      hitsFoes: false,
      source: { kind: sourceKind(e), attack: 'meteor' },
      after: { r: METEORS.burnRadius, life: METEORS.burnTime },
      look: 'meteor',
      from: null,
    });
  }
}

/** How long a boss winds up each move. */
export function bossTelegraph(e: Enemy): number {
  const cfg = ENEMIES.boss;
  switch (e.bossMove) {
    case 'volley':
    case 'spores':
    case 'icicles':
      return cfg.volleyTelegraph;
    case 'charge':
    case 'burrow':
      return cfg.chargeTelegraph;
    default:
      return cfg.summonTelegraph;
  }
}

/** The angles a boss's fan of spores or icicles will fly along, set when it starts winding up. */
export function bossFan(e: Enemy): number[] {
  if (e.bossMove === 'icicles') {
    const c = BOSS_MOVES.icicles;
    const n = e.enraged ? c.countEnraged : c.count;
    return Array.from({ length: n }, (_, i) => e.aim + (i - (n - 1) / 2) * c.step);
  }
  if (e.bossMove === 'spores') {
    const c = BOSS_MOVES.spores;
    const n = e.enraged ? c.countEnraged : c.count;
    return Array.from({ length: n }, (_, i) => e.aim + (i / (n - 1) - 0.5) * c.arc);
  }
  return [];
}

/** Sporemaw's slow fan of spores, or Rimecoil's fast icicles down the lines it drew. */
function fireFan(world: World, e: Enemy): void {
  const icy = e.bossMove === 'icicles';
  const c = icy ? BOSS_MOVES.icicles : BOSS_MOVES.spores;
  const source = { kind: sourceKind(e), attack: icy ? 'icicle' : 'spore' } as const;
  for (const a of bossFan(e)) {
    fireShot(world, source, e.x + Math.cos(a) * (e.r + 6), e.y + Math.sin(a) * (e.r + 6), a, c.speed, c.damage * e.damageMult, c.radius, icy ? 'icicle' : 'spore', icy ? 6 : BOSS_MOVES.spores.life);
  }
  world.sfx(icy ? 'icicle' : 'spores');
}

/** Rimecoil lays rings of ice round the serpent: turns get wide just where it wants to charge. */
function layIceRings(world: World, e: Enemy): void {
  const c = BOSS_MOVES.iceRing;
  const s = world.snake;
  const b = world.map.bounds;
  for (const R of c.rings) {
    const n = Math.round((TAU * R) / (c.patch * 2.4));
    const off = world.rng() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      const x = clamp(s.x + Math.cos(a) * R, b.minX, b.maxX);
      const y = clamp(s.y + Math.sin(a) * R, b.minY, b.maxY);
      addGroundFx(world, x, y, c.patch, c.life * (e.enraged ? 1.4 : 1), 'ice');
    }
  }
}

/** Every map's boss: Ouroboros's body and slither, with its own run of moves (see BOSSES). */
function updateBoss(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.boss;
  const boss = BOSSES[e.bossId];
  const s = world.snake;
  if (!e.enraged && e.hp < e.maxHp * cfg.enragedAt) {
    e.enraged = true;
    e.speed *= 1.2;
    world.banner = { text: `${boss.short} is enraged!`, sub: boss.enraged, t: 0, max: 2.2, color: '#ff7a8f' };
    world.sfx('bossWarn');
  }
  const pace = e.enraged ? 0.7 : 1;
  switch (e.state) {
    case 'move': {
      slither(world, e, dt, e.speed, cfg.turnRate);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && canAttack(world, e)) {
        e.bossMove = boss.moves[e.moveIndex++ % boss.moves.length];
        e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup': {
      const tele = bossTelegraph(e);
      if (e.bossMove === 'charge' || e.bossMove === 'burrow') {
        // Track the player for most of the telegraph, then lock in.
        if (e.stateTime < tele * 0.6) e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        e.heading = steerOnMap(world.map, e.heading, e.aim, 4 * dt, e.x, e.y);
      } else {
        slither(world, e, dt, e.speed * 0.35, cfg.turnRate);
      }
      if (e.stateTime >= tele) {
        if (e.bossMove === 'volley') {
          const n = e.enraged ? cfg.volleyCountEnraged : cfg.volleyCount;
          const off = world.rng() * TAU;
          const source: HurtSource = { kind: sourceKind(e), attack: 'volley' };
          for (let i = 0; i < n; i++) {
            fireShot(world, source, e.x, e.y, off + (i / n) * TAU, cfg.volleySpeed, cfg.volleyDamage * e.damageMult, 9);
          }
          const aimAt = Math.atan2(s.y - e.y, s.x - e.x);
          const spreadCount = e.enraged ? 5 : 3;
          for (let i = 0; i < spreadCount; i++) {
            const a = aimAt + (i - (spreadCount - 1) / 2) * 0.18;
            fireShot(world, source, e.x, e.y, a, cfg.volleySpeed * 1.35, cfg.volleyDamage * e.damageMult, 9);
          }
          world.sfx('enemyShot');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        } else if (e.bossMove === 'charge') {
          e.heading = e.aim;
          e.trailAcc = 0;
          setState(e, 'attack');
          world.sfx('charge');
        } else if (e.bossMove === 'burrow') {
          // Under the floor along the lane, erupting at its end.
          e.heading = e.aim;
          const reach = cfg.chargeSpeed * cfg.chargeTime;
          const goal = surfaceSpot(world, { x: e.x + Math.cos(e.aim) * reach, y: e.y + Math.sin(e.aim) * reach }, e.r + 10);
          e.goal = goal;
          e.hidden = true;
          spawnBlast(world, {
            x: goal.x,
            y: goal.y,
            r: BOSS_MOVES.burrow.radius,
            delay: cfg.chargeTime,
            damage: BOSS_MOVES.burrow.damage * e.damageMult,
            hitsFoes: false,
            source: { kind: sourceKind(e), attack: 'erupt' },
            after: null,
            look: 'burrow',
            from: { x: e.x, y: e.y },
          });
          setState(e, 'attack');
          world.sfx('burrow');
        } else if (e.bossMove === 'spores' || e.bossMove === 'icicles') {
          fireFan(world, e);
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        } else if (e.bossMove === 'iceRing') {
          layIceRings(world, e);
          world.sfx('icicle');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        } else if (e.bossMove === 'meteors') {
          rainMeteors(world, e);
          world.sfx('bossWarn');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        } else {
          const count = cfg.summonCount + (e.enraged ? 2 : 0);
          const [kind, extra] = boss.summon;
          openSpotsAround(world, e.x, e.y, 110, count).forEach((p, i) => openPortal(world, e.enraged && i % 2 === 0 ? extra : kind, p.x, p.y));
          world.sfx('portal');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        }
      }
      break;
    }
    case 'attack':
      if (e.hidden) {
        // Burrowing: arrives at the marked spot as its circle fills.
        const goal = e.goal ?? { x: e.x, y: e.y };
        const left = Math.max(dt, cfg.chargeTime - (e.stateTime - dt));
        const d = dist(e.x, e.y, goal.x, goal.y);
        const step = Math.min(d, (d / left) * dt);
        if (d > 0) {
          e.x += ((goal.x - e.x) / d) * step;
          e.y += ((goal.y - e.y) / d) * step;
        }
        if (e.stateTime >= cfg.chargeTime) {
          e.x = goal.x;
          e.y = goal.y;
          e.hidden = false;
          e.goal = null;
          setState(e, 'recover');
        }
        break;
      }
      e.x += Math.cos(e.heading) * cfg.chargeSpeed * dt;
      e.y += Math.sin(e.heading) * cfg.chargeSpeed * dt;
      if (boss.fireTrail) {
        const f = HAZARDS.fireTrail;
        leaveTrail(world, e, cfg.chargeSpeed * dt, 'fire', f.spacing, f.radius, f.life * (e.enraged ? 1.6 : 1));
      }
      if (e.stateTime >= cfg.chargeTime) setState(e, 'recover');
      break;
    case 'recover':
      slither(world, e, dt, e.speed * 0.5, cfg.turnRate);
      if (e.stateTime >= 0.8) {
        setState(e, 'move');
        e.attackTimer = cfg.slitherTime * pace;
      }
      break;
  }
  if (!e.hidden && bounceOffSolids(world.map.index, e, e.r, 0.5) && e.state === 'attack') {
    burst(world, e.x, e.y, '#c9b8a6', 18, 260, { size: 3.5, life: 0.5 });
    setState(e, 'recover');
  }
  updateSnakeBody(e, cfg.segments);
}

export function updateEnemies(world: World, dt: number): void {
  const list = world.enemies;
  const s = world.snake;
  const index = world.map.index;
  const b = world.map.bounds;
  world.flow.timer -= dt;
  if (world.flow.timer <= 0) {
    world.flow.timer = NAV.refresh;
    refreshFlowField(world.flow, s.x, s.y);
  }
  const farAway = NAV.farViews * Math.hypot(world.camera.viewW, world.camera.viewH);
  for (const e of list) {
    if (e.dead) continue;
    updateNav(world, e);
    e.nav.far = dist(e.x, e.y, s.x, s.y) > farAway ? e.nav.far + dt : 0;
    relocateStragglers(world, e);
    e.flash = Math.max(0, e.flash - dt);
    // Each enemy runs on its own clock: frost slows it, swift elites and curses speed it up.
    const edt = dt * enemyTimeScale(world, e, dt);
    e.stateTime += edt;
    switch (ARCHETYPE[e.kind]) {
      case 'chaser':
        if (e.kind === 'imp') updateImp(world, e, edt);
        else if (e.kind === 'burrowViper') updateViper(world, e, edt);
        else if (e.kind === 'wraith') updateWraith(world, e, edt);
        else updateChaser(world, e, edt);
        break;
      case 'caster':
        updateCaster(world, e, edt);
        break;
      case 'brute':
        if (e.kind === 'golem') updateGolem(world, e, edt);
        else updateBrute(world, e, edt);
        break;
      case 'rival':
        updateRival(world, e, edt);
        break;
      case 'boss':
        updateBoss(world, e, edt);
        break;
    }
    // Knockback
    e.x += e.kx * dt;
    e.y += e.ky * dt;
    const k = Math.exp(-9 * dt);
    e.kx *= k;
    e.ky *= k;
    // Nothing ends up inside a solid, however hard it was knocked: except a Wraith, which drifts
    // through stone, and anything under the floor.
    const phasing = e.kind === 'wraith' || e.hidden;
    if (!phasing && pushOut(index, e, e.r)) {
      e.kx *= 0.5;
      e.ky *= 0.5;
    }
    // Reliquaries are solid to foes too (but they never break them).
    if (!phasing) pushOutOfBreakables(world, e, e.r);
    e.x = clamp(e.x, b.minX + e.r, b.maxX - e.r);
    e.y = clamp(e.y, b.minY + e.r, b.maxY - e.r);
    burnFoe(world, e, dt);
  }

  // Soft separation so groups spread out and stay readable.
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead || a.kind === 'boss' || a.hidden) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead || b.kind === 'boss' || b.hidden) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = (a.r + b.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        const aw = a.state === 'attack' ? 0 : 1;
        const bw = b.state === 'attack' ? 0 : 1;
        a.x -= dx * push * aw;
        a.y -= dy * push * aw;
        b.x += dx * push * bw;
        b.y += dy * push * bw;
      }
    }
  }

  for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
}
