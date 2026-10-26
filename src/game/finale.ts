import { killEnemy } from './combat';
import { ENEMIES } from './config';
import { addShake, burst } from './effects';
import { spawnEnemy } from './enemies';
import { MAP_ORDER } from './maps';
import { COLORS } from './palette';
import type { Enemy, World } from './world';

/**
 * The end of a run's first pass (V1). When the last map's Archmage falls, the ground splits
 * and Azhdaha, the Archmage Ascendant, rises from the four Archmages' magic: three phases, each
 * borrowing the moves of the maps behind it. Defeating it wins the run, and the player chooses:
 * claim the victory and bank the shards, or open the way down and play on into the depths.
 */
export const FINALE = {
  /** Seconds the ground shakes and the magic gathers before the Ascendant rises. */
  rise: 4.5,
  /** Its health against an ordinary boss at this depth, and its size. */
  hpMult: 2.2,
  sizeMult: 1.15,
  /** Seconds after it falls before the victory screen, while the freeze and slow motion play out. */
  victoryDelay: 2.6,
  /** Shards a won run banks on top of the rest (before curses and heat). */
  reward: 300,
};

/** The four Archmages' colours, gathering at the rift and banded along the Ascendant's body. */
export const ASCENDANT_COLORS = ['#ffd45e', '#ff8ae8', '#bfe6ff', '#ff7a2a'];

/** True when the boss that just fell ends the first pass, so the Ascendant should rise. */
export function finaleDue(world: World): boolean {
  return !world.won && !world.finale && world.mapIndex === MAP_ORDER.length - 1;
}

/** Clears the field where the last Archmage fell and starts the Ascendant rising there. */
export function beginFinale(world: World, x: number, y: number): void {
  for (const e of world.enemies) {
    if (e.dead) continue;
    e.elite = null;
    killEnemy(world, e);
  }
  world.portals.length = 0;
  world.shots.length = 0;
  world.blasts.length = 0;
  world.bossClearing = -1;
  world.bossWarned = false;
  for (const c of world.crystals) c.magnet = true;
  world.finale = { x, y, t: 0, stage: 'rising' };
  world.banner = { text: 'The ground splits…', sub: 'The four Archmages’ magic gathers into one', t: 0, max: FINALE.rise, color: '#ffd45e' };
  world.sfx('bossWarn');
}

/** Per step: the rising (rumbling, then the Ascendant), and the time since victory. */
export function updateFinale(world: World, dt: number): void {
  const f = world.finale;
  if (!f) return;
  f.t += dt;
  if (f.stage === 'rising') {
    for (const c of world.crystals) c.magnet = true;
    // The rumble grows as it comes.
    if (Math.floor((f.t - dt) * 2) !== Math.floor(f.t * 2)) addShake(world, 0.15 + (f.t / FINALE.rise) * 0.35);
    if (f.t >= FINALE.rise) riseAscendant(world, f.x, f.y);
  }
}

/** The Ascendant rises where the finale gathered (the inspector raises one on its own). */
export function riseAscendant(world: World, x: number, y: number): Enemy {
  const f = world.finale!;
  f.stage = 'fight';
  f.t = 0;
  world.bossIndex++;
  const e = spawnEnemy(world, 'boss', x, y);
  e.bossId = 'ascendant';
  e.maxHp = e.hp = e.hp * FINALE.hpMult;
  e.r = ENEMIES.boss.radius * FINALE.sizeMult;
  e.segRadius = ENEMIES.boss.segmentRadius * FINALE.sizeMult;
  for (const color of ASCENDANT_COLORS) burst(world, x, y, color, 24, 380, { kind: 'glow', size: 10, life: 0.9 });
  burst(world, x, y, '#ffffff', 30, 300, { kind: 'shard', size: 5, life: 0.8 });
  addShake(world, 0.9);
  world.banner = { text: 'Azhdaha, the Archmage Ascendant', sub: 'It wields every Archmage’s magic — and learns more as it bleeds', t: 0, max: 3.2, color: '#ffd45e' };
  world.sfx('bossDie');
  return e;
}

/** The Ascendant has fallen: the run is won. The field clears while the victory sinks in. */
export function winRun(world: World, x: number, y: number): void {
  for (const e of world.enemies) {
    if (e.dead) continue;
    e.elite = null;
    killEnemy(world, e);
  }
  world.portals.length = 0;
  world.shots.length = 0;
  world.blasts.length = 0;
  for (const c of world.crystals) c.magnet = true;
  world.won = true;
  world.wonAt = world.time;
  world.finale = { x, y, t: 0, stage: 'won' };
  for (const color of ASCENDANT_COLORS) burst(world, x, y, color, 30, 460, { kind: 'glow', size: 12, life: 1.1 });
  world.banner = { text: 'Victory!', sub: 'The Archmage Ascendant falls. The Archmage now is you.', t: 0, max: FINALE.victoryDelay + 1, color: COLORS.nova };
}

/** True once the victory has had its moment and the choice should be offered. */
export function victoryReady(world: World): boolean {
  return world.finale?.stage === 'won' && world.finale.t >= FINALE.victoryDelay;
}
