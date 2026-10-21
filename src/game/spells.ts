import { EFFECTS, HIT_STOP, SNAKE, SPELLS, type SpellId } from './config';
import { damageEnemy, enemyDistance, enemyHitTest } from './combat';
import { addShake, burst, hitStop } from './effects';
import type { SigilKind } from './gesture';
import { angleDiff, dist, dist2, TAU, type Vec } from './math';
import { COLORS } from './palette';
import { PLAY_AREA } from './snake';
import type { Enemy, World } from './world';

export const SIGIL_TO_SPELL: Record<SigilKind, SpellId> = {
  line: 'bolt',
  vee: 'lightning',
  circle: 'nova',
};

export const SPELL_COLORS: Record<SpellId, string> = {
  bolt: COLORS.bolt,
  lightning: COLORS.lightning,
  nova: COLORS.nova,
};

/**
 * Direction from the head toward the recorded target. Falls back to the current
 * heading when the target is missing or too close to the head to define a direction.
 */
export function aimAngle(head: { x: number; y: number; heading: number }, target: Vec | null): number {
  if (!target) return head.heading;
  if (dist(head.x, head.y, target.x, target.y) < SNAKE.aimMinDistance) return head.heading;
  return Math.atan2(target.y - head.y, target.x - head.x);
}

export function castSpell(world: World, id: SpellId, target: Vec | null): void {
  const s = world.snake;
  const aim = aimAngle(s, target);
  world.recap.spells[id].casts++;
  if (id === 'bolt') castBolt(world, aim);
  else if (id === 'lightning') castLightning(world, aim, target);
  else castNova(world);
}

function castBolt(world: World, aim: number): void {
  const s = world.snake;
  const cfg = SPELLS.bolt;
  const n = world.stats.boltCount;
  const r = cfg.radius + world.upgrades.potency * 0.7 + world.upgrades.pierce * 0.5;
  for (let i = 0; i < n; i++) {
    if (world.bolts.length >= EFFECTS.maxBolts) break;
    const a = aim + (i - (n - 1) / 2) * cfg.spread;
    world.bolts.push({
      x: s.x + Math.cos(a) * 26,
      y: s.y + Math.sin(a) * 26,
      vx: Math.cos(a) * cfg.speed,
      vy: Math.sin(a) * cfg.speed,
      r,
      damage: cfg.damage * world.stats.damageMult,
      pierce: world.stats.boltPierce,
      life: cfg.life,
      hit: [],
    });
  }
  burst(world, s.x + Math.cos(aim) * 18, s.y + Math.sin(aim) * 18, COLORS.bolt, 8, 220, {
    dir: aim,
    spread: 0.9,
    size: 2.5,
    life: 0.25,
  });
  world.sfx('bolt');
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

function castLightning(world: World, aim: number, target: Vec | null): void {
  const s = world.snake;
  const cfg = SPELLS.lightning;
  const first = lightningTarget(world, aim, target);
  const points: Vec[] = [{ x: s.x, y: s.y }];
  if (!first) {
    const reach = target ? Math.min(cfg.range, dist(s.x, s.y, target.x, target.y)) : 260;
    const ex = Math.max(PLAY_AREA.minX, Math.min(PLAY_AREA.maxX, s.x + Math.cos(aim) * Math.max(120, reach)));
    const ey = Math.max(PLAY_AREA.minY, Math.min(PLAY_AREA.maxY, s.y + Math.sin(aim) * Math.max(120, reach)));
    points.push({ x: ex, y: ey });
    burst(world, ex, ey, COLORS.lightning, 10, 200, { size: 2.5, life: 0.3 });
    world.arcs.push({ points, life: 0.3, maxLife: 0.3, seed: world.rng() * 1000, fizzle: true });
    world.sfx('lightning');
    return;
  }
  const struck = new Set<number>();
  let current: Enemy | null = first;
  let damage = cfg.damage * world.stats.damageMult;
  let jumps = 0;
  while (current) {
    struck.add(current.id);
    points.push({ x: current.x, y: current.y });
    const kx = current.x - points[points.length - 2].x;
    const ky = current.y - points[points.length - 2].y;
    const kl = Math.hypot(kx, ky) || 1;
    burst(world, current.x, current.y, COLORS.lightningCore, 6, 200, { kind: 'glow', size: 6, life: 0.25 });
    damageEnemy(world, current, damage, 'lightning', COLORS.lightning, (kx / kl) * 120, (ky / kl) * 120);
    if (jumps >= world.stats.chains) break;
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

function castNova(world: World): void {
  const s = world.snake;
  const cfg = SPELLS.nova;
  world.novas.push({
    id: ++world.novaCounter,
    x: s.x,
    y: s.y,
    radius: 0,
    maxRadius: world.stats.novaRadius,
    damage: cfg.damage * world.stats.damageMult * world.stats.novaDamageMult,
    t: 0,
    duration: cfg.expandTime,
    hits: 0,
  });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    burst(world, s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 20, COLORS.nova, 1, 380, {
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

export function updateBolts(world: World, dt: number): void {
  const list = world.bolts;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let remove = b.life <= 0;
    if (b.x < PLAY_AREA.minX || b.x > PLAY_AREA.maxX || b.y < PLAY_AREA.minY || b.y > PLAY_AREA.maxY) {
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
