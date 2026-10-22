import { placeBreakables } from './breakables';
import { clampCamera } from './camera';
import { DESCENT, DIRECTOR } from './config';
import { gainXp, killEnemy } from './combat';
import { placeVents } from './hazards';
import { buildLayout, mapArea, mapForIndex, mapSeed } from './maps';
import { clamp, dist, TAU, type Vec } from './math';
import { createFlowField, refreshFlowField } from './nav';
import { offerRelics, RELIC_TUNING, takeRelic, type RelicId } from './relics';
import { placeSites } from './sites';
import { refreshStats } from './world';
import { COLORS } from './palette';
import { clearanceAt, pushOut } from './terrain';
import type { World } from './world';

/**
 * Descending (R5). When a boss falls, every other foe falls with it, every crystal flies to the
 * serpent and a way down opens where the boss died. Steering into it (or waiting out its pull)
 * takes the serpent to the next map, one depth deeper, with everything it has learned.
 */

/** Opens the way down at (x, y), once the boss is dead (or, after a win, when the player plays on). */
export function beginDescent(world: World, x: number, y: number, banner = { text: 'The Archmage falls!', sub: 'A way down opens where it fell: steer into it' }): void {
  const at = portalSpot(world, x, y);
  for (const e of world.enemies) {
    if (e.dead) continue;
    // No splitting into new foes on the way out.
    e.elite = null;
    killEnemy(world, e);
  }
  world.portals.length = 0;
  world.shots.length = 0;
  world.blasts.length = 0;
  world.bossClearing = -1;
  world.bossWarned = false;
  for (const c of world.crystals) c.magnet = true;
  world.descent = { x: at.x, y: at.y, t: 0 };
  world.banner = { ...banner, t: 0, max: 3.6, color: COLORS.nova };
  world.sfx('descend');
}

/**
 * Where the way down opens: where the boss fell, or (if that's in stone or a hazard, since a boss
 * can die in lava) the nearest open, dry ground, so reaching it never costs health.
 */
function portalSpot(world: World, x: number, y: number): Vec {
  const b = world.map.bounds;
  const hz = world.map.hazardIndex;
  const fits = (px: number, py: number) =>
    px > b.minX + 60 && px < b.maxX - 60 && py > b.minY + 60 && py < b.maxY - 60 && clearanceAt(world.map.index, px, py) >= 60 && (!hz || clearanceAt(hz, px, py) >= DESCENT.radius);
  if (fits(x, y)) return { x, y };
  for (let r = 40; r <= 1600; r += 40) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (fits(px, py)) return { x: px, y: py };
    }
  }
  const at = { x, y };
  pushOut(world.map.index, at, 60);
  return { x: clamp(at.x, b.minX + 60, b.maxX - 60), y: clamp(at.y, b.minY + 60, b.maxY - 60) };
}

/**
 * Per step while the way down is open: crystals keep flying in, and the portal takes the serpent.
 * On the threshold the run is offered relics (R1); the engine waits for the choice, then calls
 * leaveForNextMap. With nothing left to offer it goes straight down.
 */
export function updateDescent(world: World, dt: number): void {
  const d = world.descent;
  if (!d || world.relicOffer) return;
  d.t += dt;
  for (const c of world.crystals) c.magnet = true;
  const s = world.snake;
  if (dist(s.x, s.y, d.x, d.y) <= DESCENT.radius || d.t >= DESCENT.pullAfter) {
    const offer = offerRelics(world, world.rng);
    if (offer.length > 0) {
      world.relicOffer = offer;
      world.banner = null;
    } else enterNextMap(world);
  }
}

/** Takes the chosen relic (or, leaving them, heals instead) and goes down to the next map. */
export function leaveForNextMap(world: World, relic: RelicId | null): void {
  if (relic && world.relicOffer?.includes(relic)) {
    takeRelic(world, relic);
    refreshStats(world);
  } else {
    world.hp = Math.min(world.stats.maxHp, world.hp + world.stats.maxHp * RELIC_TUNING.leaveHeal);
  }
  world.relicOffer = null;
  enterNextMap(world);
}

/**
 * Moves the run to the next map in the order (round again after the last): a fresh layout,
 * the serpent at its start with its length, level and upgrades, a new boss clock.
 */
export function enterNextMap(world: World): void {
  const index = world.mapIndex + 1;
  const def = mapForIndex(index);
  const map = buildLayout(def, mapSeed(world.seed, index));
  // Crystals still in flight are banked rather than lost.
  for (const c of world.crystals) gainXp(world, c.value);
  world.crystals.length = 0;
  world.pickups.length = 0;
  world.enemies.length = 0;
  world.portals.length = 0;
  world.shots.length = 0;
  world.bolts.length = 0;
  world.novas.length = 0;
  world.arcs.length = 0;
  world.beams.length = 0;
  world.frostFields.length = 0;
  world.echoes.length = 0;
  world.blasts.length = 0;
  world.groundFx.length = 0;
  world.constricts.length = 0;
  world.shatters.length = 0;
  world.stars.length = 0;
  world.relicState.sacrificed = false;
  world.coil = null;
  world.boss = null;

  world.map = map;
  world.mapIndex = index;
  world.mapStart = world.time;
  world.depth++;
  world.recap.depth = Math.max(world.recap.depth, world.depth);
  world.recap.map = def.name;
  if (!world.visited.includes(def.id)) world.visited.push(def.id);
  world.area = mapArea(def.id);

  const s = world.snake;
  const count = s.segmentCount;
  const target = s.segmentTarget;
  s.reset(map.start.x, map.start.y, map.startHeading);
  s.segmentCount = count;
  s.segmentTarget = target;
  s.updateSegments();
  world.camera.x = s.x;
  world.camera.y = s.y;
  clampCamera(world.camera, map.width, map.height);
  world.flow = createFlowField(map);
  refreshFlowField(world.flow, s.x, s.y);
  placeBreakables(world);
  placeVents(world);
  placeSites(world);

  world.bossClearing = -1;
  world.bossWarned = false;
  world.nextBossTime = world.time + (world.effects.bossInterval ?? DIRECTOR.bossInterval);
  world.spawnAcc = 0;
  world.invuln = 1.5;
  world.descent = null;
  world.fade = DESCENT.fade;
  world.banner = { text: `Depth ${world.depth}: ${def.name}`, sub: def.tip, t: 0, max: 4, color: COLORS.nova };
}
