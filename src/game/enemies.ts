import { DEPTH, DIRECTOR, EFFECTS, ELITE, ENEMIES, type EnemyKind } from './config';
import { burst } from './effects';
import { angleDiff, clamp, dist, TAU } from './math';
import { COLORS } from './palette';
import { bounceOffWalls, PathTrail, PLAY_AREA, steer } from './snake';
import { enemyTimeScale } from './spells';
import type { BossMove, EliteKind, Enemy, World } from './world';

// ---------------------------------------------------------------- Scaling

export function difficulty(t: number, depth = 1) {
  const d = depth - 1;
  return {
    hp: (1 + t * DIRECTOR.hpLinear + (t / DIRECTOR.hpQuadDivisor) ** 2) * (1 + DEPTH.hpPerDepth * d),
    damage: (1 + t * DIRECTOR.damagePerSec) * (1 + DEPTH.damagePerDepth * d),
    speed: 1 + Math.min(DIRECTOR.maxSpeedBonus, t * DIRECTOR.speedPerSec),
  };
}

export function spawnRate(t: number, depth = 1): number {
  return (DIRECTOR.rateBase + DIRECTOR.rateLinear * t + DIRECTOR.rateQuad * t * t) * (1 + DEPTH.spawnPerDepth * (depth - 1));
}

export function aliveCap(t: number, depth = 1): number {
  return Math.floor(
    Math.min(
      DIRECTOR.capMax + DEPTH.capPerDepth * (depth - 1),
      DIRECTOR.capBase + DIRECTOR.capPerSec * t + DEPTH.capPerDepth * (depth - 1),
      DIRECTOR.earlyCapBase + DIRECTOR.earlyCapPerSec * t,
    ),
  );
}

/** Chance that a new spawn is elite: none in depth 1 unless cursed, then rising each depth. */
export function eliteChance(depth: number, cursed: boolean): number {
  const base = depth >= 2 ? ELITE.baseChance + ELITE.chancePerDepth * (depth - 2) : cursed ? ELITE.cursedChance : 0;
  return Math.min(ELITE.maxChance, base + (cursed && depth >= 2 ? ELITE.cursedBonus : 0));
}

const ELITE_KINDS: EliteKind[] = ['shielded', 'swift', 'splitting'];

/** Makes a fresh enemy elite: tougher, bigger, worth more, with one modifier. */
function makeElite(world: World, e: Enemy): void {
  // Snakes can't split cleanly; everything else can roll any modifier.
  const kinds = e.kind === 'rival' ? ELITE_KINDS.filter((k) => k !== 'splitting') : ELITE_KINDS;
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

export function kindWeights(t: number): [EnemyKind, number][] {
  return [
    ['chaser', 1],
    ['caster', t >= DIRECTOR.casterStart ? DIRECTOR.casterWeight * Math.max(0.25, ramp(t, DIRECTOR.casterStart, DIRECTOR.casterRamp)) : 0],
    ['brute', t >= DIRECTOR.bruteStart ? DIRECTOR.bruteWeight * Math.max(0.3, ramp(t, DIRECTOR.bruteStart, DIRECTOR.bruteRamp)) : 0],
    ['rival', t >= DIRECTOR.rivalStart ? DIRECTOR.rivalWeight * Math.max(0.4, ramp(t, DIRECTOR.rivalStart, DIRECTOR.rivalRamp)) : 0],
  ];
}

// ---------------------------------------------------------------- Spawning

export function spawnEnemy(world: World, kind: EnemyKind, x: number, y: number, canBeElite = false): Enemy {
  const t = world.time;
  const diff = difficulty(t, world.depth);
  const base = ENEMIES[kind];
  const s = world.snake;
  const heading = Math.atan2(s.y - y, s.x - x);
  let hp = base.hp * diff.hp;
  if (kind === 'boss') hp = ENEMIES.boss.hp * (1 + ENEMIES.boss.hpPerIndex * (world.bossIndex - 1)) * (1 + t / 900);
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
    attackTimer: kind === 'caster' ? ENEMIES.caster.firstShotDelay : kind === 'brute' ? 1.5 : kind === 'rival' ? 2.0 : 0,
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
  };
  if (canBeElite && kind !== 'boss' && world.rng() < eliteChance(world.depth, world.effects.elitesFromStart)) makeElite(world, e);
  if (kind === 'rival' || kind === 'boss') {
    const cfg = kind === 'rival' ? ENEMIES.rival : ENEMIES.boss;
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

function pickSpawnPoint(world: World): { x: number; y: number } {
  const s = world.snake;
  const pad = 50;
  let best = { x: PLAY_AREA.minX + pad, y: PLAY_AREA.minY + pad };
  let bestD = -1;
  for (let i = 0; i < 14; i++) {
    const x = PLAY_AREA.minX + pad + world.rng() * (PLAY_AREA.maxX - PLAY_AREA.minX - 2 * pad);
    const y = PLAY_AREA.minY + pad + world.rng() * (PLAY_AREA.maxY - PLAY_AREA.minY - 2 * pad);
    // Avoid spawning right where the snake is heading.
    const ahead = { x: s.x + Math.cos(s.heading) * 160, y: s.y + Math.sin(s.heading) * 160 };
    const d = Math.min(dist(x, y, s.x, s.y), dist(x, y, ahead.x, ahead.y) + 60);
    if (d >= DIRECTOR.minSpawnDistance) return { x, y };
    if (d > bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

function chooseKind(world: World): EnemyKind {
  const t = world.time;
  const weights = kindWeights(t);
  const rivals = world.enemies.filter((e) => e.kind === 'rival' && !e.dead).length +
    world.portals.filter((p) => p.kind === 'rival').length;
  const rivalCap = t >= DIRECTOR.rivalStart ? 1 + Math.floor((t - DIRECTOR.rivalStart) / DIRECTOR.rivalCapInterval) : 0;
  let total = 0;
  for (const [k, w] of weights) if (k !== 'rival' || rivals < rivalCap) total += w;
  let roll = world.rng() * total;
  for (const [k, w] of weights) {
    if (k === 'rival' && rivals >= rivalCap) continue;
    roll -= w;
    if (roll <= 0) return k;
  }
  return 'chaser';
}

export function updateDirector(world: World, dt: number): void {
  const t = world.time;
  if (t < DIRECTOR.firstSpawn) return;

  // Boss schedule: warning banner, then a large portal.
  if (!world.bossWarned && t >= world.nextBossTime - DIRECTOR.bossWarning) {
    world.bossWarned = true;
    world.banner = {
      text: 'A rival Archmage approaches!',
      sub: 'Ouroboros slithers out of the ruins',
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
      const s = world.snake;
      const x = s.x < 700 ? PLAY_AREA.maxX - 200 : PLAY_AREA.minX + 200;
      openPortal(world, 'boss', x, 400, 2.0);
    }
  }

  const bossAlive = world.boss !== null || world.portals.some((p) => p.kind === 'boss');
  const rate = spawnRate(t, world.depth) * world.effects.spawnRateMult * (bossAlive ? DIRECTOR.bossSpawnRateMult : 1);
  world.spawnAcc += rate * dt;
  const alive = world.enemies.length + world.portals.length;
  const cap = Math.floor(aliveCap(t, world.depth) * world.effects.capMult);
  while (world.spawnAcc >= 1) {
    world.spawnAcc -= 1;
    if (alive >= cap) {
      world.spawnAcc = Math.min(world.spawnAcc, 1);
      break;
    }
    const p = pickSpawnPoint(world);
    openPortal(world, chooseKind(world), p.x, p.y);
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
        world.banner = { text: 'Archmage Ouroboros', sub: 'Only its head can bite — strike anywhere', t: 0, max: 2.6, color: '#ff7a8f' };
      }
    }
  }
}

// ---------------------------------------------------------------- AI

function fireShot(
  world: World,
  source: EnemyKind,
  x: number,
  y: number,
  angle: number,
  speed: number,
  damage: number,
  r: number,
): void {
  if (world.shots.length >= EFFECTS.maxEnemyShots) return;
  world.shots.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, damage, life: 6, spin: 0, source });
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

function updateChaser(world: World, e: Enemy, dt: number): void {
  const s = world.snake;
  const base = Math.atan2(s.y - e.y, s.x - e.x);
  const wob = Math.sin(world.time * 2.2 + e.wobble) * 0.45;
  moveToward(e, base + wob, e.speed, dt);
}

function updateCaster(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.caster;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  const toward = Math.atan2(s.y - e.y, s.x - e.x);
  let radial = 0;
  if (d > cfg.preferredRange + 50) radial = 1;
  else if (d < cfg.preferredRange - 60) radial = -1;
  const side = e.id % 2 === 0 ? 1 : -1;
  const mx = Math.cos(toward) * radial + Math.cos(toward + (side * Math.PI) / 2) * 0.55;
  const my = Math.sin(toward) * radial + Math.sin(toward + (side * Math.PI) / 2) * 0.55;
  const ml = Math.hypot(mx, my) || 1;
  const slow = e.state === 'windup' ? 0.3 : 1;
  e.x += (mx / ml) * e.speed * slow * dt;
  e.y += (my / ml) * e.speed * slow * dt;
  e.heading = toward;

  if (e.state === 'move') {
    e.attackTimer -= dt;
    if (e.attackTimer <= 0 && d < 680) {
      setState(e, 'windup');
      world.sfx('telegraph');
    }
  } else if (e.state === 'windup') {
    const p = predictHead(world, (d / cfg.shotSpeed) * cfg.lead);
    e.aim = Math.atan2(p.y - e.y, p.x - e.x);
    if (e.stateTime >= cfg.telegraph) {
      const ox = e.x + Math.cos(e.aim) * (e.r + 6);
      const oy = e.y + Math.sin(e.aim) * (e.r + 6);
      fireShot(world, 'caster', ox, oy, e.aim, cfg.shotSpeed, cfg.shotDamage * e.damageMult, cfg.shotRadius);
      world.sfx('enemyShot');
      setState(e, 'move');
      e.attackTimer = Math.max(1.4, (cfg.fireInterval * (0.85 + world.rng() * 0.3)) / (1 + world.time / 600));
    }
  }
}

function updateBrute(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.brute;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  switch (e.state) {
    case 'move': {
      moveToward(e, Math.atan2(s.y - e.y, s.x - e.x), e.speed, dt);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0 && d < cfg.chargeRange) {
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
      const hitWall =
        e.x - e.r <= PLAY_AREA.minX || e.x + e.r >= PLAY_AREA.maxX || e.y - e.r <= PLAY_AREA.minY || e.y + e.r >= PLAY_AREA.maxY;
      if (hitWall) burst(world, e.x, e.y, '#c9b8a6', 10, 200, { size: 3, life: 0.4 });
      if (e.stateTime >= cfg.chargeTime || hitWall) setState(e, 'recover');
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
  const s = world.snake;
  const target = Math.atan2(s.y - e.y, s.x - e.x) + Math.sin(world.time * 1.7 + e.wobble) * 0.55;
  e.heading = steer(e.heading, target, turnRate * dt, e.x, e.y, 700, 400);
  e.x += Math.cos(e.heading) * speed * dt;
  e.y += Math.sin(e.heading) * speed * dt;
}

function updateSnakeBody(e: Enemy, count: number): void {
  if (!e.trail) return;
  e.trail.record(e.x, e.y);
  e.trail.sample(e.x, e.y, count, e.segSpacing, e.segments);
  e.trail.trim((count + 4) * e.segSpacing);
}

function updateRival(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.rival;
  const s = world.snake;
  const d = dist(e.x, e.y, s.x, s.y);
  switch (e.state) {
    case 'move': {
      slither(world, e, dt, e.speed, cfg.turnRate);
      e.attackTimer -= dt;
      const facing = Math.abs(angleDiff(e.heading, Math.atan2(s.y - e.y, s.x - e.x)));
      if (e.attackTimer <= 0 && d < cfg.lungeRange && facing < 0.9) {
        e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup': {
      // Coils up, slowly turning to face the locked lunge direction.
      e.heading = steer(e.heading, e.aim, 5 * dt, e.x, e.y, 700, 400);
      e.x += Math.cos(e.heading) * e.speed * 0.25 * dt;
      e.y += Math.sin(e.heading) * e.speed * 0.25 * dt;
      if (e.stateTime >= cfg.telegraph) {
        e.heading = e.aim;
        setState(e, 'attack');
        world.sfx('charge');
      }
      break;
    }
    case 'attack':
      e.x += Math.cos(e.heading) * cfg.lungeSpeed * dt;
      e.y += Math.sin(e.heading) * cfg.lungeSpeed * dt;
      if (e.stateTime >= cfg.lungeTime) setState(e, 'recover');
      break;
    case 'recover':
      slither(world, e, dt, e.speed * 0.5, cfg.turnRate);
      if (e.stateTime >= 0.6) {
        setState(e, 'move');
        e.attackTimer = cfg.lungeCooldown * (0.8 + world.rng() * 0.4);
      }
      break;
  }
  if (bounceOffWalls(e, e.r, 0.4) && e.state === 'attack') setState(e, 'recover');
  updateSnakeBody(e, cfg.segments);
}

const BOSS_SEQUENCE: BossMove[] = ['volley', 'charge', 'summon', 'volley', 'charge'];

function updateBoss(world: World, e: Enemy, dt: number): void {
  const cfg = ENEMIES.boss;
  const s = world.snake;
  if (!e.enraged && e.hp < e.maxHp * cfg.enragedAt) {
    e.enraged = true;
    e.speed *= 1.2;
    world.banner = { text: 'Ouroboros is enraged!', sub: 'Faster volleys, wider rings', t: 0, max: 2.2, color: '#ff7a8f' };
    world.sfx('bossWarn');
  }
  const pace = e.enraged ? 0.7 : 1;
  switch (e.state) {
    case 'move': {
      slither(world, e, dt, e.speed, cfg.turnRate);
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        e.bossMove = BOSS_SEQUENCE[e.moveIndex++ % BOSS_SEQUENCE.length];
        e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        setState(e, 'windup');
        world.sfx('telegraph');
      }
      break;
    }
    case 'windup': {
      const tele =
        e.bossMove === 'volley' ? cfg.volleyTelegraph : e.bossMove === 'charge' ? cfg.chargeTelegraph : cfg.summonTelegraph;
      if (e.bossMove === 'charge') {
        // Track the player for most of the telegraph, then lock in.
        if (e.stateTime < tele * 0.6) e.aim = Math.atan2(s.y - e.y, s.x - e.x);
        e.heading = steer(e.heading, e.aim, 4 * dt, e.x, e.y, 700, 400);
      } else {
        slither(world, e, dt, e.speed * 0.35, cfg.turnRate);
      }
      if (e.stateTime >= tele) {
        if (e.bossMove === 'volley') {
          const n = e.enraged ? cfg.volleyCountEnraged : cfg.volleyCount;
          const off = world.rng() * TAU;
          for (let i = 0; i < n; i++) {
            fireShot(world, 'boss', e.x, e.y, off + (i / n) * TAU, cfg.volleySpeed, cfg.volleyDamage * e.damageMult, 9);
          }
          const aimAt = Math.atan2(s.y - e.y, s.x - e.x);
          const spreadCount = e.enraged ? 5 : 3;
          for (let i = 0; i < spreadCount; i++) {
            const a = aimAt + (i - (spreadCount - 1) / 2) * 0.18;
            fireShot(world, 'boss', e.x, e.y, a, cfg.volleySpeed * 1.35, cfg.volleyDamage * e.damageMult, 9);
          }
          world.sfx('enemyShot');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        } else if (e.bossMove === 'charge') {
          e.heading = e.aim;
          setState(e, 'attack');
          world.sfx('charge');
        } else {
          const count = cfg.summonCount + (e.enraged ? 2 : 0);
          for (let i = 0; i < count; i++) {
            const a = (i / count) * TAU + world.rng();
            const x = clamp(e.x + Math.cos(a) * 110, PLAY_AREA.minX + 40, PLAY_AREA.maxX - 40);
            const y = clamp(e.y + Math.sin(a) * 110, PLAY_AREA.minY + 40, PLAY_AREA.maxY - 40);
            openPortal(world, e.enraged && i % 2 === 0 ? 'caster' : 'chaser', x, y);
          }
          world.sfx('portal');
          setState(e, 'move');
          e.attackTimer = cfg.slitherTime * pace;
        }
      }
      break;
    }
    case 'attack':
      e.x += Math.cos(e.heading) * cfg.chargeSpeed * dt;
      e.y += Math.sin(e.heading) * cfg.chargeSpeed * dt;
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
  if (bounceOffWalls(e, e.r, 0.5) && e.state === 'attack') {
    burst(world, e.x, e.y, '#c9b8a6', 18, 260, { size: 3.5, life: 0.5 });
    setState(e, 'recover');
  }
  updateSnakeBody(e, cfg.segments);
}

export function updateEnemies(world: World, dt: number): void {
  const list = world.enemies;
  for (const e of list) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    // Each enemy runs on its own clock: frost slows it, swift elites and curses speed it up.
    const edt = dt * enemyTimeScale(world, e, dt);
    e.stateTime += edt;
    switch (e.kind) {
      case 'chaser':
        updateChaser(world, e, edt);
        break;
      case 'caster':
        updateCaster(world, e, edt);
        break;
      case 'brute':
        updateBrute(world, e, edt);
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
    e.x = clamp(e.x, PLAY_AREA.minX + e.r, PLAY_AREA.maxX - e.r);
    e.y = clamp(e.y, PLAY_AREA.minY + e.r, PLAY_AREA.maxY - e.r);
  }

  // Soft separation so groups spread out and stay readable.
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead || a.kind === 'boss') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead || b.kind === 'boss') continue;
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
