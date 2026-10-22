import { describe, expect, it } from 'vitest';
import { clampCamera, inView, viewRect } from '../camera';
import { DIRECTOR, ENEMIES, EVOLUTIONS, NAV } from '../config';
import { updateShots } from '../combat';
import { ringPoint, spawnEnemy, updateDirector, updateEnemies, updatePortals } from '../enemies';
import { flowAngle, flowDistance, refreshFlowField } from '../nav';
import { emptyMetaLevels } from '../progression';
import { castSpell } from '../spells';
import { clearanceAt } from '../terrain';
import { createWorld, type Enemy, type World } from '../world';

const DT = 1 / 120;

function newWorld(seed = 11): World {
  return createWorld(emptyMetaLevels(), () => undefined, seed);
}

/** Puts the serpent (and the camera) at (x, y) and refreshes the paths to it. */
function placeSerpent(w: World, x: number, y: number, heading = 0): void {
  w.snake.reset(x, y, heading);
  w.camera.x = x;
  w.camera.y = y;
  clampCamera(w.camera, w.map.width, w.map.height);
  refreshFlowField(w.flow, x, y);
}

/** Advances the clock and the foes one step (the engine's step, without the serpent). */
function tick(w: World): void {
  w.time += DT;
  updateDirector(w, DT);
  updatePortals(w, DT);
  updateEnemies(w, DT);
}

/** A foe that stays put on its own and only moves when the test (or its AI) moves it. */
function foe(w: World, kind: Enemy['kind'], x: number, y: number): Enemy {
  const e = spawnEnemy(w, kind, x, y);
  e.elite = null;
  e.shield = 0;
  return e;
}

describe('the flow field', () => {
  it('leads around a wall to the serpent, by a path longer than the straight line', () => {
    const w = newWorld();
    // The serpent below the Broken Gate's wall, a foe above it: the way is round the end or through the gate.
    placeSerpent(w, 2400, 3300);
    const p = { x: 2400, y: 2600 };
    const path = flowDistance(w.flow, p.x, p.y);
    expect(path).toBeGreaterThan(Math.hypot(0, 700) + 300);
    expect(flowDistance(w.flow, 2400, 2900)).toBe(Infinity); // inside the wall
    let steps = 0;
    while (Math.hypot(p.x - 2400, p.y - 3300) > 60 && steps < 400) {
      const a = flowAngle(w.flow, p.x, p.y)!;
      p.x += Math.cos(a) * 20;
      p.y += Math.sin(a) * 20;
      expect(clearanceAt(w.map.index, p.x, p.y)).toBeGreaterThan(0);
      steps++;
    }
    expect(steps).toBeLessThan(400);
  });

  it('brings a pack of chasers round the wall to the serpent, none stuck', () => {
    const w = newWorld();
    placeSerpent(w, 2400, 3300);
    w.spawnAcc = -1e9;
    const pack = Array.from({ length: 12 }, (_, i) => foe(w, 'chaser', 2000 + (i % 6) * 160, 2560 + Math.floor(i / 6) * 120));
    const reached = new Set<number>();
    let worstStuck = 0;
    for (let i = 0; i < 40 / DT && reached.size < pack.length; i++) {
      tick(w);
      for (const e of pack) {
        if (Math.hypot(e.x - w.snake.x, e.y - w.snake.y) < 70) reached.add(e.id);
        worstStuck = Math.max(worstStuck, e.nav.stuck);
      }
    }
    expect(reached.size).toBe(pack.length);
    expect(worstStuck).toBeLessThan(NAV.stuckTime);
  });
});

describe('spawning on a big map', () => {
  it('spawns in the ring just outside the view: never on screen, in stone or out of reach', () => {
    const w = newWorld();
    let found = 0;
    let tries = 0;
    for (const [x, y] of [
      [3200, 2100],
      [400, 300],
      [6000, 3300],
      [3200, 300],
      [700, 1900],
    ]) {
      placeSerpent(w, x, y);
      const inner = viewRect(w.camera, NAV.ringInner);
      const outer = viewRect(w.camera, NAV.ringOuter);
      for (let i = 0; i < 200; i++) {
        tries++;
        const p = ringPoint(w);
        if (!p) continue;
        found++;
        expect(p.x > inner.x0 && p.x < inner.x1 && p.y > inner.y0 && p.y < inner.y1).toBe(false);
        expect(p.x >= outer.x0 && p.x <= outer.x1 && p.y >= outer.y0 && p.y <= outer.y1).toBe(true);
        expect(clearanceAt(w.map.index, p.x, p.y)).toBeGreaterThanOrEqual(40);
        expect(flowDistance(w.flow, p.x, p.y)).toBeLessThan(Infinity);
        expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThanOrEqual(DIRECTOR.minSpawnDistance);
      }
    }
    expect(found / tries).toBeGreaterThan(0.9);
  });

  it('brings back foes left far behind', () => {
    const w = newWorld();
    placeSerpent(w, 600, 600);
    w.spawnAcc = -1e9;
    const e = foe(w, 'chaser', 5800, 3200);
    e.speed = 0;
    for (let i = 0; i < (NAV.farTime + 0.5) / DT; i++) tick(w);
    expect(Math.hypot(e.x - 600, e.y - 600)).toBeLessThan(1400);
    expect(inView(w.camera, e.x, e.y, NAV.ringInner - 1)).toBe(false);
  });

  it('keeps every foe out of the stonework through a busy minute', () => {
    const w = newWorld(5);
    w.time = 240;
    w.invuln = 1e9;
    let worst = Infinity;
    for (let i = 0; i < 60 / DT; i++) {
      tick(w);
      // The serpent wanders between two of the courts.
      w.snake.update(DT, Math.sin(i * DT * 0.4), Math.cos(i * DT * 0.3), w.map);
      if (i % 30 === 0) {
        for (const e of w.enemies) worst = Math.min(worst, clearanceAt(w.map.index, e.x, e.y) - e.r);
      }
    }
    expect(w.enemies.length).toBeGreaterThan(10);
    expect(worst).toBeGreaterThan(-1);
  });
});

describe('fair attacks', () => {
  it('starts no attack while the attacker is off-screen', () => {
    for (const kind of ['caster', 'brute'] as const) {
      const w = newWorld();
      placeSerpent(w, 3200, 1800);
      w.spawnAcc = -1e9;
      // Just below the view, near enough to attack.
      const e = foe(w, kind, 3200, 1800 + w.camera.viewH / 2 + 120);
      e.attackTimer = 0;
      let startedAt: { x: number; y: number } | null = null;
      for (let i = 0; i < 6 / DT && !startedAt; i++) {
        tick(w);
        if (e.state === 'windup') startedAt = { x: e.x, y: e.y };
      }
      expect(startedAt, kind).not.toBeNull();
      expect(inView(w.camera, startedAt!.x, startedAt!.y, NAV.attackMargin + 1), kind).toBe(true);
    }
  });

  it('a brute that charges into a pillar staggers for longer', () => {
    const w = newWorld();
    placeSerpent(w, 600, 3000);
    w.spawnAcc = -1e9;
    // Straight up at the colonnade's middle pillar.
    const b = foe(w, 'brute', 3200, 1000);
    Object.assign(b, { state: 'attack', stateTime: 0, aim: -Math.PI / 2 });
    let recovering = 0;
    for (let i = 0; i < 4 / DT; i++) {
      tick(w);
      if (b.state === 'recover') recovering += DT;
      else if (recovering > 0) break;
    }
    expect(b.y).toBeGreaterThan(780 + 34 + ENEMIES.brute.radius - 15);
    expect(recovering).toBeCloseTo(ENEMIES.brute.recover * ENEMIES.brute.bonkStagger, 1);
  });
});

describe('solids and spells', () => {
  it('stop hostile shots and Arcane Lance beams', () => {
    const w = newWorld();
    placeSerpent(w, 3200, 1300, Math.PI / 2);
    // A shot fired up at the colonnade pillar from just below it.
    w.shots.push({ x: 3200, y: 950, vx: 0, vy: -300, r: 8, damage: 5, life: 5, spin: 0, source: { kind: 'caster', attack: 'shot' }, look: 'orb' });
    for (let i = 0; i < 1 / DT && w.shots.length; i++) updateShots(w, DT);
    expect(w.shots).toHaveLength(0);

    w.evolved.bolt = true;
    castSpell(w, 'bolt', { x: 3200, y: 300 });
    const beam = w.beams[0];
    expect(Math.hypot(beam.x1 - beam.x0, beam.y1 - beam.y0)).toBeLessThan(EVOLUTIONS.bolt.beamLength - 200);
  });
});

describe('the boss and its clearing', () => {
  it('marks the nearest clearing 30 s ahead, then opens its portal there', () => {
    const w = newWorld();
    w.spawnAcc = -1e9;
    w.time = w.nextBossTime - NAV.clearingWarning;
    updateDirector(w, DT);
    expect(w.bossClearing).toBeGreaterThanOrEqual(0);
    const c = w.map.clearings[w.bossClearing];
    // The serpent starts in the plaza, which is a clearing itself.
    expect(w.snake.x > c.x0 && w.snake.x < c.x1 && w.snake.y > c.y0 && w.snake.y < c.y1).toBe(true);
    w.time = w.nextBossTime;
    updateDirector(w, DT);
    const portal = w.portals.find((p) => p.kind === 'boss')!;
    expect(portal.x > c.x0 && portal.x < c.x1 && portal.y > c.y0 && portal.y < c.y1).toBe(true);
    expect(Math.hypot(portal.x - w.snake.x, portal.y - w.snake.y)).toBeGreaterThanOrEqual(NAV.bossPortalDistance);
    expect(w.bossClearing).toBe(-1);
  });
});
