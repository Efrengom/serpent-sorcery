import { inView } from './camera';
import { BUFFS, SNAKE, SPELLS, ULTIMATE } from './config';
import { damageEnemy, enemyDistance, enemyHitTest } from './combat';
import { addShake, burst, floater, hitStop } from './effects';
import { dist2, TAU } from './math';
import type { Enemy, World } from './world';
import type { WizardId } from './wizards';

/**
 * Ultimates (U1-U5): one per wizard, cast with its own key, on a long cooldown, and far stronger
 * than any sigil. Each scales with spell damage, and non-boss foes also lose a share of their own
 * max health, so an ultimate stays decisive however deep the run goes.
 */

export type UltimateId = 'starfall' | 'absoluteZero' | 'bastion' | 'maelstrom';

export const ULTIMATES = {
  starfall: {
    wizard: 'arcanist',
    name: 'Starfall',
    description: 'For 3 s, 36 stars fall on foes in view (elites and the boss first), each bursting for heavy damage.',
    color: '#ffd45e',
    cooldown: 75,
    duration: 3,
    stars: 36,
    /** Seconds a star takes to fall, its burst radius, and its damage: flat plus a share of a foe's max health. */
    fall: 0.4,
    radius: 75,
    damage: 60,
    share: 0.12,
  },
  absoluteZero: {
    wizard: 'frostcoil',
    name: 'Absolute Zero',
    description: 'Every foe in view freezes solid for 4 s (a boss slows to 40%), takes heavy damage, and frozen foes take 50% more. Shots in view shatter.',
    color: '#bfe6ff',
    cooldown: 80,
    duration: 4,
    damage: 40,
    share: 0.1,
    brittle: 1.5,
    bossSlow: 0.4,
  },
  bastion: {
    wizard: 'wardscale',
    name: 'Bastion',
    description: 'For 6 s nothing can hurt you, not even stone. Heals 35% of max health, and foes touching your body are burned and shoved away.',
    color: '#ffe08a',
    cooldown: 75,
    duration: 6,
    heal: 0.35,
    /** Seconds between burns, and each burn's damage: flat plus a share of a foe's max health. */
    tick: 0.4,
    damage: 30,
    share: 0.03,
    shove: 320,
  },
  maelstrom: {
    wizard: 'stormtongue',
    name: 'Maelstrom',
    description: 'For 6 s a storm around your head strikes a foe every 0.2 s, chaining to 2 more.',
    color: '#8cff6a',
    cooldown: 70,
    duration: 6,
    radius: 420,
    every: 0.2,
    damage: 45,
    share: 0.04,
    chains: 2,
  },
} as const satisfies Record<UltimateId, { wizard: WizardId; name: string; description: string; color: string; cooldown: number; duration: number; [tuning: string]: unknown }>;

export const ULTIMATE_IDS = Object.keys(ULTIMATES) as UltimateId[];

export function ultimateFor(wizard: WizardId): UltimateId {
  return ULTIMATE_IDS.find((id) => ULTIMATES[id].wizard === wizard)!;
}

/** The ultimate's cooldown now: Quickened Runes and the Hourglass shorten it, to a floor. */
export function ultimateCooldown(world: World): number {
  const haste = Math.max(0.6, 1 - 0.08 * world.upgrades.haste);
  return Math.max(ULTIMATE.minCooldown, ULTIMATES[world.ult.id].cooldown * haste * world.stats.ultimateCooldownMult);
}

/** Damage for one hit of the ultimate: flat (with spell damage and Empower) plus a share of a non-boss foe's max health. */
function hitFor(world: World, e: Enemy, flat: number, share: number): number {
  const empower = world.buffs.empower > 0 ? BUFFS.empower.damage : 1;
  return flat * world.stats.damageMult * empower + (e.kind === 'boss' ? 0 : e.maxHp * share);
}

const alive = (e: Enemy) => !e.dead && !e.hidden && e.pile <= 0;

/** Casts the wizard's ultimate if it's ready. Returns false while it recharges. */
export function castUltimate(world: World): boolean {
  const u = world.ult;
  if (u.cooldown > 0 || u.active > 0) return false;
  u.total = ultimateCooldown(world);
  u.cooldown = u.total;
  u.t = 0;
  u.next = 0;
  u.flash = 1;
  u.ready = false;
  world.recap.spells.ultimate.casts++;
  const s = world.snake;
  const def = ULTIMATES[u.id];
  if (u.id === 'starfall') {
    u.active = ULTIMATES.starfall.duration;
    u.left = ULTIMATES.starfall.stars;
  } else if (u.id === 'absoluteZero') {
    absoluteZero(world);
  } else if (u.id === 'bastion') {
    u.active = ULTIMATES.bastion.duration;
    world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp * ULTIMATES.bastion.heal);
  } else {
    u.active = ULTIMATES.maelstrom.duration;
  }
  world.ultRings.push({ x: s.x, y: s.y, t: 0, life: 0.6, r: Math.max(world.camera.viewW, world.camera.viewH) * 0.6, color: def.color });
  burst(world, s.x, s.y, def.color, 40, 420, { kind: 'glow', size: 9, life: 0.7 });
  floater(world, s.x, s.y - 40, def.name, def.color, { size: 24, life: 1.4 });
  addShake(world, 0.6);
  hitStop(world, 0.08, true);
  world.sfx('ultimate');
  return true;
}

/** Absolute Zero: everything in view freezes (a boss is slowed), takes a blow, and shots shatter. */
function absoluteZero(world: World): void {
  const cfg = ULTIMATES.absoluteZero;
  world.zeroUntil = world.time + cfg.duration;
  for (const e of world.enemies) {
    if (!alive(e) || !inView(world.camera, e.x, e.y, 60)) continue;
    if (e.kind !== 'boss') {
      e.frozen = Math.max(e.frozen, cfg.duration);
      e.frozenBy = -2;
    }
    damageEnemy(world, e, hitFor(world, e, cfg.damage, cfg.share), 'ultimate', cfg.color);
  }
  for (let i = world.shots.length - 1; i >= 0; i--) {
    const p = world.shots[i];
    if (!inView(world.camera, p.x, p.y, 40)) continue;
    burst(world, p.x, p.y, cfg.color, 4, 120, { kind: 'shard', size: 2.5, life: 0.4 });
    world.shots.splice(i, 1);
  }
}

/** True while Bastion keeps every blow off the serpent. */
export function bastionUp(world: World): boolean {
  return world.ult.id === 'bastion' && world.ult.active > 0;
}

/** Foes frozen by Absolute Zero take more damage while it lasts. */
export function zeroBrittle(world: World, e: Enemy): number {
  return world.zeroUntil > world.time && e.frozen > 0 ? ULTIMATES.absoluteZero.brittle : 1;
}

/** A boss caught in Absolute Zero moves at this share of its speed (1 when it isn't). */
export function zeroSlow(world: World, e: Enemy): number {
  return e.kind === 'boss' && world.zeroUntil > world.time ? ULTIMATES.absoluteZero.bossSlow : 1;
}

/** Per step: the cooldown, the running effect, and the stars in flight. */
export function updateUltimate(world: World, dt: number): void {
  const u = world.ult;
  u.flash = Math.max(0, u.flash - dt * 2);
  if (u.cooldown > 0) {
    // Quickening speeds the ultimate's recharge as it does the sigils'.
    u.cooldown = Math.max(0, u.cooldown - dt * (world.buffs.quickening > 0 ? BUFFS.quickening.cooldownRate : 1));
    if (u.cooldown === 0 && !u.ready) {
      u.ready = true;
      floater(world, world.snake.x, world.snake.y - 44, `${ULTIMATES[u.id].name} ready`, ULTIMATES[u.id].color, { size: 16, life: 1.2 });
      world.sfx('ultReady');
    }
  }
  for (let i = world.ultRings.length - 1; i >= 0; i--) {
    world.ultRings[i].t += dt;
    if (world.ultRings[i].t >= world.ultRings[i].life) world.ultRings.splice(i, 1);
  }
  updateStars(world, dt);
  if (u.active <= 0) return;
  u.active = Math.max(0, u.active - dt);
  u.t += dt;
  u.next -= dt;
  if (u.id === 'starfall') {
    const cfg = ULTIMATES.starfall;
    while (u.next <= 0 && u.left > 0) {
      u.next += cfg.duration / cfg.stars;
      u.left--;
      dropStar(world);
    }
  } else if (u.id === 'bastion') {
    if (u.next <= 0) {
      u.next += ULTIMATES.bastion.tick;
      burnAround(world);
    }
  } else if (u.id === 'maelstrom') {
    while (u.next <= 0) {
      u.next += ULTIMATES.maelstrom.every;
      strike(world);
    }
  }
}

/** Starfall: a star aimed at a foe in view (elites and the boss first), or anywhere in view. */
function dropStar(world: World): void {
  const cfg = ULTIMATES.starfall;
  const cam = world.camera;
  const inSight = world.enemies.filter((e) => alive(e) && inView(cam, e.x, e.y, -20));
  const big = inSight.filter((e) => e.kind === 'boss' || e.elite);
  // Big foes draw a share of the stars, the rest scatter over the crowd.
  const pool = big.length > 0 && world.rng() < 0.4 ? big : inSight;
  let x: number;
  let y: number;
  if (pool.length > 0) {
    const e = pool[Math.floor(world.rng() * pool.length)];
    x = e.x + (world.rng() - 0.5) * 30;
    y = e.y + (world.rng() - 0.5) * 30;
  } else {
    x = cam.x + (world.rng() - 0.5) * cam.viewW * 0.8;
    y = cam.y + (world.rng() - 0.5) * cam.viewH * 0.8;
  }
  world.stars.push({ x, y, t: 0, fall: cfg.fall, r: cfg.radius });
}

function updateStars(world: World, dt: number): void {
  const cfg = ULTIMATES.starfall;
  for (let i = world.stars.length - 1; i >= 0; i--) {
    const st = world.stars[i];
    st.t += dt;
    if (st.t < st.fall) continue;
    world.stars.splice(i, 1);
    for (const e of world.enemies) {
      if (!alive(e) || enemyDistance(e, st.x, st.y) > st.r) continue;
      const d = Math.sqrt(dist2(e.x, e.y, st.x, st.y)) || 1;
      damageEnemy(world, e, hitFor(world, e, cfg.damage, cfg.share), 'ultimate', cfg.color, ((e.x - st.x) / d) * 200, ((e.y - st.y) / d) * 200);
    }
    burst(world, st.x, st.y, cfg.color, 16, 300, { size: 3.5, life: 0.45 });
    burst(world, st.x, st.y, '#ffffff', 5, 120, { kind: 'glow', size: 10, life: 0.3 });
    if (inView(world.camera, st.x, st.y, 0)) addShake(world, 0.08);
    world.sfx('starfall');
  }
}

/** Bastion: foes touching the serpent's head or body are burned and shoved away. */
function burnAround(world: World): void {
  const cfg = ULTIMATES.bastion;
  const s = world.snake;
  const reach = SNAKE.hitRadius + 8;
  for (const e of world.enemies) {
    if (!alive(e)) continue;
    let touching: { x: number; y: number } | null = enemyHitTest(e, s.x, s.y, reach) ? s : null;
    if (!touching) for (const seg of s.segments) if (enemyHitTest(e, seg.x, seg.y, reach)) touching = seg;
    if (!touching) continue;
    const d = Math.sqrt(dist2(e.x, e.y, touching.x, touching.y)) || 1;
    damageEnemy(world, e, hitFor(world, e, cfg.damage, cfg.share), 'ultimate', cfg.color, ((e.x - touching.x) / d) * cfg.shove, ((e.y - touching.y) / d) * cfg.shove);
  }
}

/** Maelstrom: lightning from the storm on a random foe near the head, chaining on. */
function strike(world: World): void {
  const cfg = ULTIMATES.maelstrom;
  const s = world.snake;
  const near = world.enemies.filter((e) => alive(e) && dist2(e.x, e.y, s.x, s.y) <= cfg.radius * cfg.radius);
  if (near.length === 0) return;
  let at = near[Math.floor(world.rng() * near.length)];
  const struck = new Set<number>();
  const points = [{ x: at.x + 30, y: at.y - 320 }];
  for (let i = 0; i <= cfg.chains && at; i++) {
    struck.add(at.id);
    points.push({ x: at.x, y: at.y });
    damageEnemy(world, at, hitFor(world, at, cfg.damage, cfg.share), 'ultimate', cfg.color);
    let next: Enemy | null = null;
    let best = SPELLS.lightning.chainRange ** 2;
    for (const e of world.enemies) {
      if (!alive(e) || struck.has(e.id)) continue;
      const d = dist2(e.x, e.y, at.x, at.y);
      if (d < best) {
        best = d;
        next = e;
      }
    }
    if (!next) break;
    at = next;
  }
  world.arcs.push({ points, life: 0.24, maxLife: 0.24, seed: world.rng() * 1000, fizzle: false });
  world.sfx('lightning');
}

/** Angle of the storm's swirl around the head at time t (for drawing). */
export function stormAngle(t: number): number {
  return (t * 2.4) % TAU;
}
