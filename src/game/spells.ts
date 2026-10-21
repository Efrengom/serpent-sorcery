import { EFFECTS, EVOLUTIONS, HIT_STOP, SNAKE, SPELLS, type SpellId } from './config';
import { damageEnemy, enemyDistance, enemyHitTest } from './combat';
import { addShake, burst, floater, hitStop } from './effects';
import type { SigilKind } from './gesture';
import { angleDiff, clamp, dist, dist2, TAU, type Vec } from './math';
import { COLORS } from './palette';
import { castRay, clearanceAt, pushOut } from './terrain';
import type { Enemy, World } from './world';

export const SIGIL_TO_SPELL: Record<SigilKind, SpellId> = {
  line: 'bolt',
  vee: 'lightning',
  circle: 'nova',
  triangle: 'ward',
  zigzag: 'frost',
};

export const SPELL_COLORS: Record<SpellId, string> = {
  bolt: COLORS.bolt,
  lightning: COLORS.lightning,
  nova: COLORS.nova,
  ward: COLORS.ward,
  frost: COLORS.frost,
};

/** The spell's current name: its evolved name once it has evolved. */
export function spellName(world: World, id: SpellId): string {
  return world.evolved[id] ? EVOLUTIONS[id].name : SPELLS[id].name;
}

/**
 * Direction from the head toward the recorded target. Falls back to the current
 * heading when the target is missing or too close to the head to define a direction.
 */
export function aimAngle(head: { x: number; y: number; heading: number }, target: Vec | null): number {
  if (!target) return head.heading;
  if (dist(head.x, head.y, target.x, target.y) < SNAKE.aimMinDistance) return head.heading;
  return Math.atan2(target.y - head.y, target.x - head.x);
}

/**
 * Casts a spell. `power` comes from how cleanly the sigil was drawn (see cast.ts): it scales
 * damage, and for the Ward and Frost Field their duration or size too.
 */
export function castSpell(world: World, id: SpellId, target: Vec | null, power = 1): void {
  const s = world.snake;
  const aim = aimAngle(s, target);
  world.recap.spells[id].casts++;
  if (id === 'bolt') {
    if (world.evolved.bolt) castLance(world, aim, power);
    else castBolt(world, aim, power);
  } else if (id === 'lightning') {
    castLightning(world, aim, target, power);
    if (world.evolved.lightning) world.echoes.push({ at: world.time + EVOLUTIONS.lightning.echoDelay, spell: 'lightning', aim, target, power });
  } else if (id === 'nova') {
    castNova(world, 1, power);
    if (world.evolved.nova) world.echoes.push({ at: world.time + EVOLUTIONS.nova.echoDelay, spell: 'nova', aim, target, power });
  } else if (id === 'ward') castWard(world, power);
  else castFrost(world, target, power);
}

/** Fires delayed second strikes from evolved spells once they are due. */
export function updateEchoes(world: World): void {
  for (let i = world.echoes.length - 1; i >= 0; i--) {
    const e = world.echoes[i];
    if (world.time < e.at) continue;
    world.echoes.splice(i, 1);
    if (e.spell === 'lightning') castLightning(world, e.aim, e.target, EVOLUTIONS.lightning.echoDamage * e.power);
    else castNova(world, EVOLUTIONS.nova.echoRadius, EVOLUTIONS.nova.echoDamage * e.power);
  }
}

export function spawnBolt(world: World, x: number, y: number, a: number, damage: number, pierce: number, r: number): void {
  if (world.bolts.length >= EFFECTS.maxBolts) return;
  const cfg = SPELLS.bolt;
  world.bolts.push({
    x,
    y,
    vx: Math.cos(a) * cfg.speed,
    vy: Math.sin(a) * cfg.speed,
    r,
    damage,
    pierce,
    life: cfg.life,
    hit: [],
  });
}

function castBolt(world: World, aim: number, power: number): void {
  const s = world.snake;
  const cfg = SPELLS.bolt;
  const n = world.stats.boltCount;
  const r = cfg.radius + world.upgrades.potency * 0.7 + world.upgrades.pierce * 0.5;
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * cfg.spread;
    spawnBolt(world, s.x + Math.cos(a) * 26, s.y + Math.sin(a) * 26, a, cfg.damage * world.stats.damageMult * power, world.stats.boltPierce, r);
  }
  burst(world, s.x + Math.cos(aim) * 18, s.y + Math.sin(aim) * 18, COLORS.bolt, 8, 220, {
    dir: aim,
    spread: 0.9,
    size: 2.5,
    life: 0.25,
  });
  world.sfx('bolt');
}

/** Distance from a point to the segment a-b. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Arcane Lance: instant beams (one per Split Bolt projectile) that pierce everything in line. */
function castLance(world: World, aim: number, power: number): void {
  const s = world.snake;
  const evo = EVOLUTIONS.bolt;
  const n = world.stats.boltCount;
  const damage = SPELLS.bolt.damage * world.stats.damageMult * evo.damageMult * power;
  const hit = new Set<number>();
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * SPELLS.bolt.spread;
    const x0 = s.x + Math.cos(a) * 22;
    const y0 = s.y + Math.sin(a) * 22;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // The beam stops at the first wall or pillar in its way.
    const len = castRay(world.map.index, x0, y0, x0 + c * evo.beamLength, y0 + sn * evo.beamLength, 4);
    const x1 = x0 + c * len;
    const y1 = y0 + sn * len;
    for (const e of world.enemies) {
      if (e.dead || hit.has(e.id)) continue;
      let d = segmentDistance(e.x, e.y, x0, y0, x1, y1) - e.r;
      for (const seg of e.segments) d = Math.min(d, segmentDistance(seg.x, seg.y, x0, y0, x1, y1) - e.segRadius);
      if (d <= evo.beamWidth / 2) {
        hit.add(e.id);
        struck++;
        damageEnemy(world, e, damage, 'bolt', COLORS.bolt, c * 160, sn * 160);
      }
    }
    world.beams.push({ x0, y0, x1, y1, width: evo.beamWidth, life: 0.28, maxLife: 0.28 });
    burst(world, x1, y1, COLORS.bolt, 6, 160, { size: 2.5, life: 0.3 });
  }
  addShake(world, 0.1);
  if (struck >= HIT_STOP.bigChain) hitStop(world, HIT_STOP.bigSpell);
  world.sfx('lance');
}

export function updateBeams(world: World, dt: number): void {
  for (let i = world.beams.length - 1; i >= 0; i--) {
    world.beams[i].life -= dt;
    if (world.beams[i].life <= 0) world.beams.splice(i, 1);
  }
}

function lightningTarget(world: World, aim: number, target: Vec | null): Enemy | null {
  const s = world.snake;
  const cfg = SPELLS.lightning;
  for (const cone of [cfg.cone, cfg.wideCone]) {
    let best: Enemy | null = null;
    let bestScore = Infinity;
    for (const e of world.enemies) {
      if (e.dead) continue;
      const d = dist(s.x, s.y, e.x, e.y);
      if (d > cfg.range) continue;
      const off = Math.abs(angleDiff(aim, Math.atan2(e.y - s.y, e.x - s.x)));
      const nearTarget = target !== null && enemyDistance(e, target.x, target.y) < cfg.targetSnap;
      if (off > cone && !nearTarget) continue;
      // Prefer enemies near the recorded target, then on-axis, then close.
      const score = (nearTarget ? -1 : 0) + off / cone + (d / cfg.range) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best) return best;
  }
  return null;
}

function castLightning(world: World, aim: number, target: Vec | null, damageScale = 1): void {
  const s = world.snake;
  const cfg = SPELLS.lightning;
  const first = lightningTarget(world, aim, target);
  const points: Vec[] = [{ x: s.x, y: s.y }];
  if (!first) {
    const reach = target ? Math.min(cfg.range, dist(s.x, s.y, target.x, target.y)) : 260;
    const b = world.map.bounds;
    const ex = Math.max(b.minX, Math.min(b.maxX, s.x + Math.cos(aim) * Math.max(120, reach)));
    const ey = Math.max(b.minY, Math.min(b.maxY, s.y + Math.sin(aim) * Math.max(120, reach)));
    points.push({ x: ex, y: ey });
    burst(world, ex, ey, COLORS.lightning, 10, 200, { size: 2.5, life: 0.3 });
    world.arcs.push({ points, life: 0.3, maxLife: 0.3, seed: world.rng() * 1000, fizzle: true });
    world.sfx('lightning');
    return;
  }
  const maxJumps = world.stats.chains + (world.evolved.lightning ? EVOLUTIONS.lightning.extraChains : 0);
  const struck = new Set<number>();
  let current: Enemy | null = first;
  let damage = cfg.damage * world.stats.damageMult * damageScale;
  let jumps = 0;
  while (current) {
    struck.add(current.id);
    points.push({ x: current.x, y: current.y });
    const kx = current.x - points[points.length - 2].x;
    const ky = current.y - points[points.length - 2].y;
    const kl = Math.hypot(kx, ky) || 1;
    burst(world, current.x, current.y, COLORS.lightningCore, 6, 200, { kind: 'glow', size: 6, life: 0.25 });
    damageEnemy(world, current, damage, 'lightning', COLORS.lightning, (kx / kl) * 120, (ky / kl) * 120);
    if (jumps >= maxJumps) break;
    jumps++;
    damage *= cfg.falloff;
    let next: Enemy | null = null;
    let bestD = cfg.chainRange * cfg.chainRange;
    const from = points[points.length - 1];
    for (const e of world.enemies) {
      if (e.dead || struck.has(e.id)) continue;
      const d = dist2(from.x, from.y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        next = e;
      }
    }
    current = next;
  }
  world.arcs.push({ points, life: 0.34, maxLife: 0.34, seed: world.rng() * 1000, fizzle: false });
  addShake(world, 0.12);
  if (struck.size >= HIT_STOP.bigChain) hitStop(world, HIT_STOP.bigSpell);
  world.sfx('lightning');
}

function castNova(world: World, radiusScale: number, damageScale: number): void {
  const s = world.snake;
  const cfg = SPELLS.nova;
  world.novas.push({
    id: ++world.novaCounter,
    x: s.x,
    y: s.y,
    radius: 0,
    maxRadius: world.stats.novaRadius * radiusScale,
    damage: cfg.damage * world.stats.damageMult * world.stats.novaDamageMult * damageScale,
    t: 0,
    duration: cfg.expandTime * Math.sqrt(radiusScale),
    hits: 0,
    heal: world.evolved.nova ? EVOLUTIONS.nova.healPerHit : 0,
  });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    burst(world, s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 20, COLORS.nova, 1, 380 * radiusScale, {
      dir: a,
      spread: 0.1,
      size: 3,
      life: 0.4,
      drag: 4,
    });
  }
  addShake(world, 0.25);
  world.sfx('nova');
}

// ---------------------------------------------------------------- Arcane Ward

/** Shoves nearby foes away from the head; absorbed hits also deal a little damage. */
function wardPulse(world: World, damaging: boolean, power = 1): void {
  const s = world.snake;
  const cfg = SPELLS.ward;
  for (const e of world.enemies) {
    if (e.dead || dist(s.x, s.y, e.x, e.y) > cfg.pulseRadius + e.r) continue;
    const d = dist(s.x, s.y, e.x, e.y) || 1;
    const kx = ((e.x - s.x) / d) * cfg.pulseKnockback;
    const ky = ((e.y - s.y) / d) * cfg.pulseKnockback;
    if (damaging) damageEnemy(world, e, cfg.pulseDamage * world.stats.damageMult * power, 'ward', COLORS.ward, kx, ky);
    else {
      const k = e.kind === 'boss' ? 0.05 : e.kind === 'brute' ? 0.4 : 1;
      e.kx += kx * k;
      e.ky += ky * k;
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    burst(world, s.x + Math.cos(a) * 24, s.y + Math.sin(a) * 24, COLORS.ward, 1, 300, { dir: a, spread: 0.15, size: 2.5, life: 0.35 });
  }
}

function castWard(world: World, power: number): void {
  world.ward = {
    charges: world.stats.wardCharges,
    t: 0,
    duration: (world.stats.wardDuration + (world.evolved.ward ? EVOLUTIONS.ward.extraDuration : 0)) * power,
    pulses: 0,
    flash: 1,
    power,
  };
  wardPulse(world, false);
  addShake(world, 0.12);
  world.sfx('ward');
}

/** Releases pulses for hits the ward absorbed, and ends the ward when spent or expired. */
export function updateWard(world: World, dt: number): void {
  const w = world.ward;
  if (!w) return;
  w.t += dt;
  w.flash = Math.max(0, w.flash - dt * 3);
  while (w.pulses > 0) {
    w.pulses--;
    wardPulse(world, true, w.power);
    if (world.evolved.ward) {
      // Aegis: the blocked blow comes back as a ring of bolts.
      const s = world.snake;
      const n = EVOLUTIONS.ward.bolts;
      const off = world.rng() * TAU;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        spawnBolt(world, s.x + Math.cos(a) * 26, s.y + Math.sin(a) * 26, a, SPELLS.bolt.damage * world.stats.damageMult * 0.8, 1, SPELLS.bolt.radius);
      }
    }
  }
  if (w.charges <= 0 || w.t >= w.duration) {
    const s = world.snake;
    burst(world, s.x, s.y, COLORS.ward, 22, 240, { kind: 'shard', size: 3, life: 0.5 });
    world.ward = null;
  }
}

// ---------------------------------------------------------------- Frost Field

function castFrost(world: World, target: Vec | null, power: number): void {
  const s = world.snake;
  const cfg = SPELLS.frost;
  const r = world.stats.frostRadius * (1 + (power - 1) * 0.5);
  const aimed = target && dist(s.x, s.y, target.x, target.y) >= SNAKE.aimMinDistance;
  const b = world.map.bounds;
  const at = {
    x: clamp(aimed ? target.x : s.x + Math.cos(s.heading) * cfg.placeAhead, b.minX + r * 0.3, b.maxX - r * 0.3),
    y: clamp(aimed ? target.y : s.y + Math.sin(s.heading) * cfg.placeAhead, b.minY + r * 0.3, b.maxY - r * 0.3),
  };
  // It may spread over a pillar, but its centre lands on open floor.
  if (clearanceAt(world.map.index, at.x, at.y) < 0) pushOut(world.map.index, at, 1);
  const field = {
    id: ++world.frostCounter,
    x: at.x,
    y: at.y,
    radius: r,
    t: 0,
    duration: cfg.duration,
    tick: cfg.tick,
    damage: cfg.damagePerSecond * cfg.tick * world.stats.damageMult * world.stats.frostDamageMult * power,
  };
  world.frostFields.push(field);
  for (let i = 0; i < 30; i++) {
    const a = world.rng() * TAU;
    const d = Math.sqrt(world.rng()) * r;
    burst(world, field.x + Math.cos(a) * d, field.y + Math.sin(a) * d, i % 3 === 0 ? COLORS.frostCore : COLORS.frost, 1, 60, {
      kind: 'glow',
      size: 4,
      life: 0.7,
    });
  }
  world.sfx('frost');
}

/** The Frost Field an enemy (or point) stands in, if any. */
export function frostAt(world: World, x: number, y: number, pad = 0): World['frostFields'][number] | null {
  for (const f of world.frostFields) if (dist2(x, y, f.x, f.y) <= (f.radius + pad) ** 2) return f;
  return null;
}

export function updateFrost(world: World, dt: number): void {
  const cfg = SPELLS.frost;
  for (let i = world.frostFields.length - 1; i >= 0; i--) {
    const f = world.frostFields[i];
    f.t += dt;
    f.tick -= dt;
    if (f.tick <= 0) {
      f.tick += cfg.tick;
      for (const e of world.enemies) {
        if (!e.dead && enemyDistance(e, f.x, f.y) <= f.radius) damageEnemy(world, e, f.damage, 'frost', COLORS.frost);
      }
    }
    // Drifting snow.
    if (world.rng() < dt * 14) {
      const a = world.rng() * TAU;
      const d = Math.sqrt(world.rng()) * f.radius;
      burst(world, f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, COLORS.frostCore, 1, 20, { kind: 'glow', size: 3, life: 0.8, drag: 1 });
    }
    if (f.t >= f.duration) world.frostFields.splice(i, 1);
  }
}

/**
 * How fast an enemy's clock runs this step: curses and swift elites speed it up, Frost Fields
 * slow it (bosses resist), and Glacier freezes it solid for a moment.
 */
export function enemyTimeScale(world: World, e: Enemy, dt: number): number {
  let scale = world.effects.enemyTimeScale * (e.elite === 'swift' ? ELITE_SWIFT_SCALE : 1);
  const field = frostAt(world, e.x, e.y, e.r * 0.5);
  e.chill = field ? 1 : 0;
  if (field) {
    scale *= e.kind === 'boss' ? Math.max(0.7, world.stats.frostSlow) : world.stats.frostSlow;
    if (world.evolved.frost && e.kind !== 'boss' && e.frozenBy !== field.id) {
      e.frozenBy = field.id;
      e.frozen = EVOLUTIONS.frost.freezeTime;
      floater(world, e.x, e.y - e.r - 8, 'Frozen', COLORS.frostCore, { size: 13, life: 0.6 });
    }
  }
  if (e.frozen > 0 || e.stunned > 0) {
    // Frozen by Glacier or held by Constrict: the enemy's clock stops.
    e.frozen = Math.max(0, e.frozen - dt);
    e.stunned = Math.max(0, e.stunned - dt);
    return 0;
  }
  return scale;
}

/** Swift elites live on a faster clock: they move, wind up and attack this much quicker. */
export const ELITE_SWIFT_SCALE = 1.45;

// ---------------------------------------------------------------- projectiles

export function updateBolts(world: World, dt: number): void {
  const list = world.bolts;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let remove = b.life <= 0;
    if (clearanceAt(world.map.index, b.x, b.y) < b.r * 0.5) {
      burst(world, b.x, b.y, COLORS.bolt, 6, 160, { size: 2.5, life: 0.25 });
      remove = true;
    }
    if (!remove) {
      for (const e of world.enemies) {
        if (e.dead || b.hit.includes(e.id)) continue;
        // Generous hitbox for friendly projectiles.
        if (enemyHitTest(e, b.x, b.y, b.r + 5)) {
          b.hit.push(e.id);
          const sp = Math.hypot(b.vx, b.vy) || 1;
          damageEnemy(world, e, b.damage, 'bolt', COLORS.bolt, (b.vx / sp) * 160, (b.vy / sp) * 160, b.x, b.y);
          b.pierce--;
          if (b.pierce < 0) {
            remove = true;
            break;
          }
        }
      }
    }
    if (remove) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}

export function updateNovas(world: World, dt: number): void {
  const fade = 0.25;
  for (let i = world.novas.length - 1; i >= 0; i--) {
    const n = world.novas[i];
    n.t += dt;
    const k = Math.min(1, n.t / n.duration);
    n.radius = n.maxRadius * (1 - (1 - k) * (1 - k));
    if (n.t <= n.duration + dt) {
      for (const e of world.enemies) {
        if (e.dead || e.lastNovaId === n.id) continue;
        if (enemyDistance(e, n.x, n.y) <= n.radius) {
          e.lastNovaId = n.id;
          const d = dist(n.x, n.y, e.x, e.y) || 1;
          const kb = SPELLS.nova.knockback;
          damageEnemy(world, e, n.damage, 'nova', COLORS.nova, ((e.x - n.x) / d) * kb, ((e.y - n.y) / d) * kb);
          if (++n.hits === HIT_STOP.bigNova) hitStop(world, HIT_STOP.bigSpell);
          // Supernova heals a little per foe hit.
          if (n.heal > 0 && n.hits <= EVOLUTIONS.nova.maxHeal && world.hp > 0) {
            world.hp = Math.min(world.stats.maxHp, world.hp + n.heal);
          }
        }
      }
      // The shockwave also dispels hostile projectiles it touches.
      const r2 = n.radius * n.radius;
      for (let j = world.shots.length - 1; j >= 0; j--) {
        const p = world.shots[j];
        if (dist2(p.x, p.y, n.x, n.y) <= r2) {
          burst(world, p.x, p.y, COLORS.nova, 3, 100, { kind: 'glow', size: 4, life: 0.2 });
          world.shots[j] = world.shots[world.shots.length - 1];
          world.shots.pop();
        }
      }
    }
    if (n.t >= n.duration + fade) world.novas.splice(i, 1);
  }
}
