import { BREAKABLES, BUFFS, PICKUPS, PROGRESSION, SNAKE, ARENA } from './config';
import { dropCrystals } from './combat';
import { burst, floater } from './effects';
import { dist2, TAU } from './math';
import { COLORS } from './palette';
import type { Breakable, BuffId, Pickup, PickupKind, TimedBuff, World } from './world';

/**
 * Breakables, the pickups they drop, and the buffs those give.
 *
 * Small breakables (urns) shatter when the head touches them or any spell hits them. Large ones
 * (reliquaries) are solid: the serpent bumps off them unhurt, and they take spells to break.
 * Foes never break them. Broken slots refill after a while, out of sight.
 */

export const TIMED_BUFFS: TimedBuff[] = ['quickening', 'empower', 'swiftscale', 'stoneskin'];
export const BUFF_IDS: BuffId[] = [...TIMED_BUFFS, 'lodestone', 'shardCache'];

/** Names, one-line effects and colours, for floaters, the HUD and How to Play. */
export const BUFF_INFO: Record<BuffId, { name: string; blurb: string; color: string }> = {
  quickening: { name: 'Quickening', blurb: 'Spell cooldowns recover 50% faster', color: '#8fe8ff' },
  empower: { name: 'Empower', blurb: '+40% spell damage', color: '#ffb347' },
  swiftscale: { name: 'Swiftscale', blurb: '+20% speed and turning', color: '#8cff6a' },
  stoneskin: { name: 'Stoneskin', blurb: 'Blocks the next hit from a foe', color: '#d8c8b0' },
  lodestone: { name: 'Lodestone', blurb: 'Every crystal on the map flies to you', color: '#d6c4ff' },
  shardCache: { name: 'Shard Cache', blurb: 'Arcane Shards, banked with the run', color: '#9fd0ff' },
};

export const HEAL_COLOR = '#ff5a7a';

/** Seconds a timed buff lasts. */
export function buffDuration(id: TimedBuff): number {
  return BUFFS[id].duration;
}

// ---------------------------------------------------------------- placing and refilling

/** Fills the map's slots at the start of a run: every large one, and most small ones. */
export function placeBreakables(world: World): void {
  world.breakables.length = 0;
  world.refills.length = 0;
  world.map.slots.forEach((slot, i) => {
    if (slot.size === 'large' || world.rng() < BREAKABLES.startFill) spawnBreakable(world, i);
    else world.refills.push({ slot: i, at: 0 });
  });
}

/** Puts a fresh breakable in slot `slot`. */
export function spawnBreakable(world: World, slot: number): Breakable {
  const s = world.map.slots[slot];
  const large = s.size === 'large';
  const hp = large ? BREAKABLES.large.hp * (1 + BREAKABLES.large.hpPerDepth * (world.depth - 1)) : 1;
  const b: Breakable = {
    id: world.nextId++,
    slot,
    size: s.size,
    look: large ? world.map.def.breakables.large : world.map.def.breakables.small,
    x: s.x,
    y: s.y,
    r: large ? BREAKABLES.large.radius : BREAKABLES.small.radius,
    hp,
    maxHp: hp,
    flash: 0,
    lastNovaId: -1,
    variant: Math.floor(world.rng() * 4),
  };
  world.breakables.push(b);
  return b;
}

/** Calls `fn` for each breakable within `r` of (x, y) (edge to centre). */
export function eachBreakableNear(world: World, x: number, y: number, r: number, fn: (b: Breakable) => void): void {
  // A few hundred at most: a straight scan, backwards, since fn may break (remove) the one it's given.
  const list = world.breakables;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    const rr = r + b.r;
    if (dist2(b.x, b.y, x, y) <= rr * rr) fn(b);
  }
}

/**
 * Per step: broken slots refill once their time is up and they're well out of sight, the head
 * smashes small breakables and bumps off large ones, and hit flashes fade.
 */
export function updateBreakables(world: World, dt: number): void {
  const s = world.snake;
  const far = BREAKABLES.refillViews * Math.hypot(world.camera.viewW, world.camera.viewH);
  // Nothing refills while the way down is open.
  for (let i = world.refills.length - 1; i >= 0 && !world.descent; i--) {
    const r = world.refills[i];
    if (world.time < r.at) continue;
    const slot = world.map.slots[r.slot];
    if (Math.hypot(slot.x - s.x, slot.y - s.y) < far) continue;
    world.refills.splice(i, 1);
    spawnBreakable(world, r.slot);
  }
  const list = world.breakables;
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    b.flash = Math.max(0, b.flash - dt);
    const rr = SNAKE.headRadius + b.r;
    const d2 = dist2(b.x, b.y, s.x, s.y);
    if (d2 >= rr * rr) continue;
    if (b.size === 'small') {
      smash(world, b);
      continue;
    }
    // A soft bounce off a reliquary: pushed out and turned away, but unhurt.
    const d = Math.sqrt(d2) || 1;
    const nx = (s.x - b.x) / d;
    const ny = (s.y - b.y) / d;
    s.x = b.x + nx * rr;
    s.y = b.y + ny * rr;
    const vx = Math.cos(s.heading);
    const vy = Math.sin(s.heading);
    const vn = vx * nx + vy * ny;
    const out = Math.max(Math.abs(vn), ARENA.wallMinInward);
    s.heading = Math.atan2(vy - vn * ny + out * ny, vx - vn * nx + out * nx);
    s.steerLock = ARENA.wallSteerLock;
    world.sfx('bump');
  }
}

/** Keeps a foe (or anything round) out of the large breakables. Returns true if it moved. */
export function pushOutOfBreakables(world: World, body: { x: number; y: number }, r: number): boolean {
  let moved = false;
  for (const b of world.breakables) {
    if (b.size !== 'large') continue;
    const rr = r + b.r;
    const d2 = dist2(b.x, b.y, body.x, body.y);
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1;
    body.x = b.x + ((body.x - b.x) / d) * rr;
    body.y = b.y + ((body.y - b.y) / d) * rr;
    moved = true;
  }
  return moved;
}

// ---------------------------------------------------------------- breaking and loot

/** Spell damage to a breakable: any hit shatters a small one; a large one wears down. */
export function damageBreakable(world: World, b: Breakable, amount: number): void {
  if (!world.breakables.includes(b)) return;
  if (b.size === 'small') {
    smash(world, b);
    return;
  }
  b.hp -= amount;
  b.flash = 0.12;
  burst(world, b.x, b.y, '#e8c87a', 5, 160, { size: 2.5, life: 0.3 });
  world.sfx('hit');
  if (b.hp <= 0) smash(world, b);
}

function smash(world: World, b: Breakable): void {
  const i = world.breakables.indexOf(b);
  if (i < 0) return;
  world.breakables.splice(i, 1);
  const large = b.size === 'large';
  world.refills.push({ slot: b.slot, at: world.time + (large ? BREAKABLES.large.refill : BREAKABLES.small.refill) });
  world.recap.breakables++;
  const shards = large ? '#e8c87a' : '#c8784a';
  burst(world, b.x, b.y, shards, large ? 26 : 12, large ? 260 : 180, { kind: 'shard', size: large ? 4 : 3, life: 0.5 });
  if (large) burst(world, b.x, b.y, '#fff3c4', 10, 120, { kind: 'glow', size: 8, life: 0.4 });
  world.sfx(large ? 'smashBig' : 'smash');
  dropLoot(world, b);
}

/** The drop tables (B6): crystals always, a heal by chance (likelier when hurt), and buffs. */
function dropLoot(world: World, b: Breakable): void {
  const low = world.hp < world.stats.maxHp * BREAKABLES.lowHealth;
  if (b.size === 'small') {
    const [lo, hi] = BREAKABLES.small.xp;
    const xp = lo + Math.floor(world.rng() * (hi - lo + 1));
    world.recap.breakableXp += xp;
    dropCrystals(world, b.x, b.y, xp);
    if (world.rng() < BREAKABLES.small.heal * (low ? 2 : 1)) spawnPickup(world, 'heal', b.x, b.y);
    if (world.rng() < BREAKABLES.small.buff) spawnPickup(world, rollBuff(world), b.x, b.y);
    return;
  }
  world.recap.breakableXp += BREAKABLES.large.xp;
  dropCrystals(world, b.x, b.y, BREAKABLES.large.xp);
  if (world.rng() < BREAKABLES.large.heal) spawnPickup(world, low ? 'bigHeal' : 'heal', b.x, b.y);
  spawnPickup(world, rollBuff(world), b.x, b.y);
}

/** A buff, by the weights in BUFFS. */
export function rollBuff(world: World): BuffId {
  const total = BUFF_IDS.reduce((s, id) => s + BUFFS[id].weight, 0);
  let roll = world.rng() * total;
  for (const id of BUFF_IDS) {
    roll -= BUFFS[id].weight;
    if (roll <= 0) return id;
  }
  return 'quickening';
}

function spawnPickup(world: World, kind: PickupKind, x: number, y: number): Pickup {
  const a = world.rng() * TAU;
  const p: Pickup = { id: world.nextId++, kind, x, y, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, t: world.rng() * 10, magnet: false };
  world.pickups.push(p);
  return p;
}

// ---------------------------------------------------------------- pickups

/** Whether the serpent wants this pickup now: heals wait on the ground while health is full. */
function wanted(world: World, p: Pickup): boolean {
  return (p.kind !== 'heal' && p.kind !== 'bigHeal') || world.hp < world.stats.maxHp;
}

/** Pickups drift to a stop, are drawn in by the pickup radius like crystals, and apply on touch. */
export function updatePickups(world: World, dt: number): void {
  const s = world.snake;
  const pick2 = world.stats.pickupRadius ** 2;
  const eat = SNAKE.headRadius + PROGRESSION.pickupRadiusOnHead;
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const p = world.pickups[i];
    p.t += dt;
    const want = wanted(world, p);
    const d2 = dist2(p.x, p.y, s.x, s.y);
    p.magnet = want && (p.magnet || d2 < pick2);
    if (p.magnet) {
      const d = Math.sqrt(d2) || 1;
      const k = 1 - Math.exp(-8 * dt);
      p.vx += (((s.x - p.x) / d) * PROGRESSION.crystalMagnetSpeed - p.vx) * k;
      p.vy += (((s.y - p.y) / d) * PROGRESSION.crystalMagnetSpeed - p.vy) * k;
    } else {
      const damp = Math.exp(-4 * dt);
      p.vx *= damp;
      p.vy *= damp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const b = world.map.bounds;
    p.x = Math.max(b.minX + 8, Math.min(b.maxX - 8, p.x));
    p.y = Math.max(b.minY + 8, Math.min(b.maxY - 8, p.y));
    if (want && dist2(p.x, p.y, s.x, s.y) < eat * eat) {
      world.pickups.splice(i, 1);
      collect(world, p);
    }
  }
}

function collect(world: World, p: Pickup): void {
  const s = world.snake;
  if (p.kind === 'heal' || p.kind === 'bigHeal') {
    const amount = p.kind === 'heal' ? PICKUPS.smallHeal : Math.round(world.stats.maxHp * PICKUPS.largeHeal);
    const healed = Math.min(amount, world.stats.maxHp - world.hp);
    world.hp += healed;
    world.recap.healed += healed;
    floater(world, s.x, s.y - 30, `+${Math.round(healed)} health`, HEAL_COLOR, { size: 18, life: 1 });
    burst(world, s.x, s.y, HEAL_COLOR, 10, 140, { kind: 'glow', size: 5, life: 0.4 });
    world.sfx('heal');
    return;
  }
  grantBuff(world, p.kind);
}

/** Applies a buff: timed ones start (or restart) their clock; the others act at once. */
export function grantBuff(world: World, id: BuffId): void {
  const s = world.snake;
  const info = BUFF_INFO[id];
  world.recap.buffs++;
  let label = `${info.name}!`;
  if (id === 'lodestone') {
    for (const c of world.crystals) c.magnet = true;
  } else if (id === 'shardCache') {
    const shards = BUFFS.shardCache.shards + BUFFS.shardCache.perDepth * (world.depth - 1);
    world.bonusShards += shards;
    label = `+${shards} Arcane Shards`;
  } else {
    world.buffs[id] = buffDuration(id);
  }
  floater(world, s.x, s.y - 34, label, info.color, { size: 20, life: 1.2 });
  burst(world, s.x, s.y, info.color, 16, 220, { kind: 'glow', size: 6, life: 0.5 });
  world.sfx('buff');
}

/** Counts timed buffs down in game time, and says when one wears off. */
export function updateBuffs(world: World, dt: number): void {
  for (const id of TIMED_BUFFS) {
    const left = world.buffs[id];
    if (left <= 0) continue;
    world.buffs[id] = Math.max(0, left - dt);
    if (world.buffs[id] === 0) {
      floater(world, world.snake.x, world.snake.y - 30, `${BUFF_INFO[id].name} fades`, COLORS.unclear, { size: 15, life: 0.9 });
      world.sfx('buffEnd');
    }
  }
}
