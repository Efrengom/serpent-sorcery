import { DESCENT, ENEMIES } from './config';
import { bossFan, bossTelegraph } from './enemies';
import type { Blast, Enemy, World } from './world';

/**
 * What both renderers need to preview attacks: the lane a charge, lunge or leap will cover, and
 * how far through its wind-up a foe is.
 */

/** The straight lane a winding-up foe is about to cover, or null if its attack isn't a dash. */
export function attackLane(e: Enemy): { length: number; telegraph: number } | null {
  switch (e.kind) {
    case 'brute':
    case 'magmaBrute':
    case 'thornback': {
      const c = ENEMIES[e.kind];
      return { length: c.chargeSpeed * c.chargeTime, telegraph: c.telegraph };
    }
    case 'wraith':
      return { length: ENEMIES.wraith.lungeSpeed * ENEMIES.wraith.lungeTime, telegraph: ENEMIES.wraith.telegraph };
    case 'rival':
      return { length: ENEMIES.rival.lungeSpeed * ENEMIES.rival.lungeTime, telegraph: ENEMIES.rival.telegraph };
    case 'imp':
      return { length: ENEMIES.imp.leapSpeed * ENEMIES.imp.leapTime, telegraph: ENEMIES.imp.telegraph };
    case 'boss':
      return e.bossMove === 'charge' || e.bossMove === 'burrow'
        ? { length: ENEMIES.boss.chargeSpeed * ENEMIES.boss.chargeTime, telegraph: ENEMIES.boss.chargeTelegraph }
        : null;
    default:
      return null;
  }
}

/**
 * The lines a winding-up foe will shoot along, and how far: a Frost Archer's single icicle, a
 * Puffcap's fan of three spores, or a boss's fan of spores or icicles. `spores` marks the slow,
 * soft kind (drawn as a dotted fan), as against the icicles' straight lines.
 */
export function aimLines(e: Enemy): { angles: number[]; length: number; k: number; spores: boolean } | null {
  if (e.state !== 'windup') return null;
  if (e.kind === 'frostArcher') return { angles: [e.aim], length: 760, k: windup(e, ENEMIES.frostArcher.telegraph), spores: false };
  if (e.kind === 'puffcap') {
    const c = ENEMIES.puffcap;
    return { angles: Array.from({ length: c.shots }, (_, i) => e.aim + (i - (c.shots - 1) / 2) * c.spread), length: 220, k: windup(e, c.telegraph), spores: true };
  }
  if (e.kind === 'boss' && (e.bossMove === 'icicles' || e.bossMove === 'spores')) {
    const icy = e.bossMove === 'icicles';
    return { angles: bossFan(e), length: icy ? 900 : 300, k: windup(e, bossTelegraph(e)), spores: !icy };
  }
  return null;
}

/** 0 → 1 through a foe's wind-up. */
export function windup(e: Enemy, telegraph: number): number {
  return Math.max(0, Math.min(1, e.stateTime / telegraph));
}

/** A Salamander's flame: the cone it will breathe (while winding up) or is breathing. */
export function flameCone(e: Enemy): { angle: number; reach: number; half: number; k: number; burning: boolean } | null {
  if (e.kind !== 'salamander' || (e.state !== 'windup' && e.state !== 'attack')) return null;
  const cfg = ENEMIES.salamander;
  const burning = e.state === 'attack';
  return {
    angle: burning ? e.heading : e.aim,
    reach: cfg.flameRange,
    half: cfg.flameAngle,
    k: burning ? 1 : windup(e, cfg.telegraph),
    burning,
  };
}

/** 0 → 1 as a marked blast nears landing. */
export function blastProgress(b: Blast): number {
  return Math.max(0, Math.min(1, b.t / b.delay));
}

/** Where a lobbed fireball or falling meteor is now, and how high (0 on the ground). */
export function blastInFlight(b: Blast): { x: number; y: number; height: number } | null {
  const k = blastProgress(b);
  if (b.look === 'fireball' && b.from) {
    return { x: b.from.x + (b.x - b.from.x) * k, y: b.from.y + (b.y - b.from.y) * k, height: Math.sin(k * Math.PI) * Math.min(220, Math.hypot(b.x - b.from.x, b.y - b.from.y) * 0.45) };
  }
  // Meteors drop out of the sky over the last half of their wait.
  if (b.look === 'meteor' && k > 0.5) return { x: b.x, y: b.y, height: (1 - (k - 0.5) / 0.5) * 420 };
  return null;
}

/** 1 → 0 over the fade from black after arriving on a new map. */
export function fadeLevel(world: World): number {
  return Math.max(0, Math.min(1, world.fade / DESCENT.fade));
}
