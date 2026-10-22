import { ASPECTS, BUFFS, DUOS, EFFECTS, EVOLUTIONS, HIT_STOP, SNAKE, SPELLS, type SpellId } from './config';
import { damageBreakable, eachBreakableNear } from './breakables';
import { damageEnemy, enemyDistance, enemyHitTest } from './combat';
import { addShake, burst, floater, hitStop } from './effects';
import type { SigilKind } from './gesture';
import { angleDiff, clamp, dist, dist2, TAU, type Vec } from './math';
import { COLORS } from './palette';
import { castRay, clearanceAt, pushOut } from './terrain';
import { zeroSlow } from './ultimates';
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
    if (world.duos.includes('blizzard')) placeFrost(world, s.x, s.y, 1);
    if (world.evolved.nova) world.echoes.push({ at: world.time + EVOLUTIONS.nova.echoDelay, spell: 'nova', aim, target, power });
  } else if (id === 'ward') castWard(world, power);
  else castFrost(world, target, power);
}

/** Cooldowns recover (faster under Quickening), and the HUD's cast and refusal flashes fade. */
export function tickCooldowns(world: World, dt: number): void {
  const recover = dt * (world.buffs.quickening > 0 ? BUFFS.quickening.cooldownRate : 1);
  for (const id of Object.keys(world.cooldowns) as SpellId[]) {
    world.cooldowns[id] = Math.max(0, world.cooldowns[id] - recover);
    world.castFlash[id] = Math.max(0, world.castFlash[id] - dt * 3);
    world.denyFlash[id] = Math.max(0, world.denyFlash[id] - dt * 3);
  }
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

export function spawnBolt(
  world: World,
  x: number,
  y: number,
  a: number,
  damage: number,
  pierce: number,
  r: number,
  opts: { seek?: boolean; bounces?: number; life?: number } = {},
): void {
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
    life: opts.life ?? cfg.life,
    hit: [],
    seek: opts.seek ?? false,
    bounces: opts.bounces ?? 0,
  });
}

function castBolt(world: World, aim: number, power: number): void {
  const s = world.snake;
  const cfg = SPELLS.bolt;
  const n = world.stats.boltCount;
  const r = cfg.radius + world.upgrades.potency * 0.7 + world.upgrades.pierce * 0.5;
  const aspect = world.aspects.bolt;
  const opts = {
    seek: aspect === 'seeker',
    bounces: aspect === 'ricochet' ? 1 : 0,
    life: cfg.life * (aspect === 'seeker' ? ASPECTS.seeker.range : 1),
  };
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * cfg.spread;
    spawnBolt(world, s.x + Math.cos(a) * 26, s.y + Math.sin(a) * 26, a, cfg.damage * world.stats.damageMult * power, world.stats.boltPierce, r, opts);
  }
  burst(world, s.x + Math.cos(aim) * 18, s.y + Math.sin(aim) * 18, COLORS.bolt, 8, 220, {
    dir: aim,
    spread: 0.9,
    size: 2.5,
    life: 0.25,
  });
  world.sfx('bolt');
}

/** The nearest living foe to (x, y) within `range`, skipping those in `skip`. */
export function nearestFoe(world: World, x: number, y: number, range: number, skip: { has(id: number): boolean } | null = null): Enemy | null {
  let best: Enemy | null = null;
  let bestD = range * range;
  for (const e of world.enemies) {
    if (e.dead || e.hidden || e.pile > 0 || skip?.has(e.id)) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

/** Slowed by a Frost Field or Rimeshot, or frozen solid. */
export function isChilled(world: World, e: Enemy): boolean {
  return e.chill > 0 || e.frozen > 0 || e.chillUntil > world.time;
}

/** A bolt or lance striking a foe, with the duos riding on it: Rimeshot chills, Stormlance arcs. */
export function boltHit(world: World, e: Enemy, damage: number, kx: number, ky: number, hx = e.x, hy = e.y): void {
  const rime = world.duos.includes('rimeshot');
  if (rime && isChilled(world, e)) damage *= DUOS.rimeshot.damage;
  damageEnemy(world, e, damage, 'bolt', COLORS.bolt, kx, ky, hx, hy);
  if (rime && !e.dead) e.chillUntil = world.time + DUOS.rimeshot.chill;
  if (world.duos.includes('stormlance') && world.rng() < DUOS.stormlance.chance) {
    arcFrom(world, e, DUOS.stormlance.jumps, SPELLS.lightning.damage * world.stats.damageMult * DUOS.stormlance.damage);
  }
}

/** Lightning striking a foe: Shatterstorm doubles it on chilled foes, Overload shocks them. */
function lightningHit(world: World, e: Enemy, damage: number, kx = 0, ky = 0): void {
  if (world.duos.includes('shatterstorm') && isChilled(world, e)) damage *= DUOS.shatterstorm.damage;
  damageEnemy(world, e, damage, 'lightning', COLORS.lightning, kx, ky);
  if (world.aspects.lightning === 'overload' && !e.dead) e.shockUntil = world.time + ASPECTS.overload.time;
}

/** A small arc of lightning from a foe to the `jumps` nearest others (Stormlance). */
function arcFrom(world: World, from: Enemy, jumps: number, damage: number): void {
  const struck = new Set<number>([from.id]);
  const points: Vec[] = [{ x: from.x, y: from.y }];
  let at: Vec = from;
  for (let i = 0; i < jumps; i++) {
    const next = nearestFoe(world, at.x, at.y, SPELLS.lightning.chainRange, struck);
    if (!next) break;
    struck.add(next.id);
    points.push({ x: next.x, y: next.y });
    lightningHit(world, next, damage);
    at = next;
  }
  if (points.length > 1) world.arcs.push({ points, life: 0.26, maxLife: 0.26, seed: world.rng() * 1000, fizzle: false });
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
  const reach = evo.beamLength * (world.aspects.bolt === 'seeker' ? ASPECTS.seeker.range : 1);
  const hit = new Set<number>();
  let struck = 0;
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * SPELLS.bolt.spread;
    const x0 = s.x + Math.cos(a) * 22;
    const y0 = s.y + Math.sin(a) * 22;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    // The beam stops at the first wall or pillar in its way.
    const len = castRay(world.map.index, x0, y0, x0 + c * reach, y0 + sn * reach, 4);
    const x1 = x0 + c * len;
    const y1 = y0 + sn * len;
    let last: Enemy | null = null;
    let lastT = -1;
    for (const e of world.enemies) {
      if (e.dead || e.hidden || hit.has(e.id)) continue;
      let d = segmentDistance(e.x, e.y, x0, y0, x1, y1) - e.r;
      for (const seg of e.segments) d = Math.min(d, segmentDistance(seg.x, seg.y, x0, y0, x1, y1) - e.segRadius);
      if (d <= evo.beamWidth / 2) {
        hit.add(e.id);
        struck++;
        const along = (e.x - x0) * c + (e.y - y0) * sn;
        if (along > lastT) {
          lastT = along;
          last = e;
        }
        boltHit(world, e, damage, c * 160, sn * 160);
      }
    }
    // Ricochet: the beam bounces once from the farthest foe it struck.
    if (world.aspects.bolt === 'ricochet' && last) {
      const next = nearestFoe(world, last.x, last.y, ASPECTS.ricochet.range, hit);
      if (next) {
        hit.add(next.id);
        struck++;
        world.beams.push({ x0: last.x, y0: last.y, x1: next.x, y1: next.y, width: evo.beamWidth * 0.6, life: 0.28, maxLife: 0.28 });
        const d = dist(last.x, last.y, next.x, next.y) || 1;
        boltHit(world, next, damage * ASPECTS.ricochet.damage, ((next.x - last.x) / d) * 160, ((next.y - last.y) / d) * 160);
      }
    }
    for (let k = world.breakables.length - 1; k >= 0; k--) {
      const b = world.breakables[k];
      if (segmentDistance(b.x, b.y, x0, y0, x1, y1) - b.r <= evo.beamWidth / 2) damageBreakable(world, b, damage);
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
      if (e.dead || e.hidden) continue;
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
  const conductor = world.aspects.lightning === 'conductor';
  const falloff = conductor ? 1 : cfg.falloff;
  const chainRange = cfg.chainRange * (conductor ? ASPECTS.conductor.chainRange : 1);
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
    lightningHit(world, current, damage, (kx / kl) * 120, (ky / kl) * 120);
    if (jumps >= maxJumps) break;
    jumps++;
    damage *= falloff;
    let next: Enemy | null = null;
    let bestD = chainRange * chainRange;
    const from = points[points.length - 1];
    for (const e of world.enemies) {
      if (e.dead || e.hidden || struck.has(e.id)) continue;
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
  const aspect = world.aspects.nova;
  if (aspect === 'implosion') damageScale *= ASPECTS.implosion.damage;
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
    knock: aspect === 'implosion' ? -ASPECTS.implosion.pull : aspect === 'shockwave' ? ASPECTS.shockwave.knockback : 1,
    stun: aspect === 'shockwave' ? ASPECTS.shockwave.stun : 0,
    strikes: world.duos.includes('thunderclap') ? DUOS.thunderclap.strikes : 0,
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
    if (e.dead || e.hidden || dist(s.x, s.y, e.x, e.y) > cfg.pulseRadius + e.r) continue;
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
  if (damaging) eachBreakableNear(world, s.x, s.y, cfg.pulseRadius, (b) => damageBreakable(world, b, cfg.pulseDamage * world.stats.damageMult * power));
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
  if (world.aspects.ward === 'sanctuary') world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp * ASPECTS.sanctuary.heal);
  wardPulse(world, false);
  addShake(world, 0.12);
  world.sfx('ward');
}

/** Health regained each second: Shed Skin, plus Sanctuary while the Ward is up. */
export function regenPerSecond(world: World): number {
  return world.stats.regenPerSec + (world.ward && world.aspects.ward === 'sanctuary' ? ASPECTS.sanctuary.regen : 0);
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
    if (world.duos.includes('bulwark')) castNova(world, 1, w.power);
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
  const aimed = target && dist(s.x, s.y, target.x, target.y) >= SNAKE.aimMinDistance;
  const ahead = SPELLS.frost.placeAhead;
  placeFrost(world, aimed ? target.x : s.x + Math.cos(s.heading) * ahead, aimed ? target.y : s.y + Math.sin(s.heading) * ahead, power);
  world.sfx('frost');
}

/** Lays a Frost Field centred near (x, y): from the sigil, or under a Nova with Blizzard. */
function placeFrost(world: World, x: number, y: number, power: number): void {
  const cfg = SPELLS.frost;
  const perma = world.aspects.frost === 'permafrost';
  const r = world.stats.frostRadius * (1 + (power - 1) * 0.5) * (perma ? ASPECTS.permafrost.radius : 1);
  const b = world.map.bounds;
  const at = {
    x: clamp(x, b.minX + r * 0.3, b.maxX - r * 0.3),
    y: clamp(y, b.minY + r * 0.3, b.maxY - r * 0.3),
  };
  // It may spread over a pillar, but its centre lands on open floor.
  if (clearanceAt(world.map.index, at.x, at.y) < 0) pushOut(world.map.index, at, 1);
  const field = {
    id: ++world.frostCounter,
    x: at.x,
    y: at.y,
    radius: r,
    t: 0,
    duration: cfg.duration * (perma ? ASPECTS.permafrost.duration : 1),
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
}

/** The Frost Field an enemy (or point) stands in, if any. */
export function frostAt(world: World, x: number, y: number, pad = 0): World['frostFields'][number] | null {
  for (const f of world.frostFields) if (dist2(x, y, f.x, f.y) <= (f.radius + pad) ** 2) return f;
  return null;
}

export function updateFrost(world: World, dt: number): void {
  const cfg = SPELLS.frost;
  // Shatter: foes that died in a field last step burst against their neighbours.
  for (const sh of world.shatters.splice(0)) {
    for (const e of world.enemies) {
      if (!e.dead && !e.hidden && enemyDistance(e, sh.x, sh.y) <= ASPECTS.shatter.radius) damageEnemy(world, e, sh.damage, 'frost', COLORS.frostCore);
    }
    burst(world, sh.x, sh.y, COLORS.frostCore, 14, 220, { kind: 'shard', size: 3, life: 0.4 });
  }
  for (let i = world.frostFields.length - 1; i >= 0; i--) {
    const f = world.frostFields[i];
    f.t += dt;
    f.tick -= dt;
    if (f.tick <= 0) {
      f.tick += cfg.tick;
      for (const e of world.enemies) {
        if (!e.dead && !e.hidden && enemyDistance(e, f.x, f.y) <= f.radius) damageEnemy(world, e, f.damage, 'frost', COLORS.frost);
      }
      eachBreakableNear(world, f.x, f.y, f.radius, (b) => damageBreakable(world, b, f.damage));
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
  let scale = world.effects.enemyTimeScale * (e.elite === 'swift' ? ELITE_SWIFT_SCALE : 1) * zeroSlow(world, e);
  const field = frostAt(world, e.x, e.y, e.r * 0.5);
  // Rimeshot's chill slows a foe as a field would.
  const chilled = field !== null || e.chillUntil > world.time;
  e.chill = chilled ? 1 : 0;
  if (chilled) scale *= e.kind === 'boss' ? Math.max(0.7, world.stats.frostSlow) : world.stats.frostSlow;
  if (field) {
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
    if (b.seek) steerBolt(world, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let remove = b.life <= 0;
    if (clearanceAt(world.map.index, b.x, b.y) < b.r * 0.5) {
      burst(world, b.x, b.y, COLORS.bolt, 6, 160, { size: 2.5, life: 0.25 });
      remove = true;
    }
    if (!remove) {
      // Urns shatter as a bolt passes without using it up; a reliquary takes the hit like a foe.
      eachBreakableNear(world, b.x, b.y, b.r, (k) => {
        if (remove || b.hit.includes(k.id)) return;
        b.hit.push(k.id);
        damageBreakable(world, k, b.damage);
        if (k.size === 'large' && --b.pierce < 0) remove = true;
      });
    }
    if (!remove) {
      for (const e of world.enemies) {
        if (e.dead || e.hidden || b.hit.includes(e.id)) continue;
        // Generous hitbox for friendly projectiles.
        if (enemyHitTest(e, b.x, b.y, b.r + 5)) {
          b.hit.push(e.id);
          const sp = Math.hypot(b.vx, b.vy) || 1;
          boltHit(world, e, b.damage, (b.vx / sp) * 160, (b.vy / sp) * 160, b.x, b.y);
          b.pierce--;
          if (b.pierce < 0) {
            // Ricochet: a spent bolt bounces on to the nearest foe it hasn't hit.
            if (b.bounces > 0 && bounceBolt(world, b)) break;
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

/** Seeker: turns a bolt toward the nearest foe roughly ahead of it. */
function steerBolt(world: World, b: World['bolts'][number], dt: number): void {
  const cfg = ASPECTS.seeker;
  const a = Math.atan2(b.vy, b.vx);
  let best: Enemy | null = null;
  let bestD = cfg.sight * cfg.sight;
  for (const e of world.enemies) {
    if (e.dead || e.hidden || e.pile > 0 || b.hit.includes(e.id)) continue;
    const d = dist2(b.x, b.y, e.x, e.y);
    if (d < bestD && Math.abs(angleDiff(a, Math.atan2(e.y - b.y, e.x - b.x))) < 1.2) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return;
  const turn = clamp(angleDiff(a, Math.atan2(best.y - b.y, best.x - b.x)), -cfg.turn * dt, cfg.turn * dt);
  const sp = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(a + turn) * sp;
  b.vy = Math.sin(a + turn) * sp;
}

/** Ricochet: sends a spent bolt on toward the nearest foe it hasn't hit, weaker. False if none is near. */
function bounceBolt(world: World, b: World['bolts'][number]): boolean {
  const next = nearestFoe(world, b.x, b.y, ASPECTS.ricochet.range, new Set(b.hit));
  if (!next) return false;
  const a = Math.atan2(next.y - b.y, next.x - b.x);
  const sp = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(a) * sp;
  b.vy = Math.sin(a) * sp;
  b.damage *= ASPECTS.ricochet.damage;
  b.bounces--;
  b.pierce = 0;
  b.life = Math.max(b.life, 0.5);
  return true;
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
        if (e.dead || e.hidden || e.lastNovaId === n.id) continue;
        if (enemyDistance(e, n.x, n.y) <= n.radius) {
          e.lastNovaId = n.id;
          const d = dist(n.x, n.y, e.x, e.y) || 1;
          const kb = SPELLS.nova.knockback * n.knock;
          damageEnemy(world, e, n.damage, 'nova', COLORS.nova, ((e.x - n.x) / d) * kb, ((e.y - n.y) / d) * kb);
          if (n.stun > 0 && e.kind !== 'boss' && !e.dead) e.stunned = Math.max(e.stunned, n.stun);
          if (n.strikes > 0 && !e.dead) {
            // Thunderclap: the ring calls lightning down on the first few foes it reaches.
            n.strikes--;
            world.arcs.push({ points: [{ x: n.x, y: n.y }, { x: e.x, y: e.y }], life: 0.26, maxLife: 0.26, seed: world.rng() * 1000, fizzle: false });
            lightningHit(world, e, SPELLS.lightning.damage * world.stats.damageMult);
          }
          if (++n.hits === HIT_STOP.bigNova) hitStop(world, HIT_STOP.bigSpell);
          // Supernova heals a little per foe hit.
          if (n.heal > 0 && n.hits <= EVOLUTIONS.nova.maxHeal && world.hp > 0) {
            world.hp = Math.min(world.stats.maxHp, world.hp + n.heal);
          }
        }
      }
      eachBreakableNear(world, n.x, n.y, n.radius, (b) => {
        if (b.lastNovaId === n.id) return;
        b.lastNovaId = n.id;
        damageBreakable(world, b, n.damage);
      });
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
