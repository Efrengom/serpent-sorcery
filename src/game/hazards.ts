import { inView } from './camera';
import { HAZARDS, SNAKE, type EnemyKind } from './config';
import { damageEnemy, enemyDistance, hurtPlayer } from './combat';
import { addShake, burst } from './effects';
import { difficulty, mapClock } from './enemies';
import { dist2 } from './math';
import { clearanceAt } from './terrain';
import type { Blast, Enemy, GroundKind, World } from './world';

/**
 * Hazards: the map's own ground (lava, brambles, ice), trails some foes leave (lava, brambles,
 * burning ground, ice), each map's vents (eruptions, spore puffs, falling icicles), and
 * telegraphed blasts (vents, meteors, fireballs, slams, eruptions from below) that go off where a
 * circle was marked.
 *
 * Ground you touch always stings, even through the Ward; bursts are attacks, so the Ward and
 * Stoneskin block them (O2). Ice never hurts: it widens the serpent's turns.
 */

/** Foes at home in their map's stinging ground take no harm from it. Bosses shrug hazards off. */
export const AT_HOME: Partial<Record<EnemyKind, true>> = {
  sporeling: true,
  puffcap: true,
  thornback: true,
  burrowViper: true,
  imp: true,
  pyromancer: true,
  magmaBrute: true,
  salamander: true,
  boss: true,
};

/** What stinging ground is called in the recap, by what it is. */
export type StingKind = 'lava' | 'bramble' | 'fire';

const MAX_GROUND_FX = 160;

/** Arms the map's vents, each on its own clock. */
export function placeVents(world: World): void {
  world.vents = world.map.vents.map((v) => ({ x: v.x, y: v.y, next: world.time + 1 + world.rng() * 5 }));
}

/** The stinging ground covering (x, y) within `r`: the map's lava or brambles, or a trail of lava, brambles or fire. */
export function hazardAt(world: World, x: number, y: number, r = 0): StingKind | null {
  const z = world.map.zones;
  // Inclusive: where two cells' rectangles meet, the seam between them measures 0, and is still inside.
  if (z.lava && clearanceAt(z.lava, x, y) <= r) return 'lava';
  if (z.bramble && clearanceAt(z.bramble, x, y) <= r) return 'bramble';
  for (const g of world.groundFx) {
    if (g.kind === 'ice') continue;
    const rr = g.r + r;
    if (dist2(g.x, g.y, x, y) < rr * rr) return g.kind;
  }
  return null;
}

/** Whether (x, y) is on ice: the map's sheets, or a patch a foe left. */
export function onIce(world: World, x: number, y: number): boolean {
  const ice = world.map.zones.ice;
  if (ice && clearanceAt(ice, x, y) <= 0) return true;
  for (const g of world.groundFx) if (g.kind === 'ice' && dist2(g.x, g.y, x, y) < g.r * g.r) return true;
  return false;
}

/** Leaves a patch of burning ground, lava, brambles or ice for `life` seconds. */
export function addGroundFx(world: World, x: number, y: number, r: number, life: number, kind: GroundKind): void {
  if (world.groundFx.length >= MAX_GROUND_FX) world.groundFx.shift();
  world.groundFx.push({ x, y, r, t: 0, life, kind });
}

/** Marks a circle that goes off after `delay` seconds. */
export function spawnBlast(world: World, b: Omit<Blast, 't'>): void {
  world.blasts.push({ ...b, t: 0 });
}

/** How hard each kind of stinging ground bites. */
const STING: Record<StingKind, number> = { lava: HAZARDS.lava.damage, bramble: HAZARDS.bramble.damage, fire: HAZARDS.fire.damage };
const STING_COLOR: Record<StingKind, string> = { lava: '#ff8a3c', bramble: '#c45ad8', fire: '#ff8a3c' };

/** Per step: ground effects age, the head is hurt by what it touches, vents near the view go off, blasts land. */
export function updateHazards(world: World, dt: number): void {
  for (let i = world.groundFx.length - 1; i >= 0; i--) {
    const g = world.groundFx[i];
    g.t += dt;
    if (g.t >= g.life) world.groundFx.splice(i, 1);
  }

  const s = world.snake;
  const touching = hazardAt(world, s.x, s.y, SNAKE.hitRadius);
  if (touching && hurtPlayer(world, STING[touching], { kind: 'wall', attack: touching })) {
    burst(world, s.x, s.y, STING_COLOR[touching], 10, 160, { size: 3, life: 0.4 });
  }

  // Vents only run within about a view of the camera; elsewhere their clocks wait (S5).
  const look = world.map.def.vent;
  const cfg = HAZARDS[look];
  const cam = world.camera;
  const reach = cfg.activeViews * Math.max(cam.viewW, cam.viewH) * 0.5;
  for (const v of world.vents) {
    if (!inView(cam, v.x, v.y, reach)) {
      v.next += dt;
      continue;
    }
    if (world.time < v.next) continue;
    const [lo, hi] = cfg.interval;
    v.next = world.time + cfg.telegraph + lo + world.rng() * (hi - lo);
    spawnBlast(world, {
      x: v.x,
      y: v.y,
      r: cfg.radius,
      delay: cfg.telegraph,
      damage: cfg.damage * difficulty(mapClock(world), world.depth, world.heat).damage,
      hitsFoes: true,
      source: { kind: 'hazard', attack: look },
      after: null,
      look,
      from: null,
    });
  }

  for (let i = world.blasts.length - 1; i >= 0; i--) {
    const b = world.blasts[i];
    b.t += dt;
    if (b.t < b.delay) continue;
    world.blasts.splice(i, 1);
    explode(world, b);
  }
}

/** Each blast's colours (main burst, then its bright core), and its sound. */
const BLAST_LOOK: Record<Blast['look'], { color: string; core: string; sfx: 'erupt' | 'spores' | 'icicle' | 'slam' | 'burrow'; big: boolean }> = {
  vent: { color: '#ffb35c', core: '#fff0c0', sfx: 'erupt', big: true },
  meteor: { color: '#ff5a36', core: '#fff0c0', sfx: 'erupt', big: false },
  fireball: { color: '#ff5a36', core: '#fff0c0', sfx: 'erupt', big: false },
  spores: { color: '#d86ae0', core: '#b8fff0', sfx: 'spores', big: true },
  icicle: { color: '#bfe6ff', core: '#ffffff', sfx: 'icicle', big: false },
  slam: { color: '#9fd8ff', core: '#e8f8ff', sfx: 'slam', big: true },
  burrow: { color: '#8a6a4a', core: '#e0c8a0', sfx: 'burrow', big: true },
};

function explode(world: World, b: Blast): void {
  const s = world.snake;
  const reach = b.r + SNAKE.hitRadius;
  if (dist2(s.x, s.y, b.x, b.y) <= reach * reach) hurtPlayer(world, b.damage, b.source);
  if (b.hitsFoes) {
    for (const e of world.enemies) {
      if (e.dead || e.hidden || e.kind === 'boss' || enemyDistance(e, b.x, b.y) > b.r) continue;
      const d = Math.sqrt(dist2(e.x, e.y, b.x, b.y)) || 1;
      damageEnemy(world, e, b.damage, 'hazard', BLAST_LOOK[b.look].color, ((e.x - b.x) / d) * 220, ((e.y - b.y) / d) * 220);
    }
  }
  if (b.after) addGroundFx(world, b.x, b.y, b.after.r, b.after.life, b.after.kind ?? 'fire');
  const look = BLAST_LOOK[b.look];
  burst(world, b.x, b.y, look.color, look.big ? 26 : 18, look.big ? 320 : 260, { size: 3.5, life: 0.5 });
  burst(world, b.x, b.y, look.core, 6, 120, { kind: 'glow', size: 10, life: 0.35 });
  if (inView(world.camera, b.x, b.y, 100)) addShake(world, look.big ? 0.2 : 0.12);
  world.sfx(look.sfx);
}

/** Foes standing in stinging ground they aren't at home in take a burn every so often. */
export function burnFoe(world: World, e: Enemy, dt: number): void {
  if (AT_HOME[e.kind] || e.hidden) return;
  if (!world.map.harmIndex && world.groundFx.length === 0) return;
  if (!hazardAt(world, e.x, e.y, e.r * 0.5)) {
    e.burn = 0;
    return;
  }
  e.burn -= dt;
  if (e.burn > 0) return;
  e.burn = HAZARDS.burn.tick;
  damageEnemy(world, e, HAZARDS.burn.damage, 'hazard', '#ff8a3c');
}
