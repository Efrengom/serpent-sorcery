import type { EnemyKind } from '../config';
import type { World } from '../world';

/** How much each enemy on the field adds to the music's urgency. */
const WEIGHT: Record<EnemyKind, number> = {
  chaser: 1,
  caster: 1.5,
  brute: 3,
  rival: 4,
  boss: 0,
  sporeling: 0.6,
  puffcap: 1.6,
  thornback: 3,
  burrowViper: 4,
  rattler: 1,
  frostArcher: 1.7,
  golem: 3.4,
  wraith: 4,
  imp: 0.8,
  pyromancer: 1.6,
  magmaBrute: 3.2,
  salamander: 4,
};

/**
 * Roughly 0 (empty arena) to 1+ (swarmed): enemy load, a slow build over the first two minutes
 * so the music grows even for a player who keeps the arena clear, and a bump at low health.
 */
export function arenaPressure(world: World): number {
  let load = world.portals.length * 0.5;
  for (const e of world.enemies) if (!e.dead) load += WEIGHT[e.kind];
  const build = Math.min(0.3, world.time / 400);
  const lowHp = world.hp < world.stats.maxHp * 0.35 ? 0.25 : 0;
  return load / 30 + build + lowHp;
}

/** Pressure needed to climb to level 1 and 2, and the lower marks to drop back. */
const UP = [0.3, 0.7];
const DOWN = [0.2, 0.55];
/** Seconds a level is held before it can change again, so layers don't flicker in and out. */
const MIN_HOLD = 4;

/** Turns arena pressure into a music level of 0, 1 or 2 with hysteresis. */
export class IntensityTracker {
  level: 0 | 1 | 2 = 0;
  private held = MIN_HOLD;

  update(pressure: number, dt: number): 0 | 1 | 2 {
    this.held += dt;
    let next = this.level;
    if (next < 2 && pressure >= UP[next]) next++;
    else if (next > 0 && pressure < DOWN[next - 1]) next--;
    if (next !== this.level && this.held >= MIN_HOLD) {
      this.level = next as 0 | 1 | 2;
      this.held = 0;
    }
    return this.level;
  }
}
