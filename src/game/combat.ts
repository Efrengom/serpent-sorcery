import { DEPTH, ELITE, ENEMIES, EVOLUTIONS, HIT_STOP, PROGRESSION, SNAKE, SPELLS } from './config';
import { addShake, burst, floater, hitStop } from './effects';
import { spawnEnemy } from './enemies';
import { clamp, dist2, TAU } from './math';
import { COLORS } from './palette';
import { hurtKey, type DamageSource, type HurtSource } from './recap';
import { frostAt } from './spells';
import { clearanceAt, pushOut } from './terrain';
import type { Crystal, Enemy, World } from './world';

/** Circle test against an enemy's head and (for snakes) body segments. */
export function enemyHitTest(e: Enemy, x: number, y: number, r: number): boolean {
  const rr = e.r + r;
  if (dist2(e.x, e.y, x, y) <= rr * rr) return true;
  if (e.segments.length > 0) {
    const sr = e.segRadius + r;
    const sr2 = sr * sr;
    for (const s of e.segments) if (dist2(s.x, s.y, x, y) <= sr2) return true;
  }
  return false;
}

/** Closest distance from a point to the enemy's head or any body segment (edge to centre). */
export function enemyDistance(e: Enemy, x: number, y: number): number {
  let best = Math.sqrt(dist2(e.x, e.y, x, y)) - e.r;
  for (const s of e.segments) {
    const d = Math.sqrt(dist2(s.x, s.y, x, y)) - e.segRadius;
    if (d < best) best = d;
  }
  return best;
}

export function damageEnemy(
  world: World,
  e: Enemy,
  amount: number,
  spell: DamageSource,
  color: string,
  knockX = 0,
  knockY = 0,
  hitX = e.x,
  hitY = e.y,
): void {
  if (e.dead) return;
  if (e.kind === 'brute' && e.state === 'recover') amount *= ENEMIES.brute.stunnedVulnerability;
  // Glacier: frozen-field foes are brittle.
  if (world.evolved.frost && e.chill > 0) amount *= EVOLUTIONS.frost.brittle;
  const stats = world.recap.spells[spell];
  if (e.shield > 0) {
    // A shielded elite's barrier soaks damage (and knockback) until it breaks.
    const soaked = Math.min(e.shield, amount);
    e.shield -= soaked;
    amount -= soaked;
    stats.damage += soaked;
    e.flash = 0.08;
    burst(world, hitX, hitY, COLORS.eliteShield, 4, 160, { kind: 'glow', size: 3, life: 0.25 });
    if (e.shield <= 0) {
      burst(world, e.x, e.y, COLORS.eliteShield, 18, 260, { kind: 'shard', size: 3, life: 0.5 });
      floater(world, e.x, e.y - e.r - 10, 'Shield broken', COLORS.eliteShield, { size: 14, life: 0.8 });
    }
    world.sfx('shieldHit');
    if (amount <= 0) return;
  }
  stats.damage += Math.min(amount, Math.max(0, e.hp));
  if (e.hp > 0 && e.hp - amount <= 0) stats.kills++;
  e.hp -= amount;
  e.flash = 0.12;
  const knockScale = e.kind === 'boss' ? 0.05 : e.kind === 'brute' ? 0.4 : e.kind === 'rival' ? 0.3 : 1;
  e.kx += knockX * knockScale;
  e.ky += knockY * knockScale;
  burst(world, hitX, hitY, color, 5, 180, { size: 2.5, life: 0.3 });
  floater(world, hitX + (world.rng() - 0.5) * 12, hitY - e.r, String(Math.round(amount)), '#ffffff', {
    size: 13,
    life: 0.55,
    vy: -70,
    damageNumber: true,
  });
  world.sfx('hit');
  if (e.hp <= 0) killEnemy(world, e);
}

export function killEnemy(world: World, e: Enemy): void {
  if (e.dead) return;
  e.dead = true;
  world.kills++;
  const isBoss = e.kind === 'boss';
  const bodyColor =
    e.kind === 'chaser' ? '#ff4f7b' : e.kind === 'caster' ? '#ff6ad5' : e.kind === 'brute' ? '#ffb070' : '#ff3d5e';
  burst(world, e.x, e.y, bodyColor, isBoss ? 60 : 14, isBoss ? 420 : 240, { size: isBoss ? 5 : 3.5, life: 0.6 });
  burst(world, e.x, e.y, '#ffffff', isBoss ? 20 : 4, 160, { kind: 'glow', size: isBoss ? 14 : 7, life: 0.35 });
  for (const s of e.segments) burst(world, s.x, s.y, bodyColor, 3, 160, { size: 3, life: 0.5 });
  dropCrystals(world, e.x, e.y, e.xp, isBoss ? 30 : 0);
  if (e.elite) world.recap.elitesSlain++;
  if (e.elite === 'splitting') splitEnemy(world, e);
  if (isBoss) {
    world.bossKills++;
    world.boss = null;
    descend(world);
    addShake(world, 0.8);
    hitStop(world, HIT_STOP.bossKill, true);
    world.slowMo = HIT_STOP.bossSlowMo;
    world.sfx('bossDie');
  } else {
    const heavy = e.kind === 'brute' || e.kind === 'rival';
    addShake(world, heavy ? 0.12 : 0.04);
    if (heavy) hitStop(world, HIT_STOP.heavyKill);
    world.sfx('kill');
  }
}

/**
 * Defeating the boss opens the next depth: the arena turns into the Ember Depths after the
 * first, and every depth is harder with more elites (see enemies.ts).
 */
function descend(world: World): void {
  world.depth++;
  world.recap.depth = Math.max(world.recap.depth, world.depth);
  const firstTime = world.area === 0;
  world.area = Math.min(DEPTH.areas - 1, world.depth - 1);
  world.banner = firstTime
    ? { text: 'The Archmage falls!', sub: `The floor cracks open: Depth ${world.depth}, the Ember Depths`, t: 0, max: 3.6, color: COLORS.nova }
    : { text: 'The Archmage falls!', sub: `Deeper still: Depth ${world.depth}`, t: 0, max: 3.4, color: COLORS.nova };
  world.sfx('descend');
}

/** A splitting elite bursts into two smaller copies of itself. */
function splitEnemy(world: World, e: Enemy): void {
  const b = world.map.bounds;
  for (const side of [-1, 1]) {
    const a = e.heading + (side * Math.PI) / 2;
    const at = { x: clamp(e.x + Math.cos(a) * e.r, b.minX + 20, b.maxX - 20), y: clamp(e.y + Math.sin(a) * e.r, b.minY + 20, b.maxY - 20) };
    pushOut(world.map.index, at, e.r * ELITE.fragmentScale);
    const f = spawnEnemy(world, e.kind, at.x, at.y);
    f.fragment = true;
    f.r = e.r * ELITE.fragmentScale;
    f.maxHp = f.hp = (e.maxHp / ELITE.hpMult) * ELITE.fragmentHp;
    f.xp = Math.max(1, Math.round(e.xp / ELITE.xpMult / 2));
    f.kx = Math.cos(a) * 260;
    f.ky = Math.sin(a) * 260;
  }
  burst(world, e.x, e.y, COLORS.eliteSplit, 16, 240, { kind: 'glow', size: 4, life: 0.4 });
  world.sfx('split');
}

export function dropCrystals(world: World, x: number, y: number, totalXp: number, minPieces = 0): void {
  let remaining = totalXp;
  const pieces = Math.max(minPieces, Math.ceil(totalXp / 5));
  const each = Math.max(1, Math.round(totalXp / pieces));
  while (remaining > 0) {
    const value = Math.min(each, remaining);
    remaining -= value;
    const a = world.rng() * TAU;
    const s = pieces > 1 ? 60 + world.rng() * (minPieces > 0 ? 260 : 90) : 0;
    spawnCrystal(world, { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, value, magnet: false, t: world.rng() * 10 });
  }
}

function spawnCrystal(world: World, c: Crystal): void {
  if (world.crystals.length < PROGRESSION.maxCrystals) {
    world.crystals.push(c);
    return;
  }
  // At the cap, fold the value into the nearest existing crystal so no XP is lost.
  let best = world.crystals[0];
  let bestD = Infinity;
  for (const o of world.crystals) {
    const d = dist2(o.x, o.y, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  best.value += c.value;
}

export function hurtPlayer(world: World, amount: number, source: HurtSource): boolean {
  if (world.invuln > 0 || world.hp <= 0) return false;
  const ward = world.ward;
  if (ward && ward.charges > 0 && source.kind !== 'wall') {
    // Arcane Ward absorbs the hit; its pulse goes off on the next step (spells.updateWard).
    ward.charges--;
    ward.pulses++;
    ward.flash = 1;
    world.invuln = SPELLS.ward.absorbInvuln;
    world.recap.blocked++;
    addShake(world, 0.2);
    floater(world, world.snake.x, world.snake.y - 30, 'Blocked', COLORS.ward, { size: 18, life: 0.7 });
    world.sfx('wardHit');
    return false;
  }
  const dmg = Math.max(1, Math.round(amount));
  const key = hurtKey(source);
  world.recap.taken[key] = (world.recap.taken[key] ?? 0) + Math.min(dmg, world.hp);
  world.hp = Math.max(0, world.hp - dmg);
  if (world.hp <= 0) world.recap.killedBy = key;
  world.invuln = SNAKE.invulnTime;
  world.hurtFlash = 1;
  addShake(world, 0.45);
  hitStop(world, HIT_STOP.hurt, true);
  const s = world.snake;
  burst(world, s.x, s.y, COLORS.hurt, 16, 260, { size: 3.5, life: 0.45 });
  floater(world, s.x, s.y - 26, `-${dmg}`, COLORS.hurt, { size: 20, life: 0.8 });
  world.sfx('hurt');
  return true;
}

export function gainXp(world: World, amount: number): void {
  world.xp += amount * world.stats.xpMult;
}

export function updateCrystals(world: World, dt: number): void {
  const s = world.snake;
  const pickR = world.stats.pickupRadius;
  const pick2 = pickR * pickR;
  const eat = SNAKE.headRadius + PROGRESSION.pickupRadiusOnHead;
  const eat2 = eat * eat;
  const list = world.crystals;
  const b = world.map.bounds;
  world.pickupPitchTimer -= dt;
  if (world.pickupPitchTimer <= 0) world.pickupPitch = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    c.t += dt;
    const d2 = dist2(c.x, c.y, s.x, s.y);
    if (!c.magnet && d2 < pick2) c.magnet = true;
    if (c.magnet) {
      const d = Math.sqrt(d2) || 1;
      const tx = ((s.x - c.x) / d) * PROGRESSION.crystalMagnetSpeed;
      const ty = ((s.y - c.y) / d) * PROGRESSION.crystalMagnetSpeed;
      const k = 1 - Math.exp(-8 * dt);
      c.vx += (tx - c.vx) * k;
      c.vy += (ty - c.vy) * k;
    } else {
      const damp = Math.exp(-4 * dt);
      c.vx *= damp;
      c.vy *= damp;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    // Loose crystals never come to rest inside a solid; magnetized ones fly over everything.
    if (!c.magnet && Math.abs(c.vx) + Math.abs(c.vy) > 1 && pushOut(world.map.index, c, 6)) {
      c.vx *= 0.3;
      c.vy *= 0.3;
    }
    c.x = Math.max(b.minX + 6, Math.min(b.maxX - 6, c.x));
    c.y = Math.max(b.minY + 6, Math.min(b.maxY - 6, c.y));
    if (dist2(c.x, c.y, s.x, s.y) < eat2) {
      gainXp(world, c.value);
      burst(world, c.x, c.y, c.value >= 5 ? COLORS.xpBig : COLORS.xp, 3, 90, { kind: 'glow', size: 5, life: 0.25 });
      world.pickupPitch = Math.min(world.pickupPitch + 1, 14);
      world.pickupPitchTimer = 0.5;
      world.sfx('pickup');
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}

export function updateShots(world: World, dt: number): void {
  const s = world.snake;
  const list = world.shots;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    // Hostile shots crawl through Frost Fields.
    const slow = frostAt(world, p.x, p.y) ? SPELLS.frost.shotSlow : 1;
    p.x += p.vx * dt * slow;
    p.y += p.vy * dt * slow;
    p.life -= dt;
    p.spin += dt * 6;
    let remove = p.life <= 0;
    // Walls, pillars and every other solid stop hostile shots: cover works.
    if (clearanceAt(world.map.index, p.x, p.y) < p.r * 0.5) {
      burst(world, p.x, p.y, COLORS.hostile, 5, 120, { size: 2.5, life: 0.25 });
      remove = true;
    } else {
      const rr = SNAKE.hitRadius + p.r * 0.75;
      if (dist2(p.x, p.y, s.x, s.y) < rr * rr) {
        const source: HurtSource = { kind: p.source, attack: p.source === 'boss' ? 'volley' : 'shot' };
        if (hurtPlayer(world, p.damage, source) || world.invuln > 0) {
          burst(world, p.x, p.y, COLORS.hostile, 8, 160, { size: 3, life: 0.3 });
          remove = true;
        }
      }
    }
    if (remove) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}

export function contactDamage(e: Enemy): number {
  if (e.state === 'attack') {
    if (e.kind === 'brute') return ENEMIES.brute.chargeDamage * e.damageMult;
    if (e.kind === 'boss') return ENEMIES.boss.chargeDamage * e.damageMult;
    if (e.kind === 'rival') return e.contact * 1.4;
  }
  return e.contact;
}

function contactSource(e: Enemy): HurtSource {
  if (e.state === 'attack' && (e.kind === 'brute' || e.kind === 'boss')) return { kind: e.kind, attack: 'charge' };
  if (e.state === 'attack' && e.kind === 'rival') return { kind: e.kind, attack: 'lunge' };
  return { kind: e.kind, attack: 'bite' };
}

/** Enemy heads biting the player's head. Body segments are harmless ("only heads bite"). */
export function updateContacts(world: World): void {
  const s = world.snake;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const rr = SNAKE.hitRadius + e.r * 0.8;
    if (dist2(e.x, e.y, s.x, s.y) < rr * rr) {
      if (hurtPlayer(world, contactDamage(e), contactSource(e))) {
        const d = Math.sqrt(dist2(e.x, e.y, s.x, s.y)) || 1;
        const push = e.kind === 'boss' ? 0 : 260;
        e.kx += ((e.x - s.x) / d) * push;
        e.ky += ((e.y - s.y) / d) * push;
      }
    }
  }
}
