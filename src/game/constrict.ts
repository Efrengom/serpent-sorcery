import { CONSTRICT, HIT_STOP, SNAKE } from './config';
import { damageEnemy } from './combat';
import { addShake, burst, floater, hitStop } from './effects';
import { dist, type Vec } from './math';
import { WIZARDS } from './wizards';
import type { Enemy, World } from './world';

/**
 * Constrict: the serpent's body forms a loop when its head comes back around to a point far
 * enough down its own body. Foes inside a closed loop are crushed: damaged, held still and
 * pulled inward. While a loop is nearly closed around foes, the closing gap is shown.
 */

/** Even-odd ray casting; works for any simple or self-crossing polygon. */
export function pointInPolygon(x: number, y: number, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Body segments needed to bend into a full loop at the serpent's tightest turn. */
export const LOOP_SEGMENTS =
  Math.ceil((2 * Math.PI * (SNAKE.speed / SNAKE.turnRate) - CONSTRICT.closeDistance) / SNAKE.segmentSpacing) + 1;

function centroid(points: readonly Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function updateConstrict(world: World, dt: number): void {
  world.constrictCooldown = Math.max(0, world.constrictCooldown - dt);
  for (let i = world.constricts.length - 1; i >= 0; i--) {
    world.constricts[i].life -= dt;
    if (world.constricts[i].life <= 0) world.constricts.splice(i, 1);
  }
  const s = world.snake;
  const segs = s.segments;
  const color = WIZARDS[world.wizard].look.body;
  if (!world.constrictReady && segs.length >= LOOP_SEGMENTS) {
    world.constrictReady = true;
    world.banner = { text: 'Your serpent can Constrict', sub: 'Loop your body around foes to crush them', t: 0, max: 3.2, color };
  }
  world.coil = null;
  if (segs.length <= CONSTRICT.minSegments) return;
  // The loop closes at the first body point (far enough back) the head touches; otherwise the
  // nearest one is the gap still to close.
  let index = -1;
  let nearest = -1;
  let nearestD = Infinity;
  for (let i = CONSTRICT.minSegments; i < segs.length; i++) {
    const d = dist(s.x, s.y, segs[i].x, segs[i].y);
    if (d <= CONSTRICT.closeDistance) {
      index = i;
      break;
    }
    if (i >= CONSTRICT.hintFrom && d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  const closed = index >= 0;
  const at = closed ? index : nearestD <= CONSTRICT.hintDistance ? nearest : -1;
  if (at < 0) return;
  const loop: Vec[] = [{ x: s.x, y: s.y }, ...segs.slice(0, at + 1)];
  const inside = world.enemies.filter((e) => !e.dead && pointInPolygon(e.x, e.y, loop));
  // A loop with nothing in it is just a turn: no hint and no crush.
  if (inside.length === 0) return;
  world.coil = { index: at, closed, enclosed: inside.length };
  if (closed && world.constrictCooldown <= 0) crush(world, loop, inside, color);
}

function crush(world: World, loop: Vec[], inside: Enemy[], color: string): void {
  const c = centroid(loop);
  for (const e of inside) {
    const d = dist(e.x, e.y, c.x, c.y) || 1;
    damageEnemy(world, e, CONSTRICT.damage * world.stats.damageMult, 'constrict', color, ((c.x - e.x) / d) * CONSTRICT.pull, ((c.y - e.y) / d) * CONSTRICT.pull);
    if (!e.dead && e.kind !== 'boss') e.stunned = CONSTRICT.stun;
  }
  world.recap.spells.constrict.casts++;
  world.constrictCooldown = CONSTRICT.cooldown;
  world.constricts.push({ points: loop.map((p) => ({ ...p })), life: 0.6, maxLife: 0.6 });
  for (let i = 0; i < loop.length; i += 2) burst(world, loop[i].x, loop[i].y, color, 2, 160, { size: 3, life: 0.4 });
  floater(world, c.x, c.y, inside.length > 1 ? `Constrict ×${inside.length}` : 'Constrict!', color, { size: 22, life: 1 });
  addShake(world, Math.min(0.6, 0.25 + 0.06 * inside.length));
  hitStop(world, HIT_STOP.heavyKill);
  world.sfx('constrict');
}
